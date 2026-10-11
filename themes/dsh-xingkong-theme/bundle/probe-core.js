/**
 * 模型探测引擎 —— 「自定义模型检验功能」的 host 侧核心。
 *
 * 解决的问题：配置里每条 llm 路由都写死了「模型清单 + 上下文窗口 + 输出上限 + 思考档位」，
 * 而厂商随时上下线模型、改档位、放宽窗口。手写迟早说谎——写小了浪费能力，写大了直接报错。
 * 所以三件事都现场问出来：
 *
 * 1. **上下文窗口 / 输出上限** —— 读厂商模型目录 `GET {origin}/api/v1/models`（逐页拉全量，
 *    读 `model_info.context_window` / `max_output_tokens` / `max_input_tokens`）。这是厂商
 *    自己声明的权威值。探测不做 hostname 限定：实测用户用的 maas 端点也有同样的目录。
 * 2. **输出上限的兜底** —— 对任何 OpenAI 兼容端点都通用的一招：故意发一个超大的
 *    `max_tokens`，端点会在 400 里吐出合法区间（`Range of max_tokens should be [1, 131072]`），
 *    上界即该模型的输出上限；端点不校验时返回 undefined。
 * 3. **思考档位** —— 只有现场试才准。逐档发一次 `max_tokens: 1` 的请求，按响应分类：
 *      - 2xx                              → 该档可用
 *      - 4xx 且报错提到 reasoning/thinking → 该档不可用（换 wire 拼写再试该档）
 *      - 其它非 2xx / 网络异常            → 无法定论（不写结论，报给用户）
 *    这条区分很重要：模型因为「思考内容放不进 1 个 token」而报的错，不该被误判成档位不支持。
 *
 * 存活探测还按响应文案细分 kind（未开通 / 额度耗尽 / 非对话模型 / 被拒绝 / 网络异常），
 * 面板据此分类展示——厂商列出的清单并不区分这些状态。
 *
 * 与 lib/model-probe.js 的差异（迁移进主题 bundle 时按契约收紧）：
 * - 无外部依赖：只用 Node 内置；fetch 从 `deps.fetchImpl` 注入（默认 `globalThis.fetch`）。
 * - 目录探测不限定 dashscope 域名。
 * - 单个模型的任何异常都不中断整批，只有 AbortError 向上抛。
 *
 * @module bundle/probe-core
 */

/** 引擎 `reasoningEfforts` 认识的档位名。 */
export const ENGINE_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * 每个档位要试的线上拼写。只有 `off` 需要多试几个：
 * 关闭思考在各家叫法不同（百炼/OpenAI 风格是 `none`，也有端点用 `off`）。
 * 按顺序尝试，`none` 优先（实测该端点认 `none` 且拒绝 `off`）。
 */
export const WIRE_CANDIDATES = {
  off: ['none', 'off'],
  minimal: ['minimal'],
  low: ['low'],
  medium: ['medium'],
  high: ['high'],
  xhigh: ['xhigh'],
  max: ['max'],
};

/** 判定「这档不支持」而不是「别的问题」的关键词。 */
const REJECT_HINT = /reasoning_effort|reasoning\.effort|enable_thinking|thinking|unsupported|not support/i;

/**
 * 端点在拒绝非法 reasoning_effort 时，把合法档位全集写进 400 报文
 * （实测阿里云百炼：'reasoning_effort' must be one of: 'none', 'minimal',
 * 'low', 'medium', 'high', 'xhigh', 'max'）。一次请求即可问出整个端点的
 * 档位集合 —— 这是把「推理等级」变成近乎零成本自动项的关键。
 */
const ENUM_LIST_HINT = /must be one of:?\s*([^."}]+)/i;
const ENUM_ITEM = /'([^']*)'/g;

const NOT_ACTIVATED_HINT = /not activated/i;
const QUOTA_HINT = /quota/i;

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CONCURRENCY = 6;
const MAX_CATALOG_PAGES = 6;
const CATALOG_PAGE_SIZE = 200;
const MESSAGE_LIMIT = 200;

/** 结果/日志里的分类中文名。 */
const KIND_LABEL = {
  'not-activated': '未开通',
  quota: '额度耗尽',
  'non-chat': '非对话模型',
  rejected: '被拒绝',
  error: '探测出错',
};

/** 取数字字段，非正整数视为缺失。 */
function num(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return Math.floor(c);
  }
  return undefined;
}

/** 响应原文截断（契约：message 最多 200 字符，绝不含密钥）。 */
function truncate(text, limit) {
  const s = typeof text === 'string' ? text : '';
  return s.length > limit ? s.slice(0, limit) : s;
}

/** 统一的取消错误：调用方按 `err.name === 'AbortError'` 识别。 */
function abortError() {
  const err = new Error('probe aborted');
  err.name = 'AbortError';
  return err;
}

function isAbort(error) {
  return !!error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

/** baseURL 去尾斜杠 + 路径。 */
function joinUrl(baseURL, path) {
  return `${String(baseURL).replace(/\/+$/, '')}/${path}`;
}

/** 存活/档位探测的统一请求体。 */
function probeBody(model, extra) {
  return Object.assign({
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false,
  }, extra || {});
}

/** 非 2xx 的分类。 */
function classifyFailure(status, text) {
  const body = typeof text === 'string' ? text : '';
  if (status === 400 && NOT_ACTIVATED_HINT.test(body)) return 'not-activated';
  if (status === 403 && QUOTA_HINT.test(body)) return 'quota';
  if (status === 400 && REJECT_HINT.test(body)) return 'non-chat';
  return 'rejected';
}

/** 进度行：`12/300 qwen3.8-max 可用 · 1000000 ctx · 档位 low,high,max`。 */
function progressLine(row, done, total, full) {
  const tail = [];
  if (row.alive === true) {
    tail.push('可用');
    if (row.contextWindow !== undefined) tail.push(`${row.contextWindow} ctx`);
    if (row.maxTokens !== undefined) tail.push(`${row.maxTokens} max`);
    if (row.efforts === false) tail.push('不思考');
    else if (row.efforts) tail.push(`档位 ${Object.keys(row.efforts).join(',')}`);
    else if (full) tail.push('档位未知');
  } else if (row.alive === false) {
    tail.push(KIND_LABEL[row.kind] || '不可用');
  } else {
    tail.push('未探测');
  }
  const head = `${done}/${total} ${row.id}`;
  return tail.length > 0 ? `${head} ${tail.join(' · ')}` : head;
}

/** 简单并发池；宽度上限由调用方（≤6）保证。 */
async function pool(items, limit, worker, signal) {
  const out = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const runners = new Array(width).fill(0).map(async () => {
    for (;;) {
      if (signal && signal.aborted) throw abortError();
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * 造一个探测引擎实例。
 *
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl] 注入的 fetch（单测用），默认 globalThis.fetch
 * @param {number} [deps.timeoutMs] 单请求超时，默认 30000
 */
export function createProbeEngine(deps = {}) {
  const fetchImpl = typeof deps.fetchImpl === 'function' ? deps.fetchImpl : globalThis.fetch;
  const timeoutMs = num(deps.timeoutMs) || DEFAULT_TIMEOUT_MS;

  /**
   * 单次 HTTP 请求：统一鉴权头、超时与取消。
   * 只有 AbortError 会抛出；其余网络异常收敛成 `{ ok:false, status:0, error }`。
   */
  async function request(url, options = {}) {
    const { method = 'GET', apiKey, body, signal } = options;
    if (signal && signal.aborted) throw abortError();
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    const timer = setTimeout(onAbort, timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const headers = {};
      // 密钥只出现在这里，绝不进入结果或日志。
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      const status = typeof res.status === 'number' ? res.status : 0;
      const text = typeof res.text === 'function' ? await res.text() : '';
      return { ok: status >= 200 && status < 300, status, text };
    } catch (error) {
      if (signal && signal.aborted) throw abortError();
      return { ok: false, status: 0, text: '', error: String((error && error.message) || error) };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * 拉厂商模型目录并分页到 total 拿完（≤6 页 × 200）。
   * 端点没有目录（404/非 JSON/网络异常）时返回 null，不抛错。
   *
   * @returns {Promise<Map<string, {contextWindow?:number, maxTokens?:number, maxInputTokens?:number, reasoning:boolean}>|null>}
   */
  async function fetchCatalog(baseURL, apiKey, log, signal) {
    const say = typeof log === 'function' ? log : () => {};
    let origin;
    try {
      origin = new URL(baseURL).origin;
    } catch {
      return null;
    }
    const map = new Map();
    for (let page = 1; page <= MAX_CATALOG_PAGES; page++) {
      const url = `${origin}/api/v1/models?page_no=${page}&page_size=${CATALOG_PAGE_SIZE}`;
      const res = await request(url, { apiKey, signal });
      if (!res.ok) {
        say(`目录接口第 ${page} 页不可用：HTTP ${res.status}${res.error ? ' ' + res.error : ''}`);
        return null;
      }
      let parsed;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        say(`目录接口第 ${page} 页不是 JSON`);
        return null;
      }
      const models = (parsed && parsed.output && parsed.output.models) || [];
      if (!Array.isArray(models) || models.length === 0) break;
      for (const m of models) {
        const id = m && m.model;
        if (typeof id !== 'string' || id.length === 0) continue;
        const info = (m && m.model_info) || {};
        const caps = Array.isArray(m && m.capabilities) ? m.capabilities : [];
        map.set(id, {
          contextWindow: num(info.context_window),
          maxTokens: num(info.max_output_tokens),
          maxInputTokens: num(info.max_input_tokens),
          reasoning: caps.includes('Reasoning'),
        });
      }
      const total = num(parsed && parsed.output && parsed.output.total);
      if (total !== undefined) {
        if (map.size >= total) break;
      } else if (models.length < CATALOG_PAGE_SIZE) {
        break;
      }
    }
    return map.size > 0 ? map : null;
  }

  /**
   * 存活检测：这个模型当前到底能不能用。一次 `max_tokens: 1` 的最小请求问清楚。
   * 必须在档位探测之前做——已经不可用的模型，后面 7 次档位探测只会拿到同一句拒绝。
   *
   * @returns {Promise<{alive:true, status:number}|{alive:false, kind:string, status:number, message:string}>}
   */
  async function probeAlive(baseURL, apiKey, model, signal) {
    const res = await request(joinUrl(baseURL, 'chat/completions'), {
      method: 'POST',
      apiKey,
      body: probeBody(model),
      signal,
    });
    if (res.ok) return { alive: true, status: res.status };
    if (!res.status) {
      return { alive: false, kind: 'error', status: 0, message: truncate(res.error || 'network error', MESSAGE_LIMIT) };
    }
    const text = typeof res.text === 'string' ? res.text : '';
    return { alive: false, kind: classifyFailure(res.status, text), status: res.status, message: truncate(text, MESSAGE_LIMIT) };
  }

  /**
   * 输出上限兜底：故意超界的 `max_tokens` 把合法区间从 400 报错里读出来。
   * 端点不校验（接受了超大值）则返回 undefined。
   *
   * @returns {Promise<number|undefined>}
   */
  async function probeMaxTokens(baseURL, apiKey, model, signal) {
    const res = await request(joinUrl(baseURL, 'chat/completions'), {
      method: 'POST',
      apiKey,
      body: probeBody(model, { max_tokens: 999999999 }),
      signal,
    });
    if (res.ok) return undefined;
    const m = /max_tokens should be \[(\d+),\s*(\d+)\]/i.exec(res.text || '');
    if (!m) return undefined;
    return num(Number(m[2]));
  }

  /**
   * 一次请求问出「整个端点」接受哪些推理档位。
   *
   * 做法是发一个必然非法的档位：端点若做枚举校验，会在 400 报文里列出合法全集
   * （实测阿里云百炼给出 none/minimal/low/medium/high/xhigh/max 七档）。
   * 于是「这个端点支持哪些推理等级」从每模型 7~8 个请求降到**全端点 1 个**。
   *
   * 返回值已经是可直接写进配置的形状：`{引擎档位: 线上拼写}`，
   * 其中端点的 `none` 对应引擎的 `off`（关思考 = 不发该参数，官方
   * resolveModelReasoning 允许 off 留空）。
   *
   * 端点不校验枚举时（非法值也 2xx）返回 null —— 那种端点问不出来，
   * 不猜。
   *
   * @returns {Promise<object|null>}
   */
  async function probeEndpointEfforts(baseURL, apiKey, model, signal) {
    const res = await request(joinUrl(baseURL, 'chat/completions'), {
      method: 'POST',
      apiKey,
      body: probeBody(model, { reasoning_effort: '__dsh_probe_invalid__' }),
      signal,
    });
    if (res.ok) return undefined;
    const list = ENUM_LIST_HINT.exec(res.text || '');
    if (list === null) return undefined;
    const wire = {};
    for (const match of list[1].matchAll(ENUM_ITEM)) {
      const value = match[1];
      if (value.length === 0) continue;
      // The engine's "off" is spelled "none" on the wire; keep the engine's
      // level ids so the map can be written into settings as-is.
      wire[value === 'none' ? 'off' : value] = value;
    }
    const levels = Object.keys(wire);
    if (levels.length === 0) return undefined;
    if (!levels.some((level) => level !== 'off')) return false;
    return wire;
  }

  /**
   * 逐档探测可用的思考档位。
   *
   * @returns {Promise<{efforts?: object|false, reasoning?: boolean, error?: string}>}
   *   `efforts` 是 `{引擎档位: 线上拼写}`（off 命中 `none` 时即 `{off:'none'}`）；
   *   `false` 表示该模型不需要/不支持思考；无法定论时 `efforts` 为 undefined 并在 `error` 里说明。
   */
  async function probeEfforts(baseURL, apiKey, model, log, signal) {
    const say = typeof log === 'function' ? log : () => {};
    const url = joinUrl(baseURL, 'chat/completions');
    const accepted = {};
    let inconclusive = '';

    for (const level of ENGINE_LEVELS) {
      let decided = false;
      for (const wire of WIRE_CANDIDATES[level]) {
        const res = await request(url, {
          method: 'POST',
          apiKey,
          body: probeBody(model, { reasoning_effort: wire }),
          signal,
        });
        if (res.ok) {
          accepted[level] = wire;
          decided = true;
          break;
        }
        if (res.status >= 400 && res.status < 500 && REJECT_HINT.test(res.text || '')) {
          continue; // 换个拼写再试同一个档
        }
        // 既不是 2xx 也不是「明确的档位不支持」：不能据此下结论。
        inconclusive = `HTTP ${res.status} ${truncate(res.text || res.error || '', 160)}`.trim();
        break;
      }
      if (!decided && inconclusive) break;
    }

    if (inconclusive) {
      say(`  ${model}: 档位探测无法定论（${inconclusive}）`);
      return { efforts: undefined, reasoning: undefined, error: inconclusive };
    }
    const levels = Object.keys(accepted);
    if (levels.filter((l) => l !== 'off').length === 0) return { efforts: false, reasoning: false };
    return { efforts: accepted, reasoning: true };
  }

  /**
   * 主入口：探测一批模型。
   *
   * @param {object} options
   * @param {string} options.baseURL
   * @param {string} [options.api] 协议；非 openai-completions/responses 时不发探测请求
   * @param {string} [options.apiKey] 密钥；缺失时只回填目录
   * @param {string[]} options.models
   * @param {'alive'|'full'} [options.mode] alive=目录+存活；full=再加输出上限兜底与档位
   * @param {number} [options.concurrency] 并发池宽度，默认（且上限）6
   * @param {(line: string, row?: object) => void} [options.onProgress] 每完成一个模型回调一行；
   *   进度行附带第二个参数（该模型的结构化结果行），流程信息行只有文本
   * @param {AbortSignal} [options.signal] 取消；触发后抛 AbortError
   * @returns {Promise<{results: object[], catalogLoaded: boolean, catalogSize: number}>}
   */
  async function runProbe(options) {
    const {
      baseURL,
      api,
      apiKey,
      models,
      mode = 'full',
      concurrency = DEFAULT_CONCURRENCY,
      onProgress,
      signal,
    } = options || {};

    const log = typeof onProgress === 'function' ? onProgress : () => {};
    const ids = Array.isArray(models) ? models.filter((m) => typeof m === 'string' && m.length > 0) : [];
    if (!baseURL || ids.length === 0) return { results: [], catalogLoaded: false, catalogSize: 0 };
    if (signal && signal.aborted) throw abortError();

    const full = mode === 'full';
    log(`开始探测 ${ids.length} 个模型（${full ? '完整检验' : '快速筛查'}）`);

    // 1) 厂商目录：一次请求覆盖所有模型，优先拿到权威的窗口/上限
    let catalog = null;
    if (apiKey) {
      log('读取厂商模型目录…');
      catalog = await fetchCatalog(baseURL, apiKey, log, signal);
      log(catalog
        ? `目录命中 ${catalog.size} 个模型（含上下文窗口与输出上限）`
        : '该端点没有可读的目录，改用现场探测');
    }

    const canChat = !api || api === 'openai-completions' || api === 'openai-responses';
    if (!canChat) log(`协议 ${api} 不支持 chat 探测，只回填目录里已有的信息`);
    const canProbe = canChat && !!apiKey;

    // 2) 端点级推理档位：一次非法值请求就能问出整个端点的档位全集。
    // 先用一个存活模型的冒烟结果挑代表模型不可行（还没探测），所以这里用
    // ids[0]；端点若因模型名不对而拒绝，报文里不会有枚举，函数返回 null，
    // 逐档探测仍会兜底。
    let endpointEfforts;
    if (canProbe) {
      log('询问端点支持的推理档位…');
      endpointEfforts = await probeEndpointEfforts(baseURL, apiKey, ids[0], signal);
      if (endpointEfforts === undefined) {
        log('该端点不报档位枚举，跳过端点级推理等级');
      } else if (endpointEfforts === false) {
        log('端点声明：模型不支持思考（reasoningEfforts: false）');
      } else {
        log(`端点支持 ${Object.keys(endpointEfforts).length} 档：${Object.keys(endpointEfforts).join('、')}`);
      }
    }

    const total = ids.length;
    let done = 0;
    const width = Math.max(1, Math.min(num(concurrency) || DEFAULT_CONCURRENCY, DEFAULT_CONCURRENCY));

    const results = await pool(ids, width, async (id) => {
      const row = {
        id,
        alive: null,
        kind: 'pending',
        status: undefined,
        message: '',
        contextWindow: undefined,
        maxTokens: undefined,
        reasoning: null,
        efforts: undefined,
        error: undefined,
      };
      const hit = catalog ? catalog.get(id) : undefined;
      if (hit) {
        if (hit.contextWindow !== undefined) row.contextWindow = hit.contextWindow;
        if (hit.maxTokens !== undefined) row.maxTokens = hit.maxTokens;
      }

      if (canProbe) {
        try {
          const live = await probeAlive(baseURL, apiKey, id, signal);
          row.status = live.status;
          row.alive = live.alive === true;
          if (!row.alive) {
            row.kind = live.kind || 'error';
            row.message = live.message || '';
          } else {
            row.kind = 'ok';
            // 目录没给输出上限时，才用「超界 max_tokens」现场问一次。
            if (full && row.maxTokens === undefined) {
              const mt = await probeMaxTokens(baseURL, apiKey, id, signal);
              if (mt !== undefined) row.maxTokens = mt;
            }
            // 存活模型在 alive 模式下也报出档位：它来自那一次端点级查询，
            // 不是逐档试探 —— 所以「推理等级」不需要完整检验才有。
            // NOTE the !== null check: probeEndpointEfforts answers null when
            // the endpoint does not enumerate (we must not guess then), and a
            // null would land in the JSON status payload as `efforts: null`,
            // which is not a shape the harness accepts.
            if (row.efforts === undefined && endpointEfforts !== undefined && endpointEfforts !== null) {
              row.efforts = endpointEfforts;
              row.reasoning = endpointEfforts !== false;
            }
            if (full && row.efforts === undefined) {
              const eff = await probeEfforts(baseURL, apiKey, id, log, signal);
              if (eff.error) row.error = eff.error;
              if (eff.efforts !== undefined) {
                row.efforts = eff.efforts;
                row.reasoning = eff.reasoning;
              }
            }
          }
        } catch (error) {
          if (isAbort(error)) throw error;
          // 单模型失败绝不中断整批。
          if (row.alive !== true) row.alive = false;
          row.kind = 'error';
          row.error = String((error && error.message) || error);
          if (!row.message) row.message = row.error;
        }
      }

      done += 1;
      // 第二个参数（结构化行）供调用方做增量结果聚合；目录/流程行只有文本。
      log(progressLine(row, done, total, full), row);
      return row;
    }, signal);

    return { results, catalogLoaded: !!catalog, catalogSize: catalog ? catalog.size : 0 };
  }

  return { fetchCatalog, probeAlive, probeMaxTokens, probeEfforts, probeEndpointEfforts, runProbe };
}

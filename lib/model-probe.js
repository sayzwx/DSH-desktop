'use strict';

/**
 * 模型能力探测（Model capability probe）
 *
 * 解决的问题：llm-pi-ai 的每条路由都要在配置里写死「模型清单 + 上下文窗口 + 输出上限 +
 * 思考档位」，而这些事实是**会变**的——厂商上/下线模型、调整档位、放宽窗口。手写意味着
 * 迟早说谎：写小了浪费能力，写大了直接请求报错。
 *
 * 本模块把三件事都做成可以现场问出来的：
 *
 * 1. **上下文窗口 / 输出上限** —— 走厂商的模型目录接口（阿里云百炼是
 *    `{origin}/api/v1/models`，逐页拉全量，读 `model_info.context_window` 与
 *    `model_info.max_output_tokens`）。这是厂商自己声明的权威值。
 * 2. **输出上限的兜底** —— 对任何 OpenAI 兼容端点都通用的一招：故意发一个超大的
 *    `max_tokens`，端点会在 400 里直接吐出合法区间（`Range of max_tokens should be [1, 131072]`），
 *    上界即该模型的输出上限。实测这条信息是按模型区分的，可用（kimi-k3 给的是 1048576，
 *    qwen 系给的是 131072）。
 * 3. **思考档位** —— 只有现场试才准。厂商目录里的 `capabilities` 含 `Reasoning` 只是"能不能思考"，
 *    并没有说合法档位有哪些；而实测存在目录说没有、实际能用的模型（glm-5.2-fast-preview）。
 *    所以逐档发一个 `max_tokens: 1` 的探测请求，按响应分类：
 *      - 2xx                            → 该档位可用
 *      - 4xx 且报错提到 reasoning/thinking → 该档位不可用
 *      - 其它 4xx/5xx                    → 无法判断（不写结论，报给用户）
 *    这条区分很重要：模型因为「思考内容放不进 1 个 token」而报的错，不该被误判成档位不支持。
 *
 * 探测请求都很小（max_tokens: 1），一次全量刷新的 token 消耗可以忽略。
 *
 * @module lib/model-probe
 */

/** 引擎 `reasoningEfforts` 认识的档位名（与 llm-pi-ai catalog.ts 的 THINKING_LEVELS 一致）。 */
const ENGINE_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * 每个档位要试的线上拼写。只有 `off` 需要多试几个：
 * 关闭思考在各家叫法不同（百炼/OpenAI 风格是 `none`，也有端点用 `off`）。
 * 其余档位直接同名试。
 */
const WIRE_CANDIDATES = {
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

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CONCURRENCY = 6;
const MAX_CATALOG_PAGES = 6;
const CATALOG_PAGE_SIZE = 200;

// URL 拼接与带超时的 fetch 统一收敛到 lib/llm-call.js —— 主题迁移的分析请求
// 也要发同样的请求，各写一份必然漂移。这里只做转发，保持本模块原有导出形状。
const { joinUrl, request } = require('./llm-call.js');

/** 取数字字段，非正整数视为缺失。 */
function num(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return Math.floor(c);
  }
  return undefined;
}

/**
 * 拉厂商模型目录（当前只对阿里云百炼实现——它是我们已知唯一自带 model_info 的目录接口）。
 * 返回 id -> { contextWindow, maxTokens, reasoning, name } 的 Map，失败时返回 null。
 */
async function fetchDashScopeCatalog(baseURL, apiKey, log) {
  let origin;
  try {
    origin = new URL(baseURL).origin;
  } catch {
    return null;
  }
  if (!/dashscope\.aliyuncs\.com$/i.test(new URL(origin).hostname)) return null;

  const map = new Map();
  for (let page = 1; page <= MAX_CATALOG_PAGES; page++) {
    const url = `${origin}/api/v1/models?page_no=${page}&page_size=${CATALOG_PAGE_SIZE}`;
    const res = await request(url, { apiKey, timeoutMs: 20000 });
    if (!res.ok) {
      log(`目录接口第 ${page} 页失败：HTTP ${res.status}${res.error ? ' ' + res.error : ''}`);
      return map.size > 0 ? map : null;
    }
    let parsed;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      log(`目录接口第 ${page} 页不是 JSON`);
      return map.size > 0 ? map : null;
    }
    const models = (parsed && parsed.output && parsed.output.models) || [];
    for (const m of models) {
      const id = m && m.model;
      if (typeof id !== 'string' || id.length === 0) continue;
      const info = m.model_info || {};
      const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
      map.set(id, {
        name: typeof m.name === 'string' && m.name.length > 0 ? m.name : undefined,
        contextWindow: num(info.context_window),
        maxTokens: num(info.max_output_tokens),
        maxInputTokens: num(info.max_input_tokens),
        reasoning: caps.includes('Reasoning'),
      });
    }
    if (models.length < CATALOG_PAGE_SIZE) break;
  }
  return map.size > 0 ? map : null;
}

/**
 * 用「故意超界的 max_tokens」把输出上限从 400 报错里读出来。
 * 端点是 `Range of max_tokens should be [1, N]` 这种形状的就直接拿到 N；
 * 端点不校验（例如 deepseek-v4.1-flash 接受了 999999999）则返回 undefined。
 */
async function probeMaxTokens(baseURL, apiKey, model, log) {
  const res = await request(joinUrl(baseURL, 'chat/completions'), {
    method: 'POST',
    apiKey,
    body: {
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 999999999,
      stream: false,
    },
  });
  if (res.ok) return undefined; // 端点不设上限
  const m = /max_tokens should be \[(\d+),\s*(\d+)\]/i.exec(res.text || '');
  if (m) return num(Number(m[2]));
  return undefined;
}

/**
 * 存活检测：这个模型当前到底能不能用。
 *
 * 这是「可用模型列表会变」的最直接答案——厂商会因额度、开通状态、下线而拒绝某个模型，
 * 而端点列出来的清单并不区分这些。一次 `max_tokens: 1` 的最小请求就能问清楚，
 * 而且必须在探测档位之前做：一个已经不可用的模型，后面 7 次档位探测只会拿到同一句拒绝。
 */
async function probeAlive(baseURL, apiKey, model) {
  const res = await request(joinUrl(baseURL, 'chat/completions'), {
    method: 'POST',
    apiKey,
    body: {
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    },
  });
  if (res.ok) return { ok: true };
  return {
    ok: false,
    status: res.status,
    message: `HTTP ${res.status}${res.error ? ' ' + res.error : ''} ${(res.text || '').slice(0, 200)}`.trim(),
  };
}

/**
 * 逐档探测可用的思考档位。
 * @returns {{ reasoningEfforts?: object|false, reasoning?: boolean, rejectSample?: string, error?: string }}
 *   `reasoningEfforts` 直接就是可以写进 settings.yaml 的形状（对象或 false）；
 *   无法得出结论时该字段为 undefined，并在 `error` 里说明。
 */
async function probeEfforts(baseURL, apiKey, model, log) {
  const url = joinUrl(baseURL, 'chat/completions');
  const accepted = {};
  let rejectedSample = '';
  let inconclusive = '';

  for (const level of ENGINE_LEVELS) {
    let decided = false;
    for (const wire of WIRE_CANDIDATES[level]) {
      const res = await request(url, {
        method: 'POST',
        apiKey,
        body: {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          reasoning_effort: wire,
          stream: false,
        },
      });
      if (res.ok) {
        accepted[level] = wire;
        decided = true;
        break;
      }
      if (res.status >= 400 && res.status < 500 && REJECT_HINT.test(res.text || '')) {
        if (!rejectedSample) rejectedSample = (res.text || '').slice(0, 200);
        continue; // 换个拼写再试
      }
      // 既不是 2xx 也不是「明确的档位不支持」：不能据此下结论。
      inconclusive = `HTTP ${res.status}${res.error ? ' ' + res.error : ''} ${(res.text || '').slice(0, 160)}`;
      break;
    }
    if (!decided && inconclusive) break;
  }

  if (inconclusive) {
    log(`  ${model}: 档位探测无法定论（${inconclusive}）`);
    return { error: inconclusive };
  }
  const levels = Object.keys(accepted);
  const beyondOff = levels.filter((l) => l !== 'off');
  if (levels.length === 0) return { reasoningEfforts: false, reasoning: false };
  if (beyondOff.length === 0) return { reasoningEfforts: false, reasoning: false };
  return { reasoningEfforts: accepted, reasoning: true, rejectSample: rejectedSample || undefined };
}

/** 简单并发池。 */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * 探测一批模型的能力。
 * @param {object} options
 * @param {string} options.baseURL 路由端点
 * @param {string} [options.api] 协议（目前只用它判断能否发 chat/completions 探测）
 * @param {string} [options.apiKey] 密钥；缺失时无法探测（目录接口也要鉴权）
 * @param {string[]} options.models 要探测的模型 id
 * @param {number} [options.concurrency]
 * @param {(line: string) => void} [options.onProgress] 进度回调，用于把过程回显到界面
 * @returns {Promise<{ catalog: string|null, results: object[] }>}
 */
async function probeModelCapabilities(options) {
  const {
    baseURL,
    api,
    apiKey,
    models,
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
  } = options || {};
  const log = typeof onProgress === 'function' ? onProgress : () => {};
  const ids = Array.isArray(models) ? models.filter((m) => typeof m === 'string' && m.length > 0) : [];

  const out = { catalog: null, results: [] };
  if (!baseURL || ids.length === 0) return out;

  log(`开始探测 ${ids.length} 个模型（端点 ${baseURL}）…`);

  // 1) 厂商目录：一次请求覆盖所有模型，优先拿到权威的窗口/上限
  let catalog = null;
  if (apiKey) {
    log('读取厂商模型目录…');
    catalog = await fetchDashScopeCatalog(baseURL, apiKey, log);
    if (catalog) {
      out.catalog = 'dashscope';
      log(`目录命中 ${catalog.size} 个模型（含上下文窗口与输出上限）`);
    } else {
      log('该端点没有可读的厂商目录，改用现场探测');
    }
  }

  const effectiveApi = api || 'openai-completions';
  const canChat = effectiveApi === 'openai-completions' || effectiveApi === 'openai-responses';
  if (!canChat) log(`协议 ${effectiveApi} 不支持探测，只回填目录里已有的信息`);

  const results = await pool(ids, Math.max(1, concurrency), async (id) => {
    const hit = catalog ? catalog.get(id) : undefined;
    const row = { id };
    if (hit) {
      if (hit.name) row.name = hit.name;
      if (hit.contextWindow) row.contextWindow = hit.contextWindow;
      if (hit.maxTokens) row.maxTokens = hit.maxTokens;
      if (hit.reasoning !== undefined) row.catalogReasoning = hit.reasoning;
      row.sources = ['catalog'];
    }
    if (!canChat || !apiKey) return row;
    try {
      // 先判死活：不可用的模型，后面的探测只会重复拿到同一句拒绝，既慢又没有信息量。
      const live = await probeAlive(baseURL, apiKey, id);
      row.alive = live.ok;
      if (!live.ok) {
        row.error = live.message;
        log(`  ${id}: 不可用（${live.message.slice(0, 80)}）`);
        return row;
      }
      if (row.maxTokens === undefined) {
        const mt = await probeMaxTokens(baseURL, apiKey, id, log);
        if (mt) {
          row.maxTokens = mt;
          row.sources = [...(row.sources || []), 'max_tokens-range'];
        }
      }
      const eff = await probeEfforts(baseURL, apiKey, id, log);
      if (eff.reasoningEfforts !== undefined) {
        row.reasoningEfforts = eff.reasoningEfforts;
        row.reasoning = eff.reasoning;
        row.sources = [...(row.sources || []), 'effort-probe'];
      }
      if (eff.error) row.error = eff.error;
      log(`  ${id}: ${row.contextWindow || '?'} ctx / ${row.maxTokens || '?'} max / `
        + `${eff.reasoningEfforts === undefined ? '档位未知' : eff.reasoningEfforts === false ? '不思考' : Object.keys(eff.reasoningEfforts).join(',')}`);
    } catch (error) {
      row.error = String((error && error.message) || error);
      log(`  ${id}: 探测失败 ${row.error}`);
    }
    return row;
  });

  out.results = results;
  return out;
}

module.exports = {
  probeModelCapabilities,
  ENGINE_LEVELS,
  WIRE_CANDIDATES,
};

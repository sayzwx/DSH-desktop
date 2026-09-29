'use strict';

/**
 * 统一的「主进程直连模型」调用层（LLM call）
 *
 * 为什么需要它：桌面端有若干**必须在主进程发起的**模型请求 ——
 *   · `lib/model-probe.js` 的能力探测（要拿 ~/.dsh/.credentials.yaml 里的明文密钥）
 *   · 主题迁移的分析请求（要用用户已配置的路由与模型）
 * 这些请求的共同点是：密钥不能回渲染进程，而渲染进程也没有 Node 的网络能力与文件访问。
 *
 * 之前这些请求各写各的 fetch（`joinUrl` / `request` 曾散在 model-probe 里），
 * 于是每加一处就复制一遍超时、鉴权、错误归一的逻辑，且极易漂移。
 * 本模块把它们收敛成一层：
 *
 *   joinUrl(baseURL, suffix)      拼 URL 且保留部署路径段
 *   request(url, opts)            带超时、不抛异常的底层请求（返回 { ok, status, text }）
 *   chatOnce({...})               发一次 chat/completions，返回归一化结果
 *
 * **约定：本模块绝不打印/回传密钥。** 调用方自己负责从凭据文件读，读完直接传进来。
 *
 * @module lib/llm-call
 */

const DEFAULT_TIMEOUT_MS = 30000;

/** 拼接 baseURL 与子路径，保留部署路径段（例：https://x.com/v1 + chat/completions）。 */
function joinUrl(baseURL, suffix) {
  return `${String(baseURL).replace(/\/+$/, '')}/${String(suffix).replace(/^\/+/, '')}`;
}

/**
 * 带超时的 fetch，返回 `{ ok, status, text, error }`，**不抛网络异常**。
 *
 * 之所以不抛：调用方（探测 / 迁移）要区分「端点拒绝」与「网络不可达」，
 * 而不是让一个 ECONNREFUSED 把整批处理打断。
 */
async function request(url, { method = 'GET', apiKey, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(headers || {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctl.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: '', error: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 从 OpenAI 兼容响应里取出正文（choices[0].message.content）。 */
function pickContent(parsed) {
  const ch = parsed && Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  const msg = ch && ch.message ? ch.message : null;
  const content = msg && typeof msg.content === 'string' ? msg.content : null;
  if (content !== null) return content;
  // 少数端点把内容放在 delta / text 里
  const alt = (ch && (ch.text || (ch.delta && ch.delta.content))) || (parsed && parsed.output_text);
  return typeof alt === 'string' ? alt : null;
}

/**
 * 发一次非流式 chat/completions。
 *
 * @param {object} o
 * @param {string} o.baseURL       路由的 API 地址（必需）
 * @param {string} [o.apiKey]      明文密钥（主进程读凭据后传入；不传则以未认证姿态请求）
 * @param {string} o.model         模型 id
 * @param {Array}  o.messages      OpenAI 形状的消息数组
 * @param {number} [o.maxTokens]   输出上限（默认 4096）
 * @param {number} [o.temperature] 默认 0（迁移分析要可复现）
 * @param {boolean}[o.jsonMode]    true 时要求 JSON 对象输出（response_format）
 * @param {object} [o.headers]     额外请求头
 * @param {number} [o.timeoutMs]   默认 120000（分析类请求比探测慢得多）
 * @returns {Promise<{ok:boolean, content?:string, json?:any, status?:number, error?:string, usage?:object, raw?:string}>}
 *   成功时 `content` 是原始文本，`jsonMode` 下额外尝试 `json`（解析失败会给 `jsonError`，不视为失败）。
 */
async function chatOnce({
  baseURL,
  apiKey,
  model,
  messages,
  maxTokens = 4096,
  temperature = 0,
  jsonMode = false,
  headers,
  timeoutMs = 120000,
} = {}) {
  if (typeof baseURL !== 'string' || !/^https?:\/\//.test(baseURL)) {
    return { ok: false, error: 'baseURL 无效（需以 http:// 或 https:// 开头）' };
  }
  if (typeof model !== 'string' || model.length === 0) {
    return { ok: false, error: '缺少模型 id' };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: '缺少 messages' };
  }

  const res = await request(joinUrl(baseURL, 'chat/completions'), {
    method: 'POST',
    apiKey,
    headers,
    timeoutMs,
    body: {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
  });

  if (!res.ok) {
    const detail = (res.text || '').slice(0, 500).replace(/\s+/g, ' ').trim();
    return {
      ok: false,
      status: res.status,
      error: res.error
        ? `网络错误：${res.error}`
        : `HTTP ${res.status}${detail ? ' · ' + detail : ''}`,
      raw: res.text,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return { ok: false, status: res.status, error: '端点返回的不是 JSON', raw: res.text };
  }
  const content = pickContent(parsed);
  if (content === null) {
    return { ok: false, status: res.status, error: '端点响应里找不到正文（choices[0].message.content）', raw: res.text };
  }

  const out = { ok: true, content, usage: parsed.usage, raw: res.text };
  if (jsonMode) {
    out.json = tryParseJson(content);
    if (out.json === undefined) out.jsonError = '模型返回的不是可解析的 JSON';
  }
  return out;
}

/**
 * 尽力从模型输出里抠出 JSON。
 *
 * 之所以要"尽力"：即便声明了 `response_format: json_object`，仍有端点/模型会
 * 裹上 ```json 围栏或加一句前言，直接 JSON.parse 会失败 —— 但那不代表分析失败。
 * 这里依次尝试：整体解析 → 剥围栏 → 取第一个平衡的 `{...}` / `[...]`。
 */
function tryParseJson(text) {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  const attempts = [trimmed];

  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fence) attempts.push(fence[1].trim());

  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace >= 0) {
    const lit = balancedSlice(trimmed, firstBrace);
    if (lit) attempts.push(lit);
  }

  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch { /* 换下一种形状 */ }
  }
  return undefined;
}

/** 从 `start` 处的 `{` / `[` 开始，返回配平到对应闭合符的片段（字符串字面量内的括号不计数）。 */
function balancedSlice(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
        i++;
      }
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

module.exports = {
  joinUrl,
  request,
  chatOnce,
  tryParseJson,
  balancedSlice,
  DEFAULT_TIMEOUT_MS,
};

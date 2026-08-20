// OpenCode Zen 免费模型 UA 重写代理（DSH Desktop 内置模板）。
// 背景：OpenCode Zen 对免费模型 deepseek-v4-flash-free 做客户端识别——
//       请求带 deepseek-harness 的归因 UA 会返回 429 FreeUsageLimitError，
//       UA = opencode/0.1.0 则正常 200。DSH 强制给每个 LLM 请求附加归因 UA 且不允许
//       settings.yaml 覆盖（user-agent 是保留字段），所以这里用本地代理改写 UA。
// 工作方式：监听 127.0.0.1:8790，把请求转发到 https://opencode.ai/zen，
//       仅改写 User-Agent 为 opencode/0.1.0，请求体 / 其它头 / SSE 流原样透传。
// 配套配置：settings.yaml 中 opencode provider 的 baseURL 指向 http://127.0.0.1:8790/v1
//           （模型用 opencode / deepseek-v4-flash-free）。
// 运行：node zen-ua-proxy.mjs [port]  （默认 8790）
import { createServer, request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.argv[2] || process.env.ZEN_UA_PORT || 8790);
const TARGET_HOST = 'opencode.ai';
const TARGET_PATH = '/zen';
const LOG = join(homedir(), '.dsh', 'zen-ua-proxy.log');
const UA = 'opencode/0.1.0';

function log(msg) {
  try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ }
}

const server = createServer((req, res) => {
  const headers = { ...req.headers };
  headers['user-agent'] = UA;          // 关键：改写为 opencode
  headers['host'] = TARGET_HOST;       // 转发目标，避免 host 混淆
  // content-length 由转发库自行处理，不手动覆写
  const upstream = httpsRequest({
    hostname: TARGET_HOST,
    port: 443,
    path: TARGET_PATH + (req.url || '/'),   // 本地 /v1/xxx -> /zen/v1/xxx
    method: req.method,
    headers,
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 200, upRes.headers);
    // SSE 流式逐块透传
    upRes.pipe(res);
  });
  upstream.on('error', (e) => {
    log(`ERR ${e.message}`);
    try { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('zen-ua-proxy upstream error'); } catch { /* ignore */ }
  });
  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening 127.0.0.1:${PORT} -> https://${TARGET_HOST}${TARGET_PATH} (UA=${UA})`);
  console.log(`zen-ua-proxy 127.0.0.1:${PORT} -> ${TARGET_HOST}${TARGET_PATH} (UA=${UA})`);
});

process.on('uncaughtException', (e) => log(`uncaught ${e.message}`));

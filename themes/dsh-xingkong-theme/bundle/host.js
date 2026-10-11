// Nebula Core (星空主题) — host half of the dsh-xingkong-theme bundle.
//
// Half 1 — wallpaper assets. Owns the routes the browser half's CSS references:
//   /xingkong-bg/nebula.jpg         dark nebula wallpaper (body background)
//   /xingkong-bg/nebula.mp4         dark looping nebula video
//   /xingkong-bg/nebula-light.jpg   light dawn-nebula wallpaper
//   /xingkong-bg/nebula-light.mp4   light looping nebula video
// Asset paths resolve relative to this file, so the bundle works from any
// clone location without editing constants. The route contract mirrors the
// verified dsh-kimino-theme host half (ctx.webServer.register / kind:'exact').
//
// Half 2 — model probe service (v1.11.0). The official Models settings page has
// no way to tell which configured models actually answer, nor to read their
// context window / thinking levels (the official README states reasoning levels
// are deliberately not editable). The client half renders a probe panel inside
// the provider card slot and talks to this JSON API:
//
//   GET  /xingkong-model/ping             → { ok, version, backend }
//   POST /xingkong-model/probe/start      → { ok, jobId, mode, total }
//   GET  /xingkong-model/probe/status?id= → { ok, state, finished/total, results, log }
//   POST /xingkong-model/probe/cancel     → { ok }
//
// Probes run HERE, not in the browser: the model endpoints never send CORS
// headers, and the API key never reaches the renderer (official design — the
// key is resolved from the credentials service per operation, with the
// credentials-local file as a fallback). The probing logic itself lives in
// ./probe-core.js (ported from the DSH Desktop app's lib/model-probe.js).
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProbeEngine } from './probe-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, 'assets');

/** Kept in sync with package.json — the client panel compares against it. */
const VERSION = '1.13.0';

const ROUTES = [
  {
    path: '/xingkong-bg/nebula.jpg',
    file: join(assets, 'nebula.jpg'),
    type: 'image/jpeg',
  },
  {
    path: '/xingkong-bg/nebula.mp4',
    file: join(assets, 'nebula-web.mp4'),
    type: 'video/mp4',
  },
  {
    path: '/xingkong-bg/nebula-light.jpg',
    file: join(assets, 'nebula-light.jpg'),
    type: 'image/jpeg',
  },
  {
    path: '/xingkong-bg/nebula-light.mp4',
    file: join(assets, 'nebula-light.mp4'),
    type: 'video/mp4',
  },
];

// ── model probe service ──────────────────────────────────────────────────────

const API_PREFIX = '/xingkong-model';
/** Finished jobs kept in memory; older ones are pruned on each start. */
const MAX_JOBS = 8;
/** Progress lines kept per job. */
const MAX_LOG_LINES = 40;
/** Refuse start bodies larger than this (bytes) — the model list is the bulk. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Write one JSON response. Never logs or echoes anything but the payload. */
function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Read and parse a JSON request body with a hard size cap. */
function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('request body is not valid JSON'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

/**
 * Read one reference from the credentials-local YAML file. This is the
 * fallback path only — the credentials service answers first when mounted.
 * The parser is deliberately conservative: it scans the top-level `refs:`
 * section for a single-line `NAME: value` pair and refuses anything it does
 * not fully recognize, rather than pretending to be a YAML implementation.
 *
 * @param {string} text - the .credentials.yaml contents.
 * @param {string} ref - the reference name to find (e.g. QWEN_API_KEY).
 * @returns {string|undefined}
 */
function readRefFromYaml(text, ref) {
  const lines = text.split(/\r?\n/);
  let inRefs = false;
  for (const line of lines) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true;
      continue;
    }
    if (!inRefs) continue;
    if (/^\S/.test(line)) break; // left the refs section
    const match = /^\s{1,4}([A-Za-z0-9_]+):\s+(\S.*?)\s*$/.exec(line);
    if (match === null || match[1] !== ref) continue;
    let value = match[2];
    if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/**
 * Resolve a credential reference to its plaintext value.
 * Order: the official credentials service (ctx.credentials.resolve) →
 * the credentials-local file under the DSH home. Values never enter the
 * job record, the status payload, or any log line.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {string} ref - the reference name from the provider profile.
 * @returns {Promise<string|undefined>}
 */
async function resolveApiKey(ctx, ref) {
  try {
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined;
    if (credentials !== undefined && typeof credentials.resolve === 'function') {
      const hit = await credentials.resolve(ref);
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value;
    }
  } catch (error) {
    console.warn(`[xingkong-theme] credentials service lookup failed for ${ref}:`, error?.message ?? error);
  }
  try {
    const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim().length > 0
      ? process.env.DSH_HOME.trim()
      : join(homedir(), '.dsh');
    const text = await readFile(join(home, '.credentials.yaml'), 'utf8');
    return readRefFromYaml(text, ref);
  } catch (error) {
    console.warn('[xingkong-theme] could not read the credentials file:', error?.message ?? error);
    return undefined;
  }
}

export default {
  inject: ['webServer'],
  apply(ctx) {
    let registered = 0;
    for (const route of ROUTES) {
      // Tolerate an already-registered /xingkong-bg route (e.g. a second
      // instance of this theme in the same profile): skip instead of
      // failing the whole profile load.
      let dispose;
      try {
        dispose = ctx.webServer.register({
          kind: 'exact',
          path: route.path,
          handler: async (req, res) => {
            try {
              const bytes = await readFile(route.file);
              const total = bytes.length;
              const range = req.headers.range;
              // Range support keeps the looping wallpaper video seekable and
              // lets Chromium stream it without buffering the whole file.
              if (range) {
                const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
                if (m) {
                  let start = m[1] === '' ? undefined : Number(m[1]);
                  let end = m[2] === '' ? undefined : Number(m[2]);
                  if (start === undefined && end !== undefined) {
                    start = Math.max(0, total - end);
                    end = total - 1;
                  } else {
                    start = start ?? 0;
                    end = end === undefined ? total - 1 : Math.min(end, total - 1);
                  }
                  if (start <= end && start < total) {
                    const chunk = bytes.subarray(start, end + 1);
                    res.writeHead(206, {
                      'Content-Type': route.type,
                      'Content-Length': chunk.length,
                      'Content-Range': `bytes ${start}-${end}/${total}`,
                      'Accept-Ranges': 'bytes',
                      'Cache-Control': 'public, max-age=3600',
                    });
                    res.end(chunk);
                    return;
                  }
                }
              }
              res.writeHead(200, {
                'Content-Type': route.type,
                'Content-Length': total,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600',
              });
              res.end(bytes);
            } catch (err) {
              console.error(`[xingkong-theme] asset route failed: ${route.path}`, err);
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('xingkong asset not found');
            }
          },
        });
        registered += 1;
      } catch (e) {
        console.warn(`[xingkong-theme] route ${route.path} already served elsewhere, skipping:`, e?.message ?? e);
        continue;
      }
      ctx.effect(() => dispose);
    }
    console.log(`[xingkong-theme] host half active (${registered}/${ROUTES.length} asset routes registered)`);

    // ── the model probe API ──────────────────────────────────────────────────
    const engine = createProbeEngine({});
    /** jobId → job. Jobs live in memory only; results are UI state, not facts. */
    const jobs = new Map();
    /** provider id → its running job (one at a time per provider). */
    const activeByProvider = new Map();
    let jobSeq = 0;

    /** Drop the oldest finished jobs so the map cannot grow without bound. */
    function pruneJobs() {
      while (jobs.size > MAX_JOBS) {
        let removed = false;
        for (const [id, job] of jobs) {
          if (job.state === 'running') continue;
          jobs.delete(id);
          removed = true;
          break;
        }
        if (!removed) return; // all running — keep them all
      }
    }

    /** Build the status payload shared by the poll endpoint. */
    function statusPayload(job) {
      return {
        ok: true,
        state: job.state,
        mode: job.mode,
        provider: job.provider,
        total: job.total,
        finished: job.results.length > 0 ? job.results.length : job.resultMap.size,
        catalog: job.catalog,
        results: job.results.length > 0 ? job.results : [...job.resultMap.values()],
        log: job.log.slice(-MAX_LOG_LINES),
        error: job.error,
      };
    }

    const apiRoutes = [
      {
        path: `${API_PREFIX}/ping`,
        handler: (req, res) => {
          sendJson(res, 200, { ok: true, version: VERSION, backend: true });
        },
      },
      {
        path: `${API_PREFIX}/probe/start`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'POST only' });
            return;
          }
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
            return;
          }
          const provider = typeof body.provider === 'string' && body.provider.length > 0 ? body.provider : 'unknown';
          const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim().replace(/\/+$/, '') : '';
          const api = typeof body.api === 'string' ? body.api : undefined;
          const mode = body.mode === 'full' ? 'full' : 'alive';
          const models = Array.isArray(body.models)
            ? body.models.filter((m) => typeof m === 'string' && m.length > 0).slice(0, 4000)
            : [];
          if (baseURL.length === 0) {
            sendJson(res, 400, { ok: false, error: 'baseURL is required' });
            return;
          }
          if (models.length === 0) {
            sendJson(res, 400, { ok: false, error: 'no models to probe' });
            return;
          }
          const inlineKey = typeof body.apiKey === 'string' && body.apiKey.length > 0 ? body.apiKey : undefined;
          const keyRef = typeof body.apiKeyEnv === 'string' && body.apiKeyEnv.length > 0 ? body.apiKeyEnv : undefined;
          let apiKey = inlineKey;
          if (apiKey === undefined && keyRef !== undefined) apiKey = await resolveApiKey(ctx, keyRef);
          if (apiKey === undefined) {
            sendJson(res, 400, {
              ok: false,
              error: keyRef === undefined
                ? 'no API key available: the provider profile names no apiKeyEnv and none was supplied'
                : `no API key available: reference ${keyRef} resolves to nothing (store it on the Models page)`,
            });
            return;
          }

          // One active job per provider: starting a new one retires the old.
          const previous = activeByProvider.get(provider);
          if (previous !== undefined && previous.state === 'running') {
            try {
              previous.abort.abort();
            } catch {}
          }

          jobSeq += 1;
          const id = `p-${jobSeq}`;
          const abort = new AbortController();
          const job = {
            id,
            provider,
            mode,
            state: 'running',
            startedAt: Date.now(),
            total: models.length,
            results: [],
            resultMap: new Map(),
            catalog: { loaded: false, count: 0 },
            log: [],
            error: undefined,
            abort,
          };
          jobs.set(id, job);
          activeByProvider.set(provider, job);
          pruneJobs();

          (async () => {
            try {
              const out = await engine.runProbe({
                baseURL,
                api,
                apiKey,
                models,
                mode,
                onProgress: (line, row) => {
                  job.log.push(line);
                  if (job.log.length > MAX_LOG_LINES * 2) job.log.splice(0, job.log.length - MAX_LOG_LINES * 2);
                  if (row !== undefined) job.resultMap.set(row.id, row);
                },
                signal: abort.signal,
              });
              job.results = out.results;
              job.catalog = { loaded: out.catalogLoaded, count: out.catalogSize };
              job.state = 'done';
            } catch (error) {
              if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
                job.state = 'cancelled';
              } else {
                job.state = 'error';
                job.error = String(error?.message ?? error);
              }
            } finally {
              if (activeByProvider.get(provider) === job) activeByProvider.delete(provider);
            }
          })();

          sendJson(res, 200, { ok: true, jobId: id, mode, total: models.length });
        },
      },
      {
        path: `${API_PREFIX}/probe/status`,
        handler: (req, res) => {
          let id;
          try {
            id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? '';
          } catch {
            id = '';
          }
          const job = jobs.get(id);
          if (job === undefined) {
            sendJson(res, 404, { ok: false, error: `unknown probe job: ${id}` });
            return;
          }
          sendJson(res, 200, statusPayload(job));
        },
      },
      {
        path: `${API_PREFIX}/probe/cancel`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'POST only' });
            return;
          }
          let body;
          try {
            body = await readJsonBody(req, 64 * 1024);
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
            return;
          }
          const job = jobs.get(typeof body.id === 'string' ? body.id : '');
          if (job !== undefined && job.state === 'running') {
            try {
              job.abort.abort();
            } catch {}
          }
          sendJson(res, 200, { ok: true });
        },
      },
    ];

    let apiCount = 0;
    for (const route of apiRoutes) {
      let dispose;
      try {
        dispose = ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler });
        apiCount += 1;
      } catch (e) {
        console.warn(`[xingkong-theme] model route ${route.path} already served elsewhere, skipping:`, e?.message ?? e);
        continue;
      }
      ctx.effect(() => dispose);
    }
    console.log(`[xingkong-theme] model probe active (${apiCount}/${apiRoutes.length} routes registered)`);
  },
};

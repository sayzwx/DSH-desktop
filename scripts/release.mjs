#!/usr/bin/env node
/**
 * DSH Desktop GitHub Release 发布工具（Node 实现，天然 UTF-8，彻底避免 PowerShell 中文乱码）。
 *
 * 用法（token 通过环境变量 GH_TOKEN 提供，不落盘、不进日志）：
 *   node scripts/release.mjs create <tag> <title> <bodyFile.md>            # 创建 release（可不带资产）
 *   node scripts/release.mjs update <release_id> <bodyFile.md>             # 更新 release 描述
 *   node scripts/release.mjs upload <release_id> <file>                    # 上传资产
 *   node scripts/release.mjs latest                                        # 查看 latest release 信息
 *
 * 说明：
 *   - <bodyFile.md> 为写好的 Markdown 文件（UTF-8）。body 及所有请求体都由 Node 的
 *     JSON.stringify + Buffer 以 UTF-8 编码发出，GitHub 侧不会再出现 ??? 乱码。
 *   - token 仅存于内存/凭据环境，不写入脚本。
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const REPO = 'sayzwx/DSH-desktop';
const [, , cmd, ...rest] = process.argv;

const TOKEN = process.env.GH_TOKEN || '';
if (!TOKEN) {
  console.error('[release] 需要环境变量 GH_TOKEN（GitHub 个人访问令牌）。');
  process.exit(2);
}
const H = {
  'User-Agent': 'dsh-release-node',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  Authorization: `Bearer ${TOKEN}`,
};

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${(json && json.message) || text || 'unknown'}`);
  }
  return json;
}

function readBody(file) {
  return readFileSync(file, 'utf8');
}

async function main() {
  switch (cmd) {
    case 'create': {
      const [tag, title, bodyFile] = rest;
      if (!tag || !title || !bodyFile) { console.error('用法: release.mjs create <tag> <title> <bodyFile.md>'); process.exit(2); }
      const payload = { tag_name: tag, name: title, body: readBody(bodyFile), draft: false, prerelease: false };
      const r = await api(`https://api.github.com/repos/${REPO}/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      console.log(`已创建 release #${r.id}  ${r.html_url}`);
      console.log(`RELEASE_ID=${r.id}`);
      return r;
    }
    case 'update': {
      const [id, bodyFile] = rest;
      if (!id || !bodyFile) { console.error('用法: release.mjs update <release_id> <bodyFile.md>'); process.exit(2); }
      const payload = { body: readBody(bodyFile) };
      const r = await api(`https://api.github.com/repos/${REPO}/releases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      console.log(`已更新 release #${r.id} body。`);
      return r;
    }
    case 'upload': {
      const [id, file] = rest;
      if (!id || !file) { console.error('用法: release.mjs upload <release_id> <file>'); process.exit(2); }
      const buf = readFileSync(file);
      const name = basename(file);
      const url = `https://uploads.github.com/repos/${REPO}/releases/${id}/assets?name=${encodeURIComponent(name)}`;
      const r = await api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf,
      });
      console.log(`已上传资产 ${r.name}（${(r.size / 1048576).toFixed(1)} MB）`);
      console.log(r.browser_download_url);
      return r;
    }
    case 'list': {
      const r = await api(`https://api.github.com/repos/${REPO}/releases`);
      for (const rel of r) {
        const assets = (rel.assets || []).map((a) => a.name).join(', ') || '（无资产）';
        console.log(`${rel.tag_name}\t${rel.name}\t[${assets}]`);
      }
      return r;
    }
    case 'latest': {
      const r = await api(`https://api.github.com/repos/${REPO}/releases/latest`);
      console.log(`latest: ${r.tag_name} — ${r.name}`);
      console.log(`url: ${r.html_url}`);
      (r.assets || []).forEach((a) => console.log(`  ${a.name}  ${(a.size / 1048576).toFixed(1)} MB  ${a.browser_download_url}`));
      return r;
    }
    default:
      console.error(`未知命令: ${cmd}`);
      console.error('支持: create | update | upload | list | latest');
      process.exit(2);
  }
}

main().catch((e) => { console.error(`[release] 失败: ${e.message}`); process.exit(1); });

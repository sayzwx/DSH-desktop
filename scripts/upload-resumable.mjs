#!/usr/bin/env node
/**
 * GitHub Releases 断点续传上传（resumable upload API）。
 * 200MB 大文件上传易受网络波动影响——此脚本把文件按块分片上传，
 * 单块失败只重试本块（无需整文件重传），显著提速且稳定。
 *
 * 用法（token 走 GH_TOKEN 环境变量，不落盘）：
 *   node scripts/upload-resumable.mjs <release_id> <file> [chunkMB]
 *   chunkMB 默认 50（每块 50MB）
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const REPO = 'sayzwx/DSH-desktop';
const [, , rid, file, chunkMBArg] = process.argv;
const TOKEN = process.env.GH_TOKEN || '';
if (!rid || !file || !TOKEN) {
  console.error('用法: upload-resumable.mjs <release_id> <file> [chunkMB]  （需 GH_TOKEN）');
  process.exit(2);
}
const CHUNK = (Number(chunkMBArg) || 50) * 1048576;
const H = {
  'User-Agent': 'dsh-resumable',
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
};
const buf = readFileSync(file);
const size = buf.length;
const name = basename(file);
const totalMB = (size / 1048576).toFixed(1);
console.log(`分块续传 ${name}（${totalMB} MB，每块 ${CHUNK / 1048576} MB）…`);

// 1) 创建上传会话，拿 upload_id（返回 202 + Location）
const initUrl = `https://uploads.github.com/repos/${REPO}/releases/${rid}/assets?name=${encodeURIComponent(name)}`;
const initRes = await fetch(initUrl, { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' } });
if (initRes.status !== 202) {
  const t = await initRes.text();
  console.error(`初始化失败 HTTP ${initRes.status}: ${(t || '').slice(0, 200)}`);
  process.exit(1);
}
// 若已在传(same upload)，可能返回既有 Location 或冲突；为了简单，允许它报错重试
const location = initRes.headers.get('location');
if (!location) { const t = await initRes.text(); console.error(`未返回 upload location: ${(t || '').slice(0, 200)}`); process.exit(1); }
const uploadUrl = location.startsWith('http') ? location : `https://uploads.github.com${location.startsWith('/') ? '' : '/'}${location}`;
console.log(`上传会话建立，upload_id 就绪。`);

// 2) 分块 PATCH 续传
const chunks = Math.ceil(size / CHUNK);
for (let i = 0; i < chunks; i++) {
  const start = i * CHUNK;
  const end = Math.min(size - 1, start + CHUNK - 1);
  const piece = buf.subarray(start, end + 1);
  const range = `bytes ${start}-${end}/${size}`;
  let okNow = false;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 300000); // 单块 5 分钟
      const res = await fetch(uploadUrl, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/octet-stream', 'Content-Range': range, 'Content-Length': String(piece.length) }, body: piece, signal: ac.signal });
      clearTimeout(timer);
      if (res.status === 200 || res.status === 201) { okNow = true; break; }
      // 422 表示断点续传从某偏移继续（GitHub 在 Content-Range 不连续时返回 416/422 + Range 头），重试应续传
      const t = await res.text().catch(() => '');
      console.log(`  块 ${i + 1}/${chunks} HTTP ${res.status}（第 ${attempt} 次），${(t || '').slice(0, 60)}`);
    } catch (e) {
      console.log(`  块 ${i + 1}/${chunks} 出错（第 ${attempt} 次）: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  if (!okNow) { console.error(`块 ${i + 1}/${chunks} 重试仍失败，中止。`); process.exit(1); }
  console.log(`  块 ${i + 1}/${chunks} ✓（${(start / 1048576).toFixed(0)}MB ~ ${(end / 1048576).toFixed(0)}MB）`);
}
console.log(`✅ 上传完成：${name}（${totalMB} MB）`);
console.log(`   https://github.com/${REPO}/releases/tag/latest`);

/**
 * 实测 · 备用源混合读法（真实网络）
 * ============================================================
 * 回答一个问题：**失去 Gitee 后，商家的一次完整更新能不能拉齐全部文件？**
 *
 * 背景（2026-11-01 实测踩到的配额坑）：
 *   GitHub 匿名 API 配额 60 次/小时。一次更新 72 个文件，
 *   若全走 contents API 必然第 61 个起 403 —— 更新中途失败。
 *   修复后 fetchGitHubFile 按扩展名分流：
 *     .js/.json/.css（65 个）→ jsDelivr CDN（无配额）
 *     .html/.png（7 个）    → contents API（7 次 < 60）
 *
 * 本脚本模拟**商家的真实下载过程**：
 *   ① 读 update-manifest.json（扩展的真实读法）；
 *   ② 逐文件按 fetchGitHubFile 的分流规则拉取（CDN 先行 / API 兜底）；
 *   ③ 逐字节 sha256 对比清单 —— 任何不一致都算失败。
 *
 * API 调用带 Token（工程外 .dyc-github-token，仅本机验证用）——
 * 商家端没有 Token，但配额消耗 7 次/更新，60/小时绰绰有余；
 * 这里带 Token 只是为了让**本机的验证过程**不受本机 IP 已耗尽的匿名配额影响。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/实测-备用源混合读法.js
 * 退出码 0 = 72 文件全部字节一致；1 = 有失败。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TAG = 'v26.11.01.2';
const OWNER = 'Kaorinomikan';
const REPO = 'DY-COCO';

function token() {
  try {
    const t = fs.readFileSync('C:/Develop project/.dyc-github-token', 'utf8').trim();
    return t || null;
  } catch (e) { return null; }
}

const AUTH = token() ? { Authorization: 'Bearer ' + token() } : {};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', ...AUTH }, cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url.slice(0, 90));
  return res.json();
}

/** 与 fetchGitHubFile 相同的分流规则（改这里必须同步改 gitee.js） */
function viaCdn(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  return !(ext === 'html' || ext === 'png' || ext === 'md');
}

async function cdnFetch(path) {
  const url = 'https://fastly.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + TAG + '/' + path;
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!res.ok) throw new Error('CDN HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function apiFetch(path) {
  const d = await fetchJson('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path + '?ref=' + TAG);
  if (d.type !== 'file' || !d.content) throw new Error('API 返回非文件');
  return Buffer.from(d.content, 'base64');
}

async function main() {
  const manifest = JSON.parse(Buffer.from(
    (await apiFetch('update-manifest.json')).toString('utf-8')));
  console.log('清单: version=%s, %d 文件, 算法=%s', manifest.version, manifest.files.length, manifest.algorithm);

  let cdnOk = 0, apiOk = 0, fail = 0;
  const failed = [];
  for (const f of manifest.files) {
    let buf, route;
    if (viaCdn(f.path)) {
      route = 'CDN ';
      try {
        buf = await cdnFetch(f.path);
        // 与扩展端防御一致：CDN 内容 sha256 不符（同名标签重建后的旧缓存）
        // ⇒ 当作 CDN 失败，降级 API。
        if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) {
          buf = null;
        }
      } catch (e) { buf = null; }
      if (!buf) { route = 'CDN→API'; try { buf = await apiFetch(f.path); } catch (e) { buf = null; } }
    } else {
      route = 'API  ';
      try { buf = await apiFetch(f.path); } catch (e) { buf = null; }
    }
    if (!buf) { fail++; failed.push(f.path + '（拉取失败）'); continue; }
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha === f.sha256) { route.startsWith('API') ? apiOk++ : cdnOk++; }
    else { fail++; failed.push(f.path + '（sha256 不一致）'); }
  }

  console.log('\n结果: CDN 直取 %d ✓ / API 取 %d ✓ / 失败 %d', cdnOk, apiOk, fail);
  if (failed.length) {
    console.log('失败明细:');
    for (const s of failed) console.log('  ✗ ' + s);
  } else {
    console.log('★ 72 文件全部逐字节一致 ⇒ 失去 Gitee 后商家更新可完整完成');
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('致命:', e && e.message); process.exit(1); });

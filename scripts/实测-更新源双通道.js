#!/usr/bin/env node
/**
 * 实测 · 更新源双通道降级（真实网络）
 * ============================================================
 *
 * ⚠️ 为什么叫「实测」而不是「自测」：
 *   scripts/run-selftests.py 收录的是 `自测-*.js` / `自测-*.py`，
 *   那个套件的硬约定是**离线、确定性、不访问网络**（见其文件头说明）。
 *   本脚本必须访问真实网络才能证明降级链路真的通，
 *   所以用 `实测-` 前缀把它排除在离线套件之外，单独按需运行。
 *
 * 目的：证明「主源 Gitee 被封 → 备用源 GitHub 自动接管」这条链路真的通。
 *
 * 为什么必须真跑网络：
 *   降级逻辑的价值全在"主源失败时能不能拿到数据"，
 *   mock 掉 fetch 只能证明代码分支存在，证明不了备用源真的可达。
 *   本脚本在 2026-11-01 首次运行时**真的抓出了两个缺陷**：
 *     ① 备用源坐标写死、无法切换到别的仓库；
 *     ② fetchGitHubFile 缺 owner/repo 参数，自测根本没法指向样本仓库。
 *   这两个都是 mock 测不出来的。
 *
 * 本脚本做五件事：
 *   ① 探测主源各通道的真实状态（记录，不作为断言依据 —— 网络会变）；
 *   ② 断言备用源的两档检测都能拿到合法版本标签，且两档结果一致；
 *   ③ 断言 fetchTagList() 能拿到**全量**标签（不是只有最新一条）；
 *   ④ 断言备用源单文件读取的字节与 GitHub API 直读逐字节一致；
 *   ⑤ 断言不存在标签时正确抛错（不静默成功）。
 *
 * ★ 关键：本项目的 GitHub 仓库在首次发布前**不存在**，
 *   所以验证备用源链路必须用一个**确实存在的公开仓库**当样本。
 *   样本选 sindresorhus/slugify：路径浅、文件小、tag 稳定。
 *
 * 用法：
 *   NODE_PATH=C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules \
 *     node scripts/实测-更新源双通道.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

const SAMPLE = {
  owner: 'sindresorhus',
  repo: 'slugify',
  tag: 'v2.0.0',
  path: 'license'
};

let pass = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    failures.push(name);
    console.log('  ✗ ' + name + (extra ? '  —— ' + extra : ''));
  }
}

function section(t) {
  console.log('\n【' + t + '】');
}

/* ============================================================
 * 载入被测模块
 * ============================================================
 * shared/gitee.js 是浏览器脚本（挂 globalThis.DYC_GITEE），
 * 这里用 vm 造一个最小 globalThis 把它跑起来。
 */
function loadModule(fetchImpl) {
  const code = fs.readFileSync(path.join(ROOT, 'src/shared/gitee.js'), 'utf8');
  const sandbox = {
    console,
    fetch: fetchImpl || ((...args) => fetch(...args)),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    Promise,
    Date,
    Math,
    JSON,
    Error,
    crypto: {
      subtle: {
        digest: (algo, data) => crypto.webcrypto.subtle.digest(algo, data)
      }
    }
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: 'gitee.js' });
  if (!sandbox.DYC_GITEE) throw new Error('DYC_GITEE 未挂载');
  return sandbox.DYC_GITEE;
}

/** 载入模块并注入假的 fetch（用于模拟「主源落后于备用源」这类场景） */
function loadModuleWithFetch(fetchImpl) {
  return loadModule(fetchImpl);
}

/** 构造一个最小可用的 Response 替身 */
function fakeResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: '',
    headers: { get: () => null },
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => Buffer.from(text, 'utf8').buffer,
    body: null      // null ⇒ 走整体读取分支（不流式）
  };
}

/* ============================================================
 * 场景
 * ============================================================ */
async function main() {
  const G = loadModule();

  section('一、主源各通道真实状态（记录，不作断言）');
  // 这些状态随时会变（Gitee 也许哪天解封），
  // 所以只打印，不作为"必须 404"的断言 —— 断言主源挂掉是脆弱的。
  const probes = [
    ['Gitee 仓库首页', 'https://gitee.com/lyrical-adagio/DY-COCO'],
    ['Gitee tags.atom', 'https://gitee.com/lyrical-adagio/DY-COCO/tags.atom'],
    ['GitHub API', 'https://api.github.com/repos/' + SAMPLE.owner + '/' + SAMPLE.repo],
    ['jsDelivr 数据 API', 'https://data.jsdelivr.com/v1/packages/gh/' + SAMPLE.owner + '/' + SAMPLE.repo]
  ];
  for (const [name, url] of probes) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      console.log('  · ' + name + ' → HTTP ' + res.status);
    } catch (e) {
      console.log('  · ' + name + ' → 网络不可达（' + (e && e.message) + '）');
    }
  }

  section('二、备用源检测：jsDelivr 档');
  let ghTag = null;
  try {
    ghTag = await G.fetchLatestTagFromGitHub(SAMPLE.owner, SAMPLE.repo);
    ok(typeof ghTag === 'string' && /^v\d+(\.\d+)*$/.test(ghTag),
      '备用源能取到合法版本标签：' + ghTag);
  } catch (e) {
    ok(false, '备用源能取到合法版本标签', (e && e.message) || String(e));
  }

  section('三、备用源检测：GitHub API 档');
  try {
    const t2 = await G.fetchLatestTagFromGitHubApi(SAMPLE.owner, SAMPLE.repo);
    ok(typeof t2 === 'string' && G.isVersionTag(t2),
      'GitHub API 档能取到合法标签：' + t2);
    if (ghTag) {
      ok(G.compareVersion(ghTag, t2) === 0,
        '两档备用源给出同一个最新版本（' + ghTag + ' vs ' + t2 + '）');
    }
  } catch (e) {
    ok(false, 'GitHub API 档能取到合法标签', (e && e.message) || String(e));
  }

  section('四、统一检测：fetchLatestTag（主源挂时应由备用源兜住）');
  // 本项目 GitHub 仓库尚未建立、主源 Gitee 已 404 ——
  // 这正是"必须能降级到备用源"的真实场景。
  // 用样本仓库显式传坐标，验证的正是**降级链本身**：
  // 主源三级全挂 → 备用源接手并返回合法标签。
  let tag = null;
  try {
    tag = await G.fetchLatestTag(SAMPLE.owner, SAMPLE.repo);
    ok(typeof tag === 'string' && G.isVersionTag(tag),
      'fetchLatestTag 经降级链拿到合法标签：' + tag);
  } catch (e) {
    ok(false, 'fetchLatestTag 经降级链拿到合法标签', (e && e.message) || String(e));
  }

  section('四之二、默认坐标下的 fetchLatestTag（本项目 GitHub 仓库尚未建立）');
  // 这一项**故意允许失败**：默认坐标指向本项目的 GitHub 仓库，
  // 该仓库在首次发布前不存在 → 备用源也 404。
  // 仓库建好后本项会自动转绿；现在失败是预期状态，不是回归。
  try {
    const t = await G.fetchLatestTag();
    ok(typeof t === 'string' && G.isVersionTag(t),
      '默认坐标可取到标签：' + t + '（仓库已建立）');
  } catch (e) {
    console.log('  · 默认坐标暂不可用（预期：GitHub 仓库尚未建立）—— ' +
      ((e && e.message) || '').slice(0, 60));
  }

  section('五、统一标签列表：fetchTagList（版本日志面板用）');
  try {
    const list = await G.fetchTagList(SAMPLE.owner, SAMPLE.repo);
    ok(Array.isArray(list) && list.length > 0,
      'fetchTagList 返回非空列表（' + (list ? list.length : 0) + ' 条）');
    if (list && list.length) {
      ok(G.isVersionTag(list[0].tag), '列表首项是合法标签：' + list[0].tag);
      if (list.length > 1) {
        ok(G.compareVersion(list[0].tag, list[1].tag) >= 0,
          '列表按版本降序（' + list[0].tag + ' ≥ ' + list[1].tag + '）');
      }
      ok(list.length > 1,
        '备用源拿到的是**全量**列表而非只有最新一条（' + list.length + ' 条）');
    }
  } catch (e) {
    ok(false, 'fetchTagList 返回非空列表', (e && e.message) || String(e));
  }

  section('六、备用源读单文件：字节级一致性');
  try {
    const res = await fetch(
      'https://api.github.com/repos/' + SAMPLE.owner + '/' + SAMPLE.repo +
      '/contents/' + SAMPLE.path + '?ref=' + SAMPLE.tag, { cache: 'no-store' });
    ok(res.ok, '样例文件可通过 GitHub API 读取（HTTP ' + res.status + '）');
    const json = await res.json();
    ok(json && json.type === 'file' && !!json.content, '返回结构含 base64 内容');

    // 本地再走一次 fetchGitHubFile，两条路径结果必须一致
    const bytes = await G.fetchGitHubFile(SAMPLE.tag, SAMPLE.path, SAMPLE.owner, SAMPLE.repo);
    const viaApi = Buffer.from(json.content, 'base64');
    const viaHelper = Buffer.from(bytes);
    ok(viaApi.length === viaHelper.length,
      '两条路径字节数一致（' + viaApi.length + ' vs ' + viaHelper.length + '）');
    ok(crypto.createHash('sha256').update(viaApi).digest('hex') ===
       crypto.createHash('sha256').update(viaHelper).digest('hex'),
      '两条路径 sha256 一致');
    ok(viaHelper.length > 0 && viaHelper.subarray(0, 3).toString() === 'MIT',
      '内容正确（开头是 MIT License）');
  } catch (e) {
    ok(false, '备用源读单文件', (e && e.message) || String(e));
  }

  section('六之二、★ 双源并行取最大（模拟「Gitee 解封但落后于 GitHub」）');
  // 这是 2026-11-01 修掉的真实缺陷：原实现是「Gitee 成功就停」，
  // 于是 Gitee 解封后（但版本落后于 GitHub）扩展永远看不到 GitHub 上的新版，
  // 商家再也收不到更新，且现象极隐蔽（一直说「已是最新」）。
  //
  // 验证方式：注入一个**假的 fetch**，让主源(Gitee)返回旧版本、
  // 备用源(GitHub)返回新版本，检查最终取到的是**新的那个**。
  {
    const fake = loadModuleWithFetch(async (url) => {
      const u = String(url);
      if (u.includes('gitee.com')) {
        // 主源：只认得旧版本
        return fakeResponse(200, '<entry><title>v26.11.01.1</title></entry>');
      }
      if (u.includes('data.jsdelivr.com')) {
        // 备用源：认得更新版本
        return fakeResponse(200, JSON.stringify({ versions: [{ version: '26.11.01.2' }] }));
      }
      if (u.includes('api.github.com')) {
        return fakeResponse(200, JSON.stringify([{ name: 'v26.11.01.2' }]));
      }
      return fakeResponse(404, '');
    });
    const got = await fake.fetchLatestTag();
    ok(got === 'v26.11.01.2',
      '主源旧版本 + 备用源新版本 → 取到新的（实际 ' + got + '）');
  }
  {
    const fake = loadModuleWithFetch(async (url) => {
      const u = String(url);
      if (u.includes('gitee.com')) {
        return fakeResponse(200, '<entry><title>v26.11.01.9</title></entry>');
      }
      if (u.includes('data.jsdelivr.com')) {
        return fakeResponse(200, JSON.stringify({ versions: [{ version: '26.11.01.2' }] }));
      }
      if (u.includes('api.github.com')) {
        return fakeResponse(200, JSON.stringify([{ name: 'v26.11.01.2' }]));
      }
      return fakeResponse(404, '');
    });
    const got = await fake.fetchLatestTag();
    ok(got === 'v26.11.01.9',
      '主源新版本 + 备用源旧版本 → 取到新的（实际 ' + got + '）');
  }
  {
    // 主源完全挂掉，只能靠备用源
    const fake = loadModuleWithFetch(async (url) => {
      const u = String(url);
      if (u.includes('gitee.com')) return fakeResponse(500, '');
      if (u.includes('data.jsdelivr.com')) {
        return fakeResponse(200, JSON.stringify({ versions: [{ version: '26.11.01.2' }] }));
      }
      if (u.includes('api.github.com')) {
        return fakeResponse(200, JSON.stringify([{ name: 'v26.11.01.2' }]));
      }
      return fakeResponse(404, '');
    });
    const got = await fake.fetchLatestTag();
    ok(got === 'v26.11.01.2', '主源全挂 → 备用源独立兜住（实际 ' + got + '）');
  }
  {
    // 主源挂、备用源也挂 → 必须报错，且错误信息里两边原因都在
    const fake = loadModuleWithFetch(async () => fakeResponse(500, ''));
    let msg = '';
    try {
      await fake.fetchLatestTag();
    } catch (e) { msg = (e && e.message) || ''; }
    ok(msg.includes('Gitee') && msg.includes('GitHub'),
      '两边都挂时报错，且两边原因都在（实际：' + msg.slice(0, 60) + '）');
  }

  section('六之三、★ 主源 404 时仍要问备用源');
  // 场景：Gitee 解封但该版本尚未同步过去 → 主源 raw 404。
  // 原实现把 404 当确定性失败直接抛，恰恰在"两源不同步"时失灵。
  {
    const fake = loadModuleWithFetch(async (url) => {
      const u = String(url);
      if (u.includes('gitee.com')) return fakeResponse(404, '');   // 主源没这个 tag
      if (u.includes('api.github.com')) {
        return fakeResponse(200, JSON.stringify({
          type: 'file', encoding: 'base64',
          content: Buffer.from('hello').toString('base64')
        }));
      }
      return fakeResponse(404, '');
    });
    let bytes = null;
    try {
      bytes = await fake.fetchRawFile('v26.11.01.2', 'x.txt');
    } catch (e) { /* 下面断言 */ }
    ok(bytes && Buffer.from(bytes).toString() === 'hello',
      '主源 404 → 备用源接管并返回内容');
  }
  {
    // 两边都 404 → 必须报确定性错误（noRetry），别让调用方无谓重试
    const fake = loadModuleWithFetch(async () => fakeResponse(404, ''));
    let err = null;
    try {
      await fake.fetchRawFile('v0.0.0-nonexistent', 'x.txt');
    } catch (e) { err = e; }
    ok(!!err, '两边都 404 时报错');
    ok(err && err.noRetry === true, '两边都 404 时标记 noRetry（调用方不重试）');
  }

  section('七、降级语义：主源失败时 fetchRawFile 走备用源');
  // 用一个**主源一定拿不到**的标签（GitHub 上没有这个 tag），
  // 期望：主源 404 → 备用源也 404 → 抛出可读错误，而不是静默失败。
  const fakeTag = 'v0.0.0-nonexistent';
  try {
    await G.fetchRawFile(fakeTag, 'manifest.json', undefined, undefined,
      SAMPLE.owner, SAMPLE.repo);
    ok(false, '不存在的标签应抛错（不应静默成功）');
  } catch (e) {
    ok(true, '不存在的标签正确抛错：' + ((e && e.message) || '').slice(0, 60));
  }

  section('八、版本号比较工具（Gitee/GitHub 共用）');
  ok(G.compareVersion('26.11.01.2', '26.11.01.1') > 0, '26.11.01.2 > 26.11.01.1');
  ok(G.compareVersion('26.10.9.1', '26.10.10.1') < 0,
    '26.10.9.1 < 26.10.10.1（字符串比较会在这里出错）');
  ok(G.versionToTag('26.11.01.2') === 'v26.11.01.2', 'versionToTag 正确');
  ok(G.tagToVersion('v26.11.01.2') === '26.11.01.2', 'tagToVersion 正确');

  section('九、备用源坐标解析');
  const c = G.ghCoord('foo', 'bar');
  ok(c.api === 'https://api.github.com/repos/foo/bar', 'ghCoord 拼 API 地址正确');
  ok(c.jsdelivrData === 'https://data.jsdelivr.com/v1/packages/gh/foo/bar',
    'ghCoord 拼 jsDelivr 地址正确');
  const c2 = G.ghCoord();
  ok(c2.owner === G.GH_OWNER && c2.repo === G.GH_REPO,
    'ghCoord 默认取全局坐标（' + c2.owner + '/' + c2.repo + '）');

  /* ============================================================
   * 汇总
   * ============================================================ */
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.log('自测失败：' + pass + ' 项通过，' + failures.length + ' 项失败：');
    failures.forEach(f => console.log('  · ' + f));
    process.exit(1);
  } else {
    console.log('全部通过：' + pass + ' 项');
  }
}

main().catch(e => {
  console.error('自测脚本异常：', e);
  process.exit(1);
});

'use strict';

/**
 * 更新链路自测（2026-11-06）。
 *
 * 覆盖本轮三处改动：
 *   ① 主源熔断：连续失败后本批不再先试主源（修「78 个文件各自白等一次超时」）；
 *   ② CDN 预热与健康记忆：下载前并行探一次、选中的主机持久记住；
 *   ③ 标签列表全量：主源 API 全量优先、atom 兜底，并与 GitHub 侧取并集。
 *
 * 约束：网络、chrome.storage 全部为内存桩，不访问真实浏览器或网络。
 * 源文件：src/shared/gitee.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const SRC_PATH = path.join(root, 'src/shared/gitee.js');
const giteeSource = fs.readFileSync(SRC_PATH, 'utf8');

const GITEE_RAW = 'https://gitee.com/lyrical-adagio/DY-COCO/raw/';
const GITEE_API_TAGS = 'https://gitee.com/api/v5/repos/lyrical-adagio/DY-COCO/tags';
const GITEE_ATOM = 'https://gitee.com/lyrical-adagio/DY-COCO/tags.atom';
const CDN_FASTLY = 'https://fastly.jsdelivr.net/gh/Kaorinomikan/DY-COCO';
const CDN_GCORE = 'https://gcore.jsdelivr.net/gh/Kaorinomikan/DY-COCO';
const CDN_CDNJS = 'https://cdn.jsdelivr.net/gh/Kaorinomikan/DY-COCO';
const GH_API = 'https://api.github.com/repos/Kaorinomikan/DY-COCO';

/** 内存版 chrome.storage.local（只实现本项目用到的 get/set）。 */
function makeStorage(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  const state = { writes: 0 };
  return {
    data,
    state,
    get(keys) {
      const wanted = Array.isArray(keys) ? keys : [keys];
      const out = {};
      wanted.forEach((k) => { if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = JSON.parse(JSON.stringify(data[k])); });
      return Promise.resolve(out);
    },
    set(patch) {
      state.writes++;
      Object.keys(patch).forEach((k) => { data[k] = JSON.parse(JSON.stringify(patch[k])); });
      return Promise.resolve();
    }
  };
}

function okResponse(body, size) {
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
  return {
    ok: true,
    status: 200,
    url: '',
    text: () => Promise.resolve(String(body)),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  };
}

function statusResponse(status) {
  return {
    ok: false,
    status,
    url: '',
    text: () => Promise.resolve(''),
    json: () => Promise.reject(new Error('not json')),
    arrayBuffer: () => Promise.reject(new Error('HTTP ' + status))
  };
}

/**
 * 建一个隔离的 gitee.js 运行环境。
 * routes: [{match:(url)=>bool, res:()=>响应|抛错}]，按顺序命中第一个。
 */
function makeEnv(routes, storage) {
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(String(url));
    for (const r of routes) {
      if (r.match(String(url))) {
        try { return Promise.resolve(r.res(String(url))); } catch (e) { return Promise.reject(e); }
      }
    }
    return Promise.reject(new Error('未预期的请求：' + url));
  };
  const ctx = {
    console, Promise, Object, Array, String, Number, Boolean, Date, Error, TypeError, JSON, Math,
    isFinite, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout, fetch: fetchImpl, atob, btoa,
    chrome: storage ? { storage: { local: storage } } : undefined
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(giteeSource, ctx, { filename: 'gitee.js' });
  return { G: ctx.DYC_GITEE, calls };
}

const mainHits = (calls) => calls.filter((u) => u.startsWith(GITEE_RAW));
const cdnHits = (calls) => calls.filter((u) => u.startsWith(CDN_FASTLY) || u.startsWith(CDN_GCORE) || u.startsWith(CDN_CDNJS));
const ghApiHits = (calls) => calls.filter((u) => u.startsWith(GH_API + '/contents/'));

/** 主源正常 / 主源 5xx / 备用源（CDN）正常 的标准路由组。 */
function routesMainOk(body) {
  return [{ match: (u) => u.startsWith(GITEE_RAW), res: () => okResponse(body) }];
}
function routesMainDown(body) {
  return [
    { match: (u) => u.startsWith(GITEE_RAW), res: () => statusResponse(500) },
    { match: (u) => u.startsWith(CDN_FASTLY), res: () => okResponse(body) }
  ];
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('通过：' + name);
  } catch (error) {
    failed++;
    console.error('失败：' + name + '：' + (error && error.message || error));
  }
}

/* ---------------- ① 主源熔断 ---------------- */

async function testMainTrip() {
  await test('主源正常时只打主源一次，不碰备用源', async () => {
    const { G, calls } = makeEnv(routesMainOk('hello'));
    const buf = await G.fetchRawFile('v26.11.06.1', 'a.js', 5);
    assert.equal(new Uint8Array(buf).length, 5);
    assert.equal(mainHits(calls).length, 1);
    assert.equal(cdnHits(calls).length, 0, '主源成功时不该碰 CDN');
    assert.equal(G.mainSourceUsable(), true);
  });

  await test('连续 2 次主源失败后熔断，第 3 个文件直接走备用源', async () => {
    const { G, calls } = makeEnv(routesMainDown('abc'));
    await G.fetchRawFile('v26.11.06.1', 'a.js', 3);
    await G.fetchRawFile('v26.11.06.1', 'b.js', 3);
    const afterTwo = mainHits(calls).length;
    assert.equal(afterTwo, 2, '前两次仍应各试一次主源，实得 ' + afterTwo);
    assert.equal(G.mainSourceUsable(), false, '两次失败后应判定主源不可用');

    const before = mainHits(calls).length;
    await G.fetchRawFile('v26.11.06.1', 'c.js', 3);
    assert.equal(mainHits(calls).length, before, '熔断期内不应再打主源');
    assert.equal(new Uint8Array(await G.fetchRawFile('v26.11.06.1', 'd.js', 3)).length, 3,
      '熔断期内仍应能从备用源取到内容');
  });

  await test('主源恢复一次即解除熔断', async () => {
    const { G } = makeEnv(routesMainDown('abc'));
    await G.fetchRawFile('v26.11.06.1', 'a.js', 3);
    await G.fetchRawFile('v26.11.06.1', 'b.js', 3);
    assert.equal(G.mainSourceUsable(), false);
    G.noteMainSource(true);
    assert.equal(G.mainSourceUsable(), true, '成功一次应清零并解除熔断');
  });

  await test('主源 404（该版本尚未同步）不计入熔断', async () => {
    const routes = [
      { match: (u) => u.startsWith(GITEE_RAW), res: () => statusResponse(404) },
      { match: (u) => u.startsWith(CDN_FASTLY), res: () => okResponse('abc') }
    ];
    const { G, calls } = makeEnv(routes);
    for (const name of ['a.js', 'b.js', 'c.js']) await G.fetchRawFile('v26.11.06.1', name, 3);
    assert.equal(G.mainSourceUsable(), true, '404 是内容缺失，不是主源不可用');
    assert.equal(mainHits(calls).length, 3, '每个文件仍应正常试主源');
  });

  await test('备用源也失败时解除熔断，避免一次误判锁死 30 分钟', async () => {
    // 主源 500、备用源全挂：第一次失败后主源熔断，第二次应「两边都试过」
    const routes = [
      { match: (u) => u.startsWith(GITEE_RAW), res: () => statusResponse(500) },
      { match: (u) => u.startsWith(CDN_FASTLY), res: () => statusResponse(500) },
      { match: (u) => u.startsWith(CDN_GCORE), res: () => statusResponse(500) },
      { match: (u) => u.startsWith(CDN_CDNJS), res: () => statusResponse(500) },
      { match: (u) => u.startsWith(GH_API), res: () => statusResponse(503) }
    ];
    const { G } = makeEnv(routes);
    await assert.rejects(() => G.fetchRawFile('v26.11.06.1', 'a.js', 3));
    await assert.rejects(() => G.fetchRawFile('v26.11.06.1', 'b.js', 3));
    assert.equal(G.mainSourceUsable(), true,
      '两边都挂时不该把主源锁死，重试必须能回到主源');
  });

  await test('熔断状态写入持久存储，重启后仍然生效', async () => {
    const storage = makeStorage();
    const { G } = makeEnv(routesMainDown('abc'), storage);
    await G.fetchRawFile('v26.11.06.1', 'a.js', 3);
    await G.fetchRawFile('v26.11.06.1', 'b.js', 3);
    const saved = storage.data.dycUpdateHealth;
    assert.ok(saved && saved.mainDownUntil > Date.now(), '应把冷却截止时间写进存储');

    // 新环境（模拟浏览器重启）读同一份存储
    const env2 = makeEnv(routesMainDown('abc'), storage);
    await env2.G.loadHealth();
    assert.equal(env2.G.mainSourceUsable(), false, '重启后熔断仍应生效');
    await env2.G.fetchRawFile('v26.11.06.1', 'c.js', 3);
    assert.equal(mainHits(env2.calls).length, 0, '重启后也应直接走备用源');
  });
}

/* ---------------- ② CDN 预热与健康记忆 ---------------- */

async function testWarmUp() {
  await test('预热跳过不可达主机，选中第一台可用的', async () => {
    const routes = [
      { match: (u) => u.startsWith(CDN_FASTLY), res: () => { throw new Error('connect timeout'); } },
      { match: (u) => u.startsWith(CDN_GCORE), res: () => okResponse('{}') }
    ];
    const { G } = makeEnv(routes);
    const idx = await G.warmUpCdn('v26.11.06.1');
    assert.equal(idx, 1, 'fastly 不可达时应用 gcore（序号 1）');
    assert.equal(G.healthSnapshot().cdnIdx, 1);
  });

  await test('预热结果持久化，下次更新直接从可用主机开始', async () => {
    const storage = makeStorage();
    const routes = [
      { match: (u) => u.startsWith(CDN_FASTLY), res: () => { throw new Error('connect timeout'); } },
      { match: (u) => u.startsWith(CDN_GCORE), res: () => okResponse('abc') }
    ];
    const env1 = makeEnv(routes, storage);
    await env1.G.warmUpCdn('v26.11.06.1');
    assert.equal(storage.data.dycUpdateHealth.cdnIdx, 1);

    const env2 = makeEnv(routes, storage);
    await env2.G.fetchGitHubFile('v26.11.06.1', 'src/a.js', null, null, 3);
    const first = cdnHits(env2.calls)[0] || '';
    assert.ok(first.startsWith(CDN_GCORE),
      '重启后应从上次可用的 gcore 开始，实际先打了 ' + (first || '(无)'));
  });

  await test('三台全不可用时返回 -1，交给 API 兜底', async () => {
    const routes = [
      { match: (u) => u.startsWith(CDN_FASTLY), res: () => { throw new Error('down'); } },
      { match: (u) => u.startsWith(CDN_GCORE), res: () => { throw new Error('down'); } },
      { match: (u) => u.startsWith(CDN_CDNJS), res: () => { throw new Error('down'); } }
    ];
    const { G } = makeEnv(routes);
    assert.equal(await G.warmUpCdn('v26.11.06.1'), -1);
  });

  await test('预热只探一次：并发调用复用同一个探测', async () => {
    const routes = [{ match: (u) => u.startsWith(CDN_FASTLY), res: () => okResponse('{}') }];
    const { G, calls } = makeEnv(routes);
    await Promise.all([G.warmUpCdn('v26.11.06.1'), G.warmUpCdn('v26.11.06.1'), G.warmUpCdn('v26.11.06.1')]);
    assert.equal(cdnHits(calls).length, 3, '三台各探一次，不应因并发叠成 9 次');
  });

  await test('CDN 全挂时读完自动降级 contents API', async () => {
    const routes = [
      { match: (u) => u.startsWith(CDN_FASTLY), res: () => { throw new Error('down'); } },
      { match: (u) => u.startsWith(CDN_GCORE), res: () => { throw new Error('down'); } },
      { match: (u) => u.startsWith(CDN_CDNJS), res: () => { throw new Error('down'); } },
      {
        match: (u) => u.startsWith(GH_API + '/contents/'),
        res: () => okResponse(JSON.stringify({ type: 'file', content: Buffer.from('abc').toString('base64') }))
      }
    ];
    const { G } = makeEnv(routes);
    const buf = await G.fetchGitHubFile('v26.11.06.1', 'src/a.js', null, null, 3);
    assert.equal(new Uint8Array(buf).length, 3);
  });
}

/* ---------------- ③ 标签列表全量 ---------------- */

function tagsJson(list) {
  return JSON.stringify(list.map((t) => ({
    name: t.tag,
    commit: { date: t.date || '2026-11-01T00:00:00Z' },
    tagger: { date: t.date || '2026-11-01T00:00:00Z' }
  })));
}

function makeTags(n, prefix) {
  const out = [];
  for (let i = n; i >= 1; i--) out.push({ tag: 'v26.11.' + (prefix || '01') + '.' + i, date: '2026-11-0' + ((i % 9) + 1) + 'T00:00:00Z' });
  return out;
}

async function testTagList() {
  const giteeTags = makeTags(30, '01');          // Gitee 全量
  const ghOnly = [{ tag: 'v26.11.02.1' }, { tag: 'v26.11.02.2' }]; // 只在 GitHub 有
  const ghTags = giteeTags.slice(0, 5).concat(ghOnly);

  function routes(opts = {}) {
    return [
      {
        match: (u) => u.startsWith(GITEE_API_TAGS),
        res: () => (opts.giteeApiFail ? statusResponse(opts.giteeApiFail) : okResponse(tagsJson(giteeTags)))
      },
      { match: (u) => u.startsWith(GITEE_ATOM), res: () => okResponse(opts.atomXml || '') },
      {
        match: (u) => u.includes('data.jsdelivr.com'),
        res: () => okResponse(JSON.stringify({ versions: ghTags.map((t) => ({ version: t.tag.replace(/^v/, '') })) }))
      },
      { match: (u) => u.startsWith(GH_API + '/tags'), res: () => okResponse(JSON.stringify(ghTags.map((t) => ({ name: t.tag })))) }
    ];
  }

  await test('主源 API 拿到全量，不再被 atom 的 10 条上限截断', async () => {
    const { G } = makeEnv(routes());
    const list = await G.fetchTagList();
    const giteeOnly = list.filter((e) => e.tag.startsWith('v26.11.01.'));
    assert.equal(giteeOnly.length, 30, 'Gitee 侧 30 个版本都应出现，实得 ' + giteeOnly.length);
    assert.ok(list.length >= 30);
  });

  await test('两个源的标签取并集：各自独有的版本都在', async () => {
    const { G } = makeEnv(routes());
    const list = await G.fetchTagList();
    const set = new Set(list.map((e) => e.tag));
    ghOnly.forEach((t) => assert.ok(set.has(t.tag), 'GitHub 独有的 ' + t.tag + ' 应出现'));
    assert.ok(set.has('v26.11.01.1'), 'Gitee 独有的最老版本应出现');
    assert.equal(list.length, 32, '30 + 2 个独有版本 = 32，实得 ' + list.length);
  });

  await test('结果按版本降序，且带日期', async () => {
    const { G } = makeEnv(routes());
    const list = await G.fetchTagList();
    for (let i = 1; i < list.length; i++) {
      assert.ok(G.compareVersion(list[i - 1].tag, list[i].tag) >= 0, '第 ' + i + ' 条顺序不对');
    }
    const giteeRow = list.find((e) => e.tag.startsWith('v26.11.01.'));
    assert.ok(giteeRow && giteeRow.date, 'Gitee 侧条目应带日期');
  });

  await test('主源 API 限流（403）时降级到 atom，功能不中断', async () => {
    const atom = '<feed>' + giteeTags.slice(0, 3).map((t) =>
      '<entry><title>' + t.tag + '</title><update>' + t.date + '</update></entry>').join('') + '</feed>';
    const { G } = makeEnv(routes({ giteeApiFail: 403, atomXml: atom }));
    const list = await G.fetchTagList();
    assert.ok(list.length >= 3, '降级后仍应拿到 atom 的条目');
    assert.ok(new Set(list.map((e) => e.tag)).has(giteeTags[0].tag));
  });
}

(async () => {
  await testMainTrip();
  await testWarmUp();
  await testTagList();
  console.log('\n更新链路自测：' + passed + '/' + (passed + failed) + ' 通过');
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

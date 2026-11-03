'use strict';

/**
 * 更新日志（#129）自测。
 *
 * 覆盖两处缺陷：
 *   ① 首次注入面板后没补发 mode ⇒ 点「更新日志」落在「反馈」Tab；
 *   ② 版本窗口被「≥ 本地版」过滤收窄 ⇒ 只剩 1 张卡片。
 *
 * 约束：只抽取真实源码中的函数；chrome.storage、tabs、scripting、网络全部为内存桩，
 * 不访问真实浏览器或网络。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const swSource = fs.readFileSync(path.join(root, 'src/background/service-worker.js'), 'utf8');

function extractFunction(source, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = re.exec(source);
  if (!match) throw new Error('找不到函数：' + name);
  const start = match.index;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    const n = source[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数边界不完整：' + name);
}

/**
 * 按「函数签名 → 下一个函数签名」切片。
 * clParseNotes 里有 `.replace(/`/g, '')` —— 反引号出现在**正则字面量**里，
 * 上面的花括号扫描器会把它当成模板字符串起点，永远走不到函数结尾。
 * 这类函数用标记切片，不去猜正则语法。
 */
function extractByMarkers(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error('找不到片段起点：' + startMarker);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error('找不到片段终点：' + endMarker);
  return source.slice(start, end);
}

function makeStorage(initial = {}) {
  const data = structuredClone(initial);
  const state = { failSet: 0, writes: 0 };
  return {
    data,
    state,
    failNextSet(count = 1) { state.failSet += count; },
    get(keys) {
      const wanted = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || data));
      const result = {};
      wanted.forEach((key) => { if (Object.hasOwn(data, key)) result[key] = structuredClone(data[key]); });
      return Promise.resolve(result);
    },
    set(patch) {
      state.writes++;
      if (state.failSet > 0) {
        state.failSet--;
        return Promise.reject(new Error('模拟 storage 写入失败'));
      }
      Object.keys(patch).forEach((key) => { data[key] = structuredClone(patch[key]); });
      return Promise.resolve();
    }
  };
}

/** 造 n 个版本标签（v26.11.03.n，n 越大越新），返回按版本降序。 */
function makeTags(n) {
  const out = [];
  for (let i = n; i >= 1; i--) out.push({ tag: 'v26.11.03.' + i, date: '2026-11-03T00:00:0' + (i % 10) + 'Z' });
  return out;
}

function notesText(summary) {
  return '**本版一句话**：' + summary + '\n\n## 改动\n- 要点一\n- 要点二\n';
}

const CL_VARS = [
  'var CL_CACHE_TTL = 5 * 60 * 1000;',
  'var clCache = { at: 0, data: null };',
  'var CL_LIST_SIZE = 10;',
  'var CL_MAX_ITEMS = 10;',
  'var CL_NOTES_STORE = "dycChangelogNotes";',
  'var CL_NOTES_SCHEMA = 1;',
  'var CL_NOTES_KEEP = 30;'
].join('\n');

const CL_FUNCS = [
  'clNotesCacheValid', 'clReadNotesCache', 'clWriteNotesCache', 'clTrimNotesCache',
  'clDecodeUtf8', 'clPool', 'clFetchTags', 'buildChangelog'
].map((name) => extractFunction(swSource, name)).join('\n')
  + '\n' + extractByMarkers(
    swSource, 'function clParseNotes(text)', '\nfunction clDecodeUtf8('
  );

function makeChangelogContext(options = {}) {
  const storage = options.storage || makeStorage();
  const fetchCalls = [];
  const events = [];
  const tags = options.tags || makeTags(24);
  const chrome = {
    runtime: { lastError: null, getManifest: () => ({ version: '26.11.03.1' }) },
    storage: { local: storage }
  };
  const DYC_GITEE = {
    TAGS_PAGE: 'https://github.com/x/y/tags',
    fetchTagList() {
      if (options.tagsFail) return Promise.reject(new Error('读取版本列表失败（HTTP 403）'));
      return Promise.resolve(tags.map((t) => ({ ...t })));
    },
    fetchRawFile(tag) {
      fetchCalls.push(tag);
      const override = options.notes && options.notes[tag];
      if (override instanceof Error) return Promise.reject(override);
      if (override !== undefined) return override;
      return Promise.resolve(new TextEncoder().encode(notesText('说明-' + tag)));
    }
  };
  const ctx = {
    console, Promise, Object, Array, String, Number, Boolean, Date, Error, TypeError, JSON, Math,
    isFinite, Uint8Array, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout, structuredClone,
    chrome, DYC_GITEE
  };
  vm.createContext(ctx);
  vm.runInContext([CL_VARS, CL_FUNCS].join('\n'), ctx, { filename: 'service-worker-changelog.js' });
  return { ctx, storage, fetchCalls, events, tags };
}

function runBuild(ctx, events, fresh = true) {
  return ctx.buildChangelog(!!fresh, (ev) => events.push(ev)).then(() => {
    const done = events.filter((e) => e.type === 'done');
    const error = events.filter((e) => e.type === 'error');
    return { done: done[0] && done[0].data, error: error[0] && error[0].message, events };
  });
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

/* ---------------- ① 首屏落错 Tab ---------------- */

function makeOpenContext() {
  const sent = [];
  const state = { injected: false, tries: 0 };
  const chrome = {
    runtime: { lastError: null, getManifest: () => ({ version: '26.11.03.1' }) },
    tabs: {
      sendMessage(tabId, msg, cb) {
        state.tries++;
        if (!state.injected) {
          chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          cb();
          chrome.runtime.lastError = null;
          return;
        }
        sent.push({ tabId, msg });
        cb({ ok: true });
      }
    },
    scripting: {
      executeScript(spec, cb) {
        state.injected = true;
        state.injectedFiles = spec && spec.files;
        cb([{ result: null }]);
      }
    }
  };
  const ctx = {
    console, Promise, Object, Array, String, Number, Boolean, Date, Error, TypeError, JSON, Math,
    isFinite, setTimeout, clearTimeout, structuredClone,
    chrome,
    listCandidateTabs: () => Promise.resolve([{ id: 7, windowId: 1 }])
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFunction(swSource, 'chromeCb'),
    extractFunction(swSource, 'delayMs'),
    extractFunction(swSource, 'injectPanelScript'),
    extractFunction(swSource, 'nudgeFeedbackPanelMode'),
    extractFunction(swSource, 'openFeedbackPanel')
  ].join('\n'), ctx, { filename: 'service-worker-open.js' });
  return { ctx, sent, state };
}

async function testOpenPanel() {
  await test('首次打开「更新日志」：注入成功后补发 mode=changelog', async () => {
    const { ctx, sent, state } = makeOpenContext();
    const result = await ctx.openFeedbackPanel('changelog');
    assert.equal(result.ok, true);
    assert.equal(state.injected, true, '应走注入路径');
    assert.equal(sent.length, 1, '注入后应恰好补发一次 toggle');
    assert.equal(sent[0].msg.type, 'dyc:fbToggle');
    assert.equal(sent[0].msg.mode, 'changelog');
    assert.equal(sent[0].tabId, 7);
  });

  await test('已注入的面板复用：仍然按 mode 打开且不重复注入', async () => {
    const { ctx, sent, state } = makeOpenContext();
    state.injected = true;
    const result = await ctx.openFeedbackPanel('feedback');
    assert.equal(result.reused, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].msg.mode, 'feedback');
    assert.equal(state.injectedFiles, undefined, '复用路径不应再次注入');
  });
}

/* ---------------- ② 版本数与缓存 ---------------- */

async function testChangelogList() {
  await test('恢复展示最新 10 个版本（不再按本地版过滤）', async () => {
    const { ctx, events, tags } = makeChangelogContext();
    const r = await runBuild(ctx, events);
    assert.ok(r.done, '应有 done 事件：' + r.error);
    assert.equal(r.done.items.length, 10);
    assert.deepEqual(r.done.items.map((it) => it.tag), tags.slice(0, 10).map((t) => t.tag));
    assert.equal(r.done.items[0].tag, 'v26.11.03.24');
    assert.equal(r.done.items[0].notes.items.length, 2);
  });

  await test('标签不足 10 个时全部展示', async () => {
    const { ctx, events } = makeChangelogContext({ tags: makeTags(4) });
    const r = await runBuild(ctx, events);
    assert.equal(r.done.items.length, 4);
  });

  await test('持久缓存命中时不消耗任何拉取配额', async () => {
    const tags = makeTags(24);
    const cache = { schema: 1, tags: {} };
    tags.slice(0, 10).forEach((t) => { cache.tags[t.tag] = { s: '缓存摘要-' + t.tag, i: ['缓存要点'] }; });
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events, fetchCalls } = makeChangelogContext({ storage, tags });
    const r = await runBuild(ctx, events);
    assert.equal(fetchCalls.length, 0, '全部命中缓存不应再请求');
    assert.equal(r.done.items.length, 10);
    assert.equal(r.done.items[0].notes.summary, '缓存摘要-v26.11.03.24');
    assert.equal(r.done.items[0].fromCache, true);
  });

  await test('只拉新增标签，老标签走缓存', async () => {
    const tags = makeTags(24);
    const cache = { schema: 1, tags: {} };
    tags.slice(1, 10).forEach((t) => { cache.tags[t.tag] = { s: '旧-' + t.tag, i: ['旧要点'] }; });
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events, fetchCalls } = makeChangelogContext({ storage, tags });
    const r = await runBuild(ctx, events);
    assert.equal(fetchCalls.length, 1, '只应拉取未缓存的那 1 个');
    assert.deepEqual(fetchCalls, ['v26.11.03.24']);
    assert.equal(r.done.items[0].notes.summary, '说明-v26.11.03.24');
    assert.equal(r.done.items[1].notes.summary, '旧-v26.11.03.23');
  });

  await test('新拉到的解析结果写回持久缓存', async () => {
    const { ctx, events, storage } = makeChangelogContext();
    await runBuild(ctx, events);
    const saved = storage.data.dycChangelogNotes;
    assert.ok(saved && saved.schema === 1, '应写入 schema 标记');
    assert.equal(Object.keys(saved.tags).length, 10);
    assert.equal(saved.tags['v26.11.03.24'].s, '说明-v26.11.03.24');
  });

  await test('单版拉取失败只坏那一张卡，其余照常', async () => {
    const { ctx, events, storage } = makeChangelogContext({
      notes: { 'v26.11.03.22': new Error('GitHub 备用源访问额度用完了（403），请稍后再试') }
    });
    const r = await runBuild(ctx, events);
    assert.ok(r.done, '不应整块失败');
    const bad = r.done.items.find((it) => it.tag === 'v26.11.03.22');
    assert.ok(bad.error, '失败的那版应带 error 说明');
    assert.match(bad.error, /403/);
    assert.equal(r.done.items.filter((it) => it.notes).length, 9);
    const saved = storage.data.dycChangelogNotes || { tags: {} };
    assert.equal(Object.hasOwn(saved.tags, 'v26.11.03.22'), false, '失败结果不写缓存');
  });

  await test('缓存写入失败不影响本次展示', async () => {
    const storage = makeStorage();
    storage.failNextSet();
    const { ctx, events } = makeChangelogContext({ storage });
    const r = await runBuild(ctx, events);
    assert.ok(r.done, '写缓存失败不该拖垮展示');
    assert.equal(r.done.items.length, 10);
  });

  await test('缓存结构版本不符时整份作废并重新拉取', async () => {
    const tags = makeTags(24);
    const cache = { schema: 0, tags: { 'v26.11.03.24': { s: '旧口径', i: ['旧'] } } };
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events, fetchCalls } = makeChangelogContext({ storage, tags });
    const r = await runBuild(ctx, events);
    assert.equal(fetchCalls.length, 10);
    assert.equal(r.done.items[0].notes.summary, '说明-v26.11.03.24');
  });

  await test('缓存只保留最新 30 个标签', async () => {
    const tags = makeTags(40);
    const cache = { schema: 1, tags: {} };
    tags.forEach((t) => { cache.tags[t.tag] = { s: '旧-' + t.tag, i: ['旧'] }; });
    delete cache.tags['v26.11.03.40'];   // 留 1 个缺口，触发一次写回
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events } = makeChangelogContext({ storage, tags });
    const r = await runBuild(ctx, events);
    assert.equal(r.done.items.length, 10);
    const after = storage.data.dycChangelogNotes.tags;
    assert.equal(Object.keys(after).length, 30, '应裁剪到 30 个，实得 ' + Object.keys(after).length);
    assert.equal(Object.hasOwn(after, 'v26.11.03.11'), true, '最新 30 个应保留');
    assert.equal(Object.hasOwn(after, 'v26.11.03.10'), false, '更老的标签应被裁掉');
  });

  await test('版本列表整体读取失败时给出错误事件', async () => {
    const { ctx, events } = makeChangelogContext({ tagsFail: true });
    const r = await runBuild(ctx, events);
    assert.equal(r.done, undefined);
    assert.match(String(r.error), /403/);
  });

  await test('5 分钟内复用内存缓存，不再打仓库', async () => {
    const { ctx, events, fetchCalls } = makeChangelogContext();
    await runBuild(ctx, events, true);
    const before = fetchCalls.length;
    await runBuild(ctx, events, false);
    assert.equal(fetchCalls.length, before, '二次打开不应重新拉取');
  });
}

(async () => {
  await testOpenPanel();
  await testChangelogList();
  console.log('\n更新日志自测：' + passed + '/' + (passed + failed) + ' 通过');
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

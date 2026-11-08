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

/**
 * 从源码里原样取出 `var XXX = ...;` 这一行。
 * 为什么不在自测里重写一遍常量：写死数值的话，改源码常量就红一次、
 * 改自测又红一次，等于用自测反向锁死了实现细节。这里只保证「用同一份」。
 */
function extractVar(source, name) {
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;');
  const m = re.exec(source);
  if (!m) throw new Error('找不到变量：' + name);
  return m[0];
}

const CL_VARS = [
  'CL_CACHE_TTL', 'clCache', 'CL_MAX_ITEMS', 'CL_PAGE_SIZE',
  'CL_NOTES_STORE', 'CL_NOTES_SCHEMA', 'CL_NOTES_KEEP', 'CL_FILL_CONCURRENCY'
].map((name) => extractVar(swSource, name)).join('\n');

// 自测里要按实际配置判断，而不是猜一个数字
const CL_SCHEMA = Number(/=\s*(\d+)/.exec(extractVar(swSource, 'CL_NOTES_SCHEMA'))[1]);
const CL_KEEP = Number(/=\s*(\d+)/.exec(extractVar(swSource, 'CL_NOTES_KEEP'))[1]);
const CL_PAGE = Number(/=\s*(\d+)/.exec(extractVar(swSource, 'CL_PAGE_SIZE'))[1]);

const CL_FUNCS = [
  'clNotesCacheValid', 'clReadNotesCache', 'clWriteNotesCache', 'clTrimNotesCache',
  'clMakeJob', 'clFetchInto',
  'clItemFromCache', 'clDecodeUtf8', 'clPool', 'clFetchTags', 'buildChangelog'
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
  return ctx.buildChangelog(!!fresh, (ev) => events.push(ev)).then((job) => {
    const done = events.filter((e) => e.type === 'done');
    const error = events.filter((e) => e.type === 'error');
    return { job, done: done[0] && done[0].data, error: error[0] && error[0].message, events };
  });
}

/**
 * 把 done 快照 + 全部 patch 归约成「最终落定」的列表。
 * done 是首屏快照（未缓存的还是 loading），所以断言最终内容必须走这里 ——
 * 直接断言 done.items 会得到「读取中」，那是首屏状态而不是结果。
 */
function finalItems(events) {
  const done = events.find((e) => e.type === 'done');
  if (!done) return [];
  const map = new Map(done.data.items.map((it) => [it.tag, Object.assign({}, it)]));
  events.filter((e) => e.type === 'patch').forEach((p) => {
    const prev = map.get(p.tag) || { tag: p.tag };
    map.set(p.tag, Object.assign({}, prev, {
      notes: p.notes || null,
      loading: false,
      error: p.error || '',
      missing: !!p.missing
    }));
  });
  return Array.from(map.values());
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
  await test('全量展示所有历史版本（不再按条数截断）', async () => {
    const { ctx, events, tags } = makeChangelogContext();
    const r = await runBuild(ctx, events);
    assert.ok(r.done, '应有 done 事件：' + r.error);
    assert.equal(r.done.items.length, tags.length, '标签有多少就该展示多少');
    assert.equal(r.done.items[0].tag, tags[0].tag);
    assert.equal(r.done.items[r.done.items.length - 1].tag, tags[tags.length - 1].tag);
  });

  await test('标签很少时全部展示', async () => {
    const { ctx, events, tags } = makeChangelogContext({ tags: makeTags(4) });
    const r = await runBuild(ctx, events);
    assert.equal(r.done.items.length, tags.length);
  });

  await test('done 事件先出：未缓存的版本带 loading 占位', async () => {
    const { ctx, events } = makeChangelogContext();
    await runBuild(ctx, events);
    const doneAt = events.findIndex((e) => e.type === 'done');
    const firstPatch = events.findIndex((e) => e.type === 'patch');
    assert.ok(doneAt >= 0, '应有 done');
    assert.ok(firstPatch > doneAt, 'done 必须先于任何 patch（首屏不能等全量读完）');
    const loading = events[doneAt].data.items.filter((it) => it.loading);
    assert.ok(loading.length > 0, '首屏应有读取中的占位');
  });

  await test('首屏只按批补发 patch（#132:一次只展开 5 个）', async () => {
    const { ctx, events, tags } = makeChangelogContext();
    await runBuild(ctx, events);
    const patches = events.filter((e) => e.type === 'patch');
    assert.equal(patches.length, Math.min(CL_PAGE, tags.length),
      '首屏只应补发第一批(' + CL_PAGE + '个)的结果回执,其余等滑到底再要');
    assert.equal(events[events.length - 1].type, 'complete', 'complete 必须是最后一个事件');
    assert.equal(events.find((e) => e.type === 'done').data.pageSize, CL_PAGE,
      'done 应带分页步长,前端按它展开');
  });

  await test('滑到底后的 more 请求按需拉取(clFetchInto 响应 cmd:more)', async () => {
    const { ctx, events, fetchCalls, tags } = makeChangelogContext();
    const { job } = await runBuild(ctx, events);
    const firstCalls = fetchCalls.length;
    const next = tags.slice(CL_PAGE, CL_PAGE + 2).map((t) => t.tag);
    await ctx.clFetchInto(job, next);
    assert.deepEqual(fetchCalls.slice(firstCalls), next, '第二批按请求顺序拉取');
    const patches = events.filter((e) => e.type === 'patch').map((p) => p.tag);
    assert.deepEqual(patches.slice(CL_PAGE), next, '新批次结果以 patch 回执');
  });

  await test('重开命中列表缓存后仍可按需读取下一批', async () => {
    const { ctx, events, fetchCalls, tags } = makeChangelogContext();
    await runBuild(ctx, events);
    const reopened = [];
    const { job } = await runBuild(ctx, reopened, false);
    assert.ok(job, '缓存重开也必须保留按需读取会话');
    assert.equal(fetchCalls.length, CL_PAGE, '重开不提前读取后续版本');
    const next = tags.slice(CL_PAGE, CL_PAGE * 2).map((t) => t.tag);
    await ctx.clFetchInto(job, next);
    assert.deepEqual(fetchCalls.slice(CL_PAGE), next);
    assert.equal(reopened.filter((e) => e.type === 'patch').length, next.length);
  });

  await test('重复请求已拉过的批次不再烧配额', async () => {
    const { ctx, events, fetchCalls, tags } = makeChangelogContext();
    const { job } = await runBuild(ctx, events);
    const firstCalls = fetchCalls.length;
    await ctx.clFetchInto(job, tags.slice(0, CL_PAGE).map((t) => t.tag));
    await ctx.clFetchInto(job, tags.slice(0, CL_PAGE).map((t) => t.tag));
    assert.equal(fetchCalls.length, firstCalls, '首屏批已有结果,不应重复请求');
  });

  await test('缓存命中时不消耗任何拉取配额', async () => {
    const tags = makeTags(24);
    const cache = { schema: CL_SCHEMA, tags: {} };
    tags.forEach((t) => { cache.tags[t.tag] = { s: '缓存摘要-' + t.tag, i: ['缓存要点'] }; });
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events, fetchCalls } = makeChangelogContext({ storage, tags });
    const r = await runBuild(ctx, events);
    assert.equal(fetchCalls.length, 0, '全部命中缓存不应再请求');
    assert.equal(r.done.items.length, tags.length);
    assert.equal(r.done.items[0].notes.summary, '缓存摘要-' + tags[0].tag);
    assert.equal(r.done.items[0].fromCache, true);
  });

  await test('只拉未缓存的标签', async () => {
    const tags = makeTags(24);
    const cache = { schema: CL_SCHEMA, tags: {} };
    tags.slice(1).forEach((t) => { cache.tags[t.tag] = { s: '旧-' + t.tag, i: ['旧要点'] }; });
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events, fetchCalls } = makeChangelogContext({ storage, tags });
    await runBuild(ctx, events);
    assert.deepEqual(fetchCalls, [tags[0].tag], '只应拉取未缓存的那 1 个');
  });

  await test('新拉到的解析结果写回持久缓存', async () => {
    const { ctx, events, storage, tags } = makeChangelogContext();
    await runBuild(ctx, events);
    const saved = storage.data.dycChangelogNotes;
    assert.ok(saved && saved.schema === CL_SCHEMA, '应写入 schema 标记');
    assert.equal(Object.keys(saved.tags).length, Math.min(CL_PAGE, tags.length),
      '只写首屏拉到的那批(#132)');
    assert.equal(saved.tags[tags[0].tag].s, '说明-' + tags[0].tag);
  });

  await test('单版拉取失败只坏那一张卡，其余照常', async () => {
    const tags = makeTags(24);
    const bad = tags[1].tag;                        // 首屏第一批内
    const { ctx, events, storage } = makeChangelogContext({
      notes: { [bad]: new Error('GitHub 备用源访问额度用完了（403），请稍后再试') }
    });
    const r = await runBuild(ctx, events);
    assert.ok(r.done, '不应整块失败');
    const rows = finalItems(events);
    const row = rows.find((it) => it.tag === bad);
    assert.ok(row.error, '失败的那版应带 error 说明');
    assert.match(row.error, /403/);
    assert.equal(rows.filter((it) => it.notes).length, Math.min(CL_PAGE, tags.length) - 1,
      '首屏批里除失败的都应拿到日志');
    const saved = storage.data.dycChangelogNotes || { tags: {} };
    assert.equal(Object.hasOwn(saved.tags, bad), false, '临时失败不写缓存，下次要重试');
  });

  await test('两个源都确认没有日志时标为缺失，且写入缓存不再重问', async () => {
    const tags = makeTags(6);
    const gone = tags[2].tag;
    const err = new Error('GitHub 备用源里没有这个文件（RELEASE_NOTES.md）');
    err.noRetry = true;
    const { ctx, events, storage, fetchCalls } = makeChangelogContext({ tags, notes: { [gone]: err } });
    const r = await runBuild(ctx, events);
    const row = finalItems(events).find((it) => it.tag === gone);
    assert.equal(row.missing, true, '确定性缺失应标 missing');
    assert.ok(!row.error, 'missing 不应混成拉取失败');
    const saved = storage.data.dycChangelogNotes.tags[gone];
    assert.ok(saved && saved.m === 1, '缺失也要写缓存');

    const before = fetchCalls.length;
    await runBuild(ctx, events, true);
    assert.equal(fetchCalls.length, before, '已知缺失的版本不应再次请求');
  });

  await test('缓存写入失败不影响本次展示', async () => {
    const storage = makeStorage();
    storage.failNextSet();
    const { ctx, events, tags } = makeChangelogContext({ storage });
    const r = await runBuild(ctx, events);
    assert.ok(r.done, '写缓存失败不该拖垮展示');
    assert.equal(r.done.items.length, tags.length);
  });

  await test('缓存结构版本不符时整份作废并重新拉取', async () => {
    const tags = makeTags(12);
    const cache = { schema: 0, tags: { [tags[0].tag]: { s: '旧口径', i: ['旧'] } } };
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events, fetchCalls } = makeChangelogContext({ storage, tags });
    const r = await runBuild(ctx, events);
    assert.equal(fetchCalls.length, Math.min(CL_PAGE, tags.length),
      '作废后按新口径只重拉首屏那批(整份作废,旧缓存不认)');
    assert.equal(finalItems(events)[0].notes.summary, '说明-' + tags[0].tag);
  });

  await test('缓存按上限裁剪，保留最新的那些', async () => {
    const total = CL_KEEP + 5;
    const tags = makeTags(total);
    const cache = { schema: CL_SCHEMA, tags: {} };
    tags.forEach((t) => { cache.tags[t.tag] = { s: '旧-' + t.tag, i: ['旧'] }; });
    delete cache.tags[tags[0].tag];   // 留 1 个缺口，触发一次写回
    const storage = makeStorage({ dycChangelogNotes: cache });
    const { ctx, events } = makeChangelogContext({ storage, tags });
    await runBuild(ctx, events);
    const after = storage.data.dycChangelogNotes.tags;
    assert.equal(Object.keys(after).length, CL_KEEP,
      '应裁剪到 ' + CL_KEEP + ' 个，实得 ' + Object.keys(after).length);
    assert.equal(Object.hasOwn(after, tags[0].tag), true, '最新的应保留');
    assert.equal(Object.hasOwn(after, tags[total - 1].tag), false, '更老的应被裁掉');
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

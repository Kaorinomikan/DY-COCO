'use strict';

/**
 * 更新日志渲染自测（2026-11-06）。
 *
 * 覆盖本轮面板侧改动：
 *   ① 四段式事件：done（首屏含读取中占位）→ patch（逐版补全）→ complete；
 *   ② 单版三种落定状态：有日志 / 两源都没有 / 临时拉取失败；
 *   ③ patch 就地更新单卡，不整表重绘（滚动位置与其余卡片不受影响）。
 *
 * 约束：jsdom 内存 DOM，chrome.* 全部为桩，不访问真实浏览器或网络。
 * 源文件：src/feedback/panel.js、src/feedback/feedback.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const root = path.join(__dirname, '..');
const turns = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function makePort() {
  const onMsg = [];
  const onDisc = [];
  return {
    name: 'dyc-changelog',
    fired: [],
    disconnected: false,
    onMessage: { addListener: (f) => onMsg.push(f) },
    onDisconnect: { addListener: (f) => onDisc.push(f) },
    postMessage(msg) { this.fired.push(msg); },
    disconnect() { this.disconnected = true; onDisc.forEach((f) => f()); },
    emit(msg) { onMsg.forEach((f) => f(msg)); }
  };
}

function makeUI(kind) {
  const panel = kind === 'panel';
  const dom = new JSDOM(
    panel
      ? '<!doctype html><html><body></body></html>'
      : fs.readFileSync(path.join(root, 'src/feedback/feedback.html'), 'utf8'),
    { url: 'https://example.test/feedback', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const win = dom.window;
  const ports = [];
  const runtime = {
    lastError: null,
    getManifest: () => ({ version: '26.11.06.1' }),
    onMessage: { addListener() {} },
    sendMessage(msg, cb) { if (cb) cb({ ok: true }); },
    connect() { const p = makePort(); ports.push(p); return p; }
  };
  win.chrome = {
    runtime,
    storage: {
      local: {
        get: (k, cb) => { if (cb) cb({}); return Promise.resolve({}); },
        set: () => Promise.resolve(),
        remove: () => Promise.resolve()
      }
    },
    windows: { getCurrent: (cb) => cb({ id: 1 }) }
  };
  win.eval(fs.readFileSync(
    path.join(root, 'src/feedback/' + (panel ? 'panel.js' : 'feedback.js')), 'utf8'));
  const container = panel ? win.document.getElementById('dyc-fb-host').shadowRoot : win.document;
  const q = (sel) => container.querySelector(sel);
  const all = (sel) => Array.from(container.querySelectorAll(sel));
  return { win, container, q, all, ports };
}

/** 打开更新日志视图，返回当前那条 Port。 */
async function openChangelog(kind) {
  const ui = makeUI(kind);
  if (kind === 'panel') {
    ui.win.__dycFeedbackPanel.open();
    const tab = ui.all('.tab').find((el) => el.getAttribute('data-tab') === 'changelog');
    assert.ok(tab, '应有「更新日志」页签');
    tab.click();
  } else {
    const tab = ui.all('.tab').find((el) => el.getAttribute('data-tab') === 'changelog');
    assert.ok(tab, '应有「更新日志」页签');
    tab.click();
  }
  await turns();
  const port = ui.ports[ui.ports.length - 1];
  assert.ok(port, '应建立 dyc-changelog 连接');
  return { ui, port };
}

function cards(ui) {
  return ui.all('.cl-card');
}

/** 状态行选择器在两套页面上不同（浮层用 data 属性，独立页用 id）。 */
function statusText(ui, kind) {
  const el = ui.q(kind === 'panel' ? '[data-cl-status]' : '#cl-status');
  return el ? el.textContent : '';
}

function cardOf(ui, tag) {
  return ui.all('.cl-card').find((c) => c.getAttribute('data-cl-tag') === tag) || null;
}

/** 首屏夹具(#132 起面板会持有 items 的克隆,但夹具本身仍按用例复制一份,
 *  不让用例之间通过共享对象串味。) */
const firstScreenBase = {
  localVersion: '26.11.06.1',
  webUrl: 'https://github.com/x/y/tags',
  total: 3,
  pending: 2,
  items: [
    { tag: 'v26.11.06.1', date: '2026-11-06T10:00:00Z', notes: { summary: '缓存摘要', items: ['缓存要点'] }, fromCache: true },
    { tag: 'v26.11.05.1', date: '2026-11-05T10:00:00Z', notes: null, loading: true },
    { tag: 'v26.11.04.1', date: '2026-11-04T10:00:00Z', notes: null, loading: true }
  ]
};
function makeFirstScreen() {
  return {
    localVersion: firstScreenBase.localVersion,
    webUrl: firstScreenBase.webUrl,
    total: firstScreenBase.total,
    pending: firstScreenBase.pending,
    pageSize: 5,
    items: firstScreenBase.items.map((it) => Object.assign({}, it))
  };
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

(async () => {
  for (const kind of ['panel', 'feedback']) {
    const label = kind === 'panel' ? '浮层面板' : '独立反馈页';

    await test(label + '：首屏按 done 渲染全部卡片，未缓存的标为读取中', async () => {
      const { ui, port } = await openChangelog(kind);
      port.emit({ type: 'done', data: makeFirstScreen() });
      await turns();
      const list = cards(ui);
      assert.equal(list.length, 3, '应有 3 张卡，实得 ' + list.length);
      assert.equal(cardOf(ui, 'v26.11.06.1').getAttribute('data-cl-state'), 'ok');
      assert.equal(cardOf(ui, 'v26.11.05.1').getAttribute('data-cl-state'), 'loading');
      assert.match(cardOf(ui, 'v26.11.06.1').textContent, /缓存摘要/, '缓存卡应显示摘要');
      assert.match(cardOf(ui, 'v26.11.05.1').textContent, /读取中/);
      ui.win.close();
    });

    await test(label + '：patch 就地补全单卡，其余卡片不受影响', async () => {
      const { ui, port } = await openChangelog(kind);
      port.emit({ type: 'done', data: makeFirstScreen() });
      await turns();
      const untouchedBefore = cardOf(ui, 'v26.11.06.1');

      port.emit({
        type: 'patch', tag: 'v26.11.05.1',
        notes: { summary: '补全摘要', items: ['补全要点一', '补全要点二'] }
      });
      await turns();

      const fixed = cardOf(ui, 'v26.11.05.1');
      assert.equal(fixed.getAttribute('data-cl-state'), 'ok');
      assert.match(fixed.textContent, /补全摘要/);
      assert.match(fixed.textContent, /补全要点二/);
      assert.equal(cards(ui).length, 3, '补全不应改变卡片数量');
      assert.equal(cardOf(ui, 'v26.11.06.1'), untouchedBefore, '其它卡片应是同一个节点，未被重绘');
      assert.equal(cardOf(ui, 'v26.11.04.1').getAttribute('data-cl-state'), 'loading', '仍在读的卡片保持原状');
      ui.win.close();
    });

    await test(label + '：#132 首屏只展开 5 个，滑到底再展开一批并按批向后台要日志', async () => {
      const { ui, port } = await openChangelog(kind);
      const items = [];
      for (let i = 1; i <= 10; i++) {
        items.push({ tag: 'v26.11.06.' + (11 - i), date: '', notes: { summary: 's' + i, items: [] } });
      }
      port.emit({
        type: 'done',
        data: { localVersion: '26.11.06.1', webUrl: 'x', total: 10, pending: 0, pageSize: 5, items }
      });
      await turns();
      assert.equal(cards(ui).length, 5, '首屏只应展开 5 张卡，实得 ' + cards(ui).length);
      assert.match(statusText(ui, kind), /已展开 5 \/ 共 10/);
      const scroller = kind === 'panel'
        ? ui.q('[data-cl-list]').parentNode
        : ui.q('#cl-list').parentNode;
      scroller.dispatchEvent(new ui.win.Event('scroll'));
      await turns();
      assert.equal(cards(ui).length, 10, '滑到底应再展开一批到 10 张');
      assert.match(statusText(ui, kind), /已展开 10 \/ 共 10/);
      const more = port.fired.filter((m) => m && m.cmd === 'more');
      assert.equal(more.length, 1, '应向后台发一次按批拉取');
      assert.equal(
        JSON.stringify(more[0].tags),
        JSON.stringify(items.slice(5).map((it) => it.tag)),
        '要的应是新展开那批的 tag'
      );
      scroller.dispatchEvent(new ui.win.Event('scroll'));
      await turns();
      assert.equal(port.fired.filter((m) => m && m.cmd === 'more').length, 1,
        '已见底后再滑不应重复请求');
      ui.win.close();
    });

    await test(label + '：两源都没有的版本标为缺失，临时失败标为拉取失败', async () => {
      const { ui, port } = await openChangelog(kind);
      port.emit({ type: 'done', data: makeFirstScreen() });
      await turns();
      port.emit({ type: 'patch', tag: 'v26.11.05.1', missing: true });
      port.emit({ type: 'patch', tag: 'v26.11.04.1', error: '更新源连接超时（30 秒无响应）' });
      await turns();
      assert.equal(cardOf(ui, 'v26.11.05.1').getAttribute('data-cl-state'), 'missing');
      assert.equal(cardOf(ui, 'v26.11.04.1').getAttribute('data-cl-state'), 'error');
      assert.match(cardOf(ui, 'v26.11.04.1').textContent, /超时/);
      ui.win.close();
    });

    await test(label + '：complete 后状态行给出版本账，且 Port 保持连接（#132 滑到底还要按批拉）', async () => {
      const { ui, port } = await openChangelog(kind);
      port.emit({ type: 'done', data: makeFirstScreen() });
      await turns();
      port.emit({ type: 'patch', tag: 'v26.11.05.1', notes: { summary: 'x', items: [] } });
      port.emit({ type: 'patch', tag: 'v26.11.04.1', missing: true });
      await turns();
      port.emit({ type: 'complete' });
      await turns();
      const status = statusText(ui, kind);
      assert.match(status, /3/, '状态行应带总版本数：' + status);
      assert.equal(port.disconnected, false, 'complete 后 Port 应保持连接(#132)');
      ui.win.close();
    });

    await test(label + '：complete 之后迟到的 patch 不会破坏已渲染内容', async () => {
      const { ui, port } = await openChangelog(kind);
      port.emit({ type: 'done', data: makeFirstScreen() });
      await turns();
      port.emit({ type: 'complete' });
      await turns();
      port.emit({ type: 'patch', tag: 'v26.11.05.1', notes: { summary: '迟到', items: [] } });
      await turns();
      assert.equal(cards(ui).length, 3);
      assert.equal(cardOf(ui, 'v26.11.06.1').getAttribute('data-cl-state'), 'ok');
      ui.win.close();
    });

    await test(label + '：整表失败时给出错误与重试按钮', async () => {
      const { ui, port } = await openChangelog(kind);
      port.emit({ type: 'error', message: '读取版本列表失败（HTTP 403）' });
      await turns();
      assert.match(statusText(ui, kind), /403/);
      assert.ok(ui.q('.cl-retry'), '应出现重试入口');
      ui.win.close();
    });
  }

  console.log('\n更新日志渲染自测：' + passed + '/' + (passed + failed) + ' 通过');
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

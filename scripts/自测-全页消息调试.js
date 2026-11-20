/** 按 manifest 实际注入组合运行公共组件，不访问浏览器和网络。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const glob = (s, value) => new RegExp('^' + s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(value);
function matches(pattern, url) {
  const p = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  const u = new URL(url);
  if (!p || (p[1] !== '*' && u.protocol !== p[1] + ':')) return false;
  const host = p[2];
  return (host === '*' || u.hostname === host || (host.startsWith('*.') &&
    (u.hostname === host.slice(2) || u.hostname.endsWith('.' + host.slice(2))))) && glob(p[3], u.pathname + u.search);
}
function injected(url) {
  return manifest.content_scripts.filter(c => c.world !== 'MAIN' &&
    c.matches.some(p => matches(p, url)) && !(c.exclude_matches || []).some(p => matches(p, url)));
}
const baseline = ['src/content/diag.js', 'src/content/dialog.js',
  'src/content/stock-net-probe.js', 'src/content/debug-panel.js'];
const urls = new Set([
  'https://fxg.jinritemai.com/', 'https://buyin.jinritemai.com/',
  'https://compass.jinritemai.com/', 'https://other.jinritemai.com/new/page',
  'https://other.jinritemai.com/ffa/merchant/index',
  'https://anchor.douyin.com/anchor/home', 'https://anchor.douyin.com/anchor/review',
  'https://liveservice.douyin.com/', 'https://store.weixin.qq.com/', 'https://channels.weixin.qq.com/',
]);
for (const cs of manifest.content_scripts.filter(c => c.world !== 'MAIN')) {
  for (const pattern of cs.matches) urls.add(pattern.replace('://*.', '://fxg.').replace(/\*/g, 'test'));
}
const missing = [];
for (const url of urls) {
  const groups = injected(url);
  for (const file of baseline) {
    const count = groups.flatMap(c => c.js || []).filter(p => p === file).length;
    if (count !== 1) missing.push(url + ': ' + file + ' 注入次数=' + count);
  }
  if (!groups.some(c => (c.css || []).includes('src/content/msgbox.css'))) missing.push(url + ': 无消息样式');
}
assert.deepEqual(missing, [], '全部支持页必须且只能有一套消息与调试组件');

async function exercise(url) {
  const errors = [];
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push(e.message)),
  });
  const w = dom.window;
  const listeners = [];
  const fetch = w.fetch = async () => ({ status: 200, clone: () => ({ text: async () => '{"ok":true}' }) });
  // jsdom 不提供扩展 API，模拟后台注入与浏览器同窗口的消息来源。
  w.postMessage = data => queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', { data, source: w })));
  w.chrome = {
    runtime: {
      getManifest: () => manifest, getURL: p => 'chrome-extension://offline/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        if (msg.type === 'dyc:stockProbeMain') w.eval(read('src/content/stock-net-probe-main.js'));
        const r = { ok: true, items: [] };
        if (cb) cb(r);
        return Promise.resolve(r);
      },
    },
    storage: {
      local: {
        get(key, cb) { const r = { dybDebug: false, dybFeatures: {} }; if (cb) cb(r); return Promise.resolve(r); },
        set(value, cb) { if (cb) cb(); return Promise.resolve(); },
      },
      onChanged: { addListener(cb) { listeners.push(cb); } },
    },
  };
  try {
    for (const cs of injected(url)) {
      for (const file of cs.js) {
        if (baseline.includes(file) || file === 'src/content/flags.js' || file === 'src/content/anchor.js') w.eval(read(file));
      }
    }
    await new Promise(resolve => w.setTimeout(resolve, 10));
    const badge = w.document.querySelector('.dyb-badge');
    assert.ok(badge, url + ' 左下角入口');
    assert.ok(w.__dycDiag, url + ' 诊断内核');
    assert.equal(w.__DYC_DIALOG_LOADED__, true, '消息组件完整加载后留下在场标记');
    for (const unsupported of ['https://gitee.com/repo', 'https://api.github.com/repos/test',
      'https://fxg.jinritemai.com.evil.test/', 'https://store.weixin.qq.com@evil.test/', 'chrome://settings']) {
      assert.ok(!w.dycIsSupportedPage(unsupported), '不接受未授权业务页面：' + unsupported);
    }
    assert.ok(!w.dybDebugPanel.isOpen(), '调试默认关闭、不自动弹面板');
    badge.click();
    await new Promise(resolve => w.requestAnimationFrame(resolve));
    assert.ok(w.document.querySelector('.dyb-history.is-open'), url + ' 正常态可打开空消息盒子');
    assert.ok(w.DYC_PAGE_PATTERNS.debugTarget.test(url), url + ' 调试开关认本页');
    listeners.forEach(cb => cb({ dybDebug: { newValue: true } }, 'local'));
    assert.ok(badge.classList.contains('dyb-badge--debug'), url + ' 打开调试即时变色');
    assert.ok(!w.dybDebugPanel.isOpen(), '开关开启不自动展开');
    badge.click();
    assert.ok(w.dybDebugPanel.isOpen(), url + ' 点击可打开调试面板');
    const panel = w.document.querySelector('#dyb-debug-panel');
    const sample = (panel.shadowRoot || panel).querySelector('#dyb-debug-netarm');
    assert.ok(sample && sample.style.display !== 'none', url + ' 调试面板可开启接口取样');
    assert.equal(w.fetch, fetch, url + ' 首次取样前不包装页面请求');
    sample.click();
    await new Promise(setImmediate);
    assert.equal(sample.disabled, false, url + ' 探针就绪后按钮恢复');
    await w.fetch('/api/sample', { method: 'POST', body: '{"test":1}' });
    await new Promise(setImmediate);
    assert.match(w.__DYC_STOCK_PROBE__.reportSection(), /POST .*\/api\/sample.*\[200\]/, url + ' 报告包含本次请求');
    listeners.forEach(cb => cb({ dybDebug: { newValue: false } }, 'local'));
    assert.ok(!w.dybDebugPanel.isOpen(), '关闭调试收起面板');
    assert.ok(!badge.classList.contains('dyb-badge--debug'), url + ' 关闭调试恢复普通标记');
    if (url.includes('anchor.douyin.com')) {
      const source = read('src/replay/replay-download.js');
      const start = source.indexOf('  function syncStatusBar(on)');
      const end = source.indexOf('  /* ---------- SPA', start);
      w.eval(source.slice(start, end) + '\nsyncStatusBar(false);');
      assert.equal(w.document.querySelector('.dyb-badge'), badge, '非回放路由也不删除公共入口');
    }
    assert.deepEqual(errors, [], url + ' 无新增组件错误');
  } finally { w.close(); }
}
async function verifyInjection(reuse) {
  const source = read('src/background/service-worker.js');
  const start = source.indexOf('async function injectAssetGroup(');
  const end = source.indexOf('/** 中控台分组入口', start);
  const injectedFiles = [];
  let installed = false;
  const context = vm.createContext({
    chrome: {},
    probeLoaded: async (id, key) => key === '__DYC_DIALOG_LOADED__' ? reuse : installed,
    injectOneLiveFile: async (id, file) => { injectedFiles.push(file); installed = file === 'feature.js'; },
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.injectAssetGroup({ tab: { id: 1 } },
    { js: ['src/content/dialog.js', 'feature.js'] }, '__GROUP__', '测试');
  assert.equal(result.installed, true);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(injectedFiles, reuse ? ['feature.js'] : ['src/content/dialog.js', 'feature.js'],
    'SPA 只复用已经在场的消息组件，缺失时仍正常注入');
}
(async () => {
  for (const url of urls) await exercise(url);
  await verifyInjection(true);
  await verifyInjection(false);
  console.log('全页消息、调试与接口取样：' + urls.size + ' 个支持页面通过');
})().catch(e => { console.error(e); process.exitCode = 1; });

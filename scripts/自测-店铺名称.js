'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/content/shop-header-name.js'), 'utf8');
const fixture = '<style>.index_userName__test{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:115px}</style>'
  + '<div class="index_headerShopName__test"><img alt="头像"><div class="index_shopDetails__test">'
  + '<div class="index_shopTitle__test"><div class="index_userName__test">YIHOUSE女装精品店</div></div>'
  + '<div>企业店 | 正常营业</div></div><button>切换店铺</button></div>'
  + '<div id="unrelated" class="index_userName__test">商品名称</div>';

function setup(host = 'fxg.jinritemai.com') {
  const dom = new JSDOM(fixture, { url: 'https://' + host + '/ffa/g/list', runScripts: 'outside-only' });
  const w = dom.window;
  let resolve;
  let watch;
  w.dycReadFlags = () => new Promise(done => { resolve = done; });
  w.dycWatchFlags = cb => { watch = cb; };
  w.eval(source);
  return { w, resolve, change: flags => watch(flags), dom };
}
const flush = () => new Promise(done => setImmediate(done));

(async () => {
  const a = setup();
  const { w } = a;
  const name = () => w.document.querySelector('[class*="index_shopTitle__"] > div');
  a.resolve({});
  await flush();
  assert.equal(w.getComputedStyle(name()).whiteSpace, 'normal', '缺省开启，解除单行省略');
  assert.equal(w.getComputedStyle(name()).width, 'auto', '解除名称固定宽度');
  assert.equal(w.getComputedStyle(w.document.getElementById('unrelated')).whiteSpace, 'nowrap', '不改同名类的商品节点');
  assert.equal(w.document.querySelector('button').textContent, '切换店铺');
  assert.equal(w.document.querySelector('img').getAttribute('alt'), '头像');
  const replacement = name().cloneNode(true);
  name().replaceWith(replacement);
  assert.equal(w.getComputedStyle(replacement).whiteSpace, 'normal', '平台重建节点仍显示全名');
  a.change({ shopHeaderName: false });
  assert.equal(w.getComputedStyle(name()).whiteSpace, 'nowrap', '关闭即时还原');
  assert.equal(w.getComputedStyle(name()).width, '115px');
  a.change({ shopHeaderName: true });
  a.change({ shopHeaderName: true });
  w.eval(source);
  assert.equal(w.document.querySelectorAll('#dyc-shop-header-name-style').length, 1, '重开与重复注入不叠加');
  assert.equal(w.getComputedStyle(name()).whiteSpace, 'normal');
  const b = setup();
  b.change({ shopHeaderName: false });
  b.resolve({ shopHeaderName: true });
  await flush();
  assert.equal(b.w.document.querySelector('#dyc-shop-header-name-style'), null, '迟到初值不覆盖新设置');
  const c = setup('compass.jinritemai.com');
  assert.equal(c.w.document.querySelector('#dyc-shop-header-name-style'), null, '其它域不处理');

  const metaContext = { window: {}, chrome: { storage: { local: { get() {} }, onChanged: { addListener() {} } } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/content/flags.js'), 'utf8'), metaContext);
  const meta = metaContext.DYC_FLAGS_META.find(m => m.key === 'shopHeaderName');
  assert.equal(meta.default, true);
  assert.equal(meta.group, 'shop');
  assert.ok(meta.pages.every(p => metaContext.DYC_PAGE_PATTERNS[p].test('https://fxg.jinritemai.com/ffa/g/list')));
  assert.ok(meta.pages.every(p => !metaContext.DYC_PAGE_PATTERNS[p].test('https://compass.jinritemai.com/')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const entry = manifest.content_scripts.find(e => e.js.includes('src/content/shop-header-name.js'));
  assert.deepEqual(entry.matches, ['https://fxg.jinritemai.com/*']);
  assert.equal(entry.js[0], 'src/content/flags.js');
  [a, b, c].forEach(s => s.dom.window.close());
  console.log('店铺名称：启停还原、节点替换、范围隔离、初值竞争、注入与默认开关通过');
})().catch(e => { console.error(e); process.exitCode = 1; });

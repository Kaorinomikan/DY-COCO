'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

function fixture(url, options = {}) {
  const errors = [], listeners = [], animations = [], writes = [];
  const dom = new JSDOM(read('src/popup/popup.html'), {
    url: 'https://extension.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push(e.message))
  });
  const w = dom.window, d = w.document;
  const data = { dybLastPlatform: options.last || 'wx', dybFeatures: { goodsImagePaste: false, ...options.features } };
  let tabCallback;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: !!options.reduced });
  w.Element.prototype.animate = function (frames, timing) {
    animations.push({ el: this, frames, timing });
    return { finished: Promise.resolve(), cancel() {} };
  };
  const emit = changes => listeners.forEach(fn => fn(changes, 'local'));
  w.chrome = {
    runtime: { getManifest: () => manifest, getURL: p => 'https://extension.test/' + p,
      sendMessage(msg, cb) {
        if (msg.type === 'dyc:writeFlag') {
          if (options.failWrite) { cb({ ok: false, error: 'storage failed' }); return; }
          const oldValue = data.dybFeatures;
          data.dybFeatures = { ...oldValue, [msg.key]: msg.value };
          emit({ dybFeatures: { oldValue, newValue: data.dybFeatures } });
        }
        if (cb) cb({ ok: true, state: {} });
      }
    },
    storage: { onChanged: { addListener(fn) { listeners.push(fn); } }, local: {
      get(key, cb) { cb({ [key]: data[key] }); },
      set(patch, cb) { writes.push(patch); Object.assign(data, patch); if (cb) cb(); }
    } },
    tabs: { query(query, cb) { if (options.deferTab) tabCallback = cb; else cb([{ id: 1, url }]); }, create() { throw new Error('Switch must not navigate'); } },
    windows: { getAll(query, cb) { cb(options.windows || []); } }
  };
  w.DYC_BACKUP = { list: () => Promise.resolve([]) };
  w.eval(read('src/content/flags.js'));
  w.eval(read('src/popup/popup.js'));
  return { dom, w, d, data, errors, animations, writes, emit, deliverTab: () => tabCallback([{ url }]),
    selected: () => d.querySelector('.platform-option.on').dataset.plat,
    choose(id) { d.querySelector('.platform-option[data-plat="' + id + '"]').click(); },
    close() { dom.window.close(); }
  };
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('通过：' + name); }
(async () => {
  await test('默认收起平台提示区，手动查看后保留返回当前网站入口', async () => {
    const f = fixture('https://store.weixin.qq.com/'); await flush();
    assert.equal(f.d.getElementById('platform-context').hidden, true);
    assert.equal(f.d.getElementById('platform-feedback'), null);
    assert.equal(f.d.getElementById('platform-context-label'), null);
    f.choose('dy');
    assert.equal(f.d.getElementById('platform-context').hidden, false);
    f.d.getElementById('platform-return').click(); await flush();
    assert.equal(f.d.getElementById('platform-context').hidden, true); f.close();
  });
  await test('平台列表、入口与空态使用随扩展打包的图标', async () => {
    const f = fixture('https://www.douyin.com/'); await flush();
    for (const button of f.d.querySelectorAll('.platform-option')) {
      const icon = button.querySelector('.platform-logo img');
      assert(icon, '每个平台都有真实图标');
      assert(fs.existsSync(path.resolve(ROOT, 'src/popup', icon.getAttribute('src'))), '图标已本地打包');
      f.choose(button.dataset.plat);
      assert.equal(f.d.querySelector('#platform-current-logo img').src, icon.src);
      if (!f.d.getElementById('platform-empty').hidden) {
        assert.equal(f.d.querySelector('#platform-empty-logo img').src, icon.src);
      }
    }
    assert.deepEqual(f.errors, []); f.close();
  });
  for (const [url, id] of [
    ['https://qianfan.xiaohongshu.com/', 'xhs'], ['https://ark.xiaohongshu.com/app', 'xhs'],
    ['https://www.xiaohongshu.com/explore', 'xhs'], ['https://xiaohongshu.com', 'xhs'],
    ['https://live.kuaishou.com/', 'ks'], ['https://syt.kwaixiaodian.com/zone/home', 'ks'],
    ['https://live.taobao.com/', 'tb'], ['https://www.taobao.com/', 'tb']
  ]) await test('网址优先于历史选择：' + url, async () => {
    const f = fixture(url); await flush(); assert.equal(f.selected(), id); assert.deepEqual(f.errors, []);
    assert.equal(f.w.dycIsSupportedPage(url), false, '预留平台不代表已注入业务功能');
    f.close();
  });
  await test('未知网站沿用存档，仿冒域名不匹配', async () => {
    const f = fixture('https://other.test/', { last: 'tb' }); await flush(); assert.equal(f.selected(), 'tb');
    for (const url of ['https://xiaohongshu.com.evil.test/', 'https://evil.test/xiaohongshu.com/', 'https://notkuaishou.com/', 'https://taobao.com.evil.test/']) assert.equal(f.w.dycDetectPlatform(url), '');
    f.close();
  });
  await test('小红书两分组、快手淘宝空态与未知存档回退', async () => {
    const f = fixture('https://qianfan.xiaohongshu.com/'); await flush();
    assert.equal(f.d.querySelectorAll('#flags-root > :not([hidden])').length, 2);
    f.choose('ks'); assert.equal(f.selected(), 'ks'); assert.equal(f.d.getElementById('platform-empty').hidden, false);
    assert.equal(f.d.querySelectorAll('#flags-root > :not([hidden])').length, 0);
    f.choose('tb'); assert(f.d.getElementById('platform-empty-title').textContent.includes('淘宝'));
    f.w.applyPlatform('broken'); assert.equal(f.selected(), 'dy'); f.close();
  });
  await test('手动切换不写业务开关、不重建功能行与页脚，正文不做透明退场', async () => {
    const f = fixture('https://store.weixin.qq.com/'); await flush();
    const rows = Array.from(f.d.querySelectorAll('[data-flag-row]'));
    const foot = f.d.getElementById('pop-foot');
    f.d.getElementById('platform-trigger').click(); f.choose('dy'); await flush(); f.choose('wx'); await flush();
    assert.deepEqual(Array.from(f.d.querySelectorAll('[data-flag-row]')), rows);
    assert.equal(f.d.getElementById('pop-foot'), foot); assert.equal(f.data.dybFeatures.goodsImagePaste, false);
    assert(f.writes.every(p => !p.dybFeatures));
    assert(!f.animations.some(a => a.el.id === 'flags-root' && a.frames.some(frame => frame.opacity === 0)));
    assert.equal(f.d.getElementById('platform-panel').hidden, true);
    assert.equal(f.d.getElementById('platform-feedback'), null); f.close();
  });
  await test('手动查看可返回当前网站，下次打开仍按网站', async () => {
    const f = fixture('https://qianfan.xiaohongshu.com/'); await flush(); f.choose('wx');
    assert.equal(f.d.getElementById('platform-return').hidden, false); f.d.getElementById('platform-return').click();
    assert.equal(f.selected(), 'xhs'); f.choose('tb');
    const next = fixture('https://qianfan.xiaohongshu.com/', { last: f.data.dybLastPlatform }); await flush();
    assert.equal(next.selected(), 'xhs'); f.close(); next.close();
  });
  await test('点当前平台不重复写存档，切换无额外结果提示', async () => {
    const f = fixture('https://store.weixin.qq.com/'); await flush();
    const count = f.writes.length;
    f.choose('wx'); assert.equal(f.writes.length, count);
    f.choose('tb'); assert.equal(f.data.dybLastPlatform, 'tb');
    assert.equal(f.d.getElementById('platform-current-name').textContent, '淘宝');
    assert.equal(f.d.getElementById('platform-feedback'), null); f.close();
  });
  await test('移除菜单开关，旧存档关闭值不影响平台菜单', async () => {
    const f = fixture('https://store.weixin.qq.com/', { last: 'dy', features: { multiPlatformMenu: false } });
    await flush(); assert.equal(f.selected(), 'wx');
    assert.equal(f.d.querySelector('[data-flag-row="multiPlatformMenu"]'), null);
    assert.equal(f.d.getElementById('platform-picker').hidden, false);
    f.emit({ dybFeatures: { newValue: { multiPlatformMenu: false } } }); await flush();
    f.choose('xhs'); assert.equal(f.selected(), 'xhs');
    assert.equal(f.d.getElementById('platform-picker').hidden, false); f.close();
  });
  await test('键盘展开、方向移动、Esc与外部点击收起', async () => {
    const f = fixture('https://store.weixin.qq.com/'); await flush();
    const trigger = f.d.getElementById('platform-trigger');
    trigger.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(f.d.activeElement.dataset.plat, 'wx');
    f.d.activeElement.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(f.d.activeElement.dataset.plat, 'xhs');
    f.d.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape' })); await flush();
    assert.equal(f.d.getElementById('platform-panel').hidden, true); assert.equal(f.d.activeElement, trigger);
    trigger.click(); f.d.body.click(); await flush(); assert.equal(f.d.getElementById('platform-panel').hidden, true); f.close();
  });
  await test('减弱动态时切换仍完成，晚到的网站回调不覆盖手动选择', async () => {
    const f = fixture('https://www.xiaohongshu.com/', { reduced: true, deferTab: true }); await flush();
    f.choose('tb'); f.deliverTab(); await flush(); assert.equal(f.selected(), 'tb'); assert.equal(f.animations.length, 0); f.close();
  });
  await test('菜单独立窗口时识别普通浏览器的活动页', async () => {
    const f = fixture('chrome-extension://test/popup.html', { windows: [{ type: 'normal', focused: true, tabs: [{ active: true, url: 'https://qianfan.xiaohongshu.com/' }] }] });
    await flush(); assert.equal(f.selected(), 'xhs'); f.close();
  });
  console.log('多平台菜单自测：' + passed + '/' + passed + ' 通过');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

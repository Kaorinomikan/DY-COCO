'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
const root = path.join(__dirname, '..');
const KEY = 'dycFeedbackDraft';
const turns = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function makeUI(kind, memory = {}, options = {}) {
  const panel = kind === 'panel';
  const dom = new JSDOM(panel ? '<!doctype html><html><body></body></html>' : fs.readFileSync(path.join(root, 'src/feedback/feedback.html'), 'utf8'), {
    url: 'https://example.test/feedback' + (options.search || ''), runScripts: 'outside-only', pretendToBeVisual: true
  });
  const win = dom.window;
  const pending = [];
  const calls = [];
  const submitted = [];
  const captures = [];
  const timers = [];
  const runtime = { lastError: null, getManifest: () => ({ version: '1' }), onMessage: { addListener() {} },
    sendMessage(message, cb) {
      if (message.type === 'dyc:submitFeedback') submitted.push(copy(message.record));
      if (message.type === 'dyc:captureScreenshot') { captures.push(copy(message)); cb({ ok: false, error: '未找到截图来源' }); return; }
      cb({ ok: true });
    } };
  win.chrome = { runtime, storage: { local: {} }, windows: { getCurrent: cb => cb({ id: 99 }) } };
  for (const method of ['get', 'set', 'remove']) {
    win.chrome.storage.local[method] = (value, callback) => { calls.push({ method, value: copy(value) }); pending.push({ method, value: copy(value), callback }); };
  }
  win.setTimeout = (cb, ms) => { timers.push({ cb, ms }); return timers.length; };
  win.clearTimeout = () => {};
  const legacyKey = panel ? 'dyc_fb_draft2' : 'dyc_fb_draft';
  if (options.legacy) win.localStorage.setItem(legacyKey, JSON.stringify(options.legacy));
  win.eval(fs.readFileSync(path.join(root, 'src/feedback/' + (panel ? 'panel.js' : 'feedback.js')), 'utf8'));
  const container = panel ? win.document.getElementById('dyc-fb-host').shadowRoot : win.document;
  const $ = name => panel ? container.querySelector('[data-' + name + ']') : container.getElementById(name);
  async function step(fail) {
    await turns();
    const job = pending.shift();
    assert.ok(job, '应有待处理存储调用');
    let result;
    if (!fail) {
      if (job.method === 'get') result = { [job.value]: copy(memory[job.value]) };
      if (job.method === 'set') Object.assign(memory, copy(job.value));
      if (job.method === 'remove') delete memory[job.value];
    }
    runtime.lastError = fail ? { message: 'QUOTA_BYTES 超限' } : null;
    job.callback(result);
    runtime.lastError = null;
    await turns();
    return job;
  }
  async function drain(failMethod) {
    await turns();
    for (let i = 0; pending.length; i++) {
      assert.ok(i < 100, '存储队列应能结束');
      await step(pending[0].method === failMethod);
    }
  }
  function input(name, text) { $(name).value = text; $(name).dispatchEvent(new win.Event('input', { bubbles: true })); }
  function submit() { $(panel ? 'submit' : 'submit').click(); }
  return { win, memory, $, legacyKey, pending, calls, submitted, captures, timers, step, drain, input, submit, close: () => win.close() };
}

(async function () {
  let checks = 0;
  for (const kind of ['panel', 'feedback']) {
    const legacy = { type: '功能建议', content: '迁移问题描述', contact: '原联系方式', shots: [{ d: 'data:image/png;base64,YQ==', t: 'data:image/jpeg;base64,Yg==' }] };
    {
      const ui = makeUI(kind, { [KEY]: legacy });
      if (kind === 'panel') ui.win.__dycFeedbackPanel.close();
      else ui.win.dispatchEvent(new ui.win.Event('beforeunload'));
      await ui.drain();
      assert.deepEqual(ui.memory[KEY], legacy, '恢复未完成就关闭也不会写入空草稿');
      assert.equal(ui.calls.filter(call => call.method === 'set').length, 0);
      checks += 2; ui.close();
    }
    {
      const ui = makeUI(kind, {}, { legacy });
      await ui.step();
      assert.ok(ui.win.localStorage.getItem(ui.legacyKey), '迁移写入前保留旧草稿');
      assert.equal(ui.pending[0].method, 'set');
      await ui.step();
      assert.equal(ui.win.localStorage.getItem(ui.legacyKey), null, '迁移写成功再删旧草稿');
      assert.deepEqual(ui.memory[KEY], legacy);
      assert.equal(ui.$('content').value, legacy.content);
      assert.equal(ui.$('contact').value, legacy.contact);
      assert.equal(ui.$('thumbs').children.length, 1);
      assert.ok(ui.$('thumbs').querySelector('img').src.includes('YQ=='));
      checks += 8; ui.close();
    }
    {
      const ui = makeUI(kind, {}, { legacy });
      await ui.step(); await ui.step(true);
      assert.ok(ui.win.localStorage.getItem(ui.legacyKey), '迁移失败保留旧草稿');
      assert.equal(ui.memory[KEY], undefined);
      assert.equal(ui.$('content').value, legacy.content, '迁移写失败仍恢复到表单供提交');
      assert.match(ui.$('msg').textContent, /未保存/);
      ui.submit(); await turns();
      assert.equal(ui.submitted.length, 1, '草稿保存失败不阻断反馈提交');
      await ui.drain();
      assert.equal(ui.memory[KEY], undefined);
      checks += 6; ui.close();
    }
    {
      const ui = makeUI(kind, { [KEY]: legacy });
      ui.input('content', '用户刚输入的新描述');
      ui.input('contact', '用户刚填的新联系');
      await ui.step();
      assert.equal(ui.$('content').value, '用户刚输入的新描述', '异步恢复不覆盖描述');
      assert.equal(ui.$('contact').value, '用户刚填的新联系', '异步恢复不覆盖联系');
      assert.equal(ui.pending.length, 1, '同一界面保存严格串行');
      await ui.step();
      assert.equal(ui.memory[KEY].content, '用户刚输入的新描述');
      assert.equal(ui.pending.length, 1);
      await ui.step();
      assert.equal(ui.memory[KEY].contact, '用户刚填的新联系');
      assert.equal(ui.win.localStorage.getItem(ui.legacyKey), null, '新输入未落宿主存储');
      checks += 7; ui.close();
    }
    {
      const ui = makeUI(kind);
      await ui.drain();
      ui.input('content', '第一条待保存的描述');
      await turns();
      ui.input('content', '第二条待保存的描述');
      ui.submit(); await turns();
      assert.equal(ui.submitted.length, 1);
      assert.equal(ui.pending[0].method, 'set', '旧保存已在途');
      await ui.step();
      assert.equal(ui.pending[0].method, 'remove', '过期排队保存跳过，随后删除');
      await ui.step();
      assert.equal(ui.memory[KEY], undefined, '提交成功后旧保存不能回写');
      if (kind === 'panel') ui.win.__dycFeedbackPanel.close();
      else ui.win.dispatchEvent(new ui.win.Event('beforeunload'));
      await turns();
      assert.equal(ui.pending.length, 0, '成功后关闭不重新保存旧表单');
      checks += 5; ui.close();
    }
    {
      const ui = makeUI(kind);
      await ui.drain();
      ui.input('content', '容量失败仍能提交描述');
      await ui.drain('set');
      assert.match(ui.$('msg').textContent, /未保存.*仍可提交/);
      ui.submit(); await turns();
      assert.equal(ui.submitted.length, 1);
      await ui.drain('remove');
      assert.match(ui.$('msg').textContent, /草稿清理失败/);
      const footer = kind === 'panel' ? ui.$('foot') : ui.$('btns');
      assert.notEqual(footer.style.display, 'none', '清理失败提示可见');
      const successTimer = ui.timers.find(timer => timer.ms === (kind === 'panel' ? 1200 : 1800));
      successTimer.cb();
      assert.match(ui.$('msg').textContent, /草稿清理失败/, '成功复位不吞掉清理失败提示');
      checks += 5; ui.close();
    }
    {
      const ui = makeUI(kind, { [KEY]: legacy }, { legacy: { ...legacy, content: '较旧的宿主草稿' } });
      await ui.step(); await ui.step(true);
      assert.ok(ui.win.localStorage.getItem(ui.legacyKey), '清旧键前重新写入失败仍保留旧键');
      assert.equal(ui.$('content').value, legacy.content, '共享草稿优先于旧宿主草稿');
      checks += 2; ui.close();
    }
  }
  {
    const memory = {};
    const panel = makeUI('panel', memory);
    await panel.drain();
    panel.input('content', '跨重启共享的完整描述'); panel.input('contact', '共享联系');
    await panel.drain(); panel.close();
    const feedback = makeUI('feedback', memory);
    await feedback.drain();
    assert.equal(feedback.$('content').value, '跨重启共享的完整描述');
    assert.equal(feedback.$('contact').value, '共享联系');
    feedback.input('content', '小窗写入后浮层也能恢复');
    await feedback.drain(); feedback.close();
    const reopened = makeUI('panel', memory);
    await reopened.drain();
    assert.equal(reopened.$('content').value, '小窗写入后浮层也能恢复');
    reopened.close(); checks += 3;
  }
  for (const search of ['?sourceTabId=12&sourceWindowId=34', '?sourceTabId=-1&sourceWindowId=1.5', '?sourceTabId=9007199254740992&sourceWindowId=', '']) {
    const ui = makeUI('feedback', {}, { search });
    await ui.drain(); ui.$('cap').click();
    assert.equal(ui.captures.length, 1);
    assert.equal(ui.captures[0].hideWindowId, 99, '保留隐藏反馈小窗ID');
    if (search.includes('sourceTabId=12')) {
      assert.equal(ui.captures[0].sourceTabId, 12);
      assert.equal(ui.captures[0].sourceWindowId, 34);
    } else {
      assert.equal('sourceTabId' in ui.captures[0], false, '无效或缺失来源不填默认tab');
      assert.equal('sourceWindowId' in ui.captures[0], false, '无效或缺失来源不填默认窗口');
    }
    checks += 4; ui.close();
  }
  console.log('反馈草稿与截图来源行为自测通过：' + checks + ' 项断言，覆盖两种入口、迁移、重启共享、容量失败、串行顺序、提交清理及来源参数');
})().catch(err => { console.error(err); process.exitCode = 1; });

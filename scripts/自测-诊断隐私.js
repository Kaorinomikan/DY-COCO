'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
const code = fs.readFileSync(path.join(__dirname, '../src/content/diag.js'), 'utf8');
let checks = 0;
for (const name of ['ok', 'equal']) {
  const original = assert[name];
  assert[name] = function () { original.apply(assert, arguments); checks++; };
}

(async function () {
  const dom = new JSDOM('<!doctype html><html><body><button id="normal">普通按钮</button>' +
    '<textarea>输入框秘密</textarea><input value="表单秘密">' +
    '<div contenteditable="true">编辑秘密<span>继承秘密</span><b contenteditable="false">禁编秘密</b></div>' +
    '<div contenteditable><i>空属性秘密</i></div><div contenteditable="plaintext-only"><b>纯文本秘密</b></div>' +
    '<div contenteditable="false">普通文案</div><div contenteditable="true" id="shadow"></div>' +
    '<a href="/path?token=链接秘密#id=锚点秘密">链接</a></body></html>', {
    url: 'https://example.test/page?token=环境秘密#key=环境锚点', runScripts: 'outside-only'
  });
  const win = dom.window;
  win.chrome = { runtime: { getManifest: () => ({ version: '1' }) }, storage: { onChanged: { addListener() {} } } };
  win.document.getElementById('shadow').attachShadow({ mode: 'open' }).innerHTML = '<b>影子秘密</b>';
  win.eval(code);
  const api = win.__dycDiag;
  const structure = await api.domStructure();
  const text = JSON.stringify(structure);
  for (const secret of ['输入框秘密', '表单秘密', '编辑秘密', '继承秘密', '禁编秘密', '空属性秘密', '纯文本秘密', '影子秘密', '链接秘密', '锚点秘密', '环境秘密', '环境锚点']) {
    assert.ok(!text.includes(secret), '结构未泄露：' + secret);
  }
  assert.ok(text.includes('普通按钮') && text.includes('普通文案'), '普通页面短文本保留');
  api.noteError('请求 https://api.test/a?token=消息秘密#id=消息锚点)，随后 https://api.test/b?q=第二秘密。', 'test',
    'Error\n at run (https://api.test/main.js?key=堆栈秘密#key=堆栈锚点:12:3)');
  win.dispatchEvent(new win.ErrorEvent('error', { message: '失败 https://api.test/c?q=事件秘密;', filename: 'https://api.test/a.js?key=文件秘密', lineno: 9 }));
  win.dispatchEvent(new win.CustomEvent('unhandledrejection', { detail: null }));
  const rejection = new win.Event('unhandledrejection');
  rejection.reason = { message: '失败 https://api.test/p?q=拒绝秘密', stack: 'https://api.test/p.js?q=拒绝堆栈:2:1' };
  win.dispatchEvent(rejection);
  for (const [tag, attr] of [['img', 'src'], ['link', 'href']]) {
    const el = win.document.createElement(tag);
    el[attr] = 'https://api.test/' + tag + '?token=资源秘密#id=资源锚点';
    win.document.body.appendChild(el);
    el.dispatchEvent(new win.Event('error'));
  }
  const errors = JSON.stringify(api._dump().errors);
  for (const secret of ['消息秘密', '消息锚点', '第二秘密', '堆栈秘密', '堆栈锚点', '事件秘密', '文件秘密', '拒绝秘密', '拒绝堆栈', '资源秘密', '资源锚点']) {
    assert.ok(!errors.includes(secret), '错误未泄露：' + secret);
  }
  assert.ok(errors.includes('token=***') && errors.includes('#id=***'), '保留参数名并打码');
  assert.ok(errors.includes('#key=***)') && errors.includes(')，随后'), '参数尾部数字一并脱敏，保留尾标点边界：' + errors);
  api.noteError('https://api.test/a?token=123:456)', 'test');
  assert.ok(!api._dump().errors.at(-1).m.includes('123:456'), '数字参数尾部不能误当堆栈行号保留');
  api.noteError('https://api.test/a?token=秘密，内部值。', 'test');
  assert.ok(!api._dump().errors.at(-1).m.includes('内部值'), '参数内的中文标点后内容也必须脱敏');
  assert.ok(api._dump().errors.at(-1).m.endsWith('。'), '句末中文标点保留');
  assert.equal(api._dump().errors.filter(e => e.s === 'resource').length, 2, 'src/href资源错误均已采集');
  const swErrors = [{ t: 1, s: 'sw', m: '后台 https://api.test/a?token=后台秘密#id=后台锚点', k: 'https://api.test/a.js?key=后台堆栈:12:3' }];
  const snap = await api.snapshot({ swErrors });
  const swText = JSON.stringify(snap.swErrors);
  for (const secret of ['后台秘密', '后台锚点', '后台堆栈']) assert.ok(!swText.includes(secret), '后台错误合并时脱敏：' + secret);
  assert.ok(swText.includes('token=***') && swText.includes('#id=***'), '后台错误保留参数名');
  assert.equal(swErrors[0].m.includes('后台秘密'), true, '脱敏不修改传入错误对象');
  const capped = await api.snapshot({ swErrors: Array.from({ length: 25 }, (_, t) => ({ t, m: 'https://api.test/a?q=秘密'.repeat(100) })) });
  assert.equal(capped.swErrors.length, 20, '后台合并错误也有条数上限');
  assert.ok(capped.swErrors.every(err => err.m.length <= 400), '后台消息合并限长');
  win.close();
  console.log('诊断隐私行为自测通过：' + checks + ' 项断言，覆盖输入继承、普通文案、结构网址、错误/堆栈/资源/后台网址与标点边界');
})().catch(err => { console.error(err); process.exitCode = 1; });

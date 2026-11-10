'use strict';

/**
 * 自测 · 面料材质「智能填写」的说明面板(2026-11-10 建)
 *
 * 被测:src/content/fabric-smart-fill.js
 *
 * 用户 2026-11-10 的两句话是本脚本的唯一口径:
 *   ①「告诉用户可以填一些什么东西,就可以智能识别了」
 *      ⇒ 面板要给的是**写法示例**,不是面料名清单;
 *   ②「不需要点一下就预填内容」
 *      ⇒ 面板里不许出现任何可点元素,点哪儿都不能往输入框里塞字。
 * 第②条最容易做歪(顺手加个 onclick 就变成了"点一下预填"),
 * 所以这里既查「面板内没有 button/a/tabindex」,又真的去点示例行、
 * 断言输入框的值一个字符都没变。
 *
 * 另外钉一条:面板里的示例必须**真能解析通过** —— 喂给真实的 run(),
 * 断言它没有报「没看懂 / 没解析出材料 / 配比合计不是 100」。
 * 示例从源码里读,改示例这里就会重新过一遍,不会出现「面板改了、自测还测老示例」。
 *
 * 每条示例单开一个环境:解析通过后 run() 会进入平台交互(慢),
 * 共用环境会被 busy 锁挡住、只能等它跑完 —— 那样一个用例就要 8 秒。
 *
 * 用法：node scripts/自测-面料说明面板.js（run-selftests.py 自动带上）
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_UNDER_TEST = 'src/content/fabric-smart-fill.js';

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function checkSeq(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}

const HTML = `<!doctype html><html><body>
<div id="goodsEditScrollContainer">
  <div class="form-row">
    <div class="label"><span class="req">*</span> 面料材质</div>
    <div class="aurora-dorami-composition-select" role="combobox">
      <div class="composition-selection">
        <div class="composition-select-selection-item">绵羊毛（革） 100%<i class="composition-select-selection-item-remove"></i></div>
      </div>
      <input class="aurora-select-selection-search-input">
      <div class="composition-percent-wrap"><input type="number" class="composition-percent" value="100"></div>
    </div>
  </div>
</div>
</body></html>`;

/** 搭一个独立环境并加载被测脚本 */
async function makeEnv() {
  const dom = new JSDOM(HTML, {
    url: 'https://fxg.jinritemai.com/ffa/g/create?entrance=edit',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  const doc = win.document;

  const flags = { fabricSmartFill: true };
  let watchCb = null;
  win.chrome = { runtime: { id: 'selftest', lastError: null, sendMessage() {} } };
  win.dycReadFlags = () => Promise.resolve(flags);
  win.dycWatchFlags = (cb) => { watchCb = cb; };
  win.isVisible = () => true;
  win.findAllByText = (text) => {
    const out = [];
    const walk = (el) => {
      if (el.nodeType === 3) {
        if (el.nodeValue && el.nodeValue.indexOf(text) >= 0) out.push(el.parentElement);
        return;
      }
      if (el.nodeType !== 1) return;
      for (const c of el.childNodes) walk(c);
    };
    walk(doc.body);
    return out;
  };
  win.debugLog = () => {};
  const messages = [];
  win.setStatus = (value, kind, opts) => messages.push({ value, kind, opts });
  win.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

  win.eval(read(SRC_UNDER_TEST));
  await sleep(60);

  return {
    win, doc, messages,
    setFlags: (f) => { if (watchCb) watchCb(f); },
    box: doc.querySelector('[data-dyc-fabric-box]'),
    input: doc.querySelector('.dyc-fabric-input'),
    btn: doc.querySelector('.dyc-fabric-btn')
  };
}

(async function main() {
  const env = await makeEnv();
  const { win, doc, box, input, btn } = env;
  const guide = () => box.querySelector('.dyc-fabric-guide');

  console.log('\n【一】面板存在与内容');
  check('自建框里挂了说明面板', () => {
    assert.ok(box, '没有自建框');
    assert.ok(guide(), '没有说明面板');
  });
  check('默认是收起的(不自己弹出来挡页面)', () => {
    assert.ok(!guide().classList.contains('is-open'), '默认就展开了');
  });
  check('四条「能填的样子」都在,顺序固定', () => {
    const rows = [...box.querySelectorAll('.dyc-fabric-guide-row')];
    assert.equal(rows.length, 4, '行数 ' + rows.length);
    const texts = rows.map((r) => r.querySelector('b').textContent);
    assert.deepEqual(texts, [
      '棉80 聚酯纤维20',
      '面料：棉80%、聚酯纤维20%',
      '68%精棉 30%聚酯纤维 2%氨纶',
      '羊毛100'
    ]);
    assert.equal(rows[0].querySelector('i').textContent, '最简写法');
  });
  check('三条规则都在(顺序/符号/合计)', () => {
    const rules = [...box.querySelectorAll('.dyc-fabric-guide-rule')];
    assert.equal(rules.length, 3);
    assert.deepEqual(rules.map((r) => r.querySelector('em').textContent),
      ['顺序随意', '符号随意', '合计要 100']);
  });
  check('面板里不列面料名清单(用户要的是"能填什么",不是"能填哪些名")', () => {
    assert.ok(guide().textContent.indexOf('常用面料') < 0, '又出现了面料清单');
  });

  console.log('\n【二】只给看不给点(用户:不需要点一下就预填内容)');
  check('面板里没有任何可点元素(button / a / tabindex)', () => {
    assert.equal(guide().querySelectorAll('button, a, [tabindex]').length, 0, '面板里有可点元素');
  });
  check('点示例行与示例文字都不会改动输入框', () => {
    input.value = '';
    [...guide().querySelectorAll('.dyc-fabric-guide-row')].forEach((r) => {
      r.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      r.querySelector('b').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    assert.equal(input.value, '', '点了示例就被预填了:' + input.value);
  });
  check('面板自己也没挂点击行为(再点一次仍然不填)', () => {
    input.value = '';
    guide().dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    guide().dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(input.value, '');
  });

  console.log('\n【三】展开与收起');
  check('点输入框(聚焦)展开', () => {
    input.dispatchEvent(new win.Event('focus'));
    assert.ok(guide().classList.contains('is-open'));
  });
  check('一开始打字就收起', () => {
    input.value = '棉';
    input.dispatchEvent(new win.Event('input'));
    assert.ok(!guide().classList.contains('is-open'));
  });
  check('再聚焦又展开', () => {
    input.dispatchEvent(new win.Event('focus'));
    assert.ok(guide().classList.contains('is-open'));
  });
  check('点页面别处收起', () => {
    doc.body.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.ok(!guide().classList.contains('is-open'));
  });
  check('点面板自己不会收起(要能边看边对照)', () => {
    input.dispatchEvent(new win.Event('focus'));
    guide().dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.ok(guide().classList.contains('is-open'));
  });

  console.log('\n【四】开关关掉:面板随自建框一起消失');
  check('关闭后面板与自建框都移除', () => {
    env.setFlags({ fabricSmartFill: false });
    assert.equal(doc.querySelector('[data-dyc-fabric-box]'), null);
  });

  console.log('\n【五】面板教的写法必须真能解析(改示例就会在这里红)');
  const rowsBlock = (read(SRC_UNDER_TEST).match(/var GUIDE_ROWS = \[([\s\S]*?)\];/) || [])[1] || '';
  const samples = [...rowsBlock.matchAll(/'([^']*)'\s*,\s*'/g)].map((m) => m[1]);
  check('从源码取到四条示例(取不到说明 GUIDE_ROWS 结构变了)', () => {
    assert.equal(samples.length, 4, '取到 ' + samples.length + ' 条');
  });

  for (const sample of samples) {
    await checkSeq('「' + sample + '」不报"看不懂"', async () => {
      /* 每条单开环境:共用会被 busy 锁挡住,只能干等上一轮跑完平台交互 */
      const e = await makeEnv();
      e.input.value = sample;
      e.btn.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true, cancelable: true }));
      /* 解析是同步的:失败会立刻 say 并 return,300ms 足够看到那条消息 */
      await sleep(300);
      const bad = e.messages.filter((m) => /没看懂|没解析出材料|配比合计/.test(String(m.value)));
      assert.equal(bad.length, 0, '面板教的写法解析不过:' + (bad[0] && bad[0].value));
      /* 守卫:必须真跑起来了,否则 messages 为空会让上面那条假绿
         (解析通过后 run() 进入平台交互并立刻禁用按钮,两种都算跑起来了) */
      assert.ok(e.messages.length > 0 || e.btn.disabled, '智能填写压根没执行,这条断言无效');
      /* 环境用到这里即可,跑完的异步流程随 window 一起丢给 GC */
      e.win.close();
    });
  }

  console.log('\n────────────────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) {
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log('  全部通过。');
  }
})();

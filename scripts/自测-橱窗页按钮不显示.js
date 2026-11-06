/**
 * 橱窗商品管理页不显示「粘贴加车」与「全能搜索」（2026-11-06 用户报）
 * ============================================================
 * 被测文件：src/live/cart-paste.js（作用域守卫 + URL 兜底）、
 *           src/live/search.js（按 id 全量清壳）
 *
 * 现场：中控台（/dashboard/live/control）切到橱窗商品管理页
 *   （/dashboard/shopwindow/goods-list）后，两枚按钮仍留在该页。
 *   中控台是微前端 pushState 换路由，document 不重载 —— 不主动收就永远在。
 *
 * 覆盖（都是**行为级**，真加载模块跑，不是抓源码字符串）：
 *   A. 粘贴加车：中控台挂上 → 切走同步移除 → 切回重新挂上
 *   B. 粘贴加车：守卫误报 true 时，URL 兜底仍要拦住（两道保险分别有效）
 *   C. 粘贴加车：直接以橱窗页 URL 初始化（异常路径）→ 根本不挂
 *   D. 全能搜索：清壳不依赖输入框还在（真实漏点）
 *
 * 为什么必须行为级：静态断言只能证明「写了 dycWatchLiveScope」，
 * 证明不了「回调里真的把节点摘了、切回还能恢复」。本工程出过静态全绿、
 * 实机没反应的假绿，这里用 jsdom 真跑一遍 DOM。
 * 用例 B 就是行为级才抓得到的缺口：按钮已在场时 start() 的幂等 guard
 * 会直接返回，只判 ensureButton 的话谁都不会去摘它。
 *
 * 用法：node scripts/自测-橱窗页按钮不显示.js  （退出码 0 = 全绿）
 *      jsdom 由 run-selftests.py 的 NODE_PATH 提供。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CTRL = 'https://buyin.jinritemai.com/dashboard/live/control';
const SHOP = 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list?pre_universal_page_params_id=x';

let pass = 0;
function ok(name) { pass++; console.log('  ✓ ' + name); }

/** 等两拍微任务：模块里 start() 走的是 dycReadFlags().then(...) */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

/* 按名字从源码里抠出整段函数（含嵌套大括号），用于只测单个纯函数 */
function sliceFn(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start > 0, '源码里没找到 ' + name);
  let depth = 0, opened = false;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') { depth++; opened = true; }
    else if (code[i] === '}') { depth--; if (opened && depth === 0) return code.slice(start, i + 1); }
  }
  throw new Error(name + ' 没有闭合');
}

/**
 * 装一次 cart-paste 模块（真实加载被测文件，只垫平台侧依赖）。
 * @param {string} startHref 初始 URL（决定「首拍」是不是在中控台）
 */
function bootCartPaste(startHref) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="bar"><button id="native">添加商品</button></div></body>');
  const { window } = dom;
  const state = { href: startHref };
  const scopeCbs = [];

  const ctx = vm.createContext({
    window: window,
    document: window.document,
    location: state,
    console: { log() {}, warn() {} },
    // 作用域判定：与 flags.dycIsLiveControl 同一口径（只认 /live/control 前缀）
    dycIsLiveControl: () => /live\/control/.test(state.href),
    dycReadFlags: () => Promise.resolve({ cartPaste: true }),
    dycWatchFlags: () => {},
    dycWatchLiveScope: (cb) => { scopeCbs.push(cb); cb(/live\/control/.test(state.href)); },
    findAllByText: () => [window.document.getElementById('native')],
    toast() {},
    setStatus() {},
    failStatus() {},
    finishStatus() {},
    updateProgress() {},
    debugLog() {},
    scrollElementToViewportCenter() {},
    highlight() {},
    locateProduct() {},
    setTimeout: () => 0,          // 不真跑重试：用例只关心同步挂载/移除
    clearTimeout() {},
    setInterval: () => 1,         // 心跳不真跑：要验的是「不靠心跳也能收」
    clearInterval() {},
    fetch: () => Promise.reject(new Error('用例不该发请求'))
  });

  vm.runInContext(read('src/live/cart-paste.js'), ctx);

  return {
    dom: dom,
    state: state,
    scopeCbs: scopeCbs,
    /** 当前页面上的粘贴加车按钮（没有则 null） */
    btn: () => window.document.querySelector('.dyc-cartpaste-btn')
  };
}

(async () => {
  console.log('A. 粘贴加车随中控台作用域收放');
  {
    const s = bootCartPaste(CTRL);
    await flush();
    assert.ok(s.btn(), '中控台里没挂上粘贴加车按钮');
    ok('中控台：按钮正常挂到「添加商品」左边');

    // 切到橱窗商品管理页：同步移除（不等心跳）
    s.state.href = SHOP;
    assert.ok(s.scopeCbs.length, '模块没有订阅中控台作用域');
    s.scopeCbs.forEach((cb) => cb(false));
    assert.equal(s.btn(), null, '切到橱窗页后按钮仍留在 DOM 里（用户报的就是这个）');
    ok('切到橱窗商品管理页：按钮同步移除');

    // 切回中控台：按开关状态恢复
    s.state.href = CTRL;
    s.scopeCbs.forEach((cb) => cb(true));
    await flush();
    assert.ok(s.btn(), '切回中控台后按钮没有恢复');
    ok('切回中控台：按钮重新挂上');

    /* B. 双重保险：守卫这一拍就算误报 true（平台路由抖动、判定滞后），
     * 只要 URL 还停在橱窗页，URL 兜底也必须拦住 —— 两道保险各证一次，
     * 不能只证明「其中一条能挡住」。 */
    s.state.href = SHOP;
    s.scopeCbs.forEach((cb) => cb(true));
    await flush();
    assert.equal(s.btn(), null, '守卫误报 true 时 URL 兜底没拦住（按钮已在场就没人摘它）');
    ok('守卫误报 true 时 URL 兜底仍然拦住（两道保险分别有效）');

    s.dom.window.close();
  }

  console.log('C. 异常路径：橱窗页作为首屏');
  {
    const s = bootCartPaste(SHOP);
    await flush();
    assert.equal(s.btn(), null, '橱窗页作为首屏时仍然挂出了按钮（URL 兜底没生效）');
    ok('直接打开 / 刷新橱窗页时根本不挂');
    s.dom.window.close();
  }

  console.log('D. 全能搜索按 id 全量清壳');
  {
    /* 真实漏点：平台重建搜索区会把打过标记的 input 整个换掉，
     * 旧实现按 `input[data-dyc-search]` 遍历，新 DOM 里找不到旧框，
     * 挂在它旁边的壳就再也清不掉 —— 这里造一棵「壳还在、input 已没了」的树。 */
    const dom = new JSDOM(
      '<!DOCTYPE html><body>' +
        '<div id="row-a"><span id="dyc-omni-shell"><button data-dyc-omni-btn="1">全能搜索</button></span></div>' +
        '<div id="row-b"><span id="platform-child">平台自己的节点</span></div>' +
        '<button id="dyc-omni-btn" data-dyc-omni-btn="1">孤儿按钮</button>' +
      '</body>'
    );
    const ctx = vm.createContext({
      document: dom.window.document,
      console: { log() {}, warn() {} }
    });
    vm.runInContext(sliceFn(read('src/live/search.js'), 'removeAllOmniShells'), ctx);
    ctx.removeAllOmniShells();

    const doc = dom.window.document;
    assert.equal(doc.getElementById('dyc-omni-shell'), null, '壳没被清掉（旧实现只按 input 遍历，这正是漏点）');
    assert.equal(doc.querySelector('[data-dyc-omni-btn]'), null, '还留着带 data-dyc-omni-btn 的按钮');
    assert.equal(doc.getElementById('platform-child').textContent, '平台自己的节点',
      '清壳误伤了平台节点（只许摘我们自己建的 id / 属性）');
    ok('输入框已不在 DOM 时，壳与按钮仍按固定 id 被清干净，且不碰平台节点');

    dom.window.close();
  }

  console.log('\n全绿：' + pass + ' 组');
})().catch((e) => {
  console.error('\n✗ 失败：' + ((e && e.message) || e));
  process.exit(1);
});

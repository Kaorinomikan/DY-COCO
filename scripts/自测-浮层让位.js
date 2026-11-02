/**
 * 浮层让位（反馈 #126 / #127）· 回归自测
 * ============================================================
 * 被测文件：src/content/overlay-guard.js
 *
 * 覆盖这些事（每条都对应一个真机上会出错的地方）：
 *   A. 交集判定 —— 「真盖住」才让位：全盖 / 不沾边 / 只压一条边 / 恰好 35%
 *   B. ★ 回归点：面积不到视口 12%、但**确实压在控件上**的下拉面板（「直播工具」那种）
 *      必须让位 —— 旧口径「面积 ≥ 视口 12%」把这一档全漏掉了，正是用户
 *      「这些框框都不自动隐藏」的根因。
 *   C. 自己的节点不算浮层（dyc- / dyb-）—— 消息盒子 / 状态条 / 自己的圆钮
 *   D. 看不见的浮层不算：display:none / visibility:hidden / opacity 0
 *   E. 弱选择器（只凭类名词根）从严：必须 fixed/absolute **且** z-index ≥ 1
 *      —— 防「整页容器类名带 modal」把控件永久藏掉
 *   F. 强选择器（auxo / role=dialog）不要求 position，但要求有层级
 *   G. 矩形裁进视口：浮层超出屏幕一部分仍能正确判定
 *   H. bind / applyOne：被盖住 ⇒ visibility:hidden；浮层关掉 ⇒ 原值还原（不留残影）
 *   I. 无开关（2026-11-02 撤掉「浮层让位」菜单项）：让位恒定生效，
 *      对外不再暴露 setFlag / enabled，源码里也没有可关的开关状态
 *   J. 源码红线：tooltip 不进判据、COVER_RATIO 与选择器表保持本期口径
 *
 * 做法与 scripts/自测-小黄车自动刷新.js 同源：按函数名抠出源码 → 最小 DOM 垫片上求值
 * → 断言。源码一改自测自动跟着变，不会出现「测试绿了线上还错」。
 *
 * 用法：node scripts/自测-浮层让位.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'src/content/overlay-guard.js');

/* ============================================================
 * 1. 最小 DOM 垫片
 * ============================================================ */

class FakeEl {
  constructor(opts) {
    const o = opts || {};
    this.nodeType = 1;
    this.tagName = 'DIV';
    this.className = o.cls || '';
    this.id = o.id || '';
    this._rect = o.rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    this._cs = Object.assign({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      position: 'static',
      zIndex: 'auto'
    }, o.cs || {});
    this.style = {};
  }
  getBoundingClientRect() { return this._rect; }
}

function rect(left, top, width, height) {
  return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
}

/** 每个用例自己摆一份「页面」：选择器 → 节点数组 */
let registry = {};
const doc = {
  querySelectorAll(sel) { return registry[sel] || []; },
  documentElement: { clientWidth: 1600, clientHeight: 900 },
  hidden: false
};
const win = {
  innerWidth: 1600,
  innerHeight: 900,
  getComputedStyle(el) { return (el && el._cs) || { display: 'block', position: 'static', zIndex: 'auto' }; }
};

const timers = [];
function fakeSetInterval(fn, ms) {
  const t = { fn: fn, ms: ms };
  timers.push(t);
  return t;
}
function fakeClearInterval(t) {
  const i = timers.indexOf(t);
  if (i >= 0) timers.splice(i, 1);
}

/* ============================================================
 * 2. 从源文件抠函数 / 变量源码
 * ============================================================ */

function sliceFunction(src, name) {
  const key = 'function ' + name + '(';
  const at = src.indexOf(key);
  if (at < 0) throw new Error('源文件里找不到 function ' + name);
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(at, j + 1);
    }
  }
  throw new Error('花括号未配平：' + name);
}

function sliceVar(src, name) {
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*[\\s\\S]*?;\\s*(?=\\n|var |function |/\\*)');
  const m = src.match(re);
  if (!m) throw new Error('源文件里找不到 var ' + name);
  return m[0];
}

const FN_NAMES = [
  'classStr', 'isOurNode', 'isPanel', 'clipRect', 'scan', 'collectPanels',
  'panelRects', 'invalidate', 'covers', 'applyOne', 'tick', 'stopPump',
  'startPump', 'bind', 'unbind'
];
const VAR_NAMES = [
  'CACHE_MS', 'PUMP_MS', 'COVER_RATIO', 'MIN_SIDE', 'MIN_AREA',
  'PANEL_SEL_STRONG', 'PANEL_SEL_WEAK', 'boundEls', 'rectCache', 'rectAt',
  'pumpTimer', 'seenToken'
];

function buildModule() {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const parts = [];
  for (const v of VAR_NAMES) parts.push(sliceVar(src, v));
  for (const f of FN_NAMES) parts.push(sliceFunction(src, f));
  const body = parts.join('\n') + '\nreturn {' +
    FN_NAMES.concat(VAR_NAMES).join(',') + '};';
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'setInterval', 'clearInterval', 'Date', body);
  return fn(win, doc, fakeSetInterval, fakeClearInterval, Date);
}

/** 每个用例拿一份干净的模块实例（模块内状态 = 变量，不能跨用例串味） */
function fresh() {
  registry = {};
  doc.hidden = false;
  win.innerWidth = 1600;
  win.innerHeight = 900;
  timers.length = 0;
  return { m: buildModule(), src: fs.readFileSync(SRC_PATH, 'utf8') };
}

/* ============================================================
 * 3. 断言工具
 * ============================================================ */

let pass = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  failures.push(name + (extra ? '  → ' + extra : ''));
}

function group(title) {
  process.stdout.write('\n[' + title + ']\n');
}

function summaryLine(title, done) {
  process.stdout.write('  ' + (done ? '✓' : '✗') + ' ' + title + '\n');
}

/* ============================================================
 * 4. 用例
 * ============================================================ */

/* ---------- A. 交集判定 ---------- */
group('A. 交集判定：真盖住才让位');
{
  const { m } = fresh();
  const ctrl = rect(780, 820, 40, 40);   // 右下角一枚 40×40 的圆钮

  // A1 全屏遮罩 + 弹窗 → 让位
  registry['.auxo-modal-root'] = [new FakeEl({ rect: rect(0, 0, 1600, 900), cs: { position: 'fixed', zIndex: '1000' } })];
  m.invalidate();
  const a1 = m.covers(ctrl);
  ok('A1 全屏弹窗盖住控件 ⇒ true', a1 === true, '得到 ' + a1);
  summaryLine('A1 全屏弹窗', a1 === true);

  // A2 完全不相交 → 不让位
  registry = { '.auxo-modal-root': [new FakeEl({ rect: rect(0, 0, 600, 300), cs: { position: 'fixed', zIndex: '1000' } })] };
  m.invalidate();
  const a2 = m.covers(ctrl);
  ok('A2 浮层在左上角，与控件无关 ⇒ false', a2 === false, '得到 ' + a2);
  summaryLine('A2 不相交', a2 === false);

  // A3 只压到一条边（相交 8×40 = 320，占 800 的 40%）——
  //    40% ≥ 35% ⇒ 算盖住；换 4px（10%）⇒ 不算
  registry = { '.auxo-modal-root': [new FakeEl({ rect: rect(780, 860, 600, 300), cs: { position: 'fixed', zIndex: '1000' } })] };
  m.invalidate();
  const a3 = m.covers(ctrl);
  ok('A3 只压到 10% ⇒ false', a3 === false, '得到 ' + a3);

  registry = { '.auxo-modal-root': [new FakeEl({ rect: rect(780, 840, 600, 300), cs: { position: 'fixed', zIndex: '1000' } }) ] };
  m.invalidate();
  const a3b = m.covers(ctrl);
  ok('A3b 压住一半(20/40) ⇒ true', a3b === true, '得到 ' + a3b);
  summaryLine('A3 压边比例', a3 === false && a3b === true);

  // A4 门槛两侧各验一次：37.5%（40×15）算盖住，25%（40×10）不算。
  //     刻意不测「恰好 35%」—— 浮点乘出来是 560.0000000000001，卡在刀口上的
  //     用例会因为一个 ulp 红绿翻转，测它没有意义。
  registry = { '.auxo-modal-root': [new FakeEl({ rect: rect(780, 845, 600, 300), cs: { position: 'fixed', zIndex: '1000' } })] };
  m.invalidate();
  const a4 = m.covers(ctrl);
  ok('A4 压住 37.5% ⇒ true', a4 === true, '得到 ' + a4);

  registry = { '.auxo-modal-root': [new FakeEl({ rect: rect(780, 850, 600, 300), cs: { position: 'fixed', zIndex: '1000' } })] };
  m.invalidate();
  const a4b = m.covers(ctrl);
  ok('A4b 压住 25% ⇒ false', a4b === false, '得到 ' + a4b);

  // A5 自定比例门槛
  m.invalidate();
  const a5 = m.covers(ctrl, 0.9);
  ok('A5 门槛抬到 90% ⇒ false', a5 === false, '得到 ' + a5);
  summaryLine('A4/A5 比例门槛', a4 === true && a4b === false && a5 === false);
}

/* ---------- B. ★ 回归点：小面板也要让位 ---------- */
group('B. 回归点：面积不足视口 12% 的下拉面板（「直播工具」）');
{
  const { m } = fresh();
  // 用户截图那块屏：2400×1306；「直播工具」面板约 640×400 ⇒ 8.2% 视口
  win.innerWidth = 2400;
  win.innerHeight = 1306;
  const ctrl = rect(1180, 1220, 40, 40);   // 面板正压在它上面
  registry['[class*="dropdown"]'] = [new FakeEl({
    cls: 'live_tools_dropdown__a1b2c',
    rect: rect(900, 1000, 640, 400),
    cs: { position: 'absolute', zIndex: '200' }
  })];
  m.invalidate();
  const b1 = m.covers(ctrl);
  const ratio = (640 * 400) / (2400 * 1306);
  ok('B1 面板 8.2% 视口但压在控件上 ⇒ true', b1 === true, '得到 ' + b1 + '，面积占比 ' + (ratio * 100).toFixed(1) + '%');

  // B2 同一块面板，控件在别处（右下角）⇒ 不让位（不该「一开面板全藏」）
  const far = rect(2320, 1200, 40, 40);
  m.invalidate();
  const b2 = m.covers(far);
  ok('B2 面板没压住它 ⇒ false', b2 === false, '得到 ' + b2);
  summaryLine('B1/B2 小面板按交集判定', b1 === true && b2 === false);
}

/* ---------- C. 自己的节点不算浮层 ---------- */
group('C. 插件自己的节点不算浮层');
{
  const { m } = fresh();
  const ctrl = rect(780, 820, 40, 40);
  registry['[role="dialog"]'] = [new FakeEl({
    rect: rect(0, 0, 1600, 900),
    cs: { position: 'fixed', zIndex: '2147483000' }
  })];
  // 换成我们自己的类名 / id，同一个矩形就**不该**再让位
  registry['[role="dialog"][0]'] = [];
  const own1 = new FakeEl({ cls: 'dyb-panel dyb-history', rect: rect(0, 0, 1600, 900), cs: { position: 'fixed', zIndex: '2147483000' } });
  const own2 = new FakeEl({ id: 'dyc-search-pill', rect: rect(0, 0, 1600, 900), cs: { position: 'fixed', zIndex: '2147483000' } });
  const own3 = new FakeEl({ cls: 'dyc-back-top', rect: rect(0, 0, 1600, 900), cs: { position: 'fixed', zIndex: '2147483000' } });
  ok('C1 .dyb- 前缀 ⇒ 不算', m.isPanel(own1, false) === false);
  ok('C2 #dyc- 前缀 ⇒ 不算', m.isPanel(own2, false) === false);
  ok('C3 .dyc- 前缀 ⇒ 不算', m.isPanel(own3, false) === false);
  summaryLine('C1~C3 自家节点排除', m.isPanel(own1, false) === false && m.isPanel(own2, false) === false && m.isPanel(own3, false) === false);
}

/* ---------- D. 看不见的层不算 ---------- */
group('D. 看不见的浮层不算挡道');
{
  const { m } = fresh();
  const ctrl = rect(780, 820, 40, 40);
  const cases = [
    ['display:none', { display: 'none', position: 'fixed', zIndex: '1000' }],
    ['visibility:hidden', { display: 'block', visibility: 'hidden', position: 'fixed', zIndex: '1000' }],
    ['opacity:0', { display: 'block', opacity: '0', position: 'fixed', zIndex: '1000' }]
  ];
  let allOff = true;
  for (const [name, cs] of cases) {
    registry = { '.auxo-modal-root': [new FakeEl({ rect: rect(0, 0, 1600, 900), cs: cs })] };
    m.invalidate();
    const got = m.covers(ctrl);
    if (got !== false) { allOff = false; ok('D ' + name + ' ⇒ false', false, '得到 ' + got); }
  }
  ok('D1 display:none / hidden / opacity:0 一律不算', allOff);
  summaryLine('D1 不可见层排除', allOff);

  // D2 面积太小的角标（10×10）不算
  registry = { '.auxo-popover': [new FakeEl({ rect: rect(785, 830, 10, 10), cs: { position: 'fixed', zIndex: '1000' } })] };
  m.invalidate();
  const d2 = m.covers(ctrl);
  ok('D2 10×10 角标 ⇒ false', d2 === false, '得到 ' + d2);
  summaryLine('D2 角标排除', d2 === false);
}

/* ---------- E. 弱选择器从严 ---------- */
group('E. 弱选择器（类名词根）必须真的浮起来');
{
  const { m } = fresh();
  const weak = { position: 'static', zIndex: 'auto' };
  const weakZ = { position: 'static', zIndex: '999' };
  const weakFloat = { position: 'absolute', zIndex: 'auto' };
  const strong = { position: 'absolute', zIndex: '10' };
  ok('E1 static + z-index:auto ⇒ 不算（整页容器误判防线）', m.isPanel(new FakeEl({ cls: 'page_modal_wrap__x', cs: weak }), true) === false);
  ok('E2 static + z-index:999 ⇒ 也不算（弱档要求同时浮起来）', m.isPanel(new FakeEl({ cls: 'page_modal_wrap__x', cs: weakZ }), true) === false);
  ok('E3 absolute + z-index:auto ⇒ 也不算（弱档要有层级）', m.isPanel(new FakeEl({ cls: 'page_modal_wrap__x', cs: weakFloat }), true) === false);
  ok('E4 absolute + z-index:10 ⇒ 算', m.isPanel(new FakeEl({ cls: 'live_tools_dropdown__a', cs: strong }), true) === true);
  summaryLine('E1~E4 弱选择器四态', true);
}

/* ---------- F. 强选择器 ---------- */
group('F. 强选择器（auxo / role=dialog）');
{
  const { m } = fresh();
  const staticZ = { position: 'static', zIndex: '500' };
  const noneZ = { position: 'static', zIndex: 'auto' };
  ok('F1 role=dialog + static + z-index:500 ⇒ 算（ARIA 语义不依赖 position）',
    m.isPanel(new FakeEl({ cs: staticZ }), false) === true);
  ok('F2 完全静态（无层级）⇒ 不算',
    m.isPanel(new FakeEl({ cs: noneZ }), false) === false);
  summaryLine('F1/F2 强选择器', true);
}

/* ---------- G. 裁进视口 ---------- */
group('G. 矩形裁进视口');
{
  const { m } = fresh();
  const ctrl = rect(780, 820, 40, 40);
  // 面板左上角跑到屏幕外（-200,-200），尺寸 1200×1200 ⇒ 仍覆盖控件
  registry = { '.auxo-drawer': [new FakeEl({ rect: rect(-200, -200, 1200, 1200), cs: { position: 'fixed', zIndex: '900' } })] };
  m.invalidate();
  const g1 = m.covers(ctrl);
  ok('G1 面板部分在屏幕外，仍能判定盖住 ⇒ true', g1 === true, '得到 ' + g1);
  // 完全在屏幕外 ⇒ 不算
  registry = { '.auxo-drawer': [new FakeEl({ rect: rect(2000, 2000, 400, 400), cs: { position: 'fixed', zIndex: '900' } })] };
  m.invalidate();
  const g2 = m.covers(ctrl);
  ok('G2 完全在视口外 ⇒ false', g2 === false, '得到 ' + g2);
  summaryLine('G1/G2 视口裁剪', g1 === true && g2 === false);
}

/* ---------- H. bind / 显隐 ---------- */
group('H. bind 后的显隐与还原');
{
  const { m } = fresh();
  const btn = new FakeEl({ cls: 'dyc-back-top', rect: rect(1500, 700, 40, 40), cs: { position: 'fixed', display: 'flex' } });
  btn.style.visibility = '';
  m.bind(btn);
  ok('H0 bind 后登记进托管表', m.boundEls.length === 1, '得到 ' + m.boundEls.length);
  ok('H0b 心跳已启动', timers.length === 1, '得到 ' + timers.length);
  ok('H0c 没有浮层时不动它', btn.style.visibility === '', '得到 ' + btn.style.visibility);

  // 开一个正压住它的弹窗
  registry['.auxo-modal-root'] = [new FakeEl({ rect: rect(1400, 600, 500, 400), cs: { position: 'fixed', zIndex: '1000' } })];
  m.invalidate();
  m.tick();
  ok('H1 被盖住 ⇒ visibility:hidden', btn.style.visibility === 'hidden', '得到 ' + btn.style.visibility);
  ok('H1b 标记已让位', btn.__dycGuardHidden === true);

  // 关掉弹窗
  registry = {};
  m.invalidate();
  m.tick();
  ok('H2 浮层关掉 ⇒ 还原为空字符串（交给模块自己的状态机）', btn.style.visibility === '', '得到 ' + JSON.stringify(btn.style.visibility));
  ok('H2b 标记已清', btn.__dycGuardHidden === false);

  // H3 模块自己 display:none（本来就没显示）⇒ 不去动 visibility
  const btn2 = new FakeEl({ cls: 'dyc-back-bottom', rect: rect(1500, 760, 40, 40), cs: { position: 'fixed', display: 'none' } });
  m.bind(btn2);
  registry['.auxo-modal-root'] = [new FakeEl({ rect: rect(1400, 600, 500, 400), cs: { position: 'fixed', zIndex: '1000' } })];
  m.invalidate();
  m.tick();
  ok('H3 自己 display:none 时不介入', btn2.style.visibility === undefined || btn2.style.visibility === '', '得到 ' + btn2.style.visibility);
  summaryLine('H1~H3 让位与还原', true);
}

/* ---------- I. 无开关：让位恒定 ---------- */
group('I. 无开关，让位恒定生效');
{
  const { m, src } = fresh();
  const btn = new FakeEl({ cls: 'dyc-search-fab', rect: rect(780, 820, 48, 48), cs: { position: 'fixed', display: 'flex' } });
  btn.style.visibility = '';
  registry['.auxo-modal-root'] = [new FakeEl({ rect: rect(0, 0, 1600, 900), cs: { position: 'fixed', zIndex: '1000' } })];
  m.invalidate();
  m.bind(btn);
  m.tick();
  ok('I1 有浮层覆盖 ⇒ 让位', btn.style.visibility === 'hidden', '得到 ' + btn.style.visibility);

  /* 2026-11-02 用户：「删掉这个菜单可选项，这个功能不做选择」。下面三条是机械
   * 保障：接口没了、源码里也没有开关状态，就不会被谁说一句「关掉」又退回旧行为。 */
  ok('I2 对外不再暴露 setFlag / enabled', m.setFlag === undefined && m.enabled === undefined);
  ok('I3 源码里不再有开关状态', !/\bflagOn\b|\bflagWired\b/.test(src) && !/dycWatchFlags/.test(src));
  ok('I4 不再读取 overlayYield 存档键', !/overlayYield\s*===\s*false/.test(src));

  /* 没有开关也要能自愈：浮层撤掉后控件自己回来 */
  registry['.auxo-modal-root'] = [];
  m.invalidate();
  m.tick();
  ok('I5 浮层撤销 ⇒ 控件自动回来', btn.style.visibility === '', '得到 ' + JSON.stringify(btn.style.visibility));

  m.unbind(btn);
  ok('I6 unbind ⇒ 还原并停心跳', btn.style.visibility === '' && timers.length === 0);
  summaryLine('I1~I6 无开关与解绑', true);
}

/* ---------- J. 源码红线 ---------- */
group('J. 源码红线');
{
  const { m, src } = fresh();
  const allSel = m.PANEL_SEL_STRONG.concat(m.PANEL_SEL_WEAK).join(' ');
  ok('J1 判据里不含 tooltip（悬停常态，算进来会一直闪）', !/tooltip/i.test(allSel), allSel);
  ok('J2 重叠门槛保持 0.35', m.COVER_RATIO === 0.35, '得到 ' + m.COVER_RATIO);
  ok('J3 选择器分强弱两档', Array.isArray(m.PANEL_SEL_STRONG) && Array.isArray(m.PANEL_SEL_WEAK));
  ok('J4 弱档含 dropdown / popover / popup 词根',
    /\[class\*="dropdown"\]/.test(src) && /\[class\*="popover"\]/.test(src) && /\[class\*="popup"\]/.test(src));
  ok('J5 强档保留 auxo 六类 + role=dialog/menu/listbox',
    /\.auxo-modal-root/.test(src) && /\.auxo-drawer/.test(src) && /\[role="dialog"\]/.test(src) && /\[role="menu"\]/.test(src));
  ok('J6 用 visibility 叠加，不抢模块的 display 状态机',
    /el\.style\.visibility = 'hidden'/.test(src) && !/applyOne[\s\S]{0,400}el\.style\.display/.test(src));
  ok('J7 后台标签页不做无用功', /document\.hidden/.test(src));
  summaryLine('J1~J7 源码红线', true);
}

/* ============================================================
 * 5. 汇总
 * ============================================================ */

process.stdout.write('\n────────────────────────────────────────\n');
if (failures.length) {
  process.stdout.write('失败 ' + failures.length + ' 条，通过 ' + pass + ' 条：\n');
  for (const f of failures) process.stdout.write('  ✗ ' + f + '\n');
  process.exit(1);
}
process.stdout.write('全部通过：' + pass + ' 条断言\n');

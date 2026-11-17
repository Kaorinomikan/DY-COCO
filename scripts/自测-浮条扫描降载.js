/**
 * 自测 · 浮条扫描降载（2026-11-17）
 * ============================================================
 * 被测文件：src/live/hide-elements.js
 *
 * 背景（用户报障原话：「这个页面不停抖动，帮我修复」）：
 *   抖店「素材管理」页（/ffa/creative/material-manage-menu）被 shopAll 正则
 *   覆盖，浮条扫描在那一页 400ms 一轮：诊断报告实测「遍历 2104 节点 ·
 *   ⚠深度截断 · 打标 0 个」。该页 4477 个元素、正文 120 万字符，平台还在
 *   不停改 class/style —— 每轮都是全页 BFS + 一批 getBoundingClientRect /
 *   getComputedStyle，强制同步布局，老内核上表现为掉帧、画面抖。
 *
 * 本版改两件事，这里逐条守住：
 *   A. 右侧带预筛：贴右缘 + 浮层是浮条的两个硬特征。先用 elementsFromPoint
 *      在右缘取 12 个点问一句，右侧带里没有浮层就**不遍历全页**。
 *   B. 属性通道降频：浮条的挂载一定是 childList 变化；class/style 变化只代表
 *      「已挂载的浮条由隐藏变可见」，慢一秒半秒不影响体感，走 1.5s 慢档。
 *
 * 三条底线（改这块必须一直成立）：
 *   ① 预筛**不能**把真浮条判没 —— 有浮层的页面照旧完整扫描并打标；
 *   ② 老内核没有 elementsFromPoint 时**不许跳过**，退化成原行为；
 *   ③ 跳过分支**不许动 DOM**：已打标的浮条是 pointer-events:none，
 *      hit-test 本来就点不到它，若在这里清标，它下一帧就重新显形。
 *
 * 用法：node scripts/自测-浮条扫描降载.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) {
  ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom'));
}

const ROOT = path.join(__dirname, '..');
const SRC_REL = 'src/live/hide-elements.js';
const CODE = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8');

const BAR_ATTR = 'data-dyc-hide-bar';
const VW = 1707;
const VH = 950;

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等条件成立（禁用固定 sleep 卡时间 —— 并发下会假红） */
async function waitFor(pred, timeoutMs, step) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (pred()) return true;
    await sleep(step || 40);
  }
  return false;
}

/**
 * 造一个抖店页面世界。
 *
 * @param {object} o
 *   o.hit(el)      → elementsFromPoint 返回数组；不传 = 该 API 不存在
 *   o.withFloater  → body 里放一条「客服/反馈」竖条
 */
function makeWorld(o) {
  o = o || {};
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="big">素材表格</div>
    ${o.withFloater ? '<div class="floater" style="position:fixed;right:24px;top:200px"><span>客服</span><span>反馈</span></div>' : ''}
    ${o.withWideFloater ? '<div class="wide-floater" style="position:fixed;right:120px;top:100px"><span>超级福袋</span></div>' : ''}
  </body></html>`, {
    url: 'https://fxg.jinritemai.com/ffa/creative/material-manage-menu',
    runScripts: 'outside-only'
  });

  const win = dom.window;
  const doc = win.document;

  Object.defineProperty(win, 'innerWidth', { value: VW, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: VH, configurable: true });

  /* 布局垫片：jsdom 不做布局，getBoundingClientRect 恒为 0。
     浮条 56×300、贴右缘 24px；其余元素给一个「宽得像内容区」的盒子，
     这样预筛的宽度档才有东西可筛。 */
  win.Element.prototype.getBoundingClientRect = function () {
    const cls = String(this.className || '');
    if (cls.indexOf('wide-floater') >= 0) {
      /* 中控台运营浮条：宽 520、右距 120 —— 取样线写死像素时三条全落空 */
      return { width: 520, height: 120, top: 100, left: VW - 640, right: VW - 120, bottom: 220 };
    }
    if (cls.indexOf('floater') >= 0) {
      return { width: 56, height: 300, top: 200, left: VW - 80, right: VW - 24, bottom: 500 };
    }
    return { width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600 };
  };

  /* 模拟 hit-test：只有传了 o.hit 才认为内核支持这个 API */
  if (typeof o.hit === 'function') {
    doc.elementsFromPoint = function (x, y) { return o.hit(doc, x, y); };
  }

  /* ---- flags.js 提供的依赖（hide-elements 缺一个就直接 return） ---- */
  win.DYC_PAGE_PATTERNS = {
    shopAll: /^https:\/\/fxg\.jinritemai\.com\//,
    liveCtrl: /$^/
  };
  win.DYC_HIDE_TARGETS = o.targets || [{
    id: 'feedbackBar',
    selector: '.never-match-anything',
    pages: ['shopAll'],
    defaultOn: true,
    mode: 'opacity',
    barScan: {
      texts: ['客服', '反馈', '举报', '调研', '问卷', '意见', '帮助', '移动'],
      minHits: 2,
      maxWidth: 160,
      minHeight: 90,
      minAspect: 1.05,
      rightGap: 60,
      maxTextLen: 80
    }
  }];
  win.dycReadFlags = () => Promise.resolve({ hideElements: true });
  win.dycReadHideList = () => Promise.resolve(o.hideList || ['feedbackBar']);
  win.dycWatchFlags = () => {};
  win.dycWatchHideList = () => {};

  win.eval(CODE);
  return { win, doc };
}

/** 等扫描跑起来并给出读数 */
async function ready(w) {
  const ok = await waitFor(() => !!w.win.__dycBarScanMeta, 2000);
  assert.ok(ok, '扫描没有在 2 秒内跑过一轮（__dycBarScanMeta 一直是 null）');
  return w.win.__dycBarScanMeta;
}

(async function main() {
  console.log('自测 · 浮条扫描降载（' + SRC_REL + '）\n');

  /* ==========================================================
   * 一、无浮层的页面：首轮兜底扫一次，之后不再全页遍历
   * ========================================================== */
  console.log('A. 右缘没有浮层（素材管理这类页面）');

  {
    const w = makeWorld({ hit: () => [] });
    const first = await ready(w);
    check('首轮照旧完整扫一遍（兜底，保证不漏）', () => {
      assert.ok(first.nodes > 0,
        '首轮就没扫（nodes=0）—— 兜底节奏没了，预筛一旦判错就永久漏拦');
    });

    /* 平台继续渲染（childList 变化）⇒ 10 秒内的后续轮次只跳过 */
    const d = w.doc.createElement('div');
    d.textContent = '平台又渲染了一块';
    w.doc.body.appendChild(d);
    const skipped = await waitFor(() => {
      const m = w.win.__dycBarScanMeta;
      return m && m.skipped && m.nodes === 0;
    }, 1600);
    check('之后的变化只做预筛，不再全页遍历', () => {
      assert.ok(skipped, '第二次仍然做了全页遍历 —— 预筛没生效，这一页还会抖');
    });
    check('跳过时记下原因，诊断报告能看出来', () => {
      assert.equal(w.win.__dycBarScanMeta.skipped, '右侧带无浮层');
    });
    check('配置套数照旧上报（不是"功能没跑"）', () => {
      assert.equal(w.win.__dycBarScanMeta.cfgs, 1);
    });
    check('没有打任何标记', () => {
      assert.equal(w.doc.querySelectorAll('[' + BAR_ATTR + ']').length, 0);
    });
  }

  /* ==========================================================
   * 二、有浮层的页面：照旧完整扫描并打标
   * ========================================================== */
  console.log('\nB. 右缘有客服/反馈浮条');

  {
    const w = makeWorld({
      withFloater: true,
      hit: (doc) => {
        const f = doc.querySelector('.floater');
        return f ? [f, doc.body] : [doc.body];
      }
    });
    const meta = await ready(w);
    check('完整扫描执行了', () => {
      assert.ok(meta.nodes > 0, '有浮层却没扫描（nodes=0）—— 功能回退');
      assert.ok(!meta.skipped, '有浮层却记成跳过');
    });
    check('浮条被打上隐藏标记', () => {
      const f = w.doc.querySelector('.floater');
      assert.ok(f.hasAttribute(BAR_ATTR),
        '浮条没被标记 —— 预筛把真浮条判没了');
      assert.equal(meta.marked, 1);
    });
    /* 平台重渲染会换成新节点：旧标记随之消失，新节点必须重新标上。
       这条同时守住「结构变化走快档」——慢档 1500ms 起，快档 400ms 起，
       下面给 1500ms 的上限，只要能在窗口内标上就说明没被慢档拖住。 */
    const f2 = w.doc.querySelector('.floater');
    f2.removeAttribute(BAR_ATTR);
    const fresh = w.doc.createElement('div');
    fresh.className = 'floater-again';
    fresh.style.position = 'fixed';
    w.doc.body.appendChild(fresh);
    const again = await waitFor(
      () => w.doc.querySelector('.floater').hasAttribute(BAR_ATTR), 1500);
    check('去掉标记后 1.5 秒内被重新标上', () => {
      assert.ok(again, 'childList 变化后没有重新扫描打标（快档失效）');
    });
  }

  /* ==========================================================
   * B2. 宽浮条（右距 120）：取样线必须由 rightGap 推算
   * ========================================================== */
  console.log('\nB2. 中控台运营浮条（宽 520 · 右距 120）');

  {
    const w = makeWorld({
      withWideFloater: true,
      hideList: ['liveCtrlOpsBar'],
      targets: [{
        id: 'liveCtrlOpsBar',
        selector: '.never-match-anything',
        pages: ['shopAll'],
        mode: 'opacity',
        barScan: {
          texts: ['超级福袋', '发布预告', '留住长效流量', '行业数据分析', '流量获取效率'],
          minHits: 1,
          maxWidth: 520,
          maxHeight: 220,
          minHeight: 36,
          rightGap: 120,
          maxTextLen: 260,
          maxChildren: 16
        }
      }],
      hit: (doc) => {
        const f = doc.querySelector('.wide-floater');
        return f ? [f] : [];
      }
    });
    const meta = await ready(w);
    check('预筛没有把宽浮条判成"没有"', () => {
      assert.ok(meta.nodes > 0,
        '取样竖线没覆盖 rightGap=120 的形态，中控台运营浮条会永久漏拦');
      assert.ok(!meta.skipped);
    });
    check('宽浮条被打上标记', () => {
      const f = w.doc.querySelector('.wide-floater');
      assert.ok(f.hasAttribute(BAR_ATTR), '宽浮条没被标记');
    });
  }

  /* ==========================================================
   * 三、老内核没有 elementsFromPoint：不许跳过
   * ========================================================== */
  console.log('\nC. 内核没有 elementsFromPoint（退回原行为）');

  {
    const w = makeWorld({ withFloater: true });
    const meta = await ready(w);
    check('没有 hit-test API 时照旧全页遍历', () => {
      assert.ok(meta.nodes > 0, '因为没有 API 就跳过扫描 —— 会把浮条彻底漏掉');
      assert.ok(!meta.skipped);
    });
    check('浮条照样被标记', () => {
      assert.ok(w.doc.querySelector('.floater').hasAttribute(BAR_ATTR));
    });
  }

  /* ==========================================================
   * 四、跳过分支不许动 DOM（已标记的浮条不能被重新显形）
   * ========================================================== */
  console.log('\nD. 跳过时不许清标');

  {
    const w = makeWorld({ withFloater: true, hit: () => [] });
    /* 首轮兜底全扫：真浮条在这一轮被标上（这也是真机上的正常路径） */
    await ready(w);
    const f = w.doc.querySelector('.floater');
    assert.ok(f.hasAttribute(BAR_ATTR), '首轮兜底扫描没给浮条打标');

    /* 第二轮走跳过分支：hit-test 点不到它（已被 pointer-events:none），
       此刻若顺手清标，浮条下一帧就重新显形 —— 用户看到的就是闪。 */
    f.style.pointerEvents = 'none';
    const d = w.doc.createElement('div');
    d.textContent = '平台又渲染了一块';
    w.doc.body.appendChild(d);
    const wentSkip = await waitFor(() => {
      const m = w.win.__dycBarScanMeta;
      return m && m.skipped;
    }, 1600);

    check('第二轮确实走了跳过分支', () => {
      assert.ok(wentSkip, '没有进入跳过分支，这条用例没测到东西');
    });
    check('跳过分支保留了已有标记', () => {
      assert.ok(f.hasAttribute(BAR_ATTR),
        '跳过时把标记清了 —— 浮条会在下一帧重新显形，用户看到的就是闪');
    });
    check('跳过读数里如实反映当前标记数', () => {
      assert.equal(w.win.__dycBarScanMeta.marked, 1);
    });
  }

  /* ==========================================================
   * 五、源码红线：两条通道的档位必须是分开的
   * ========================================================== */
  console.log('\nE. 源码结构');

  check('属性通道有独立的慢档常量，且慢于结构通道', () => {
    const mAttr = /var\s+BAR_ATTR_DEBOUNCE\s*=\s*(\d+)\s*;/.exec(CODE);
    const mFast = /var\s+BAR_DEBOUNCE\s*=\s*(\d+)\s*;/.exec(CODE);
    assert.ok(mAttr, '找不到 BAR_ATTR_DEBOUNCE —— 属性变化又回到 400ms 一档了');
    assert.ok(mFast, '找不到 BAR_DEBOUNCE');
    assert.ok(Number(mAttr[1]) > Number(mFast[1]),
      '属性通道（' + mAttr[1] + 'ms）没有慢于结构通道（' + mFast[1] + 'ms）');
  });

  check('MutationObserver 按 childList / 属性分流', () => {
    assert.ok(/records\[i\]\.type\s*===\s*'childList'/.test(CODE),
      'MutationObserver 回调没有区分 childList，两条通道又混成一条');
  });

  check('预筛用的是 hit-test，不是又一次全页遍历', () => {
    assert.ok(/document\.elementsFromPoint/.test(CODE),
      '预筛没有用 elementsFromPoint');
  });

  check('预筛结论带缓存（否则连续触发时每次都要 hit-test）', () => {
    assert.ok(/PRE_SCREEN_GAP/.test(CODE), '预筛没有缓存窗口常量');
    assert.ok(/now\s*-\s*screenAt\s*<\s*PRE_SCREEN_GAP/.test(CODE),
      '预筛没有用缓存窗口判断');
  });

  check('预筛一直说"没有"时有兜底全扫，不会永久失效', () => {
    const m = /var\s+SKIP_SCAN_EVERY\s*=\s*(\d+)\s*;/.exec(CODE);
    assert.ok(m, '找不到 SKIP_SCAN_EVERY —— 预筛一旦判错，浮条就永久漏拦');
    assert.ok(Number(m[1]) >= 5000, '兜底间隔太短（' + m[1] + 'ms），等于没降载');
  });

  check('取样竖线由各套 rightGap 推算，不写死像素', () => {
    /* 教训：原先写死 vw-16/-48/-96，而中控台运营浮条 rightGap=120、
       宽 520 —— 三条线全落在浮条右侧的空白里，预筛永远说"没有"。 */
    assert.ok(/barMaxRightGap/.test(CODE), '没有按 rightGap 推算取样线');
    assert.ok(/vw\s*-\s*16\s*-\s*gap/.test(CODE),
      '取样竖线仍写死像素，换一套几何档就会全落空');
  });

  /* ========================================================== */
  console.log('\n----------------------------------------');
  if (fail) {
    console.log('失败 ' + fail + ' 条，通过 ' + pass + ' 条：');
    failures.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  }
  console.log('全部通过（' + pass + ' 条）');
  process.exit(0);
})().catch((e) => {
  console.error('自测自身异常：', e);
  process.exit(1);
});

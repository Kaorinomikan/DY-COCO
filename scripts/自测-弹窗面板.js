'use strict';
// 扩展弹窗的面板口径（2026-10-31 用户定「不要圆角设计了，恢复最开始的这个设计」）
// 2026-10-30 那版做过「浅灰台面 8px + 白色圆角卡片 14px」，用户看过实机后否掉：
// 面板层描弧线的代价是整圈多出灰边，弹窗顶部与窗口边缘之间凭空多一条色带。
// 所以口径回到最初：整块白底、280px 宽、16px 内边距，面板层没有任何弧度与描边。
//
// 边界（别在这里白费力气）：弹窗的**窗口外形归浏览器管**，Chromium 不开放，
// 连背景透明都不生效（透明只会在四个角露出窗口白底）。也就是说窗口圆角做不了，
// 面板圆角做了只会留一圈灰边 —— 结论就是不做。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../src/popup/popup.html'), 'utf8');

function ruleOf(selector) {
  const i = html.indexOf('\n    ' + selector + ' {');
  assert.ok(i > 0, '样式里没找到 ' + selector + ' 规则');
  const j = html.indexOf('}', i);
  assert.ok(j > i, selector + ' 规则没有闭合');
  // 注释里会写到被禁的写法（"不许再写 background:#f2f3f5"），断言前先剥掉注释，
  // 否则注释自己被当成违规命中。
  return html.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const body = ruleOf('body');
const mask = ruleOf('.mask');

// ① 宽度与内边距：280 + 16，就是最初的口径；内容宽 248px，说明文字折行位置全按它调过
assert.ok(/width:\s*280px/.test(body), '面板宽 280px');
// 2026-10-31 改版：body 变成纵向三段（顶部 / 主体 / 底栏），16px 内边距从 body
// 下移到各段 —— 内容宽仍然是 248px，这个数没变，所以校验方式跟着改。
assert.ok(/padding:\s*0/.test(body), 'body 自身不再吃内边距（改由三段各自 16px）');
['.pop-head', '.tagline', '.pop-body'].forEach((sel) => {
  const rule = ruleOf(sel).replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.ok(/padding:\s*[^;]*16px/.test(rule), sel + ' 的水平内边距要是 16px，内容宽才是 248px');
});
// 页脚不铺满 280px，而是和分组框同宽（左右各让 16px）—— 它是内容流的一部分，
// 通栏底色会让人误以为又是个常驻条。
assert.ok(/margin:\s*[^;]*16px/.test(ruleOf('.pop-foot').replace(/\/\*[\s\S]*?\*\//g, ' ')),
  '.pop-foot 的水平外边距要是 16px（与分组框同宽）');
// 高度：2026-10-31 第九轮定稿（用户：「微信态功能少，中间留空，调试模式黏着在最下方」，
//   同时保持上一轮的「抖音态功能多时要滚到底才见」）。
//   实现 = flex 纵向 + 固定 600 + 页脚 margin-top:auto，但有三个前提，缺一不可：
//     ① body 必须 height:600（要有"剩余空间"可分配）；
//     ② 主体必须 flex:none（写成 flex:1 会吃掉剩余空间、页脚顶到底，微信态就不留空了）；
//     ③ body overflow-y:auto（内容超过 600 时整页滚，页脚才会被推到可视区之外）。
assert.ok(/^\s*height:\s*600px/m.test(body), 'body 要写死 height:600px（否则没有剩余空间可分配）');
assert.ok(!/max-height/.test(body), 'body 不许 max-height（会让窗口缩到内容高度）');
assert.ok(/display:\s*flex/.test(body), 'body 要是 flex 容器（auto margin 才生效）');
assert.ok(/flex-direction:\s*column/.test(body), 'body 要是纵向 flex');
assert.ok(/overflow-y:\s*auto/.test(body), 'body 要 overflow-y:auto（内容多时整页滚）');
// ② 不许再有灰台面：html/body 都不铺底色，整块白才和窗口边缘齐平
//   （2026-10-31 第七轮起 html 上多了一条 height —— 是为了让老内核按同一个 600
//    算窗口尺寸，不然 body 内部以为 600、窗口却按内容长高，页脚又被顶到滚动区末尾）
const htmlRule = ruleOf('html').replace(/\/\*[\s\S]*?\*\//g, ' ');
assert.ok(!/background/.test(htmlRule), 'html 不许再铺台面底色');
assert.ok(/height:\s*600px/.test(htmlRule), 'html 也要写 height:600px（老内核按它算窗口尺寸）');
assert.ok(!/background:\s*#f2f3f5/.test(body), 'body 不许再铺浅灰台面');
assert.ok(!/box-sizing/.test(body), 'body 回到 280 固定宽，不再需要 border-box 修正');
// ②·五 2026-10-31 第九轮口径：「有空间就黏底、没空间就跟内容走」
//   主体 prime 不得 gap：写成 flex:1 或让它自己滚，都会把页脚顶到/锁在窗口最底，
//   微信态那段"中间留空"就没了。页脚侧靠 margin-top:auto 完成黏底，不许用定位。
const popBody = ruleOf('.pop-body').replace(/\/\*[\s\S]*?\*\//g, ' ');
assert.ok(/flex:\s*none/.test(popBody), '.pop-body 要 flex:none（按内容长高，不放大不压缩）');
assert.ok(!/flex:\s*1/.test(popBody), '.pop-body 不许 flex:1（会吃掉剩余空间、页脚顶到底）');
assert.ok(!/overflow-y/.test(popBody), '.pop-body 不许自成滚动容器（页脚会浮在它下面）');
assert.ok(!/max-height/.test(popBody), '.pop-body 不许限高');
const popFoot = ruleOf('.pop-foot').replace(/\/\*[\s\S]*?\*\//g, ' ');
assert.ok(/flex:\s*none/.test(popFoot), '.pop-foot 要 flex:none（自己不参与伸缩）');
assert.ok(/margin:\s*auto\s+16px/.test(popFoot), '.pop-foot 要 margin-top:auto（有剩余空间时黏底）');
assert.ok(!/max-height/.test(popFoot), '.pop-foot 不许限高');
assert.ok(!/position:\s*(fixed|sticky|absolute)/.test(popFoot), '.pop-foot 不许靠定位实现"固定"');

// ③ 2026-10-31 第 27 条：布局必须与"有几个平台"解耦（用户：「下一个新平台功能少时也这样」）
//   判据：样式里不许出现任何以平台为条件的布局规则。分组颜色（.group-wx）是数据驱动的
//   分组样式，不在此列；这里禁的是「按平台改布局」。
const cssOnly = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, ' ');
assert.ok(!/\[data-plat/.test(cssOnly), '不许按平台选择器写样式（平台差异只能体现在"显示哪些分组"）');
['plat-dy', 'plat-wx', 'plat-taobao'].forEach((cls) => {
  assert.ok(!new RegExp('\\.' + cls + '\\b').test(cssOnly), '不许出现平台专属类 .' + cls);
});
// 布局三件套的选择器必须与平台无关
['.pop-head', '.pop-body', '.pop-foot'].forEach((sel) => {
  assert.ok(cssOnly.indexOf('\n    ' + sel + ' {') > 0, sel + ' 必须是平台无关的裸选择器');
});
// ③ 不许再套圆角卡片：那层 .sheet 是圆角方案的结构，恢复后应整块消失
assert.ok(!/class="sheet"/.test(html), 'body 里不许再有 .sheet 圆角卡片');
assert.ok(!/\.sheet\s*\{/.test(html.replace(/\/\*[\s\S]*?\*\//g, ' ')), '样式里不许再留 .sheet 规则');
// ④ 遮罩铺满整个窗口：没有台面留白，inset 必须回到 0
assert.ok(/inset:\s*0/.test(mask), '遮罩要铺满窗口（inset:0）');
assert.ok(!/border-radius/.test(mask), '遮罩不许再带弧度');
// ⑤ 结构：标题、主体、底栏都在 body 下，底栏必须是**最后一个**子项
const bodyAt = html.indexOf('<body');
const h1At = html.indexOf('<h1>');
assert.ok(h1At > bodyAt, 'body 里要有标题');
assert.ok(!/class="sheet"/.test(html.slice(bodyAt)), '标题外不许再包一层容器');
['id="flags-root"', 'id="confirm-mask"', 'id="pop-foot"'].forEach((mark) => {
  assert.ok(html.indexOf(mark) > h1At, mark + ' 要排在标题之后');
});
// 底栏在 DOM 里排在主体与遮罩之前？遮罩是 fixed 浮层，放哪都不影响层级；
// 真正要保证的是：底栏在 body 的**内容流**里位于主体之后，且后面不再有内容块。
const footAt = html.indexOf('id="pop-foot"');
const maskAt = html.indexOf('id="confirm-mask"');
assert.ok(footAt > html.indexOf('id="flags-root"'), '底栏要排在主体之后');
assert.ok(footAt < maskAt, '底栏要在遮罩之前（遮罩是 fixed 浮层，不参与内容流）');

// ⑥ 副标题：新文案 21 个字，12px 会折出只剩「。」的第二行，必须 ≤11.5px
const tag = ruleOf('.tagline').replace(/\/\*[\s\S]*?\*\//g, ' ');
const tagSize = Number((tag.match(/font-size:\s*([\d.]+)px/) || [])[1]);
assert.ok(tagSize <= 11.5, '副标题字号必须 ≤11.5px，21 个字才能一行放下（当前 ' + tagSize + 'px）');
assert.ok(/适配抖音、微信的中控台和店铺的便携化升级。/.test(html), '副标题用的是指定文案');

console.log('弹窗面板自测：13/13 通过；280px × 600px 固定窗口、页脚 margin-top:auto'
  + '（内容少则黏底留空、内容多则滚到底才见）、布局与平台数量解耦（无平台专属样式）、'
  + '副标题 11.5px 一行放下、无灰台面、无圆角卡片。');

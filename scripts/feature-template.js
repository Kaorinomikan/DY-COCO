/**
 * 新功能模板 · 中控台工具栏
 * ============================================================
 * 【这个文件怎么用】
 *
 * 新增一个中控台功能时,**把本文件复制到 src/live/** 并改名为你的
 * 功能名(如 src/live/my-feature.js),然后:
 *
 *   1. 改文件头的注释,写清功能名与作用
 *   2. 改注册项的 id / flag(两处都用你的键名,不能与别的功能重名)
 *   3. render() 里把占位按钮换成你的真实界面
 *   4. 到 src/content/flags.js 的 DYC_FLAGS_META **末尾追加**一项开关元数据
 *      (key 必须与下面的 flag 一致)
 *   5. 到 manifest.json 的中控台 content_scripts 数组**末尾追加**你的脚本路径
 *      —— 只追加到末尾,不要插到中间,否则并行合并时会冲突
 *   6. 中间态每轮跑语法；口径定稿后由回收脚本自动跑全部闸门
 *
 * 【关键:为什么加功能不用改宿主文件】
 *
 *   传统做法:工具栏按钮写在 nav.js 里、开关控件硬编码在 popup.html 里,
 *   改一个功能要动三四个文件 —— 两个人同时开发必撞车。
 *
 *   现在:功能自己注册自己(本文件末尾 dycRegisterTool),
 *   弹窗按 flags.js 的元数据自动渲染 —— 所以你只需要:
 *     · 新增 1 个自己的文件
 *     · 末尾追加 1 段 flags.js 元数据
 *     · 末尾追加 1 行 manifest.json
 *   共享文件只做「末尾追加」,git 能自动合并;
 *   万一还是冲突了,wt-merge.sh 会用三方语义合并自动解(仅限 flags.js)。
 *
 * 【render(ctx) 里能用什么 —— ctx 的真实接口只有三个】
 *
 *   ctx.makeButton(文字, 点击回调)  →  统一样式的按钮(推荐先用这个)
 *   ctx.report(对象, 类型, 结果选项) →  自动带注册项来源；结果选项传 { count }。
 *   也可直接调用 setStatus(对象, 类型, { source, count })，见下方示例。
 *   ctx.bar                         →  工具栏容器节点(需要更复杂布局时才用)
 *
 *   ctx 上**没有** el / setText / onClick / setStatus —— 别自己假设,
 *   直接用原生 document.createElement 即可,样式类名见文末。
 *
 *   另有可选钩子 onEnable():该项被渲染出来时调用一次,适合做初始化。
 *   (每次开关切换导致重新渲染都会再调,别在里面做只应做一次的昂贵操作。)
 *
 * 【样式:沿用现有类名,别写内联样式】
 *
 *   .dyc-tool      外层包裹(渲染器自动加)
 *   .dyc-tool-btn  按钮(makeButton 自动加)
 *   位置样式见 src/live/nav.css(共用 .dyb-nav-box 的对齐方式)
 *
 * 【闸门落点 —— 中间态只查语法,定稿后回收自动查其余项】
 *
 *   python scripts/check-syntax.py --changed  # 每轮中间态，约 0.1 秒
 *   bash scripts/回收.sh <名字>               # 直接合并（冒烟不拦合并），自动跑：
 *     manifest 顺序 / 产品文案 / 性能 / 断言体检 / 相关行为自测
 *   行为自测写进 scripts/ 并提交；不得把 .tmp/ 下未入库脚本作为交接必跑入口。
 *   开工与收工都读 docs/agents/用户要求.md 第 25 条；问号先说用途，最多补一条限制。
 *
 * ⚠️ 本文件放在 scripts/ 而不是 src/live/,原因有二:
 *      ① 它不在 manifest 的 content_scripts 里,浏览器不会执行它;
 *      ② scripts/ 不在自更新清单的扫描范围(DIRS=["icons","src"]),
 *         所以商家更新时**不会**收到这个文件。
 *    复制到 src/live/ 之后它才会成为真正的功能文件。
 *    复制走之前记得改文件名与 id / flag。
 */

(function dycFeatureTemplate() {
  'use strict';

  dycRegisterTool({
    // 工具栏内部的唯一标识,不能与别的功能重名
    id: 'myFeature',

    // 挂哪个开关(对应 flags.js 里 DYC_FLAGS_META 的 key)。
    // 填 null = 常显,不跟随开关。
    flag: 'myFeature',

    // 工具栏上显示的文字(同时作为悬停 title)
    label: '我的功能',

    /**
     * 渲染你的界面。
     *
     * @param {object} ctx 见文件头「ctx 的真实接口只有三个」
     * @returns {Node} 必须返回一个节点,渲染器会把它插进工具栏。
     *          返回 null/false 表示本次不显示(条件不满足时用)。
     */
    render: function (ctx) {
      // ---- 占位实现,换成你的真实逻辑 ----
      var hit = 0;
      var btn = ctx.makeButton('我的功能', function () {
        hit++;
        // SOURCE 用与开关一致的功能主干词；text 是对象，结果放 count。
        setStatus('示例对象', 'success', { source: '我的功能', count: '已完成 ' + hit + ' 次' });
      });
      return btn;

      // ---- 需要更复杂的布局时,自己拼节点(示例) ----
      // var wrap = document.createElement('span');
      // var input = document.createElement('input');
      // input.type = 'text';
      // input.placeholder = '款号';
      // input.addEventListener('keydown', function (e) {
      //   if (e.key !== 'Enter') return;
      //   setStatus(input.value, 'success', { source: '我的功能', count: '已完成' });
      // });
      // wrap.appendChild(input);
      // wrap.appendChild(ctx.makeButton('搜索', function () {
      //   setStatus(input.value, 'success', { source: '我的功能', count: '已完成' });
      // }));
      // return wrap;
    },

    /**
     * 可选:该项被渲染出来时调用一次。
     * 适合做只跟渲染有关的初始化(如挂一次事件委托)。
     */
    onEnable: function () {
      // console.log('[我的功能] 已启用');
    }
  });
})();
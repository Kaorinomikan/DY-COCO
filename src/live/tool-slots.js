/**
 * 中控台工具栏 · 扩展位注册表
 *
 * 用途:让**每个新功能自己注册一个工具栏按钮**,而不是去改宿主文件。
 *
 * 为什么要有这个东西(2026-10-11):
 *   中控台工具栏原先是 nav.js 独占的 —— 输入框、定位按钮、商品总数全写死在
 *   那一个文件里。接下来要做的「款号搜索」「快速回到顶部」都得往工具栏加控件,
 *   三个功能挤在同一个文件里改,多会话并行开发时必然互相冲突。
 *   引入注册表后,每个功能在自己的文件末尾调一次 dycRegisterTool 即可,
 *   宿主文件(nav.js)与渲染器(toolbar.js)都不用动 —— 合并时零冲突。
 *
 * 加载顺序:必须排在所有功能模块之前(见 manifest.json 的 js 数组约定)。
 *   这里刻意用 var + function 声明而非 let/const,确保绑定落在全局对象上。
 *
 * 用法(功能作者的视角,只需在**自己的文件**里写):
 *
 *   dycRegisterTool({
 *     id: 'backToTop',          // 唯一标识,重复注册会被忽略
 *     flag: 'backToTop',        // 跟随哪个开关启停;写 null 表示常显
 *     label: '回到顶部',         // 无障碍用的 title / aria-label
 *     render: function (ctx) {  // 返回要插进工具栏的节点
 *       var btn = ctx.makeButton('回到顶部', function () { ... });
 *       return btn;
 *     }
 *   });
 *
 * 详细约定见 AGENTS.md「中控台工具栏扩展位」一节。
 */

/** 已注册的工具,按注册顺序渲染 */
var DYC_TOOL_SLOTS = [];

var DYC_TOOLBAR_ID = 'dyc-toolbar';

/**
 * 注册一个工具栏工具。
 *
 * 幂等:同一个 id 重复注册(例如内容脚本被重复注入)直接忽略,
 * 不会出现两个一样的按钮。
 *
 * @param {{id:string, flag?:string|null, label?:string,
 *          render:function(Object):Element,
 *          onEnable?:function(), onDisable?:function()}} def
 */
function dycRegisterTool(def) {
  if (!def || !def.id || typeof def.render !== 'function') {
    console.warn('[DYC-TOOL] 注册被忽略,缺少 id 或 render:', def);
    return;
  }
  for (var i = 0; i < DYC_TOOL_SLOTS.length; i++) {
    if (DYC_TOOL_SLOTS[i].id === def.id) return;
  }
  DYC_TOOL_SLOTS.push(def);
}
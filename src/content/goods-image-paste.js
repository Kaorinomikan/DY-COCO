/**
 * 商品发布 / 编辑页 · 上传框「剪贴板粘贴」(2026-11-08，用户新增需求)
 * ============================================================
 * 【用户原话】
 *   「对着上传图片的窗口,加入【剪贴板粘贴】的按钮,可以不启用上传图片的系统窗口,
 *     直接把剪贴板的图片直接一步粘贴进图片框当中。这个按钮对着全都点所有这类
 *     上传图片的窗口启用,这个按钮将放置在上传图片的窗口的内部下方。不挡位置,
 *     简明易懂。」+「一次一张」。
 *
 * 【做什么】每个**空白**上传框内下方挂一枚「粘贴图片」：
 *   点一下 ⇒ 读剪贴板里的图片 ⇒ 直接塞进该框的 input[type=file] ⇒ 等平台自己出图。
 *   全程不弹系统文件选择窗。
 *
 * 【为什么只挂空白框】已出图的框平台会在同一块位置叠「编辑 / 删除」,
 *   再挤一个按钮就挡路了(用户要求「不挡位置」)。框出图后按钮自动消失,
 *   想换图走平台自己的「编辑」—— 与手动操作的习惯一致。
 *
 * 【怎么认框(不写死类名)】平台类名是哈希的(style_xxx__Abc12),每次发版都变。
 *   两条互补路径,任一命中即算一个上传框:
 *     ① 结构:  input[type=file][accept*=image] → 向上找一个「看得见的小方块」祖先
 *     ② 文案:  「上传图片」这段文字 → 向上找最近的含 input[type=file] 的祖先
 *   两条都只依赖「有这么个输入框/有这么四个字」,是平台交互的语义,不是样式实现。
 *
 * 【怎么塞文件】三级,逐级验证,前一级出图就不再试下一级(避免重复上传):
 *   ① DataTransfer → input.files + change   (React 受控组件的标准入口)
 *   ② 向框内派发 paste 事件(clipboardData 带同一张图) —— 只认 paste 的组件
 *   ③ 向框内派发 drop 事件 —— 只认拖拽的组件
 *   三级都不出图 ⇒ 如实报「没塞进去」,提示手动上传。**绝不假报成功**。
 *
 * 【消息】三段式(来源 ｜ 值 ｜ 结果数):来源=图片粘贴,值=图片/原因,
 *   结果数=已入框/未入框/**待确认**(2026-11-22 新增:文件已交给平台、但页面上还没看到预览,
 *   平台异步处理完就会出图 —— 这种既不能报「已入框」,也不该报「未入框」)。
 * ============================================================
 */
(function goodsImagePaste() {
  'use strict';

  if (window.__dycGoodsImagePasteLoaded) return;
  window.__dycGoodsImagePasteLoaded = true;
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;

  var SOURCE = '图片粘贴';
  var BTN_TEXT = '粘贴图片';
  var BTN_TIP = '点一下把剪贴板里的图片贴进这个框（不会弹选择文件的窗口）';
  var BTN_CLASS = 'dyc-imgpaste-btn';
  var TILE_ATTR = 'data-dyc-imgpaste-tile';
  var BTN_ATTR = 'data-dyc-imgpaste-btn';
  /* 2026-11-10 新增:微型入口(规格图相机图标)与商详图片工具栏按钮 */
  var MODE_ATTR = 'data-dyc-imgpaste-mode';
  var TOOLBAR_CLASS = 'dyc-imgpaste-toolbar';
  var TOOLBAR_ATTR = 'data-dyc-imgpaste-toolbar';
  var TOOLBAR_ANCHOR = '从主图填入';
  var TOOLBAR_TIP = '点一下把剪贴板里的图片加到商详图片末尾（一次一张）';
  /* 2026-11-21 新增:尺码图行级按钮(挂在「解析尺码图」右侧) */
  var SIZE_CLASS = 'dyc-imgpaste-size';
  var SIZE_ATTR = 'data-dyc-imgpaste-size';
  var SIZE_ANCHOR = '解析尺码图';
  var SIZE_TEXT = '粘贴尺码图';
  var SIZE_TIP = '点一下把剪贴板里的图片交给「解析尺码图」（不弹选择文件的窗口）';

  var on = false;
  var sizeOn = false;
  var observer = null;
  var scanTimer = 0;
  var scrollTimer = 0;
  var busyTile = null;
  var roots = [document];
  var rootTimer = 0;
  var lastHref = '';
  var SHADOW_STYLE = 'data-dyc-imgpaste-style';
  var shadowCss = '.dyc-imgpaste-btn{all:initial;position:absolute;left:6px;right:6px;bottom:6px;box-sizing:border-box;height:24px;margin:0;padding:0 4px;border:1px solid #d6e2ff;border-radius:6px;background:#eef3ff;color:#1664ff;font:12px/22px "Microsoft YaHei",sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;z-index:2147483000}'
    + '.dyc-imgpaste-btn:hover{background:#1664ff;border-color:#1664ff;color:#fff}'
    + '.dyc-imgpaste-btn:disabled{opacity:.6;cursor:default}'
    + '.dyc-imgpaste-btn.is-compact{height:20px;left:4px;right:4px;bottom:4px;font-size:11px;line-height:18px;border-radius:5px}'
    /* 微型入口:规格图相机图标只有 24~32px,按钮挂在图标**正下方**(top:100%),
       不压图标本身。宽度与图标同宽,高度 16px,文字 10px。
       右侧放不下(贴着裁切区/视口边)时降级为 is-micro-inside(贴在图标内底部 11px)。 */
    + '.dyc-imgpaste-btn.is-micro{width:34px;height:16px;padding:0;border-radius:4px;font-size:10px;line-height:14px;z-index:2147483001}'
    + '.dyc-imgpaste-btn.is-micro-right{left:100%;right:auto;top:50%;bottom:auto;margin:0 0 0 4px;transform:translateY(-50%)}'
    + '.dyc-imgpaste-btn.is-micro-inside{left:2px;right:2px;bottom:1px;top:auto;height:11px;border-radius:3px;font-size:9px;line-height:9px;transform:none}';

  // 微信商品表单在 micro-app 内；同源 iframe 也可能承载图片编辑区域。
  function collectRoots() {
    var found = [document];
    for (var i = 0; i < found.length && i < 32; i++) {
      var hosts = found[i].querySelectorAll('micro-app, iframe');
      for (var j = 0; j < hosts.length && found.length < 32; j++) {
        var root = hosts[j].shadowRoot;
        try {
          if (hosts[j].tagName === 'IFRAME') root = hosts[j].contentDocument;
        } catch (e) { root = null; }
        if (root && found.indexOf(root) < 0) found.push(root);
      }
    }
    return found;
  }

  function queryRoots(selector) {
    var out = [];
    roots.forEach(function (root) {
      out = out.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    });
    return out;
  }

  function refreshRoots() {
    var scoped = inScope();
    // 丢弃旧 root 前先移除其中的控件，SPA 退回列表时 shadowRoot 可能仍保留。
    if (!scoped) {
      unmountAll();
      queryRoots('style[' + SHADOW_STYLE + ']').forEach(function (style) { style.remove(); });
    }
    var next = scoped ? collectRoots() : [document];
    var changed = next.length !== roots.length || next.some(function (root, i) { return root !== roots[i]; });
    if (!changed && observer) return false;
    if (observer) observer.disconnect();
    roots = next;
    observer = new MutationObserver(function (records) {
      quickMount(records);     // 新格子就地挂,不等防抖(见下)
      scheduleScan(400);
    });
    roots.forEach(function (root) {
      observer.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['src', 'accept', 'disabled'] });
    });
    return true;
  }

  function ensureStyle(tile) {
    var root = tile.getRootNode();
    if (root === document || root.querySelector('style[' + SHADOW_STYLE + ']')) return;
    var style = tile.ownerDocument.createElement('style');
    style.setAttribute(SHADOW_STYLE, '1');
    style.textContent = shadowCss;
    (root.head || root).appendChild(style);
  }

  function log(msg) {
    try { if (typeof debugLog === 'function') debugLog(msg); } catch (e) { /* 日志不影响主流程 */ }
  }

  function say(value, kind, count, full) {
    try {
      if (typeof setStatus !== 'function') return;
      setStatus(value, kind, {
        source: SOURCE,
        count: count,
        full: full,
        keepHistory: kind !== 'success'
      });
    } catch (e) { /* 消息失败不拖垮主流程 */ }
  }

  function inScope() {
    var p = window.DYC_PAGE_PATTERNS;
    return !!(p && ((p.goodsEdit && p.goodsEdit.test(location.href))
      || (p.wxGoodsEdit && p.wxGoodsEdit.test(location.href))));
  }

  /* ==========================================================
   * 一、认框
   * ========================================================== */

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (typeof isVisible === 'function') return isVisible(el);
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function boxOf(el) {
    try { return el.getBoundingClientRect(); } catch (e) { return { width: 0, height: 0 }; }
  }

  /** 已出图的上传框(有真实图片) —— 有图就不挂按钮 */
  function hasImage(tile) {
    var imgs = tile.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute('src') || '';
      /* 有 src 且看得见就算已出图。平台占位图(空状态插图)也是 img,
         但它在「上传图片」这个空态里本身不会出现 —— 空态的加号是 svg/文字。 */
      if (src && visible(imgs[i])) return true;
    }
    return false;
  }

  function inputForTile(tile) {
    var input = tile.querySelector('input[type="file"]');
    if (input) return input;
    var p = window.DYC_PAGE_PATTERNS;
    if (!p || !p.wxGoodsEdit || !p.wxGoodsEdit.test(location.href)
      || !tile.matches('.picture_add_content')) return null;
    // 微信的隐藏 input 是加号方块的兄弟；只能取同一上传组件内唯一的 input。
    var group = tile.closest('.weui-desktop-new-upload__wrp');
    var inputs = group && group.querySelectorAll('input[type="file"]');
    return inputs && inputs.length === 1 ? inputs[0] : null;
  }

  /**
   * 从 file input 向上找「看得见的小方块」。
   * 判据:宽度 48~420、高度 48~420、面积 > 2000。上传框在本页是 118×118 级别的方块,
   * 再往上就是整行/整列的大容器(会挂到离谱的位置)。
   * 一路都不合尺寸(隐藏框 / 还没渲染)就退回 **input 的直接父元素** ——
   * 绝不用 body/html 当包含块:那会让按钮变成贴在页面角落的浮层。
   */
  function tileFromInput(input) {
    var group = input.closest('.weui-desktop-new-upload__wrp');
    var p = window.DYC_PAGE_PATTERNS;
    if (group && p && p.wxGoodsEdit && p.wxGoodsEdit.test(location.href)) {
      var add = group.querySelector('.picture_add_content');
      return add && inputForTile(add) === input ? add : null;
    }
    var first = input.parentElement;
    var node = first;
    var guard = 0;
    while (node && guard < 7) {
      guard++;
      var r = boxOf(node);
      if (r.width >= 48 && r.width <= 420 && r.height >= 48 && r.height <= 420
        && r.width * r.height > 2000) {
        return node;
      }
      if (node === document.body || node === document.documentElement) break;
      node = node.parentElement;
    }
    return first;
  }

  /** 从「上传图片」文案节点向上找最近的含 file input 的祖先 */
  function tileFromTextNode(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    var guard = 0;
    while (el && guard < 6) {
      guard++;
      if (el.querySelector && el.querySelector('input[type="file"]')) return el;
      el = el.parentElement;
    }
    return null;
  }

  /* ——— 这个方块到底是不是「真正的上传框」 ———
   * 2026-11-08 真机教训(用户截图 + 诊断报告 20 个按钮):
   *   页面里还有两类东西也带 file input ——
   *     ① 平台拖拽控制器的**预览克隆**(#DOUXIAOER_DRAG_CONTROLLER 里的小方块);
   *     ② 图片编辑浮层上的工具条。
   *   它们被一并挂上按钮后把平台自己的浮层顶住了(用户原话「导致没法正常使用」)。
   * 所以挂载前必须过外形与语义四关:
   *   · 接受图片的 file input，不依赖空态文案;
   *   · 是方块:56~320,长宽比 0.5~2.2(工具条宽扁、克隆块很小);
   *   · 能点、不是半透明(克隆块常 pointer-events:none / opacity<1);
   *   · 不在拖拽控制器、也不在我们自己的浮层里。
   * 尺寸读不到(尚未布局 / jsdom)时不判尺寸 —— 由 isVisible 那关兜着,
   * 免得把「暂时没尺寸」误杀成「不是上传框」。 */
  /**
   * 空态文案是不是「上传图片」。
   *
   * ⚠️ 2026-11-08 真机第四次:这条**不能当硬门槛**。
   *   诊断日志「候选 28 · 已挂 0」+「不合格 body… · 没有「上传图片」文案」说明
   *   页面上明明有上传框，却一个都不含这四个字 —— 空态文案随类目/商品而变
   *   (「上传主图」「添加图片」「点击上传」…)，写死一句就等于自废武功。
   *   所以它现在只是**加分项**:有它优先、没它也能靠外形与位置成立。
   */
  function hasUploadHint(tile) {
    var text = tile.textContent || '';
    return text.indexOf('上传图片') >= 0;
  }

  function inFloatingChrome(tile) {
    if (tile.closest) {
      if (tile.closest('[id*="DRAG_CONTROLLER"], [class*="draggerContainer"], [class*="DragController"]')) return true;
      if (tile.closest('#dyb-status-bar, #dyb-debug-panel, #dyb-dialog-root')) return true;
      /* 平台自己的浮层容器(role=tooltip/menu/dialog,常 portal 到 body):
         里面的图片格**要**挂按钮 —— 2026-11-23 用户原话「回到能够注入到哪怕是
         浮动框,也能够有粘贴图片的按钮的时候」。所以它不算「表单外的浮动工具条」。 */
      if (tile.closest('[role="tooltip"], [role="menu"], [role="dialog"]')) return false;
    }
    /* 只认「表单里」的上传框:平台把拖拽预览克隆、图片工具条这类浮层
       直接挂在 body 上(不在表单滚动容器内) —— 用户截图里被顶住的就是它们。
       容器找不到时不做这条限制,免得整页一个按钮都不出。 */
    var form = null;
    try { form = document.getElementById('goodsEditScrollContainer'); } catch (e) { form = null; }
    if (form && !form.contains(tile)) return true;
    return false;
  }

  /**
   * 平台「来源菜单」那一行(「图像选择 / 图库选择」)里的按钮式上传入口。
   *
   * ⚠️ 2026-11-23 用户定(撤掉浮层闸):**浮层里的图片格要照常挂按钮**。
   *   此前按「整层浮层」判死(role=tooltip 的祖先一律不挂),结果浮层一开按钮消失、
   *   一关又回来 —— 用户看到的就是「时不时闪」。真正该排除的只有平台自己的菜单行:
   *     · 行节点自带 data-microp-*(2026-11-21 截图实证
   *       label[data-microp-model="micro"][data-microp-title="…"]);
   *     · 或者它本身就是带文字的 <label>(由 platformPickerRow 判)。
   *   向上只爬 3 层 —— 整个浮层容器也可能带 microp 属性,爬太远会把浮层里的图格
   *   一起判死,等于又回到「浮层里没按钮」。
   */
  var PICKER_ROW_ATTRS = ['data-microp-model', 'data-microp-title'];
  function inPickerMenuRow(tile) {
    var el = tile;
    var guard = 0;
    while (el && el.nodeType === 1 && guard < 3) {
      guard++;
      for (var i = 0; i < PICKER_ROW_ATTRS.length; i++) {
        try { if (el.hasAttribute(PICKER_ROW_ATTRS[i])) return true; } catch (e) { /* 只读节点 */ }
      }
      el = el.parentElement;
    }
    return false;
  }

  /**
   * 平台菜单项冒充「微型上传格」。
   *
   * 浮层万一没标 role,靠外形再兜一层:micro 尺寸的 `<label>` 自带 file input
   *   且里面有字,那是一条**菜单项**(「图像选择」4 个字),不是图片占位格 ——
   *   真格的规格图相机是无文字的小图标(尺寸同样 18~55,文本为空)。
   */
  function platformPickerRow(tile) {
    if (!tile || tile.tagName !== 'LABEL') return false;
    var text = (tile.textContent || '').replace(/\s+/g, '');
    return text.length >= 2;
  }

  /**
   * 从 file input 向上找「微型入口」——规格图那种 18~55px 的小图标。
   *
   * 2026-11-10 用户需求:规格图（颜色分类右侧的相机）也要能贴剪贴板图片。
   *   那个入口只有 24~32px，被常规档 56 的下限直接判死。
   * 只向上爬 4 层、碰到大容器就停 —— 避免认到整行然后把按钮挂在行尾。
   */
  function microTileFromInput(input) {
    var node = input.parentElement;
    var guard = 0;
    while (node && guard < 4) {
      guard++;
      var r = boxOf(node);
      if (r.width > 55 || r.height > 55) break;      // 已经爬到行/列容器,再往上没有意义
      if (r.width >= 18 && r.height >= 18) {
        var ratio = r.width / r.height;
        if (ratio >= 0.55 && ratio <= 1.8) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * 表格内的「常规图格」—— 让位给平台自带的来源菜单。
   *
   * 2026-11-21 用户截图:尺码表图片列(表头是「批量传图 / 全部SKU图」)每行那颗格子,
   *   点开是平台自己的浮层「粘贴图片 / 图库选择」——
   *   **平台原生就能粘贴**,扩展在同一格里再挂一颗同名按钮,既重复又压住格子本身
   *   (用户原话:「展开的按钮里面不要有粘贴图片的按钮的注入」)。
   * 判据:离它最近的表格是平台表格组件 `ecom-g-table`。
   *   这是组件库的稳定类名(不带构建哈希),不是某一版页面的样式实现。
   * 不受影响的位置:主图 / 详情图在 `styles_previewInstanceImgSortableList` 里,
   *   不在表格内;micro 档(规格图相机 24~32px)是直传入口,由调用方单独放行。
   */
  function inNativeTablePicker(tile) {
    if (!tile || !tile.closest) return false;
    try { return !!tile.closest('.ecom-g-table'); } catch (e) { return false; }
  }

  /**
   * 分类:这个候选是不是上传入口,是哪一档。
   *   'normal' 常规空白上传框(56~320 的方块)
   *   'micro'  微型入口(2026-11-10 新增:规格图那种 24~32px 的相机图标)
   *   null     不是
   *
   * 微型档的硬门槛是**框内必须有图片类型的 file input** —— 没有 input 就贴不进去,
   * 这条比外形更能说明「这是个上传入口」（页面上的删除/编辑小图标不会带 file input）。
   */
  function classifyTile(tile) {
    if (!tile || tile.nodeType !== 1) return null;
    if (!tile.isConnected) return null;
    if (!visible(tile)) return null;
    if (inFloatingChrome(tile)) return null;
    /* 平台「来源菜单」那一行不挂 —— 那里的 file input 是平台的菜单项,不是待填的
       图片格。⚠️ 只排除菜单行本身,**不再按整层浮层判死**(2026-11-23 用户定:
       浮层里的图片格要照常挂按钮,藏起来再放回来就是「时不时闪」)。 */
    if (inPickerMenuRow(tile)) return null;
    if (hasImage(tile)) return null;

    var hasInput = false;
    try { hasInput = !!inputForTile(tile); } catch (e) { hasInput = false; }
    if (!hasInput && !hasUploadHint(tile)) return null;

    var r = boxOf(tile);
    var known = r.width > 0 && r.height > 0;
    var normalSize = false;
    var microSize = false;
    if (known) {
      var ratio = r.width / r.height;
      normalSize = r.width >= 56 && r.width <= 320 && r.height >= 56 && r.height <= 320
        && ratio >= 0.5 && ratio <= 2.2;
      microSize = hasInput && r.width >= 18 && r.width <= 55 && r.height >= 18 && r.height <= 55
        && ratio >= 0.55 && ratio <= 1.8;
      if (!normalSize && !microSize) return null;
    }

    var st = null;
    try { st = window.getComputedStyle(tile); } catch (e) { st = null; }
    if (st) {
      if (st.pointerEvents === 'none') return null;
      var op = parseFloat(st.opacity);
      if (isFinite(op) && op < 0.6) return null;
      if (st.visibility === 'hidden') return null;
    }

    /* 表格内的常规图格(尺码表图片列等):平台点开自带「粘贴图片 / 图库选择」,
       扩展让位(用户 2026-11-21 连报两次)。
       ⚠️ 这道闸**必须走在「尺寸未知也放行」前面**:虚拟表格每次重渲染会短暂量到 0×0,
       否则同一批格子会在「量不到尺寸→挂上」与「量到了→摘掉」之间按重扫节奏翻来翻去,
       表现就是按钮不停闪(2026-11-21 诊断报告:已挂 11 / 19 每 430ms 交替)。
       只跳常规档 —— micro 档(规格图相机)是直传入口,用户明确需要,必须保留。 */
    if (inNativeTablePicker(tile) && !microSize) return null;

    /* 0×0 = 尺寸未知(还没布局 / jsdom):不判尺寸,按常规档放行。
       ⛔ 这里不能顺手要求「上传图片」文案 —— 资质格只有「＋ / 0/20」,
       那样会把真机上的资质格一起判死(2026-11-08 踩过)。 */
    if (!known) return 'normal';
    /* micro 档里也有冒充者:平台来源浮层的那几行是 48×34 的 <label>(带文字)。
       真格子的规格图相机是无文字小图标,不受这条影响。 */
    if (microSize && platformPickerRow(tile)) return null;
    return normalSize ? 'normal' : 'micro';
  }


  /** accept 同时支持图片 MIME 和扩展名列表。 */
  function acceptsImages(input) {
    if (input.disabled) return false;
    var accept = String(input.getAttribute('accept') || '').trim().toLowerCase();
    if (!accept) return true;
    return accept.split(',').some(function (part) {
      var token = part.trim();
      return /^image\//.test(token) || /^\.(png|jpe?g|jfif|gif|webp|bmp|avif|heic|heif|tiff?|svg|ico)$/.test(token);
    });
  }

  function collectTiles() {
    var out = [];
    var seen = [];

    function push(tile) {
      if (!tile || seen.indexOf(tile) >= 0) return;
      var input = inputForTile(tile);
      if (input && !acceptsImages(input)) return;
      seen.push(tile);
      out.push(tile);
    }

    var inputs;
    try { inputs = queryRoots('input[type="file"]'); } catch (e) { inputs = []; }
    for (var i = 0; i < inputs.length; i++) {
      if (!acceptsImages(inputs[i])) continue;
      /* 2026-11-10:同一个 input 走两条路认宿主 ——
         常规(向上找 56~320 的方块)与微型(就近找 18~55 的小图标)。
         两者都收进来,由 collectQualified 剔除"祖先与后代同时合格"的那一层。 */
      push(tileFromInput(inputs[i]));
      push(microTileFromInput(inputs[i]));
    }

    if (typeof findAllByText === 'function') {
      var nodes = [];
      try { nodes = findAllByText('上传图片') || []; } catch (e) { nodes = []; }
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].closest && nodes[j].closest('#' + 'dyb-status-bar')) continue;
        var tile = tileFromTextNode(nodes[j]);
        if (tile) push(tile);
      }
    }

    return out;
  }

  /* ==========================================================
   * 二、挂按钮
   * ========================================================== */

  function makeButton(tile) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute(BTN_ATTR, '1');
    btn.textContent = BTN_TEXT;
    btn.title = BTN_TIP;
    btn.setAttribute('aria-label', BTN_TIP);

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      startPaste(tile, btn);
    });
    /* 平台的上传区可能有「点整块就开选择窗」的监听:按钮上的按下与抬起都要截住,
       否则点粘贴会顺手打开系统窗口 —— 正是用户要避免的那一步。 */
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(function (t) {
      btn.addEventListener(t, function (ev) { ev.stopPropagation(); });
    });
    btn.addEventListener('mouseenter', function () { noteHover(tile); });
    return btn;
  }

  /**
   * 平台清掉按钮、却把格子节点留着 —— 属性还在、按钮没了。
   *
   * 2026-11-22 真机:诊断报告里「已挂 9」与「已挂 13」按重扫节奏交替,差的那 4 格
   *   一直补不回来,只是偶尔随节点被整体替换而复活。原因是 `mount()` 以
   *   `data-dyc-imgpaste-tile="1"` 当「已挂」凭据:React 复用格子节点、只清空子节点时,
   *   属性还在 ⇒ 每轮 mount 直接 return,按钮永远不会补回。
   *   ⇒ 凭据改成「按钮真的在框里」。属性只在按钮确实存在时才算数。
   */
  function mountedButtonIn(tile) {
    if (!tile || !tile.children) return null;
    for (var i = 0; i < tile.children.length; i++) {
      var c = tile.children[i];
      if (c.getAttribute && c.getAttribute(BTN_ATTR) === '1') return c;
    }
    return null;
  }

  function mount(tile, mode) {
    if (!tile) return;
    if (mountedButtonIn(tile)) return;
    if (tile.getAttribute(TILE_ATTR) === '1') {
      /* 属性在、按钮没了 = 平台清过子节点。把旧标记清掉,按新格子重新判一次。 */
      tile.removeAttribute(TILE_ATTR);
      tile.removeAttribute(MODE_ATTR);
    }
    if (!mode) mode = classifyTile(tile);
    if (!mode) return;

    var btn = makeButton(tile);
    ensureStyle(tile);
    /* 定在框内下方:absolute + 底边贴合(样式见 style.css .dyc-imgpaste-btn)。
       包含块需要 relative —— 平台这块多数是 position:static,才补一个;
       已是别的定位就不动它,避免把平台的绝对定位子元素带歪。 */
    try {
      var pos = window.getComputedStyle(tile).position;
      if (!pos || pos === 'static') tile.style.position = 'relative';
    } catch (e) { /* 拿不到样式就按 static 处理 */ }

    tile.appendChild(btn);
    tile.setAttribute(TILE_ATTR, '1');
    tile.setAttribute(MODE_ATTR, mode);

    if (mode === 'micro') {
      /* 微型:胶囊贴在小框**右侧空白处**、垂直居中(2026-11-22 用户定稿)。
         下方与框内都会被单元格裁切或被浮层盖住;右边是表格列的空白,不占框、不压图标。
         右侧放不下(贴着裁切区/视口边)时降级成 is-micro-inside —— 仍不遮图标中心。 */
      btn.classList.add('is-micro');
      btn.classList.add(microFitsRight(tile) ? 'is-micro-right' : 'is-micro-inside');
    } else {
      /* 小框(详情图那类 80px 的格子)用紧凑版:24px 高的按钮会盖住中间的「+」 */
      var r = boxOf(tile);
      if (r.height > 0 && r.height < 90) btn.classList.add('is-compact');
    }
    armTileGuard(tile, mode);
  }

  /**
   * 每格一个「就地补」观察器:平台清空子节点时,**在同一个回调里**把按钮补回去。
   *
   * 为什么要它:全局重扫是 400ms 防抖,按钮被平台清掉到补回来之间那段空白
   *   就是用户看到的闪(2026-11-21 报「不停闪烁」,摘除滞回治不住 —— 因为不是我们摘的)。
   *   与素材页名称「新节点就地补」同一套思路:不做批量重扫,只把这一个格子就地恢复。
   * 只盯 childList、只守自己这一格,平台的重渲染跑多少次都只在按钮真没了时才动手。
   */
  function armTileGuard(tile, mode) {
    disarmTileGuard(tile);
    var guard = new MutationObserver(function () {
      if (!tile.isConnected) { disarmTileGuard(tile); return; }
      if (mountedButtonIn(tile)) return;          // 按钮还在:这次变更与我们无关
      /* 平台刚清过子节点时,这一刻**往往连 input 都还没填回来**,classify 必然判 null。
         所以只有「确实不该再挂」(出图 / 进了浮层)才放手;其余情况保留观察器,
         等平台把子节点填回来那一刻再补 —— 提前放手等于这一轮放弃补挂。 */
      var now = classifyTile(tile);
      if (now) { mount(tile, now); noteRepair(tile); return; }
      if (mustDropNow(tile)) disarmTileGuard(tile);
    });
    try { guard.observe(tile, { childList: true }); } catch (e) { return; }
    try { tile.__dycImgGuard = guard; } catch (e) { /* 只读节点:放弃就地补 */ }
  }

  /* 就地补留痕:平台到底会不会反复清掉按钮,这是唯一能实证的地方。
     节流 3 秒一条(首条带格子长相),避免重渲染期把调试面板刷满。 */
  var repairCount = 0;
  var repairLoggedAt = 0;
  function noteRepair(tile) {
    repairCount++;
    var now = Date.now();
    if (now - repairLoggedAt < 3000) return;
    repairLoggedAt = now;
    var cls = (tile && typeof tile.className === 'string' ? tile.className : '').trim().split(/\s+/)[0] || '';
    var r = tile ? boxOf(tile) : { width: 0, height: 0 };
    log('图片粘贴:就地补 ' + repairCount + ' 次 · 本格 '
      + (tile ? tile.tagName.toLowerCase() : '?') + (cls ? '.' + cls : '')
      + ' · ' + Math.round(r.width) + '×' + Math.round(r.height));
  }

  function disarmTileGuard(tile) {
    if (!tile) return;
    var g = tile.__dycImgGuard;
    if (g) { try { g.disconnect(); } catch (e) { /* 已断开 */ } }
    try { tile.__dycImgGuard = null; } catch (e) { /* 只读节点 */ }
  }

  /** 祖先裁切区与视口求交(右侧放不放得下就靠它) */
  function clipFor(tile) {
    var doc = tile.ownerDocument || document;
    var win = doc.defaultView || window;
    var clip = { l: 0, t: 0, r: win.innerWidth || 0, b: win.innerHeight || 0 };
    var node = tile.parentElement;
    var guard = 0;
    while (node && guard < 40) {
      guard++;
      var ov = '';
      try { ov = win.getComputedStyle(node).overflow || ''; } catch (e) { ov = ''; }
      if (/hidden|auto|scroll/.test(ov)) {
        var b = boxOf(node);
        if (b.width > 0 && b.height > 0) {
          clip.l = Math.max(clip.l, b.left);
          clip.t = Math.max(clip.t, b.top);
          clip.r = Math.min(clip.r, b.left + b.width);
          clip.b = Math.min(clip.b, b.top + b.height);
        }
      }
      node = node.parentElement;
    }
    return clip;
  }

  /** 小框右侧的空白放不放得下一颗 34px 胶囊(含 4px 间距) */
  function microFitsRight(tile) {
    var r = boxOf(tile);
    if (!(r.width > 0)) return false;
    var clip = clipFor(tile);
    return r.left + r.width + 4 + 34 <= clip.r;
  }

  /** 只摘「框内按钮」及它们的标记(尺码图按钮、商详工具栏按钮各自有卸载函数) */
  function unmountTiles() {
    var btns = queryRoots('[' + BTN_ATTR + ']');
    for (var i = 0; i < btns.length; i++) {
      var tile = btns[i].parentElement;
      if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
      disarmTileGuard(tile);
      if (tile && tile.getAttribute(TILE_ATTR) === '1') {
        tile.removeAttribute(TILE_ATTR);
        tile.removeAttribute(MODE_ATTR);
      }
    }
    /* 框内按钮都摘了,承载它们的样式表就多余了。
       尺码图按钮与商详工具栏按钮用的是内联样式,不依赖这张表 ——
       所以「只关『粘贴图片』、开着『粘贴尺码图』」时也要把表撤掉。 */
    try {
      queryRoots('style[' + SHADOW_STYLE + ']').forEach(function (s) { s.remove(); });
    } catch (e) { /* 移除失败不影响按钮已摘除这件事 */ }
  }

  function unmountAll() {
    unmountTiles();
    unmountToolbars();
    unmountSizeChart();
  }

  /** 每个框独立判断，主图文案不能屏蔽同页只有「＋ / 0/20」的资质格。 */
  function collectQualified() {
    var tiles = collectTiles();
    var use = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      /* 已挂的格子不再重判(2026-11-22 掉线留痕钉死):label.styles-module_button__v_0O2
         这批格子会在 97×97 与 43×43 之间抖 —— 每轮重判尺寸,就一轮「合格挂上」、
         一轮「太小摘掉」,交替不停,这就是闪烁的完整机理。
         尺寸档只负责「初次认框」;已挂的只在确凿失效时摘:
           离开文档 / 已出图 / 进了平台浮层(mustDropNow),其余一律保留。 */
      if (t.getAttribute && t.getAttribute(MODE_ATTR)) {
        /* 已挂的保留条件收紧到语义级:框里还得有图片 file input。
           尺寸、可见性抖动不再参与 —— 那正是 97↔43 闪烁的来源。 */
        var stillInput = false;
        try { stillInput = !!inputForTile(t); } catch (e) { stillInput = false; }
        if (!t.isConnected || !stillInput || mustDropNow(t)) continue;
        use.push(t);
        continue;
      }
      var mode = classifyTile(t);
      if (!mode) continue;
      try { t.setAttribute(MODE_ATTR, mode); } catch (e) { /* 只读节点 */ }
      use.push(t);
    }

    /* 同一处只留最内层:行容器与行内小图标同时合格时,只挂小图标。
       否则规格行上会出现两枚「粘贴图片」(2026-11-10 加微型档后必须去重)。 */
    if (use.length > 1) {
      use = use.filter(function (t) {
        for (var k = 0; k < use.length; k++) {
          if (use[k] !== t && t.contains(use[k])) return false;
        }
        return true;
      });
    }
    return { all: tiles, use: use, tier: '结构' };
  }

  /* 连续「本轮没通过」的计数(键 = 承载按钮的格子)。
     用途见 scan() 清理段:滞回一轮,治「挂上-摘掉」来回翻造成的闪烁。 */
  var missCounts = new Map();

  /** 不能等缓冲、必须当场摘的情形:已出图、自己变成了平台来源菜单行。 */
  function mustDropNow(tile) {
    if (!tile) return true;
    if (hasImage(tile)) return true;
    return inPickerMenuRow(tile);
  }

  /* ---- 新格子就地挂(2026-11-22 用户实测「按钮消失、滚动一下又回来」) ----
     SKU 图这类格子住在**虚拟表格**里:滚动时行被回收,旧行连我们的按钮一起销毁,
     新行要等 400ms 防抖重扫才补挂 —— 这段空白就是体感上的「消失」。
     改成:观察器回调里直接对本次新增的节点就地走认框+挂载(素材页同款思路),
     预算 60 个节点,超出交给全量重扫。浮层开着也照挂(2026-11-23 撤掉浮层闸)。 */
  function quickMount(records) {
    if ((!on && !sizeOn) || !inScope()) return;
    var seen = 0;
    for (var i = 0; i < records.length && seen < 60; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length && seen < 60; j++) {
        var node = added[j];
        if (!node || node.nodeType !== 1) continue;
        seen++;
        if (node.tagName === 'INPUT' && node.type === 'file') { mountForInput(node); continue; }
        var inputs;
        try { inputs = node.querySelectorAll('input[type="file"]'); } catch (e) { continue; }
        for (var k = 0; k < inputs.length; k++) mountForInput(inputs[k]);
      }
    }
  }

  function mountForInput(input) {
    if (!acceptsImages(input)) return;
    var t1 = tileFromInput(input);
    if (t1) { repairLogFor(t1); mount(t1); }
    var t2 = microTileFromInput(input);
    if (t2) { repairLogFor(t2); mount(t2); }
  }

  /* 格子还挂着旧标记、按钮却没了 = 平台清过子节点,这次是补挂 —— 留一条节流日志 */
  function repairLogFor(tile) {
    if (tile && tile.getAttribute(TILE_ATTR) === '1' && !mountedButtonIn(tile)) noteRepair(tile);
  }

  /** 幂等重扫:新框挂上、已出图的框摘掉、被平台重渲染掉的补回来 */
  function scan() {
    if (!on && !sizeOn) return;
    if (!inScope()) { unmountAll(); refreshRoots(); return; }
    refreshRoots();

    /* 只开了「粘贴尺码图」:不认上传框,只维护行级按钮 */
    if (!on) {
      unmountTiles();
      unmountToolbars();
      if (sizeOn) mountSizeChart(); else unmountSizeChart();
      return;
    }

    var q = collectQualified();
    for (var i = 0; i < q.use.length; i++) mount(q.use[i], q.use[i].getAttribute(MODE_ATTR));

    /* 清理:不在本次名单里的,按「两轮不合格才摘」处理。
       为什么不是一轮就摘(2026-11-21 用户报「按钮不停闪烁」):
       平台重渲染的瞬间,格子的尺寸 / 内部 input 会短暂读不到,某一轮判 null、
       下一轮又判合格 —— 一轮即摘就会挂上-摘掉-挂上地翻,肉眼就是闪;
       而且每次挂/摘都是 childList 变更,反过来又触发下一轮重扫,自激不停。
       所以留一轮缓冲(滞回),让「瞬时读不到」自己恢复,只有真失效才摘。 */
    var btns = queryRoots('[' + BTN_ATTR + ']');
    for (var j = 0; j < btns.length; j++) {
      var t = btns[j].parentElement;
      if (t && t.isConnected && q.use.indexOf(t) >= 0) {
        missCounts.delete(t);
        continue;
      }
      if (t && t.isConnected && !mustDropNow(t) && (missCounts.get(t) || 0) < 1) {
        missCounts.set(t, 1);
        continue;
      }
      missCounts.delete(t);
      if (btns[j].parentNode) btns[j].parentNode.removeChild(btns[j]);
      disarmTileGuard(t);
      noteDrop(t, t ? rejectReason(t) : '节点已不在文档');
      if (t && t.getAttribute(TILE_ATTR) === '1') {
        t.removeAttribute(TILE_ATTR);
        t.removeAttribute(MODE_ATTR);
      }
    }
    if (missCounts.size > 200) missCounts.clear();

    mountToolbars();
    if (sizeOn) mountSizeChart(); else unmountSizeChart();

    summarize(q);
    return q;
  }

  /* ==========================================================
   * 二之二、商详图片工具栏按钮(2026-11-10 用户需求)
   *
   * 用户原话:「从主图填入的左边,也做剪贴板上图的按钮」。
   * 商详图片那一块 8 张全是已出图的格子,按「有图不挂」的规矩那里一个按钮都没有,
   * 所以这里做**行级按钮**:点一次读剪贴板,把图追加到列表末尾
   * （与平台自己的「上传图片」一致:不插空位、不改顺序）。
   *
   * 定位不写死类名:先找「从主图填入」这颗按钮(全页唯一),
   * 它的父元素就是按钮组;再向上找最近的、含图片 file input 的祖先当区块根。
   * 取 input **只在区块根内取** —— 取不到就报错,绝不跨区块去拿主图/白底图的。
   * ========================================================== */

  var toolbarBusy = false;

  function insideForm(el) {
    var form = null;
    try { form = document.getElementById('goodsEditScrollContainer'); } catch (e) { form = null; }
    if (!form) return true;          // 别的布局(微信)没有这个容器,不做限制
    return form.contains(el);
  }

  /** 在 root 下按文本找按钮(优先返回真正的 <button> 祖先) */
  function findByText(root, text, limit) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    var walker = null;
    try { walker = document.createTreeWalker(root, 4, null, false); } catch (e) { walker = null; }
    if (!walker) return out;
    var n;
    while ((n = walker.nextNode())) {
      var t = (n.nodeValue || '').trim();
      if (!t || t.indexOf(text) < 0) continue;
      var el = n.parentElement;
      var up = el;
      var guard = 0;
      while (up && guard < 3) {
        if (up.tagName === 'BUTTON') { el = up; break; }
        up = up.parentElement;
        guard++;
      }
      if (el && out.indexOf(el) < 0) out.push(el);
      if (out.length >= (limit || 3)) break;
    }
    return out;
  }

  function firstImageInput(scope) {
    var list;
    try { list = scope.querySelectorAll('input[type="file"]'); } catch (e) { return null; }
    for (var i = 0; i < list.length; i++) {
      if (acceptsImages(list[i])) return list[i];
    }
    return null;
  }

  /** 「商详图片（8/50）」→ {cur:8, max:50};读不到返回 null(不拦) */
  function readCount(root) {
    if (!root) return null;
    var walker = null;
    try { walker = document.createTreeWalker(root, 4, null, false); } catch (e) { return null; }
    var n;
    var guard = 0;
    while ((n = walker.nextNode()) && guard < 400) {
      guard++;
      var t = (n.nodeValue || '').trim();
      if (!t || t.indexOf('商详图片') < 0) continue;
      var m = t.match(/[（(]\s*(\d+)\s*\/\s*(\d+)\s*[）)]/);
      if (m) return { cur: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    }
    return null;
  }

  function findToolbarHost() {
    var anchors = findByText(document, TOOLBAR_ANCHOR, 3);
    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      if (!visible(anchor)) continue;
      if (!insideForm(anchor)) continue;          // 弹窗里的同名按钮不算
      var group = anchor.parentElement;
      if (!group) continue;
      var root = null;
      var node = group;
      var guard = 0;
      while (node && guard < 6) {
        guard++;
        if (firstImageInput(node)) { root = node; break; }
        node = node.parentElement;
      }
      if (!root) continue;
      return { anchor: anchor, group: group, root: root };
    }
    return null;
  }

  function makeToolbarButton(host) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = TOOLBAR_CLASS;
    btn.setAttribute(TOOLBAR_ATTR, '1');
    btn.textContent = BTN_TEXT;
    btn.title = TOOLBAR_TIP;
    btn.setAttribute('aria-label', TOOLBAR_TIP);

    /* 与平台那颗「从主图填入」同高。读不到就按 32 兜底(注入控件用固定 px)。 */
    var h = Math.round(boxOf(host.anchor).height) || 32;
    btn.style.cssText = 'box-sizing:border-box;height:' + h + 'px;padding:0 12px;'
      + 'margin:0 8px 0 0;border:1px solid #d6e2ff;border-radius:6px;'
      + 'background:#eef3ff;color:#1664ff;'
      + 'font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;'
      + 'font-size:13px;line-height:1;cursor:pointer;vertical-align:middle;white-space:nowrap;';

    btn.addEventListener('mouseenter', function () {
      if (btn.disabled) return;
      btn.style.background = '#1664ff';
      btn.style.borderColor = '#1664ff';
      btn.style.color = '#fff';
    });
    btn.addEventListener('mouseleave', function () {
      if (btn.disabled) return;
      btn.style.background = '#eef3ff';
      btn.style.borderColor = '#d6e2ff';
      btn.style.color = '#1664ff';
    });

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toolbarPaste(host, btn);
    });
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(function (t) {
      btn.addEventListener(t, function (ev) { ev.stopPropagation(); });
    });
    return btn;
  }

  function mountToolbars() {
    var host = findToolbarHost();
    if (!host) return;
    var exist = host.group.querySelector('[' + TOOLBAR_ATTR + ']');
    if (exist) {
      /* 平台重渲染可能把锚点挪位:按钮跟着回到锚点左边 */
      if (exist.nextElementSibling !== host.anchor) {
        try { host.group.insertBefore(exist, host.anchor); } catch (e) { /* 结构变了不硬来 */ }
      }
      return;
    }
    var btn = makeToolbarButton(host);
    try {
      host.group.insertBefore(btn, host.anchor);
    } catch (e) {
      log('商详工具栏:插入失败 ' + ((e && e.message) || e));
    }
  }

  function unmountToolbars() {
    var btns = queryRoots('[' + TOOLBAR_ATTR + ']');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
    }
  }

  /* ==========================================================
   * 二之三、尺码图「粘贴尺码图」行级按钮(2026-11-21 用户需求)
   *
   * 用户原话:「解析尺码图的右边,加一个粘贴尺码图的按钮,
   *   可以直接把剪贴板的图片粘贴进左边的这个按钮里面」。
   *
   * 落点:锚点按钮**右侧紧邻**,与它同高。
   * 取图入口:从锚点向上找最近的、含图片 file input 的祖先当区块根(最多 6 层);
   *   取不到再退一步 —— 在锚点附近找一颗最近的空闲上传格。
   *   **只在区块内取**,绝不跨区块拿主图/白底图的 input。
   * 成功判据:区块内 <img> 变多(与商详工具栏同一口径)。
   * ========================================================== */

  var sizeBusy = false;
  var sizeAnchor = null;      // 命中后缓存;平台重渲染会让它 isConnected=false,自动失效
  var sizeMissAt = 0;         // 上次「全文档找不到」的时刻,1 秒内不重复遍历
  var sizeLogged = {};

  function sizeSayOnce(key, msg) {
    if (sizeLogged[key]) return;
    sizeLogged[key] = 1;
    log(msg);
  }

  /** 找不到锚点:把页面上「含尺码」的候选文案打出来。
   *  按真实文案补锚点,不靠猜 —— 与 live/nav.js 的 dumpAnchorDiagnostics 同一口径。
   *  清单变了才再打一条,避免每次重扫刷屏。 */
  function dumpSizeAnchors(hits) {
    var out = [];
    for (var i = 0; i < hits.length && out.length < 10; i++) {
      var el = hits[i];
      var t = (el.textContent || '').replace(/\s+/g, '');
      if (t.length > 24) t = t.slice(0, 24) + '…';
      var cls = (el.className && typeof el.className === 'string')
        ? '.' + el.className.trim().split(/\s+/)[0] : '';
      var s = el.tagName.toLowerCase() + cls + '「' + t + '」';
      if (out.indexOf(s) < 0) out.push(s);
    }
    sizeSayOnce('miss', '尺码图:没找到「' + SIZE_ANCHOR + '」· 含「尺码」的候选 '
      + (out.join(' / ') || '无'));
  }

  /** 锚点:三条路径,任一命中即用。
   *  ① 平台埋点属性 `data-kora-json="AI解析尺码图"` —— **真机首选的唯一原因**:
   *     2026-11-21 截图 + DevTools 证实,这颗按钮里没有文本节点(只有 <img alt="AI解析图片">),
   *     文案只存在于 data 属性上,所以按文本找永远落空。
   *  ② 图标 alt —— 属性被平台改名时的近邻兜底。
   *  ③ 文本 —— 平台哪天真把文案写回 DOM 时照旧能用。 */
  function probeSizeAnchor() {
    var marks = [];
    try { marks = queryRoots('[data-kora-json*="' + SIZE_ANCHOR + '"]'); } catch (e) { marks = []; }
    for (var a = 0; a < marks.length; a++) {
      if (visible(marks[a])) return marks[a];
    }

    var alts = [];
    try { alts = queryRoots('img[alt*="解析图片"]'); } catch (e) { alts = []; }
    for (var b = 0; b < alts.length; b++) {
      if (!visible(alts[b])) continue;
      try { return alts[b].closest('[data-kora-json]') || alts[b].parentElement || alts[b]; } catch (e) { return alts[b]; }
    }

    var exact = findByText(document, SIZE_ANCHOR, 3);
    for (var i = 0; i < exact.length; i++) {
      if (visible(exact[i])) return exact[i];
    }
    var loose = findByText(document, '尺码图', 8);
    for (var j = 0; j < loose.length; j++) {
      var el = loose[j];
      if (!visible(el)) continue;
      if (/解析|识别|上传/.test(el.textContent || '')) return el;
    }
    return null;
  }

  function findSizeAnchor() {
    if (sizeAnchor && sizeAnchor.isConnected) return sizeAnchor;
    sizeAnchor = null;
    var now = Date.now();
    /* 刚找过没有就等 1 秒再遍历:页面 8000+ 元素,TreeWalker 不该被每次重扫拖着跑 */
    if (now - sizeMissAt < 1000) return null;
    var found = probeSizeAnchor();
    if (found) { sizeAnchor = found; return found; }
    sizeMissAt = now;
    var all = [];
    try { all = findByText(document, '尺码', 10); } catch (e) { all = []; }
    dumpSizeAnchors(all);
    return null;
  }

  function findSizeHost() {
    var anchor = findSizeAnchor();
    if (!anchor) return null;

    /* 挂载点 = 锚点自己。真机结构:
         <ul style="display:flex;flex-wrap:wrap">
           <label style="width:100%"><input type=file><div data-kora-json="AI解析尺码图">…
       2026-11-22 修正:label 是 width:100% 的块,按钮插在 label **后面**会被 flex-wrap
       挤到下一行(用户截图「错位了」)。所以按钮落在 label **内部**、紧跟锚点右边。
       点它不会弹平台的选文件窗:makeSizeButton 对 click 做了 preventDefault,
       label 的默认激活因此被拦下,且所有按下/抬起事件都 stopPropagation。 */
    var mount = anchor;
    if (!mount.parentElement) return null;

    var root = null;
    var node = mount;           // 锚点外层 label 就含 input,从它开始向上找
    var guard = 0;
    while (node && guard < 6) {
      guard++;
      if (firstImageInput(node)) { root = node; break; }
      node = node.parentElement;
    }

    if (!root) {
      /* 锚点旁边没有常驻 input(点了才创建) —— 退到最近的一颗空闲上传格。
         ⛔ 这里**不走 classifyTile**:它对表格内常规图格一律判死(平台自带粘贴菜单),
            而尺码图恰恰常落在表格里,走它等于把唯一的退路也堵上。 */
      var tiles = [];
      try { tiles = collectTiles(); } catch (e) { tiles = []; }
      var ar = boxOf(anchor);
      var best = null;
      var bestD = Infinity;
      for (var i = 0; i < tiles.length && i < 80; i++) {
        var t = tiles[i];
        if (!t || !t.isConnected || !visible(t) || hasImage(t)) continue;
        var tr = boxOf(t);
        var d = Math.abs(tr.top - ar.top) + Math.abs(tr.left - ar.left);
        if (d < bestD) { bestD = d; best = t; }
      }
      root = best;
    }
    if (!root) {
      var at = (anchor.textContent || anchor.getAttribute('data-kora-json') || '')
        .replace(/\s+/g, '').slice(0, 16);
      sizeSayOnce('noroot', '尺码图:锚点「' + at + '」附近没有图片上传入口');
      return null;
    }
    return { anchor: anchor, mount: mount, root: root };
  }

  /** 尺码图区域的观察范围:向上找最近一个 class 含 module 的容器
   *  (真机是 style-module_batchImageUpload_xxx)——解析结果与预览常落在 label **外面**,
   *  只看 label 会「实际成功却判失败」。找不到就退回 input 所在节点。 */
  function sizeScope(host) {
    var node = host.mount || host.anchor;
    var guard = 0;
    while (node && guard < 6) {
      guard++;
      var cn = (typeof node.className === 'string') ? node.className : '';
      if (cn.indexOf('module') >= 0) return node;
      node = node.parentElement;
    }
    return host.root || host.anchor;
  }

  function makeSizeButton(host) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = SIZE_CLASS;
    btn.setAttribute(SIZE_ATTR, '1');
    btn.textContent = SIZE_TEXT;
    btn.title = SIZE_TIP;
    btn.setAttribute('aria-label', SIZE_TIP);

    /* 与左边那颗「解析尺码图」同高;读不到按 32 兜底(注入控件用固定 px)。
       位置由 placeSizeButton 用绝对定位接管 —— 这里不写 margin/left。 */
    var h = Math.round(boxOf(host.anchor).height) || 32;
    btn.style.cssText = 'box-sizing:border-box;height:' + h + 'px;padding:0 12px;'
      + 'margin:0;border:1px solid #d6e2ff;border-radius:6px;'
      + 'background:#eef3ff;color:#1664ff;'
      + 'font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;'
      + 'font-size:13px;line-height:1;cursor:pointer;white-space:nowrap;';

    btn.addEventListener('mouseenter', function () {
      if (btn.disabled) return;
      btn.style.background = '#1664ff';
      btn.style.borderColor = '#1664ff';
      btn.style.color = '#fff';
    });
    btn.addEventListener('mouseleave', function () {
      if (btn.disabled) return;
      btn.style.background = '#eef3ff';
      btn.style.borderColor = '#d6e2ff';
      btn.style.color = '#1664ff';
    });
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      sizePaste(host, btn);
    });
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(function (t) {
      btn.addEventListener(t, function (ev) { ev.stopPropagation(); });
    });
    return btn;
  }

  /**
   * 把按钮绝对定位贴到锚点右侧。
   *
   * 为什么不靠正常流:真机的 label 是 `width:100%` 的块级容器,里面那颗
   * `div.uploadButton` 也占整行 —— 按钮不管插在 label 后面还是锚点后面都会换行
   * (用户 2026-11-22 两次截图都是这个现象)。
   * 定位基准取 label(padding box),用 getBoundingClientRect 求差,
   * 比 offsetLeft 稳:不受中间哪一层变成 positioned 祖先的影响。
   * label 若不是 positioned,补 relative(它内部只有隐藏的 file input 与那颗按钮,
   * 补 relative 不会带偏任何已有的绝对定位子元素)。
   */
  function placeSizeButton(btn, host) {
    var base = host.mount && host.mount.parentElement;
    if (!btn || !base || !host.anchor) return;
    try {
      var pst = window.getComputedStyle(base).position;
      if (!pst || pst === 'static') base.style.position = 'relative';
    } catch (e) { /* 拿不到样式就按 static 处理 */ }

    var h = Math.round(boxOf(host.anchor).height) || 32;
    var br = boxOf(base);
    var ar = boxOf(host.anchor);
    btn.style.position = 'absolute';
    btn.style.margin = '0';
    btn.style.height = h + 'px';
    btn.style.left = (ar.right - br.left + 8) + 'px';
    btn.style.top = (ar.top - br.top + Math.max(0, Math.round((ar.height - h) / 2))) + 'px';
    btn.style.zIndex = '2';
  }

  function mountSizeChart() {
    var host = findSizeHost();
    if (!host) return;
    var group = host.mount.parentElement;
    if (!group) return;

    var exist = group.querySelector('[' + SIZE_ATTR + ']');
    if (exist) {
      /* 页面重渲染 / 响应式改宽度后,绝对坐标要跟着锚点重算 */
      placeSizeButton(exist, host);
      return;
    }
    var btn = makeSizeButton(host);
    try {
      group.insertBefore(btn, host.mount.nextSibling);
      placeSizeButton(btn, host);
      var at = (host.anchor.textContent || host.anchor.getAttribute('data-kora-json') || '')
        .replace(/\s+/g, '').slice(0, 16);
      sizeSayOnce('mounted', '尺码图:已挂到「' + at + '」右侧');
    } catch (e) {
      log('尺码图:插入失败 ' + ((e && e.message) || e));
    }
  }

  function unmountSizeChart() {
    var btns = queryRoots('[' + SIZE_ATTR + ']');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
    }
  }

  function sizePaste(host, btn) {
    if (!sizeOn || !inScope()) return;
    if (sizeBusy) return;

    if (!host || !host.root || !host.root.isConnected) {
      host = findSizeHost();
      if (!host) {
        say('找不到「解析尺码图」旁边的上传入口', 'alert', '未入框',
          '这一块里没有可写入的文件输入框。请点平台自己的上传入口手动选一张;若每次都不行,把这个提示发给开发者。');
        log('尺码图:找不到区块根');
        return;
      }
    }

    var input = firstImageInput(host.root);
    if (!input) {
      say('找不到尺码图的上传入口', 'alert', '未入框',
        '区块内没有可写入的图片输入框。请点左边「解析尺码图」里的上传入口手动选一张。');
      log('尺码图:区块内没有 file input');
      return;
    }

    sizeBusy = true;
    setBtn(btn, '读取剪贴板…', true);
    log('尺码图:开始');

    readImage().then(function (img) {
      if (!img || !img.ok) {
        var why = (!img || !img.error || img.error === NO_IMAGE) ? '剪贴板里没有图片' : img.error;
        say('剪贴板里没有图片', 'alert', '未入框',
          why + '。请先截图或复制一张尺码图,再点一次「粘贴尺码图」。');
        log('尺码图:读取失败 ' + why);
        return null;
      }
      if (!sizeOn || !inScope()) return null;

      var file;
      try { file = toFile(img); } catch (e) {
        say('图片读不出来', 'alert', '未入框', (e && e.message) || '图片转码失败');
        return null;
      }

      var scope = sizeScope(host);
      var base = scope.querySelectorAll('img').length;
      var basePreview = previewCount();
      setBtn(btn, '粘贴中…', true);

      var ok = false;
      try { ok = putFilesToInput(input, file); } catch (e) { ok = false; }
      if (!ok) {
        /* 只认拖拽/粘贴事件的组件再补一次(与商详工具栏同一兜底) */
        try { putByEvent(host.root, file, 'drop'); ok = true; } catch (e) { ok = false; }
      }
      if (!ok) {
        say('图片没能贴进去', 'alert', '未入框',
          '这个上传入口不接受程序写入。请点左边「解析尺码图」里的上传入口手动选择文件。');
        log('尺码图:两条通道都没交进去');
        return null;
      }

      /* 2026-11-22:等待 4 秒 → 8 秒,观察范围从 label 扩到模块容器。
         用户实测「很快提示失败、实际都成功」就是这两件事造成的。 */
      return waitImageGrow(scope, base, 8000, basePreview).then(function (got) {
        if (got) {
          say('尺码图', 'success', '已入框');
          log('尺码图:成功');
        } else {
          say('尺码图已交给平台，未看到预览', 'alert', '待确认',
            '文件已经交给平台,但页面上还没出现预览或解析结果。平台可能还在处理 —— 请等几秒再看,不要重复点击;若始终没有,请点「AI 解析尺码图」手动选择文件。');
          log('尺码图:已交付但未看到预览');
        }
        return null;
      });
    }).catch(function (e) {
      log('尺码图异常:' + ((e && e.message) || e));
      say('粘贴出错', 'alert', '未入框', (e && e.message) || String(e));
    }).then(function () {
      sizeBusy = false;
      setBtn(btn, SIZE_TEXT, false);
      scheduleScan(600);
    });
  }

  /** 区块内图片总数涨了 = 平台把图收下了 */
  function waitImageGrow(root, base, ms, basePreview) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function tick() {
        if (!root || !root.isConnected) { resolve(false); return; }
        if (root.querySelectorAll('img').length > base) { resolve(true); return; }
        if (typeof basePreview === 'number' && previewCount() > basePreview) { resolve(true); return; }
        if (Date.now() - start >= ms) { resolve(false); return; }
        setTimeout(tick, 150);
      })();
    });
  }

  function toolbarPaste(host, btn) {
    if (!on || !inScope()) return;
    if (toolbarBusy) return;

    if (!host || !host.root || !host.root.isConnected) {
      host = findToolbarHost();
      if (!host) return;
    }

    var cnt = readCount(host.root);
    if (cnt && cnt.max && cnt.cur >= cnt.max) {
      say('商详图片已满 ' + cnt.max + ' 张', 'alert', '未上传',
        '先删掉几张再贴,平台本身也不让超过 ' + cnt.max + ' 张。');
      log('商详工具栏:张数已满 ' + cnt.cur + '/' + cnt.max);
      return;
    }

    var input = firstImageInput(host.root);
    if (!input) {
      say('找不到商详图片的上传入口', 'alert', '未上传',
        '这一块里没有可写入的文件输入框。请点平台自己的「上传图片」手动选一张;若每次都不行,把这个提示发给开发者。');
      log('商详工具栏:区块内没有 file input');
      return;
    }

    toolbarBusy = true;
    setBtn(btn, '读取剪贴板…', true);
    log('商详工具栏:开始');

    readImage().then(function (img) {
      if (!img || !img.ok) {
        var why = (!img || !img.error || img.error === NO_IMAGE) ? '剪贴板里没有图片' : img.error;
        say('剪贴板里没有图片', 'alert', '未上传',
          why + '。请先截图或复制一张图片,再点一次「粘贴图片」。');
        return null;
      }
      if (!on || !inScope()) return null;

      var file;
      try { file = toFile(img); } catch (e) {
        say('图片读不出来', 'alert', '未上传', (e && e.message) || '图片转码失败');
        return null;
      }

      var base = host.root.querySelectorAll('img').length;
      var basePreview = previewCount();
      setBtn(btn, '粘贴中…', true);

      var ok = false;
      try { ok = putFilesToInput(input, file); } catch (e) { ok = false; }
      if (!ok) {
        /* 塞不进 input 的组件(只认拖拽/粘贴的)再试一次事件 */
        try { putByEvent(host.root, file, 'drop'); ok = true; } catch (e) { ok = false; }
      }
      if (!ok) {
        say('图片没能贴进去', 'alert', '未上传',
          '这一块的上传入口不接受程序写入。请点平台自己的「上传图片」手动选择文件。');
        return null;
      }

      return waitImageGrow(host.root, base, 6000, basePreview).then(function (got) {
        if (got) {
          say('图片', 'success', '已入框');
          log('商详工具栏:成功');
        } else {
          say('图片已交给平台，未看到预览', 'alert', '待确认',
            '文件已经交给平台,但页面上还没出现新图片。平台可能还在处理 —— 请等几秒再看,不要重复点击;若始终没有,请手动上传。');
          log('商详工具栏:已交付但未看到预览');
        }
        return null;
      });
    }).catch(function (e) {
      log('商详工具栏异常:' + ((e && e.message) || e));
      say('粘贴出错', 'alert', '未上传', (e && e.message) || String(e));
    }).then(function () {
      toolbarBusy = false;
      setBtn(btn, BTN_TEXT, false);
      /* 贴完按钮还在(行级入口常驻),只重扫一次把新增格子的按钮补齐 */
      scheduleScan(600);
    });
  }

  function scheduleScan(delay) {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      try { scan(); } catch (e) { log('重扫失败:' + ((e && e.message) || e)); }
    }, delay || 350);
  }

  /* ==========================================================
   * 三、读剪贴板图片
   *
   * 2026-11-08 真机(360 极速X,Chrome/148):离屏文档里
   * navigator.clipboard.read() 报「Document is not focused」——
   * 离屏文档天生没有焦点,这个内核没有给 CLIPBOARD reason 开豁免。
   * ⇒ 改成四条路,哪条通用哪条:
   *   ① 内容脚本直读(按钮点击 = 用户手势 + clipboardRead 权限,最正统);
   *   ② 直读报「not focused」时拉回焦点重试一次;
   *   ③ 离屏文档代读(老路径,别的内核可能好使);
   *   ④ execCommand('paste') 塞进隐藏 contenteditable,从 paste 事件拿图。
   * ========================================================== */

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { reject(new Error('图片数据读不出来')); };
        fr.readAsDataURL(blob);
      } catch (e) { reject(e); }
    });
  }

  var NO_IMAGE = '__NO_IMAGE__';   // 「剪贴板里没图」的统一内部标记

  /** 路径① 内容脚本直读(任何失败都转成 {ok:false,error},不往外抛 rejection) */
  function readDirect() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      return Promise.resolve({ ok: false, error: '本内核没有 navigator.clipboard' });
    }
    return navigator.clipboard.read().then(function (items) {
      for (var i = 0; i < items.length; i++) {
        var types = items[i].types || [];
        for (var j = 0; j < types.length; j++) {
          if (/^image\//.test(types[j])) {
            var ty = types[j];
            return items[i].getType(ty).then(function (blob) {
              return blobToDataUrl(blob).then(function (dataUrl) {
                return { ok: true, dataUrl: dataUrl, mime: ty, size: blob.size, via: 'direct' };
              });
            });
          }
        }
      }
      return { ok: false, error: NO_IMAGE };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    });
  }

  /** 路径③ 离屏文档代读(老路径) */
  function readOffscreen() {
    return new Promise(function (resolve) {
      var settled = false;
      function done(r) { if (!settled) { settled = true; resolve(r); } }
      try {
        chrome.runtime.sendMessage({ type: 'dyc:readClipboardImage' }, function (res) {
          var err = chrome.runtime.lastError;
          if (err) { done({ ok: false, error: '读剪贴板通道不通:' + err.message }); return; }
          done(res || { ok: false, error: '剪贴板没有回执' });
        });
      } catch (e) {
        done({ ok: false, error: (e && e.message) || '读剪贴板失败' });
      }
      /* 看门狗:后台被回收时回调可能永远不回 —— 不能让按钮永久卡在「禁用」 */
      setTimeout(function () { done({ ok: false, error: '读剪贴板超时' }); }, 9000);
    });
  }

  /** 路径④ execCommand('paste') —— 隐藏 contenteditable,从 paste 事件拿图 */
  function readViaPaste() {
    return new Promise(function (resolve) {
      var holder = document.createElement('div');
      holder.contentEditable = 'true';
      holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
      document.body.appendChild(holder);

      var settled = false;
      var timer = setTimeout(function () { finish({ ok: false, error: 'execCommand 粘贴没回音' }); }, 2500);

      function finish(r) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener('paste', onPaste, true);
        if (holder.parentNode) holder.parentNode.removeChild(holder);
        resolve(r);
      }

      function onPaste(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var items = (ev.clipboardData && ev.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.kind === 'file' && /^image\//.test(it.type || '') && it.getAsFile) {
            var blob = it.getAsFile();
            if (!blob) continue;
            blobToDataUrl(blob).then(function (dataUrl) {
              finish({ ok: true, dataUrl: dataUrl, mime: blob.type || 'image/png', size: blob.size, via: 'execCommand' });
            }, function (e) { finish({ ok: false, error: (e && e.message) || String(e) }); });
            return;
          }
        }
        finish({ ok: false, error: NO_IMAGE });
      }

      document.addEventListener('paste', onPaste, true);
      try { holder.focus(); } catch (e) { /* focus 失败不影响派发 */ }
      var okCmd = false;
      try { okCmd = document.execCommand('paste'); } catch (e) { okCmd = false; }
      if (!okCmd) {
        /* 返回 false 不一定真失败(有的内核异步派发) —— 给一小拍 */
        setTimeout(function () {
          if (!settled && holder.parentNode) return;   // paste 已来或马上来
          finish({ ok: false, error: 'execCommand 粘贴被内核拒绝' });
        }, 350);
      }
    });
  }

  function readImage() {
    var tried = [];
    return readDirect().then(function (r) {
      if (r.ok) return r;
      if (r.error === NO_IMAGE) return { ok: false, error: NO_IMAGE };
      tried.push('直读:' + r.error);
      /* 「没聚焦」⇒ 拉回焦点重试一次(用户手势还在有效期) */
      if (/not focused|聚焦/i.test(r.error || '')) {
        try { window.focus(); } catch (e) { /* 有的内核 window.focus 被禁 */ }
        return new Promise(function (res) { setTimeout(res, 150); }).then(readDirect).then(function (r2) {
          if (r2.ok) return r2;
          if (r2.error === NO_IMAGE) return { ok: false, error: NO_IMAGE };
          tried.push('重试:' + r2.error);
          return null;                          // 继续下一条路
        });
      }
      return null;
    }).then(function (r) {
      if (r) return r;
      return readOffscreen().then(function (r2) {
        if (r2 && r2.ok) { r2.via = 'offscreen'; return r2; }
        var e2 = (r2 && r2.error) || '无回执';
        tried.push('离屏:' + e2);
        /* 离屏明确说「剪贴板里没图」就没必要再试 execCommand 了 */
        if (/没有图片|no image/i.test(e2)) return { ok: false, error: NO_IMAGE };
        return readViaPaste().then(function (r3) {
          if (r3.ok) return r3;
          tried.push('execCommand:' + r3.error);
          if (r3.error === NO_IMAGE) return { ok: false, error: NO_IMAGE };
          return { ok: false, error: tried.join('; ') || '读剪贴板失败' };
        });
      });
    });
  }

  function dataUrlToBlob(dataUrl) {
    var s = String(dataUrl || '');
    var comma = s.indexOf(',');
    if (comma < 0) throw new Error('图片数据不完整');
    var head = s.slice(0, comma);
    var mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    var bin = atob(s.slice(comma + 1));
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  function toFile(img) {
    var blob = dataUrlToBlob(img.dataUrl);
    var mime = blob.type || img.mime || 'image/png';
    var ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    var name = '粘贴图片-' + Date.now() + '.' + ext;
    try { return new File([blob], name, { type: mime }); }
    catch (e) {
      /* 老内核没有 File 构造器:File 是 Blob 的子类,补 name 属性凑合能用 */
      blob.name = name;
      return blob;
    }
  }

  /* ==========================================================
   * 四、塞进上传框(三级,逐级验证)
   * ========================================================== */

  function transferOf(file) {
    var DT = window.DataTransfer;
    if (!DT) return null;
    try {
      var dt = new DT();
      if (dt.items && dt.items.add) dt.items.add(file);
      else if (dt.items) dt.items.add(file);
      return dt;
    } catch (e) { return null; }
  }

  /** 把文件塞进指定的 file input(工具栏按钮与框内按钮共用) */
  function putFilesToInput(input, file) {
    if (!input) return false;
    var dt = transferOf(file);
    if (!dt) return false;
    try {
      input.files = dt.files;
    } catch (e) {
      return false;
    }
    if (!input.files || !input.files.length) return false;
    try {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      var legacy = document.createEvent('HTMLEvents');
      legacy.initEvent('change', true, false);
      input.dispatchEvent(legacy);
    }
    return true;
  }

  function putByInput(tile, file) {
    return putFilesToInput(inputForTile(tile), file);
  }

  function putByEvent(tile, file, type) {
    var dt = transferOf(file);
    if (!dt) return false;
    var filled = false;
    if (type === 'paste') {
      try {
        tile.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt
        }));
        filled = true;
      } catch (e) { filled = false; }
    }
    if (!filled) {
      /* 造不出带 clipboardData 的事件:补一个空 paste 让组件自己走兜底,
         再把文件挂到 tile 上供组件读取(平台组件若读不到也不会出错)。 */
      try {
        tile.__dycPastedFile = file;
        var ev = document.createEvent('HTMLEvents');
        ev.initEvent(type, true, true);
        ev.clipboardData = dt;
        ev.dataTransfer = dt;
        tile.dispatchEvent(ev);
        filled = true;
      } catch (e2) { filled = false; }
    }
    if (type === 'drop' && filled) {
      try {
        tile.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        tile.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      } catch (e3) { /* 老内核没有 DragEvent:上面的 HTMLEvents 已发过一次,不重复 */ }
    }
    return filled;
  }

  /* 表单里的 <img> 总数:框被平台整块重渲染时的「出图」判据
     (2026-11-08 真机:塞完文件平台把上传框换成「上传中」节点,
      旧节点永远等不到 img —— 但全表单的图片总数一定会涨)。 */
  /** 平台出图不一定把 <img> 加回原容器:也可能落在浮层、预览区。
   *  上传生成的预览是 blob:/data: 图,这里只数这两类 —— 普通的 svg 图标不参与,
   *  所以「基数不干净」也不会影响判断(只比增量)。 */
  function previewCount() {
    try {
      return document.querySelectorAll('img[src^="blob:"], img[src^="data:"]').length;
    } catch (e) { return 0; }
  }

  function waitImageSmart(tile, ms, imageRoot, base, basePreview) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function tick() {
        if (hasImage(tile)) { resolve(true); return; }
        var n = imageRoot.querySelectorAll('img').length;
        if (base >= 0 && n > base) { resolve(true); return; }
        /* 2026-11-22:图片跑到框外(浮层/预览区)时,靠这条兜住,避免「实际成功却判失败」 */
        if (typeof basePreview === 'number' && previewCount() > basePreview) { resolve(true); return; }
        if (Date.now() - start >= ms) { resolve(false); return; }
        setTimeout(tick, 150);
      })();
    });
  }

  /* ==========================================================
   * 五、一次粘贴的完整流程
   * ========================================================== */

  function setBtn(btn, text, disabled) {
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = !!disabled;
  }

  function startPaste(tile, btn) {
    if (!on || !inScope() || !tile.isConnected) return;
    if (busyTile) return;              // 一次只处理一个框:连点两下会重复塞图
    busyTile = tile;
    setBtn(btn, '读取剪贴板…', true);
    log('图片粘贴:开始');

    readImage().then(function (img) {
      if (!img || !img.ok) {
        var why = (!img || !img.error || img.error === NO_IMAGE)
          ? '剪贴板里没有图片'
          : img.error;
        log('图片粘贴失败:' + why);
        say('剪贴板里没有图片', 'alert', '未入框',
          why + '。请先截图或复制一张图片,再点一次「粘贴图片」。');
        return null;
      }
      if (!on || !inScope() || !tile.isConnected) return null;

      var file;
      try {
        file = toFile(img);
      } catch (e) {
        say('图片读不出来', 'alert', '未入框', (e && e.message) || '图片转码失败');
        return null;
      }

      var sizeKb = Math.max(1, Math.round((img.size || 0) / 1024));
      log('图片粘贴:读到图片 ' + sizeKb + 'KB / ' + (img.mime || '')
        + (img.via ? ' / 通道' + img.via : ''));

      /* 三级依次尝试,每级给 1200ms 看平台是否出图 */
      var steps = [
        { name: 'input', run: function () { return putByInput(tile, file); } },
        { name: 'paste', run: function () { return putByEvent(tile, file, 'paste'); } },
        { name: 'drop', run: function () { return putByEvent(tile, file, 'drop'); } }
      ];

      /* 三级依次尝试,每级给 1800ms 看平台是否出图
         (2026-11-22 由 1200 放宽:用户实测「很快提示失败、实际都成功」——
          平台受理后异步出图常要 2~4 秒)。 */
      var steps = [
        { name: 'input', run: function () { return putByInput(tile, file); } },
        { name: 'paste', run: function () { return putByEvent(tile, file, 'paste'); } },
        { name: 'drop', run: function () { return putByEvent(tile, file, 'drop'); } }
      ];

      var i = 0;
      var imageRoot = tile.getRootNode();
      imageRoot = imageRoot.querySelector('#goodsEditScrollContainer') || imageRoot;
      var baseImages = imageRoot.querySelectorAll('img').length;
      var basePreview = previewCount();
      function next() {
        if (!on || !inScope()) return Promise.resolve(false);
        if (i >= steps.length) return Promise.resolve(false);
        var step = steps[i++];
        var okRoute = false;
        try { okRoute = step.run(); } catch (e) { okRoute = false; }
        if (!okRoute) return next();
        return waitImageSmart(tile, 1800, imageRoot, baseImages, basePreview).then(function (got) {
          if (got) return true;
          if (!tile.isConnected) {
            /* 框被平台整块重渲染 = 文件已被受理(上传转圈中)。
               ⛔ 不许再打后面的通道 —— 会重复上传;
               改成耐心等:上传完成后 <img> 出现,全表单图片总数会涨。 */
            log('图片粘贴:平台已受理(框被重渲染),等出图…');
            return waitImageSmart(tile, 8000, imageRoot, baseImages, basePreview);
          }
          log('图片粘贴:通道 ' + step.name + ' 没出图,换下一条');
          return next();
        });
      }

      setBtn(btn, '粘贴中…', true);
      return next().then(function (got) {
        if (got) return true;
        /* 三条通道都交出去了、但当前帧还没看到图 —— 平台可能仍在异步处理。
           再静默等一次(不重试通道,避免重复上传),这一步能把「实际成功却报失败」压到最低。 */
        log('图片粘贴:通道都试过,再静默等 5 秒');
        setBtn(btn, '等平台出图…', true);
        return waitImageSmart(tile, 5000, imageRoot, baseImages, basePreview);
      }).then(function (got) {
        if (got) {
          say('图片', 'success', '已入框');
          log('图片粘贴:成功');
        } else {
          say('图片已交给平台，未看到预览', 'alert', '待确认',
            '文件已经交给平台,但页面上还没出现预览。平台可能还在处理 —— 请等几秒再看,不要重复点击;若始终没有,请点框里原来的「上传图片」手动选择。');
          log('图片粘贴:已交付但未看到预览');
        }
      });
    }).catch(function (e) {
      log('图片粘贴异常:' + ((e && e.message) || e));
      say('粘贴出错', 'alert', '未入框', (e && e.message) || String(e));
    }).then(function () {
      busyTile = null;
      setBtn(btn, BTN_TEXT, false);
      scheduleScan(600);
    });
  }

  /* ==========================================================
   * 六、开关与生命周期
   * ========================================================== */

  /* 状态变了才写一条日志(它会出现在诊断报告的时间线里)。
     上一版只有「已启用」一条,页面上一个按钮都没有时无从判断:
     是没找到候选框,还是找到了全被判为不合格。 */
  var lastSummary = '';

  function summarize(q) {
    var mountedCount = 0;
    try { mountedCount = queryRoots('[' + BTN_ATTR + ']').length; } catch (e) { mountedCount = 0; }
    var s = '候选 ' + (q ? q.all.length : 0) + ' · 已挂 ' + mountedCount
      + (q ? ' · 识别' + q.tier : '');
    if (s === lastSummary) return;
    lastSummary = s;
    log('图片粘贴:' + s);
  }

  /** 候选有、但一个都没挂上:把第一张不合格的框长相报出来,便于下一轮校准 */
  /** 这一格为什么不合格(诊断与掉线日志共用,别写成两份口径) */
  function rejectReason(t) {
    if (!t) return '节点没了';
    var wait = '';
    var hasInput = false;
    try { hasInput = !!inputForTile(t); } catch (e) { hasInput = false; }
    var st = null;
    try { st = window.getComputedStyle(t); } catch (e) { st = null; }
    var r = boxOf(t);
    var shape = Math.round(r.width) + '×' + Math.round(r.height);

    if (!visible(t)) wait = '不可见';
    else if (inFloatingChrome(t)) wait = '不在表单容器内(浮层/克隆)';
    else if (inPickerMenuRow(t)) wait = '平台来源菜单行';
    else if (hasImage(t)) wait = '已有图';
    else if (!hasInput && !hasUploadHint(t)) wait = '里面没有文件输入框';
    else if (r.width > 0 && (r.width < 56 || r.height < 56)) wait = '太小 ' + shape;
    else if (r.width > 0 && (r.width > 320 || r.height > 320)) wait = '太大 ' + shape;
    else if (r.width > 0 && (r.width / r.height < 0.5 || r.width / r.height > 2.2)) wait = '不是方块 ' + shape;
    else if (st && st.pointerEvents === 'none') wait = '不可点(pointer-events:none)';
    else if (st && parseFloat(st.opacity) < 0.6) wait = '半透明(opacity ' + st.opacity + ')';
    else if (inNativeTablePicker(t)) wait = '表格内图格(平台自带粘贴菜单)';
    else wait = '未通过校验 ' + shape;
    return wait;
  }

  /** 掉线留痕:哪一格、什么原因。节流 3 秒,只在真的摘了按钮时记。 */
  var dropCount = 0;
  var dropLoggedAt = 0;
  var hoverLoggedAt = 0;
  /** 指针进到本格按钮上时留一条(节流 3 秒):和随后的「掉线 / 就地补」对照,
      就能判出「指上去才闪」到底是悬停遮罩压住,还是平台悬停重渲染把按钮清了。 */
  function noteHover(tile) {
    var now = Date.now();
    if (now - hoverLoggedAt < 3000) return;
    hoverLoggedAt = now;
    var cls = (tile && typeof tile.className === 'string' ? tile.className : '').trim().split(/\s+/)[0] || '';
    log('图片粘贴:指针进按钮 · 本格 ' + (tile ? tile.tagName.toLowerCase() : '?') + (cls ? '.' + cls : ''));
  }
  function noteDrop(tile, why) {
    dropCount++;
    var now = Date.now();
    if (now - dropLoggedAt < 3000) return;
    dropLoggedAt = now;
    var cls = (tile && typeof tile.className === 'string' ? tile.className : '').trim().split(/\s+/)[0] || '';
    log('图片粘贴:掉线 ' + dropCount + ' 次 · 本格 '
      + (tile ? tile.tagName.toLowerCase() : '?') + (cls ? '.' + cls : '')
      + ' · ' + why);
  }

  function explainRejects(tiles) {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t) continue;
      var wait = rejectReason(t);

      var cls = (typeof t.className === 'string' ? t.className : '').trim().split(/\s+/).slice(0, 2).join('.');
      log('图片粘贴:不合格 ' + t.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' · ' + wait);
      return;
    }
  }

  function boot() {
    if (on || sizeOn) {
      /* 观察器先建好:scan 抛错也不至于让后续变更无人处理(上一版就是这样静默死掉的) */
      refreshRoots();
      // attachShadow 不触发外层 DOM 变更；只检查微前端宿主，不轮询全部上传框。
      if (!rootTimer && location.hostname === 'store.weixin.qq.com') rootTimer = setInterval(function () {
        var href = location.href;
        var changed = refreshRoots();
        if (changed || href !== lastHref) { lastHref = href; scheduleScan(100); }
      }, 1200);
      /* 表单很长(内容高 4000~6000+),新框多半是滚动后才渲染出来的 */
      window.addEventListener('scroll', onScroll, true);

      var q = null;
      try {
        q = scan();
      } catch (e) {
        log('图片粘贴:首扫异常 ' + ((e && e.message) || e));
      }
      if (q && q.all.length && !queryRoots('[' + BTN_ATTR + ']').length) {
        explainRejects(q.all);
      }
    } else {
      if (observer) { observer.disconnect(); observer = null; }
      clearInterval(rootTimer); rootTimer = 0;
      clearTimeout(scanTimer); scanTimer = 0;
      clearTimeout(scrollTimer); scrollTimer = 0;
      window.removeEventListener('scroll', onScroll, true);
      unmountAll();
      queryRoots('style[' + SHADOW_STYLE + ']').forEach(function (style) { style.remove(); });
      roots = [document];
      lastSummary = '';
    }
  }

  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = 0;
      scheduleScan(200);
    }, 300);
  }

  dycReadFlags().then(function (f) {
    on = !f || f.goodsImagePaste !== false;
    sizeOn = !f || f.sizeChartPaste !== false;
    /* 运行指纹:报告里这一行就能判定跑到的是哪一版判据(否则改了没生效都看不出来) */
    if (on) log('图片粘贴:已启用 · 判据 r11(滚动就地挂/挂后不重判/浮层内照挂)');
    if (sizeOn) log('尺码图粘贴:已启用');
    boot();
  });

  dycWatchFlags(function (f) {
    var next = !f || f.goodsImagePaste !== false;
    var nextSize = !f || f.sizeChartPaste !== false;
    if (next === on && nextSize === sizeOn) return;
    if (next !== on) log('图片粘贴:' + (next ? '已启用' : '已停用'));
    if (nextSize !== sizeOn) log('尺码图粘贴:' + (nextSize ? '已启用' : '已停用'));
    on = next;
    sizeOn = nextSize;
    boot();
  });
})();

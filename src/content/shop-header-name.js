/**
 * 抖店右上角店名完整显示。选择器来自 2026-11-03 商品管理页面结构报告；
 * 只认 headerShopName > shopDetails > shopTitle > userName，避免改到商品名。
 * 用样式表随平台重渲染自动生效；关闭只移除本样式，不覆盖平台内联值。
 */
(function () {
  'use strict';
  if (location.hostname !== 'fxg.jinritemai.com' || window.__DYC_SHOP_HEADER_NAME__) return;
  if (typeof dycReadFlags !== 'function') return;
  window.__DYC_SHOP_HEADER_NAME__ = true;

  var style = null;
  var revision = 0;
  var host = 'html body [class*="index_headerShopName__"]';
  var details = host + ' > [class*="index_shopDetails__"]';
  var title = details + ' > [class*="index_shopTitle__"]';
  var name = title + ' > [class*="index_userName__"]';
  var css = host + '{width:auto!important;max-width:calc(100vw - 80px)!important;'
    + 'height:auto!important;flex:0 1 auto!important;min-width:0!important;}'
    + details + ',' + title + '{width:auto!important;max-width:none!important;'
    + 'min-width:0!important;height:auto!important;max-height:none!important;overflow:visible!important;}'
    + name + '{width:auto!important;max-width:none!important;min-width:0!important;'
    + 'height:auto!important;max-height:none!important;white-space:normal!important;'
    + 'text-overflow:clip!important;overflow:visible!important;overflow-wrap:break-word!important;'
    + 'word-break:break-word!important;display:block!important;-webkit-line-clamp:unset!important;'
    + 'line-height:1.4!important;}';

  function apply(flags) {
    if (flags.shopHeaderName === false) {
      if (style) style.remove();
      style = null;
      return;
    }
    if (style) return;
    style = document.createElement('style');
    style.id = 'dyc-shop-header-name-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // 订阅先于异步读取；迟到的初始读取不能撤销刚保存的开关。
  dycWatchFlags(function (flags) {
    revision++;
    apply(flags);
  });
  var readRevision = revision;
  dycReadFlags().then(function (flags) {
    if (revision === readRevision) apply(flags);
  }).catch(function () { /* 读取失败不猜设置，后续开关变更仍可生效。 */ });
})();

/**
 * 离屏文档 · 剪贴板代读(2026-10-24)
 *
 * 内容脚本里的 navigator.clipboard.readText() 受页面 clipboard-read 权限约束
 * (多数站点没给,会拒绝或一直悬着)——「粘贴加车」需要稳定读剪贴板,
 * 改由带 clipboardRead 权限的离屏文档读,后台转发。
 *
 * 协议:
 *   后台 → {type:'dyc:offscreenReadClipboard'}
 *   ← {ok:true, text} | {ok:false, error}
 */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'dyc:offscreenReadClipboard') return false;

  if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
    sendResponse({ ok: false, error: '本内核不支持读剪贴板' });
    return false;
  }

  navigator.clipboard.readText().then(function (text) {
    sendResponse({ ok: true, text: text || '' });
  }, function (e) {
    sendResponse({ ok: false, error: (e && e.message) || '读取失败' });
  });

  return true;   // 异步回话
});

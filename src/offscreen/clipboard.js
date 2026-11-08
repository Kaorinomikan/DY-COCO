/**
 * 离屏文档 · 剪贴板代读(2026-10-24;图片读取 2026-11-08 新增)
 *
 * 内容脚本里的 navigator.clipboard.readText() 受页面 clipboard-read 权限约束
 * (多数站点没给,会拒绝或一直悬着)——「粘贴加车」需要稳定读剪贴板,
 * 改由带 clipboardRead 权限的离屏文档读,后台转发。
 *
 * 协议(文本):
 *   后台 → {type:'dyc:offscreenReadClipboard'}
 *   ← {ok:true, text} | {ok:false, error}
 *
 * 协议(图片,2026-11-08 商品编辑页「剪贴板粘贴」用):
 *   后台 → {type:'dyc:offscreenReadClipboardImage'}
 *   ← {ok:true, dataUrl, mime, size} | {ok:false, error}
 *
 * 为什么图片也走这里:页面自己调 navigator.clipboard.read() 同样受页面权限约束
 * (抖店没给),而离屏文档是扩展页、带 clipboardRead 权限,能直接拿到 Blob。
 * 回传用 dataURL 而不是 Blob/File:二者都不是可结构化克隆的对象边界货
 * (File 过不了 runtime 消息),dataURL 是纯字符串,任何内核都稳。
 */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return false;

  if (msg.type === 'dyc:offscreenReadClipboard') {
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
  }

  if (msg.type === 'dyc:offscreenReadClipboardImage') {
    /* 老内核只实现了 readText、没有 read ⇒ 图片这条路走不通。
       如实回错,由内容脚本降级提示「请手动上传」,不做假成功。 */
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      sendResponse({ ok: false, error: '本内核读不了剪贴板里的图片' });
      return false;
    }

    navigator.clipboard.read().then(function (items) {
      var list = items || [];
      var found = null;

      for (var i = 0; i < list.length && !found; i++) {
        var types = (list[i] && list[i].types) || [];
        for (var j = 0; j < types.length; j++) {
          if (String(types[j]).indexOf('image/') === 0) {
            found = { item: list[i], type: types[j] };
            break;
          }
        }
      }

      if (!found) {
        sendResponse({ ok: false, error: '剪贴板里没有图片' });
        return;
      }

      found.item.getType(found.type).then(function (blob) {
        return blobToDataUrl(blob).then(function (dataUrl) {
          sendResponse({
            ok: true,
            dataUrl: dataUrl,
            mime: (blob && blob.type) || found.type,
            size: (blob && blob.size) || 0
          });
        });
      }).catch(function (e) {
        sendResponse({ ok: false, error: (e && e.message) || '图片读出失败' });
      });
    }, function (e) {
      /* 权限被拒 / 浏览器要求用户手势 —— 原文回给页面,方便诊断时一眼分清
         「剪贴板没图」与「权限不给」。 */
      sendResponse({ ok: false, error: '读剪贴板被拒:' + ((e && e.message) || '权限') });
    });

    return true;   // 异步回话
  }

  return false;
});

/** Blob → dataURL。用 FileReader 而不是 fetch(dataURL):老内核 fetch data: 支持不全 */
function blobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('图片转码失败')); };
    reader.readAsDataURL(blob);
  });
}

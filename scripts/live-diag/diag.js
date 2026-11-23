/**
 * 中控台搜索框专项诊断
 *
 * 上一版误把焦点放在商品项上，这次只查一件事：
 * 平台搜索框到底长什么样、在哪、能不能被扩展插入按钮。
 */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: diagnosePage
    });
  } catch (e) {
    console.error('[DY-DIAG] 注入失败', e);
  }
});

function diagnosePage() {
  const lines = [];
  const push = function () {
    lines.push(Array.prototype.slice.call(arguments).join(' '));
  };

  push('===== 搜索框专项诊断 =====');
  push('URL: ' + location.href);
  push('时间: ' + new Date().toLocaleString());
  push('');

  // 1. 页面上所有 input
  push('【1】全部 input 元素（共 ' + document.querySelectorAll('input').length + ' 个）');
  const inputs = Array.from(document.querySelectorAll('input'));
  if (inputs.length === 0) {
    push('  页面没有任何 input —— 可能未加载完，或搜索框不是 input');
  }
  inputs.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className : '';
    const ph = el.getAttribute('placeholder') || '(无placeholder)';
    const type = el.getAttribute('type') || '(无type)';
    const visible = r.width > 0 && r.height > 0;

    push('  [' + i + '] ' + (visible ? '可见' : '不可见'));
    push('      placeholder="' + ph + '"');
    push('      type=' + type + ' class="' + cls.slice(0, 70) + '"');
    push('      尺寸 ' + Math.round(r.width) + 'x' + Math.round(r.height) +
      ' | 位置 top=' + Math.round(r.top) + ' left=' + Math.round(r.left));
    push('      父元素 <' + el.parentElement.tagName.toLowerCase() +
      '> class="' + String(el.parentElement.className || '').slice(0, 70) + '"');
    const gp = el.parentElement.parentElement;
    if (gp) {
      push('      祖父 <' + gp.tagName.toLowerCase() +
        '> class="' + String(gp.className || '').slice(0, 70) + '"');
      push('      祖父尺寸 ' + Math.round(gp.getBoundingClientRect().width) +
        'x' + Math.round(gp.getBoundingClientRect().height) +
        ' | 子元素 ' + gp.children.length + ' 个');
    }
  });
  push('');

  // 2. 含「商品」二字的元素
  push('【2】含「商品」字样的元素');
  const all = document.querySelectorAll('input, span, div, button, label');
  let hit = 0;
  for (const el of all) {
    const ph = el.getAttribute && el.getAttribute('placeholder');
    const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const target = ph || txt;
    if (!target || target.length > 40) continue;
    if (target.indexOf('商品') === -1 && target.indexOf('款号') === -1) continue;

    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className : '';
    push('  <' + el.tagName.toLowerCase() + '> class="' + cls.slice(0, 60) + '"');
    push('      "' + target + '"');
    push('      尺寸 ' + Math.round(r.width) + 'x' + Math.round(r.height) +
      ' | top=' + Math.round(r.top) + ' left=' + Math.round(r.left));
    if (++hit >= 8) break;
  }
  if (hit === 0) push('  未找到含「商品」字样的元素');
  push('');

  // 3. input-group 类容器
  push('【3】input-group 类容器');
  const groups = document.querySelectorAll('[class*="input-group"], [class*="inputGroup"]');
  if (groups.length === 0) push('  未找到');
  Array.from(groups).slice(0, 6).forEach((g, i) => {
    const r = g.getBoundingClientRect();
    push('  [' + i + '] class="' + String(g.className).slice(0, 70) + '"');
    push('      尺寸 ' + Math.round(r.width) + 'x' + Math.round(r.height) +
      ' | 直接子元素 ' + g.children.length + ' 个');
    for (const c of g.children) {
      const ccls = typeof c.className === 'string' ? c.className : '';
      const ctxt = (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20);
      const cr = c.getBoundingClientRect();
      push('      · <' + c.tagName.toLowerCase() + '> class="' + ccls.slice(0, 50) +
        '" ' + Math.round(cr.width) + 'x' + Math.round(cr.height) +
        (ctxt ? ' 文本="' + ctxt + '"' : ''));
    }
  });
  push('');

  // 4. 内容脚本是否已注入（验证扩展在跑）
  push('【4】内容脚本状态');
  push('  __DYB_NAV_INITIALIZED__ = ' + window.__DYB_NAV_INITIALIZED__);
  push('  #dyb-locate-btn 是否存在 = ' + !!document.getElementById('dyb-locate-btn'));
  push('  #dyb-status-bar 是否存在 = ' + !!document.getElementById('dyb-status-bar'));
  push('  typeof getProductItems = ' + (typeof getProductItems));
  push('');

  // 5. 可插入性测试
  push('【5】按钮插入可行性');
  const firstVisibleInput = inputs.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!firstVisibleInput) {
    push('  没有可见 input，无法插入');
  } else {
    push('  目标 input.placeholder="' + (firstVisibleInput.getAttribute('placeholder') || '无') + '"');
    const parent = firstVisibleInput.parentElement;
    push('  父容器 tag=<' + parent.tagName.toLowerCase() +
      '> class="' + String(parent.className || '').slice(0, 60) + '"');
    push('  父容器子元素 ' + parent.children.length + ' 个，appendChild 可行 = ' +
      (parent !== document.body));
  }

  const report = lines.join('\n');
  showPanel(report);
  return report;

  function showPanel(text) {
    const old = document.getElementById('dyb-diag-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'dyb-diag-panel';
    panel.style.cssText = [
      'position:fixed', 'top:8px', 'left:50%', 'transform:translateX(-50%)',
      'width:700px', 'max-height:86vh', 'overflow-y:auto',
      'z-index:2147483647', 'background:#1f2329', 'color:#e5e6eb',
      'font-family:Consolas,Monaco,monospace', 'font-size:11px',
      'padding:12px', 'border-radius:8px', 'line-height:1.6',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)'
    ].join(';');

    const status = document.createElement('div');
    status.style.cssText = 'font-weight:500;margin-bottom:8px;color:#00b42a;';
    status.textContent = '诊断完成 —— 点「复制全部」后粘贴给我';
    panel.appendChild(status);

    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;margin:0 0 10px;';
    pre.textContent = text;
    panel.appendChild(pre);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制全部';
    copyBtn.style.cssText = 'padding:6px 14px;font-size:11px;cursor:pointer;margin-right:6px;' +
      'background:#2b303a;color:#e5e6eb;border:1px solid #4a505c;border-radius:4px;';
    copyBtn.addEventListener('click', () => {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('copy');
        status.textContent = '已复制';
      } catch (e) {
        status.textContent = '复制失败，请手动 Ctrl+A / Ctrl+C';
      }
    });
    panel.appendChild(copyBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:6px 14px;font-size:11px;cursor:pointer;' +
      'background:#2b303a;color:#e5e6eb;border:1px solid #4a505c;border-radius:4px;';
    closeBtn.addEventListener('click', () => panel.remove());
    panel.appendChild(closeBtn);

    document.body.appendChild(panel);
  }
}
/** 小红书中控台自动刷新：触发商品栏「最近更新」旁的原生图标。 */
(function () {
  'use strict';
  if (window.__dycXhsAutoRefreshLoaded) return;
  window.__dycXhsAutoRefreshLoaded = true;

  var INTERVAL = 10000;
  var REFRESH = '.goods-list-tab .refresh-tips > .refresh-tips-icon';
  var OVERLAY = '.d-drawer,.detail-add-goods-drawer,.d-modal,.d-dialog,[role="dialog"]';
  var ID = 'dyc-xhs-auto-refresh';
  var STYLE_ID = ID + '-style';
  var enabled = false, timer = null, button = null, refreshIcon = null;
  var startButton = null, findStartAt = 0, nextAt = 0, typedAt = -Infinity;
  var mode = 'auto';

  function onPage() {
    return !!(window.DYC_PAGE_PATTERNS && DYC_PAGE_PATTERNS.xhsCtrl.test(location.href));
  }
  function visible(el) {
    return !!el && el.isConnected && el.getClientRects().length > 0 &&
      !el.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(el).visibility === 'visible';
  }
  function text(el) { return el.textContent.replace(/\s+/g, '').trim(); }
  function confirmedOffAir(root, now) {
    if (visible(startButton) && root.contains(startButton) &&
        !startButton.disabled && startButton.getAttribute('aria-disabled') !== 'true' &&
        text(startButton) === '立即开播') return true;
    startButton = null;
    if (now < findStartAt) return false;
    findStartAt = now + 2000;
    startButton = Array.from(root.querySelectorAll('button,[role="button"]')).find(function (el) {
      return !el.closest('.goods-list,.comment-list,[data-dyc-skip],' + OVERLAY) &&
        !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
        text(el) === '立即开播' && visible(el);
    });
    return !!startButton;
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    var sel = '#' + ID;
    style.textContent = [
      sel + '{all:initial;position:relative;display:inline-flex;flex:none;align-self:center;vertical-align:middle;',
      'justify-content:center;align-items:center;box-sizing:border-box;width:26px;height:26px;margin-inline-end:8px;',
      'border:1px solid #e5e6eb;border-radius:50%;background:#fff;color:#616872;cursor:pointer}',
      sel + ':focus-visible{outline:2px solid #0075ff;outline-offset:2px}',
      sel + ' svg{width:14px;height:14px}',
      sel + ' i{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border:1.5px solid #fff;',
      'border-radius:50%;background:currentColor}',
      sel + '[data-state="auto"]{color:#0a8f28;background:#f4fdf6;border-color:#b7ebc6}',
      sel + '[data-state="force"]{color:#b95300;background:#fff7eb;border-color:#ffd9b3}'
    ].join('');
    document.head.appendChild(style);
  }
  function ensureButton(parent) {
    if (!button) {
      ensureStyle();
      button = document.createElement('button');
      button.id = ID;
      button.type = 'button';
      button.setAttribute('data-dyc-skip', '');
      button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
        ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2.6 6.2A5.6 5.6 0 0 1 13 5.2M13.4 2.6v3h-3M13.4 9.8A5.6 5.6 0 0 1 3 10.8M2.6 13.4v-3h3"/></svg><i aria-hidden="true"></i>';
      button.addEventListener('click', switchMode);
    }
    if (button.parentElement !== parent) parent.prepend(button);
  }
  function paint(offAir, ready) {
    if (!button) return;
    var state = !ready || mode === 'off' || (mode === 'auto' && !offAir) ? 'off' : mode;
    if (button.dataset.state !== state) button.dataset.state = state;
    var title = !ready ? '暂时找不到刷新入口'
      : mode === 'force' ? '强制刷新，每 10 秒 · 点击暂停'
      : mode === 'off' ? '已暂停 · 点击恢复'
      : offAir ? '自动刷新，每 10 秒 · 点击切换强制'
      : '自动刷新已暂停 · 点击切换强制';
    if (button.title !== title) {
      button.title = title;
      button.setAttribute('aria-label', '自动刷新，' + title);
    }
  }
  function switchMode(event) {
    event.stopPropagation();
    if (!enabled || !onPage()) return;
    var now = Date.now();
    var root = document.querySelector('.control-container');
    var offAir = !!root && confirmedOffAir(root, now);
    mode = mode === 'force' ? 'off' : mode === 'off' && offAir ? 'auto' : 'force';
    nextAt = now + INTERVAL;
    paint(offAir, visible(refreshIcon));
    if (typeof setStatus === 'function') {
      setStatus(mode === 'force' ? '强制刷新' : mode === 'off' ? '已暂停' : '恢复自动',
        'info', { source: '自动刷新', keepHistory: false });
    }
  }
  function tick() {
    if (!enabled || !onPage()) { stop(); return; }
    if (document.hidden) return;
    var root = document.querySelector('.control-container');
    if (!root) return;
    refreshIcon = root.querySelector(REFRESH);
    var ready = visible(refreshIcon) && refreshIcon.getAttribute('aria-disabled') !== 'true';
    if (ready) ensureButton(refreshIcon.parentElement);
    var now = Date.now();
    var offAir = mode === 'auto' && confirmedOffAir(root, now);
    paint(offAir, ready);
    if (now < nextAt || !ready || mode === 'off' || (mode === 'auto' && !offAir)) return;
    if (now - typedAt < 8000 || document.getElementById('dyc-xhs-cart-paste')?.disabled ||
        refreshIcon.closest('[aria-busy="true"]') || Array.from(document.querySelectorAll(OVERLAY)).some(visible)) return;
    nextAt = now + INTERVAL;
    refreshIcon.click();
  }
  function markTyping(event) {
    if (event.target.matches('input,textarea,[contenteditable="true"]')) typedAt = Date.now();
  }
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (button) button.remove();
    button = refreshIcon = startButton = null;
    mode = 'auto';
    findStartAt = 0;
    typedAt = -Infinity;
    document.removeEventListener('input', markTyping, true);
  }
  function sync() {
    if (!enabled || !onPage()) { stop(); return; }
    if (timer !== null) return;
    nextAt = Date.now() + INTERVAL;
    timer = setInterval(tick, 500);
    document.addEventListener('input', markTyping, true);
    tick();
  }
  function apply(flags) {
    enabled = flags.xhsAutoRefresh !== false;
    sync();
  }
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;
  dycReadFlags().then(apply, function () {});
  dycWatchFlags(apply);
  window.addEventListener('dyc:pagechange', sync);
})();

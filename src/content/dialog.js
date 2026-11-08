/**
 * 确认弹窗
 *
 * 设计原则：这是不可逆的写操作，弹窗必须让人明确知道自己在做什么。
 * - 列出商品的标题、ID、货号，避免清错商品
 * - 明确说明这是不可撤销的写操作（2026-10-30 用户定稿：只留「普通库存清零不可撤销」
 *   与「直播中会导致无法下单」两句，不再提区域库存）
 * - 需要主动点击才执行，不做默认焦点
 */

const DIALOG_ID = 'dyb-dialog-root';

function ensureDialogRoot() {
  let root = document.getElementById(DIALOG_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = DIALOG_ID;
    document.body.appendChild(root);
  }
  return root;
}

/**
 * 通用确认弹窗
 * @param {object} opts
 * @param {string} opts.title 标题
 * @param {Array<{label:string,value:string}>} opts.fields 详情字段
 * @param {string} opts.warning 警告文案
 * @param {string} opts.confirmText 确认按钮文字
 * @param {string} opts.cancelText 取消按钮文字
 * @param {Function} opts.onConfirm 确认回调
 * @param {Function} opts.onCancel 取消回调
 * @param {boolean} opts.danger 是否高危样式
 */
function showConfirmDialog(opts) {
  const {
    title,
    fields = [],
    warning = '',
    confirmText = '确定',
    cancelText = '取消',
    onConfirm,
    onCancel,
    danger = true
  } = opts;

  const root = ensureDialogRoot();
  root.innerHTML = '';
  root.style.display = 'block';

  // 遮罩
  const mask = document.createElement('div');
  mask.className = 'dyb-mask';

  const panel = document.createElement('div');
  panel.className = 'dyb-panel';

  // 标题
  const titleEl = document.createElement('div');
  titleEl.className = 'dyb-title';
  titleEl.textContent = title;
  panel.appendChild(titleEl);

  // 详情字段
  if (fields.length > 0) {
    const list = document.createElement('div');
    list.className = 'dyb-fields';

    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'dyb-field';

      const label = document.createElement('span');
      label.className = 'dyb-label';
      label.textContent = f.label;

      const value = document.createElement('span');
      value.className = 'dyb-value';
      value.textContent = f.value;
      value.title = f.value;

      row.appendChild(label);
      row.appendChild(value);
      list.appendChild(row);
    }

    panel.appendChild(list);
  }

  // 警告文案
  if (warning) {
    const warn = document.createElement('div');
    warn.className = 'dyb-warning';
    warn.textContent = warning;
    panel.appendChild(warn);
  }

  // 按钮
  const actions = document.createElement('div');
  actions.className = 'dyb-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'dyb-btn dyb-btn-cancel';
  cancelBtn.textContent = cancelText;
  cancelBtn.addEventListener('click', () => {
    close();
    if (onCancel) onCancel();
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = danger ? 'dyb-btn dyb-btn-danger' : 'dyb-btn dyb-btn-primary';
  confirmBtn.textContent = confirmText;
  confirmBtn.addEventListener('click', () => {
    close();
    if (onConfirm) onConfirm();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  panel.appendChild(actions);

  root.appendChild(mask);
  root.appendChild(panel);

  function close() {
    root.style.display = 'none';
    root.innerHTML = '';
    // ESC 监听在 close() 里统一摘（2026-11-01 体检 P1）：
    // 原来只在按 ESC 的分支里 remove，用户点「确定/取消」关窗时监听
    // 永久留在 document 上 —— 每张弹窗漏一条，之后任意时刻按 ESC
    // 都会对已隐藏的 root 执行 close() 并误触上一张弹窗的 onCancel。
    document.removeEventListener('keydown', onKeydown);
  }

  // ESC 取消
  const onKeydown = (e) => {
    // 只认真实键盘：wx-goods-tools 关分享面板会派发**合成** Escape，
    // 不过滤的话关面板的合成 ESC 会顺手把本确认框也关掉。
    if (e.isTrusted === false) return;
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKeydown);
      close();
      if (onCancel) onCancel();
    }
  };
  document.addEventListener('keydown', onKeydown);
}

/**
 * 进度弹窗：展示执行进度，不提供任何跳转或重启入口
 * @param {object} opts
 * @param {string} opts.title
 * @returns {object} 提供 update / finish / fail 方法
 */
function showProgressDialog(title) {
  const root = ensureDialogRoot();
  root.innerHTML = '';
  root.style.display = 'block';

  const mask = document.createElement('div');
  mask.className = 'dyb-mask';

  const panel = document.createElement('div');
  panel.className = 'dyb-panel';

  const titleEl = document.createElement('div');
  titleEl.className = 'dyb-title';
  titleEl.textContent = title;
  panel.appendChild(titleEl);

  const status = document.createElement('div');
  status.className = 'dyb-progress-status';
  status.textContent = '准备中…';
  panel.appendChild(status);

  const bar = document.createElement('div');
  bar.className = 'dyb-progress-bar';
  const barFill = document.createElement('div');
  barFill.className = 'dyb-progress-fill';
  bar.appendChild(barFill);
  panel.appendChild(bar);

  const detail = document.createElement('div');
  detail.className = 'dyb-progress-detail';
  detail.textContent = '';
  panel.appendChild(detail);

  root.appendChild(mask);
  root.appendChild(panel);

  function close() {
    root.style.display = 'none';
    root.innerHTML = '';
  }

  return {
    update(current, total, message) {
      const percent = total > 0 ? Math.round((current / total) * 100) : 0;
      barFill.style.width = percent + '%';
      status.textContent = message || `处理中 ${current}/${total}`;
      detail.textContent = total > 0 ? `${current} / ${total}` : '';
    },
    finish(message, onClose) {
      barFill.style.width = '100%';
      status.textContent = message || '已完成';
      detail.textContent = '';

      const btn = document.createElement('button');
      btn.className = 'dyb-btn dyb-btn-primary';
      btn.textContent = '关闭';
      btn.addEventListener('click', () => {
        close();
        if (onClose) onClose();
      });

      const actions = document.createElement('div');
      actions.className = 'dyb-actions';
      actions.appendChild(btn);
      panel.appendChild(actions);
    },
    fail(message) {
      barFill.style.background = '#f53f3f';
      status.textContent = message;

      const btn = document.createElement('button');
      btn.className = 'dyb-btn dyb-btn-cancel';
      btn.textContent = '关闭';
      btn.addEventListener('click', close);

      const actions = document.createElement('div');
      actions.className = 'dyb-actions';
      actions.appendChild(btn);
      panel.appendChild(actions);
    }
  };
}

/**
 * 状态条(2026-10-11 重设计):左下角直角绿标记 + 层叠消息 + 历史盒子
 *
 * 结构:#dyb-status-bar
 *   ├ .dyb-badge    品牌标记(常驻,真矩形,点击开/收历史盒子)
 *   ├ .dyb-msg-col  消息列(column-reverse):最新在底层紧贴标记,旧消息向上挪一层
 *   └ .dyb-history  历史盒子(本作用页最近 100 条,由扩展私有存储持久化)
 *
 * 展示规则(2026-10-11 用户定稿,概念图 v4):
 *   - 新消息从标记背后从左往右滑出(2026-10-15 用户定方案 D:
 *     起始整条藏在标记后方,由 .dyb-msg-col 的 overflow:hidden 裁掉,
 *     0.32s 缓出滑到位并淡入);旧消息向上挪一层
 *   - 所有消息一律 3 秒后对角线回收(缩回左下角绿标记,与历史盒子同款);无常驻、无 × 按钮
 *   - 进行中/富状态消息每次更新自动续期(还在动就不掉)
 *   - 同屏最多 3 层,更早的掉入历史
 *   - 弧度:标记真矩形;首层左缘直角(与标记无缝)、右端带弧;上层四角全弧
 *   - 颜色指示灯在每条消息最右端
 *
 * 对外接口不变:setStatus / toast / updateProgress / finishStatus / failStatus。
 * timeout 语义变化:0(旧「常驻」)现在等同 3 秒,正数仍按原值生效。
 */

const DYC_STATUS_MAX = 3;      // 同屏层数
const DYC_STATUS_TTL = 3000;   // 全部消息统一 3 秒后回收
const DYC_HISTORY_MAX = 100;   // 每个作用页的历史上限

function ensureStatusBar() {
  let bar = document.getElementById('dyb-status-bar');
  if (!bar) {
    // anchor.js 的探针通常已建好,此处兜底应对脚本注入顺序异常
    bar = document.createElement('div');
    bar.id = 'dyb-status-bar';
    const badge = document.createElement('div');
    badge.className = 'dyb-badge dyb-badge--normal';
    badge.textContent = 'DY-COCO';
    bar.appendChild(badge);
    document.body.appendChild(bar);
  }
  // 消息列与历史盒子由本模块补齐(幂等,anchor.js 只建了 bar+badge)
  if (!bar.querySelector(':scope > .dyb-msg-col')) {
    const col = document.createElement('div');
    col.className = 'dyb-msg-col';
    bar.appendChild(col);
  }
  if (!bar.querySelector(':scope > .dyb-history')) {
    const panel = document.createElement('div');
    panel.className = 'dyb-history';
    const head = document.createElement('div');
    head.className = 'dyb-history-head';
    head.textContent = '消息盒子';
    head.style.position = 'relative';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'dyb-history-clear';
    clear.textContent = '清空';
    clear.style.cssText = 'position:absolute;right:12px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer';
    clear.addEventListener('click', async () => {
      if (clear.disabled) return;
      clear.disabled = true;
      const saved = await dycClearHistory();
      clear.disabled = false;
      clear.textContent = saved ? '清空' : '重试清空';
      clear.title = saved ? '' : '本页已清空，保存失败；点击重试，重开页面可能仍有旧记录';
    });
    head.appendChild(clear);
    const list = document.createElement('div');
    list.className = 'dyb-history-list';
    panel.appendChild(head);
    panel.appendChild(list);
    bar.appendChild(panel);
    // 展开时点击盒子外面自动收纳(全局只挂一次)
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('is-open')) return;
      if (bar.contains(e.target)) return;
      closeHistory();
    });
  }
  // 点标记开/收(2026-10-12 二修):绑定从「panel 首建」拆出、幂等 ——
  // 旧写法监听只在 panel 第一次创建时挂,而 panel 是第一条消息出现时
  // 才懒创建的,页面刚加载还没弹过消息时点标记没有任何监听 = 点不开。
  // 现在每次 ensureStatusBar 都检查绑定(badge 重建后也能自动补)。
  const badge = bar.querySelector('.dyb-badge');
  if (badge && !badge.__dycBound) {
    badge.__dycBound = true;
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHistory();
    });
  }
  return bar;
}

function statusMsgCol() {
  return ensureStatusBar().querySelector(':scope > .dyb-msg-col');
}

function statusHistoryPanel() {
  return ensureStatusBar().querySelector(':scope > .dyb-history');
}

/* 首层标记:只有最底层(贴标记)那条左缘是直角,其余消息四角全弧 */
function updateFirstStatus() {
  const col = statusMsgCol();
  const live = Array.from(col.children).filter((e) => !e._removed);
  live.forEach((e, i) => e.classList.toggle('is-first', i === 0));
}

/* 消失动画(2026-10-11 用户 23:4x 定):脱离占位(absolute)→ 对角线回收
 * (向左下角绿标记缩回,与历史盒子同款)→ 移除。
 * absolute 是关键:回收中的消息不再参与层叠计数与占位;
 * 缩放原点在左下角(style.css 的 transform-origin),对角线收纳 */
function dropStatus(el) {
  if (!el || el._removed) return;
  el._removed = true;
  clearTimeout(el._timer);
  el._timer = null;
  updateFirstStatus(); // 底层空出,下一层补位成首层(左缘由弧变直)
  const col = statusMsgCol();
  const r = el.getBoundingClientRect();
  const pr = col.getBoundingClientRect();
  el.style.position = 'absolute';
  el.style.left = (r.left - pr.left) + 'px';
  el.style.bottom = '0px';
  el.style.width = r.width + 'px';
  el.classList.add('is-out');
  setTimeout(() => {
    el.remove();
    updateFirstStatus();
  }, 260);
}

/* 三段式消息的竖线分隔(2026-10-15 用户定方案 B) */
function makeStatusSep() {
  const sep = document.createElement('span');
  sep.className = 'dyb-status-sep';
  return sep;
}

/* 三段式消息的来源标签(弱化前缀) */
function makeStatusSource(text) {
  const s = document.createElement('span');
  s.className = 'dyb-status-source';
  s.textContent = text;
  return s;
}

/* 组装单条消息:转圈(仅 running)+ 来源 + 竖线 + 文案 + 竖线 + 弱化结果数
   + 流水水体 + 右端色点 */
function fillStatusEl(el, message, type, opts) {
  const { track = null, count = '', source = '' } = opts;
  // 流水水体跨更新复用(2026-10-12):整体 innerHTML 清空会让水体节点重建,
  // 宽度过渡不生效 → 进度只会「跳变」没有从左到右灌水的推进感。
  // 改为:保留已有水体节点,只更新宽度;其余子元素照常重建。
  const keepTrack = (track !== null) ? el.querySelector(':scope > .dyb-status-track') : null;
  el.innerHTML = '';
  el.className = 'dyb-status dyb-status-' + type;
  if (keepTrack) el.appendChild(keepTrack);
  // 转圈只在「无进度条的 running」出现(如清库存进度);
  // 搜索扫描走底部进度条模式,不再转圈(2026-10-11 用户定)
  if (type === 'running' && track === null) {
    const spin = document.createElement('span');
    spin.className = 'dyb-spin';
    el.appendChild(spin);
  }
  // 三段式(2026-10-15 用户定方案 B):来源(弱) ｜ 值(强) ｜ 结果数(弱)。
  // 竖线只在「带来源」的消息上出现 —— 进度类消息(正在搜索「XX」…… 37%)
  // 没有来源,仍是「主体 + 计数」两段,不插竖线,免得看着像缺了一段。
  if (source) {
    el.appendChild(makeStatusSource(source));
    el.appendChild(makeStatusSep());
  }
  const txt = document.createElement('span');
  txt.className = 'dyb-msg';
  txt.textContent = message;
  el.appendChild(txt);
  if (count) {
    if (source) el.appendChild(makeStatusSep());
    const c = document.createElement('span');
    c.className = 'dyb-status-count';
    c.textContent = count;
    el.appendChild(c);
  }
  if (track !== null) {
    el.classList.add('dyb-has-track');
    const tk = keepTrack || document.createElement('span');
    tk.className = 'dyb-status-track';
    let fill = keepTrack ? keepTrack.querySelector(':scope > i') : null;
    if (!fill) {
      fill = document.createElement('i');
      tk.appendChild(fill);
    }
    fill.style.width = Math.max(0, Math.min(1, track)) * 100 + '%';
    if (!keepTrack) el.appendChild(tk);
  }
  const dot = document.createElement('span');
  dot.className = 'dyb-dot dyb-dot-' + type;
  el.appendChild(dot);
}

function statusNowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* 历史只通过后台写扩展私有存储；宿主 localStorage 仅用于一次性迁移旧键。 */
const DYC_HISTORY_STORE = 'dycMsgHistory';

function dycMergeHistory(...groups) {
  const entries = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (!item || typeof item.text !== 'string' || !item.text || !isFinite(item.ts)) continue;
      if (['success', 'error', 'alert', 'warning'].indexOf(item.type) < 0) continue;
      const record = {
        type: item.type,
        source: String(item.source || '').slice(0, 40),
        text: item.text.slice(0, 12000),
        brief: String(item.brief || '').slice(0, 96),
        count: String(item.count || '').slice(0, 300),
        time: String(item.time || '').slice(0, 12),
        ts: Number(item.ts),
        ...(item.key ? { key: String(item.key).slice(0, 100) } : {})
      };
      const id = record.key ? 'key:' + record.key : JSON.stringify([
        record.source, record.type, record.text, record.count, record.ts
      ]);
      const previous = entries.get(id);
      if (!previous || record.ts >= previous.ts) {
        entries.delete(id);
        entries.set(id, record);
      }
    }
  }
  const merged = [];
  for (const record of Array.from(entries.values()).sort((a, b) => a.ts - b.ts)) {
    const last = merged[merged.length - 1];
    if (last && !last.key && !record.key && last.type === record.type && last.source === record.source
        && last.text === record.text && record.ts - last.ts < 60000) merged[merged.length - 1] = record;
    else merged.push(record);
  }
  return merged.slice(-DYC_HISTORY_MAX);
}

function dycReadLegacyHistory() {
  try {
    return dycMergeHistory(JSON.parse(localStorage.getItem(DYC_HISTORY_STORE) || '[]'));
  } catch (e) { return []; }
}

function dycRemoveLegacyHistory() {
  try { localStorage.removeItem(DYC_HISTORY_STORE); } catch (e) { /* 下次继续迁移 */ }
}

function dycHistoryRequest(type, items) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(null);
        return;
      }
      chrome.runtime.sendMessage({ type, ...(items ? { items } : {}) }, (response) => {
        if (chrome.runtime.lastError || !response || response.ok !== true || !Array.isArray(response.items)) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (e) { resolve(null); }
  });
}

let dycLegacyHistory = dycReadLegacyHistory();
let dycHistory = dycLegacyHistory.slice();
let dycHistoryEpoch = 0;
let dycHistoryClearPending = false;
let dycHistoryQueue = Promise.resolve();

function dycQueueHistory(work) {
  dycHistoryQueue = dycHistoryQueue.then(work).catch(() => false);
  return dycHistoryQueue;
}

function dycLoadHistory() {
  const epoch = dycHistoryEpoch;
  return dycQueueHistory(async () => {
    const response = await dycHistoryRequest('dyc:historyGet');
    if (epoch !== dycHistoryEpoch) return false;
    if (response) dycHistory = dycMergeHistory(response.items, dycHistory);
    if (dycLegacyHistory.length) {
      const migrated = await dycHistoryRequest('dyc:historyMerge', dycHistory);
      if (epoch !== dycHistoryEpoch) return false;
      if (migrated) {
        dycHistory = dycMergeHistory(migrated.items, dycHistory);
        dycLegacyHistory = [];
        dycRemoveLegacyHistory();
      }
    }
    if (document.body) renderHistory();
    return !!response;
  });
}

function dycSaveHistory() {
  const epoch = dycHistoryEpoch;
  return dycQueueHistory(async () => {
    if (epoch !== dycHistoryEpoch) return false;
    if (dycHistoryClearPending) {
      const cleared = await dycHistoryRequest('dyc:historyClear');
      if (epoch !== dycHistoryEpoch || !cleared) return false;
      dycHistoryClearPending = false;
      dycRemoveLegacyHistory();
    }
    const response = await dycHistoryRequest('dyc:historyMerge', dycHistory);
    if (epoch !== dycHistoryEpoch || !response) return false;
    dycHistory = dycMergeHistory(response.items, dycHistory);
    if (dycLegacyHistory.length) {
      dycLegacyHistory = [];
      dycRemoveLegacyHistory();
    }
    if (document.body) renderHistory();
    return true;
  });
}

function dycClearHistory() {
  const epoch = ++dycHistoryEpoch;
  dycHistory = [];
  dycLegacyHistory = [];
  dycHistoryClearPending = true;
  if (document.body) renderHistory();
  return dycQueueHistory(async () => {
    if (epoch !== dycHistoryEpoch) return false;
    const response = await dycHistoryRequest('dyc:historyClear');
    if (epoch !== dycHistoryEpoch || !response) return false;
    dycHistoryClearPending = false;
    dycRemoveLegacyHistory();
    return true;
  });
}

dycLoadHistory();

/* 来源、值、结果数分开保存；同身份键更新一条，相邻同文案在 60 秒内续期。 */
function pushHistory(type, entry) {
  const source = entry.source || '';
  const text = entry.text || '';
  const key = entry.key || '';
  const keyed = key && dycHistory.find((item) => item.key === key);
  const last = dycHistory[dycHistory.length - 1];
  const now = Math.max(Date.now(), last ? last.ts + 1 : 0);
  if (!keyed && last && last.type === type && last.source === source && last.text === text
      && now - last.ts < 60000 && (!key || !last.key || last.key === key)) {
    last.time = statusNowText();
    last.ts = now;
    last.count = String(entry.count || '');
    last.brief = String(entry.brief || '');
    if (key) last.key = key;
  } else {
    dycHistory = dycMergeHistory(dycHistory, [{
      type,
      source,
      text,
      brief: entry.brief || '',
      count: entry.count || '',
      time: statusNowText(),
      ts: now,
      ...(key ? { key } : {})
    }]);
  }
  renderHistory();
  dycSaveHistory();
}

/* 历史条目三段之间的淡竖线(与消息条 .dyb-status-sep 同款视觉) */
function makeHSep() {
  const sep = document.createElement('span');
  sep.className = 'h-sep';
  return sep;
}

function renderHistory() {
  const list = statusHistoryPanel().querySelector('.dyb-history-list');
  const fragment = document.createDocumentFragment();
  // 阅读顺序:最新的排最上面(2026-10-12 用户定)——
  // 倒序遍历(数组尾=最新,先渲染在列表顶部),与阅读习惯一致
  for (let i = dycHistory.length - 1; i >= 0; i--) {
    const it = dycHistory[i];
    const row = document.createElement('div');
    row.className = 'dyb-history-item';
    const dot = document.createElement('span');
    dot.className = 'h-dot h-' + it.type;
    const time = document.createElement('span');
    time.className = 'h-time';
    time.textContent = it.time;
    const text = document.createElement('div');
    text.className = 'h-text';
    // 长消息默认显示摘要，全文通过原生 details 展开；旧记录同样保留全文。
    const content = it.text || '';
    const long = !!it.brief || content.length > 96;
    const brief = long ? (it.brief || content.split(/[\n。]|——/)[0].slice(0, 72)) : content;
    if (it.source) {
      const src = document.createElement('span');
      src.className = 'h-source';
      src.textContent = it.source;
      text.appendChild(src);
      text.appendChild(makeHSep());
    }
    text.appendChild(document.createTextNode(brief + (long && !it.brief ? '…' : '')));
    if (it.count) {
      text.appendChild(makeHSep());
      const c = document.createElement('span');
      c.className = 'h-count';
      c.textContent = it.count;
      text.appendChild(c);
    }
    if (long) {
      const details = document.createElement('details');
      details.className = 'h-details';
      const summary = document.createElement('summary');
      summary.textContent = '查看详情';
      const body = document.createElement('div');
      body.className = 'h-detail-body';
      body.textContent = content;
      details.appendChild(summary);
      details.appendChild(body);
      details.addEventListener('toggle', () => {
        summary.textContent = details.open ? '收起详情' : '查看详情';
      });
      text.appendChild(details);
    }
    row.appendChild(dot);
    row.appendChild(time);
    row.appendChild(text);
    fragment.appendChild(row);
  }
  list.textContent = '';
  list.appendChild(fragment);
}

function openHistory() {
  const panel = statusHistoryPanel();
  // 打开时先按内存里的历史重画一遍（2026-10-25）：
  // 持久化之后，条目可能是上次刷新前存下的 —— 面板 DOM 是新建的、还没画过，
  // 不在这里补一次，重载后打开盒子就是空的。
  renderHistory();
  panel.style.display = 'flex';
  requestAnimationFrame(() => panel.classList.add('is-open'));
  const badge = ensureStatusBar().querySelector('.dyb-badge');
  badge.classList.add('is-open');
}

function closeHistory() {
  const panel = statusHistoryPanel();
  if (!panel.classList.contains('is-open')) return;
  panel.classList.remove('is-open');
  const badge = ensureStatusBar().querySelector('.dyb-badge');
  badge.classList.remove('is-open');
  // 等收纳动效播完再整体隐藏
  setTimeout(() => {
    if (!panel.classList.contains('is-open')) panel.style.display = 'none';
  }, 240);
}

function toggleHistory() {
  if (statusHistoryPanel().classList.contains('is-open')) closeHistory();
  else openHistory();
}

/**
 * 执行状态提示(重设计核心)
 *
 * @param {string} message 文案
 * @param {string} type info | success | warning | error | running | alert
 * @param {object} opts
 * @param {number} [opts.timeout] 自动回收毫秒数;0/缺省 = 统一 3 秒(旧「常驻」语义已废除)
 * @param {number} [opts.track] 0~1,底部细进度条(搜索中 B 方案,2026-10-11 用户定)
 * @param {string} [opts.source] 来源标签(弱化前缀,如「全能搜索」「序号定位」)。
 *        凡进消息盒子的消息都应带上 —— 盒子里每条统一为
 *        「来源 ｜ 值 ｜ 结果数」三段(2026-10-15 用户定方案 B)
 * @param {string} [opts.count] 弱化计数字(如「1/8」「唯一」)
 * @param {string} [opts.full] 存进消息盒子的**完整文案**(缺省 = message)。
 *        长原因在盒子中默认收起，点击「查看详情」展示全文；短的商品别称直接显示。
 * @param {boolean} [opts.details] 即使 full 较短，也在盒子中用「查看详情」展开。
 * @param {boolean} [opts.standalone] 独立成层,不与上一条同类富状态原地合并
 *        (2026-10-14 方案 C:结果消息带 count 后会被判为「富状态」,不加这个
 *         开关就会与上一条结果合并覆盖,3 秒内连搜两次只留最后一条)
 * @param {boolean} [opts.keepHistory] 是否收录进消息盒子;缺省按类型定 ——
 *        只收录「结果」与「异常」(success / error / alert),
 *        info / warning / running 一律不收录(2026-10-15 用户定)
 * @param {string} [opts.histKey] 收录进盒子时的**身份键**;同一个键只占一条,
 *        后续同键消息在该条目上原地刷新(值 / 结果数 / 时间),不留流水。
 *        给「周期性重复、内容每次略变」的动作使用(自动循环讲解:每 N 分钟一轮)。
 *        见 pushHistory 头部注释。
 *
 * 合并规则:连续同类更新(进度 running / 富状态 track+count)原地覆盖不堆叠,
 * 每次更新续期 3 秒;不同类型消息各自成层向上堆叠。
 *
 * 三段式(2026-10-15 用户定方案 B):
 *   来源(弱) ｜ 值(强) ｜ 结果数(弱) —— 消息条与消息盒子条目同一套口径。
 *   弱化只靠字号与灰阶,不加底色;竖线 #e6e4de 作三段分隔,
 *   且只在「带来源」的消息上出现(进度类消息不插线)。
 */
function setStatus(message, type = 'info', opts = {}) {
  const col = statusMsgCol();
  const { track = null, count = '', source = '', standalone = false, keepHistory, histKey = '' } = opts;
  const rich = track !== null || count !== '';

  // 是否收录进消息盒子(2026-10-15 用户定稿:只收录「结果」与「异常」):
  //   收录 —— success(操作结果) / error(异常) / alert(异常警示);
  //   不收录 —— info(操作回声:开关已开启、请输入内容)、
  //             warning(前置提醒:请先展开、请先输入序号)、
  //             running(过程进度:正在搜索、正在清零)。
  //   理由:盒子上限 100 条,只该留「事后会想知道」的;过程与回声看过即弃。
  //   opts.keepHistory 可显式覆盖两种默认(两向都可用)。
  const inHistory = (keepHistory === undefined)
    ? (type === 'success' || type === 'error' || type === 'alert')
    : !!keepHistory;

  /* 发结果前顺手收掉过程消息（2026-10-29 用户报「过程提示 2/3 一闪而过，
     感觉出现重复提示了」）：running 与结果不同 type，不走下面的 merge 分支，
     两条会同时挂在这一列里。只有显式传 dropRunning 的调用方才清，
     且传了 source 就只清同一来源 —— 别把别的功能正在跑的进度也收掉。 */
  if (opts.dropRunning) {
    for (const e of Array.from(col.children)) {
      if (e._type !== 'running') continue;
      if (source && e._source !== source) continue;
      dropStatus(e);
    }
  }

  const live = Array.from(col.children).filter((e) => !e._removed);
  const bottom = live[0] || null;
  const merge = !!(bottom && bottom._type === type && !standalone &&
    (type === 'running' || (rich && bottom._rich)));
  // 同文案去重(2026-10-14 用户报「不要重复提示」)：
  // 消息列里已有「一模一样的一句话」时不新建节点，只把那条续期并提到最前 ——
  // 否则「先在搜索框输入词,再点全能搜索」这类提示连点几次就连出好几层
  // (用户截图实测同一秒里 3 条)。只认「同 type + 同文案」，不同类消息照常各自成层。
  const dup = merge ? null
    : live.find((e) => e._type === type && e._text === message && e._source === source);

  /* 盒子条目只组装一次,三条分支共用 —— merge 分支要能把它回写(hitKey 语义) */
  const histEntry = {
    source,
    text: (typeof opts.full === 'string' && opts.full) ? opts.full : message,
    brief: (typeof opts.full === 'string' && (opts.full.length > 96 || opts.details)) ? message : '',
    count: (count && type !== 'running') ? count : '',
    key: histKey || ''
  };

  let el;
  if (merge) {
    el = bottom;
    const keepFirst = el.classList.contains('is-first');
    const shown = el.classList.contains('is-in');
    el._rich = rich;
    fillStatusEl(el, message, type, { track, count, source });
    if (keepFirst) el.classList.add('is-first');
    if (shown) el.classList.add('is-in');
    // 高频刷新不进历史,只在消息诞生时记一条
    // ★ 例外(2026-10-27):带 histKey 的**必须**每次都回写 ——
    //   这类消息天生就是「原地刷新」语义(循环讲解每 N 分钟一轮),
    //   条上合并成一格,盒子里那一格的内容也得跟着变,
    //   否则盒子会永远停在第一轮(实测:40 轮之后盒子里还是「第 1 轮」)。
    if (inHistory && histKey) pushHistory(type, histEntry);
  } else if (dup) {
    // 已有一条同文案：不新建，把它提到最前并续期
    el = dup;
    const shown = el.classList.contains('is-in');
    el._rich = rich;
    fillStatusEl(el, message, type, { track, count, source });
    if (shown) el.classList.add('is-in');
    // column-reverse 下 prepend = 最新(紧贴标记)；首层直角由
    // updateFirstStatus() 在函数末尾按新顺序统一重算，这里不用手补 is-first
    if (col.firstChild !== el) col.prepend(el);
    if (inHistory && histKey) pushHistory(type, histEntry);
  } else {
    // 超出同屏层数:最旧(最上层)的先回收
    for (let i = live.length; i >= DYC_STATUS_MAX; i--) dropStatus(live[i - 1]);
    el = document.createElement('div');
    el._type = type;
    el._rich = rich;
    fillStatusEl(el, message, type, { track, count, source });
    col.prepend(el);
    // 历史带上弱化计数(2026-10-14 方案 C):结果消息的「序号 1/8」「唯一」
    // 显示在右端弱化位,不回写历史就丢;running 的百分比是瞬时进度,
    // 不进历史(避免「正在搜索「XX」…… · 37%」这类噪声)。
    // 收不收录见函数开头的 inHistory(灰色 info 一律不收录)。
    if (inHistory) {
      // 三段分开存(2026-10-15):盒子条目按「来源 ｜ 值 ｜ 结果数」渲染,
      // 不再拼成一句 —— 拼接会把弱化层级在盒子里抹平。
      // running 的百分比是瞬时进度,不进历史。
      //
      // 文案分流(2026-10-19 用户定):「报错的提示词太长了」——
      // 条上只放一两句就够,但盒子要能看全。所以调用方可以用 opts.full
      // 单独给「存进盒子的完整文案」,条上仍用 message 的短版。
      // 盒子条目最多 6 行,正常报错(百来字)都能完整显示。
      pushHistory(type, histEntry);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  }

  el._text = message;     // 供「同文案去重」比对(见上方 dup)
  el._source = source;    // 同上:来源不同的消息不合并
  clearTimeout(el._timer);
  const ttl = opts.timeout && opts.timeout > 0 ? opts.timeout : DYC_STATUS_TTL;
  el._timer = setTimeout(() => dropStatus(el), ttl);
  updateFirstStatus();
  return el;
}

/**
 * 轻提示：所有消息统一 3 秒后对角线回收
 * (2026-10-11 重设计:废除「失败/进行中常驻」,直播场景靠历史盒子回看;
 *  23:4x 用户定:消失动画统一对角线回收)
 */
function toast(message, type = 'info', opts = {}) {
  setStatus(message, type, Object.assign({ timeout: DYC_STATUS_TTL }, opts));
}

/**
 * 执行进度：原地更新并自动续期(进度还在动就不掉),完成后由
 * finishStatus / failStatus 发起新消息
 */
/* 进度消息(2026-10-15 三段式):「来源 ｜ 正在做X ｜ 1/3」——
   第四参数透传 opts(至少传 source),与 setStatus 同口径;
   计数从原来的正文里拆出来,进右端弱化位 */
function updateProgress(current, total, message, opts) {
  setStatus(message || '正在处理…', 'running', Object.assign(
    { count: total > 0 ? (current + '/' + total) : '' },
    opts || {}
  ));
}

/* 第二参数兼容两种写法:数字 = 旧的自定义停留毫秒;对象 = 透传给 setStatus
   (2026-10-15 起用对象形式传 source,让完成消息也进三段式) */
function finishStatus(message, opts) {
  const o = (typeof opts === 'number') ? { timeout: opts } : (opts || {});
  setStatus(message, 'success', Object.assign({ timeout: 3000 }, o));
}

function failStatus(message, opts) {
  setStatus(message, 'error', opts || {});
}
/* ---------- 状态条主动初始化(2026-10-12 二修「空态点不开」) ----------
 * badge 的点击监听过去只在「历史盒子面板首次创建」时挂,而面板是
 * 第一条消息出现时才懒创建的 —— 页面刚加载、还没弹过任何消息时,
 * 点标记没有任何监听,历史盒子永远点不开(空态修复只解决了打开后的
 * 显示,没解决「能不能打开」)。
 * 现在模块加载即主动补齐状态条(body 未就绪则稍后补两次),面板与
 * 监听在页面加载后立即就位;badge 绑定也已改为幂等(见 ensureStatusBar)。 */
(function initStatusBarEagerly() {
  function tryInit() {
    try {
      if (document.body) { ensureStatusBar(); return true; }
    } catch (e) { /* 尽力而为 */ }
    return false;
  }
  if (tryInit()) return;
  setTimeout(function () { if (!tryInit()) setTimeout(tryInit, 2000); }, 1000);
})();
// SPA 切入功能页时，后台复用已在全域页加载的组件，避免顶层 const 重声明。
window.__DYC_DIALOG_LOADED__ = true;

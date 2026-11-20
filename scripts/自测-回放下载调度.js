/** 真实下载/网络/写盘模块 + 虚拟时钟，不访问平台或磁盘。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function harness(fetcher) {
  let now = 100000, next = 0;
  const timers = new Map(), frames = [], writes = [], finishes = [];
  const listeners = new Map();
  const set = (fn, ms, repeat) => {
    const id = ++next;
    timers.set(id, { fn, at: now + ms, repeat });
    return id;
  };
  const clear = id => timers.delete(id);
  const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
  const delay = (value, ms, signal) => new Promise((resolve, reject) => {
    const abort = () => { clear(id); reject(new DOMException('aborted', 'AbortError')); };
    const id = set(() => {
      if (signal) signal.removeEventListener('abort', abort);
      resolve(value);
    }, ms, 0);
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
  const ctx = {
    console, Uint8Array, AbortController, DOMException, TextDecoder, URL,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => set(fn, ms, 0), clearTimeout: clear,
    setInterval: (fn, ms) => set(fn, ms, ms), clearInterval: clear,
    performance: { getEntriesByType: () => [] },
    document: { querySelector: () => null }, location: { hostname: 'offline', href: 'https://offline/' },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { onLine: true },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dycReadFlags: () => new Promise(() => {}), dycWatchFlags(fn) { ctx.updateFlags = fn; },
    __DYC_REPLAY_DEBUG__: true, __DYC_REPLAY_META__: {},
    __DYC_REPLAY_UI__: {
      setAbortHandler(fn) { ctx.cancel = fn; }, setBtn() {}, showProgress() {},
      setPauseHandler(fn) { ctx.pause = fn; },
      setAutoRetryHandler(fn) { ctx.autoRetry = fn; },
      setProgress(ratio, meta) { frames.push({ time: now, ratio, ...meta }); },
      finishProgress(kind) { finishes.push(kind); }, say() {}, hideProgress() {},
      fmtBytes: n => String(Math.round(n)) + 'B',
    },
  };
  ctx.window = ctx;
  ctx.fetch = (url, opts) => fetcher(url, opts, { delay, now: () => now });
  vm.createContext(ctx);
  for (const file of ['src/replay/replay-net.js', 'src/replay/m3u8.js',
    'src/replay/replay-writer.js', 'src/replay/replay-download.js']) {
    vm.runInContext(read(file), ctx, { filename: file });
  }
  // 首屏路由兜底与此离线测试无关，下载自己建的定时器仍完整运行。
  timers.clear();
  const handle = {
    name: 'test.mp4', getFile: async () => ({ size: 0 }), remove: async () => {},
    createWritable: async () => ({
      write: async buf => { writes.push(Array.from(buf)); }, close: async () => {}, abort: async () => {},
    }),
  };
  ctx.showSaveFilePicker = async () => handle;
  async function advance(ms) {
    await flush();
    const end = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, t] = entry;
      now = t.at;
      if (t.repeat) t.at += t.repeat; else timers.delete(id);
      t.fn();
      await flush();
    }
    now = end;
    await flush();
  }
  async function finish(promise, max = 240000) {
    let done = false, error;
    promise.then(() => { done = true; }, e => { done = true; error = e; });
    for (let elapsed = 0; !done && elapsed < max; elapsed += 250) await advance(250);
    assert.ok(done, '任务必须在虚拟时间上限内收尾');
    if (error) throw error;
    return promise;
  }
  const network = online => {
    ctx.navigator.onLine = online;
    for (const fn of listeners.get(online ? 'online' : 'offline') || []) fn();
  };
  return { ctx, advance, finish, frames, writes, finishes, timers, handle, network, listeners };
}

function response(chunks, ms, signal, delay) {
  let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({
    read: () => i < chunks.length
      ? delay({ done: false, value: Uint8Array.from(chunks[i++]) }, ms, signal)
      : Promise.resolve({ done: true }),
  }) } };
}
const plan = n => ({ type: 'hls', map: { url: 'init' }, segments:
  Array.from({ length: n }, (_, i) => ({ url: String(i), seq: i })) });
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('通过：' + name); }

(async () => {
  await check('坏候选超过准备时限会退出，好候选仍保留', async () => {
    const text = '#EXTM3U\n#EXTINF:10,\nmovie.ts\n#EXT-X-ENDLIST';
    const h = harness((url, o, t) => url.endsWith('bad.m3u8')
      ? t.delay(null, 60000, o.signal)
      : Promise.resolve(response([new TextEncoder().encode(text)], 1, o.signal, t.delay)));
    const result = await h.finish(h.ctx.__DYC_REPLAY_TEST__.pickBest([
      { url: 'https://offline/bad.m3u8', kind: 'hls' },
      { url: 'https://offline/good.m3u8', kind: 'hls' },
    ]), 8000);
    assert.equal(result.best.url, 'https://offline/good.m3u8');
    assert.equal(result.best.total, 10); assert.equal(h.timers.size, 0);
  });
  await check('小红书清单区分等待超时和服务器限流', async () => {
    for (const [status, expected] of [[0, /超时/], [429, /HTTP 429/], [403, /HTTP 403/]]) {
      const h = harness((url, o, t) => status
        ? Promise.resolve({ ok: false, status })
        : t.delay(null, 60000, o.signal));
      h.ctx.__DYC_REPLAY_NET__.media = () => [{ kind: 'hls', url: 'https://offline/123_replay.m3u8?secret=fixture' }];
      const result = await h.finish(h.ctx.__DYC_REPLAY_TEST__.buildSession({ roomId: '123', duration: 10 }), 24000);
      assert.equal(result.plan, null);
      assert.match(result.detail, expected);
      assert.doesNotMatch(result.detail, /offline|secret|fixture/);
      assert.equal(h.timers.size, 0);
    }
  });
  await check('小红书有吞吐收益时恢复自适应升档', async () => {
    const h = harness((url, o, t) => Promise.resolve(response([[Number(url)]], 275, o.signal, t.delay)));
    const p = { type: 'hls', passthrough: true, segments: plan(90).segments, xhs: true };
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.runDownload(p, 'test'));
    assert.ok(h.frames.some(frame => /[4-9] 线程/.test(frame.badge)));
    assert.deepEqual(h.writes.flat(), Array.from({ length: 90 }, (_, i) => i));
  });
  await check('打开自动重试也遵守服务器要求的更长等待', async () => {
    const requests = [];
    let denied = false;
    const h = harness((url, o, t) => {
      requests.push({ url, at: t.now() });
      if (!denied) {
        denied = true;
        return Promise.resolve({ ok: false, status: 429, headers: { get: () => '100' } });
      }
      return Promise.resolve(response([[1]], 1, o.signal, t.delay));
    });
    const planForXhs = { type: 'hls', passthrough: true, segments: plan(1).segments, xhs: true };
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(planForXhs, 'test');
    await h.advance(3000);
    h.ctx.autoRetry(true);
    assert.equal(requests.length, 1);
    assert.ok(h.frames.some(frame => frame.mode === 'cooldown' && /HTTP 429/.test(frame.reason)));
    h.ctx.pause();
    await h.advance(90000);
    assert.equal(requests.length, 1, '冷却期间不允许手动提前重试');
    await h.finish(p);
    assert.equal(requests.length, 2);
    assert.ok(requests[1].at - requests[0].at >= 100000);
    assert.deepEqual(h.writes.flat(), [1]);
    assert.equal(h.timers.size, 0);
  });
  await check('小红书遇到限流后单路探活恢复，不一次补满并发', async () => {
    const started = [];
    let denied = false;
    const h = harness((url, o, t) => {
      started.push({ url, at: t.now() });
      if (url === '0' && !denied) {
        denied = true;
        return t.delay({ ok: false, status: 429 }, 50, o.signal);
      }
      return Promise.resolve(response([[Number(url)]], 500, o.signal, t.delay));
    });
    const media = { type: 'hls', passthrough: true, segments: plan(6).segments, xhs: true };
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(media, 'rate-limit');
    await h.advance(1); h.ctx.autoRetry(true);
    await h.advance(59999);
    assert.equal(started.length, 3, '冷却期间不再发请求');
    await h.advance(60);
    assert.equal(started.length, 4, '恢复瞬间只放一路，不把刚解封的窗口再撞回去');
    await h.advance(200);
    assert.equal(started.length, 4, '探活片没下完之前不许起第二路');
    await h.finish(p);
    assert.deepEqual(h.writes.flat(), [0, 1, 2, 3, 4, 5]);
    assert.equal(h.timers.size, 0);
  });
  await check('小红书分片沉默超时后停止发请求，冷却期间可以取消', async () => {
    let requests = 0;
    const h = harness((url, o, t) => {
      requests++;
      return url === '0'
        ? t.delay(null, 60000, o.signal)
        : Promise.resolve(response([[255]], 1, o.signal, t.delay));
    });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload({ ...plan(2), xhs: true }, 'test');
    await h.advance(1); h.ctx.autoRetry(true);
    await h.advance(35000);
    assert.equal(requests, 3, '超时后不再发出新请求');
    assert.ok(h.frames.some(frame => frame.mode === 'cooldown' && /超时/.test(frame.reason)));
    h.ctx.cancel();
    await h.finish(p);
    assert.equal(h.finishes.at(-1), 'warn');
    assert.equal(h.timers.size, 0);
  });
  await check('两平台新任务默认手动，开启后重试间隔按 60/120/240 秒递增', async () => {
    for (const xhs of [false, true]) {
      let calls = 0;
      const h = harness((url, o, t) => {
        if (++calls <= 3) {
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve(response([[1]], 1, o.signal, t.delay));
      });
      const media = { type: 'hls', passthrough: true, segments: plan(1).segments, xhs };
      const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(media, 'auto');
      await h.advance(45000);
      assert.equal(calls, 1);
      assert.equal(h.frames.at(-1).autoRetry, false);
      assert.equal(h.frames.at(-1).mode, 'retry', '开关关闭时只等手动重试');
      h.ctx.autoRetry(true);
      await h.advance(59999);
      assert.equal(calls, 1, '第一次自动重试要等满 60 秒');
      assert.ok(h.frames.some(f => /第 1 次/.test(f.badge)), '冷却时露出「第几次重试」');
      await h.advance(1);
      assert.equal(calls, 2);
      await h.advance(119999);
      assert.equal(calls, 2, '连续第二次失败后间隔翻倍到 120 秒');
      assert.ok(h.frames.some(f => /第 2 次/.test(f.badge)), '连续失败时次数递增，不是一直显示第 1 次');
      await h.advance(1);
      assert.equal(calls, 3);
      h.ctx.autoRetry(false);
      await h.advance(300000);
      assert.equal(calls, 3, '关闭会取消已经安排的自动重试');
      h.ctx.autoRetry(true);
      await h.advance(239999);
      assert.equal(calls, 3, '连续第三次失败后间隔 240 秒');
      await h.advance(1);
      assert.equal(calls, 4);
      await h.finish(p);
      assert.deepEqual(h.writes.flat(), [1]);
      assert.doesNotMatch(String(h.frames.at(-1).badge || ''), /第 \d+ 次/, '下完后不再显示重试次数');
      assert.equal(h.timers.size, 0);
    }
  });
  await check('续传拿到分片后再次断流，等待从 60 秒重新起算', async () => {
    const times = [];
    let first = true;
    const h = harness((url, o, t) => {
      times.push({ url, at: t.now() });
      if (url === '0' && first) {
        first = false;
        return Promise.resolve({ ok: false, status: 503 });
      }
      if (url === '1' && times.filter(x => x.url === '1').length === 1) {
        return Promise.resolve({ ok: false, status: 503 });
      }
      return Promise.resolve(response([[1]], 1, o.signal, t.delay));
    });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(
      { type: 'hls', passthrough: true, segments: plan(2).segments, xhs: true }, 'reset');
    await h.advance(1);
    h.ctx.autoRetry(true);
    await h.advance(60001);
    const seg0 = times.filter(x => x.url === '0').map(x => x.at);
    assert.equal(seg0.length, 2, '第一次失败后 60 秒重试');
    assert.ok(seg0[1] - seg0[0] >= 60000);
    await h.advance(60001);
    const seg1 = times.filter(x => x.url === '1').map(x => x.at);
    assert.equal(seg1.length, 2, '有分片成功后，下一次失败仍按 60 秒起算');
    assert.ok(seg1[1] - seg1[0] >= 60000 && seg1[1] - seg1[0] < 90000);
    await h.finish(p);
    assert.deepEqual(h.writes.flat(), [1, 1]);
    assert.equal(h.timers.size, 0);
  });
  await check('HEAD卡住按短时限降级，未知大小的直链仍可下载', async () => {
    const h = harness((url, o, t) => t.delay(null, 60000, o.signal));
    const result = await h.finish(h.ctx.__DYC_REPLAY_TEST__.pickBest([
      { url: 'https://offline/a.mp4', kind: 'mp4' },
    ]), 3000);
    assert.equal(result.best.type, 'mp4'); assert.equal(result.best.bytes, 0);
    assert.equal(h.timers.size, 0);
  });
  await check('有清单码率时直接估算体积，不额外等待六次HEAD', async () => {
    const h = harness(() => { throw new Error('不应发起体积探测'); });
    const bytes = await h.ctx.__DYC_REPLAY_TEST__.estimateBytes({
      type: 'hls', bandwidth: 8000000, total: 120, segments: [],
    });
    assert.equal(bytes, 120000000);
  });
  await check('轨道探测卡住按时退出，不阻塞确认卡', async () => {
    const h = harness((url, o, t) => t.delay(null, 60000, o.signal));
    const p = plan(2);
    const result = await h.finish(h.ctx.__DYC_REPLAY_TEST__.choosePlayable([p]), 4000);
    assert.equal(result.plan, p); assert.equal(h.timers.size, 0);
  });
  await check('剩余时间扣除已下载缓存，并以网络和写盘较慢者为准', async () => {
    const h = harness(() => {}), remaining = h.ctx.__DYC_REPLAY_TEST__.remainingSeconds;
    const t = { expected: 1000, received: 800, written: 200, writeMs: 2000, complete: false };
    assert.equal(remaining(t, 100), 8, '网络还需2秒，但写盘还需8秒');
    assert.equal(remaining({ ...t, writeMs: 100 }, 100), 2, '缓存不应再算成网络待下载量');
    assert.equal(remaining({ ...t, received: 1000, complete: true }, 0), 8,
      '网络已下完仍应计算写盘剩余时间');
    assert.equal(remaining(t, 0), null, '真实断流时不显示虚假倒计时');
    assert.equal(remaining({ ...t, writeStartedAt: 95000 }, 100), 28,
      '当前写入变慢时，处理耗时也必须计入估算');
    assert.equal(h.ctx.__DYC_REPLAY_TEST__.fmtEta(3600), '1时0分0秒');
    assert.equal(h.ctx.__DYC_REPLAY_TEST__.fmtEta(3599), '59分59秒');
    assert.equal(h.ctx.__DYC_REPLAY_TEST__.fmtEta(59), '59秒');
  });
  await check('大分片加慢写盘触发字节预算，顺序片仍可完成', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const h = harness((url, o, t) => Promise.resolve(response(
      url === 'init' ? [[255]] : new Array(16).fill(chunk),
      url === 'init' ? 1 : 50, o.signal, t.delay)));
    let peak = 0;
    const ctl = { abortCtl: new AbortController(), onData() {
      peak = Math.max(peak, ctl.transfer.received - ctl.transfer.written);
    } };
    const order = [];
    const sink = new h.ctx.__DYC_REPLAY_WRITER__.SerialSink({ write: buf => new Promise(resolve => {
      if (buf.byteLength > 1) order.push(buf.byteLength);
      h.ctx.setTimeout(resolve, buf.byteLength > 1 ? 15000 : 1);
    }) });
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.doWrite(sink, plan(8), ctl, () => {}));
    assert.equal(order.length, 8);
    assert.equal(ctl.transfer.written, 8 * 16 * chunk.byteLength);
    assert.ok(peak <= 48 * 1024 * 1024, '预算允许顺序片与在飞收包临时余量，不能攒满八个大分片');
    assert.equal(h.timers.size, 0);
  });
  await check('后片先填缓存时，超过预算的顺序片仍能收完，避免互等', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const h = harness((url, o, t) => Promise.resolve(response(url === 'init' ? [[255]] :
      new Array(url === '0' ? 40 : 8).fill(chunk), url === '0' ? 80 : 5, o.signal, t.delay)));
    const ctl = { abortCtl: new AbortController() };
    const sink = new h.ctx.__DYC_REPLAY_WRITER__.SerialSink({ write: async () => {} });
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.doWrite(sink, plan(3), ctl, () => {}), 10000);
    assert.equal(ctl.transfer.written, 56 * chunk.byteLength);
    assert.equal(ctl.transfer.received, ctl.transfer.written);
    assert.equal(h.timers.size, 0);
  });
  await check('真实进度卡分别更新速度与倒计时，不销毁显示槽位', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    try {
      dom.window.eval(read('src/replay/replay-ui.js'));
      const ui = dom.window.__DYC_REPLAY_UI__;
      ui.mount(); ui.showProgress('test.mp4');
      const root = dom.window.document.querySelector('#dyc-replay-host').shadowRoot;
      // 文案闸门不覆盖下载卡，这条盯住「说明里的间隔」与重试常量一起改。
      const note = root.querySelector('.pc-retry-note');
      assert.ok(/60 秒/.test(note.textContent), '重试说明应写明首个等待是 60 秒');
      assert.doesNotMatch(note.textContent, /30 秒/, '旧的固定 30 秒口径不许残留');
      const speed = root.querySelector('.pc-speed'), eta = root.querySelector('.pc-eta');
      for (const value of ['100时0分0秒', '1时0分0秒', '59分59秒', '9秒']) {
        ui.setProgress(0.5, { speed: '1.2 MB/s', eta: value, left: '1 GB' });
        assert.equal(root.querySelector('.pc-speed'), speed);
        assert.equal(root.querySelector('.pc-eta'), eta);
        assert.equal(eta.textContent, value); assert.equal(speed.textContent, '1.2 MB/s');
      }
      ui.finishProgress('ok', 'done');
      assert.equal(eta.textContent, '');
      ui.unmount();
    } finally { dom.window.close(); }
  });
  await check('确认卡精简信息与字重，详情默认收起，保留改名和下载动作', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><html><body><div class="video-area"></div></body></html>', {
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    try {
      const w = dom.window;
      w.eval(read('src/replay/replay-ui.js'));
      const ui = w.__DYC_REPLAY_UI__;
      const player = w.document.querySelector('.video-area');
      player.getBoundingClientRect = () => ({ left: 180, right: 420, top: 290, bottom: 650 });
      ui.mount('.video-area');
      const host = w.document.querySelector('#dyc-replay-host');
      assert.ok(parseFloat(host.style.left) > player.getBoundingClientRect().right, '小红书按钮应位于播放器外侧右边');
      const root = host.shadowRoot;
      const info = { timeText: '2026-10-21 10:34', durationSec: 8400, bytes: 7.7 * 1024 ** 3,
        qualityText: '页面默认', tracks: { video: 'h265', audio: true }, segCount: 848,
        fileName: 'test', ext: '.ts', playbackNote: '兼容播放说明' };
      let chosen = null;
      ui.showCard(info, name => { chosen = name; });
      const card = root.querySelector('.card');
      assert.equal(card.querySelectorAll('b,strong').length, 0, '信息值不应单独加粗');
      assert.equal(card.querySelectorAll('.card-info .kv').length, 3, '未知清晰度不占一行');
      assert.equal(card.querySelector('details').open, false);
      assert.ok(card.querySelector('.detail-list').textContent.includes('848'));
      assert.equal(card.querySelector('.warn'), null, '普通兼容说明不应显示为告警');
      assert.ok(card.querySelector('.compat'));
      card.querySelector('#dyc-name').value = '我/的 回放.ts';
      card.querySelector('[data-act="go"]').click();
      assert.equal(chosen, '我的_回放');
      assert.equal(card.hidden, true);
      ui.showCard({ ...info, qualityText: '1080P（已选最高档）', playbackNote: '', warn: '内容不完整',
        warnBad: true, blocked: true, bytes: 0, encrypted: true }, () => { chosen = 'bad'; });
      assert.equal(card.querySelectorAll('.card-info .kv').length, 4, '真实分辨率应显示');
      assert.equal(card.querySelector('.card-info .kv:last-child .v').textContent, '1080P');
      assert.ok(card.querySelector('.warn.bad'));
      assert.equal(card.querySelector('.compat'), null);
      assert.equal(card.querySelector('[data-act="go"]').disabled, true);
      card.querySelector('[data-act="go"]').click();
      assert.notEqual(chosen, 'bad');
      assert.ok(card.querySelector('.detail-list').textContent.includes('AES-128'));
      assert.equal(card.querySelector('details').open, false, '重新打开也默认收起详情');
      w.innerWidth = 320; w.innerHeight = 760;
      card.getBoundingClientRect = () => ({ left: 194, top: 76, width: 304, height: 700 });
      ui.placePop(card, 400, { left: 194, right: 312, top: 38, bottom: 70 });
      const left = 194 + parseFloat(card.style.left), top = 38 + parseFloat(card.style.top);
      assert.ok(left >= 0 && left + 304 <= 320, '窄窗下确认卡应在横向视口内');
      assert.ok(top >= 0 && top + 700 <= 760, '展开后确认卡应在纵向视口内');
      let cancelled = false;
      ui.showCard(info, () => {}, () => { cancelled = true; });
      card.querySelector('[data-act="cancel"]').click();
      assert.equal(cancelled, true);
      ui.unmount();
    } finally { dom.window.close(); }
  });
  await check('下载计划将兼容说明与内容缺失警告分开，保留原覆盖率门槛', async () => {
    const media = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:90,\nmovie.m4s\n#EXT-X-ENDLIST';
    const h = harness((url, o, t) => {
      if (o.method === 'HEAD') return Promise.resolve({ ok: true, headers: { get: () => '100' } });
      const text = url.endsWith('m3u8') ? media : '....ftyp....hvc1....soun....';
      return Promise.resolve(response([new TextEncoder().encode(text)], 1, o.signal, t.delay));
    });
    h.ctx.__DYC_REPLAY_NET__.media = () => [{ kind: 'hls', url: 'https://offline/a.m3u8' }];
    h.ctx.__DYC_REPLAY_META__.sessionDuration = () => 100;
    const partial = await h.finish(h.ctx.__DYC_REPLAY_TEST__.buildSession());
    assert.equal(partial.coverage, 0.9); assert.equal(partial.blocked, false);
    assert.ok(partial.warn.includes('90%'));
    assert.ok(partial.playbackNote.includes('H.265'));
    assert.equal(partial.warn.includes('H.265'), false);
    h.ctx.__DYC_REPLAY_META__.sessionDuration = () => 200;
    const blocked = await h.finish(h.ctx.__DYC_REPLAY_TEST__.buildSession());
    assert.equal(blocked.blocked, true);
    h.ctx.__DYC_REPLAY_META__.sessionDuration = () => 90;
    const complete = await h.finish(h.ctx.__DYC_REPLAY_TEST__.buildSession());
    assert.equal(complete.warn, ''); assert.ok(complete.playbackNote);
    assert.equal(h.timers.size, 0);
  });
  await check('小红书已结束场次从播放器旁读取本场，忽略上一场清单并校验时长', async () => {
    const media = '#EXTM3U\n#EXTINF:40,\nmovie.ts\n#EXT-X-ENDLIST';
    const requested = [];
    const h = harness((url, o, t) => {
      requested.push(url);
      if (o.method === 'HEAD') return Promise.resolve({ ok: true, headers: { get: () => '100' } });
      return Promise.resolve(response([new TextEncoder().encode(media)], 1, o.signal, t.delay));
    });
    const { ctx } = h;
    const meta = ctx.__DYC_REPLAY_META__;
    delete ctx.__DYC_REPLAY_META__;
    vm.runInContext(read('src/replay/replay-meta.js'), ctx);
    Object.assign(meta, ctx.__DYC_REPLAY_META__);
    ctx.DYC_PAGE_PATTERNS = vm.runInNewContext(read('src/content/flags.js') + '\nDYC_PAGE_PATTERNS;');
    ctx.location = new URL('https://pgy.xiaohongshu.com/commerce/redlive/live_screen/operation?roomId=123');
    const header = { textContent: '直播中示例场次2026/11/18 14:36:43 开播时长 00:01:30' };
    let playerVisible = false;
    let mount, click, card;
    ctx.document = {
      querySelector(sel) {
        if (sel === '.video-area' && playerVisible) return { getClientRects: () => [{}] };
        if (sel === '.live-databoard-menu .live-info') return header;
        return null;
      },
      getElementById: () => mount,
      contains: () => !!mount,
    };
    Object.assign(ctx.__DYC_REPLAY_UI__, {
      mount(sel) { mount = sel; },
      unmount() { mount = null; },
      onBtnClick(fn) { click = fn; },
      hideCard() { card = null; },
      showCard(info) { card = info; },
    });
    ctx.__DYC_REPLAY_NET__.media = () => [
      { kind: 'hls', url: 'https://offline/1234_456.m3u8' },
      { kind: 'hls', url: 'https://offline/123_456.m3u8?token=fixture' },
    ];
    ctx.updateFlags({ replayDownload: true });
    assert.equal(mount, undefined, '没有播放器时不挂载');
    playerVisible = true;
    await h.advance(2000);
    assert.equal(mount, undefined, '直播中不挂载');
    header.textContent = header.textContent.replace('直播中', '已结束');
    await h.advance(2000);
    assert.equal(mount, '.video-area');
    click();
    await h.advance(5000);
    assert.ok(card, '点击应打开回放确认卡');
    assert.equal(card.fileName, '小红书_直播回放_2026.11.18_14点36分');
    assert.equal(card.durationSec, 90);
    assert.equal(card.blocked, true, '清单只覆盖 40 秒时禁止下载');
    assert.ok(requested.some(url => url.includes('/123_456.m3u8')));
    assert.ok(!requested.some(url => url.includes('/1234_456.m3u8')));
    header.textContent = header.textContent.replace('00:01:30', '00:00:40');
    click();
    await h.advance(5000);
    assert.equal(card.blocked, false, '时长一致的清单可以下载');
    ctx.location.searchParams.set('roomId', '999');
    await h.advance(2000);
    assert.equal(card, null, '换场后清理确认卡');
    ctx.updateFlags({ replayDownload: false });
    assert.equal(mount, null);

    ctx.location = new URL('https://anchor.douyin.com/anchor/review');
    ctx.document.body = { innerText: '开播时间 2026-11-18 14:36:43 直播时长 40秒' };
    ctx.updateFlags({ replayDownload: true });
    click();
    await h.advance(5000);
    assert.equal(card.fileName, '抖音_直播回放_2026.11.18_14点36分');
  });
  await check('请求无响应时超时，中止后清理计时器', async () => {
    const h = harness((url, o, t) => t.delay(null, 60000, o.signal));
    const p = h.ctx.__DYC_REPLAY_NET__.fetchBuf('slow', { timeoutMs: 12000 });
    const rejected = assert.rejects(p, e => e.name === 'TimeoutError');
    await h.advance(12000); await rejected;
    assert.equal(h.timers.size, 0);
  });
  await check('连续收包续期，整片超过超时时长仍成功且字节顺序正确', async () => {
    const h = harness((url, o, t) => Promise.resolve(response([[1], [2], [3], [4]], 8000, o.signal, t.delay)));
    let got = 0;
    const result = await h.finish(h.ctx.__DYC_REPLAY_NET__.fetchBuf('large', {
      timeoutMs: 12000, onData: n => { got += n; },
    }));
    assert.deepEqual(Array.from(result), [1, 2, 3, 4]);
    assert.equal(got, 4); assert.equal(h.timers.size, 0);
  });
  await check('已收到响应头但响应体卡住也能超时', async () => {
    const h = harness((url, o, t) => Promise.resolve(response([[1]], 60000, o.signal, t.delay)));
    const p = h.ctx.__DYC_REPLAY_NET__.fetchBuf('body', { timeoutMs: 12000 });
    const rejected = assert.rejects(p, e => e.name === 'TimeoutError');
    await h.advance(12000); await rejected;
    assert.equal(h.timers.size, 0);
  });
  await check('取消传播给分片请求，取消不尝试凭据降级', async () => {
    let calls = 0;
    const h = harness((url, o, t) => { calls++; return t.delay(null, 60000, o.signal); });
    const ctl = new AbortController();
    const p = h.ctx.__DYC_REPLAY_NET__.fetchBuf('cancel', { timeoutMs: 12000, signal: ctl.signal });
    const rejected = assert.rejects(p, e => e.name === 'AbortError');
    ctl.abort(); await rejected;
    assert.equal(calls, 1); assert.equal(h.timers.size, 0);
  });
  await check('卡住的首片单独重试；等待期间半秒刷新，停流后速度归零', async () => {
    let firstCalls = 0;
    const h = harness((url, o, t) => {
      if (url === '0' && firstCalls++ === 0) return t.delay(null, 60000, o.signal);
      return Promise.resolve(response([[url === 'init' ? 255 : Number(url)]], 1000, o.signal, t.delay));
    });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(6), 'test');
    await h.advance(1); h.ctx.autoRetry(true);
    await h.advance(8999);
    const waiting = h.frames.filter(f => f.time >= 102000 && f.time <= 109000);
    assert.ok(waiting.length >= 12, '没有落盘进度时仍持续刷新');
    assert.ok(waiting.some(f => parseFloat(f.speed) === 0), '停止收包后不能残留旧速度');
    assert.ok(waiting.some(f => parseFloat(f.speed) > 0), '有收包就显示实际网络速度');
    await h.finish(p);
    assert.equal(firstCalls, 2);
    assert.deepEqual(h.writes, [[255], [0], [1], [2], [3], [4], [5]]);
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
  });
  await check('持续收包但首片未完成，不按写盘空窗误判整场停滞', async () => {
    const h = harness((url, o, t) => Promise.resolve(response(
      url === 'init' ? [[255]] : [[1], [2], [3], [4], [5]],
      url === 'init' ? 1 : 8000, o.signal, t.delay)));
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(1), 'long'));
    assert.deepEqual(h.finishes, ['ok']);
  });
  await check('剩余时间在两次分片落盘之间继续重新估算，结束后不再刷新', async () => {
    const h = harness((url, o, t) => Promise.resolve(response(
      url === 'init' ? [[255]] : Array.from({ length: 4 }, () => new Array(1000).fill(1)),
      url === 'init' ? 1 : 1000, o.signal, t.delay)));
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(12), 'eta'));
    assert.ok(h.frames.some((f, i) => i && f.ratio > 0 && f.ratio < 1 &&
      f.ratio === h.frames[i - 1].ratio && /\d+秒/.test(f.eta) &&
      /\d+秒/.test(h.frames[i - 1].eta) && f.eta !== h.frames[i - 1].eta),
    '没有新的分片写完，收包变化也应更新速度和剩余时间');
    const count = h.frames.length;
    await h.advance(5000);
    assert.equal(h.frames.length, count);
    assert.equal(h.timers.size, 0);
  });
  await check('关闭续传时鉴权失败仍结束任务并清理请求', async () => {
    let failed = 0, hangingSignal;
    const h = harness((url, o, t) => {
      if (url === '0') { failed++; return Promise.resolve({ ok: false, status: 403 }); }
      if (url !== 'init') { hangingSignal = o.signal; return t.delay(null, 60000, o.signal); }
      return Promise.resolve(response([[255]], 1, o.signal, t.delay));
    });
    h.ctx.updateFlags({ replayResume: false });
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(5), 'bad'));
    assert.equal(failed, 1); assert.ok(hangingSignal.aborted);
    assert.deepEqual(h.finishes, ['bad']); assert.equal(h.timers.size, 0);
  });
  await check('实际吞吐量有收益才保留升档，无收益退回', async () => {
    async function simulate(sharedBandwidth) {
      const h = harness(() => { throw new Error('测试使用分片网络桩'); });
      let active = 0, peak = 0;
      h.ctx.__DYC_REPLAY_NET__.fetchBuf = (url, opts) => {
        active++; peak = Math.max(peak, active);
        return new Promise(resolve => h.ctx.setTimeout(() => {
          active--; if (opts.onData) opts.onData(100);
          resolve(new Uint8Array(100));
        }, sharedBandwidth ? active * 1000 : 1500));
      };
      const sink = new h.ctx.__DYC_REPLAY_WRITER__.SerialSink({ write: async () => {} });
      const conc = [];
      await h.finish(h.ctx.__DYC_REPLAY_TEST__.doWrite(sink, plan(90),
        { abortCtl: new AbortController() }, (done, total, bytes, c) => conc.push(c)));
      return { conc, peak };
    }
    const flat = await simulate(true), fast = await simulate(false);
    assert.ok(flat.conc.some((c, i) => i && c < flat.conc[i - 1]), '升档无收益应降回');
    assert.ok(Math.max(...fast.conc) >= 5, '可扩展的网络应持续升档');
    assert.ok(fast.peak <= 10 && flat.peak <= 10, '并发不能超过上限');
  });
  await check('直链MP4按响应长度计算进度，速度更新与字节写入顺序正确', async () => {
    const h = harness((url, o, t) => Promise.resolve({
      ...response([[1, 2], [3, 4]], 1000, o.signal, t.delay),
      headers: { get: name => name === 'content-length' ? '4' : null },
    }));
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.runDownload({ type: 'mp4', url: 'movie', segments: [] }, 'mp4'));
    assert.deepEqual(h.writes, [[1, 2], [3, 4]]);
    assert.ok(h.frames.some(f => f.ratio === 0.5 && !/段/.test(f.left)));
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
  });
  await check('下载中取消会清理请求和刷新计时器', async () => {
    const h = harness((url, o, t) => Promise.resolve(response([[1]], 5000, o.signal, t.delay)));
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(5), 'cancel');
    await h.advance(5500); h.ctx.cancel(); await h.finish(p);
    const count = h.frames.length;
    await h.advance(15000);
    assert.deepEqual(h.finishes, ['warn']);
    assert.equal(h.frames.length, count); assert.equal(h.timers.size, 0);
  });
  await check('写盘与保存阶段有独立状态，写入顺序不变', async () => {
    const h = harness(() => {}), phases = [];
    const sink = await h.ctx.__DYC_REPLAY_WRITER__.openSink(h.handle, p => phases.push(p));
    await sink.write(Uint8Array.from([1])); await sink.write(Uint8Array.from([2])); await sink.close();
    assert.equal(phases.length, 3);
    assert.equal(phases[0], phases[1]); assert.notEqual(phases[1], phases[2]);
    assert.deepEqual(h.writes, [[1], [2]]);
  });
  await check('重试退避期间取消立即收尾，不留下重试计时器', async () => {
    const h = harness((url, o, t) => url === 'init'
      ? Promise.resolve(response([[255]], 1, o.signal, t.delay))
      : Promise.resolve({ ok: false, status: 503 }));
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(5), 'retry');
    await h.advance(1); h.ctx.autoRetry(true);
    await h.advance(99); h.ctx.cancel(); await h.finish(p);
    assert.deepEqual(h.finishes, ['warn']); assert.equal(h.timers.size, 0);
  });
  await check('转封装初始化同步抛错也中止写入并清理状态', async () => {
    const h = harness(() => {});
    let aborted = false;
    h.handle.createWritable = async () => ({ abort: async () => { aborted = true; } });
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.runDownload({
      type: 'hls', segments: [{ url: '0' }],
    }, 'missing-mux'));
    assert.ok(aborted); assert.deepEqual(h.finishes, ['bad']); assert.equal(h.timers.size, 0);
  });
  await check('TS转封装阶段先报告，再进入顺序写盘', async () => {
    const h = harness(() => {}), phases = [];
    h.ctx.muxjs = { mp4: { Transmuxer: class {
      on(name, fn) { if (name === 'data') this.data = fn; }
      push(buf) { this.buf = buf; }
      flush() { this.data({ initSegment: Uint8Array.from([255]), data: this.buf }); }
    } } };
    const sink = await h.ctx.__DYC_REPLAY_WRITER__.openSink(h.handle, p => phases.push(p));
    const stream = h.ctx.__DYC_REPLAY_WRITER__.createTsStream(sink);
    await stream.write(Uint8Array.from([1, 2])); await stream.end(); await sink.close();
    assert.equal(phases.length, 4);
    assert.notEqual(phases[0], phases[1]); assert.equal(phases[1], phases[2]);
    assert.notEqual(phases[2], phases[3]);
    assert.deepEqual(h.writes, [[255], [1, 2]]);
  });
  await check('暂停超过停滞时限仍保留顺序进度，联网或其他开关变化不解除手动暂停', async () => {
    const calls = [];
    const h = harness((url, o, t) => {
      calls.push(url);
      return Promise.resolve(response([[url === 'init' ? 255 : Number(url)]],
        url === 'init' ? 1 : url === '0' ? 200 : 1500, o.signal, t.delay));
    });
    let removed = 0, aborted = 0;
    h.handle.remove = async () => { removed++; };
    const original = h.handle.createWritable;
    h.handle.createWritable = async () => ({ ...await original(), abort: async () => { aborted++; } });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(8), 'pause');
    await h.advance(450); h.ctx.pause(); await h.advance(1);
    const before = h.writes.length, requests = calls.length;
    assert.ok(before >= 2, '至少一片已写入后暂停');
    h.network(false); h.network(true); h.ctx.updateFlags({ unrelatedFlag: true });
    await h.advance(60000);
    assert.equal(h.writes.length, before); assert.equal(calls.length, requests);
    assert.equal(h.frames.at(-1).mode, 'paused');
    assert.equal(removed, 0); assert.equal(aborted, 0); assert.equal(h.finishes.length, 0);
    h.ctx.pause(); await h.finish(p);
    assert.deepEqual(h.writes, [[255], ...Array.from({ length: 8 }, (_, i) => [i])]);
    assert.equal(calls.filter(v => v === '0').length, 1, '已写入片不重新请求');
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
    assert.ok([...h.listeners.values()].every(v => v.size === 0));
  });
  await check('默认关闭时，恢复联网仍等用户手动继续并保留进度', async () => {
    const h = harness((url, o, t) => Promise.resolve(response(
      [[url === 'init' ? 255 : Number(url)]], url === 'init' ? 1 : 1000, o.signal, t.delay)));
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(9), 'offline');
    await h.advance(1200); h.network(false); await h.advance(60000);
    assert.equal(h.frames.at(-1).mode, 'offline');
    assert.equal(h.finishes.length, 0);
    h.network(true); await h.advance(31000);
    assert.equal(h.frames.at(-1).mode, 'retry');
    h.ctx.pause(); await h.finish(p);
    assert.deepEqual(h.writes, [[255], ...Array.from({ length: 9 }, (_, i) => [i])]);
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
  });
  await check('自动重试关闭时保留已写入进度，手动重试后整场完成', async () => {
    let broken = true, calls = 0;
    const h = harness((url, o, t) => {
      calls++;
      if (url === '1' && broken) return t.delay({ ok: false, status: 503 }, 400, o.signal);
      return Promise.resolve(response([[url === 'init' ? 255 : Number(url)]], 100, o.signal, t.delay));
    });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(7), 'retry');
    await h.advance(12000);
    assert.equal(h.frames.at(-1).mode, 'retry');
    assert.ok(h.writes.some(w => w[0] === 0));
    const count = calls;
    await h.advance(45000); assert.equal(calls, count);
    broken = false; h.ctx.pause(); await h.finish(p);
    assert.deepEqual(h.writes, [[255], ...Array.from({ length: 7 }, (_, i) => [i])]);
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
  });
  await check('初始化段失败也可等待恢复，等待中取消会清理请求、监听和计时器', async () => {
    const h = harness(() => Promise.resolve({ ok: false, status: 403 }));
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(3), 'init-failed');
    await h.advance(1000); assert.equal(h.frames.at(-1).mode, 'retry');
    h.ctx.cancel(); await h.finish(p);
    assert.deepEqual(h.finishes, ['warn']); assert.equal(h.timers.size, 0);
    assert.ok([...h.listeners.values()].every(v => v.size === 0));
  });
  await check('等待重试时遇到断网，开启自动重试后按间隔恢复', async () => {
    let broken = true;
    const h = harness((url, o, t) => broken ? Promise.resolve({ ok: false, status: 503 }) :
      Promise.resolve(response([[255]], 100, o.signal, t.delay)));
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(1), 'late-offline');
    await h.advance(5000); assert.equal(h.frames.at(-1).mode, 'retry');
    h.network(false); await h.advance(500); assert.equal(h.frames.at(-1).mode, 'offline');
    h.ctx.autoRetry(true);
    await h.advance(61000);
    assert.equal(h.frames.at(-1).mode, 'cooldown');
    broken = false; h.network(true); await h.finish(p);
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
  });
  await check('关闭续传开关立即释放暂停，下载继续且不重新写已完成片', async () => {
    const h = harness((url, o, t) => Promise.resolve(response(
      [[url === 'init' ? 255 : Number(url)]], 100, o.signal, t.delay)));
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(5), 'flag');
    await h.advance(250); h.ctx.pause(); await h.advance(1000);
    h.ctx.updateFlags({ replayResume: false }); await h.finish(p);
    assert.deepEqual(h.finishes, ['ok']);
    assert.deepEqual(h.writes, [[255], [0], [1], [2], [3], [4]]);
    assert.ok(h.frames.some(f => f.recoverable === false));
  });
  await check('TS暂停后复用同一个转封装实例与初始化段', async () => {
    const h = harness((url, o, t) => Promise.resolve(response([[Number(url)]], 500, o.signal, t.delay)));
    let instances = 0, written = 0;
    h.ctx.muxjs = { mp4: { Transmuxer: class {
      constructor() { instances++; }
      on(name, fn) { if (name === 'data') this.data = fn; }
      push(buf) { this.buf = buf; }
      flush() { this.data({ initSegment: Uint8Array.from([255]), data: this.buf }); written++; }
    } } };
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload({ type: 'hls', segments: plan(8).segments }, 'ts');
    await h.advance(700); h.ctx.pause(); await h.advance(2000);
    const before = written; h.ctx.pause(); await h.finish(p);
    assert.ok(before > 0); assert.equal(instances, 1); assert.equal(written, 8);
    assert.deepEqual(h.writes, [[255], ...Array.from({ length: 8 }, (_, i) => [i])]);
  });
  function directResponse(chunks, status, headers, o, t) {
    return { ...response(chunks, 300, o.signal, t.delay), status,
      headers: { get: name => headers[name] || null } };
  }
  await check('直链暂停后按已写入字节发Range并校验原文件，不重复写入', async () => {
    const requests = [];
    const h = harness((url, o, t) => {
      requests.push(o.headers || {});
      const start = o.headers ? Number(/bytes=(\d+)/.exec(o.headers.Range)[1]) : 0;
      const bytes = [1, 2, 3, 4, 5, 6].slice(start);
      return Promise.resolve(directResponse(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.slice(i * 2, i * 2 + 2)),
        start ? 206 : 200, { 'content-length': String(bytes.length), etag: '"v1"',
          'content-range': start ? 'bytes ' + start + '-5/6' : '' }, o, t));
    });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload({ type: 'mp4', url: 'movie', segments: [] }, 'direct');
    await h.advance(400); h.ctx.pause(); await h.advance(3000);
    assert.deepEqual(h.writes, [[1, 2]]);
    h.ctx.pause(); await h.finish(p);
    assert.deepEqual(h.writes, [[1, 2], [3, 4], [5, 6]]);
    assert.equal(requests[1].Range, 'bytes=2-'); assert.equal(requests[1]['If-Range'], '"v1"');
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
  });
  for (const invalid of ['ignored', 'changed', 'wrong-offset', 'no-validator']) {
    await check('直链续传拒绝不安全响应：' + invalid, async () => {
      let count = 0;
      const h = harness((url, o, t) => {
        const first = ++count === 1;
        return Promise.resolve(directResponse([[1, 2], [3, 4]], first || invalid === 'ignored' ? 200 : 206,
          { 'content-length': first || invalid === 'ignored' ? '4' : '2',
            etag: invalid === 'no-validator' ? '' : !first && invalid === 'changed' ? '"v2"' : '"v1"',
            'content-range': invalid === 'wrong-offset' ? 'bytes 0-1/4' : 'bytes 2-3/4' }, o, t));
      });
      const p = h.ctx.__DYC_REPLAY_TEST__.runDownload({ type: 'mp4', url: 'movie', segments: [] }, 'unsafe');
      await h.advance(400); h.ctx.pause(); await h.advance(100); h.ctx.pause(); await h.finish(p);
      assert.deepEqual(h.finishes, ['bad']); assert.deepEqual(h.writes, [[1, 2]]);
      assert.equal(h.timers.size, 0);
    });
  }
  await check('直链写盘失败直接收尾，不重复请求或误报可续传', async () => {
    let calls = 0;
    const h = harness((url, o, t) => {
      calls++; return Promise.resolve(directResponse([[1, 2]], 200,
        { 'content-length': '2', etag: '"v1"' }, o, t));
    });
    h.handle.createWritable = async () => ({ write: async () => { throw new Error('磁盘已满'); }, abort: async () => {} });
    await h.finish(h.ctx.__DYC_REPLAY_TEST__.runDownload({ type: 'mp4', url: 'movie', segments: [] }, 'disk'));
    assert.equal(calls, 1); assert.deepEqual(h.finishes, ['bad']); assert.equal(h.timers.size, 0);
  });
  await check('直链接收中断自动从已写入字节重试，收到完整文件后不因EOF中断重下', async () => {
    let calls = 0;
    const h = harness((url, o, t) => {
      calls++;
      const first = !o.headers;
      let step = 0;
      return Promise.resolve({ ok: true, status: first ? 200 : 206,
        headers: { get: name => ({ 'content-length': first ? '4' : '2',
          etag: '"v1"', 'content-range': first ? '' : 'bytes 2-3/4' })[name] || null },
        body: { getReader: () => ({ read: () => step++ === 0
          ? t.delay({ done: false, value: Uint8Array.from(first ? [1, 2] : [3, 4]) }, 100, o.signal)
          : Promise.reject(new Error('连接中断')) }) },
      });
    });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload({ type: 'mp4', url: 'movie', segments: [] }, 'network');
    await h.advance(1); h.ctx.autoRetry(true);
    await h.finish(p);
    assert.equal(calls, 2); assert.deepEqual(h.writes, [[1, 2], [3, 4]]);
    assert.deepEqual(h.finishes, ['ok']); assert.equal(h.timers.size, 0);
  });
  await check('关闭续传后取消仍能中止关闭开关前已发出的请求', async () => {
    const signals = [];
    const h = harness((url, o, t) => {
      if (url !== 'init') signals.push(o.signal);
      return Promise.resolve(response([[1]], url === 'init' ? 1 : 60000, o.signal, t.delay));
    });
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload(plan(3), 'toggle-cancel');
    await h.advance(100); h.ctx.updateFlags({ replayResume: false }); h.ctx.cancel(); await h.finish(p);
    assert.ok(signals.length > 0 && signals.every(s => s.aborted));
    assert.deepEqual(h.finishes, ['warn']); assert.equal(h.timers.size, 0);
  });
  await check('加密回放密钥请求失败可恢复，复用原有分片且只写一次', async () => {
    let broken = true, keyCalls = 0, segmentCalls = 0;
    const h = harness((url, o, t) => {
      if (url === 'key') {
        keyCalls++;
        if (broken) return Promise.resolve({ ok: false, status: 403 });
        return Promise.resolve(response([new Uint8Array(16)], 1, o.signal, t.delay));
      }
      segmentCalls++;
      return Promise.resolve(response([[1]], 100, o.signal, t.delay));
    });
    h.ctx.crypto = { subtle: { importKey: async () => ({}), decrypt: async (_, key, bytes) => bytes } };
    const p = h.ctx.__DYC_REPLAY_TEST__.runDownload({ type: 'hls', passthrough: true,
      key: { method: 'AES-128', url: 'key' }, segments: [{ url: '0', seq: 0 }] }, 'encrypted');
    await h.advance(1000); h.ctx.autoRetry(true);
    await h.advance(31000);
    assert.equal(h.frames.at(-1).mode, 'retry');
    assert.equal(keyCalls, 1, '403 不会自动重复请求');
    broken = false; h.ctx.pause(); await h.finish(p);
    assert.equal(keyCalls, 2); assert.equal(segmentCalls, 1);
    assert.deepEqual(h.writes, [[1]]); assert.deepEqual(h.finishes, ['ok']);
  });
  await check('进度卡暂停、继续、重试入口与限制说明随状态更新，结束后清理', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      dom.window.eval(read('src/replay/replay-ui.js'));
      const ui = dom.window.__DYC_REPLAY_UI__;
      ui.mount(); ui.showProgress('test.mp4', { xhs: true });
      const root = dom.window.document.querySelector('#dyc-replay-host').shadowRoot;
      const button = root.querySelector('[data-act="pause"]');
      const toggle = root.querySelector('.pc-body [role="switch"]');
      assert.equal(toggle.checked, false);
      assert.equal(root.querySelector('.pc-limit').hidden, false);
      dom.window.innerWidth = 320;
      const card = root.querySelector('.pc');
      const hostRect = { left: 108, right: 226, top: 158, bottom: 190 };
      ui.placePop(card, 344, hostRect);
      const cardLeft = hostRect.left + parseFloat(card.style.left);
      assert.ok(cardLeft >= 0 && cardLeft + parseFloat(card.style.maxWidth) <= dom.window.innerWidth,
        '窄窗的进度卡和自动重试开关必须完整留在视口内');
      let enabled = false;
      ui.setAutoRetryHandler(on => { enabled = on; });
      toggle.click();
      assert.equal(enabled, true);
      let clicks = 0; ui.setPauseHandler(() => { clicks++; });
      for (const mode of ['', 'paused', 'offline', 'retry']) {
        ui.setProgress(0.4, { mode, recoverable: true, reason: 'HTTP 403' });
        assert.equal(button.hidden, false); button.click();
        assert.equal(root.querySelector('.pc-hint').hidden, false);
      }
      assert.equal(clicks, 4);
      ui.setProgress(0.4, { mode: '', recoverable: false }); assert.equal(button.hidden, true);
      ui.finishProgress('ok', 'done'); assert.equal(root.querySelector('[data-act="pause"]'), null);
      assert.equal(root.querySelector('.pc-hint').hidden, true);
      assert.equal(root.querySelector('.pc-retry').hidden, true);
      ui.showProgress('douyin.mp4');
      assert.equal(root.querySelectorAll('.pc').length, 1);
      assert.equal(root.querySelector('.pc-body [role="switch"]').checked, false);
      assert.equal(root.querySelector('.pc-limit').hidden, true);
      ui.unmount();
    } finally { dom.window.close(); }
  });
  console.log('回放下载调度：' + checks + ' 组场景通过');
})().catch(e => { console.error(e); process.exitCode = 1; });

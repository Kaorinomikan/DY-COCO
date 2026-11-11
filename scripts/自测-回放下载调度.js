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
    dycReadFlags: () => new Promise(() => {}), dycWatchFlags() {},
    __DYC_REPLAY_DEBUG__: true, __DYC_REPLAY_META__: {},
    __DYC_REPLAY_UI__: {
      setAbortHandler(fn) { ctx.cancel = fn; }, setBtn() {}, showProgress() {},
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
  return { ctx, advance, finish, frames, writes, finishes, timers, handle };
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
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    try {
      const w = dom.window;
      w.eval(read('src/replay/replay-ui.js'));
      const ui = w.__DYC_REPLAY_UI__;
      ui.mount();
      const root = w.document.querySelector('#dyc-replay-host').shadowRoot;
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
    await h.advance(9000);
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
  await check('鉴权失败不无效重试，整场失败停止其余请求和刷新', async () => {
    let failed = 0, hangingSignal;
    const h = harness((url, o, t) => {
      if (url === '0') { failed++; return Promise.resolve({ ok: false, status: 403 }); }
      if (url !== 'init') { hangingSignal = o.signal; return t.delay(null, 60000, o.signal); }
      return Promise.resolve(response([[255]], 1, o.signal, t.delay));
    });
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
    await h.advance(100); h.ctx.cancel(); await h.finish(p);
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
  console.log('回放下载调度：' + checks + ' 组场景通过');
})().catch(e => { console.error(e); process.exitCode = 1; });

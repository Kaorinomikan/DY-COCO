/**
 * 直播回放下载 · 落盘与转封装
 * ============================================================
 * 【一句话】把「一串分片」变成一个能双击播放的 MP4 文件，全程只碰磁盘一次。
 *
 * 【三条硬约束，改之前先读】
 *   1. **绝不攒 Blob。**  1 小时 1080p 约 1~2 GB，`new Blob([...])` 累积到
 *      几百 MB 就会把标签页搞崩（这不是优化项，是可用性底线）。
 *      所以 `showSaveFilePicker` 拿到句柄后就用 `createWritable()` 边下边写，
 *      内存峰值只压着「在飞的 3 个分片」。
 *   2. **写入必须串行。**  `FileSystemWritableFileStream.write()` 返回 Promise，
 *      并发调用不保证顺序。视频字节顺序错了 = 文件报废，
 *      所以这里用一个 promise 链把写入串起来。
 *   3. **TS 必须转封装，不能直接拼。**  直接把 .ts 首尾相接得到的是一个
 *      「连续 TS 流」——VLC 能放，但 Windows 双击、剪映、PR 都打不开，
 *      用户拿到的就是个「看似能播其实没人认」的文件。
 *      用 mux.js 把 TS 重新封装成 fMP4（**只换外壳，不重新编码，画质零损失**），
 *      输出就是标准 MP4。
 *
 * 【本文件只做「写」，不做「取」】
 *   并发取片与顺序控制放在 replay-download.js（那一层才知道进度、速度、取消）。
 *   这里暴露两个「流」对象，各自接收按序到达的分片字节：
 *     createMp4Stream(sink)   fMP4 / 直链 MP4 → 原始字节直通
 *     createTsStream(sink)    TS 分片 → 过 mux.js 转成 fMP4 再写
 *   两者接口一致：write(uint8) / init(uint8) / end()
 *
 * 【为什么 TS 只用一个 Transmuxer 实例、且每片都 flush】
 *   实测（`.tmp/probe-tsmp4.js`）：同一个实例连续 push，mux.js 自己会把
 *   decode time 往后推，tfdt 正常递增；若每片新建实例再手工 setBaseMediaDecodeTime，
 *   时间戳要自己算 90kHz 偏移，错一帧就音画不同步。
 *   每片 flush 是因为每个 TS 分片自成一个可解析单元，不清空缓冲会攒到片尾才吐数据，
 *   进度条就会一跳一大段。
 */
(function () {
  'use strict';

  if (window.__DYC_REPLAY_WRITER__) return;

  /* ==========================================================
   * 一、串行写入器
   * ========================================================== */

  /**
   * @param {FileSystemWritableFileStream} writable
   */
  function SerialSink(writable) {
    this.w = writable;
    this.chain = Promise.resolve();
    this.bytes = 0;      // 已交给 write 的累计字节（含仍在队列里的）
    this.closed = false;
  }

  SerialSink.prototype.write = function (chunk) {
    if (this.closed) return Promise.reject(new Error('写入器已关闭'));
    var buf = (chunk instanceof Uint8Array) ? chunk : new Uint8Array(chunk);
    if (!buf.byteLength) return this.chain;
    this.bytes += buf.byteLength;
    var self = this;
    this.chain = this.chain.then(function () {
      return self.w.write(buf);
    });
    return this.chain;
  };

  /** 等队列排空后关闭；resolve 写入总字节数 */
  SerialSink.prototype.close = function () {
    var self = this;
    return this.chain.then(function () {
      if (self.closed) return self.bytes;
      self.closed = true;
      return self.w.close().then(function () { return self.bytes; });
    });
  };

  /** 中止：丢弃未落盘内容（已写的字节不删，交给用户决定） */
  SerialSink.prototype.abort = function () {
    var self = this;
    this.closed = true;
    return this.chain.catch(function () {}).then(function () {
      try { return self.w.abort(); } catch (e) { return null; }
    });
  };

  /* ==========================================================
   * 二、选保存位置
   *
   * 优先 showSaveFilePicker（一步到位、文件名预填）；
   * 老内核没有它时退 showDirectoryPicker（工程里已验证可用），
   * 在用户选的目录里建文件。两个都没有 → 明确抛错，不做假成功。
   * ========================================================== */

  /**
   * @param {string} baseName 预填文件名（不含扩展名）
   * @param {string} [ext] 扩展名，默认 `.mp4`
   *   H.265 的 TS 分片没法过 mux.js（它只认 H.264），只能原样拼成 `.ts` ——
   *   所以扩展名必须跟着实际容器走，不能一律写 `.mp4`（那是骗人，播放器一放就废）。
   * @returns {Promise<{handle, how:'file'|'dir', name:string}>}
   */
  function pickTarget(baseName, ext) {
    var e = ext || '.mp4';
    var fileName = baseName + e;
    var isTs = /\.ts$/i.test(e);

    if (typeof window.showSaveFilePicker === 'function') {
      return window.showSaveFilePicker({
        suggestedName: fileName,
        types: isTs
          ? [{ description: 'MPEG-TS 视频', accept: { 'video/mp2t': ['.ts'] } }]
          : [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }]
      }).then(function (h) {
        return { handle: h, how: 'file', name: (h && h.name) || fileName };
      });
    }

    if (typeof window.showDirectoryPicker === 'function') {
      return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dir) {
        return dir.getFileHandle(fileName, { create: true }).then(function (fh) {
          return { handle: fh, how: 'dir', name: fileName };
        });
      });
    }

    return Promise.reject(new Error(
      '当前浏览器内核不支持「选择保存位置」（showSaveFilePicker / showDirectoryPicker 都没有）。' +
      '请换 Chrome / Edge / 新版 360 极速浏览器使用本功能。'
    ));
  }

  function openSink(handle) {
    return handle.createWritable({ keepExistingData: false }).then(function (w) {
      return new SerialSink(w);
    });
  }

  /**
   * 删除半成品文件（2026-10-21 用户定「口径 C」：凡没下完的一律删）。
   *
   * 【能力检测，不猜内核】`FileSystemFileHandle.remove()` 要 Chromium 110+，
   *   本机 360 极速 X 是老内核，有没有这个方法只能运行时问。没有 → 返回
   *   resolve(false)，调用方把文案降级成「半成品已保留」，绝不能抛错——
   *   删不掉是次要事，别让它把「下载取消/失败」这条主消息顶掉。
   *
   * 【谁有权删】只删「本次新建」的文件（调用方先用 getFile().size 记下
   *   下载前的体积，preSize=0 才放行）。覆盖已有文件保存的场景**一律不删**：
   *   用户选了个已有文件当保存目标，删半成品等于把他原来的文件也端了。
   */
  function removeFile(handle) {
    if (!handle || typeof handle.remove !== 'function') {
      return Promise.resolve(false);   // 老内核：没有 remove，降级保留
    }
    try {
      return handle.remove().then(function () { return true; }, function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* ==========================================================
   * 三、两种「流」
   * ========================================================== */

  /**
   * fMP4 / 直链 MP4：原始字节直通，零转码。
   *
   * 也用于 **H.265 的 TS 分片**：mux.js 只认 H.264，碰到 HEVC 会把视频轨整条丢掉，
   * 与其给用户一个「只有声音的 mp4」，不如按顺序原样拼成 `.ts`（画质零损失，
   * PotPlayer / VLC / 剪映都能播）。所以这个流对象不关心容器，只管顺序写。
   *
   * @param {SerialSink} sink
   */
  function createMp4Stream(sink) {
    return {
      kind: 'mp4',
      /** 写初始化段（fMP4 才有；直链 MP4 传 null 即忽略） */
      init: function (buf) {
        return buf ? sink.write(buf) : Promise.resolve();
      },
      write: function (buf) {
        return sink.write(buf);
      },
      end: function () {
        return Promise.resolve(sink.bytes);
      }
    };
  }

  /**
   * TS 分片 → fMP4 再写。需要 window.muxjs（vendor/mux.min.js 提供）。
   * @param {SerialSink} sink
   */
  function createTsStream(sink) {
    var muxjs = window.muxjs;
    if (!muxjs || !muxjs.mp4 || !muxjs.mp4.Transmuxer) {
      throw new Error('转封装组件未加载（vendor/mux.min.js 缺失），无法把 TS 分片合成 MP4');
    }

    var tm = new muxjs.mp4.Transmuxer();
    var pending = Promise.resolve();
    var initDone = false;
    var fatal = null;

    // data 事件是同步派发的；回调里只往写入队列里排，不做 await
    tm.on('data', function (seg) {
      if (!initDone && seg.initSegment && seg.initSegment.byteLength) {
        initDone = true;
        pending = pending.then(function () { return sink.write(seg.initSegment); });
      }
      if (seg.data && seg.data.byteLength) {
        pending = pending.then(function () { return sink.write(seg.data); });
      }
    });
    tm.on('error', function (e) { fatal = e || new Error('转封装失败'); });

    return {
      kind: 'ts',
      init: function () { return Promise.resolve(); },   // TS 的 init 由 mux.js 自己生成
      write: function (buf) {
        if (fatal) return Promise.reject(fatal);
        tm.push(buf);
        tm.flush();
        // 返回「本片产生的字节都写完了」的 promise，调用方据此推进度
        return pending.then(function () {
          if (fatal) throw fatal;
        });
      },
      end: function () {
        var self = this;
        return pending.then(function () { return sink.bytes; });
      }
    };
  }

  window.__DYC_REPLAY_WRITER__ = {
    SerialSink: SerialSink,
    pickTarget: pickTarget,
    openSink: openSink,
    removeFile: removeFile,
    createMp4Stream: createMp4Stream,
    createTsStream: createTsStream
  };
})();

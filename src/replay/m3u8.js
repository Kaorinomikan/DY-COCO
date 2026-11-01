/**
 * 直播回放下载 · HLS 清单解析
 * ============================================================
 * 【职责】把 m3u8 文本解析成「可以用来的下载的东西」：
 *   · master 清单 → 各清晰度档位（含码率、分辨率、子清单地址）
 *   · media 清单  → 分片表（每片地址 + 时长）、总时长、加密方式、init 段
 *
 * 【为什么自己写解析而不引库】
 *   只需要 HLS 的一小部分标签，引入 hls.js（数百 KB）不划算；而分片表解析
 *   的复杂度主要在于**相对地址拼接**与**字节范围**两处，这两处必须自己
 *   按规范写清，引库也省不掉验证成本。
 *
 * 【支持的标签】（够用即可，遇到不认识的标签一律忽略 —— HLS 规范就是这么设计的）
 *   #EXT-X-STREAM-INF   档位声明（BANDWIDTH / RESOLUTION），下一行是子清单
 *   #EXTINF             下一分片时长
 *   #EXT-X-BYTERANGE    下一分片只用文件的一段字节（n@o）
 *   #EXT-X-MAP          初始化段（fMP4 才有：URI 指向 init.mp4）
 *   #EXT-X-KEY          加密方式与密钥地址（METHOD=NONE 表示不加密）
 *   #EXT-X-MEDIA-SEQUENCE 首个分片的序号（用于日志对账）
 *   #EXT-X-PLAYLIST-TYPE VOD / EVENT
 *   #EXT-X-ENDLIST      清单已完整（点播的判据）
 *
 * 【已知不做】
 *   · SAMPLE-AES / 国密之类非常规加密：识别出来但明确返回「不支持」，
 *     绝不半解密出一堆坏数据 —— 宁可如实报错。
 *   · DASH（mpd）：只识别、不解析，走「不支持」分支并说明原因。
 */
(function () {
  'use strict';

  if (window.__DYC_M3U8__) return;

  /** 把清单里的相对地址按清单自身地址补全（协议相对 // 与绝对路径都要认） */
  function absUrl(base, ref) {
    try { return new URL(ref, base).href; } catch (e) { return ref; }
  }

  /** 解析属性列表：KEY=VALUE,KEY="VALUE,带逗号" —— 引号内的逗号不算分隔 */
  function parseAttrs(s) {
    var out = {};
    var re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    var m;
    while ((m = re.exec(s))) {
      var v = m[2];
      if (v.charAt(0) === '"') v = v.slice(1, -1);
      out[m[1]] = v;
    }
    return out;
  }

  function lines(text) {
    return String(text || '').split(/\r?\n/);
  }

  /** 是不是 master 清单：出现 #EXT-X-STREAM-INF 即是 */
  function isMaster(text) {
    return /#EXT-X-STREAM-INF/.test(text || '');
  }

  /**
   * 解析 master 清单 → 档位列表，按码率降序。
   * @returns {Array<{url,bandwidth,width,height,codecs,audio,video}>}
   */
  function parseMaster(text, baseUrl) {
    var out = [];
    var L = lines(text);
    for (var i = 0; i < L.length; i++) {
      var ln = L[i].trim();
      if (ln.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
      var a = parseAttrs(ln.slice(ln.indexOf(':') + 1));
      // 紧跟着的第一条非注释行才是子清单地址
      var url = '';
      for (var j = i + 1; j < L.length; j++) {
        var nx = L[j].trim();
        if (!nx) continue;
        if (nx.charAt(0) === '#') continue;
        url = absUrl(baseUrl, nx);
        break;
      }
      if (!url) continue;
      var res = (a.RESOLUTION || '').split('x');
      out.push({
        url: url,
        bandwidth: parseInt(a.BANDWIDTH || '0', 10) || 0,
        width: parseInt(res[0] || '0', 10) || 0,
        height: parseInt(res[1] || '0', 10) || 0,
        codecs: a.CODECS || '',
        audio: a.AUDIO || '',
        // 有视频编码才算「带画面的档位」：CODECS 只写 mp4a.* 的是**纯音频档**
        // （用户 2026-10-18 下到没画面的文件，就是这类档位/清单被当成主候选了）
        video: isVideoCodec(a.CODECS)
      });
    }
    out.sort(function (x, y) { return y.bandwidth - x.bandwidth; });
    return out;
  }

  /** CODECS 里有没有视频编码（H.264 / H.265 / AV1 / VP9 / MPEG-4） */
  var VIDEO_CODEC_RE = /avc1|avc3|hvc1|hev1|dvhe|dvh1|av01|vp09|mp4v/i;

  function isVideoCodec(codecs) {
    return VIDEO_CODEC_RE.test(String(codecs || ''));
  }

  /** 是不是 H.264（唯一能过 mux.js 转封装的编码，选档时同分辨率用它取胜） */
  function isAvcCodec(codecs) {
    return /avc1|avc3/i.test(String(codecs || ''));
  }

  /**
   * 解析 media 清单 → 分片表。
   * @returns {{
   *   segments: Array<{url, duration, byterange, seq}>,
   *   total: number,          总时长（秒）
   *   map: ?{url, byterange}, 初始化段
   *   key: ?{method, url, iv, format},
   *   vod: boolean,           有 ENDLIST = 清单已完整
   *   targetDuration: number,
   *   firstSeq: number,
   *   unsupported: string      非空表示这份清单解密方式不支持
   * }}
   */
  function parseMedia(text, baseUrl) {
    var L = lines(text);
    var segs = [];
    var map = null;
    var key = null;
    var target = 0;
    var firstSeq = 0;
    var vod = false;
    var unsupported = '';
    var pendingDur = null;
    var pendingRange = null;
    var seq = 0;
    var seqInited = false;

    for (var i = 0; i < L.length; i++) {
      var ln = L[i].trim();
      if (!ln) continue;

      if (ln.indexOf('#EXT-X-TARGETDURATION:') === 0) {
        target = parseFloat(ln.slice(ln.indexOf(':') + 1)) || 0;
        continue;
      }
      if (ln.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
        firstSeq = parseInt(ln.slice(ln.indexOf(':') + 1), 10) || 0;
        if (!seqInited) { seq = firstSeq; seqInited = true; }
        continue;
      }
      if (ln.indexOf('#EXT-X-ENDLIST') === 0) { vod = true; continue; }

      if (ln.indexOf('#EXTINF:') === 0) {
        // #EXTINF:9.97667,  或  #EXTINF:9.97667,标题
        var body = ln.slice(ln.indexOf(':') + 1);
        var comma = body.indexOf(',');
        var d = parseFloat(comma >= 0 ? body.slice(0, comma) : body);
        pendingDur = isFinite(d) ? d : 0;
        continue;
      }
      if (ln.indexOf('#EXT-X-BYTERANGE:') === 0) {
        pendingRange = ln.slice(ln.indexOf(':') + 1).trim();
        continue;
      }
      if (ln.indexOf('#EXT-X-MAP:') === 0) {
        var ma = parseAttrs(ln.slice(ln.indexOf(':') + 1));
        if (ma.URI) {
          map = {
            url: absUrl(baseUrl, ma.URI),
            byterange: ma.BYTERANGE || ''
          };
        }
        continue;
      }
      if (ln.indexOf('#EXT-X-KEY:') === 0) {
        var ka = parseAttrs(ln.slice(ln.indexOf(':') + 1));
        var method = (ka.METHOD || '').toUpperCase();
        if (method === 'NONE') {
          key = null;
        } else if (method === 'AES-128') {
          key = {
            method: 'AES-128',
            url: ka.URI ? absUrl(baseUrl, ka.URI) : '',
            iv: ka.IV || '',
            format: ka.KEYFORMAT || 'identity'
          };
        } else {
          // 非常规加密：如实标记，不猜、不半解密
          unsupported = '加密方式 ' + method + ' 暂不支持（仅支持 AES-128 与不加密）';
          key = { method: method, url: ka.URI || '', iv: ka.IV || '', format: ka.KEYFORMAT || '' };
        }
        continue;
      }
      if (ln.charAt(0) === '#') continue;   // 其余标签一律忽略（规范如此）

      // 到这里是非注释行 = 一条分片地址
      if (!seqInited) { seq = firstSeq; seqInited = true; }
      segs.push({
        url: absUrl(baseUrl, ln),
        duration: pendingDur === null ? 0 : pendingDur,
        byterange: pendingRange || '',
        seq: seq++
      });
      pendingDur = null;
      pendingRange = null;
    }

    var total = 0;
    for (var k = 0; k < segs.length; k++) total += segs[k].duration;

    return {
      segments: segs,
      total: total,
      map: map,
      key: key,
      vod: vod,
      targetDuration: target,
      firstSeq: firstSeq,
      unsupported: unsupported
    };
  }

  /** 抓取并解析（自动判 master / media），最多跟两层子清单 */
  function load(net, url, depth) {
    depth = depth || 0;
    return net.fetchText(url).then(function (text) {
      if (isMaster(text)) {
        var variants = parseMaster(text, url);
        if (!variants.length) {
          return { kind: 'empty', url: url, text: text };
        }
        if (depth >= 2) {
          return { kind: 'master', url: url, variants: variants };
        }
        /* 选哪一档 —— 分辨率优先、同分辨率才看编码，别改回「无脑取最高码率」：
         *   ① **先比分辨率（height）**：用户 2026-10-18 明确「我要最高清的」。
         *      1080p 的 H.265 比 720p 的 H.264 清楚，没理由为了省事降到 720p。
         *   ② 分辨率相同时**优先 H.264**：mux.js 只认 H.264，而抖音的 HEVC 档码率
         *      只有 H.264 的一半左右 —— 若按「最高码率」选，常会取到 HEVC 档，
         *      旧版转封装时会把视频轨整条丢掉，用户拿到**只有声音的几百兆文件**
         *      （2026-10-18 实测事故）。同分辨率下 H.264 表更大、也正好是用户要的「好几 G」。
         *   ③ 同分辨率同编码（多个码率档）→ 取码率最高的。
         *   ④ 没有视频档（纯音频清单）→ 退回第一档，由上层判「没画面」。
         *   非 H.264 的档由上层按容器分流：TS 原样拼成 .ts，fMP4 直通。 */
        var pick = null;
        var k;
        for (k = 0; k < variants.length; k++) {
          var cand = variants[k];
          if (!cand.video) continue;
          if (!pick) { pick = cand; continue; }
          var ch = cand.height || 0;
          var ph = pick.height || 0;
          if (ch !== ph) { if (ch > ph) pick = cand; continue; }
          var cAvc = isAvcCodec(cand.codecs);
          var pAvc = isAvcCodec(pick.codecs);
          if (cAvc !== pAvc) { if (cAvc) pick = cand; continue; }
          if ((cand.bandwidth || 0) > (pick.bandwidth || 0)) pick = cand;
        }
        if (!pick) pick = variants[0];
        return load(net, pick.url, depth + 1).then(function (r) {
          r.variants = variants;
          r.picked = pick.url;
          return r;
        });
      }
      var media = parseMedia(text, url);
      media.kind = 'media';
      media.url = url;
      media.textLength = text.length;
      return media;
    });
  }

  window.__DYC_M3U8__ = {
    absUrl: absUrl,
    parseAttrs: parseAttrs,
    isMaster: isMaster,
    isVideoCodec: isVideoCodec,
    isAvcCodec: isAvcCodec,
    parseMaster: parseMaster,
    parseMedia: parseMedia,
    load: load
  };
})();

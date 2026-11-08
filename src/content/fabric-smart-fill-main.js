/**
 * 面料材质「智能填写」· MAIN 世界桥 (2026-11-08,与 fabric-smart-fill.js 配套)
 * ============================================================
 * 【为什么必须有这个文件】内容脚本跑在隔离世界(isolated world),DOM 共享但
 *   JS 属性不共享 —— 页面 React 挂在节点上的 __reactFiber$/__reactProps$
 *   在内容脚本里**读不到**(jsdom 自测没有世界隔离所以全绿,真机永远
 *   「没找到组件数据通道」,15:04/15:17 两轮诊断都卡在这)。
 *   本文件以 world: MAIN 注入,在页面世界里找通道、构造数据、提交。
 *
 * 【平台真实数据结构】2026-11-08 15:18 抓包 /product/tproduct/getBadWordHint
 *   请求体 values_map(已从响应侧证实):
 *     [{"measure_info":{"template_id":873,"values":[
 *         {"module_id":1854,"prefix":"","suffix":"","value":""}]},
 *       "value_id":"","value_name":"聚醋纤维"}]
 *   · 材料名 = value_name(不是 name/label);
 *   · 配比 = measure_info.values[0].value(不是 percent/ratio);
 *   · value_id 为空串 = 自定义/新建材料 —— 平台自己就这么存,所以
 *     「未知材料自定义值直接提交」有官方先例,不是我们瞎猜。
 *   · 表单里这一项可能是 JSON 字符串(values_map 的值就是字符串),
 *     也可能是数组 —— 提交时按 value 原本的形态回传(onChange 镜像类型)。
 *
 * 【协议】
 *   · 就绪标记:documentElement 上打 data-dyc-fabric-bridge="1"(属性跨世界可见);
 *   · 内容脚本把目标控件标上 data-dyc-fabric-target="1",再
 *     window.postMessage({__dycFabric:1, rid, items:[{name,pct}]});
 *   · 本文件回 window.postMessage({__dycFabricResult:1, rid, result})。
 *   · result: {ok:true, kind:'array'|'string', count} 或 {ok:false, why}
 * ============================================================
 */
(function () {
  'use strict';
  if (window.__DYC_FABRIC_BRIDGE__) return;

  var NAME_KEYS = ['value_name', 'name', 'materialName', 'material', 'label', 'compositionName', 'fabricName', 'title'];
  var PCT_KEYS = ['percent', 'percentage', 'ratio', 'proportion', 'content', 'pct', 'composition', 'fabricPercent', 'rate', 'value'];

  function reactKey(el, prefix) {
    if (!el) return '';
    var keys = [];
    try { keys = Object.getOwnPropertyNames(el); } catch (e) { keys = []; }
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(prefix) === 0) return keys[i];
    }
    return '';
  }

  /** value 可能是数组 / JSON 字符串 / 空 —— 三种都认 */
  function parseValueProp(v) {
    if (Array.isArray(v)) return { kind: 'array', arr: v };
    if (v == null) return { kind: 'empty', arr: [] };
    if (typeof v === 'string') {
      try {
        var a = JSON.parse(v);
        if (Array.isArray(a)) return { kind: 'string', arr: a };
      } catch (e) { /* 不是 JSON 串 */ }
    }
    return { kind: 'other', arr: [] };
  }

  function channelOk(p) {
    if (!p || typeof p.onChange !== 'function') return false;
    var kind = parseValueProp(p.value).kind;
    if (kind === 'array' || kind === 'string') return true;
    return kind === 'empty' && Array.isArray(p.options) && p.options.length > 0;
  }

  /** 从控件本体和它的输入框沿 fiber 向上找复合组件 */
  function findChannel(root) {
    var nodes = [root];
    try {
      var ins = root.querySelectorAll('input');
      for (var i = 0; i < ins.length; i++) nodes.push(ins[i]);
    } catch (e) { /* 没有输入框不影响本体 */ }

    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      var propsKey = reactKey(node, '__reactProps$');
      if (propsKey && channelOk(node[propsKey])) return { props: node[propsKey] };
      var fiberKey = reactKey(node, '__reactFiber$');
      var fiber = fiberKey ? node[fiberKey] : null;
      var guard = 0;
      while (fiber && guard++ < 40) {
        var props = fiber.memoizedProps || fiber.pendingProps;
        if (channelOk(props)) return { props: props };
        fiber = fiber.return;
      }
    }
    return null;
  }

  function nameKeyOf(rec) {
    if (!rec || typeof rec !== 'object') return '';
    for (var i = 0; i < NAME_KEYS.length; i++) {
      var k = NAME_KEYS[i];
      if (typeof rec[k] === 'string' && rec[k].trim()) return k;
    }
    return '';
  }

  function findBy(list, nameKey, name) {
    var want = String(name).trim();
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (rec && typeof rec === 'object' && String(rec[nameKey]).trim() === want
        && !(nameKey === 'label' && typeof rec.value === 'string' && rec.value !== want)) return rec;
    }
    return null;
  }

  function isAuroraRow(row) {
    return row && typeof row.label === 'string' && typeof row.value === 'string'
      && ('extra' in row || 'templateId' in row);
  }

  /** 深拷贝到第二层:measure_info.values[] 必须各有一份,否则两条材料
   *  共享同一个 measure_info,写配比时互相污染(棉 80 会被下一项覆盖成 20)。 */
  function clone(rec) {
    var out = {};
    for (var k in rec) {
      if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
      var v = rec[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        var c = {};
        for (var k2 in v) {
          if (!Object.prototype.hasOwnProperty.call(v, k2)) continue;
          var v2 = v[k2];
          if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) {
            var c2 = {};
            for (var k3 in v2) {
              if (Object.prototype.hasOwnProperty.call(v2, k3)) c2[k3] = v2[k3];
            }
            c[k2] = c2;
          } else if (Array.isArray(v2)) {
            c[k2] = v2.map(function (x) {
              if (x && typeof x === 'object') {
                var cx = {};
                for (var k4 in x) {
                  if (Object.prototype.hasOwnProperty.call(x, k4)) cx[k4] = x[k4];
                }
                return cx;
              }
              return x;
            });
          } else {
            c[k2] = v2;
          }
        }
        out[k] = c;
      } else if (Array.isArray(v)) {
        out[k] = v.map(function (x) {
          if (x && typeof x === 'object') {
            var cx = {};
            for (var k5 in x) {
              if (Object.prototype.hasOwnProperty.call(x, k5)) cx[k5] = x[k5];
            }
            return cx;
          }
          return x;
        });
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** 把配比写进一条记录:优先平铺字段,再走 measure_info.values[0].value(抓包真实形态) */
  function setPct(rec, pct) {
    for (var i = 0; i < PCT_KEYS.length; i++) {
      var k = PCT_KEYS[i];
      var v = rec[k];
      if ((typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100) {
        rec[k] = typeof v === 'string' ? String(pct) : pct;
        return true;
      }
    }
    var mi = rec.measure_info;
    if (mi && mi.values && mi.values.length && mi.values[0] && typeof mi.values[0] === 'object') {
      var v0 = mi.values[0];
      v0.value = typeof v0.value === 'string' ? String(pct) : pct;
      return true;
    }
    return false;
  }

  /** 未知材料:按平台真实形态给一条自定义记录。value_id 置空串 ——
   *  抓包证实平台自己新建材料时 value_id 就是 ""。其余字段照模板拷贝
   *  (measure_info 的 template_id/module_id 是类目相关的,必须沿用)。 */
  function buildUnknownRow(sample, nameKey, name, pct) {
    var row = clone(sample);
    row[nameKey] = name;
    var ids = ['value_id', 'id', 'uid', 'key'];
    for (var i = 0; i < ids.length; i++) {
      if (Object.prototype.hasOwnProperty.call(row, ids[i])) {
        row[ids[i]] = '';
      }
    }
    setPct(row, pct);
    return row;
  }

  function buildNext(props, items, previous) {
    var parsed = parseValueProp(props.value);
    var current = parsed.arr;
    var options = [];
    var oKeys = ['options', 'dataSource', 'list'];
    for (var oi = 0; oi < oKeys.length; oi++) {
      if (Array.isArray(props[oKeys[oi]])) { options = props[oKeys[oi]]; break; }
    }

    var sample = null;
    var nameKey = '';
    var pools = [current, options, previous || []];
    for (var p = 0; p < pools.length && !sample; p++) {
      for (var i = 0; i < pools[p].length; i++) {
        var key = nameKeyOf(pools[p][i]);
        if (key) { sample = pools[p][i]; nameKey = key; break; }
      }
    }
    if (!sample) return null;

    // 真机 Aurora 的名称=value/label，含量=extra；不能只改 label 后沿用别的 value。
    var aurora = null;
    for (var ap = 0; ap < pools.length && !aurora; ap++) {
      for (var ai = 0; ai < pools[ap].length; ai++) {
        if (isAuroraRow(pools[ap][ai])) { aurora = pools[ap][ai]; break; }
      }
    }
    if (aurora) { sample = aurora; nameKey = 'label'; }

    var next = [];
    for (var j = 0; j < items.length; j++) {
      var src = findBy(current, nameKey, items[j].name) || findBy(options, nameKey, items[j].name)
        || findBy(previous || [], nameKey, items[j].name);
      var row;
      if (aurora) {
        row = src ? clone(src) : {};
        row.label = items[j].name;
        row.value = items[j].name;
        row.extra = items[j].pct;
        if (sample.templateId != null) row.templateId = sample.templateId;
      } else if (src) {
        row = clone(src);
        row[nameKey] = items[j].name;
        setPct(row, items[j].pct);
      } else {
        row = buildUnknownRow(sample, nameKey, items[j].name, items[j].pct);
      }
      next.push(row);
    }
    return { rows: next, kind: parsed.kind === 'string' ? 'string' : 'array', nameKey: nameKey };
  }

  // 清空会立即更新 React props；模板按控件保留，不能再从空 value 推导结构。
  var previousRows = new WeakMap();

  function inspect(root) {
    var ch = findChannel(root);
    if (!ch) return { ok: false };
    var rows = parseValueProp(ch.props.value).arr;
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var key = nameKeyOf(rows[i]);
      if (!key) return { ok: false };
      var name = isAuroraRow(rows[i]) ? rows[i].value : rows[i][key];
      items.push({ name: String(name).trim() });
    }
    return { ok: true, items: items };
  }

  function submit(root, items, prepareOnly) {
    var ch = findChannel(root);
    if (!ch) return { ok: false, why: '页面世界里也没找到组件数据通道' };
    var built;
    try {
      var current = parseValueProp(ch.props.value).arr;
      if (current.length) previousRows.set(root, current.map(clone));
      if (prepareOnly) return { ok: true };
      built = buildNext(ch.props, items, previousRows.get(root));
    }
    catch (e) { return { ok: false, why: '构造数据异常:' + ((e && e.message) || e) }; }
    if (!built) return { ok: false, why: '按平台结构还原不了(找不到材料记录样板)' };
    try {
      if (built.kind === 'string') ch.props.onChange(JSON.stringify(built.rows));
      else ch.props.onChange(built.rows);
    } catch (e) {
      return { ok: false, why: 'onChange 抛错:' + ((e && e.message) || e) };
    }
    return { ok: true, kind: built.kind, nameKey: built.nameKey, count: built.rows.length };
  }

  window.__DYC_FABRIC_BRIDGE__ = { version: 1, submit: submit };

  /* 就绪标记:属性跨世界可见,内容脚本靠它判断桥在不在 */
  try { document.documentElement.setAttribute('data-dyc-fabric-bridge', '1'); } catch (e) { /* 极早期 */ }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__dycFabric !== 1) return;
    var items = Array.isArray(d.items) ? d.items : [];
    var result;
    try {
      var root = document.querySelector('[data-dyc-fabric-target="1"]');
      result = d.inspectOnly === true ? inspect(root) : submit(root, items, d.prepareOnly === true);
    }
    catch (e) { result = { ok: false, why: '桥内异常:' + ((e && e.message) || e) }; }
    try {
      window.postMessage({ __dycFabricResult: 1, rid: d.rid, result: result }, '*');
    } catch (e) { /* 序列化失败就算了,内容脚本走超时兜底 */ }
  });
})();

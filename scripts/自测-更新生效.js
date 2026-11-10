'use strict';

/**
 * 更新生效链路自测（2026-11-05）
 *
 * 用户报的现象：「更新后第一次用扩展，设置会无法保存；重启浏览器之后会自动
 * 应用新更新；现在必须要按浏览器的刷新扩展，四个浏览器就要按四次。」
 *
 * 根因两条，本文件各锁一段：
 *   ① 更新页 500ms 就 window.close()，而它的 1200ms 兜底 reload 依赖页面还
 *      活着 —— 窗口一关这条兜底永远不执行，整条链只剩后台那个 setTimeout 独木桥；
 *   ② MV3 的 SW 脚本包按主脚本字节缓存，而旧发布闸门只盯 src/shared，
 *      漏掉了第二处 importScripts（content/flags.js）⇒ 构建号常年不动 ⇒
 *      「磁盘已新版、后台跑旧包」⇒ 新开关键被判非法，弹窗报「设置未保存」。
 *
 * 断言口径：只锁「行为与结构不能退回旧链路」，不绑死具体毫秒数、不绑文案。
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const updateSrc = fs.readFileSync(path.join(root, 'src/update/update.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'src/background/service-worker.js'), 'utf8');
const flagsSrc = fs.readFileSync(path.join(root, 'src/content/flags.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

/* ---------- 从源码里整段取出一个函数（沿用更新回退自测的做法） ---------- */
function extract(name, source) {
  source = source || updateSrc;
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = re.exec(source);
  if (!match) throw new Error('找不到函数 ' + name);
  return sliceBlock(source, match.index);
}

function sliceBlock(source, start) {
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('块边界不完整');
}

/** 取 `if (msg.type === 'xxx') { ... }` 这整块（SW 的消息分支是内联的） */
function messageBranch(type) {
  const marker = "msg.type === '" + type + "'";
  const at = swSrc.indexOf(marker);
  if (at < 0) throw new Error('SW 里找不到消息分支 ' + type);
  return sliceBlock(swSrc, at);
}

/* ---------- 断言框架 ---------- */
let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    console.log('  ✗ ' + name + ' — ' + (e && e.message || e));
  }
}
function assert(ok, msg) { if (!ok) throw new Error(msg); }

/* ---------- 更新页收尾：多兜底，且兜底不能被 close 掐断 ---------- */
function runFinishAndClose(opts) {
  opts = opts || {};
  const events = [];
  const timers = [];
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        events.push(['message', msg && msg.type]);
        if (opts.reply === 'error') {
          chrome.runtime.lastError = { message: 'Could not establish connection' };
          cb(undefined);
          chrome.runtime.lastError = null;
          return;
        }
        if (opts.reply) cb(opts.reply);
        // 不回调 = 后台没起来（通道不通）
      },
      reload() { events.push(['reload']); }
    }
  };
  const sandbox = {
    chrome,
    window: { close() { events.push(['close']); } },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    console
  };
  vm.createContext(sandbox);
  const code = extract('closeThenReload') + '\n' + extract('finishAndClose') + '\nfinishAndClose();';
  vm.runInContext(code, sandbox, { filename: 'update-finish.js' });
  return { events, timers };
}

(async () => {
  await test('后台没有回执时，本页 1.2 秒后自己完成重载', async () => {
    const { events, timers } = runFinishAndClose({ reply: null });
    assert(timers.length >= 1, '应至少挂一条延时兜底');
    timers[0].fn();
    const kinds = events.map((e) => e[0]);
    assert(kinds.includes('close'), '兜底要先关窗，避免僵尸页；实际=' + kinds.join(','));
    assert(kinds.includes('reload'), '兜底必须真的重载扩展；实际=' + kinds.join(','));
  });

  await test('回执带 armed 时，1.2 秒那条不抢着重载', async () => {
    const { events, timers } = runFinishAndClose({ reply: { ok: true, armed: true } });
    assert(timers.length >= 2, '应同时挂「无回执兜底」与「回执后兜底」');
    timers[0].fn();
    assert(!events.some((e) => e[0] === 'reload'), '后台已接管时本页不该抢跑重载');
  });

  await test('回执到了但页面还在，最后一条兜底仍会重载', async () => {
    const { events, timers } = runFinishAndClose({ reply: { ok: true, armed: true } });
    timers[timers.length - 1].fn();
    assert(events.some((e) => e[0] === 'reload'), '后台关窗与重载都失败时必须自己补上');
  });

  await test('通道报错按「没回执」处理，不吞掉兜底', async () => {
    const { events, timers } = runFinishAndClose({ reply: 'error' });
    timers[0].fn();
    assert(events.some((e) => e[0] === 'reload'), '通道异常时仍要完成重载');
  });

  await test('关窗与重载的先后顺序固定：先关窗、后重载', async () => {
    const events = [];
    const sandbox = {
      chrome: { runtime: { reload() { events.push('reload'); } } },
      window: { close() { events.push('close'); } },
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(extract('closeThenReload') + '\ncloseThenReload();', sandbox);
    assert(events.join('>') === 'close>reload', '顺序反了会留僵尸页；实际=' + events.join('>'));
  });

  /* ---------- 后台：重载挂在关窗回调上，不再延迟执行 ---------- */
  await test('后台收尾分支回执 armed，重载挂在关窗回调上', async () => {
    const block = messageBranch('dyc:update-finish');
    assert(/armed\s*:\s*true/.test(block), '回执必须带 armed，更新页据此判断后台是否接管');
    assert(/chrome\.windows\.remove/.test(block), '必须先关更新窗口，否则重载后留僵尸页');
    assert(/remove\([^)]*reloadNow\)/.test(block), '重载应作为关窗回调触发，而不是靠延时');
  });

  await test('后台收尾分支不再用 setTimeout 延迟重载', async () => {
    const block = messageBranch('dyc:update-finish');
    assert(!/setTimeout\s*\(/.test(block),
      '延迟执行会被内核判空闲掐掉，正是「必须手动刷新扩展」的来源');
  });

  /* ---------- 设置写入：旧后台不认识新键时不再硬拒 ---------- */
  function runWriteFlag(opts) {
    opts = opts || {};
    const data = Object.assign({}, opts.data || {});
    const chrome = {
      storage: {
        local: {
          set(obj) { Object.assign(data, obj); return Promise.resolve(); },
          get(key) {
            const out = {};
            const keys = Array.isArray(key) ? key : [key];
            keys.forEach((k) => { out[k] = data[k]; });
            return Promise.resolve(out);
          }
        }
      }
    };
    const sandbox = {
      chrome,
      dycFlagMeta: (k) => (k === 'debugFlag' ? { key: k, store: 'debug' } : null),
      DYC_FLAGS_STORE_KEY: 'dybFeatures',
      Promise, Object, console
    };
    vm.createContext(sandbox);
    // flagWriteQueue 是 SW 模块级的串行队列，抽函数时一并注入。
    vm.runInContext(
      extract('dycStorageCallP', flagsSrc) + '\nvar flagWriteQueue = Promise.resolve();\n'
      + extract('writeFeatureFlag', swSrc) + '\nthis.wf = writeFeatureFlag;', sandbox);
    return { data, wf: sandbox.wf };
  }

  await test('后台不认识的开关键仍能落库（旧缓存包场景）', async () => {
    const { data, wf } = runWriteFlag();
    await wf('brandNewFlag', true, 'features');
    assert(data.dybFeatures && data.dybFeatures.brandNewFlag === true,
      '新开关键不应因为后台是旧包而丢掉，实际=' + JSON.stringify(data));
  });

  await test('非布尔值仍然拒绝，校验没有被整体放开', async () => {
    const { wf } = runWriteFlag();
    let rejected = false;
    try { await wf('brandNewFlag', 'yes', 'features'); } catch (_) { rejected = true; }
    assert(rejected, '非法值必须仍被拒');
  });

  await test('调试开关按声明的 store 写 dybDebug', async () => {
    const { data, wf } = runWriteFlag();
    await wf('debugFlag', true);
    assert(data.dybDebug === true, '调试开关位置不变');
    assert(!data.dybFeatures, '调试开关不该写进功能开关表');
  });

  /* ---------- 弹窗侧把 store 一起发过去 ---------- */
  await test('弹窗写开关时随消息带 store', async () => {
    const sent = [];
    const chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) { sent.push(msg); cb({ ok: true }); }
      }
    };
    const sandbox = {
      chrome,
      dycFlagMeta: (k) => (k === 'debugFlag' ? { key: k, store: 'debug' } : { key: k, store: 'features' }),
      Promise, console
    };
    vm.createContext(sandbox);
    vm.runInContext(extract('dycWriteFlag', flagsSrc) + '\nthis.w = dycWriteFlag;', sandbox);
    await sandbox.w('someFlag', true);
    await sandbox.w('debugFlag', false);
    assert(sent[0] && sent[0].store === 'features', '功能开关应带 store=features');
    assert(sent[1] && sent[1].store === 'debug', '调试开关应带 store=debug');
  });

  /* ---------- 发布闸门：构建号必须每版变，依赖自动解析 ---------- */
  const py = process.env.PY || process.env.DYC_PY ||
    'C:/Users/79412/.workbuddy/binaries/python/versions/3.13.12/python.exe';

  await test('构建号闸门能跑通，并自动解析出全部 importScripts 依赖', async () => {
    if (!fs.existsSync(py)) return; // 没有解释器不阻断（真机环境一定在）
    const out = spawnSync(py, [path.join(root, 'scripts/check-sw-build.py')], {
      cwd: root, encoding: 'utf8'
    });
    const text = (out.stdout || '') + (out.stderr || '');
    assert(out.status === 0, '闸门自身应通过；输出=' + text.trim());
    assert(text.includes('src/content/flags.js'), '必须把 flags.js 当成依赖（旧闸门漏的就是它）');
    assert(text.includes('src/shared/gitee.js'), 'gitee.js 仍要在依赖里');
  });

  await test('构建号格式与 manifest 版本对得上', async () => {
    const m = /var\s+DYC_BUILD\s*=\s*'([^']+)'/.exec(swSrc);
    assert(m, 'SW 里必须有 DYC_BUILD 构建标记');
    const shape = /^(\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,3})\+sw(\d+)$/.exec(m[1]);
    assert(shape, '构建号格式必须是 <版本号>+swN，实际=' + m[1]);
    assert(shape[1] === manifest.version,
      '构建号版本段应与 manifest 一致（当前 ' + shape[1] + ' vs ' + manifest.version +
      '）；发布前跑 python scripts/check-sw-build.py --fix');
  });

  console.log('更新生效自测：' + pass + '/' + (pass + fail) + ' 通过');
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });

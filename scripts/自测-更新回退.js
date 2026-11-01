'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/update/update.js'), 'utf8');

function extract(name) {
  if (name === 'validateSnapshotReferences') {
    return src.slice(src.indexOf('function validateSnapshotReferences('), src.indexOf('\nfunction validateSnapshot(', src.indexOf('function validateSnapshotReferences(')));
  }
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = re.exec(src);
  if (!match) throw new Error('找不到函数 ' + name);
  const start = match.index;
  const brace = src.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
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
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('函数边界不完整：' + name);
}

const files = new Map();
const writes = [];
function dirHandle(base) {
  base = base || '';
  return {
    kind: 'directory', name: base.split('/').pop() || 'fake',
    async *entries() {
      const seen = new Set();
      const prefix = base ? base + '/' : '';
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const name = rest.split('/')[0];
        if (seen.has(name)) continue;
        seen.add(name);
        yield [name, rest.includes('/') ? dirHandle(prefix + name) : { kind: 'file' }];
      }
    },
    async getFileHandle(name) {
      const p = base ? base + '/' + name : name;
      return {
        getFile: async () => {
          if (ctx.readFailPath === p) throw new Error('模拟快照读取失败');
          const value = files.get(p);
          const bytes = Uint8Array.from(value);
          return { size: value.length, arrayBuffer: async () => bytes.buffer,
            text: async () => Buffer.from(bytes).toString('utf8') };
        },
        createWritable: async () => ({
          write: async bytes => {
            writes.push(p);
            if (ctx.failAt === p) {
              ctx.failRemaining--;
              if (ctx.failRemaining <= 0) ctx.failAt = '';
              throw new Error('模拟写入失败');
            }
            this.pending = bytes;
          },
          close: async () => { files.set(p, Array.from(this.pending)); }
        })
      };
    },
    async getDirectoryHandle(name) { return dirHandle(base ? base + '/' + name : name); },
    async removeEntry(name) {
      const p = base ? base + '/' + name : name;
      files.delete(p);
      for (const key of Array.from(files.keys())) if (key.startsWith(p + '/')) files.delete(key);
    }
  };
}

const required = ['manifest.json', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'];
const ctx = {
  console, Date, Uint8Array, TextDecoder, Map, Set, Array, String, Error, Promise,
  REQUIRED_SNAPSHOT_FILES: required,
  EXT_TOP_DIRS: ['icons/', 'src/'],
  diskVersion: '1', localVersion: '1', running: false, aborted: false,
  dirHandle: dirHandle(), permOk: true,
  pre: { done: true, files: [{ path: 'manifest.json', bytes: Uint8Array.from([1]) }, { path: 'src/a.js', bytes: Uint8Array.from([2]) }] },
  DYC_GITEE: {
    bytesToBase64: b => Buffer.from(b).toString('base64'),
    base64ToBytes: s => Uint8Array.from(Buffer.from(s, 'base64')),
    sha256Hex: async b => require('crypto').createHash('sha256').update(Buffer.from(b)).digest('hex')
  },
  DYC_BACKUP: {
    push: async s => {
      ctx.pushCalls = (ctx.pushCalls || 0) + 1;
      if (ctx.holdPush) await new Promise(resolve => { ctx.releasePush = resolve; });
      ctx.pushed = s;
    },
    list: async () => {
      ctx.historyCalls = (ctx.historyCalls || 0) + 1;
      if (ctx.rejectPersist) return [];
      if (!ctx.pushed) throw new Error('不得读取历史队列');
      return [JSON.parse(JSON.stringify(ctx.pushed))];
    }
  },
  errText: e => String(e && e.message || e), $: () => ({ textContent: '', hidden: false }),
  log: text => { ctx.logs = (ctx.logs || []).concat(String(text)); }, setProgress: () => {}, renderRunButtons: () => {}, paintBar: () => {},
  fmtSize: String, withRetry: async fn => {
    let last;
    for (let i = 0; i < 4; i++) { try { return await fn(); } catch (e) { last = e; } }
    throw last;
  }, writeFile: async (root, p, bytes, onWriteStart) => {
    if (onWriteStart) onWriteStart();
    writes.push(p);
    if (ctx.failAt === p) {
      ctx.failRemaining--;
      if (ctx.failRemaining <= 0) ctx.failAt = '';
      throw new Error('模拟写入失败');
    }
    files.set(p, Array.from(bytes));
  }, readManifest: async root => {
    const data = JSON.parse(Buffer.from(files.get('manifest.json')).toString('utf8'));
    return Object.assign({ manifest_version: 3, name: '可可助手' }, data);
  }, kvGet: async () => null,
  kvSet: async () => {}, finishSuccess: () => { ctx.finished = true; },
  finishAndClose: () => {},
  chrome: { runtime: { sendMessage: async () => {} } }
};
vm.createContext(ctx);
vm.runInContext([
  "function isExtFile(path){var p=String(path||'');return p==='manifest.json'||EXT_TOP_DIRS.some(function(d){return p.startsWith(d)})}",
  "function isSafeExtPath(path){var p=String(path||'');return isExtFile(p)&&!p.includes('\\\\')&&!p.startsWith('/')&&p.split('/').every(function(x){return x&&x!=='.'&&x!=='..'})}",
  extract('writeFile'), extract('listFiles'), extract('removeFile'), extract('snapshotDir'),
  extract('validateSnapshotReferences'), extract('validateSnapshot'), extract('pruneExtraFiles'), extract('restoreSnapshot'), extract('runWrite')
].join('\n'), ctx);
const restoreSnapshotImpl = ctx.restoreSnapshot;
ctx.restoreSnapshot = async snap => {
  ctx.restored = snap;
  return restoreSnapshotImpl(snap, '自测');
};

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.message); }
}
function assert(ok, msg) { if (!ok) throw new Error(msg); }

(async () => {
  for (const p of required) files.set(p, Array.from(Buffer.from(p === 'manifest.json' ? '{"version":"1"}' : 'x')));
  files.set('src/a.js', [1, 2]);
  await test('备份失败时零写入且不读历史回退队列', async () => {
    ctx.failAt = ''; ctx.readFailPath = 'manifest.json'; writes.length = 0; ctx.pushed = null;
    await ctx.runWrite();
    assert(writes.length === 0 && !ctx.restored, '快照阶段失败后不应写入或回退');
  });
  await test('备份队列保存失败不进入任何写盘', async () => {
    ctx.readFailPath = '';
    ctx.holdPush = false;
    ctx.rejectPersist = true;
    ctx.failAt = '';
    ctx.pushed = null;
    writes.length = 0;
    await ctx.runWrite();
    assert(writes.length === 0, '备份保存失败不得启动文件写入');
    ctx.rejectPersist = false;
    ctx.logs = [];
  });
  await test('完整快照后部分写入失败只回退本次快照', async () => {
    ctx.readFailPath = ''; ctx.failAt = 'src/a.js'; ctx.failRemaining = 4; writes.length = 0; ctx.restored = null; ctx.pushed = null;
    await ctx.runWrite();
    assert(ctx.pushed && ctx.restored === ctx.pushed, '必须用本次快照回退 pushed=' + !!ctx.pushed + ' restored=' + !!ctx.restored + ' writes=' + writes.join(',') + ' logs=' + (ctx.logs || []).slice(-4).join('|'));
    ctx.failAt = '';
  });
  await test('单文件与扩展总量超限均拒绝快照', async () => {
    files.set('src/large.js', new Array(4 * 1024 * 1024 + 1).fill(0));
    let rejected = false;
    try { await ctx.snapshotDir(ctx.dirHandle); } catch (_) { rejected = true; }
    assert(rejected, '超过 4MB 应失败');
    files.delete('src/large.js');

    files.set('src/a.js', new Array(3 * 1024 * 1024).fill(0));
    files.set('src/b.js', new Array(3 * 1024 * 1024).fill(0));
    rejected = false;
    try { await ctx.snapshotDir(ctx.dirHandle); } catch (_) { rejected = true; }
    assert(rejected, '总量超过 6MB 应失败');
    files.set('src/a.js', [1, 2]);
    files.delete('src/b.js');
  });
  await test('缺必需文件拒绝快照与回退校验', async () => {
    const saved = files.get('icons/icon48.png'); files.delete('icons/icon48.png');
    let rejected = false;
    try { await ctx.snapshotDir(ctx.dirHandle); } catch (_) { rejected = true; }
    assert(rejected, '快照缺图标应失败');
    rejected = false;
    try { ctx.validateSnapshot({ files: required.filter(p => p !== 'icons/icon48.png').map(path => ({ path, b64: 'eA==' })) }); }
    catch (_) { rejected = true; }
    assert(rejected, '恢复缺图标快照应失败');
    files.set('icons/icon48.png', saved);
  });
  await test('完整快照经过逐文件哈希且允许完整回退', async () => {
    const snap = await ctx.snapshotDir(ctx.dirHandle);
    assert(snap.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)), '每个文件都要有哈希');
    assert(ctx.validateSnapshot(snap).size === snap.files.length, '完整快照应通过校验');
  });
  await test('正确完整回退逐文件复原并清除多余扩展文件', async () => {
    ctx.failAt = '';
    const snap = await ctx.snapshotDir(ctx.dirHandle);
    files.set('src/a.js', [9, 9]);
    files.set('src/added.js', [8]);
    ctx.pruned = false;
    await ctx.restoreSnapshot(snap, '自测');
    assert(JSON.stringify(files.get('src/a.js')) === '[1,2]', '快照内容应逐文件复原');
    assert(!files.has('src/added.js'), '新版本新增扩展文件应清除；现存=' + Array.from(files.keys()).join(',') + '，日志=' + (ctx.logs || []).slice(-5).join('|'));
  });
  await test('旧格式完整备份可恢复但不删除额外文件', async () => {
    ctx.failAt = '';
    const old = await ctx.snapshotDir(ctx.dirHandle);
    delete old.format;
    delete old.paths;
    old.files.forEach(f => delete f.sha256);
    files.set('src/legacy-extra.js', [7]);
    ctx.pruned = false;
    await ctx.restoreSnapshot(old, '旧格式自测');
    assert(files.has('src/legacy-extra.js') && !ctx.pruned, '无哈希旧备份不可用于清理文件');
  });
  await test('旧快照漏掉清单引用脚本时写入前拒绝', async () => {
    const legacy = await ctx.snapshotDir(ctx.dirHandle);
    delete legacy.format; delete legacy.paths;
    const manifest = legacy.files.find(f => f.path === 'manifest.json');
    manifest.b64 = Buffer.from(JSON.stringify({ version: '1', content_scripts: [{ js: ['src/missing.js'] }] })).toString('base64');
    legacy.files.forEach(f => delete f.sha256);
    writes.length = 0;
    let rejected = false;
    try { await ctx.restoreSnapshot(legacy); } catch (_) { rejected = true; }
    assert(rejected && writes.length === 0, '缺入口脚本的旧备份不得写入或清理');
  });
  await test('快照声明文件全集但缺项时拒绝', async () => {
    const snapshot = await ctx.snapshotDir(ctx.dirHandle);
    snapshot.files = snapshot.files.filter(f => f.path !== 'src/a.js');
    let rejected = false;
    try { ctx.validateSnapshot(snapshot); } catch (_) { rejected = true; }
    assert(rejected, '文件全集与内容不一致必须失败');
  });
  await test('HTML与后台依赖缺失不得通过完整性验证', async () => {
    const base = await ctx.snapshotDir(ctx.dirHandle);
    delete base.format; delete base.paths;
    base.files.forEach(f => delete f.sha256);
    const manifest = base.files.find(f => f.path === 'manifest.json');
    manifest.b64 = Buffer.from(JSON.stringify({ version: '1', action: { default_popup: 'src/popup.html' } })).toString('base64');
    base.files.push({ path: 'src/popup.html', b64: Buffer.from('<script src="needed.js"></script>').toString('base64') });
    let rejected = false;
    try { ctx.validateSnapshot(base); } catch (_) { rejected = true; }
    assert(rejected, 'HTML引用的脚本也必须在备份中');
  });
  await test('当前真实工程运行资源引用可以完整验证', async () => {
    const runtime = ['manifest.json'];
    for (const top of ['src', 'icons']) {
      const walk = (dir) => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) walk(full);
          else runtime.push(path.relative(root, full).replace(/\\/g, '/'));
        }
      };
      walk(path.join(root, top));
    }
    const snapshot = { files: runtime.map(p => ({ path: p, b64: fs.readFileSync(path.join(root, p)).toString('base64') })) };
    assert(ctx.validateSnapshot(snapshot).size === runtime.length, '实际资源闭包完整');
  });
  console.log('更新回退自测：' + pass + '/' + (pass + fail) + ' 通过');
  if (fail) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });

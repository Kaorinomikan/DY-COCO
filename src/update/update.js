/**
 * 抖音可可助手 · 更新页
 *
 * 这是整个更新机制里**唯一真正改写磁盘**的地方。
 * 由弹窗的「安装更新 → 确认」打开（独立窗口，不是弹窗内执行）。
 *
 * ─────────────────────────────────────────────────────────
 * 为什么必须是独立窗口、不能用 popup：
 *   File System Access 的目录选择/授权会弹系统对话框并抢走焦点，
 *   popup 一失焦就被浏览器关闭，JS 上下文随之销毁，写入必然中断。
 *
 * 为什么能在“不装任何外部程序”的前提下完成更新：
 *   扩展本身没有文件系统 API，唯一的出口是 File System Access API——
 *   由本页面调用 showDirectoryPicker() 拿到扩展目录的句柄，直接写入文件，
 *   最后用 chrome.runtime.reload() 让扩展从磁盘重新加载。
 *   目录句柄存进 IndexedDB 复用；写入权限受浏览器安全模型约束
 *   （Chromium 不跨浏览器重启保留），失效时点一次「授权写入」即可，
 *   不需要重新翻目录。
 * ─────────────────────────────────────────────────────────
 *
 * 数据源：Gitee 的 **raw 通道**（原理与实测数据见 src/shared/gitee.js 头部注释）。
 *   读一次更新清单 + 每个文件各取一次，全程不碰 /api/v5，
 *   因此不受「未登录 60 次/小时」的匿名限流影响 —— 这是 26.10.10.6 的改动。
 *   （老实现走 /git/trees + /git/blobs，额度打满后商家点「安装更新」必然失败。）
 *
 * ═══════ 26.10.11.3 的流程改造（用户要求「少点几下」）═══════
 *
 * 老流程要用户点四次：弹窗「安装更新」→「确认安装」→ 窗口里「开始更新」
 * → 系统目录框选目录 → 「授权写入」→ 再「开始更新」（其实五次）。
 *
 * 新流程（下载与授权**并行**，靠这个把等待时间藏起来）：
 *
 *   窗口一打开 ──┬─→ 立即开始下载 + 校验（**不需要任何权限**，全在内存里）
 *                └─→ 同时检查目录句柄
 *                     ├ 句柄在、权限在   → 「已就绪」，预载一完成就自动写入
 *                     ├ 句柄在、权限没了 → 「待授权」，点一下「授权并开始」＝确认
 *                     └ 句柄失效/没有   → 「未定位」，选一次目录
 *
 *   关键认知：**下载不需要目录权限**。所以原来「先授权、再下载」的顺序
 *   白白让用户干等了一轮；改成并行后，用户去点授权的那几秒里，
 *   文件往往已经下载完了，点完授权立刻就能写完。
 *
 * ── 为什么覆盖动作没有单独的「开始覆盖」按钮 ──
 *   用户的原始设想是「等我点开始覆盖才覆盖」。但 FSA 的写入权限
 *   **每次浏览器重启都会失效**，所以实际上每次更新都必须点一下
 *   「授权并开始」——那一下点按本身就是确认。
 *   全自动（不点任何按钮）只在「同一浏览器会话内第二次更新」时才会发生，
 *   且此时磁盘与目标版本比对（见下）还会再挡一道。
 *
 * ── 温度门槛（避免重复覆盖）──
 *   覆盖前先读目录里 manifest.json 的版本号：
 *     · 磁盘版本 == 目标版本 → **不自动覆盖**，提示「已经是这版了」，
 *       并给出「开始覆盖」按钮供强制重装（用于怀疑文件被改坏的场景）。
 *     · 磁盘版本 ≠ 目标版本 → 正常自动写入。
 *   这挡掉的是「上一次装完没重载扩展，用户又点了一次安装」这种重复劳动。
 *
 * 更新流程（顺序不可随意调换）：
 *   1. 确认目标目录身份            —— 防止写错文件夹
 *   2. 读更新清单，校验清单版本号   —— raw 通道，零 API 调用
 *   3. 按白名单只留扩展本体         —— 详见 isExtFile
 *   4. 必需文件闸门               —— manifest + 三个图标，缺一个就中止
 *   5. 全部下载 + 逐个校验 sha256  —— 先全部拿到手，避免网络失败留下半成品
 *   6. 包内版本号必须等于目标版本   —— 防下错版本（与清单版本号双重确认）
 *   7. 快照当前版本                —— 供一键回滚
 *   8. 逐文件写入，manifest 最后写  —— 中途失败时扩展仍读到旧版本号
 *   9. chrome.runtime.reload()
 *
 * ⚠️ 中断只在第 5 步（下载阶段）有效。一旦进入第 8 步写入，
 *    中断会留下半新半旧的目录（扩展直接变砖），所以那时按钮会拒绝中断。
 *
 * ═══════ 26.10.13.x 的流程改造（用户要求「随时能退回上一版」）═══════
 *
 * 问题：回退入口原来只挂在「更新页」上，而更新页的入口又只在
 *   「发现新版本」时才出现。更新一完成，弹窗回到「已是最新」，
 *   更新页再也打不开 —— 回退按钮等于永久消失（用户 2026-10-13 反馈）。
 *
 * 改法：本页支持两种模式，由 URL 参数决定 ——
 *   · 升级模式  ?tag=X&version=Y   （原有行为，不变）
 *   · 回退模式  ?mode=rollback     （新）
 * 回退入口常驻在弹窗（版本号旁的「回退」链接），与「有没有新版本」彻底解耦。
 *
 * 回退模式下：
 *   · 不预取下载（没有目标版本），只列出本地备份队列（最多 3 份，见 backup-store.js）；
 *   · 选一份 → 定位目录 → 授权 → 写回；
 *   · 写回后还要**删掉新版本新增的文件**（见 pruneExtraFiles），否则目录里会
 *     残留旧版本没有的文件，不算真正回到上一版；
 *   · 回读 manifest 校验版本号，通过才收尾重载。
 *
 * 另外，升级失败时（写入或回读校验出错）会**自动回退**到刚才拍的快照，
 * 不再只提示用户自己点按钮 —— 那时用户往往已经不知道该怎么办了。
 *
 * ⚠️ 回退同样需要目录写权限，浏览器重启后必须重新授权一次，这一点绕不过去。
 * ⚠️ 备份存在浏览器 IndexedDB 里，重装扩展或清理浏览器数据会一并丢失；
 *    真要彻底保险，得走「从 Gitee 下载任意历史版本」的通道（尚未实现）。
 */

const $ = (id) => document.getElementById(id);

/* ============ 本地存储 ============ */
// 目录句柄与备份队列统一走 src/shared/backup-store.js —— 弹窗与更新页共用同一个库，
// 弹窗才能据此知道「本地有没有备份」，从而决定要不要显示回退入口。
const K_DIR = DYC_STORE.KEY.DIR;
const K_LAST_RUN = DYC_STORE.KEY.LAST_RUN;
const kvGet = DYC_STORE.kvGet;
const kvSet = DYC_STORE.kvSet;
const kvDel = DYC_STORE.kvDel;

/* ============ 小工具 ============ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

const errText = (e) => String((e && e.message) || e);

/**
 * 造一个「确定性错误」。
 *
 * 与网络故障的区别决定了要不要自动重试：
 *   · 断流、超时、5xx  → 重试有意义（网络抖动占失败原因的大多数）
 *   · 清单缺失、哈希不符、缺必需文件、版本号对不上 → 重试多少次结果都一样，
 *     自动重试只会让用户白等一轮，还可能把真正的原因埋在重试日志里。
 * 所以这类错误打上 noRetry 标记，startPrefetch 的 catch 里据此跳过自动重试。
 */
function fatal(msg) {
  const e = new Error(msg);
  e.noRetry = true;
  return e;
}

/**
 * 失败重试包装。
 * Windows 上浏览器可能短暂持有扩展文件的句柄，写入会抛错误，
 * 隔一小段时间重试通常就能成功，所以不能一次失败就放弃。
 */
async function withRetry(fn, tries, delayMs) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw last;
}

/* ============ 运行状态 ============ */
const FSA_OK = typeof window.showDirectoryPicker === 'function';

const localVersion = chrome.runtime.getManifest().version;
const params = new URLSearchParams(location.search);
let targetTag = params.get('tag') || '';
let targetVersion = params.get('version') || '';

/**
 * 两种模式（同一个页面，靠 URL 参数区分）：
 *   false —— 升级：弹窗点「安装更新」进来，带 tag / version，走下载链路；
 *   true  —— 回退：弹窗点「回退」进来，只带 mode=rollback，没有目标版本，
 *            不下载，只把本地备份写回磁盘。
 * 拆成两种模式的原因见文件头注释：回退入口必须与「有没有新版本」解耦。
 */
const IS_ROLLBACK = params.get('mode') === 'rollback';

/** 回退模式：备份队列（新的在前）与当前选中项 */
let rollbackList = [];
let rollbackPick = null;

/**
 * 安装助手(!安装助手.bat)的固定部署目录 —— 只作**提示文案**用。
 * ⚠️ 浏览器不允许 JS 按绝对路径访问磁盘,也无法反查扩展自己装在哪个路径,
 *    所以这里只是一个「给用户看的参考路径」,不能用来自动定位或校验。
 *    用户若手动存到别处,以「目录里有 manifest.json」为判断依据。
 */
const DEFAULT_DIR_HINT = 'C:\\DY-COCO';

let dirHandle = null;   // 扩展目录句柄
let permOk = false;     // 是否已拿到读写授权
let diskVersion = '';   // 目录里 manifest.json 记的版本（用于「是否已装过」判断）
let running = false;    // 是否正在写盘
let aborted = false;    // 是否已请求中断（只在下载阶段生效）

/**
 * 预载状态：下载 + 校验全部文件，**只留在内存，不碰磁盘**。
 * 与授权并行进行 —— 这是本次提速的核心。
 */
const pre = {
  started: false,
  running: false,
  done: false,
  error: null,
  autoRetried: false,  // 本轮是否已经自动重试过（只自动重试一次）
  paths: [],          // 经白名单过滤后要装的路径
  files: [],          // [{ path, bytes }]，顺序即完成顺序
  totalCount: 0,
  doneCount: 0,
  totalBytes: 0,      // 清单里的 size 之和，用于算字节级进度
  loadedBytes: 0,     // 已收到的字节（含正在下的那个文件）
};

/* ============ 日志与进度 ============ */

function log(text, cls) {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.textContent = text;
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}

function logClear() { $('log').textContent = ''; }

/** 进度条比例：下载占 0~0.68，写入占 0.70~0.99，1.0 表示完成 */
function paintBar(ratio) {
  $('bar').style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
}

// 流式下载会非常频繁地回调，用 rAF 合并重绘，避免每来一个数据块就写一次 DOM
let _rafPending = false;
function refreshDownloadBar() {
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => {
    _rafPending = false;
    const r = pre.totalBytes > 0 ? pre.loadedBytes / pre.totalBytes : 0;
    paintBar(Math.min(0.68, r * 0.68));
    $('bar').title =
      '已下载 ' + fmtSize(pre.loadedBytes) + ' / ' + fmtSize(pre.totalBytes);
  });
}

function setProgress(ratio, text) {
  paintBar(ratio);
  if (text) log(text, 'dim');
}

/* ============ 目录句柄与权限 ============ */

/**
 * 检查/申请读写权限。
 * 有些内核没有 queryPermission（早期实现），此时直接放行、靠写入结果说话。
 */
async function ensurePermission(handle, request) {
  if (!handle.queryPermission) return true;
  let st = await handle.queryPermission({ mode: 'readwrite' });
  if (st === 'granted') return true;
  if (!request) return false;
  st = await handle.requestPermission({ mode: 'readwrite' });
  return st === 'granted';
}

/** 读目录里的 manifest.json，用来确认“这确实是本扩展的目录” */
async function readManifest(dir) {
  const fh = await dir.getFileHandle('manifest.json');
  const file = await fh.getFile();
  const m = JSON.parse(await file.text());
  const ok = m && m.manifest_version === 3 && String(m.name || '').indexOf('可可助手') > -1;
  if (!ok) throw new Error('该目录不是「可可助手」，请选择包含 manifest.json 的扩展目录');
  return m;
}

function setDirState(kind, text) {
  const el = $('dir-state');
  el.className = 'dir-state' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

/**
 * 把「默认目录」提示与「复制路径」按钮同步显示或隐藏。
 * 只在第 1 步处于「需要用户选/授权」时才有意义,已就绪后自动收起,避免干扰。
 */
function setDefaultDirHint(show) {
  const line = $('dir-default');
  if (!line) return;
  line.hidden = !show;
}

/** 复制默认路径到剪贴板。拿不到剪贴板权限时降级为让用户手动记。 */
async function copyDefaultDir() {
  const btn = $('btn-copy-dir');
  const flash = (t) => {
    if (!btn) return;
    btn.textContent = t;
    setTimeout(() => { btn.textContent = '复制默认路径'; }, 1600);
  };

  // 首选 Clipboard API(扩展页是安全上下文,通常可用)
  try {
    await navigator.clipboard.writeText(DEFAULT_DIR_HINT);
    flash('已复制');
    return;
  } catch (e) { /* 落到下面的兜底 */ }

  // 兜底:临时 textarea + execCommand —— 部分国产内核剪贴板策略更严
  try {
    const ta = document.createElement('textarea');
    ta.value = DEFAULT_DIR_HINT;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    flash(ok ? '已复制' : '复制失败,请手输');
  } catch (e) {
    flash('复制失败,请手输');
  }
}

/**
 * 刷新第①步的界面 —— 三态：
 *   未定位（err）／待授权（warn）／已就绪（ok）
 * 每态都顺带把「磁盘上的真实版本」读出来存进 diskVersion，
 * 供后面的温度门槛判断用。
 */
async function refreshDirUI() {
  const hint = $('dir-hint');
  const btnPick = $('btn-pick');
  const btnGrant = $('btn-grant');

  if (!dirHandle) {
    permOk = false;
    diskVersion = '';
    setDirState('err', '未定位到扩展目录。请选择包含 manifest.json 的那一层文件夹。');
    hint.textContent = '只需要选一次,之后会被记住,不必每次重选。';
    setDefaultDirHint(true);
    btnPick.hidden = false;
    btnGrant.hidden = true;
    afterDirChange();
    return;
  }

  // 目录可能已被移动或删除,读一次 manifest 验证句柄还有效
  try {
    const m = await readManifest(dirHandle);
    diskVersion = String(m.version || '');

    if (diskVersion && diskVersion === String(targetVersion)) {
      setDirState('ok', '已就绪 —— ' + dirHandle.name + '(目录内已经是 v' + diskVersion + ')');
    } else {
      setDirState('ok', '已就绪 —— ' + dirHandle.name + '(目录内版本 ' + diskVersion + ')');
    }

    const granted = await ensurePermission(dirHandle, false);
    permOk = granted;
    if (granted) {
      hint.textContent = '写入权限已就绪,无需再点任何按钮。';
      setDefaultDirHint(false);
      btnGrant.hidden = true;
    } else {
      setDirState('warn', '已定位 ' + dirHandle.name + '(目录内版本 ' + diskVersion + ')—— 待授权');
      hint.textContent = '浏览器安全模型要求每次浏览器重启后重新授权一次;'
        + '点一下即可,不需要重新选目录。';
      setDefaultDirHint(false);
      btnGrant.hidden = false;
    }
    btnPick.hidden = true;
  } catch (e) {
    // 句柄失效:清掉,让用户重新选
    dirHandle = null;
    permOk = false;
    diskVersion = '';
    await kvDel(K_DIR).catch(() => {});
    setDirState('err', '之前记录的目录已失效(' + errText(e) + '),请重新选择。');
    hint.textContent = '请重新选一次:目录里有 manifest.json 的那一层。';
    setDefaultDirHint(true);
    btnPick.hidden = false;
    btnGrant.hidden = true;
  }

  afterDirChange();
}

/**
 * 选目录。
 *
 * ⚠️ 关于「自动定位」能做到哪一步（别把期望写错）：
 *   浏览器**不允许** JS 按绝对路径访问磁盘（安全模型），
 *   showDirectoryPicker 也不接受 'C:\DY-COCO' 这种路径参数 ——
 *   所以「自动扫描候选路径」在本架构下**做不到**，不是没实现。
 *   能做到的是两层：① 复用 IndexedDB 里记住的句柄（通常连对话框都不用弹）；
 *   ② 真要重选时，把上次的句柄当 startIn 传给对话框，系统会**直接打开那个目录**，
 *   用户少翻几层。下面就是第 ② 层。
 */
async function pickDirectory() {
  const opts = { id: 'dyc-ext', mode: 'readwrite' };
  // startIn 只吃 FileSystemHandle，吃不了路径字符串；传失效句柄会被忽略，故包在 try 里
  if (dirHandle) {
    try { opts.startIn = dirHandle; } catch (e) { /* 无效就退回默认位置 */ }
  }

  try {
    const h = await window.showDirectoryPicker(opts);
    await readManifest(h);   // 立刻验证身份，避免用户选错目录
    dirHandle = h;
    await kvSet(K_DIR, h);
    await refreshDirUI();
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 用户自己取消了
    setDirState('err', '选择目录失败：' + errText(e));
  }
}

async function grantDirectory() {
  if (!dirHandle) return;
  try {
    const ok = await ensurePermission(dirHandle, true);
    if (ok) {
      await refreshDirUI();   // 授权成功 → afterDirChange 会自动续跑写入
    } else {
      $('dir-hint').textContent = '授权被拒绝，无法继续。';
    }
  } catch (e) {
    $('dir-hint').textContent = '授权失败：' + errText(e);
  }
}

/* ============ 扩展文件白名单 ============ */

/**
 * 仓库里哪些路径属于「扩展本体」，自更新时才会写盘。
 *
 * 为什么必须用白名单：仓库根目录长期躺着 README.md、AGENTS.md、LICENSE、
 * publish.sh、开发日志.md、开发待办.md、.gitignore、.gitee-url.bak，还有 install/ 与
 * scripts/ 两个文件夹——它们都不属于扩展。原来实现是把整棵树全写盘，
 * 结果是：商家用干净 zip 装好的目录，一旦走一次自更新，就会被塞进一堆内部
 * 开发文件——既脏，又把内部文档和脚本暴露到商家机器上。
 *
 * 为什么用白名单而不是黑名单：黑名单要逐个列举“排除谁”，将来仓库里新增
 * 一个文档就漏一个；白名单是闭集，新增任何开发文件都自动被挡在外面。
 *
 * ⚠️ 这份白名单必须与 scripts/make-update-manifest.py 的 ROOT_FILES / DIRS
 *    保持一致 —— 那边生成更新清单，这边过滤写盘。两边不同步的后果是
 *    「清单里有的文件被这里滤掉（漏更新）」或「开发文件被写进商家目录」。
 *
 * ⚠️ 将来若给扩展新增顶层目录（例如 _locales/ 做多语言、assets/ 放静态
 *    资源），必须**同时**加进 EXT_TOP_DIRS 和那个脚本的 DIRS，否则更新会漏文件。
 */
const EXT_TOP_DIRS = ['icons/', 'src/'];
const REQUIRED_SNAPSHOT_FILES = [
  'manifest.json',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

function isExtFile(path) {
  const p = String(path || '');
  if (p === 'manifest.json') return true;
  return EXT_TOP_DIRS.some((d) => p.startsWith(d));
}

function isSafeExtPath(path) {
  const p = String(path || '');
  return isExtFile(p) && !p.includes('\\') && !p.startsWith('/')
    && p.split('/').every((part) => part && part !== '.' && part !== '..');
}

/* ============ 文件读写 ============ */

async function writeFile(root, relPath, bytes, onWriteStart) {
  const parts = String(relPath).split('/').filter(Boolean);
  const name = parts.pop();
  let dir = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create: true });
  }
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  if (onWriteStart) onWriteStart();
  await w.write(bytes);
  await w.close();
}

/**
 * 递归列出目录下的文件相对路径（排除 .git）。
 * 回退后靠它找出「新版本新增、旧版本没有」的多余文件。
 */
async function listFiles(root) {
  const out = [];
  async function walk(dir, base) {
    const iter = typeof dir.entries === 'function'
      ? dir.entries()
      : (async function* () { for await (const h of dir.values()) yield [h.name, h]; })();
    for await (const [name, handle] of iter) {
      if (!base && name === '.git') continue;
      const p = base ? base + '/' + name : name;
      if (handle.kind === 'file') out.push(p);
      else if (handle.kind === 'directory') await walk(handle, p);
    }
  }
  await walk(root, '');
  return out;
}

/** 删除目录下的某个文件（只删文件，不删目录 —— 空目录无害，删目录风险更大） */
async function removeFile(root, relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  const name = parts.pop();
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  await dir.removeEntry(name);
}

/**
 * 回退收尾：删掉「新版本新增、旧版本没有」的扩展本体文件。
 *
 * 为什么必须做：回退只把备份里的文件写回去，**不会**自动清理新版本新增的文件，
 * 目录里就会残留旧版本根本不存在的文件（例如新版本加的 src/content/xxx.js）。
 * 虽然旧 manifest 不会引用它们，但目录已经不等于旧版本的真实状态。
 *
 * 安全边界（三重保险，宁可不删也不删错）：
 *   ① 只删 isExtFile 白名单内的路径（manifest.json / icons/ / src/）；
 *   ② 只删「不在备份清单里」的路径；
 *   ③ 不删目录，只删文件。
 * 也就是说 README、开发日志这类目录内其他内容永远不会被碰。
 */
async function pruneExtraFiles(root, snap) {
  const byPath = validateSnapshot(snap);
  const keep = new Set(byPath.keys());

  let now;
  try {
    now = await listFiles(root);
  } catch (e) {
    throw new Error('无法核对回退后的文件清单：' + errText(e));
  }

  const extra = now.filter((p) => isExtFile(p) && !keep.has(p));
  if (!extra.length) return [];

  const removed = [];
  for (const p of extra) {
    try {
      await withRetry(() => removeFile(root, p), 3, 200);
      removed.push(p);
      log('已移除多余文件 ' + p, 'dim');
    } catch (e) {
      throw new Error('恢复文件已写回，但未能清理新增文件 ' + p + '：' + errText(e));
    }
  }
  return removed;
}

/**
 * 快照当前扩展目录（排除 .git）。
 *
 * 用途是回滚：本工程目录同时是浏览器加载目录，覆盖后若新版本有问题，
 * 需要能把旧文件写回去。扩展内跑不了 git，所以自己做一份内存外的副本，
 * 存在 IndexedDB 里（不占 chrome.storage 配额，二进制也安全）。
 */
async function snapshotDir(root) {
  const files = [];
  let total = 0;
  const MAX_ONE = 4 * 1024 * 1024;
  const MAX_ALL = 6 * 1024 * 1024;

  async function walk(dir, base) {
    // entries() 在个别旧内核上可能缺失，回退到 values()（handle 自带 name）
    const iter = typeof dir.entries === 'function'
      ? dir.entries()
      : (async function* () { for await (const h of dir.values()) yield [h.name, h]; })();

    for await (const [name, handle] of iter) {
      // .git 可能有几百 MB，绝不能进快照
      if (!base && name === '.git') continue;
      const p = base ? base + '/' + name : name;

      if (handle.kind === 'file') {
        if (!isSafeExtPath(p)) continue;
        const fh = await dir.getFileHandle(name);
        const file = await fh.getFile();
        if (file.size > MAX_ONE) throw new Error('扩展文件超过 4 MB，无法创建完整备份：' + p);
        if (total + file.size > MAX_ALL) throw new Error('扩展文件总量超过 6 MB，无法创建完整备份');
        const bytes = new Uint8Array(await file.arrayBuffer());
        total += file.size;
        files.push({ path: p, b64: DYC_GITEE.bytesToBase64(bytes) });
      } else if (handle.kind === 'directory' && isExtFile(p + '/_')) {
        await walk(handle, p);
      }
    }
  }

  await walk(root, '');
  const paths = new Set(files.map((f) => f.path));
  const missing = REQUIRED_SNAPSHOT_FILES.filter((p) => !paths.has(p));
  if (missing.length) throw new Error('当前目录缺少必需文件，无法创建完整备份：' + missing.join('、'));
  for (const f of files) {
    f.sha256 = await DYC_GITEE.sha256Hex(DYC_GITEE.base64ToBytes(f.b64));
  }
  const snapshot = {
    savedAt: new Date().toISOString(),
    fromVersion: diskVersion || localVersion,
    bytes: total,
    format: 2,
    paths: files.map((file) => file.path).sort(),
    files
  };
  validateSnapshot(snapshot);
  return snapshot;
}

// 旧备份也必须包含 manifest 和静态入口引用的文件，不能只凭图标和版号判完整。
function validateSnapshotReferences(byPath) {
  const decode = (file) => new TextDecoder().decode(DYC_GITEE.base64ToBytes(file.b64));
  let manifest;
  try { manifest = JSON.parse(decode(byPath.get('manifest.json'))); }
  catch (_) { throw new Error('备份中的扩展清单无法解析'); }
  const pending = [];
  const visited = new Set();
  function add(value, parent) {
    if (typeof value !== 'string' || !value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return;
    value = value.split(/[?#]/)[0];
    if (!value || value.includes('*')) return;
    const parts = (value.startsWith('/') ? value.slice(1) : (parent ? parent.slice(0, parent.lastIndexOf('/') + 1) : '') + value).split('/');
    const normalized = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!normalized.length) throw new Error('备份入口路径越界'); normalized.pop(); }
      else normalized.push(part);
    }
    const path = normalized.join('/').split('#')[0];
    if (!isSafeExtPath(path) || !byPath.has(path)) throw new Error('备份缺少运行文件：' + path);
    pending.push(path);
  }
  function icons(value) {
    if (typeof value === 'string') add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => add(item));
  }
  icons(manifest.icons);
  ['action', 'browser_action', 'page_action'].forEach((key) => {
    if (!manifest[key]) return;
    add(manifest[key].default_popup); icons(manifest[key].default_icon);
  });
  if (manifest.background) {
    add(manifest.background.service_worker); add(manifest.background.page);
    (manifest.background.scripts || []).forEach((value) => add(value));
  }
  (manifest.content_scripts || []).forEach((entry) => (entry.js || []).concat(entry.css || []).forEach((value) => add(value)));
  add(manifest.options_page); if (manifest.options_ui) add(manifest.options_ui.page);
  Object.values(manifest.chrome_url_overrides || {}).forEach((value) => add(value));
  (manifest.web_accessible_resources || []).forEach((entry) => {
    (typeof entry === 'string' ? [entry] : entry.resources || []).forEach((value) => add(value));
  });
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    if (!/\.(?:html?|js|css)$/i.test(path)) continue;
    const text = decode(byPath.get(path));
    if (/\.html?$/i.test(path)) {
      for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) add(match[1], path);
    } else if (/\.js$/i.test(path)) {
      for (const call of text.matchAll(/\bimportScripts\s*\(([^)]*)\)/g)) {
        for (const match of call[1].matchAll(/["']([^"']+)["']/g)) add(match[1], path);
      }
    } else {
      for (const match of text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) add(match[1], path);
    }
  }
}

function validateSnapshot(snap) {
  if (!snap || !Array.isArray(snap.files)) throw new Error('这份备份格式无效，无法回退');
  const byPath = new Map();
  for (const f of snap.files) {
    const p = f && String(f.path || '');
    if (!f || !p || p.includes('\\') || p.startsWith('/')
      || p.split('/').some((part) => !part || part === '.' || part === '..')
      || typeof f.b64 !== 'string') {
      throw new Error('这份备份包含无效文件，无法安全回退');
    }
    if (!isSafeExtPath(p)) continue; // 旧版快照可能含开发文件，忽略且绝不写回
    if (byPath.has(p)) throw new Error('这份备份包含重复文件，无法安全回退');
    byPath.set(p, f);
  }
  const missing = REQUIRED_SNAPSHOT_FILES.filter((p) => !byPath.has(p));
  if (missing.length) throw new Error('这份备份不完整（缺少 ' + missing.join('、') + '），无法回退');
  if (snap.format === 2) {
    const actual = Array.from(byPath.keys()).sort();
    if (!Array.isArray(snap.paths) || JSON.stringify(snap.paths) !== JSON.stringify(actual)
        || Array.from(byPath.values()).some((file) => !/^[a-f0-9]{64}$/i.test(file.sha256 || ''))) {
      throw new Error('备份文件清单不完整，无法安全回退');
    }
  }
  validateSnapshotReferences(byPath);
  return byPath;
}

/* ============ 阶段一：预载（下载 + 校验，不落盘） ============ */

const PREFETCH_CONCURRENCY = 6;

/** 单个文件的下载 + 校验；重试前必须把字节计数回退，否则进度会虚高 */
async function prefetchOne(entry) {
  const base = pre.loadedBytes;
  const bytes = await withRetry(() => {
    // 上一轮失败时可能已经加过字节，回退到本次下载的起点
    pre.loadedBytes = base;
    refreshDownloadBar();
    return DYC_GITEE.fetchRawFile(targetTag, entry.path, entry.size, (n) => {
      pre.loadedBytes += n;
      refreshDownloadBar();
    });
  }, 3, 400);

  const sha = await DYC_GITEE.sha256Hex(bytes);
  if (sha !== entry.sha256) {
    throw fatal('内容校验失败：' + entry.path + '（与清单记录不一致，已中止）');
  }
  pre.files.push({ path: entry.path, bytes });
  pre.doneCount++;
  refreshDownloadBar();
  return bytes;
}

/**
 * 开始预载。**不需要任何目录权限**，所以窗口一打开就可以跑，
 * 与用户去点「授权并开始」的过程并行。
 */
async function startPrefetch() {
  if (pre.started) return;
  pre.started = true;
  pre.running = true;
  pre.error = null;
  renderRunButtons();

  try {
    if (!targetTag) throw fatal('缺少目标版本信息，请从弹窗重新发起更新');

    // --- 1. 读更新清单（走 raw 通道，不碰会限流的 API）---
    setProgress(0.01, '读取 ' + targetTag + ' 的更新清单…');
    const manifestData = await DYC_GITEE.fetchUpdateManifest(targetTag);

    // 双保险：清单理论上只列扩展本体（生成脚本与本页 isExtFile 用同一份白名单），
    // 但万一清单被改坏或将来口径漂移，这里仍挡一道 ——
    // 绝不让 README / publish.sh 这类开发文件落到商家机器上。
    const tree = manifestData.files.filter((e) => isExtFile(e.path));
    log('更新清单共 ' + manifestData.files.length + ' 个文件，属于扩展的 ' + tree.length + ' 个');
    if (manifestData.files.length > tree.length) {
      log('已跳过 ' + (manifestData.files.length - tree.length) + ' 个非扩展文件', 'dim');
    }

    // 清单自带版本号，先比一次 —— 比「下完再比」早得多，省得白下载一轮
    if (String(manifestData.version) !== String(targetVersion)) {
      throw fatal(
        '清单版本号对不上：清单为 ' + manifestData.version + '，期望 ' + targetVersion
      );
    }

    // --- 2. 必需文件闸门 ---
    // 走过一次坑：图标尚未提交入库时打出的标签归档里没有 icons/，
    // 覆盖后 manifest 引用不到图标，扩展会直接加载失败。
    // 所以这里必须硬性拦截，宁可不让更新，也不能让扩展变砖。
    const required = [
      'manifest.json',
      'icons/icon16.png',
      'icons/icon48.png',
      'icons/icon128.png'
    ];
    const pathSet = new Set(tree.map((e) => e.path));
    const missing = required.filter((p) => !pathSet.has(p));
    if (missing.length) {
      throw fatal('更新包缺少必需文件，已中止：' + missing.join('、'));
    }

    // --- 3. 并发下载 + 逐个校验 ---
    // 先全部拿到手再写盘：网络中途失败时磁盘保持原样，不会出现半新半旧。
    pre.paths = tree;
    pre.totalCount = tree.length;
    pre.totalBytes = tree.reduce((s, e) => s + (Number(e.size) || 0), 0);
    pre.loadedBytes = 0;
    setProgress(0.01, '开始下载 ' + tree.length + ' 个文件（约 ' + fmtSize(pre.totalBytes) + '）…');

    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (aborted) throw new Error('已中断');
        const i = cursor++;
        if (i >= tree.length) return;
        const e = tree[i];
        await prefetchOne(e);
        log('已下载并校验 (' + pre.doneCount + '/' + tree.length + ') ' + e.path, 'dim');
      }
    };
    const n = Math.min(PREFETCH_CONCURRENCY, tree.length);
    await Promise.all(Array.from({ length: n }, worker));

    if (aborted) throw new Error('已中断');

    // --- 4. 包内版本号必须等于目标版本 ---
    const mf = pre.files.find((f) => f.path === 'manifest.json');
    const parsed = JSON.parse(new TextDecoder().decode(mf.bytes));
    if (String(parsed.version) !== String(targetVersion)) {
      throw fatal('版本号对不上：包内为 ' + parsed.version + '，期望 ' + targetVersion);
    }

    pre.done = true;
    pre.running = false;
    pre.loadedBytes = pre.totalBytes;
    paintBar(0.68);
    log('全部文件下载并校验通过（' + pre.files.length + ' 个，' + fmtSize(pre.totalBytes) + '）', 'ok');

    renderRunButtons();
    maybeAutoRun();
  } catch (e) {
    pre.running = false;
    pre.done = false;
    paintBar(0);
    const msg = errText(e);

    if (aborted) {
      pre.error = msg;
      log('下载已中断，磁盘未做任何改动。', 'dim');
      $('dir-hint').textContent = '下载已中断。可点「重试下载」再来一次。';
      renderRunButtons();
      return;
    }

    log('准备阶段失败：' + msg, 'err');

    // 免手点重试（B6）：网络抖动占失败原因的大多数，为这个让用户手点一次很烦。
    // 但**只对可恢复的错误**自动重试，且只重试一次 ——
    //   · 清单缺失 / 哈希不符 / 缺文件 / 版本不符 属确定性错误（e.noRetry），
    //     重试结果一样，白等一轮还把真原因埋进重试日志里；
    //   · 真离线了，重试多少次都没用，早点告诉用户比反复空转好。
    if (!e.noRetry && !pre.autoRetried) {
      pre.autoRetried = true;
      pre.error = null;
      log('1.5 秒后自动重试一次…', 'dim');
      renderRunButtons();
      setTimeout(() => {
        if (aborted) return;
        pre.started = false;
        pre.running = false;
        pre.files = [];
        pre.paths = [];
        pre.doneCount = 0;
        pre.loadedBytes = 0;
        startPrefetch();
      }, 1500);
      return;
    }

    pre.error = msg;
    renderRunButtons();
  }
}

/* ============ 阶段二：写入磁盘 ============ */

async function runWrite() {
  if (running || aborted) return false;
  if (!dirHandle || !permOk) return false;
  if (!pre.done || !pre.files.length) return false;

  running = true;
  renderRunButtons();
  let writeStarted = false;
  let snap = null;

  try {
    // --- 5. 快照（进备份队列，最多留 3 份，供回退）---
    setProgress(0.70, '备份当前版本…');
    snap = await snapshotDir(dirHandle);
    await DYC_BACKUP.push(snap);
    const persisted = await DYC_BACKUP.list();
    const saved = persisted.some((s) => s && String(s.savedAt) === String(snap.savedAt)
      && String(s.fromVersion) === String(snap.fromVersion)
      && Number(s.bytes) === Number(snap.bytes)
      && Array.isArray(s.files) && s.files.length === snap.files.length
      && snap.files.every((f) => s.files.some((savedFile) =>
        savedFile.path === f.path && savedFile.sha256 === f.sha256)));
    if (!saved) {
      throw new Error('本次快照未能保存，已停止更新，磁盘未改动');
    }
    log('已备份当前版本 v' + (diskVersion || localVersion)
      + '（' + snap.files.length + ' 个文件，' + fmtSize(snap.bytes) + '）', 'ok');

    // --- 6. 写入：manifest.json 放到最后 ---
    // 这样即使中途失败，磁盘上的版本号仍是旧的，扩展不会“自称新版本却半旧”。
    const ordered = pre.files
      .slice()
      .sort((a, b) => (a.path === 'manifest.json' ? 1 : 0) - (b.path === 'manifest.json' ? 1 : 0));

    for (let i = 0; i < ordered.length; i++) {
      const f = ordered[i];
      setProgress(0.72 + (i / ordered.length) * 0.26,
        '写入 (' + (i + 1) + '/' + ordered.length + ') ' + f.path);
      await withRetry(() => writeFile(dirHandle, f.path, f.bytes, () => { writeStarted = true; }), 4, 300);
    }
    log('全部文件写入完成', 'ok');

    // --- 6.5 回读校验 ---
    // Windows 上文件可能被短暂占用，写入调用返回成功不等于内容真的落盘。
    // 回读每个已写文件，不能只凭 manifest 版号判定安装完整。
    setProgress(0.99, '回读校验…');
    for (const file of ordered) {
      const parts = file.path.split('/');
      const name = parts.pop();
      let directory = dirHandle;
      for (const part of parts) directory = await directory.getDirectoryHandle(part);
      const handle = await directory.getFileHandle(name);
      const actual = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (await DYC_GITEE.sha256Hex(actual) !== await DYC_GITEE.sha256Hex(file.bytes)) {
        throw new Error('写入后校验失败：' + file.path);
      }
    }
    const back = await readManifest(dirHandle);
    if (String(back.version) !== String(targetVersion)) {
      throw new Error('回读到的版本号仍是 ' + back.version + '，覆盖可能被文件占用阻止');
    }
    diskVersion = String(back.version);
    log('回读校验通过：磁盘版本 ' + back.version, 'ok');

    // --- 温度门槛：短时间内连续更新才额外提示，首次更新不多话 ---
    const lastRaw = await kvGet(K_LAST_RUN).catch(() => null);
    const lastAt = Date.parse(lastRaw || '');
    const repeated = isFinite(lastAt) && (Date.now() - lastAt) < 30 * 60 * 1000;
    await kvSet(K_LAST_RUN, new Date().toISOString()).catch(() => {});

    // --- 7. 通知后台清除“有更新”状态，然后重载 ---
    paintBar(1);
    try {
      await chrome.runtime.sendMessage({ type: 'dyc:markUpdated', version: targetVersion });
    } catch (e) {
      // 后台没响应不影响更新本身
    }

    finishSuccess(targetVersion, repeated);
  } catch (e) {
    paintBar(0);
    log('更新失败：' + errText(e), 'err');
    if (!writeStarted) {
      running = false;
      renderRunButtons();
      return;
    }

    // 只有这次已完成并入队的快照可以回滚，不能回退到历史队列头部。
    if (!snap) {
      running = false;
      renderRunButtons();
      log('本次写入前快照不可用，未尝试回退其他历史版本。', 'warn');
      return;
    }

    log('正在自动回退到 v' + snap.fromVersion + '…', 'warn');
    try {
      await restoreSnapshot(snap, '自动回退');
      paintBar(1);
      log('已自动回退到 v' + snap.fromVersion + '，正在重新加载扩展…', 'ok');
      finishAndClose();
    } catch (e2) {
      running = false;
      renderRunButtons();
      log('自动回退失败：' + errText(e2), 'err');
      log('可点下方按钮手动重试回退。', 'dim');
      const btn = $('btn-rollback');
      btn.textContent = '回退到 v' + snap.fromVersion;
      btn.hidden = false;
    }
  }
}

function finishSuccess(version, repeated) {
  log('更新完成：v' + version, 'ok');
  log('正在重新加载扩展…本窗口即将自动关闭。', 'dim');
  if (repeated) {
    // 温度门槛：只有短时间内连着更新第二次才啰嗦这一句
    log('提示：短时间内已连续更新多次。若功能表现异常，请到扩展管理页点一次「重新加载」。', 'dim');
  }
  running = true;
  renderRunButtons();
  finishAndClose();
}

/**
 * 收尾统一走这里（用户 2026-10-11 定：安装成功后窗口自动关闭）。
 * 顺序有讲究：旧实现只在本页调 chrome.runtime.reload()，重载会销毁本页，
 * 窗口却留在屏幕上变成僵尸页，用户每次都要手动关。现在改成：
 *   1. 先发消息给 Service Worker，由**它**在 900ms 后执行重载 ——
 *      本页随窗口关掉也不影响重载（SW 是独立上下文）；
 *   2. 本页 500ms 后 window.close() 自关（本窗口是扩展自己开的
 *      popup 窗口，扩展页面有权关闭它；不碰用户任何标签页）；
 *   3. 本页 1200ms 后兜底 reload：万一窗口没关成、消息又丢了，
 *      旧链路仍能重载（窗口已关时这段根本不会执行）。
 */
function finishAndClose() {
  try {
    chrome.runtime.sendMessage({ type: 'dyc:update-finish' }).catch(function () {});
  } catch (e) { /* 消息通道异常时靠本页兜底重载 */ }
  setTimeout(function () {
    try { window.close(); } catch (e) { /* 极少数内核限制,走兜底 */ }
  }, 500);
  setTimeout(function () {
    try { chrome.runtime.reload(); } catch (e) { /* 尽力而为 */ }
  }, 1200);
}

/* ============ 按钮与自动开跑 ============ */

/** 中断：只在下载阶段有效（写入阶段中断会把目录毁成半新半旧） */
function requestAbort() {
  if (running) {
    log('正在写入磁盘，不能中断 —— 写到一半会留下半新半旧的文件，反而更糟。', 'warn');
    return;
  }
  if (!pre.running) return;
  aborted = true;
  log('已请求中断，正在下载的文件完成后即停…', 'dim');
  $('btn-abort').disabled = true;
}

function renderRunButtons() {
  const btnRun = $('btn-run');
  const btnAbort = $('btn-abort');
  const btnGrant = $('btn-grant');

  // 授权按钮：有句柄但没权限时才出现（两种模式都要）
  btnGrant.hidden = !(dirHandle && !permOk);

  // ---- 回退模式：没有下载阶段，按钮只有一个「回退到 vX」 ----
  // 刻意不自动执行：回退会改写磁盘，必须由用户看到版本号后主动点。
  if (IS_ROLLBACK) {
    btnAbort.hidden = true;
    const ready = !!(rollbackPick && dirHandle && permOk) && !running;
    btnRun.hidden = !ready;
    if (ready) {
      btnRun.textContent = '回退到 v' + rollbackPick.fromVersion;
      btnRun.disabled = false;
    }
    return;
  }

  btnAbort.hidden = !pre.running;
  btnAbort.disabled = !pre.running;

  // 启动按钮只在两种情况下出现：
  //   1) 预载失败 → 「重试下载」
  //   2) 磁盘已经是目标版本 → 「开始覆盖」（强制重装）
  // 正常路径（预载完成 + 权限就绪）是全自动的，不显示启动按钮。
  if (running || pre.running) {
    btnRun.hidden = true;
    return;
  }
  if (pre.error) {
    btnRun.hidden = false;
    btnRun.textContent = '重试下载';
    btnRun.disabled = false;
    return;
  }
  const sameOnDisk = !!(pre.done && diskVersion
    && String(diskVersion) === String(targetVersion));
  if (sameOnDisk) {
    btnRun.hidden = false;
    btnRun.textContent = '开始覆盖';
    btnRun.disabled = false;
    return;
  }
  btnRun.hidden = true;
}

/**
 * 检查是否可以直接开跑。
 * 三个条件同时满足才自动写盘：预载完成、句柄有效、权限已授予。
 * 磁盘已是目标版本时**不自动覆盖**，交给用户点「开始覆盖」。
 */
function maybeAutoRun() {
  if (IS_ROLLBACK) return;   // 回退模式不自动跑 —— 改写磁盘必须由用户点一下确认
  if (running || aborted) return;
  if (!pre.done || !dirHandle || !permOk) return;

  if (diskVersion && String(diskVersion) === String(targetVersion)) {
    renderRunButtons();
    log('该目录里已经是 v' + diskVersion + '，无需重复覆盖。'
      + '若怀疑文件被改坏，可点「开始覆盖」强制重装。', 'dim');
    return;
  }
  runWrite();
}

/** 目录/权限状态变化后统一走这里：刷新按钮 + 尝试自动开跑 */
function afterDirChange() {
  renderRunButtons();
  maybeAutoRun();
}

function retryPrefetch() {
  pre.started = false;
  pre.running = false;
  pre.done = false;
  pre.error = null;
  pre.autoRetried = false;   // 用户手点重试 → 重新给一次自动重试机会
  pre.paths = [];
  pre.files = [];
  pre.totalCount = 0;
  pre.doneCount = 0;
  pre.totalBytes = 0;
  pre.loadedBytes = 0;
  aborted = false;
  logClear();
  paintBar(0);
  startPrefetch();
}

/* ============ 回退（把备份写回磁盘） ============ */

/**
 * 把一份备份写回磁盘 —— 回退模式与「更新失败自动回退」共用同一条链路。
 * 三步：写回文件 → 删掉新版本新增的多余文件 → 回读 manifest 校验版本号。
 * 校验不通过就抛错，由调用方决定怎么提示。
 */
async function restoreSnapshot(snap, label) {
  const byPath = validateSnapshot(snap);
  const files = Array.from(byPath.values());
  for (const f of files) {
    if (f.sha256) {
      const actual = await DYC_GITEE.sha256Hex(DYC_GITEE.base64ToBytes(f.b64));
      if (actual !== f.sha256) throw new Error('这份备份校验失败：' + f.path);
    }
  }

  const ordered = files.slice()
    .sort((a, b) => (a.path === 'manifest.json' ? 1 : 0) - (b.path === 'manifest.json' ? 1 : 0));
  const tag = label ? '[' + label + '] ' : '';
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    setProgress((i / files.length) * 0.9, tag + '恢复 ' + f.path);
    await withRetry(
      () => writeFile(dirHandle, f.path, DYC_GITEE.base64ToBytes(f.b64), () => { running = true; }),
      4, 300
    );
  }

  // 旧版快照没有逐文件哈希，无法证明枚举完整；可以写回，但不能据此删除额外文件。
  const canPrune = snap.format === 2;
  if (canPrune) {
    setProgress(0.92, tag + '清理新版本新增的文件…');
    await pruneExtraFiles(dirHandle, snap);
  }

  // 回读校验：Windows 上文件可能被短暂占用，写入返回成功不等于真的落盘
  setProgress(0.97, tag + '回读校验…');
  if (canPrune) {
    for (const f of files) {
      const parts = f.path.split('/');
      const name = parts.pop();
      let dir = dirHandle;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      const handle = await dir.getFileHandle(name);
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (await DYC_GITEE.sha256Hex(bytes) !== f.sha256) {
        throw new Error('恢复后的文件校验失败：' + f.path);
      }
    }
  } else {
    for (const file of files) {
      const parts = file.path.split('/');
      const name = parts.pop();
      let dir = dirHandle;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      const handle = await dir.getFileHandle(name);
      const actual = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (await DYC_GITEE.sha256Hex(actual) !== await DYC_GITEE.sha256Hex(DYC_GITEE.base64ToBytes(file.b64))) {
        throw new Error('旧备份恢复后的文件校验失败：' + file.path);
      }
    }
    log('旧备份已逐文件校验；保留目录中的额外文件。', 'dim');
  }
  const back = await readManifest(dirHandle);
  if (String(back.version) !== String(snap.fromVersion)) {
    throw new Error('回读到的版本号是 ' + back.version
      + '，与备份记录的 v' + snap.fromVersion + ' 不符');
  }
  return String(back.version);
}

/** 回退模式：把当前选中的那份备份写回磁盘 */
async function runRollback() {
  if (running || !rollbackPick) return;
  if (!dirHandle || !permOk) return;

  running = true;
  renderRunButtons();

  const snap = rollbackPick;
  try {
    log('开始回退到 v' + snap.fromVersion + '（' + snap.files.length + ' 个文件）…');
    const ver = await restoreSnapshot(snap, '');
    paintBar(1);
    log('回退完成：磁盘现在是 v' + ver, 'ok');
    log('正在重新加载扩展…本窗口即将自动关闭。', 'dim');
    finishAndClose();
  } catch (e) {
    running = false;
    renderRunButtons();
    paintBar(0);
    log('回退失败：' + errText(e), 'err');
  }
}

/* ============ 回退模式的界面 ============ */

function fmtTime(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/**
 * 渲染备份列表（单选，默认选最新的一份）。
 * 没有备份时给一句能照做的说明，而不是留一块空白。
 */
function renderBackupList() {
  const box = $('bak-list');
  if (!box) return;
  box.textContent = '';

  const hint = $('bak-hint');

  if (!rollbackList.length) {
    const empty = document.createElement('div');
    empty.className = 'bak-empty';
    empty.textContent = '本地没有可回退的备份。备份会在每次更新前自动生成；'
      + '如果你从未更新过，或清理过浏览器数据，就不会有备份。';
    box.appendChild(empty);
    if (hint) hint.textContent = '';
    return;
  }

  rollbackList.forEach((snap, i) => {
    const item = document.createElement('label');
    item.className = 'bak-item';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'bak';
    radio.value = String(i);
    radio.checked = (rollbackPick === snap);
    radio.addEventListener('change', () => {
      rollbackPick = snap;
      renderRunButtons();
    });

    const ver = document.createElement('span');
    ver.className = 'bak-ver';
    ver.textContent = 'v' + snap.fromVersion;

    const meta = document.createElement('span');
    meta.className = 'bak-meta';
    meta.textContent = fmtTime(snap.savedAt) + ' · '
      + snap.files.length + ' 个文件 · ' + fmtSize(snap.bytes);

    item.appendChild(radio);
    item.appendChild(ver);
    item.appendChild(meta);
    box.appendChild(item);
  });

  if (hint) {
    hint.textContent = '备份是「更新前那一刻」的完整扩展目录。'
      + '回退会把目录恢复成那时的样子（新版本新增的文件会被删掉）。';
  }
}

/* ============ 初始化 ============ */

/** 绑定目录相关的按钮（两种模式共用） */
function bindDirButtons() {
  $('btn-pick').addEventListener('click', pickDirectory);
  $('btn-grant').addEventListener('click', grantDirectory);
  // 防御:若页面被旧版缓存(:元素缺失)也不至于让整个更新页崩掉
  const btnCopy = $('btn-copy-dir');
  if (btnCopy) btnCopy.addEventListener('click', copyDefaultDir);
}

/** 内核不支持 File System Access 时的兜底（两种模式共用） */
function showUnsupported(isRollback) {
  $('block-backups').hidden = true;
  $('block-dir').hidden = true;
  $('block-run').hidden = true;
  $('block-unsupported').hidden = false;

  if (isRollback) {
    const t = document.querySelector('#block-unsupported .block-title');
    if (t) t.textContent = '本浏览器不支持扩展内自动回退';
    const body = document.querySelector('#block-unsupported .hint');
    if (body) {
      body.innerHTML = '当前内核没有提供 <code>showDirectoryPicker</code>，'
        + '扩展无法在浏览器内改写自己的文件。<br>'
        + '可改为手动回退：到项目标签页下载你要退回的那个版本的源码压缩包，'
        + '解压后覆盖到扩展所在目录（<b>必须是同一个目录</b>），'
        + '再回到扩展管理页点一次「重新加载」。';
    }
  }

  $('btn-tags').addEventListener('click', () => {
    chrome.tabs.create({ url: DYC_GITEE.TAGS_PAGE });
  });
}

/* ==================== 本版更新要点 ==================== */

/**
 * 从目标版本的仓库拉 RELEASE_NOTES.md，抽出「本版一句话」与要点条目，渲染到更新页。
 *
 * 为什么走 raw 通道读仓库里的文档，而不是往扩展本体里塞一份说明：
 *   · raw 与下载扩展本体是同一条通道（/raw/<tag>/…），不占 Gitee 接口额度、不需要新权限；
 *   · tag 指向的内容不可变，拉到的天然就是「那个版本当时的说明」，
 *     不像打进包里的文件只能反映上一个版本；
 *   · 商家目录里始终只有运行必需的文件，不掺文档（这条是用户的硬性要求）。
 *
 * 三条硬约束：
 *   ① 纯展示、可失败 —— 拉不到就整块不显示，不阻塞、不报错、不影响更新链路；
 *   ② 只取用户向内容 —— 「验证」小节及其后一律丢弃（那是开发者信息）；
 *   ③ 条数封顶 —— 超过 MAX_NEWS_ITEMS 的直接丢弃，要点必须一眼看完。
 */
const NEWS_FILE = 'RELEASE_NOTES.md';
const MAX_NEWS_ITEMS = 5;

/** 解析 RELEASE_NOTES.md → { summary, items[] }；解析不出内容时返回 null。 */
function parseNewsMd(text) {
  if (!text) return null;
  let summary = '';
  const items = [];
  // body = 正常收；verify = 「验证」整节丢弃；breaking = 「破坏性变更」节（「无」的不占要点）
  let mode = 'body';
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^##\s/.test(line)) {
      if (/^##\s*验证/.test(line)) mode = 'verify';
      else if (/^##\s*破坏性变更/.test(line)) mode = 'breaking';
      else mode = 'body';
      continue;
    }
    if (mode === 'verify') continue;
    if (!summary) {
      const m = line.match(/^\*\*本版一句话\*\*\s*[：:]\s*(.+)$/);
      if (m) { summary = m[1].trim(); continue; }
    }
    if (!/^[-*]\s+/.test(line)) continue;
    const t = line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (!t) continue;
    // 「破坏性变更」只有确有变更时才值得占一条要点，「无…」是噪音
    if (mode === 'breaking' && /^无/.test(t)) continue;
    items.push(t);
  }
  if (!summary && !items.length) return null;
  return { summary: summary, items: items.slice(0, MAX_NEWS_ITEMS) };
}

/** 渲染要点块。任何异常都吞掉 —— 它只是锦上添花，不能打扰用户。 */
async function renderWhatsNew() {
  try {
    if (!targetTag) return;
    // ★ 2026-11-01：原先直接 fetch(rawUrl(...))，Gitee 被封后恒 404 →
    //   更新页的「本版更新要点」永远空白。现改用 fetchRawFile（自带
    //   主源→备用源降级），返回字节后统一解码。
    const bytes = await DYC_GITEE.fetchRawFile(targetTag, NEWS_FILE);
    const news = parseNewsMd(new TextDecoder('utf-8').decode(
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    if (!news) return;

    if (news.summary) $('news-sum').textContent = news.summary;
    const ul = $('news-list');
    ul.innerHTML = '';
    for (const t of news.items) {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    }
    $('block-news').hidden = false;
  } catch (e) { /* 忽略：没有要点也能正常更新 */ }
}

async function init() {
  $('cur-ver').textContent = localVersion;

  // 回退模式与升级模式是两条独立的路，这里分开走
  if (IS_ROLLBACK) return initRollback();

  // 目标版本：优先取 URL 参数，其次读后台缓存的“发现的新版本”
  if (!targetTag || !targetVersion) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'dyc:getState' });
      const st = (res && res.state) || {};
      if (!targetVersion && st.latestVersion) targetVersion = st.latestVersion;
      if (!targetTag && st.latestTag) targetTag = st.latestTag;
      if (!targetTag && targetVersion) targetTag = DYC_GITEE.versionToTag(targetVersion);
    } catch (e) { /* 忽略 */ }
  }

  $('tgt-ver').textContent = targetVersion || '未知';
  $('tgt-tag').textContent = targetTag || '';

  // 要点块与更新流程无关，并行去拉即可，不 await（拉不到就不显示）
  renderWhatsNew();

  if (!FSA_OK) return showUnsupported(false);

  bindDirButtons();
  $('btn-abort').addEventListener('click', requestAbort);
  $('btn-rollback').addEventListener('click', () => {
    if (running) {
      log('当前写入尚未完成，无法切换到回退模式。', 'warn');
      return;
    }
    location.search = '?mode=rollback';
  });
  $('btn-run').addEventListener('click', () => {
    if (pre.error) { retryPrefetch(); return; }
    runWrite();   // 磁盘已是目标版本时的手动强制覆盖
  });

  if (!targetTag || !targetVersion) {
    logClear();
    log('没有待安装的版本。请回到扩展弹窗点「检查更新」。', 'err');
    return;
  }

  // 复用上次记住的目录句柄
  try {
    const saved = await kvGet(K_DIR);
    if (saved) dirHandle = saved;
  } catch (e) { /* 忽略 */ }

  // 本地有备份就在本页留一条快捷退路（常驻入口在弹窗，见 popup.js）
  try {
    const list = await DYC_BACKUP.list();
    if (list.length) {
      const btn = $('btn-rollback');
      btn.textContent = '回退到 v' + list[0].fromVersion;
      btn.hidden = false;
      $('foot').textContent = '本地存有 ' + list.length + ' 份备份（最新 v'
        + list[0].fromVersion + '）。需要回退时，到弹窗点「回退」即可。';
    }
  } catch (e) { /* 忽略 */ }

  // ★ 关键改动：先开跑下载（不需要权限），再查目录状态（可能需要用户点一下）。
  //   两者并行，用户去点授权的那几秒里，文件往往已经下完了。
  startPrefetch();
  await refreshDirUI();
}

/**
 * 回退模式的初始化：列备份 → 定位目录 → 用户点「回退到 vX」。
 * 与升级模式的区别：不下载、不自动执行 —— 改写磁盘必须由用户看着版本号点一下。
 */
async function initRollback() {
  document.title = '可可助手 · 版本回退';
  const h1 = document.querySelector('h1');
  if (h1) h1.textContent = '可可助手 · 版本回退';

  const metaTarget = $('meta-target');
  if (metaTarget) metaTarget.hidden = true;

  $('block-backups').hidden = false;
  const dirTitle = $('dir-title');
  if (dirTitle) dirTitle.textContent = '② 扩展目录';
  const runTitle = $('run-title');
  if (runTitle) runTitle.textContent = '③ 写回并重载';

  if (!FSA_OK) return showUnsupported(true);

  bindDirButtons();
  $('btn-run').addEventListener('click', runRollback);

  rollbackList = await DYC_BACKUP.list().catch(() => []);
  rollbackPick = rollbackList[0] || null;
  renderBackupList();

  if (!rollbackList.length) {
    log('本地没有可回退的备份，无法执行回退。', 'err');
    log('备份会在每次更新前自动生成；若你从未更新过，或清理过浏览器数据，就不会有备份。', 'dim');
    renderRunButtons();
    return;
  }

  try {
    const saved = await kvGet(K_DIR);
    if (saved) dirHandle = saved;
  } catch (e) { /* 忽略 */ }

  log('共 ' + rollbackList.length + ' 份备份，最新的是 v'
    + rollbackList[0].fromVersion, 'dim');
  await refreshDirUI();
}

init();

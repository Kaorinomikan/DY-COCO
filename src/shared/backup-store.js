/**
 * 抖音可可助手 · 本地状态库（弹窗与更新页共用）
 *
 * ── 为什么需要这个文件 ──
 * 备份（快照）原来写死在 src/update/update.js 里：只有一个键、只存一份，
 * 而且弹窗侧读不到 —— 于是「回退」这件事的入口只能挂在更新页上。
 * 一旦更新完成，更新页再也打不开（弹窗只在「发现新版本」时才给入口），
 * 用户就永远回不到上一版了（用户 2026-10-13 反馈）。
 *
 * 现在把存储抽出来共享：
 *   · 弹窗用它判断「本地有没有备份」，据此决定要不要显示「回退」入口；
 *   · 更新页用它写入 / 读取备份。
 * 两个页面同源（chrome-extension://<扩展ID>），共用同一个 IndexedDB。
 *
 * ── 为什么备份是「队列」而不是单条 ──
 * 用户要的是「随时能退回上一版」，但单条备份会被下一次更新覆盖。
 * 改成环形队列（最多 DYC_BACKUP.MAX 份），连着更新两次也还有退路。
 *
 * ── 兼容 ──
 * 老版本（≤26.10.13.4）在同一个键里存的是**单个对象**。
 * 读到对象就自动包装成数组，不丢用户已有的那份备份。
 *
 * ⚠️ 这里只负责「存」，不负责「什么时候备份、备份什么」——那些属于更新页。
 */

/* ============ kv 原语（IndexedDB，一个库一个对象仓） ============ */
const DYC_STORE = (function () {
  const DB_NAME = 'dyc-fs';
  const DB_VER = 1;
  const STORE = 'kv';

  /** 全部键名集中在这里，避免两处各写一遍字符串 */
  const KEY = {
    DIR: 'extDir',        // 扩展目录句柄（FileSystemDirectoryHandle）
    SNAP: 'snapshot',     // 备份队列
    LAST_RUN: 'lastRunAt' // 上次写入完成时间（温度门槛用）
  };

  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        _db = req.result;
        // 另一页面要升级版本时主动让路，避免把对方的事务卡死
        _db.onversionchange = () => {
          try { _db.close(); } catch (e) { /* 忽略 */ }
          _db = null;
        };
        resolve(_db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      let req;
      const t = db.transaction(STORE, mode);
      try {
        req = fn(t.objectStore(STORE));
      } catch (e) {
        reject(e);
        return;
      }
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const kvGet = (key) => tx('readonly', (s) => s.get(key));
  const kvSet = (key, val) => tx('readwrite', (s) => s.put(val, key));
  const kvDel = (key) => tx('readwrite', (s) => s.delete(key));

  return { DB_NAME, DB_VER, STORE, KEY, openDB, kvGet, kvSet, kvDel };
})();

/* ============ 备份队列（回退用） ============ */

/**
 * 一份备份 = 更新前整个扩展目录的内容（逐文件 base64，排除 .git）。
 * 结构：{ savedAt, fromVersion, bytes, files: [{ path, b64 }] }
 */
const DYC_BACKUP = (function () {
  /** 最多保留几份。3 份足够覆盖「连续更新两次还想退回最初」的场景，又不至于把配额吃光。 */
  const MAX = 3;

  /** 读出备份队列（新的在前）。老格式的单条对象会被自动包装成数组。 */
  async function list() {
    let raw = null;
    try {
      raw = await DYC_STORE.kvGet(DYC_STORE.KEY.SNAP);
    } catch (e) {
      return [];
    }
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.filter((s) => s && s.files && s.files.length);
  }

  /** 直接覆盖整条队列 */
  async function save(arr) {
    await DYC_STORE.kvSet(DYC_STORE.KEY.SNAP, arr);
    return arr;
  }

  /**
   * 压入一份新备份，返回新的队列。
   * 同一版本只保留最新的一份 —— 用户连点两次更新时不会留下两条重复备份。
   */
  async function push(snap) {
    const cur = await list();
    const rest = cur.filter((s) => String(s.fromVersion) !== String(snap.fromVersion));
    return save([snap].concat(rest).slice(0, MAX));
  }

  async function clear() {
    await DYC_STORE.kvDel(DYC_STORE.KEY.SNAP);
  }

  async function has() {
    return (await list()).length > 0;
  }

  return { MAX, list, save, push, clear, has };
})();

/* 端到端实测：按扩展真实链路下载当前版本的整份更新清单，逐文件校验 sha256 并计时。
 *
 * 用途：换链路（熔断 / 预热 / 超时下调）之后，必须证明「没把正常路径改坏」——
 *   既要快，也要每一个字节都对。
 *
 * 用法：node scripts/实测-更新链路耗时.js [样本数，0=全量]
 */
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

require(path.join(__dirname, '..', 'src/shared/gitee.js'));
const G = globalThis.DYC_GITEE;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'update-manifest.json'), 'utf8'));
const TAG = 'v' + MANIFEST.version;

const ms = (t) => (t < 1000 ? Math.round(t) + 'ms' : (t / 1000).toFixed(2) + 's');

(async () => {
  const N = Number(process.argv[2] || 0) || MANIFEST.files.length;
  const list = MANIFEST.files.slice(0, N);
  const totalBytes = list.reduce((s, e) => s + e.size, 0);

  console.log('目标 ' + TAG + ' · ' + list.length + ' 个文件 / ' + (totalBytes / 1024).toFixed(1) + ' KB');

  // 单测各通道
  const t0 = Date.now();
  if (process.env.DYC_FORCE_BACKUP) {
    // 模拟「主源整体不可用」：连续两次失败触发熔断，后续全部走备用源。
    // 这是本次修复的核心场景（修复前 78 个文件要各自白等一次主源超时）。
    G.noteMainSource(false);
    G.noteMainSource(false);
    console.log('已强制熔断主源，本次全部走备用源');
  }
  const idx = await G.warmUpCdn(TAG);
  console.log('预热 CDN：主机序号 ' + idx + ' · ' + ms(Date.now() - t0));

  const tTags = Date.now();
  const tags = await G.fetchTagList();
  console.log('标签列表：' + tags.length + ' 个版本 · ' + ms(Date.now() - tTags) + '（最新 ' + tags[0].tag + '）');

  const start = Date.now();
  let done = 0, cursor = 0;
  const bad = [];
  const slow = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      const e = list[i];
      const s = Date.now();
      try {
        const bytes = await G.fetchRawFile(TAG, e.path, e.size);
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        if (sha !== e.sha256) bad.push(e.path + ' sha 不符');
        else if (bytes.length !== e.size) bad.push(e.path + ' 长度不符');
      } catch (err) {
        bad.push(e.path + ' :: ' + err.message);
      }
      const cost = Date.now() - s;
      if (cost > 2000) slow.push(e.path + ' ' + ms(cost));
      done++;
    }
  }));
  const total = Date.now() - start;

  console.log('\n下载 ' + done + '/' + list.length + ' 个，合计 ' + ms(total)
    + '（平均 ' + ms(total / done) + '/个，并发 6）');
  console.log('状态：' + (bad.length ? '失败 ' + bad.length + ' 个' : '全部校验通过'));
  if (bad.length) bad.slice(0, 10).forEach((b) => console.log('  ✗ ' + b));
  if (slow.length) {
    console.log('慢于 2 秒的文件：');
    slow.slice(0, 10).forEach((s) => console.log('  ' + s));
  }
  console.log('健康状态：' + JSON.stringify(G.healthSnapshot()));
  if (bad.length) process.exitCode = 1;
  // undici 的连接池与 fetchT 留下的计时器会让进程不肯自然退出，
  // 显式收尾（先留 200ms 让 stdout 冲刷完）。
  setTimeout(() => process.exit(bad.length ? 1 : 0), 200);
})();

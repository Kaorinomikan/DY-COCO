#!/usr/bin/env node
'use strict';

// 只读检查。--gate 阻断菜单违规与更新说明结构缺陷；--base <提交> 只拦新增违规。
// 不判断功能是否实现、不替代人工核对；长度按 Unicode 字符计，含标点与空格。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const limits = Object.freeze({ label: 12, desc: 32, note: 24, help: 56, summary: 30, news: 48, items: 5 });
const len = (text) => Array.from(text || '').length;
const plain = (text) => text.replace(/\*\*|`/g, '').trim();

function helpStyle(value, add) {
  if (!value) return;
  if (!value.endsWith('。') || /[,;:!?()]/.test(value)) add('punctuation', '问号说明使用全角标点，并以句号收尾');
  if (/(页面滚动链|回读|原生框|DOM|histKey|Shadow DOM|querySelector)/.test(value)) add('engineering', '问号说明含内部术语，请改为用途或操作结果');
}

function isBlocking(issue) {
  return issue.file !== 'RELEASE_NOTES.md' || issue.structural;
}

function checkPopup(source) {
  const issues = [];
  // 子选项 tip 和直接传给问号的短句；变量提示由 flags.js 单独检查。
  source.split(/\r?\n/).forEach((line, i) => {
    const match = line.match(/\btip:\s*'([^']*)'/) || line.match(/^\s*attachHelpBadge\([^,]+,\s*'([^']*)'/);
    if (!match) return;
    const value = match[1];
    const add = (rule, message) => issues.push({ file: 'src/popup/popup.js', id: 'help-' + (i + 1), field: 'tip', rule, message, value });
    if (len(value) > limits.help) add('length', '子菜单问号超过 ' + limits.help + ' 字');
    helpStyle(value, add);
  });
  return { issues };
}

function checkFlags(source) {
  const context = vm.createContext({});
  vm.runInContext(source, context, { timeout: 1000, filename: 'flags.js' });
  if (!Array.isArray(context.DYC_FLAGS_META)) throw new Error('未读取到开关元数据');
  const issues = [];
  const rows = context.DYC_FLAGS_META.filter((m) => m.key && !m.hidden);
  const seen = new Set();
  function add(m, field, rule, message, value) {
    issues.push({ file: 'src/content/flags.js', id: m.key, field, rule, message, value: value || '' });
  }
  rows.forEach((m) => {
    if (seen.has(m.key)) add(m, 'key', 'duplicate-key', '开关键名重复', m.key);
    seen.add(m.key);
    ['label', 'desc', 'note'].forEach((field) => {
      const value = m[field] || '';
      if (typeof value !== 'string') throw new Error(m.key + '.' + field + ' 必须是字符串');
      if ((field === 'label' || field === 'desc') && !value.trim()) add(m, field, 'required', '缺少功能名或作用说明', value);
      if (len(value) > limits[field]) add(m, field, 'length', len(value) + ' 字，超过 ' + limits[field] + ' 字', value);
      if (field !== 'label') helpStyle(value, (rule, message) => add(m, field, rule, message, value));
      if (/[\r\n]/.test(value)) add(m, field, 'multiline', '短提示含换行，应拆到说明面板', value);
      if (/(绝不|永远不会|不会出错|不是出错|保证成功|全场景)/.test(value)) add(m, field, 'absolute', '包含无条件保证或把异常直接判为正常的措辞', value);
    });
    if (len(m.desc) + len(m.note) > limits.help) add(m, 'help', 'combined-length', '问号合计 ' + (len(m.desc) + len(m.note)) + ' 字，超过 ' + limits.help + ' 字', (m.desc || '') + (m.note || ''));
    if ((m.pages || []).some((k) => !context.DYC_PAGE_PATTERNS[k])) add(m, 'pages', 'unknown-page', '作用页未登记', JSON.stringify(m.pages));
  });
  return { issues, stats: { switches: rows.length, overlongHelp: rows.filter((m) => len(m.desc) + len(m.note) > limits.help).length, longestHelp: Math.max(0, ...rows.map((m) => len(m.desc) + len(m.note))) } };
}

/* ★ 只解析最顶上的第一个版本段（2026-11-02）。
 * 理由：商家更新页展示的就是这一段 —— src/update/update.js 的
 * parseNewsMd「本版一句话」只认第一个、要点按文件顺序取前几条；
 * 历史版本的要点是已随包发出的存档，跨版本累计计数没有意义
 * （实测把 26.11.01.3 的 10 条 + 26.11.01.2 的 4 条凑成 14 条，
 * 连历史文案里的词也一起误报，把发布卡死）。 */
function parseTopNews(source) {
  /* 没有 `# 版本号` 标题行时不能把整份说明丢掉（2026-11-05 修）：
   * 原实现无条件取 split(/^# /m)[1]，返回 undefined → topSection 空串 →
   * 「缺少本版一句话」+「要点 0 条」两条误报。此前无人发现，是因为
   * `--self-test` 没接进自测流程（它的样本恰好就是没有标题行的形态）。 */
  const parts = String(source).split(/^# /m);
  const topSection = parts.length > 1 ? '# ' + parts[1] : parts[0];
  const scoped = topSection;
  const summary = scoped.match(/^\*\*本版一句话\*\*\s*[:：]\s*(.+)$/m);
  let section = '';
  const items = [];
  scoped.split(/\r?\n/).forEach((line) => {
    if (/^## /.test(line)) section = line.slice(3).trim();
    if (!/^- /.test(line) || /^(验证|破坏性变更)/.test(section)) return;
    items.push(plain(line.slice(2)));
  });
  return { scoped, summary: summary ? summary[1] : '', items };
}

function checkNews(source) {
  const issues = [];
  /* structural = 更新页会因此显示异常（空白、没有要点），必须拦住发布。
   * 其余一律是「措辞问题」：由 --autofix 自动整理或降级为警告，
   * **不阻断发布**（用户 2026-11-05：文案由助手自己改，不能让发布中断）。 */
  function add(id, rule, message, value, structural) {
    issues.push({ file: 'RELEASE_NOTES.md', id, field: 'news', rule, message, value, structural: !!structural });
  }
  const parsed = parseTopNews(source);
  const { scoped, summary, items } = parsed;
  if (!summary) add('summary', 'required', '缺少本版一句话', '', true);
  else if (len(plain(summary)) > limits.summary) add('summary', 'length', '本版一句话超过 ' + limits.summary + ' 字', summary);
  items.forEach((value, i) => {
    const id = 'item-' + (i + 1);
    if (len(value) > limits.news) add(id, 'length', '更新要点 ' + len(value) + ' 字，超过 ' + limits.news + ' 字', value);
    if (/(histKey|Shadow DOM|querySelector|setStatus|sha256|断言|兜底|闸门|提交[号:]?\s*[0-9a-f]{7,40}\b)/i.test(value)) add(id, 'engineering', '更新要点混入实现细节，请移入开发日志', value);
  });
  if (items.length < 1) add('items', 'count-zero', '更新要点 0 条，更新页会只剩一句话', '0', true);
  else if (items.length > limits.items) add('items', 'count-over', '更新要点 ' + items.length + ' 条，超过 ' + limits.items + ' 条（超出的不会显示）', String(items.length));
  const summaryKeys = items.map((s) => s.replace(/^(新增|改进|修复)\s*[·:：]\s*/, '').split(/[·:：]/)[0].trim());
  summaryKeys.forEach((key, i) => {
    if (key && summaryKeys.indexOf(key) !== i) add('item-' + (i + 1), 'duplicate-feature', '同一功能拆为多条，请合并', items[i]);
  });
  if (/扩展管理页.{0,12}检查更新/.test(source)) add('update-path', 'wrong-entry', '检查更新入口在扩展图标弹窗，不能写成浏览器扩展管理页', '扩展管理页 → 检查更新');
  return { issues, stats: { newsItems: items.length } };
}

/* ==================== 发布基线校验（2026-11-05） ====================
 * 用户口径：更新日志 = 「上一个已发布版 → 本版」的净差异。同一能力在本
 * 发布周期内断断续续改了多轮，客户只是第一次见到它，不能把返工写成要点。
 *
 * 为什么必须靠 git 基线而不是靠记性：
 *   待推送栏记的是「开发动作」（改一次一条），更新说明写给客户看的是
 *   「状态差异」。两者之间没有任何自动联系，靠人脑转换必然漏 ——
 *   实测已经出现过「26.11.02.1 新增浮层让位开关 → 26.11.03.1 写撤销该
 *   开关」，客户刚设过的选项隔天消失。
 *
 * 四条规则（锚点只用开关 key / 能力词 / 源文件名，不做中文语义理解）：
 *   R1 本周期新增的能力，要点里却用「修复/优化/调整/不再」等返工动词
 *      → 客户上一版没见过它，不存在「修好」的前提。阻断。
 *   R2 同一版块里，同一能力既写成「新增」又写成「修复」
 *      → 多轮调整还没合并成终态描述。阻断。
 *   R3 要点提到的能力，对应源文件在「基线..HEAD」之间一动没动
 *      → 写的是本版根本没动的东西（旧料重抄或功能词对错了）。阻断。
 *   R4 要点里出现「再次 / 仍然 / 依然」等叙述自己上轮修改的词
 *      → 那是写给自己的，不是写给客户的。只提示。
 *
 * 覆盖边界：能力词表在 scripts/changelog-entities.json，对不上词表的要点
 * 不会被静默放过 —— 列进「未覆盖」清单显式打印，交人工核对。宁可漏报
 * 也不要误报把正常发布卡死。
 */

/** 返工类动词：表示「这个东西以前就有，这次把它改对了」。 */
const REWORK_RE = /(修复|修好|修正|优化|调整|改进|改成|改为|不再|撤销|撤回|补上|补回|纠正|精简)/;
/** 首现类动词：表示「这个东西本版才有」。 */
const FRESH_RE = /(新增|新加|新上线|首次)/;
/** 叙述自己上轮修改的词。 */
const SELF_NARRATION_RE = /(再次|仍然|依然|又一次|这回又)/;

/** 从 flags.js 源码里取开关 key 集合（正则，不用 vm —— base 版本可能依赖当时的全局变量）。 */
function flagKeys(source) {
  const keys = new Set();
  String(source).replace(/\bkey:\s*'([^']+)'/g, (m, k) => { keys.add(k); return m; });
  return keys;
}

/** 一条要点命中的能力组（可能多组；按词长降序，长词优先归属）。 */
function hitGroups(text, groups) {
  return groups.filter((g) => (g.words || []).some((w) => w && text.includes(w)));
}

/** 要点里用「」/“” 括起来的专有能力名 —— 这是「具体到子能力」的最强特征。 */
function quotedEntities(text) {
  const out = [];
  String(text).replace(/[「『“]([^」』”]{2,})[」』”]/g, (m, inner) => { out.push(inner); return m; });
  return out;
}

/** 最长公共连续子串长度。用于判断两条要点是不是在讲同一个具体能力。 */
function longestCommonRun(a, b) {
  const s1 = String(a), s2 = String(b);
  let best = 0;
  const prev = new Array(s2.length + 1).fill(0);
  for (let i = 1; i <= s1.length; i++) {
    let diag = 0;
    for (let j = 1; j <= s2.length; j++) {
      const tmp = prev[j];
      if (s1[i - 1] === s2[j - 1]) { prev[j] = diag + 1; if (prev[j] > best) best = prev[j]; }
      else prev[j] = 0;
      diag = tmp;
    }
  }
  return best;
}

/** 两条要点是否在讲同一个具体能力：共享带引号的能力名，或有 ≥4 字连续重合。 */
function sameSpecificThing(a, b) {
  const qa = quotedEntities(a), qb = quotedEntities(b);
  if (qa.some((x) => qb.includes(x))) return true;
  return longestCommonRun(a, b) >= 4;
}

/**
 * 取发布基线的三样数据：上一个 tag 的开关 key、本版改过的文件、能力词表。
 * 任何一样取不到就返回 null —— 调用方据此跳过校验（只可能是首个版本或
 * 浅克隆，不该因此卡死发布）。
 */
function loadBaseline(read, base) {
  if (!base) return null;
  const git = process.env.DYC_GIT || 'git';
  const run = (cmdArgs) => cp.execFileSync(git, cmdArgs, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  let commit = '';
  let baseFlags = '';
  try {
    commit = run(['rev-parse', '--verify', base + '^{commit}']).trim();
    baseFlags = run(['show', commit + ':src/content/flags.js']);
  } catch (e) { return null; }
  const changed = new Set();
  try {
    run(['diff', '--name-only', commit + '..HEAD']).split(/\r?\n/).forEach((f) => { if (f.trim()) changed.add(f.trim()); });
  } catch (e) { return null; }
  let entities = [];
  try { entities = JSON.parse(read('scripts/changelog-entities.json')).groups || []; } catch (e) { entities = []; }
  return { commit, changed, entities, baseKeys: flagKeys(baseFlags), headKeys: flagKeys(read('src/content/flags.js')) };
}

function checkNewsBaseline(source, baseline) {
  const issues = [];
  if (!baseline) return { issues, stats: { baseline: null } };
  function add(id, rule, message, value) {
    /* structural:false —— 基线问题属于「文案怎么写」，由 --autofix 自动整理
     * 或降级为警告，不阻断发布（用户 2026-11-05）。 */
    issues.push({ file: 'RELEASE_NOTES.md', id, field: 'news', rule, message, value, structural: false });
  }
  const { items } = parseTopNews(source);
  const groups = baseline.entities || [];
  const newFlags = new Set([...baseline.headKeys].filter((k) => !baseline.baseKeys.has(k)));
  const uncovered = [];
  const meta = items.map((text) => ({ text, hits: hitGroups(text, groups) }));

  meta.forEach((row, i) => {
    const id = 'item-' + (i + 1);
    if (!row.hits.length) { uncovered.push(row.text); return; }

    // R1：本周期新增的能力，却用返工动词描述
    if (REWORK_RE.test(row.text)) {
      const fresh = row.hits.filter((g) => (g.flags || []).some((f) => newFlags.has(f)));
      if (fresh.length) {
        add(id, 'baseline-new-as-fix',
          '「' + fresh.map((g) => g.name).join('、') + '」是本版新增的能力（上一发布版里没有），却写成修复/优化，' +
          '客户上一版从没见过它；请改成它现在的样子', row.text);
      }
    }

    // R3：写的是本版根本没动过的东西
    if (baseline.changed.size) {
      const touched = row.hits.some((g) => (g.files || []).some((f) => baseline.changed.has(f)));
      if (!touched) {
        add(id, 'baseline-untouched',
          '「' + row.hits.map((g) => g.name).join('、') + '」对应的源文件在本版一处未改，' +
          '这条要点写的是本版没有发生的变化', row.text);
      }
    }

    // R4：叙述自己上轮修改
    if (SELF_NARRATION_RE.test(row.text)) {
      add(id, 'baseline-self-narration', '含「' + row.text.match(SELF_NARRATION_RE)[0] + '」，这是对上一轮修改的叙述，请改成终态描述', row.text);
    }
  });

  // R2：同一具体能力既新增又修复（两条要点之间）
  // 判据是「共享带引号的能力名」或「≥4 字连续重合」——
  // 不能只看能力组：实测「福袋面板新增「发福袋间隔」滑条」与
  // 「常驻开销精简：福袋抽屉识别加缓存」同属福袋组，却是两件事，
  // 按组判会把正常发布卡死。
  for (let i = 0; i < meta.length; i++) {
    for (let j = i + 1; j < meta.length; j++) {
      const a = meta[i], b = meta[j];
      if (!sameSpecificThing(a.text, b.text)) continue;
      const freshFirst = FRESH_RE.test(a.text) && REWORK_RE.test(b.text);
      const freshSecond = FRESH_RE.test(b.text) && REWORK_RE.test(a.text);
      if (freshFirst || freshSecond) {
        add('item-' + (freshSecond ? i + 1 : j + 1), 'baseline-split',
          '与 item-' + (freshSecond ? j + 1 : i + 1) + ' 讲的是同一个具体能力：一条写新增、一条写修复/优化；' +
          '本发布周期内的多轮调整请合并成一条终态描述', freshSecond ? a.text : b.text);
      }
    }
  }

  return {
    issues,
    stats: { baseline: baseline.commit.slice(0, 7), changedFiles: baseline.changed.size, newFlags: newFlags.size, uncovered },
  };
}

function signature(i) { return JSON.stringify([i.file, i.id, i.field, i.rule, i.value]); }

/* ==================== 发布前自动整理 ====================
 * 用户 2026-11-05：文案的写法由助手自己修，不能让发布因为文案中断。
 *
 * 这里只做**能安全判定对错**的删除，不代写句子 —— 机器改写中文产品文案的
 * 产出质量不可控，而这段文字是给商家看的门面，不能用病句换「通过」。
 *
 * 自动处理：
 *   · 基线违规条目（R1–R4）—— 删掉。它们本就是「不该出现在这一版」的东西：
 *     要么在讲本版才有的功能却写着修复，要么在讲本版根本没动的东西。
 *   · 同一功能拆成多条（duplicate-feature）—— 删后出现的那条。
 *   · 要点超过 5 条 —— 截到前 5 条（第 6 条起更新页本来也不显示）。
 * 硬约束：一律保留至少 1 条 —— 全删光等于把更新页弄成空白，比留着更糟。
 * 处理不了的问题（超长、实现细节泄漏）保留原文，只报不删。
 */
function autofixNews(source, allIssues) {
  const nl = String(source).includes('\r\n') ? '\r\n' : '\n';
  const lines = String(source).split(nl);
  const start = lines.findIndex((line) => /^# /.test(line));
  if (start < 0) return { text: source, changes: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^# /.test(lines[i])) { end = i; break; } }

  // 第一段「本版要点」里的要点行，顺序与 parseTopNews 的 items 一一对应
  let inItems = false;
  const itemAt = [];
  for (let i = start + 1; i < end; i++) {
    if (/^## /.test(lines[i])) { inItems = /要点/.test(lines[i]); continue; }
    if (inItems && /^- /.test(lines[i])) itemAt.push(i);
  }
  if (!itemAt.length) return { text: source, changes: [] };

  const drop = new Set();
  const rewrite = new Set();
  (allIssues || []).forEach((issue) => {
    const m = /^item-(\d+)$/.exec(issue.id);
    if (!m) return;
    const n = Number(m[1]);
    if (n < 1 || n > itemAt.length) return;
    /* R1（本周期新能力写成修复）**不删**（2026-11-05 用户口径）：
     * 「新功能就描述它做什么，作为一个发布点」—— 这条往往就是本版这个功能
     * 唯一的描述，删了等于让商家根本不知道多了什么，比写得不好更糟。
     * 所以保留原文，只在下一次整理时提示改写成功能描述。 */
    if (issue.rule === 'baseline-new-as-fix') { rewrite.add(n); return; }
    if (issue.rule.startsWith('baseline-') || issue.rule === 'duplicate-feature') drop.add(n);
  });
  for (let n = limits.items + 1; n <= itemAt.length; n++) drop.add(n);
  // 已经要删的就不必再提示改写
  [...rewrite].forEach((n) => { if (drop.has(n)) rewrite.delete(n); });
  // 至少留一条：按序号从小到大依次放回，直到还剩 1 条
  for (const n of [...drop].sort((a, b) => a - b)) {
    if (itemAt.length - drop.size >= 1) break;
    drop.delete(n);
  }
  const rewrites = [...rewrite].sort((a, b) => a - b)
    .map((n) => '建议改写成功能描述（原文保留未动）：' + plain(lines[itemAt[n - 1]].slice(2)));
  if (!drop.size) return { text: source, changes: [], rewrites };

  const removed = new Set([...drop].map((n) => itemAt[n - 1]));
  const changes = [...drop].sort((a, b) => a - b).map((n) => '删除要点：' + plain(lines[itemAt[n - 1]].slice(2)));
  const text = lines.filter((_, i) => !removed.has(i)).join(nl);
  return { text, changes, rewrites };
}

function collect(read, baseline) {
  const flags = checkFlags(read('src/content/flags.js'));
  const popup = checkPopup(read('src/popup/popup.js'));
  const notes = read('RELEASE_NOTES.md');
  const news = checkNews(notes);
  const base = checkNewsBaseline(notes, baseline);
  return { issues: flags.issues.concat(popup.issues, news.issues, base.issues), stats: { ...flags.stats, ...news.stats, ...base.stats } };
}

function selfTest() {
  const sample = 'var DYC_PAGE_PATTERNS={live:/x/};var DYC_FLAGS_META=[{key:"a",label:"商品定位",desc:"输入序号，滚到对应商品。",default:true,pages:["live"]}];';
  assert.equal(checkFlags(sample).issues.length, 0);
  assert(checkFlags(sample.replace('输入序号，滚到对应商品。', '长'.repeat(57))).issues.some((i) => i.rule === 'combined-length'));
  assert(checkFlags(sample.replace('输入序号，滚到对应商品。', '保证成功')).issues.some((i) => i.rule === 'absolute'));
  assert.equal(checkNews('**本版一句话**：改善商品定位。\n## 本版要点\n- 修复商品定位后高亮不显示的问题\n## 破坏性变更\n- 无。').issues.length, 0);
  assert(checkNews('**本版一句话**：改善商品定位。\n## 本版要点\n- **定位 · 速度**：更快\n- **定位 · 稳定**：更稳').issues.some((i) => i.rule === 'duplicate-feature'));
  assert(checkNews('**本版一句话**：改善定位。\n## 本版要点\n- 改用 histKey\n扩展管理页点检查更新').issues.some((i) => i.rule === 'wrong-entry'));
  const previous = { file: 'a', id: 'a', field: 'desc', rule: 'length', value: '甲' };
  const edited = { ...previous, value: '乙' };
  const baseline = new Set([signature(previous)]);
  assert.equal([previous, edited].filter((issue) => !baseline.has(signature(issue))).length, 1);

  /* ---------- 发布基线校验（2026-11-05） ---------- */
  const newsDoc = (items) => '# 可可助手 26.11.05.1\n\n**本版一句话**：样本。\n\n## 本版要点\n' + items.map((t) => '- ' + t).join('\n') + '\n';
  const bl = {
    commit: 'abcdef1',
    changed: new Set(['src/live/lucky-bag.js']),
    entities: [
      { name: '福袋', words: ['福袋'], files: ['src/live/lucky-bag.js'], flags: ['luckyBag'] },
      { name: '库存', words: ['库存'], files: ['src/content/clear-stock.js'], flags: ['clearStock'] },
    ],
    baseKeys: new Set(['clearStock']),
    headKeys: new Set(['clearStock', 'luckyBag']),
  };
  const rules = (doc) => checkNewsBaseline(doc, bl).issues.map((i) => i.rule);
  // R1：本周期新增的能力（luckyBag）被写成「修好」
  assert(rules(newsDoc(['修好福袋间隔滑条重启后不保存的问题'])).includes('baseline-new-as-fix'));
  // R3：要点提到的库存，本版源文件一处未改
  assert(rules(newsDoc(['商品库存清零按钮更好找'])).includes('baseline-untouched'));
  // R2：同一具体能力一条写新增、一条写修复
  assert(rules(newsDoc(['福袋面板新增「发福袋间隔」滑条', '修好发福袋间隔重启后不保存的问题'])).includes('baseline-split'));
  // R4：叙述自己上轮修改
  assert(rules(newsDoc(['福袋再次支持按间隔连发'])).includes('baseline-self-narration'));
  // 正常终态描述：一条都不报
  assert.equal(rules(newsDoc(['福袋面板可设发送间隔，按间隔自动发下一轮。'])).length, 0);
  // 不能把「同属福袋组但不同事」的两条判成矛盾（实测误报）
  assert(!rules(newsDoc(['福袋面板新增「发福袋间隔」滑条', '福袋抽屉打开更快'])).includes('baseline-split'));
  // 对不上能力词表的要点进未覆盖清单，不阻断
  const uncovered = checkNewsBaseline(newsDoc(['店铺名称完整显示']), bl);
  assert.equal(uncovered.issues.length, 0);
  assert.equal(uncovered.stats.uncovered.length, 1);
  // 没有基线时整体跳过
  assert.equal(checkNewsBaseline(newsDoc(['修好福袋间隔滑条不保存']), null).issues.length, 0);

  /* ---------- 发布前自动整理（2026-11-05） ---------- */
  // 同能力「一条新增 + 一条修复」：删掉修复那条，保留功能描述
  const dirty = newsDoc(['福袋面板新增「发福袋间隔」滑条', '修好发福袋间隔重启后不保存的问题']);
  const fixed = autofixNews(dirty, checkNewsBaseline(dirty, bl).issues);
  assert.equal(fixed.changes.length, 1);
  assert(!/修好发福袋间隔/.test(fixed.text), '重复的修复条应被删掉');
  assert(/发福袋间隔」滑条/.test(fixed.text), '功能描述应保留');
  // 只有 R1（本版新能力写成修复）：**不删**，只提示改写成功能描述
  // —— 删了商家就不知道这版多了什么，比写得不好更糟
  const onlyR1 = newsDoc(['修好福袋间隔滑条重启后不保存的问题']);
  const r1fix = autofixNews(onlyR1, checkNewsBaseline(onlyR1, bl).issues);
  assert.equal(r1fix.changes.length, 0, 'R1 不该删条');
  assert.equal(r1fix.rewrites.length, 1, 'R1 应给出改写提示');
  // 全版都违规也不会删空
  const allBad = newsDoc(['修好福袋间隔滑条重启后不保存的问题']);
  assert.equal(autofixNews(allBad, checkNewsBaseline(allBad, bl).issues).changes.length, 0);
  // 超过 5 条截到 5 条
  const six = newsDoc(['功能甲：第一项', '功能乙：第二项', '功能丙：第三项', '功能丁：第四项', '功能戊：第五项', '功能己：第六项']);
  assert.equal((autofixNews(six, []).text.match(/^- /gm) || []).length, limits.items);
  // 结构性（更新页会空白）才阻断；措辞类只警告
  assert(checkNews('# 标题\n\n## 本版要点\n\n- 某功能可用。\n').issues.some((i) => i.structural), '缺一句话应算结构性');
  assert(!checkNews(newsDoc(['某功能可用。'])).issues.some((i) => i.structural), '正常说明不该有结构性问题');

  assert(checkFlags(sample.replace('输入序号，滚到对应商品。', '输入序号,定位商品')).issues.some((i) => i.rule === 'punctuation'));
  assert(checkFlags(sample.replace('输入序号，滚到对应商品。', '回读原生框。')).issues.some((i) => i.rule === 'engineering'));
  assert.equal(checkPopup("  { tip: '扫描时遮住商品列表。' },").issues.length, 0);
  assert(checkPopup("  { tip: '" + '字'.repeat(57) + "。' },").issues.some((i) => i.rule === 'length'));
  assert(checkPopup("  attachHelpBadge(row, '读取 DOM。');").issues.some((i) => i.rule === 'engineering'));
  assert(checkPopup("  { tip: '扫描,列表' },").issues.some((i) => i.rule === 'punctuation'));
  assert(isBlocking({file: 'src/content/flags.js', rule: 'length'}));
  assert(isBlocking({file: 'src/popup/popup.js', rule: 'punctuation'}));
  assert(!isBlocking({file: 'RELEASE_NOTES.md', rule: 'length'}));
  assert(isBlocking({file: 'RELEASE_NOTES.md', structural: true}));
  console.log('文案检查器自测：菜单标点、术语、子菜单长度及阻断分级通过；原 21 组通过（短句、超长、绝对保证、更新结构、同功能重复、入口错误、存量差异、基线 R1/R2/R3/R4、正常终态、误报护栏、未覆盖、无基线跳过、自动整理删重复条、R1 只提示不删、全违规不删空、截断到 5 条、结构性分级）。');
}

try {
  if (args.includes('--self-test')) { selfTest(); process.exit(0); }
  const allowed = new Set(['--gate', '--json', '--base', '--autofix']);
  let base = null;
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('未知参数：' + args[i]);
    if (args[i] === '--base') { base = args[++i]; if (!base || base.startsWith('-')) throw new Error('--base 缺少提交'); }
  }
  const readHead = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const baseline = base ? loadBaseline(readHead, base) : null;
  if (base && !baseline) console.log('[提示] 取不到发布基线 ' + base + '，本轮跳过基线校验（只可能是首个版本或浅克隆）。');
  let result = collect(readHead, baseline);

  // 发布前自动整理：只在明确要求时改文件，平时保持只读
  if (args.includes('--autofix')) {
    const fix = autofixNews(readHead('RELEASE_NOTES.md'), result.issues);
    if (fix.rewrites && fix.rewrites.length) {
      console.log('[待改写] 这些要点讲的是「本版新增的能力」，却用了修复口吻 —— 原文保留不动');
      console.log('         （删了商家就不知道这版多了什么），请改成它现在能做什么：');
      fix.rewrites.forEach((c) => console.log('  · ' + c));
    }
    if (fix.changes.length) {
      fs.writeFileSync(path.join(root, 'RELEASE_NOTES.md'), fix.text, 'utf8');
      console.log('[自动整理] RELEASE_NOTES.md 处理 ' + fix.changes.length + ' 处（未改写句子，只删不该出现在本版的条目）：');
      fix.changes.forEach((c) => console.log('  · ' + c));
      result = collect(readHead, baseline);
    } else if (!fix.rewrites || !fix.rewrites.length) {
      console.log('[自动整理] 没有可安全自动处理的条目（超长、实现细节这类需要人工改写，不阻断发布）。');
    }
  }

  let previous = new Set();
  if (base) {
    const git = process.env.DYC_GIT || 'git';
    const commit = cp.execFileSync(git, ['rev-parse', '--verify', base + '^{commit}'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const old = collect((f) => cp.execFileSync(git, ['show', commit + ':' + f], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }), null);
    previous = new Set(old.issues.map(signature));
  }
  result.issues.forEach((i) => { i.existing = base ? previous.has(signature(i)) : false; });
  /* 菜单违规必须改正；更新说明只有缺少一句话、要点 0 条等结构缺陷阻断。
   * 更新说明措辞类（长度、实现细节、基线、重复）一律降为警告（用户 2026-11-05：
   * 文案的写法由助手自己改，不能因为文案让发布中断）。 */
  result.blocking = result.issues.filter((i) => !i.existing && isBlocking(i)).length;
  result.notes = result.issues.filter((i) => !i.existing && !isBlocking(i)).length;
  result.base = base;
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('文案检查：' + result.stats.switches + ' 个开关；问号超过 ' + limits.help + ' 字 ' + result.stats.overlongHelp + ' 项；最长 ' + result.stats.longestHelp + ' 字；更新要点 ' + result.stats.newsItems + ' 条。');
    if (result.stats.baseline) {
      console.log('发布基线 ' + result.stats.baseline + '：本版改动 ' + result.stats.changedFiles + ' 个文件，新增开关 ' + result.stats.newFlags + ' 个。');
      const uncovered = result.stats.uncovered || [];
      if (uncovered.length) {
        console.log('未覆盖（要点对不上能力词表，基线校验管不到，请人工确认）：' + uncovered.length + ' 条');
        uncovered.forEach((t) => console.log('  · ' + t));
      }
    }
    result.issues.forEach((i) => {
      const tag = i.existing ? '[存量]' : (isBlocking(i) ? '[阻断]' : '[警告]');
      console.log(tag + ' ' + i.file + ' / ' + i.id + '.' + i.field + '：' + i.message);
    });
    console.log('共 ' + result.issues.length + ' 项规则命中；阻断 ' + result.blocking + ' 项（菜单或结构性），警告 ' + result.notes + ' 项（措辞类，不拦发布）。');
    console.log('边界：不判断语义正确、功能承诺与实机行为，仍须逐项人工核对。');
  }
  if (args.includes('--gate') && result.blocking) process.exitCode = 1;
} catch (error) {
  console.error('文案检查失败：' + error.message);
  process.exitCode = 2;
}

#!/usr/bin/env node
'use strict';

// 只读检查。默认列全部存量；--gate 阻断；--base <提交> 只阻断相对该提交新增的违规。
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
      if (/[\r\n]/.test(value)) add(m, field, 'multiline', '短提示含换行，应拆到说明面板', value);
      if (/(绝不|永远不会|不会出错|不是出错|保证成功|全场景)/.test(value)) add(m, field, 'absolute', '包含无条件保证或把异常直接判为正常的措辞', value);
    });
    if (len(m.desc) + len(m.note) > limits.help) add(m, 'help', 'combined-length', '问号合计 ' + (len(m.desc) + len(m.note)) + ' 字，超过 ' + limits.help + ' 字', (m.desc || '') + (m.note || ''));
    if ((m.pages || []).some((k) => !context.DYC_PAGE_PATTERNS[k])) add(m, 'pages', 'unknown-page', '作用页未登记', JSON.stringify(m.pages));
  });
  return { issues, stats: { switches: rows.length, overlongHelp: rows.filter((m) => len(m.desc) + len(m.note) > limits.help).length, longestHelp: Math.max(0, ...rows.map((m) => len(m.desc) + len(m.note))) } };
}

function checkNews(source) {
  const issues = [];
  function add(id, rule, message, value) { issues.push({ file: 'RELEASE_NOTES.md', id, field: 'news', rule, message, value }); }
  /* ★ 只检查最顶上的第一个版本段（2026-11-02）。
   * 理由：商家更新页展示的就是这一段 —— src/update/update.js 的
   * parseNewsMd「本版一句话」只认第一个、要点按文件顺序取前几条；
   * 历史版本的要点是已随包发出的存档，跨版本累计计数没有意义
   * （实测把 26.11.01.3 的 10 条 + 26.11.01.2 的 4 条凑成 14 条，
   * 连历史文案里的词也一起误报，把发布卡死）。 */
  const topSection = String(source).split(/^# /m)[1] || '';
  const scoped = '# ' + topSection;
  const summary = scoped.match(/^\*\*本版一句话\*\*\s*[:：]\s*(.+)$/m);
  if (!summary) add('summary', 'required', '缺少本版一句话', '');
  else if (len(plain(summary[1])) > limits.summary) add('summary', 'length', '本版一句话超过 ' + limits.summary + ' 字', summary[1]);
  let section = '', items = [];
  scoped.split(/\r?\n/).forEach((line) => {
    if (/^## /.test(line)) section = line.slice(3).trim();
    if (!/^- /.test(line) || /^(验证|破坏性变更)/.test(section)) return;
    const value = plain(line.slice(2));
    items.push(value);
    const id = 'item-' + items.length;
    if (len(value) > limits.news) add(id, 'length', '更新要点 ' + len(value) + ' 字，超过 ' + limits.news + ' 字', value);
    if (/(histKey|Shadow DOM|querySelector|setStatus|sha256|断言|兜底|闸门|提交[号:]?\s*[0-9a-f]{7,40}\b)/i.test(value)) add(id, 'engineering', '更新要点混入实现细节，请移入开发日志', value);
  });
  if (items.length < 1 || items.length > limits.items) add('items', 'count', '更新要点须为 1–' + limits.items + ' 条，实为 ' + items.length + ' 条', String(items.length));
  const summaryKeys = items.map((s) => s.replace(/^(新增|改进|修复)\s*[·:：]\s*/, '').split(/[·:：]/)[0].trim());
  summaryKeys.forEach((key, i) => {
    if (key && summaryKeys.indexOf(key) !== i) add('item-' + (i + 1), 'duplicate-feature', '同一功能拆为多条，请合并', items[i]);
  });
  if (/扩展管理页.{0,12}检查更新/.test(source)) add('update-path', 'wrong-entry', '检查更新入口在扩展图标弹窗，不能写成浏览器扩展管理页', '扩展管理页 → 检查更新');
  return { issues, stats: { newsItems: items.length } };
}

function signature(i) { return JSON.stringify([i.file, i.id, i.field, i.rule, i.value]); }
function collect(read) {
  const flags = checkFlags(read('src/content/flags.js'));
  const news = checkNews(read('RELEASE_NOTES.md'));
  return { issues: flags.issues.concat(news.issues), stats: { ...flags.stats, ...news.stats } };
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
  console.log('文案检查器自测：7 组通过（短句、超长、绝对保证、更新结构、同功能重复、入口错误、存量差异）。');
}

try {
  if (args.includes('--self-test')) { selfTest(); process.exit(0); }
  const allowed = new Set(['--gate', '--json', '--base']);
  let base = null;
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('未知参数：' + args[i]);
    if (args[i] === '--base') { base = args[++i]; if (!base || base.startsWith('-')) throw new Error('--base 缺少提交'); }
  }
  const result = collect((f) => fs.readFileSync(path.join(root, f), 'utf8'));
  let previous = new Set();
  if (base) {
    const git = process.env.DYC_GIT || 'git';
    const commit = cp.execFileSync(git, ['rev-parse', '--verify', base + '^{commit}'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const old = collect((f) => cp.execFileSync(git, ['show', commit + ':' + f], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    previous = new Set(old.issues.map(signature));
  }
  result.issues.forEach((i) => { i.existing = base ? previous.has(signature(i)) : false; });
  result.blocking = result.issues.filter((i) => !i.existing).length;
  result.base = base;
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('文案检查：' + result.stats.switches + ' 个开关；问号超过 ' + limits.help + ' 字 ' + result.stats.overlongHelp + ' 项；最长 ' + result.stats.longestHelp + ' 字；更新要点 ' + result.stats.newsItems + ' 条。');
    result.issues.forEach((i) => console.log((i.existing ? '[存量]' : '[待改]') + ' ' + i.file + ' / ' + i.id + '.' + i.field + '：' + i.message));
    console.log('共 ' + result.issues.length + ' 项规则命中；本次阻断 ' + result.blocking + ' 项。' + (base ? '存量仍须整改；任何修改后的违规文本均重新阻断。' : '默认只报告，加 --gate 才返回失败。'));
    console.log('边界：不判断语义正确、功能承诺与实机行为，仍须逐项人工核对。');
  }
  if (args.includes('--gate') && result.blocking) process.exitCode = 1;
} catch (error) {
  console.error('文案检查失败：' + error.message);
  process.exitCode = 2;
}

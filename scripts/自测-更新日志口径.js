'use strict';

/**
 * 更新说明「发布基线」校验（2026-11-05）自测。
 *
 * 被测的是 scripts/check-product-copy.js 里新增的 checkNewsBaseline()
 * 与它的能力词表 scripts/changelog-entities.json。
 *
 * 为什么要单独一个自测：
 *   ① 基线判定的 15 组断言写在 check-product-copy.js 的 --self-test 里，
 *      但 --self-test 从来没被任何入口调用过（2026-11-05 发现它一直是红的，
 *      因为样本形态与实现不符）。这里把它接进统一自测，从此有人跑。
 *   ② 词表是「静默失效」的高危点：改了源文件名或开关 key 而词表没跟上，
 *      基线校验会静默漏检，看起来一切正常。这里逐条核对文件与 key 是否真实存在。
 *
 * 只读工程内文件，不起浏览器、不联网。git 不参与（基线数据由 --self-test 构造）。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (error) {
    failed += 1;
    console.error('  ✗ ' + name + '：' + error.message);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const entities = JSON.parse(read('scripts/changelog-entities.json'));

console.log('更新说明基线校验自测');

test('能力词表结构完整', () => {
  assert(Array.isArray(entities.groups) && entities.groups.length > 0, '词表为空');
  entities.groups.forEach((g) => {
    assert(g && typeof g.name === 'string' && g.name.trim(), '缺少 name');
    assert(Array.isArray(g.words) && g.words.length > 0, g.name + ' 缺少 words');
    assert(Array.isArray(g.files) && g.files.length > 0, g.name + ' 缺少 files');
    g.words.forEach((w) => assert(w && w.length >= 2, g.name + ' 有长度小于 2 的词：' + w));
  });
});

test('同一个词不归属两个能力组', () => {
  const seen = new Map();
  entities.groups.forEach((g) => {
    g.words.forEach((w) => {
      assert(!seen.has(w), '「' + w + '」同时出现在 ' + seen.get(w) + ' 与 ' + g.name);
      seen.set(w, g.name);
    });
  });
});

test('词表引用的源文件都真实存在', () => {
  entities.groups.forEach((g) => {
    (g.files || []).forEach((f) => {
      assert(fs.existsSync(path.join(root, f)), g.name + ' 引用的 ' + f + ' 不存在（改名后词表没跟上，基线校验会静默漏检）');
    });
  });
});

test('词表引用的开关 key 都在 flags.js 里', () => {
  const keys = new Set();
  read('src/content/flags.js').replace(/\bkey:\s*'([^']+)'/g, (m, k) => { keys.add(k); return m; });
  entities.groups.forEach((g) => {
    (g.flags || []).forEach((f) => {
      assert(keys.has(f), g.name + ' 引用的开关 ' + f + ' 在 flags.js 里找不到（改名后词表没跟上）');
    });
  });
});

test('文案检查器内置自测全过（含基线与自动整理断言）', () => {
  // 只校验「跑完了且通过」，不绑死断言条数 —— 条数属于实现细节，
  // 每加一组用例就红一次，那是断言过时，不是真缺陷。
  const out = cp.execFileSync(process.execPath, [path.join(root, 'scripts/check-product-copy.js'), '--self-test'], { cwd: root, encoding: 'utf8' });
  assert(/\d+\s*组通过/.test(out), '内置自测未跑完：' + out.trim());
});

test('当前更新说明能解析出摘要与要点', () => {
  const notes = read('RELEASE_NOTES.md');
  const top = notes.split(/^# /m)[1] || '';
  assert(/\*\*本版一句话\*\*/.test(top), '最顶上的版本段缺少「本版一句话」');
  const items = top.split(/\r?\n/).filter((line) => /^- /.test(line));
  assert(items.length >= 1 && items.length <= 5, '要点条数应为 1–5，实为 ' + items.length);
});

console.log('\n更新说明基线校验自测：' + passed + '/' + (passed + failed) + ' 通过');
if (failed) process.exitCode = 1;

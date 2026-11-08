'use strict';

/**
 * 自测 · 面料材质「智能填写」(2026-11-08 建)
 *
 * 被测:src/content/fabric-smart-fill.js
 *
 * 用户 2026-11-08 定稿的三条口径,本脚本逐条钉死:
 *   ① 配比合计不满 100 ⇒ **提示且不运行**(一个下拉都不许点开)
 *   ② 合计满 100 ⇒ 可以**覆盖**原生框原有内容(先清旧值再写)
 *   ③ 平台字典里没有的材料名 ⇒ **按我写的名字新建**,不许匹配类似的
 *      (所以匹配只认「整串相等」,连「醋酸 → 醋酸纤维」这种前缀扩展都不许)
 *
 * 这一条最容易犯的错是**假绿**:把断言写成「函数被调用了」就通过,
 * 可实际上平台控件一个值都没变。所以第二段用一个仿平台复合控件的 mock:
 * 只有真的点中选项 / 回车新建 / 填了配比,mock 的 DOM 才会变,断言才看得到。
 *
 * 用法：node scripts/自测-面料智能填写.js（run-selftests.py 自动带上）
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_UNDER_TEST = 'src/content/fabric-smart-fill.js';

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (test, timeout = 2500) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (test()) return;
    await sleep(25);
  }
  throw new Error('等待目标状态超时');
};
/* check() 是同步的,传异步回调不会等待 ⇒ 多个场景并发互踩。
   需要等待的用例一律用 checkSeq 并在调用处 await。 */
async function checkSeq(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}

const HTML = `<!doctype html><html><body>
  <div class="form-row">
    <div class="label"><span class="req">*</span> 面料材质</div>
    <div class="aurora-dorami-composition-select" role="combobox">
      <div class="composition-selection">
        <div class="composition-select-selection-item">棉 100%<i class="composition-select-selection-item-remove"></i></div>
      </div>
      <input class="aurora-select-selection-search-input">
      <div class="composition-percent-wrap"><input type="number" class="composition-percent" value="100"></div>
    </div>
  </div>
  <div class="aurora-dorami-composition-select-option-list">
    <div class="aurora-dorami-composition-select-option">棉</div>
    <div class="aurora-dorami-composition-select-option">丝绸</div>
    <div class="aurora-dorami-composition-select-option">醋酸纤维</div>
    <div class="aurora-dorami-composition-select-option">聚酯纤维</div>
  </div>
  <!-- 2026-11-08 用户反馈:平台「新建材质」弹窗(body 直挂 portal,类名也含
       composition-select 但没有 option 字样)。这里面的输入框是平台自己的
       新建入口,智能填写不许挂过去。 -->
  <div class="aurora-modal" id="matPortal" style="position:fixed;left:0;top:0">
    <div class="aurora-dorami-composition-select-selected">
      <div class="aurora-dorami-composition-select-selected-title">新建材质</div>
      <input class="aurora-select-selection-search-input" placeholder="输入材料名">
    </div>
  </div>
</body></html>`;

(async function main() {
  const dom = new JSDOM(HTML, { url: 'https://fxg.jinritemai.com/ffa/g/create?entrance=edit', runScripts: 'outside-only' });
  const win = dom.window;
  const doc = win.document;

  win.chrome = { runtime: { id: 'selftest', lastError: null, sendMessage() {} } };
  win.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
  win.dycWatchFlags = () => {};
  win.isVisible = () => true;
  win.findAllByText = (text) => {
    const out = [];
    const walk = (el) => {
      if (el.nodeType === 3) {
        if (el.nodeValue && el.nodeValue.indexOf(text) >= 0) out.push(el.parentElement);
        return;
      }
      if (el.nodeType !== 1) return;
      for (const c of el.childNodes) walk(c);
    };
    walk(doc.body);
    return out;
  };
  win.debugLog = () => {};
  const messages = [];
  win.setStatus = (value, kind, opts) => messages.push({ value, kind, opts });
  win.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

  /* ---------- 仿平台复合控件:只有真被点到才变 ---------- */
  const control = doc.querySelector('.aurora-dorami-composition-select');
  const selection = control.querySelector('.composition-selection');
  const percentWrap = control.querySelector('.composition-percent-wrap');
  const search = control.querySelector('.aurora-select-selection-search-input');
  let optionClicks = 0;
  let createdByEnter = 0;

  function addChip(name) {
    if (Array.from(selection.children).some((c) => (c.textContent || '').indexOf(name) === 0)) return false;
    const chip = doc.createElement('div');
    chip.className = 'composition-select-selection-item';
    chip.textContent = name;
    const x = doc.createElement('i');
    x.className = 'composition-select-selection-item-remove';
    chip.appendChild(x);
    selection.appendChild(chip);
    const p = doc.createElement('input');
    p.type = 'number';
    p.className = 'composition-percent';
    percentWrap.appendChild(p);
    return true;
  }

  /* 叉号删除走委托 —— 初始那条 chip 也要能删(真实平台就是这样:
     删掉材料,它那一格配比输入框一起消失)。 */
  selection.addEventListener('click', (e) => {
    const x = e.target && e.target.closest ? e.target.closest('.composition-select-selection-item-remove') : null;
    if (!x) return;
    const chip = x.closest('.composition-select-selection-item');
    if (!chip) return;
    const idx = Array.from(selection.children).indexOf(chip);
    chip.remove();
    const ps = percentWrap.querySelectorAll('input');
    if (ps[idx]) ps[idx].remove();
  });

  doc.querySelectorAll('.aurora-dorami-composition-select-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      optionClicks++;
      addChip((opt.textContent || '').trim());
    });
  });

  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = String(search.value || '').trim();
    if (!v) return;
    if (addChip(v)) createdByEnter++;
  });

  win.eval(read(SRC_UNDER_TEST));
  await sleep(40);

  const box = doc.querySelector('[data-dyc-fabric-box]');
  const input = doc.querySelector('.dyc-fabric-input');
  const btn = doc.querySelector('.dyc-fabric-btn');

  console.log('\n【一】解析口径(带不带字符都要认)');
  const parse = (s) => win.__dycParseFabric(s);
  const names = (r) => (r.items || []).map((x) => x.name + ':' + x.pct).join(',');

  check('棉80 丝绸20 → 两项', () => {
    const r = parse('棉80 丝绸20');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:80,丝绸:20');
  });
  check('带百分号、紧挨着写也能拆开', () => {
    const r = parse('棉80%丝绸20%');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:80,丝绸:20');
  });
  check('名字与数字之间有空格也能认', () => {
    const r = parse('棉 80 丝绸 20');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:80,丝绸:20');
  });
  check('顿号/冒号/逗号/换行当分隔', () => {
    const r = parse('棉：80、丝绸：20');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:80,丝绸:20');
    const r2 = parse('棉,80\n丝绸,20');
    assert.equal(r2.ok, true);
  });
  check('全角数字转半角', () => {
    const r = parse('棉８０ 丝绸２０');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:80,丝绸:20');
  });
  check('任意符号都忽略，只提取材料名与数字', () => {
    const r = parse('棉~80###丝绸@@20');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:80,丝绸:20');
    const r2 = parse('80%💡棉；20%🧵丝绸');
    assert.equal(r2.ok, true);
    assert.equal(names(r2), '棉:80,丝绸:20');
  });
  check('材料名里的连字符也忽略，小数点仍保留', () => {
    const r = parse('聚酯-纤维86.3 + 氨~纶13.7');
    assert.equal(r.ok, true);
    assert.equal(names(r), '聚酯纤维:86.3,氨纶:13.7');
  });
  check('吊牌尾注「（罗纹除外）」整段剥掉，小数照认（用户 16:11 文案）', () => {
    const r = parse('绵羊毛 40.0\n锦纶 33.9\n莱赛尔 16.3\n羊驼毛 9.8\n（罗纹除外）');
    assert.equal(r.ok, true, r.reason || '');
    assert.equal(names(r), '绵羊毛:40,锦纶:33.9,莱赛尔:16.3,羊驼毛:9.8');
  });
  check('剥掉括号备注，但材料名里的括号文字原样保留', () => {
    const r = parse('棉100（罗纹除外）');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:100');
    const r2 = parse('聚酯纤维(涤纶)100');
    assert.equal(r2.ok, true);
    assert.equal(names(r2), '聚酯纤维(涤纶):100');
  });

  /* ——— 真实吊牌写法(2026-11-08 用户给了 8 张吊牌截图) ———
     共同点:百分比大量写在**材料名前面**,还带「面料：」前缀、中文逗号、
     小数、以及中间没有分隔符的连写。这 8 条就是回归基线。 */
  check('吊牌①:莱赛尔86.3 / 绵羊毛8.3 / 氨纶5.4(名字在前,小数,无百分号)', () => {
    const r = parse('莱赛尔86.3\n绵羊毛8.3\n氨纶5.4');
    assert.equal(r.ok, true);
    assert.equal(names(r), '莱赛尔:86.3,绵羊毛:8.3,氨纶:5.4');
  });
  check('吊牌②:68%精棉32%聚酯纤维(百分比在前,无分隔)', () => {
    const r = parse('68%精棉32%聚酯纤维');
    assert.equal(r.ok, true);
    assert.equal(names(r), '精棉:68,聚酯纤维:32');
  });
  check('吊牌③:100%羊毛(单项)', () => {
    const r = parse('100%羊毛');
    assert.equal(r.ok, true);
    assert.equal(names(r), '羊毛:100');
  });
  check('吊牌④:100%新澳羊毛(材料名带前缀词)', () => {
    const r = parse('100%新澳羊毛');
    assert.equal(r.ok, true);
    assert.equal(names(r), '新澳羊毛:100');
  });
  check('吊牌⑤:64%聚酯纤维，23%粘胶，11%羊毛，2%氨纶(中文逗号)', () => {
    const r = parse('64%聚酯纤维，23%粘胶，11%羊毛，2%氨纶');
    assert.equal(r.ok, true);
    assert.equal(names(r), '聚酯纤维:64,粘胶:23,羊毛:11,氨纶:2');
  });
  check('吊牌⑥:41.4%棉 / 27.3%聚酯纤维 / 24.7%锦纶 / 6.6%绵羊毛', () => {
    const r = parse('41.4%棉\n27.3%聚酯纤维\n24.7%锦纶\n6.6%绵羊毛');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:41.4,聚酯纤维:27.3,锦纶:24.7,绵羊毛:6.6');
  });
  check('吊牌⑦:84聚醋纤维 12粘胶纤维4氨纶(连写,名字在前)', () => {
    const r = parse('84聚醋纤维 12粘胶纤维4氨纶');
    assert.equal(r.ok, true);
    assert.equal(names(r), '聚醋纤维:84,粘胶纤维:12,氨纶:4');
  });
  check('吊牌⑧:面料：100棉(带前缀标签)', () => {
    const r = parse('面料：100棉');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:100');
  });
  check('前缀标签不会被当成材料名', () => {
    for (const s of ['面料:100%羊毛', '成分：棉80 涤20', '材质 68%棉32%聚酯纤维', '面料成分：100棉']) {
      const r = parse(s);
      assert.equal(r.ok, true, s + ' 没解析出来');
      assert.ok(!(r.items || []).some((x) => /面料|成分|材质/.test(x.name)), s + ' 把标签当成了材料名:' + names(r));
    }
  });

  check('同名合并(棉80 棉20 → 棉100)', () => {
    const r = parse('棉80 棉20');
    assert.equal(r.ok, true);
    assert.equal(names(r), '棉:100');
  });
  check('合计 95 ⇒ 不运行并说明差多少', () => {
    const r = parse('棉80 丝绸15');
    assert.equal(r.ok, false);
    assert.ok(/95/.test(r.reason), '原因里没有写出 95:' + r.reason);
  });
  check('合计 105 ⇒ 不运行', () => {
    const r = parse('棉80 丝绸20 氨纶5');
    assert.equal(r.ok, false);
    assert.ok(/105/.test(r.reason), '原因里没有写出 105:' + r.reason);
  });
  check('空输入 / 没有数字 ⇒ 不运行', () => {
    assert.equal(parse('').ok, false);
    assert.equal(parse('棉 丝绸').ok, false);
  });

  console.log('\n【二】挂载:自建输入框在原生框右边');
  check('输入框与「智能填写」按钮都挂上了', () => {
    assert.ok(box, '没有自建框');
    assert.ok(input, '没有输入框');
    assert.ok(btn, '没有按钮');
    assert.equal((btn.textContent || '').trim(), '智能填写');
  });
  check('自建框紧跟在原生控件之后（DOM 右邻）', () => {
    assert.equal(box.previousElementSibling, control);
  });
  check('灰字只写指引，不预置面料示例，浮动提示已删（用户 16:28 定）', () => {
    const ph = input.getAttribute('placeholder') || '';
    assert.ok(ph.length > 0, 'placeholder 为空，用户不知道该怎么填');
    /* 「棉80 丝绸20」写成 placeholder 会被当成已填好的内容，用户直接点按钮就什么都没发生 */
    assert.ok(!/棉\s*80/.test(ph), 'placeholder 里又写了面料示例:' + ph);
    assert.ok(/合计|100/.test(ph), '指引里没写合计要 100%:' + ph);
    /* title 悬停浮动提示已按用户要求删除 */
    assert.ok(!input.getAttribute('title'), 'title 浮动提示没删干净:' + input.getAttribute('title'));
  });
  check('原生框与自建框共存（没有把原生控件挤掉）', () => {
    assert.ok(doc.contains(control));
    assert.equal(control.style.display, '');
  });

  console.log('\n【三】合计不足 100:只提示，一个下拉都不点');
  {
    const before = optionClicks;
    const beforeAlerts = messages.filter((m) => m.kind === 'alert').length;
    input.value = '棉80 丝绸15';
    btn.click();
    await sleep(120);

    check('不足 100 时一个下拉都没点', () => {
      assert.equal(optionClicks, before, '合计不足却点了下拉');
    });
    check('不足 100 时给出提示且说清合计不等于 100', () => {
      const al = messages.filter((m) => m.kind === 'alert');
      assert.ok(al.length > beforeAlerts, '没有报警');
      const last = al[al.length - 1];
      assert.ok(/100/.test(last.value) || /100/.test(last.opts.full || ''), '提示里没说合计不等于 100');
    });
    check('不足 100 时原生框一个字都没动', () => {
      const chips = selection.querySelectorAll('.composition-select-selection-item');
      assert.equal(chips.length, 1, '原生框被改了');
      assert.ok((chips[0].textContent || '').indexOf('棉') === 0);
    });
  }

  console.log('\n【四】合计 100:覆盖旧值 + 逐项选中 + 填配比');
  input.value = '棉80 丝绸20';
  btn.click();
  await sleep(1600);

  check('平台选项被精确点中两次（棉、丝绸）', () => {
    assert.equal(optionClicks, 2, '选项点击次数:' + optionClicks);
  });
  check('原生框只剩新值（旧值被覆盖，不是追加）', () => {
    const texts = Array.from(selection.children).map((c) => (c.textContent || '').trim());
    assert.deepEqual(texts, ['棉', '丝绸'], '实际:' + JSON.stringify(texts));
  });
  check('配比被填成 80 / 20', () => {
    const vals = Array.from(percentWrap.querySelectorAll('input')).map((i) => i.value);
    assert.deepEqual(vals, ['80', '20'], '实际:' + JSON.stringify(vals));
  });
  check('报了一条成功消息（来源 智能填写）', () => {
    const ok = messages.filter((m) => m.kind === 'success');
    assert.equal(ok.length, 1, '成功消息 ' + ok.length + ' 条');
    assert.equal(ok[0].opts.source, '智能填写');
    assert.equal(ok[0].opts.count, '已填入 2 项');
  });

  console.log('\n【五】平台没有的材料:能填的先填上，最后统一报未填项(用户 15:19 定)');
  {
    /* 用户 2026-11-08 15:19:「第一个失败就报错」不好 —— 能找到的都提交,
       失败最后再报。兜底规则不变:下拉里还有别的选项 ⇒ 不按回车(防勾错相近项)。 */
    const alertsBefore = messages.filter((m) => m.kind === 'alert').length;
    input.value = '醋酸80 棉20';
    btn.click();
    await sleep(1500);

    check('「醋酸」没有被勾成「醋酸纤维」', () => {
      const texts = Array.from(selection.children).map((c) => (c.textContent || '').trim());
      assert.ok(!texts.includes('醋酸纤维'), '匹配到了相似材料:' + JSON.stringify(texts));
      assert.ok(!texts.includes('醋酸'), '不该写入平台没有的材料:' + JSON.stringify(texts));
    });
    check('下拉里还有别的选项时不按回车', () => {
      assert.equal(createdByEnter, 0, '回车被按了 ' + createdByEnter + ' 次');
    });
    check('能填的「棉」已进框并写好配比', () => {
      const texts = Array.from(selection.children).map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['棉'], '实际:' + JSON.stringify(texts));
      const vals = Array.from(percentWrap.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['20'], '配比:' + JSON.stringify(vals));
    });
    check('最后统一报:已填 1/2 项，未填的写明材料名', () => {
      const al = messages.filter((m) => m.kind === 'alert');
      assert.ok(al.length > alertsBefore, '没有提示');
      const last = al[al.length - 1];
      const full = (last.value || '') + ' ' + ((last.opts && last.opts.full) || '');
      assert.ok(/醋酸/.test(full), '没写未填材料名:' + full);
      assert.ok(/未填入/.test(full), '没说明未填:' + full);
      assert.ok(/手动添加/.test(full), '没提示手动添加:' + full);
    });
  }

  console.log('\n【七】疑似笔误:相近项不勾选，其余照填，最后报缺');
  {
    const hint = doc.querySelector('.dyc-fabric-hint');
    assert.ok(hint, '没有提示行元素');

    const alertsBefore = messages.filter((m) => m.kind === 'alert').length;
    input.value = '聚醋纤维84 棉16';
    btn.click();
    await sleep(1500);

    check('「聚醋纤维」没有被勾成「聚酯纤维」', () => {
      const texts = Array.from(selection.children).map((c) => (c.textContent || '').trim());
      assert.ok(!texts.includes('聚酯纤维'), '相近材料被勾进去了:' + JSON.stringify(texts));
      assert.ok(!texts.includes('聚醋纤维'), '不该写入平台没有的材料:' + JSON.stringify(texts));
    });
    check('「棉」已按配比填好(16%)', () => {
      const texts = Array.from(selection.children).map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['棉'], '实际:' + JSON.stringify(texts));
      const vals = Array.from(percentWrap.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['16'], '配比:' + JSON.stringify(vals));
    });
    check('报缺说明里写明相近材料与已填结果', () => {
      const al = messages.filter((m) => m.kind === 'alert');
      assert.ok(al.length > alertsBefore, '没有提示');
      const last = al[al.length - 1];
      const full = (last.value || '') + ' ' + ((last.opts && last.opts.full) || '');
      assert.ok(/聚醋纤维/.test(full), '没写未填材料名:' + full);
      assert.ok(/疑似「聚酯纤维」的笔误/.test(full), '没说明相近材料:' + full);
      assert.ok(/1 项已按配比填好/.test(full), '没说明已填结果:' + full);
    });

    input.value = '棉80 丝绸20';
    btn.click();
    await sleep(1800);

    check('全部精确命中时正常写入且不显示小红字', () => {
      const texts = Array.from(selection.children).map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['棉', '丝绸'], '实际:' + JSON.stringify(texts));
      assert.equal(hint.style.display, 'none', '没有笔误却弹了提示:' + hint.textContent);
    });
  }

  console.log('\n【八】填完之后不清空输入框 + 右侧一键清空');
  {
    const clearBtn = doc.querySelector('.dyc-fabric-clear');
    assert.ok(clearBtn, '没有一键清空按钮');

    /* 用户 2026-11-08:点了「智能填写」之后,上面填的内容要留着(方便改一个字再点),
       想清掉就点输入框最右边那个小叉。 */
    check('智能填写后输入框内容保留', () => {
      assert.equal(input.value, '棉80 丝绸20', '填完被清空了,实际:' + input.value);
    });

    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    check('有内容时小叉出现', () => {
      assert.equal(clearBtn.style.display, 'flex', '叉号没出现');
    });

    clearBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('点小叉只清输入框,不碰原生框', () => {
      assert.equal(input.value, '', '输入框没清空');
      assert.equal(clearBtn.style.display, 'none', '清空后叉号还在');
      const texts = Array.from(selection.children).map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['棉', '丝绸'], '原生框被动过了:' + JSON.stringify(texts));
    });
  }


  console.log('\n【九】没有 composition 类名、标签也对不上时,靠芯片文本反找控件');
  {
    /* 真机 2026-11-08:页面 aurora- 组件为 0 个,类名这条路可能整条落空。
       已选材料一定渲染成「棉 97%」,用它反找是最稳的一条 —— 这里就是那条的回归。 */
    const html2 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div class="anonymousRow">
          <span class="anonymousLabel">其他属性</span>
          <div class="anonymousControl">
            <span class="chip-a">棉 97%</span><i class="chip-a-close"></i>
            <span class="chip-b">氨纶 3%</span><i class="chip-b-close"></i>
            <input class="plainInput">
          </div>
        </div>
      </div>
    </body></html>`;
    const dom2 = new JSDOM(html2, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w2 = dom2.window;
    const d2 = dom2.window.document;
    w2.chrome = { runtime: { id: 'selftest2', lastError: null, sendMessage() {} } };
    w2.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    w2.dycWatchFlags = () => {};
    w2.isVisible = () => true;
    w2.findAllByText = () => [];          // 标签文本一个都不给(模拟标签对不上)
    w2.debugLog = () => {};
    w2.setStatus = () => {};
    w2.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w2.eval(read(SRC_UNDER_TEST));
    await sleep(60);

    check('靠「棉 97%」反找到控件并挂上自建框', () => {
      const box2 = d2.querySelector('[data-dyc-fabric-box]');
      assert.ok(box2, '芯片反找没生效 —— 真机就是「标签✗ + 类名0」这一档');
      assert.equal(box2.previousElementSibling, d2.querySelector('.anonymousControl'), '挂到了别的容器上');
    });
  }

  console.log('\n【十】弹窗里的「新建材质」输入框不挂智能填写（用户 2026-11-08 反馈）');
  check('全页只有一个自建框，且在表单控件旁而不是弹窗里', () => {
    const boxes = doc.querySelectorAll('[data-dyc-fabric-box]');
    assert.equal(boxes.length, 1, '挂了 ' + boxes.length + ' 个');
    assert.equal(boxes[0].previousElementSibling, control, '自建框没挂在表单控件旁');
  });
  check('弹窗的输入框保持原样（平台新建入口不受影响）', () => {
    const portalInput = doc.querySelector('#matPortal input');
    assert.ok(portalInput, '弹窗输入框丢了');
    assert.equal(portalInput.closest('[data-dyc-fabric-box]'), null, '弹窗里挂了自建框');
    assert.equal(portalInput.parentElement.querySelector('.dyc-fabric-btn'), null, '弹窗里出现了智能填写按钮');
  });
  {
    /* 旧版本误挂进去的也要被清扫:手工塞一个再触发一次扫描 */
    const portal = doc.getElementById('matPortal');
    const stray = doc.createElement('div');
    stray.setAttribute('data-dyc-fabric-box', '1');
    stray.innerHTML = '<input><button class="dyc-fabric-btn">智能填写</button>';
    portal.querySelector('.aurora-dorami-composition-select-selected').appendChild(stray);
    doc.body.appendChild(doc.createElement('i'));   // 触发 MutationObserver → mount → 清扫
    await sleep(900);
    check('上一版误挂进弹窗的自建框会被自动摘掉', () => {
      assert.equal(doc.querySelector('#matPortal [data-dyc-fabric-box]'), null);
    });
    check('清扫不误伤表单旁的正主', () => {
      assert.equal(doc.querySelectorAll('[data-dyc-fabric-box]').length, 1);
    });
  }

  console.log('\n【十一】新建弹窗路径已删除:兜底回车建不了就如实报失败(用户 14:56 定)');
  {
    /* 用户 2026-11-08 14:56:「新建弹窗这个一直没成功,删掉这个建立新材料的路径」。
       未知材料的正路 = 直填通道的自定义值提交;兜底路径只剩回车一试,
       回车也建不了 ⇒ 明确报失败并提示先手动添加,绝不再找「新建材质」入口。 */
    const html3 = `<!doctype html><html><body>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection"></div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap"></div>
        </div>
      </div>
      <div class="aurora-dorami-composition-select-option-list">
        <div class="aurora-dorami-composition-select-option">棉</div>
        <div class="composition-select-footer"><div class="create-entry">+ 新建材质</div></div>
      </div>
    </body></html>`;
    const dom3 = new JSDOM(html3, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w3 = dom3.window;
    const d3 = dom3.window.document;
    w3.chrome = { runtime: { id: 'selftest3', lastError: null, sendMessage() {} } };
    w3.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    w3.dycWatchFlags = () => {};
    w3.isVisible = () => true;
    w3.findAllByText = () => [];
    w3.debugLog = () => {};
    const msgs3 = [];
    w3.setStatus = (v, k, o) => msgs3.push({ v, k, o });
    w3.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    const ctl3 = d3.querySelector('.aurora-dorami-composition-select');
    const sel3 = ctl3.querySelector('.composition-selection');
    const pw3 = ctl3.querySelector('.composition-percent-wrap');
    const search3 = ctl3.querySelector('.aurora-select-selection-search-input');
    let dialogTouched = 0;
    function addChip3(name) {
      const chip = d3.createElement('div');
      chip.className = 'composition-select-selection-item';
      chip.textContent = name;
      sel3.appendChild(chip);
      const p = d3.createElement('input');
      p.type = 'number';
      p.className = 'composition-percent';
      pw3.appendChild(p);
    }
    /* 回车啥也不干 —— 真机就是这样 */
    search3.addEventListener('keydown', () => {});
    /* 平台字典里已有的材料,点选项直接进框 */
    d3.querySelectorAll('.aurora-dorami-composition-select-option').forEach((opt) => {
      opt.addEventListener('click', () => addChip3((opt.textContent || '').trim()));
    });
    /* 「新建材质」入口故意留在页面上,但智能填写一次都不许碰它 */
    d3.querySelector('.create-entry').addEventListener('click', () => { dialogTouched++; });

    w3.eval(read(SRC_UNDER_TEST));
    await sleep(60);
    const btn3 = d3.querySelector('.dyc-fabric-btn');
    const input3 = d3.querySelector('.dyc-fabric-input');
    check('自建框挂上了', () => { assert.ok(btn3, '没挂上'); });

    input3.value = '聚醋纤维84 棉16';
    btn3.click();
    await sleep(1200);

    check('弹窗「新建材质」入口一次都没被点', () => {
      assert.equal(dialogTouched, 0, '还在点新建入口');
    });
    check('未知材料记缺，其余照填并报「已填 1/2 项」', () => {
      const al = msgs3.filter((m) => m.k === 'alert');
      assert.ok(al.length >= 1, '没有提示');
      const last = al[al.length - 1];
      const full = (last.v || '') + ' ' + ((last.o && last.o.full) || '');
      assert.ok(/聚醋纤维/.test(full), '没写未填材料名:' + full);
      assert.ok(/未填入/.test(full), '没说明未填:' + full);
      assert.ok(/手动添加/.test(full), '没提示手动添加:' + full);
      assert.ok(/1\/2/.test((last.o && last.o.count) || ''), '没报已填/总数:' + (last.o && last.o.count));
      assert.equal(msgs3.filter((m) => m.k === 'success').length, 0, '不该报成功');
    });
    check('能填的「棉」已进框并写好配比 16%', () => {
      const chips = Array.from(sel3.querySelectorAll('.composition-select-selection-item'))
        .map((c) => (c.textContent || '').trim());
      assert.deepEqual(chips, ['棉'], '实际:' + JSON.stringify(chips));
      const vals = Array.from(pw3.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['16'], '配比:' + JSON.stringify(vals));
    });
    check('按钮恢复可点（没有卡在填写中）', () => {
      assert.equal((btn3.textContent || '').trim(), '智能填写');
      assert.equal(btn3.disabled, false);
    });
  }

  console.log('\n【十二】平台组件有数据通道时:整组直填，不模拟逐项点选');
  {
    const html4 = `<!doctype html><html><body>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection"></div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap"></div>
        </div>
      </div>
      <div class="aurora-dorami-composition-select-option-list">
        <div class="aurora-dorami-composition-select-option">棉</div>
        <div class="aurora-dorami-composition-select-option">丝绸</div>
      </div>
    </body></html>`;
    const dom4 = new JSDOM(html4, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w4 = dom4.window;
    const d4 = dom4.window.document;
    w4.chrome = { runtime: { id: 'selftest4', lastError: null, sendMessage() {} } };
    w4.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    w4.dycWatchFlags = () => {};
    w4.isVisible = () => true;
    w4.findAllByText = () => [];
    w4.debugLog = () => {};
    const msgs4 = [];
    w4.setStatus = (v, k, o) => msgs4.push({ v, k, o });
    w4.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    const ctl4 = d4.querySelector('.aurora-dorami-composition-select');
    const sel4 = ctl4.querySelector('.composition-selection');
    const pw4 = ctl4.querySelector('.composition-percent-wrap');
    const search4 = ctl4.querySelector('.aurora-select-selection-search-input');
    const options4 = [
      { materialId: 'cotton', materialName: '棉', ratio: 100 },
      { materialId: 'silk', materialName: '丝绸', ratio: 100 }
    ];
    let value4 = [{ materialId: 'old', materialName: '旧材料', ratio: 100 }];
    let submitted4 = null;
    let optionClicks4 = 0;
    let searchEvents4 = 0;
    let stickyPct4 = false;   // 半受控模拟:芯片跟 value 走,比例输入框渲染后仍是旧值

    function render4() {
      sel4.innerHTML = '';
      pw4.innerHTML = '';
      value4.forEach((row) => {
        const chip = d4.createElement('div');
        chip.className = 'composition-select-selection-item';
        chip.textContent = row.materialName + (row.ratio != null ? ' ' + row.ratio + '%' : '');
        sel4.appendChild(chip);
        const pct = d4.createElement('input');
        pct.type = 'number';
        pct.className = 'composition-percent';
        if (!stickyPct4 && row.ratio != null) pct.value = String(row.ratio);
        pw4.appendChild(pct);
      });
    }
    render4();

    /* 模拟 React 宿主节点 → 自定义组件 fiber。只有调用真实 onChange,
       平台的 value 和芯片才会更新;单纯改搜索框 value 不会通过验收。 */
    ctl4['__reactFiber$selftest'] = {
      return: {
        memoizedProps: {
          value: value4,
          options: options4,
          onChange(next) {
            submitted4 = next;
            value4 = next;
            render4();
          }
        }
      }
    };
    d4.querySelectorAll('.aurora-dorami-composition-select-option').forEach((opt) => {
      opt.addEventListener('click', () => { optionClicks4++; });
    });
    ['input', 'change', 'keydown'].forEach((type) => {
      search4.addEventListener(type, () => { searchEvents4++; });
    });

    w4.eval(read(SRC_UNDER_TEST));
    await waitFor(() => !!d4.querySelector('.dyc-fabric-btn'));
    const input4 = d4.querySelector('.dyc-fabric-input');
    const btn4 = d4.querySelector('.dyc-fabric-btn');
    input4.value = '80%💡棉；20%🧵丝绸';
    btn4.click();
    await waitFor(() => msgs4.some((m) => m.k === 'success'));

    check('一次提交完整材料数组，保留平台材料 id 与字段结构', () => {
      assert.ok(submitted4, '没有调用组件 onChange');
      assert.deepEqual(Array.from(submitted4, (x) => [x.materialId, x.materialName, x.ratio]), [
        ['cotton', '棉', 80], ['silk', '丝绸', 20]
      ]);
    });
    check('直填没有点选项，也没有模拟搜索框输入或回车', () => {
      assert.equal(optionClicks4, 0);
      assert.equal(searchEvents4, 0);
    });
    check('原生框渲染出棉80%与丝绸20%，旧值被覆盖', () => {
      const chips = Array.from(sel4.children).map((x) => x.textContent);
      assert.deepEqual(chips, ['棉 80%', '丝绸 20%']);
    });
    check('直填结果通过核验后才报成功', () => {
      const ok = msgs4.filter((m) => m.k === 'success');
      assert.equal(ok.length, 1);
      assert.equal(ok[0].o.count, '已填入 2 项');
    });

    /* —— 2026-11-08 14:44 真机反馈三连修(异步用例必须逐个 await) —— */
    await checkSeq('已有材料改配比:整组直填直接更新比例，不回退', async () => {
      value4 = [{ materialId: 'cotton', materialName: '棉', ratio: 100 }];
      submitted4 = null;
      stickyPct4 = false;
      render4();
      input4.value = '棉80 丝绸20';
      btn4.click();
      await waitFor(() => msgs4.filter((m) => m.k === 'success').length === 2);
      assert.deepEqual(Array.from(submitted4, (x) => [x.materialId || '', x.materialName, x.ratio]), [
        ['cotton', '棉', 80], ['silk', '丝绸', 20]
      ]);
      assert.deepEqual(Array.from(sel4.children).map((x) => x.textContent), ['棉 80%', '丝绸 20%']);
    });

    await checkSeq('未知材料:自定义值直接提交，不强制走新建弹窗', async () => {
      value4 = [];
      submitted4 = null;
      stickyPct4 = false;
      render4();
      input4.value = '棉80 聚醋纤维20';
      btn4.click();
      await waitFor(() => msgs4.filter((m) => m.k === 'success').length === 3);
      /* 未知材料那条不带任何 id —— 克隆别的材料的 id 会把两个材料并成一个 */
      assert.deepEqual(Array.from(submitted4, (x) => [x.materialId || '', x.materialName, x.ratio]), [
        ['cotton', '棉', 80], ['', '聚醋纤维', 20]
      ]);
      const chips = Array.from(sel4.children).map((x) => x.textContent);
      assert.ok(chips.some((t) => t.indexOf('聚醋纤维') === 0), JSON.stringify(chips));
    });

    await checkSeq('直填后比例输入框停在旧值时，由统一写比例补上', async () => {
      value4 = [{ materialId: 'cotton', materialName: '棉', ratio: 100 }];
      submitted4 = null;
      stickyPct4 = true;
      render4();
      input4.value = '棉80 丝绸20';
      btn4.click();
      await waitFor(() => msgs4.filter((m) => m.k === 'success').length === 4);
      const vals = Array.from(pw4.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['80', '20'], '比例没被补写:' + JSON.stringify(vals));
    });

    /* —— 真机 15:04 第二轮:aurora-select 的 value 只带材料标识,配比在独立输入框 —— */
    await checkSeq('value 只带材料标识(配比在独立输入框)时也能直填', async () => {
      const fiberProps = ctl4['__reactFiber$selftest'].return.memoizedProps;
      fiberProps.value = [{ materialId: 'm1', materialName: '棉' }];
      fiberProps.options = [{ materialId: 'm2', materialName: '丝绸' }];
      value4 = [{ materialId: 'm1', materialName: '棉' }];
      submitted4 = null;
      stickyPct4 = false;
      render4();
      input4.value = '棉80 丝绸20';
      btn4.click();
      await waitFor(() => msgs4.filter((m) => m.k === 'success').length === 5);
      /* value 记录不带配比字段 ⇒ 提交的材料也只有标识,配比由统一写比例落框 */
      assert.deepEqual(Array.from(submitted4, (x) => [x.materialId, x.materialName, x.ratio == null ? '' : x.ratio]), [
        ['m1', '棉', ''], ['m2', '丝绸', '']
      ]);
      const vals = Array.from(pw4.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['80', '20'], '配比没写进独立输入框:' + JSON.stringify(vals));
    });

    await checkSeq('value 为空的初始状态(带 options)也能直填', async () => {
      const fiberProps = ctl4['__reactFiber$selftest'].return.memoizedProps;
      fiberProps.value = null;   // 空选状态:之前这种形态找不到通道,走了逐项兜底
      value4 = [];
      submitted4 = null;
      stickyPct4 = false;
      render4();
      input4.value = '丝绸100';
      btn4.click();
      await waitFor(() => msgs4.filter((m) => m.k === 'success').length === 6);
      assert.deepEqual(Array.from(submitted4, (x) => [x.materialId, x.materialName]), [['m2', '丝绸']]);
      assert.deepEqual(Array.from(sel4.children).map((x) => x.textContent), ['丝绸']);
    });
  }

  console.log('\n【十三】旧值清理:多颗旧芯片逐个点叉全部清掉(真机 14:44 反馈)');
  {
    /* 真机根因:点掉一颗芯片平台就整块重渲染,一次性抓出的叉号节点全部游离,
       旧版一循环点 N 个实际只清掉 1 个 ⇒「旧值没清干净」。这里两颗旧芯片
       + 委托删除,旧代码跑这条必红。 */
    const html5 = `<!doctype html><html><body>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection">
            <div class="composition-select-selection-item">羊毛<i class="composition-select-selection-item-remove"></i></div>
            <div class="composition-select-selection-item">氨纶<i class="composition-select-selection-item-remove"></i></div>
          </div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap">
            <input type="number" class="composition-percent" value="60">
            <input type="number" class="composition-percent" value="40">
          </div>
        </div>
      </div>
      <div class="aurora-dorami-composition-select-option-list">
        <div class="aurora-dorami-composition-select-option">棉</div>
        <div class="aurora-dorami-composition-select-option">丝绸</div>
        <div class="aurora-select-item-option">锦纶</div>
        <div class="aurora-select-option">涤纶</div>
      </div>
    </body></html>`;
    const dom5 = new JSDOM(html5, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w5 = dom5.window;
    const d5 = dom5.window.document;
    w5.chrome = { runtime: { id: 'selftest5', lastError: null, sendMessage() {} } };
    w5.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    w5.dycWatchFlags = () => {};
    w5.isVisible = () => true;
    w5.findAllByText = () => [];
    w5.debugLog = () => {};
    const msgs5 = [];
    w5.setStatus = (v, k, o) => msgs5.push({ v, k, o });
    w5.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    const ctl5 = d5.querySelector('.aurora-dorami-composition-select');
    const sel5 = ctl5.querySelector('.composition-selection');
    const pw5 = ctl5.querySelector('.composition-percent-wrap');
    const search5 = ctl5.querySelector('.aurora-select-selection-search-input');

    function addChip5(name) {
      if (Array.from(sel5.children).some((c) => (c.textContent || '').indexOf(name) === 0)) return;
      const chip = d5.createElement('div');
      chip.className = 'composition-select-selection-item';
      chip.textContent = name;
      const x = d5.createElement('i');
      x.className = 'composition-select-selection-item-remove';
      chip.appendChild(x);
      sel5.appendChild(chip);
      const p = d5.createElement('input');
      p.type = 'number';
      p.className = 'composition-percent';
      pw5.appendChild(p);
    }

    /* 叉号删除走委托:点掉一颗,芯片和它的配比框一起消失(真实平台同款行为) */
    sel5.addEventListener('click', (e) => {
      const x = e.target && e.target.closest ? e.target.closest('.composition-select-selection-item-remove') : null;
      if (!x) return;
      const chip = x.closest('.composition-select-selection-item');
      if (!chip) return;
      const idx = Array.from(sel5.children).indexOf(chip);
      chip.remove();
      const ps = pw5.querySelectorAll('input');
      if (ps[idx]) ps[idx].remove();
    });

    /* 三种类名的选项都要有点击行为(真实平台每种都可选) */
    d5.querySelectorAll('.aurora-dorami-composition-select-option, .aurora-select-item-option, .aurora-select-option').forEach((opt) => {
      opt.addEventListener('click', () => addChip5((opt.textContent || '').trim()));
    });
    search5.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = String(search5.value || '').trim();
      if (v) addChip5(v);
    });

    w5.eval(read(SRC_UNDER_TEST));
    await waitFor(() => !!d5.querySelector('.dyc-fabric-btn'));
    const input5 = d5.querySelector('.dyc-fabric-input');
    const btn5 = d5.querySelector('.dyc-fabric-btn');
    input5.value = '棉80 丝绸20';
    btn5.click();
    await waitFor(() => msgs5.some((m) => m.k === 'success'));

    check('两颗旧芯片全部清掉，只剩新填的两项', () => {
      const texts = Array.from(sel5.querySelectorAll('.composition-select-selection-item'))
        .map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['棉', '丝绸']);
      assert.ok(!texts.includes('羊毛') && !texts.includes('氨纶'), '旧值没清干净:' + JSON.stringify(texts));
    });
    check('旧芯片的配比框一起清掉，新配比 80/20 对位写入', () => {
      const vals = Array.from(pw5.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['80', '20'], '配比:' + JSON.stringify(vals));
    });

    /* —— 15:42 教训:下拉是 aurora 系列,旧特征只认 composition 系列 ⇒
       明明有「聚酯纤维」这类标准材料却报「平台没有」。这里用两种 aurora
       类名的选项各来一发,探测器必须都看得见、点得中。 —— */
    input5.value = '棉80 锦纶20';
    btn5.click();
    await waitFor(() => msgs5.filter((m) => m.k === 'success').length === 2);
    check('aurora-select-item-option 类名的选项也能搜到并点中', () => {
      const texts = Array.from(sel5.querySelectorAll('.composition-select-selection-item'))
        .map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['棉', '锦纶'], '实际:' + JSON.stringify(texts));
      const vals = Array.from(pw5.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['80', '20'], '配比:' + JSON.stringify(vals));
    });

    input5.value = '棉70 涤纶30';
    btn5.click();
    await waitFor(() => msgs5.filter((m) => m.k === 'success').length === 3);
    check('aurora-select-option 类名的选项同样命中', () => {
      const texts = Array.from(sel5.querySelectorAll('.composition-select-selection-item'))
        .map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['棉', '涤纶'], '实际:' + JSON.stringify(texts));
      const vals = Array.from(pw5.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['70', '30'], '配比:' + JSON.stringify(vals));
    });
  }

  console.log('\n【十五】平台只收下部分材料时:保住收下的，缺的报缺(真机 15:42 教训)');
  {
    /* 真机 15:42:桥把 5 项全部提交,平台收下 4 项(芯片已出现),
       旧验收要求「5 个芯片一个不少」就判失败,转兜底把 4 项清掉重填 ——
       自己人打自己人。现在按名字逐项盘点:收下几项保几项。 */
    const html7 = `<!doctype html><html><body>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection"></div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap"></div>
        </div>
      </div>
      <div class="aurora-dorami-composition-select-option-list">
        <div class="aurora-dorami-composition-select-option">棉</div>
        <div class="aurora-dorami-composition-select-option">丝绸</div>
      </div>
    </body></html>`;
    const dom7 = new JSDOM(html7, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w7 = dom7.window;
    const d7 = dom7.window.document;
    w7.chrome = { runtime: { id: 'selftest7', lastError: null, sendMessage() {} } };
    w7.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    w7.dycWatchFlags = () => {};
    w7.isVisible = () => true;
    w7.findAllByText = () => [];
    w7.debugLog = () => {};
    const logs7 = [];
    w7.debugLog = (s) => logs7.push(String(s || ''));
    const msgs7 = [];
    w7.setStatus = (v, k, o) => msgs7.push({ v, k, o });
    w7.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    const ctl7 = d7.querySelector('.aurora-dorami-composition-select');
    const sel7 = ctl7.querySelector('.composition-selection');
    const pw7 = ctl7.querySelector('.composition-percent-wrap');
    const rec = (name, pct, vid) => ({
      measure_info: { template_id: 873, values: [{ module_id: 1854, prefix: '', suffix: '', value: pct == null ? '' : String(pct) }] },
      value_id: vid || '',
      value_name: name
    });
    let value7 = [rec('棉', 100, 'c1'), rec('丝绸', 100, 'c2')];

    function render7() {
      sel7.innerHTML = '';
      pw7.innerHTML = '';
      value7.forEach((row) => {
        const chip = d7.createElement('div');
        chip.className = 'composition-select-selection-item';
        chip.textContent = row.value_name + ' ' + row.measure_info.values[0].value + '%';
        sel7.appendChild(chip);
        const pct = d7.createElement('input');
        pct.type = 'number';
        pct.className = 'composition-percent';
        pct.value = String(row.measure_info.values[0].value);
        pw7.appendChild(pct);
      });
    }
    render7();

    w7.eval(read('src/content/fabric-smart-fill-main.js'));
    /* 平台行为:自定义材料(value_id 为空)收不下,整块重渲染时被丢掉 */
    ctl7['__reactFiber$t'] = {
      return: {
        memoizedProps: {
          value: value7,
          onChange(next) {
            value7 = Array.from(next, (x) => x).filter((r) => r.value_id);
            render7();
          }
        }
      }
    };

    w7.eval(read(SRC_UNDER_TEST));
    await waitFor(() => !!d7.querySelector('.dyc-fabric-btn'));
    const input7 = d7.querySelector('.dyc-fabric-input');
    const btn7 = d7.querySelector('.dyc-fabric-btn');
    input7.value = '聚醋纤维20 棉80';
    btn7.click();
    await sleep(2600);

    check('平台收下的「棉 80%」保住了，没有被清掉重填', () => {
      const chips = Array.from(sel7.querySelectorAll('.composition-select-selection-item'))
        .map((c) => (c.textContent || '').trim());
      assert.deepEqual(chips, ['棉 80%'], '芯片被动了:' + JSON.stringify(chips));
      const vals = Array.from(pw7.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['80'], '配比:' + JSON.stringify(vals));
    });
    check('报缺说明写明未收下材料与已填结果', () => {
      const al = msgs7.filter((m) => m.k === 'alert');
      assert.ok(al.length >= 1, '没有提示');
      const last = al[al.length - 1];
      const full = (last.v || '') + ' ' + ((last.o && last.o.full) || '');
      assert.ok(/聚醋纤维/.test(full), '没写未收下材料:' + full);
      assert.ok(/没有收下/.test(full), '没说明平台未收下:' + full);
      assert.ok(/配比已写好/.test(full), '没说明已填结果:' + full);
      assert.ok(/1\/2/.test((last.o && last.o.count) || ''), '没报已填/总数:' + (last.o && last.o.count));
    });
    check('盘点日志写明收下几项与芯片现场', () => {
      const line = logs7.find((s) => s.indexOf('平台收下 1/2 项') >= 0);
      assert.ok(line, '没有盘点日志:' + JSON.stringify(logs7));
      assert.ok(/芯片现场/.test(line), '日志没带芯片现场:' + line);
    });
  }

  console.log('\n【十四】MAIN 世界桥:按抓包真实结构(value_name/measure_info)构造提交');
  {
    /* 抓包 2026-11-08 15:18 /product/tproduct/getBadWordHint 证实平台真实结构:
       [{measure_info:{template_id,values:[{module_id,prefix,suffix,value}]},value_id,value_name}]
       且表单里这一项可能是 JSON 字符串。桥在页面世界(MAIN)完成 找通道→构造→提交,
       内容脚本(隔离世界)读不到 __reactFiber$,jsdom 里没有世界隔离所以能直接单测。 */
    const html6 = `<!doctype html><html><body>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection"></div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap"></div>
        </div>
      </div>
    </body></html>`;
    const dom6 = new JSDOM(html6, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w6 = dom6.window;
    const d6 = dom6.window.document;
    const ctl6 = d6.querySelector('.aurora-dorami-composition-select');
    const rec = (name, pct, vid) => ({
      measure_info: { template_id: 873, values: [{ module_id: 1854, prefix: '', suffix: '', value: pct == null ? '' : String(pct) }] },
      value_id: vid || '',
      value_name: name
    });

    w6.eval(read('src/content/fabric-smart-fill-main.js'));

    check('桥就绪标记打在 documentElement 上（内容脚本跨世界可见）', () => {
      assert.equal(d6.documentElement.getAttribute('data-dyc-fabric-bridge'), '1');
    });

    /* —— 形态一:value 是 JSON 字符串(真实表单形态) —— */
    let submitted6 = null;
    ctl6['__reactFiber$t'] = {
      return: {
        memoizedProps: {
          value: JSON.stringify([rec('棉', 100, 'c1'), rec('丝绸', 100, 'c2')]),
          onChange(next) { submitted6 = next; }
        }
      }
    };
    const r1 = w6.__DYC_FABRIC_BRIDGE__.submit(ctl6, [{ name: '棉', pct: 80 }, { name: '聚醋纤维', pct: 20 }]);
    check('字符串形态:识别为 string 并镜像类型提交', () => {
      assert.equal(r1.ok, true, JSON.stringify(r1));
      assert.equal(r1.kind, 'string');
      assert.equal(typeof submitted6, 'string');
    });
    const rows6 = JSON.parse(submitted6);
    check('已知材料保留 value_id，配比写进 measure_info.values[0].value', () => {
      assert.equal(rows6[0].value_id, 'c1');
      assert.equal(rows6[0].value_name, '棉');
      assert.equal(rows6[0].measure_info.values[0].value, '80');
      assert.equal(rows6[0].measure_info.values[0].module_id, 1854);
    });
    check('未知材料按官方自定义形态:value_id 空串 + 原样名字', () => {
      assert.equal(rows6[1].value_id, '');
      assert.equal(rows6[1].value_name, '聚醋纤维');
      assert.equal(rows6[1].measure_info.values[0].value, '20');
      assert.equal(rows6[1].measure_info.template_id, 873);
    });
    check('两条材料的 measure_info 各有一份，不互相污染', () => {
      assert.equal(rows6[0].measure_info.values[0].value, '80');
      assert.equal(rows6[1].measure_info.values[0].value, '20');
      assert.notEqual(rows6[0].measure_info, rows6[1].measure_info);
    });

    /* —— 形态二:value 是数组 —— */
    let submitted7 = null;
    ctl6['__reactFiber$t'].return.memoizedProps = {
      value: [{ measure_info: { template_id: 873, values: [{ module_id: 1854, prefix: '', suffix: '', value: 100 }] }, value_id: 'c1', value_name: '棉' }],
      onChange(next) { submitted7 = next; }
    };
    const r2 = w6.__DYC_FABRIC_BRIDGE__.submit(ctl6, [{ name: '棉', pct: 60 }, { name: '氨纶', pct: 40 }]);
    check('数组形态:镜像为数组提交，未知材料照样构造', () => {
      assert.equal(r2.ok, true, JSON.stringify(r2));
      assert.equal(r2.kind, 'array');
      assert.ok(Array.isArray(submitted7));
      assert.equal(submitted7[0].value_id, 'c1');
      assert.equal(submitted7[0].measure_info.values[0].value, 60);
      assert.equal(submitted7[1].value_id, '');
      assert.equal(submitted7[1].value_name, '氨纶');
    });

    /* —— 消息协议 + 目标控件属性标记(内容脚本的真实调用路径) —— */
    const msgResult = await new Promise((resolve) => {
      const rid = 'x1';
      const h = (ev) => {
        const d = ev.data;
        if (d && d.__dycFabricResult === 1 && d.rid === rid) {
          w6.removeEventListener('message', h);
          resolve(d.result);
        }
      };
      w6.addEventListener('message', h);
      ctl6.setAttribute('data-dyc-fabric-target', '1');
      w6.postMessage({ __dycFabric: 1, rid: rid, items: [{ name: '棉', pct: 50 }] }, '*');
      setTimeout(() => resolve({ ok: false, why: '消息超时' }), 1500);
    });
    check('postMessage 协议往返:标记控件 → 桥提交 → 回结果', () => {
      assert.equal(msgResult.ok, true, JSON.stringify(msgResult));
      assert.equal(msgResult.kind, 'array');
    });
  }

  console.log('\n【十六】配比写入:在「已选」面板按材料名找同行输入框(真机 15:57:100% 也必填)');
  {
    /* 真机 15:57 截图:材料进了框,但配比框空着标红「该项为必填」——
       旧逻辑认为「全 100% 平台会默认,不用写」直接跳过还报了成功。
       平台的配比框在「已选」面板里(每行 = 材料名 + 输入框 + %),
       不在控件内部 —— 现在按材料名找同行写入,写不上不假报成功。 */
    const html8 = `<!doctype html><html><body>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection"></div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap"></div>
        </div>
      </div>
      <div class="aurora-select-dropdown">
        <input class="panel-search" placeholder="搜索材质">
        <div class="selected-item">绵羊毛<input type="text" class="aurora-input" placeholder="请输入"><i>%</i></div>
      </div>
    </body></html>`;
    const dom8 = new JSDOM(html8, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w8 = dom8.window;
    const d8 = dom8.window.document;
    w8.chrome = { runtime: { id: 'selftest8', lastError: null, sendMessage() {} } };
    w8.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    w8.dycWatchFlags = () => {};
    w8.isVisible = () => true;
    w8.findAllByText = () => [];
    w8.debugLog = () => {};
    const msgs8 = [];
    w8.setStatus = (v, k, o) => msgs8.push({ v, k, o });
    w8.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    const ctl8 = d8.querySelector('.aurora-dorami-composition-select');
    const sel8 = ctl8.querySelector('.composition-selection');
    const rec = (name, pct, vid) => ({
      measure_info: { template_id: 873, values: [{ module_id: 1854, prefix: '', suffix: '', value: pct == null ? '' : String(pct) }] },
      value_id: vid || '',
      value_name: name
    });
    let value8 = [rec('绵羊毛', 100, 'm1')];
    function render8() {
      sel8.innerHTML = '';
      value8.forEach((row) => {
        const chip = d8.createElement('div');
        chip.className = 'composition-select-selection-item';
        chip.textContent = row.value_name + ' ' + row.measure_info.values[0].value + '%';
        sel8.appendChild(chip);
      });
    }
    render8();
    ctl8['__reactFiber$t'] = {
      return: {
        memoizedProps: {
          value: value8,
          onChange(next) { value8 = Array.from(next, (x) => x); render8(); }
        }
      }
    };

    w8.eval(read('src/content/fabric-smart-fill-main.js'));
    w8.eval(read(SRC_UNDER_TEST));
    await waitFor(() => !!d8.querySelector('.dyc-fabric-btn'));
    const input8 = d8.querySelector('.dyc-fabric-input');
    const btn8 = d8.querySelector('.dyc-fabric-btn');
    input8.value = '绵羊毛100';
    btn8.click();
    await waitFor(() => msgs8.some((m) => m.k === 'success'));

    check('面板里「绵羊毛」同一行的配比框被写成 100（100% 也必填）', () => {
      const pctIn = d8.querySelector('.selected-item input');
      assert.ok(pctIn, '面板输入框丢了');
      assert.equal(pctIn.value, '100', '实际:' + pctIn.value);
    });
    check('报成功，没有把「没写配比」吞成假成功', () => {
      assert.equal(msgs8.filter((m) => m.k === 'success').length, 1);
      assert.equal(msgs8.filter((m) => m.k === 'alert').length, 0);
    });

    /* 面板收起(没有面板输入框)时:不能假报成功,要提示手动补 */
    const dropdown8 = d8.querySelector('.aurora-select-dropdown');
    dropdown8.remove();
    input8.value = '棉100';
    btn8.click();
    await waitFor(() => !btn8.disabled, 8000);
    check('面板收起且找不到配比框时:如实提示配比未写入，不假报成功', () => {
      const al = msgs8.filter((m) => m.k === 'alert');
      assert.ok(al.length >= 1, '没有提示');
      const last = al[al.length - 1];
      const full = (last.v || '') + ' ' + ((last.o && last.o.full) || '');
      assert.ok(/配比/.test(full), '没提配比:' + full);
      assert.ok(/进框/.test(full), '没说明材料已进框:' + full);
      assert.equal(msgs8.filter((m) => m.k === 'success').length, 1, '不该再报成功');
    });
  }

  console.log('\n【十七】先清空再填写:平台对 onChange 是「合并」时也不叠加(用户 16:11 定)');
  {
    /* 真机 16:10 铁证:平台对 onChange 是合并不是替换,直填不清空的话
       旧材料+新材料不停叠加(锦纶点几次就出现几次,框框重叠)。
       修法 = 点 × 清空原生芯片 → 桥发一条「空」清平台内部状态 → 再提交新材料。
       这里 mock 平台 = onChange 追加合并,旧代码跑这条必叠加。 */
    const html9 = `<!doctype html><html><body>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection">
            <div class="composition-select-selection-item">棉 98%<i class="composition-select-selection-item-remove"></i></div>
            <div class="composition-select-selection-item">氨纶 2%<i class="composition-select-selection-item-remove"></i></div>
          </div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap"></div>
        </div>
      </div>
      <div class="aurora-dorami-composition-select-option-list">
        <div class="aurora-dorami-composition-select-option">绵羊毛</div>
        <div class="aurora-dorami-composition-select-option">锦纶</div>
      </div>
    </body></html>`;
    const dom9 = new JSDOM(html9, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w9 = dom9.window;
    const d9 = dom9.window.document;
    w9.chrome = { runtime: { id: 'selftest9', lastError: null, sendMessage() {} } };
    w9.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    w9.dycWatchFlags = () => {};
    w9.isVisible = () => true;
    w9.findAllByText = () => [];
    w9.debugLog = () => {};
    const msgs9 = [];
    w9.setStatus = (v, k, o) => msgs9.push({ v, k, o });
    w9.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    const ctl9 = d9.querySelector('.aurora-dorami-composition-select');
    const sel9 = ctl9.querySelector('.composition-selection');
    const pw9 = ctl9.querySelector('.composition-percent-wrap');
    const rec = (name, pct, vid) => ({
      measure_info: { template_id: 873, values: [{ module_id: 1854, prefix: '', suffix: '', value: pct == null ? '' : String(pct) }] },
      value_id: vid || '',
      value_name: name
    });
    let value9 = [rec('棉', 98, 'c1'), rec('氨纶', 2, 'c2')];

    function render9() {
      sel9.innerHTML = '';
      pw9.innerHTML = '';
      value9.forEach((row) => {
        const chip = d9.createElement('div');
        chip.className = 'composition-select-selection-item';
        chip.textContent = row.value_name + ' ' + row.measure_info.values[0].value + '%';
        const x = d9.createElement('i');
        x.className = 'composition-select-selection-item-remove';
        chip.appendChild(x);
        sel9.appendChild(chip);
        const p = d9.createElement('input');
        p.type = 'number';
        p.className = 'composition-percent';
        pw9.appendChild(p);
      });
    }
    render9();

    /* 叉号删除走委托(真实平台同款) */
    sel9.addEventListener('click', (e) => {
      const x = e.target && e.target.closest ? e.target.closest('.composition-select-selection-item-remove') : null;
      if (!x) return;
      const chip = x.closest('.composition-select-selection-item');
      if (!chip) return;
      const idx = Array.from(sel9.children).indexOf(chip);
      chip.remove();
      const ps = pw9.querySelectorAll('input');
      if (ps[idx]) ps[idx].remove();
    });

    /* 平台行为:onChange 是「追加合并」不是替换 —— 旧代码不清空就叠加 */
    ctl9['__reactFiber$t'] = {
      return: {
        memoizedProps: {
          value: value9,
          onChange(next) {
            const arr = Array.from(next, (x) => x);
            value9 = arr.length === 0 ? [] : value9.concat(arr);
            ctl9['__reactFiber$t'].return.memoizedProps.value = value9; // React 每次渲染都会更新 props。
            render9();
          }
        }
      }
    };

    w9.eval(read('src/content/fabric-smart-fill-main.js'));
    w9.eval(read(SRC_UNDER_TEST));
    await waitFor(() => !!d9.querySelector('.dyc-fabric-btn'));
    const input9 = d9.querySelector('.dyc-fabric-input');
    const btn9 = d9.querySelector('.dyc-fabric-btn');
    input9.value = '绵羊毛40 锦纶60';
    btn9.click();
    await waitFor(() => msgs9.some((m) => m.k === 'success'), 6000);

    check('原生框只有新填的两项，旧的棉/氨纶没有叠加', () => {
      const texts = Array.from(sel9.querySelectorAll('.composition-select-selection-item'))
        .map((c) => (c.textContent || '').trim());
      assert.deepEqual(texts, ['绵羊毛 40%', '锦纶 60%'], '实际(叠加了):' + JSON.stringify(texts));
    });
    check('配比写进面板行,报成功', () => {
      const vals = Array.from(pw9.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['40', '60'], '配比:' + JSON.stringify(vals));
      assert.equal(msgs9.filter((m) => m.k === 'success').length, 1);
    });
  }

  console.log('\n【十八】面板搜索补勾 + 配比写不溢出(真机 16:25/16:26)');
  {
    /* 真机 16:25:平台 onChange 整条拒收「羊驼毛」,只进 3 项 —— 平台自己的
       「已选」面板自带搜索框,把缺的材料名打进去、精确命中那行点一下就勾上。
       真机 16:26:配比 16.3 被写进「导购短标题」(行探测器爬到页面级大容器
       误命中)—— 探测器现在必须位于面板容器内,且诱饵输入框绝不许被写。 */
    const htmlA = `<!doctype html><html><body>
      <div class="page-section">
        <input id="titleDecoy" type="text"><span>聚醋纤维 16.3%</span>
      </div>
      <div class="form-row">
        <div class="aurora-dorami-composition-select" role="combobox">
          <div class="composition-selection"></div>
          <input class="aurora-select-selection-search-input">
          <div class="composition-percent-wrap"></div>
        </div>
      </div>
      <div class="aurora-select-dropdown">
        <input class="panel-search" placeholder="搜索材质">
        <div class="panel-list">
          <div class="panel-item">羊驼毛</div>
          <div class="panel-item">绵羊毛</div>
        </div>
        <div class="selected-list"></div>
      </div>
    </body></html>`;
    const domA = new JSDOM(htmlA, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const wA = domA.window;
    const dA = domA.window.document;
    wA.chrome = { runtime: { id: 'selftestA', lastError: null, sendMessage() {} } };
    wA.dycReadFlags = () => Promise.resolve({ fabricSmartFill: true });
    wA.dycWatchFlags = () => {};
    wA.isVisible = () => true;
    wA.findAllByText = () => [];
    wA.debugLog = () => {};
    const msgsA = [];
    wA.setStatus = (v, k, o) => msgsA.push({ v, k, o });
    wA.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    const ctlA = dA.querySelector('.aurora-dorami-composition-select');
    const selA = ctlA.querySelector('.composition-selection');
    const selectedList = dA.querySelector('.selected-list');
    const rec = (name, pct, vid) => ({
      measure_info: { template_id: 873, values: [{ module_id: 1854, prefix: '', suffix: '', value: pct == null ? '' : String(pct) }] },
      value_id: vid || '',
      value_name: name
    });
    let valueA = [rec('棉', 100, 'c1')];

    function renderA() {
      selA.innerHTML = '';
      selectedList.innerHTML = '';
      valueA.forEach((row) => {
        const chip = dA.createElement('div');
        chip.className = 'composition-select-selection-item';
        chip.textContent = row.value_name + ' ' + row.measure_info.values[0].value + '%';
        selA.appendChild(chip);
        /* 已选行 = 材料名 + 「请输入」框 + %(真机 16:49 面板同款) */
        const item = dA.createElement('div');
        item.className = 'selected-item';
        item.appendChild(dA.createTextNode(row.value_name));
        const p = dA.createElement('input');
        p.type = 'text';
        p.placeholder = '请输入';
        item.appendChild(p);
        item.appendChild(dA.createTextNode('%'));
        selectedList.appendChild(item);
      });
    }
    renderA();

    ctlA['__reactFiber$t'] = {
      return: {
        memoizedProps: {
          value: valueA,
          onChange(next) {
            /* 平台行为:字典不认的材料整条丢掉(value_id 为空的丢) */
            valueA = Array.from(next, (x) => x).filter((r) => r.value_id);
            renderA();
          }
        }
      }
    };
    /* 平台面板:点材料行 = 勾选进框(平台原生交互) */
    dA.querySelectorAll('.panel-item').forEach((opt) => {
      opt.addEventListener('click', () => {
        const nm = (opt.textContent || '').trim();
        if (valueA.some((r) => r.value_name === nm)) return;
        valueA = valueA.concat([rec(nm, 100, 'panel-' + nm)]);
        renderA();
      });
    });

    wA.eval(read('src/content/fabric-smart-fill-main.js'));
    wA.eval(read(SRC_UNDER_TEST));
    await waitFor(() => !!dA.querySelector('.dyc-fabric-btn'));
    const inputA = dA.querySelector('.dyc-fabric-input');
    const btnA = dA.querySelector('.dyc-fabric-btn');

    inputA.value = '羊驼毛50 棉50';
    btnA.click();
    await waitFor(() => msgsA.some((m) => m.k === 'success'), 8000);

    check('平台拒收的「羊驼毛」通过面板搜索精确勾选补进框', () => {
      const names = Array.from(selA.querySelectorAll('.composition-select-selection-item'))
        .map((c) => (c.textContent || '').trim().split(' ')[0]).sort();
      assert.deepEqual(names, ['棉', '羊驼毛'], '实际:' + JSON.stringify(names));
    });
    check('两个材料的配比都写进「已选」面板的同行输入框', () => {
      const vals = Array.from(selectedList.querySelectorAll('input')).map((i) => i.value);
      assert.deepEqual(vals, ['50', '50'], '实际:' + JSON.stringify(vals));
    });
    check('补勾后报成功，不报部分完成', () => {
      assert.equal(msgsA.filter((m) => m.k === 'success').length, 1);
      assert.equal(msgsA.filter((m) => m.k === 'alert').length, 0);
    });

    /* —— 字典真没有时:面板现场报进提示;诱饵输入框绝不许被写 —— */
    inputA.value = '聚醋纤维50 棉50';
    btnA.click();
    await sleep(4500);

    check('搜不到时如实报缺，并把面板里实际内容带出来', () => {
      const al = msgsA.filter((m) => m.k === 'alert');
      assert.ok(al.length >= 1, '没有提示');
      const last = al[al.length - 1];
      const full = (last.v || '') + ' ' + ((last.o && last.o.full) || '');
      assert.ok(/聚醋纤维/.test(full), '没写缺的材料名:' + full);
      assert.ok(/面板搜索「聚醋纤维」的结果/.test(full), '没带面板现场:' + full);
      assert.ok(/羊驼毛 \| 绵羊毛/.test(full), '面板现场内容不对:' + full);
    });
    check('配比绝不写进页面其它输入框(诱饵守卫)', () => {
      const decoy = dA.getElementById('titleDecoy');
      assert.equal(decoy.value, '', '溢出写进了诱饵输入框:' + JSON.stringify(decoy.value));
    });
  }

  console.log('\n────────────────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('  全部通过。\n');
})();

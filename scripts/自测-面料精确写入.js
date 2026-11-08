'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
const SRC_UNDER_TEST = 'src/content/fabric-smart-fill.js';
const source = fs.readFileSync(path.join(__dirname, '..', SRC_UNDER_TEST), 'utf8');
const dom = new JSDOM(`<body>
  <input id="otherSearch" class="search" placeholder="搜索商品">
  <div class="form-row"><div id="control"><span class="selection-item">精棉 70%</span></div></div>
  <div class="aurora-select-dropdown"><input placeholder="搜索材质">
    <div class="selected-list"></div>
  </div></body>`, { runScripts: 'outside-only', url: 'https://fxg.jinritemai.com/' });
const w = dom.window, d = w.document;
w.chrome = { runtime: { id: 'test' } };
w.dycReadFlags = () => Promise.resolve({ fabricSmartFill: false });
w.dycWatchFlags = () => {};
w.isVisible = () => true;
w.eval(source.replace('window.__dycParseFabric = parseMaterials;',
  'window.testFabric = { chipHas, bridgeRendered, percentRowInput, writeItemPercents, panelExactRow, findPanelSearch, applyItems };'));
const api = w.testFabric, control = d.getElementById('control');
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('✓ ' + name); }
  catch (e) { failures++; console.error('✗ ' + name + ': ' + e.message); }
}
const values = { '精棉': '', '棉': '' };
function render(reject) {
  const list = d.querySelector('.selected-list');
  list.innerHTML = '';
  Object.keys(values).forEach(name => {
    const row = d.createElement('div');
    row.className = 'selected-item';
    row.append(name);
    const input = d.createElement('input');
    input.placeholder = '请输入';
    input.value = values[name];
    input.addEventListener('input', () => {
      if (!reject) values[name] = input.value;
      render(reject); // 模拟受控组件同步整组重绘
    });
    row.append(input, '%');
    list.append(row);
  });
}
(async () => {
  await check('材料名必须完全一致，精棉不能算棉已写入', () => {
    assert.equal(api.bridgeRendered(control, [{ name: '棉', pct: 30 }]).rendered.length, 0);
  });
  await check('面板搜索不能选中页面其它搜索框', () => {
    assert.equal(api.findPanelSearch(control).placeholder, '搜索材质');
  });
  d.getElementById('otherSearch').remove();
  render(false);
  await check('棉的配比只能写棉行，不能写精棉行', () => {
    assert.equal(api.percentRowInput('棉', control), d.querySelectorAll('.selected-item input')[1]);
  });
  await check('同步重绘后逐项配比仍写入平台状态', async () => {
    await api.writeItemPercents(control, [{ name: '精棉', pct: 70 }, { name: '棉', pct: 30 }]);
    assert.deepEqual(values, { '精棉': '70', '棉': '30' });
  });
  values['精棉'] = ''; values['棉'] = '';
  render(true);
  await check('平台拒收数字时不得报告填写成功', async () => {
    const result = await api.writeItemPercents(control, [{ name: '精棉', pct: 70 }, { name: '棉', pct: 30 }]);
    assert.equal(result.missing.length, 2);
  });
  await check('配比行出现平台必填提示时，仍按独立材料名找到两项并写入小数', async () => {
    render(false);
    d.querySelectorAll('.selected-item').forEach(row => {
      const error = d.createElement('div');
      error.setAttribute('role', 'alert');
      error.textContent = '该项为必填，请输入';
      row.append(error);
    });
    const result = await api.writeItemPercents(control, [{ name: '精棉', pct: 92.3 }, { name: '棉', pct: 7.7 }]);
    assert.equal(result.missing.length, 0);
    assert.deepEqual(values, { '精棉': '92.3', '棉': '7.7' });
  });
  d.querySelector('.selected-list').innerHTML = '<div class="option-group"><div class="option-item"><span>羊驼毛</span></div><div class="option-item">羊毛</div></div>';
  await check('嵌套字典选项仍能精确选中叶子行', () => {
    assert.equal(api.panelExactRow('羊驼毛', control).className, 'option-item');
  });
  await check('清空导致 React 状态更新后，仍能构造原样材料与配比', () => {
    w.eval(fs.readFileSync(path.join(__dirname, '..', 'src/content/fabric-smart-fill-main.js'), 'utf8'));
    const props = { value: [{ value_name: '棉', value_id: 'cotton', measure_info: { values: [{ value: '100' }] } }],
      onChange(next) { props.value = next; } };
    control['__reactFiber$test'] = { memoizedProps: props };
    assert.equal(w.__DYC_FABRIC_BRIDGE__.submit(control, []).ok, true);
    assert.equal(w.__DYC_FABRIC_BRIDGE__.submit(control, [{ name: '棉', pct: 70 }, { name: '精棉', pct: 30 }]).ok, true);
    assert.equal(props.value[0].value_id, 'cotton');
    assert.equal(props.value[1].value_name, '精棉');
    assert.equal(props.value[1].measure_info.values[0].value, '30');
  });
  await check('完整流程：绵羊毛92.3、山羊绒7.7，平台先显示必填红字再逐项落入配比', async () => {
    const props = { value: [{ value_name: '棉', value_id: 'cotton', measure_info: { values: [{ value: '100' }] } }],
      onChange(next) {
        // 现场：整组材料提交成功，但平台的配比输入框仍为空。
        props.value = Array.from(next, rec => ({ ...rec, measure_info: { values: [{ value: '' }] } }));
        renderPlatform();
      } };
    control['__reactFiber$test'] = { memoizedProps: props };
    function renderPlatform() {
      control.innerHTML = '';
      const list = d.querySelector('.selected-list');
      list.innerHTML = '';
      props.value.forEach(rec => {
        const chip = d.createElement('span');
        chip.className = 'selection-item';
        chip.append(rec.value_name + ' ' + rec.measure_info.values[0].value + '%');
        const close = d.createElement('i');
        close.className = 'remove';
        close.addEventListener('click', () => props.onChange(props.value.filter(x => x !== rec)));
        chip.append(close); control.append(chip);
        const row = d.createElement('div'); row.className = 'selected-item';
        const input = d.createElement('input'); input.placeholder = '请输入';
        input.value = rec.measure_info.values[0].value;
        input.addEventListener('input', () => {
          rec.measure_info.values[0].value = input.value; renderPlatform();
        });
        row.append(rec.value_name, input, '%'); list.append(row);
        if (!input.value) {
          const error = d.createElement('div'); error.setAttribute('role', 'alert');
          error.textContent = '该项为必填，请输入'; row.append(error);
        }
      });
    }
    renderPlatform();
    const result = await api.applyItems(control, [{ name: '绵羊毛', pct: 92.3 }, { name: '山羊绒', pct: 7.7 }]);
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(props.value, x => [x.value_name, x.measure_info.values[0].value]), [['绵羊毛', '92.3'], ['山羊绒', '7.7']]);
  });
  dom.window.close();
  process.exitCode = failures ? 1 : 0;
})();

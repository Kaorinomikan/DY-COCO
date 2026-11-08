'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
const SRC_UNDER_TEST = 'src/content/fabric-smart-fill.js';
// 真实 Aurora：外层 wrapper 无事件，内层 aurora-select 的 onMouseDown 才展开面板。
const dom = new JSDOM(`<body>
<input id="title" value="原商品标题">
<div class="aurora-dorami-composition-select-wrapper">
  <div class="aurora-select"><span class="aurora-select-selection-item">绵羊毛</span><span class="aurora-select-selection-item">山羊绒</span>
    <input class="aurora-select-input" role="combobox" aria-expanded="false" readonly type="search">
  </div>
</div>
<div class="aurora-dorami-composition-select-dropdown" hidden>
  <div class="aurora-dorami-composition-select-option-pane"><input placeholder="搜索材质"></div>
  <div class="selected-pane"></div>
</div></body>`, {runScripts:'outside-only', url:'https://fxg.jinritemai.com/'});
const w=dom.window, d=w.document;
w.chrome={runtime:{id:'test'}};
w.dycReadFlags=()=>Promise.resolve({fabricSmartFill:false});
w.dycWatchFlags=()=>{};
w.isVisible=el=>!el.closest('[hidden]');
const wrapper=d.querySelector('.aurora-dorami-composition-select-wrapper');
const select=d.querySelector('.aurora-select');
const panel=d.querySelector('.aurora-dorami-composition-select-dropdown');
const values={'绵羊毛':'','山羊绒':''};
let opens=0;
let closeOnBlur=false;
select.addEventListener('mousedown',()=>{
  opens++; panel.hidden=!panel.hidden;
  select.querySelector('input').setAttribute('aria-expanded',String(!panel.hidden));
});
function render() {
  const pane=d.querySelector('.selected-pane'); pane.innerHTML='';
  Object.keys(values).forEach(name=>{
    const row=d.createElement('div'); row.className='aurora-dorami-composition-select-selected-row';
    row.innerHTML='<div class="aurora-dorami-composition-select-selected-label"></div><div class="aurora-dorami-composition-select-extra-cell"><div class="aurora-input-number"><input role="spinbutton" class="aurora-input-number-input" placeholder="请输入"><div class="aurora-input-number-suffix">%</div></div></div><button aria-label="删除"></button><div class="aurora-dorami-composition-select-item-error">该项为必填，请输入</div>';
    row.firstChild.textContent=name;
    const input=row.querySelector('input'); input.value=values[name];
    input.addEventListener('input',()=>{
      const next=input.value;
      setTimeout(()=>{values[name]=next;render();},20);
    });
    input.addEventListener('focusout',()=>{
      // Aurora onBlur 按当前渲染状态回写；同一拍失焦会把未渲染的新值清掉。
      const rendered=values[name];
      if(input.value!==rendered) setTimeout(()=>{values[name]=rendered;render();},30);
      render();
      if(closeOnBlur){panel.hidden=true;select.querySelector('input').setAttribute('aria-expanded','false');}
    });
    pane.append(row);
  });
}
render();
const source=fs.readFileSync(path.join(__dirname,'..',SRC_UNDER_TEST),'utf8');
w.eval(source.replace('window.__dycParseFabric = parseMaterials;', 'window.testFabric={writeItemPercents};'));
(async()=>{
  const items=[{name:'绵羊毛',pct:92.3},{name:'山羊绒',pct:7.7}];
  const result=await w.testFabric.writeItemPercents(wrapper,items);
  assert.equal(result.missing.length,0,'真实 wrapper 结构下两项配比都必须写入');
  assert.deepEqual(values,{'绵羊毛':'92.3','山羊绒':'7.7'});
  assert.equal(opens,1,'只展开一次，不能重复点击关掉面板');
  await w.testFabric.writeItemPercents(wrapper,items);
  assert.equal(opens,1,'面板已开时不再点击');
  assert.equal(d.getElementById('title').value,'原商品标题');
  closeOnBlur=true;
  panel.hidden=true;select.querySelector('input').setAttribute('aria-expanded','false');
  values['绵羊毛']='';values['山羊绒']='';render();
  const again=await w.testFabric.writeItemPercents(wrapper,items);
  assert.equal(again.missing.length,0,'失焦收起后仍须写完两项，并重开核验');
  assert.deepEqual(values,{'绵羊毛':'92.3','山羊绒':'7.7'});
  console.log('✓ Aurora 外层无事件、内层 mousedown 展开后，两项小数配比写入并回读');
  console.log('✓ 面板已开不重复切换，商品标题保持原值');
  console.log('✓ 等待受控重绘后才失焦；面板收起时重开继续并核验');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>w.close());

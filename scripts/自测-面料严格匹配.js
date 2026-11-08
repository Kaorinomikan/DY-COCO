'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
let JSDOM;
try{({JSDOM}=require('jsdom'));}catch(_){({JSDOM}=require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom'));}
const SRC_UNDER_TEST='src/content/fabric-smart-fill.js';
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const make=html=>{
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://fxg.jinritemai.com/'});
  const w=dom.window;
  w.chrome={runtime:{id:'test'}};w.dycReadFlags=()=>Promise.resolve({fabricSmartFill:false});
  w.dycWatchFlags=()=>{};w.isVisible=()=>true;
  return dom;
};
const content=w=>w.eval(read(SRC_UNDER_TEST).replace('window.__dycParseFabric = parseMaterials;',
  'window.testFabric={applyItems,applyItemsAfterClear,panelExactRow,parseMaterials};'));
let fails=0;
async function check(name,fn){try{await fn();console.log('✓ '+name);}catch(e){fails++;console.error('✗ '+name+': '+e.message);}}
(async()=>{
  await check('完整材料名中的括号文字保留，不能删成另一个名字',async()=>{
    const dom=make('<body></body>');
    try{
      content(dom.window);
      for(const name of ['聚氨酯弹性纤维（氨纶）','聚丙烯腈纤维(腈纶)']){
        const r=dom.window.testFabric.parseMaterials(name+'100');
        assert.equal(r.ok,true);assert.equal(r.items[0].name,name);
      }
    }finally{dom.window.close();}
  });
  await check('Aurora 自定义原名必须同步实际 value，配比写 extra，不能继承相近材质',async()=>{
    const dom=make('<div id="control"></div>'),w=dom.window,d=w.document;
    try{
      const control=d.getElementById('control');
      const props={value:[{value:'聚氨酯弹性纤维（氨纶）',label:'聚氨酯弹性纤维（氨纶）',extra:100,templateId:873}],
        options:[{value:'粘胶纤维',label:'粘胶纤维'},{value:'棉',label:'棉'},
          {value:'聚丙烯腈纤维（腈纶）',label:'聚丙烯腈纤维（腈纶）'},
          {value:'聚氨酯弹性纤维（氨纶）',label:'氨纶',id:'alias-must-not-reuse'},
          {value:'聚氨酯弹性纤维（氨纶）',label:'聚氨酯弹性纤维（氨纶）',id:'exact-system-id'}],
        onChange(next){props.value=next;}};
      control.__reactFiber$test={memoizedProps:props};
      w.eval(read('src/content/fabric-smart-fill-main.js'));
      const items=[{name:'粘纤',pct:64.4},{name:'棉',pct:13.8},{name:'腈纶',pct:13.8},{name:'氨纶',pct:8}];
      const r=w.__DYC_FABRIC_BRIDGE__.submit(control,items);
      assert.equal(r.ok,true);
      assert.deepEqual(Array.from(props.value,x=>[x.label,x.value,Number(x.extra)]),items.map(x=>[x.name,x.name,x.pct]));
      assert.ok(props.value.every(x=>x.templateId===873));
      assert.equal(props.value[3].id,undefined,'只有显示名相同、实际值不同，也不能复用系统标识');
      w.__DYC_FABRIC_BRIDGE__.submit(control,[{name:'聚氨酯弹性纤维（氨纶）',pct:100}]);
      assert.equal(props.value[0].id,'exact-system-id','完整名字逐字相同才允许沿用系统材质');
    }finally{w.close();}
  });
  await check('字典选项只比较完整名字，搜索高亮的氨纶不能冒充长名称',async()=>{
    const dom=make(`<div id="control"></div><div class="aurora-select-dropdown"><input placeholder="搜索材质">
      <div class="aurora-select-item-option"><div class="aurora-dorami-composition-select-option-label">聚氨酯弹性纤维（<span class="option-highlight">氨纶</span>）</div></div>
      <div><input placeholder="请输入">%</div></div>`);
    try{content(dom.window);assert.equal(dom.window.testFabric.panelExactRow('氨纶',dom.window.document.getElementById('control')),null);}
    finally{dom.window.close();}
  });
  await check('第四项折叠为+1时不重复补勾，四项都继续写完配比',async()=>{
    const dom=make(`<div id="control"><input class="search"><div class="chips"></div></div>
      <div class="aurora-select-dropdown"><input placeholder="搜索材质"><div class="panel-item">氨纶</div><div class="rows"></div></div>`);
    const w=dom.window,d=w.document,control=d.getElementById('control');
    try{
      const items=[{name:'粘纤',pct:64.4},{name:'棉',pct:13.8},{name:'腈纶',pct:13.8},{name:'氨纶',pct:8}];
      const props={value:[],options:items.map(x=>({value:x.name,label:x.name,extra:0,templateId:873})),onChange(next){props.value=Array.from(next);render();}};
      let clicks=0;
      function render(){
        const chips=d.querySelector('.chips'),rows=d.querySelector('.rows');chips.innerHTML='';rows.innerHTML='';
        props.value.forEach((rec,i)=>{
          if(i<3){const chip=d.createElement('span');chip.className='selection-item';chip.textContent=rec.label;chips.append(chip);}
          const row=d.createElement('div');row.append(rec.label);const input=d.createElement('input');input.placeholder='请输入';input.value=rec.extra||'';
          input.addEventListener('input',()=>{rec.extra=input.value;});row.append(input,'%');rows.append(row);
        });
        if(props.value.length>3){const chip=d.createElement('span');chip.className='selection-item';chip.textContent='+1';chips.append(chip);}
      }
      d.querySelector('.panel-item').addEventListener('click',()=>{clicks++;props.onChange(props.value.filter(x=>x.label!=='氨纶'));});
      control.__reactFiber$test={memoizedProps:props};
      w.eval(read('src/content/fabric-smart-fill-main.js'));content(w);render();
      const r=await w.testFabric.applyItems(control,items);
      assert.equal(r.ok,true);assert.equal(clicks,0);
      assert.deepEqual(Array.from(props.value,x=>[x.label,Number(x.extra)]),items.map(x=>[x.name,x.pct]));
    }finally{w.close();}
  });
  await check('某一材料点选失败也继续后续两项，最后统一报告失败名单',async()=>{
    const dom=make(`<div id="control"><input class="search"><div class="chips"></div><div class="percent-wrap"></div></div>
      <div class="option-list"><div class="aurora-select-item-option">甲纤</div><div class="aurora-select-item-option">棉</div><div class="aurora-select-item-option">丝绸</div></div>`);
    const w=dom.window,d=w.document,control=d.getElementById('control');
    try{
      d.querySelectorAll('.aurora-select-item-option').forEach(opt=>opt.addEventListener('click',()=>{
        if(opt.textContent==='甲纤')return;
        const chip=d.createElement('span');chip.className='selection-item';chip.textContent=opt.textContent;d.querySelector('.chips').append(chip);
        const input=d.createElement('input');input.className='percent';d.querySelector('.percent-wrap').append(input);
      }));
      content(w);
      const result=await w.testFabric.applyItemsAfterClear(control,[{name:'甲纤',pct:10},{name:'棉',pct:60},{name:'丝绸',pct:30}]);
      assert.equal(result.partial,true);assert.deepEqual(Array.from(result.misses),['甲纤']);
      assert.deepEqual(Array.from(d.querySelectorAll('.selection-item'),x=>x.textContent),['棉','丝绸']);
      assert.deepEqual(Array.from(d.querySelectorAll('.percent'),x=>x.value),['60','30']);
    }finally{w.close();}
  });
  process.exitCode=fails?1:0;
})();

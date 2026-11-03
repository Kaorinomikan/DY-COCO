const fs = require('fs'), vm = require('vm'), assert = require('assert');
let source = fs.readFileSync('src/live/cart-paste.js', 'utf8');
source = source.replace('  dycReadFlags().then', `  window.test = { onClick, attach(b) { btn = b; }, mock(read, mode) {
    readClipboard = read; findEwid = () => 'test';
    fetchCartIdSet = async () => ({set:new Set(),order:[]});
    searchMyShop = async () => ({matches: mode === 'missing' ? [] : [{promotion_id:'1',product_id:'1',title:'ABC123'}]});
    bindPromotions = async (_, p) => ({ok:mode !== 'fail',added:mode === 'fail' ? [] : p});
    clickRefreshList = () => {}; sleep = async () => {};
  }};
  dycReadFlags().then`);
(async () => {
  const timers = new Map(); let id = 0;
  const c = {window:{},dycReadFlags:()=>new Promise(()=>{}),dycWatchFlags:()=>{},setTimeout:(f)=>{timers.set(++id,f);return id},clearTimeout:i=>timers.delete(i),document:{querySelectorAll:()=>[]},toast(){},setStatus(){},failStatus(){},finishStatus(){},updateProgress(){}};
  vm.runInNewContext(source,c);
  for (const [mode,read,expected] of [
    ['ok',async()=> 'ABC123','已加车 ✓'],['fail',async()=> 'ABC123','加车失败 !'],
    ['missing',async()=> 'ABC123','加车失败 !'],['ok',async()=> '', '加车失败 !'],
    ['ok',async()=> {throw Error('denied')},'加车失败 !']]) {
    const b={style:{},setAttribute(){}}; c.window.test.attach(b); c.window.test.mock(read,mode);
    const p=c.window.test.onClick({preventDefault(){},stopPropagation(){}});
    assert.equal(b.textContent,'读取中'); assert.equal(b.disabled,true);
    await p; assert.equal(b.textContent,expected); assert.equal(b.disabled,false); assert.ok(b.innerHTML.includes('<svg')); assert.ok(b.innerHTML.includes(mode === 'ok' && expected.includes('✓') ? '#16803c' : '#c03532'));
    for(const f of timers.values()) f(); timers.clear();
    assert.equal(b.textContent,'粘贴加车');
  }
  console.log('PASS: success, rejection, missing product, invalid input, clipboard failure; busy and reset');
})().catch(e=>{console.error(e);process.exit(1)});

'use strict';
// 仿真平台响应，运行 src/content/wx-stock.js 与 src/content/wx-stock-main.js 的完整请求链；不访问商家后台。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM, VirtualConsole;
try { ({JSDOM,VirtualConsole} = require('jsdom')); } catch (_) { ({JSDOM,VirtualConsole} = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
const root = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function boot(opt = {}) {
  const reloads = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => { if (/navigation/.test(error.message)) reloads.push(true); else throw error; });
  const dom = new JSDOM('<micro-app></micro-app>', {url:'https://store.weixin.qq.com/shop/goods/list?currentPage=3&currentTab=PRODUCT_STATUS_ON', virtualConsole:vc, runScripts:'outside-only', pretendToBeVisual:true});
  const w = dom.window;
  w.Headers = Headers; w.AbortController = AbortController;
  // jsdom 的 postMessage 没有 source；补成真实浏览器的同窗消息以覆盖主/隔离世界协议。
  w.postMessage = data => w.setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', {data, source:w, origin:w.location.origin})), 0);
  const sr = w.document.querySelector('micro-app').attachShadow({mode:'open'});
  sr.innerHTML = '<table><thead><tr><th>选择</th><th>商品</th><th>价格</th><th>库存</th><th>经营概览</th><th>状态</th><th>操作</th></tr></thead><tbody><tr><td></td><td><div class="goods_title_1">测试商品</div>ID: 10001848851459<span data-dyc-wx-btnwrap>ID: 999999999</span></td><td>289</td><td data-stock-cell><div class="weui-desktop-table_flex"><div class="stock-content"><span>12</span><span>待付款库存 0</span></div></div></td><td>销量</td><td>销售中</td><td>编辑</td></tr></tbody></table>';
  if (opt.nameContainer) {
    const cell = sr.querySelector('tbody tr td:nth-child(2)');
    cell.innerHTML='<div class="title"><div class="actual-name">测试商品 NE1C1063W</div><span>ID: 10001848851459</span><span>规格/编码 预览 分享</span><span data-dyc-wx-btnwrap>货号 复制链接</span></div>';
  }
  w.HTMLElement.prototype.getBoundingClientRect = () => ({width:500,height:100});
  let watch, updated = false;
  const quantities = (opt.stocks || [5,5]).map(n=>opt.zero ? 0 : n);
  const skuIds=opt.ids || quantities.map((_,i)=>String(11+i));
  const calls = [], messages = [], notes = [];
  w.__dycDiag = {note:(...args) => notes.push(args)};
  w.dycReadFlags = async () => ({wxClearStock:opt.enabled !== false});
  w.dycWatchFlags = fn => {watch = fn;};
  w.toast = (...args) => messages.push(args);
  function stock() {
    return {code:0,products:[{productSkus:quantities.map((n,i) => ({skuKey:{skuId:opt.duplicate ? '11' : skuIds[i],productKey:{productId: opt.wrongProduct ? '999999999' : '10001848851459',stockType:0}},productSkuInfo:{stockInfo:{stockNum:n,warehouseStocks: opt.warehouse ? [{}] : []}}}))}]};
  }
  w.fetch = async (url, init) => {
    const op = new URL(url, w.location.href).pathname.split('/').pop();
    const body = JSON.parse(init.body);
    calls.push({op,body,headers:init.headers});
    let data;
    if (op === 'getStockBySpu') data = stock();
    else if (op === 'batchCheckProductByTypeV2') {
      if (opt.cancel) watch({wxClearStock:false});
      data = {code:0,needDialog:!!opt.dialog,dialogContent:[]};
    } else if (op === 'checkProductEditValid') data = {code:0,success:!opt.invalid,errs:opt.invalid ? ['受限'] : [],moduleErrors:[]};
    else if (op === 'batchUpdateStock') {
      updated = true;
      if (opt.stockChanged) quantities[0] = Math.max(0,quantities[0]-1);
      const failed = [];
      for (const item of body.skuList) {
        const i=skuIds.indexOf(item.skuId);
        if (item.diffType !== 2 || !Number.isSafeInteger(item.num) || item.num <= 0 || item.num > quantities[i]) failed.push(item.skuId);
        else if (!opt.updateRejected && !opt.rejectCode && (!opt.partial || i === 0)) quantities[i] -= item.num;
      }
      data = {code:failed.length ? 3002 : 0,success:true,hasError:failed.length ? 1 : 0,list:[{code:0,err:null,failSkuId:failed,failSkuItems:failed.map(skuId=>({skuId,ret:10092}))}]};
    } else throw Error('Unexpected API '+op);
    if (opt.rejectCode && op === 'batchUpdateStock') data = {code:42,msg:'库存更新受限'};
    return {status:opt.forbidden || opt.updateRejected && op === 'batchUpdateStock' || opt.readbackFail && updated && op === 'getStockBySpu' ? 403 : 200,json:async () => {
      if (opt.nonJson && op === 'batchUpdateStock') throw Error('非 JSON');
      return data;
    }};
  };
  const dialog = fs.readFileSync(path.join(root,'src/content/dialog.js'),'utf8');
  w.eval(dialog.slice(0, dialog.indexOf('/**\n * 进度弹窗')));
  for (const f of ['src/content/wx-stock-main.js','src/content/wx-stock.js']) w.eval(fs.readFileSync(path.join(root,f),'utf8'));
  if (opt.seedHeaders) {
    await w.fetch('/shop-faas/mmecnodeproductlist/cgi/goods/getStockBySpu', {body:JSON.stringify({productIdList:['10001848851459']}), headers:{'x-biz-magic':'test-only', Cookie:'must-not-copy'}});
    calls.length = 0;
  }
  await sleep(20);
  return {w,sr,calls,messages,notes,reloads,watch: f => watch(f),close:() => w.close()};
}
async function run(opt) {
  const c = await boot(opt);
  const btn = c.sr.querySelector('[data-dyc-wx-stock]');
  assert(btn);
  btn.click(); btn.click();
  assert.equal(c.calls.length,0,'确认前不得请求库存接口');
  assert.equal(c.w.document.querySelectorAll('.dyb-panel').length,1,'重复点击只开一个确认框');
  assert(c.w.document.querySelector('.dyb-warning').textContent.includes('不可撤销'));
  c.w.document.querySelector('.dyb-btn-danger').click();
  const end = Date.now()+3000;
  while (!c.messages.length && Date.now()<end) await sleep(10);
  assert(c.messages.length, '动作必须有结果消息');
  return c;
}
(async () => {
  const sync=await run();
  /* 旧实现清空成功后 1 秒 location.reload()，整页白屏。2026-11-09 用户口径：
   * 成功只就地改这一行库存显示，失败与无需清零一律不刷新。这里留 1.5 秒
   * 观察窗口，覆盖旧实现的延时点。 */
  await sleep(1500);
  assert.equal(sync.reloads.length,0,'清零成功不得整页重载（白屏）');
  const cell=sync.sr.querySelector('[data-stock-cell]');
  assert.equal(cell.querySelectorAll('.stock-content > span')[0].textContent,'0','成功后该行可售库存显示就地改为 0');
  assert.equal(cell.querySelectorAll('.stock-content > span')[1].textContent,'待付款库存 0','同格其它读数不得被改坏');
  assert(sync.w.location.href.includes('currentPage=3&currentTab=PRODUCT_STATUS_ON'),'不得改动当前分页与标签参数');
  sync.close();
  await Promise.all([
    ...[{updateRejected:true},{readbackFail:true},{partial:true}].map(async opt => {
      const c=await run(opt); await sleep(1200);
      assert.equal(c.reloads.length,0,'提交失败或回读未确认不得刷新');
      assert.equal(c.sr.querySelector('[data-stock-cell] .stock-content > span').textContent,'12','失败不得改动库存显示');
      c.close();
    }),
    (async () => { const c=await run({zero:true}); await sleep(1200);
      assert.equal(c.reloads.length,0,'无需清零不得刷新');
      assert.equal(c.sr.querySelector('[data-stock-cell] .stock-content > span').textContent,'0','无需清零时列表显示同步为接口事实值 0');
      c.close(); })(),
    (async () => { const c=await run(); c.watch({wxClearStock:false}); await sleep(1200); assert.equal(c.reloads.length,0,'关闭功能不得触发任何重载'); c.close(); })(),
    (async () => { const c=await run(); c.w.history.pushState({},'', '?currentPage=4'); await sleep(1200); assert.equal(c.reloads.length,0,'切换分页不得触发任何重载'); c.close(); })(),
    (async () => { const c=await run(); c.sr.querySelector('[data-dyc-wx-stock]').click(); await sleep(1200); assert.equal(c.reloads.length,0,'新确认框不得被重载打断'); c.close(); })(),
    (async () => {
      const opt={}; const c=await run(opt); opt.forbidden=true;
      c.sr.querySelector('[data-dyc-wx-stock]').click(); c.w.document.querySelector('.dyb-btn-danger').click();
      const until=Date.now()+1000; while(c.messages.length<2 && Date.now()<until) await sleep(10);
      assert.equal(c.messages.length,2); await sleep(1200);
      assert.equal(c.reloads.length,0,'新操作失败时旧成功回调不得刷新页面'); c.close();
    })()
  ]);
  const nameCase=await boot({nameContainer:true});
  nameCase.sr.querySelector('[data-dyc-wx-stock]').click();
  const values=nameCase.w.document.querySelectorAll('.dyb-value');
  assert.equal(values[0].textContent,'测试商品 NE1C1063W','商品名不得混入ID和操作文案');
  assert.equal(values[1].textContent,'10001848851459');
  nameCase.w.document.querySelector('.dyb-btn-cancel').click(); nameCase.close();
  const native = JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/wx-stock-native-zero.json'),'utf8'));
  assert.equal(native.request.skuList[0].diffType,2);
  assert.equal(native.request.skuList[0].num,native.beforeObserved[0].stock);
  assert.equal(native.request.skuList[1].num,native.beforeObserved[1].stock);
  assert.equal(native.response.hasError,0);
  let replay=await run({stocks:native.request.skuList.map(s=>s.num).concat(0),ids:native.request.skuList.map(s=>s.skuId).concat('34629882518')});
  assert.deepEqual(replay.calls.find(c=>c.op==='batchUpdateStock').body,native.request,'提交应与最新原生清零抓包一致');
  assert.equal(replay.messages[0][1],'success','原生不同库存清零必须提交各自扣减量，不能提交0'); replay.close();
  let c = await run({updateRejected:true});
  assert.equal(c.messages[0][2].count,'提交被拒绝', '明确拒绝不应提示提交结果未知');
  assert(c.messages[0][2].full.includes('batchUpdateStock') && c.messages[0][2].full.includes('403'), '失败详情必须指出接口与状态');
  assert(c.notes.some(n => n.join(' ').includes('batchUpdateStock')), '诊断报告必须保留失败阶段');
  c.close();
  c=await run({rejectCode:true}); assert.equal(c.messages[0][2].count,'提交被拒绝'); assert(c.messages[0][2].full.includes('库存更新受限')); c.close();
  c=await run({readbackFail:true}); assert.equal(c.messages[0][2].count,'回读失败，需核对'); c.close();
  c=await run({updateRejected:true,nonJson:true}); assert.equal(c.messages[0][2].count,'提交被拒绝'); assert(c.messages[0][2].full.includes('403')); c.close();
  c = await run();
  assert.deepEqual(c.calls.map(x=>x.op), ['getStockBySpu','batchCheckProductByTypeV2','checkProductEditValid','batchUpdateStock','getStockBySpu']);
  const body = c.calls.find(x=>x.op==='batchUpdateStock').body;
  assert.deepEqual(body,{skuList:['11','12'].map(skuId=>({spuId:'10001848851459',skuId,diffType:2,num:5}))});
  assert.equal(c.messages.length,1); assert.equal(c.messages[0][1],'success');
  c.watch({wxClearStock:false}); assert.equal(c.sr.querySelector('[data-dyc-wx-stock]'),null);
  c.watch({wxClearStock:true}); assert(c.sr.querySelector('[data-dyc-wx-stock]')); c.close();
  for (const opt of [{dialog:true},{invalid:true},{wrongProduct:true},{duplicate:true},{warehouse:true},{forbidden:true},{cancel:true},{zero:true}]) {
    c=await run(opt); assert(!c.calls.some(x=>x.op==='batchUpdateStock'),JSON.stringify(opt)); assert.notEqual(c.messages[0][1],'success'); c.close();
  }
  c=await run({partial:true}); assert.equal(c.messages[0][1],'error'); assert(c.messages[0][2].full.includes('12')); c.close();
  c=await run({seedHeaders:true});
  assert.equal(c.calls[0].headers['x-biz-magic'],'test-only');
  assert.equal(c.calls[0].headers.cookie,undefined);
  const before = c.calls.length;
  c.w.postMessage({source:'DYC_WX_STOCK_REQ',rid:999,op:'batchUpdateStock',body:{skuList:[{spuId:'10001848851459',skuId:'11',diffType:1,num:5}]}},'*');
  c.w.postMessage({source:'DYC_WX_STOCK_REQ',rid:1000,op:'deleteProduct',body:{}},'*');
  await sleep(30); assert.equal(c.calls.length,before); c.close();
  c=await boot();
  let button=c.sr.querySelector('[data-dyc-wx-stock]');
  assert(button.closest('[data-stock-cell]'),'按钮必须在库存列');
  assert.equal(button.parentElement.style.justifyContent,'flex-end');
  assert.equal(button.parentElement.previousElementSibling.textContent,'待付款库存 0');
  button.click(); c.w.document.querySelector('.dyb-btn-cancel').click();
  await sleep(20); assert.equal(c.calls.length,0,'取消不得发送请求');
  button.click(); c.watch({wxClearStock:false}); c.w.document.querySelector('.dyb-btn-danger').click();
  await sleep(20); assert.equal(c.calls.length,0,'确认前关闭开关不得提交'); c.close();
  c=await boot(); button=c.sr.querySelector('[data-dyc-wx-stock]'); button.click();
  c.sr.querySelector('tr:last-child td:nth-child(2)').firstChild.textContent='另一个商品';
  c.sr.querySelector('tr:last-child td:nth-child(2)').childNodes[1].textContent='ID: 10001848850000';
  c.w.document.querySelector('.dyb-btn-danger').click(); await sleep(20); assert.equal(c.calls.length,0,'确认后必须仍是同一商品'); c.close();
  c=await run({stockChanged:true});
  assert.equal(c.messages[0][1],'error','库存期间变化不能误报清零成功');
  assert.equal(c.calls.filter(x=>x.op==='batchUpdateStock').length,1,'扣减失败不得自动重试造成重复扣减'); c.close();
  c=await run({stocks:[1,7,0]});
  const update=c.calls.find(x=>x.op==='batchUpdateStock').body.skuList;
  assert.deepEqual(update,[{spuId:'10001848851459',skuId:'11',diffType:2,num:1},{spuId:'10001848851459',skuId:'12',diffType:2,num:7}]);
  const validated=c.calls.find(x=>x.op==='checkProductEditValid').body.skuList.map(({salePrice,...item})=>item);
  assert.deepEqual(validated,update,'校验和提交必须使用相同的扣减量');
  assert.equal(c.messages[0][1],'success'); c.close();
  c=await boot({enabled:false}); assert.equal(c.sr.querySelector('[data-dyc-wx-stock]'),null); c.close();
  /* 显示层兜底：库存格不是「整段一个数字」（如「12 / 20」）时不许硬改，
   * 也不许因为改不动就退回整页重载。 */
  c=await boot();
  c.sr.querySelector('[data-stock-cell] .stock-content > span').textContent='12 / 20';
  c.sr.querySelector('[data-dyc-wx-stock]').click();
  c.w.document.querySelector('.dyb-btn-danger').click();
  let until=Date.now()+2000; while(!c.messages.length && Date.now()<until) await sleep(10);
  assert.equal(c.messages[0][1],'success');
  assert.equal(c.sr.querySelector('[data-stock-cell] .stock-content > span').textContent,'12 / 20','非纯数字形态不得被写坏');
  assert.equal(c.reloads.length,0,'显示改不动时也不得回退到整页重载'); c.close();
  /* 源码级护栏：清零链路不得再出现整页重载（用户 2026-11-09 口径）。
   * 注释里提到 reload 不算 —— 先剥掉注释再匹配真实调用。 */
  const code=fs.readFileSync(path.join(root,'src/content/wx-stock.js'),'utf8')
    .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  assert(!/location\s*\.\s*reload\s*\(/.test(code),
    '库存清零链路不得出现 location.reload，只许就地更新该行显示');
  console.log('微信库存清零：34 个场景通过（直提、全部规格、重复点击、开关、校验、身份、特殊库存、部分失败、不重载就地更新）。');
})().catch(e=>{console.error(e);process.exit(1);});

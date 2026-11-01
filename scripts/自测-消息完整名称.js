const fs=require('fs'),vm=require('vm'),assert=require('assert');
function fn(file,name){const s=fs.readFileSync(file,'utf8'),start=s.indexOf('function '+name+'('),end=s.indexOf('\n  }',start); assert(start>=0&&end>start); const c={};vm.runInNewContext(s.slice(start,end+4)+';this.f='+name,c); return c.f;}
const name='超长商品名称'.repeat(10)+'C1977';
let failed=0;
for(const [file,method,arg,want] of [
 ['src/content/channel-stock.js','extractChannelTitle',{textContent:name+' 渠道ID 123456789012'},name],
 ['src/content/channel-offline-delete.js','rowTitle',{textContent:name+' 渠道ID 123456789012'},name],
 ['src/live/search.js','shortKw','  '+name+'  ',name]]){
 try{assert.equal(fn(file,method)(arg),want)}catch(e){failed++;console.error(method+': '+e.message)}
}
const l=fs.readFileSync('src/live/locate.js','utf8');const c={};vm.runInNewContext(l.slice(l.indexOf('const NAME_PRICE_WORDS'),l.indexOf('// ==================== 卖点段切取'))+';this.f=getProductName',c);
try{assert.equal(c.f({innerText:name+' ID ￥99'}),name)}catch(e){failed++;console.error('getProductName: '+e.message)}
const loop=fs.readFileSync('src/live/auto-loop-lecture.js','utf8');
const rc={$$:()=>[],txt:r=>r.text};
for(const n of ['cleanName','rowName']){const a=loop.indexOf('function '+n+'('),b=loop.indexOf('\n  }',a);vm.runInNewContext(loop.slice(a,b+4),rc);}
try{assert.equal(rc.rowName({text:name}),name)}catch(e){failed++;console.error('rowName: '+e.message)}
if(failed)process.exit(1);console.log('PASS: channel stock, channel delete, search keyword, locate long names');

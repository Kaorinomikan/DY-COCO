'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const locate = fs.readFileSync('src/live/locate.js', 'utf8');
const code = locate.slice(locate.indexOf('const NAME_PRICE_WORDS'), locate.indexOf('// ==================== 卖点段切取'));
const ctx = {}; vm.runInNewContext(code + '\nthis.nameOf = getProductName;', ctx);
let failures = 0;
for (const [input, want] of [
 ['真皮休闲鞋厚底百搭增高松糕饼干鞋29694 ID 高点击率','真皮休闲鞋厚底百搭增高松糕饼干鞋29694'],
 ['高点击率 休闲鞋29694 ID 货号 高成交','休闲鞋29694'],
 ['休闲鞋29694 货号 ID 讲解中','休闲鞋29694'],
 ['ANDROID ID','ANDROID ID'],['NIKE ID','NIKE ID'],
 ['休闲鞋29694 ID 123456 库存 999','休闲鞋29694'],
 ['库存 999 高点击率 休闲鞋29694 ￥99 设置卖点 轻便','休闲鞋29694']
]) {
 try { assert.equal(ctx.nameOf({innerText:input}),want); }
 catch(e) { failures++; console.error(e.message); }
}
const loop = fs.readFileSync('src/live/auto-loop-lecture.js','utf8');
const short = loop.slice(loop.indexOf('  function shortName('),loop.indexOf('  /** 距最近档位'));
const c={}; vm.runInNewContext(short+'\nthis.nameOf=shortName;',c);
for(const name of ['简约松紧腰休闲裤通勤风纯色长裤C1977','简约松紧腰休闲裤通勤风纯色长裤C1978']) {
 try { assert.equal(c.nameOf('【店铺】'+name),name); }
 catch(e) { failures++; console.error(e.message); }
}
if(failures) process.exit(1);
console.log('PASS: 7 name-cleaning and 2 full-name cases');

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = require('node:path').join(__dirname, '..')+'/';
const spend = fs.readFileSync(base+'SpendWidget/SpendWidget.js','utf8');
const quick = fs.readFileSync(base+'QuickActions/QuickActions.js','utf8');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
new AsyncFunction(spend); new AsyncFunction(quick);
const files = new Map();
const directories = new Set(['/docs']);
const fm = {
 documentsDirectory:()=>'/docs', joinPath:(a,b)=>a+'/'+b,
 fileExists:p=>files.has(p)||directories.has(p),
 createDirectory:p=>directories.add(p), isDirectory:p=>directories.has(p),
 writeString:(p,s)=>files.set(p,s), readString:p=>{assert(files.has(p));return files.get(p)},
 move:(a,b)=>{assert(files.has(a));if(files.has(b))throw new Error('exists');files.set(b,files.get(a));files.delete(a)},remove:p=>{files.delete(p)},
 listContents:p=>[...new Set([...directories,...files.keys()].filter(x=>x.startsWith(p+'/')).map(x=>x.slice(p.length+1).split('/')[0]))]
};
let id=0;
const ctx=vm.createContext({Color:class{},FileManager:{local:()=>fm},UUID:{string:()=>`test-${++id}`}});
vm.runInContext(spend.split('// ===== MAIN =====')[0],ctx);
const parse=(source,raw)=>ctx.parseNotification({source,raw,tooLong:false});
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name)}
check('Octopus ignores balance',()=>{const p=parse('Octopus','HK$10.00 for Train\nYour new balance is HK$100.00.');assert.equal(p.amountMinor,1000);assert.equal(p.merchant,'Train');assert.equal(ctx.categoryOf(p.merchant),'Транспорт')});
check('Mox and food category',()=>{const p=parse('Mox','You spent HKD 25.50 at Example Cafe, earning cashback');assert.equal(p.amountMinor,2550);assert.equal(p.merchant,'Example Cafe');assert.equal(ctx.categoryOf(p.merchant),'Еда')});
check('SC and unknown source require review',()=>{for(const s of ['SC','Unknown'])assert.equal(parse(s,'Payment HKD 20').status,'review')});
check('Alipay excluded',()=>assert.equal(parse('Alipay','Payment 20').status,'ignored'));
check('OTP redacted from persisted event',()=>{const e=ctx.createEvent({source:'Mox',raw:'Your verification code is 123456',tooLong:false},new Date());assert.equal(e.status,'ignored');assert(!e.raw.includes('123456'))});
check('Top-ups require review',()=>{assert.equal(parse('Octopus','Top-up HK$100').status,'review');assert.equal(parse('Mox','You spent HKD 100 at Octopus').status,'review')});
check('Refund and decline require review',()=>{for(const t of ['Refunded HKD 10','Payment declined'])assert.equal(parse('Mox',t).status,'review')});
check('Invalid and truncated input require review',()=>{assert.equal(parse('Mox','text').status,'review');assert.equal(parse('Mox','You spent HKD 20 at Cafe...').status,'review');assert.equal(ctx.parseNotification({source:'Mox',raw:'text',tooLong:true}).status,'review')});
check('Input dictionary and text formats',()=>{assert.equal(ctx.unpackInput({source:'Mox',message:'You spent HKD 20 at Cafe'}).source,'Mox');assert.equal(ctx.unpackInput('Octopus\nHK$10 for Train').source,'Octopus')});
check('Decimal and currency validation',()=>{assert.equal(ctx.parseMinor('1,234.56','HKD'),123456);assert.equal(ctx.parseMinor('12,50','HKD',true),1250);assert.throws(()=>ctx.parseMinor('0','HKD'));assert.throws(()=>ctx.parseMinor('1.5','JPY'))});
check('Calendar dates',()=>{assert(!ctx.validDay('2026-02-30'));assert(ctx.validDay('2024-02-29'))});
check('Duplicate and distinct purchases',()=>{const sample={status:'expense',origin:'notification',source:'Mox',currency:'HKD',amountMinor:2500,merchant:'Example Cafe',confirmed:false};const ds=ctx.resolveDuplicates([{...sample,id:'a',receivedAt:'2026-10-01T00:00:00Z'},{...sample,id:'b',receivedAt:'2026-10-01T00:01:00Z'},{...sample,id:'c',receivedAt:'2026-10-01T00:03:00Z'}]);assert.equal(ds[1].status,'review');assert.equal(ds[2].status,'expense')});
check('Merchant learning persists',()=>{ctx.teachMerchant('Example Shop','Еда');assert.equal(ctx.categoryOf('Example Shop'),'Еда')});
check('Persist, load and replace override',()=>{const e=ctx.createEvent({source:'Mox',raw:'You spent HKD 25 at Example Cafe',tooLong:false},new Date('2026-10-01T12:00:00'));ctx.saveEvent(e);assert.equal(ctx.loadMonth(e.day).events.length,1);ctx.saveOverride(e,{status:'ignored'});assert.equal(ctx.loadMonth(e.day).events[0].status,'ignored');ctx.saveOverride(e,{status:'expense',confirmed:true});assert.equal(ctx.loadMonth(e.day).events[0].status,'expense')});
check('Uncategorized merchants listed by amount',()=>{const now=new Date();for(const t of ['You spent HKD 80 at Lan Fong Yuen','You spent HKD 20 at Lan Fong Yuen','You spent HKD 300 at Tak Kee'])ctx.saveEvent(ctx.createEvent({source:'Mox',raw:t,tooLong:false},now));const u=ctx.uncategorized(ctx.localDay(now));assert.equal(u[0].merchant,'Tak Kee');assert.equal(u[1].count,2);ctx.teachMerchant('Lan Fong Yuen','Еда');assert(!ctx.uncategorized(ctx.localDay(now)).some(x=>x.merchant==='Lan Fong Yuen'))});
check('Repeated category and override writes overwrite files',()=>{ctx.teachMerchant('Repeat Shop','Еда');ctx.teachMerchant('Repeat Shop','Покупки');ctx.teachMerchant('Other Shop','Услуги');assert.equal(ctx.categoryOf('Repeat Shop'),'Покупки');assert(![...files.keys()].some(k=>k.endsWith('.tmp')))});
check('Alipay and WeChat follow settings, CNY parsing',()=>{
 assert.equal(parse('Alipay','你在全家消费了¥25.00').status,'ignored');
 assert.equal(parse('WeChat','微信支付 ¥18.00').status,'review');
 ctx.saveSettings({alipay:'parse',wechat:'parse'});
 let p=parse('Alipay','支付宝 你在全家便利店消费了¥25.50，余额¥1,000.00');assert.equal(p.status,'expense');assert.equal(p.currency,'CNY');assert.equal(p.amountMinor,2550);assert.equal(p.merchant,'全家便利店');assert.equal(ctx.categoryOf(p.merchant),'Еда');
 p=parse('WeChat','微信支付 支付成功 ¥36.00 商户：瑞幸咖啡');assert.equal(p.amountMinor,3600);assert.equal(p.merchant,'瑞幸咖啡');
 p=parse('WeChat','向美团付款 58.80元');assert.equal(p.amountMinor,5880);assert.equal(p.merchant,'美团');assert.equal(ctx.categoryOf(p.merchant),'Еда');
 p=parse('Alipay','付款成功 ¥12.00');assert.equal(p.merchant,'Alipay');
 for(const t of ['你收到一笔转账 ¥100.00','退款到账 ¥20.00','余额宝收益 0.52元'])assert.equal(parse('Alipay',t).status,'review');
 assert.equal(ctx.sourceName('微信支付'),'WeChat');
 ctx.saveSettings({alipay:'ignore',wechat:'review'});
});
check('CNY base converts HKD and keeps CNY',()=>{
 ctx.saveSettings({base:'CNY'});
 assert.equal(ctx.BASE(),'CNY');
 const s=ctx.hkdSummary([{day:'2026-10-01',status:'expense',currency:'CNY',amountMinor:1000},{day:'2026-10-01',status:'expense',currency:'HKD',amountMinor:1000}],'2026-10-01',{rates:{HKD:1.1}});
 assert(Math.abs(s.sums.today-(10+10/1.1))<1e-9);
 assert(ctx.shortHKD(5).startsWith('¥'));
 ctx.saveSettings({base:'HKD'});assert(ctx.shortHKD(5).startsWith('HK$'));
});
check('Refund and FX totals',()=>{const events=[{day:'2026-10-01',status:'expense',currency:'HKD',amountMinor:1000},{day:'2026-10-01',status:'refund',currency:'HKD',amountMinor:200},{day:'2026-10-01',status:'expense',currency:'JPY',amountMinor:2000}];assert.equal(ctx.hkdSummary(events,'2026-10-01',{rates:{JPY:20}}).sums.today,108)});
const nodes=[];
class Node {
 constructor(){this.children=[];nodes.push(this)}
 addStack(){const n=new Node();this.children.push(n);return n}
 addSpacer(x){this.children.push({spacer:x})}
 addText(t){const n=new Node();n.text=t;return n}
 addImage(img){const n=new Node();n.img=img;this.children.push(n);return n}
 layoutVertically(){} layoutHorizontally(){} setPadding(){} applyFittingContentMode(){}
 async presentMedium(){}
}
class DrawContext {setFont(){} setTextColor(){} setTextAlignedCenter(){} drawTextInRect(t,r){this.text=t;this.rect=r} getImage(){return {text:this.text,rect:this.rect}}}
let widget;
const mock={ListWidget:Node,Color:class{},Size:class{constructor(w,h){this.width=w;this.height=h}},Rect:class{constructor(x,y,w,h){Object.assign(this,{x,y,width:w,height:h})}},DrawContext,Font:{semiboldSystemFont:()=>({}),systemFont:()=>({})},SFSymbol:{named:s=>({image:{symbol:s},applyFont(){}})},config:{runsInApp:false},Script:{setWidget:w=>widget=w,complete(){}},encodeURIComponent};
check('QuickActions renders six buttons and encoded URLs',()=>{vm.runInNewContext('(async()=>{'+quick+'})()',mock);const tiles=nodes.filter(n=>n.size?.height===61&&n.size?.width===104);assert.equal(tiles.length,6);assert.equal(new Set(tiles.map(t=>t.url)).size,6);assert.equal(tiles.filter(t=>t.url.startsWith('shortcuts://run-shortcut?name=QA%20')).length,4);assert.equal(nodes.filter(n=>n.img?.text).length,6);assert(widget)});
check('Categories default and explicit overview',()=>{for(const p of [undefined,null,'','   ','CATEGORIES','categories','typo'])assert.equal(ctx.widgetMode(p),'CATEGORIES');assert.equal(ctx.widgetMode(' overview '),'OVERVIEW')});
check('Food always visible and other totals conserved',()=>{const rows=ctx.categoryRows({'Еда':10,'Покупки':500,'Транспорт':400,'Поездки':300,'Здоровье':200,'Услуги':100,'Без категории':50});assert.equal(rows[0][0],'Еда');assert.equal(rows[0][1],10);assert.equal(rows[3][0],'Прочее');assert.equal(rows[3][1],650);assert.equal(rows.reduce((s,r)=>s+r[1],0),1560);const empty=ctx.categoryRows({});assert.equal(empty[0][0],'Еда');assert.equal(empty[3][0],'Прочее');assert(empty.every(r=>r[1]===0));const refund=ctx.categoryRows({'Еда':-10,'Здоровье':-20});assert.equal(refund.reduce((s,r)=>s+r[1],0),-30)});
check('Default widget renders Food and Other without parameter',()=>{Object.assign(ctx,{ListWidget:Node,Font:{semiboldSystemFont:()=>({}),systemFont:()=>({})},URLScheme:{forRunningScript:()=> 'scriptable://'},});Node.prototype.centerAlignContent=function(){};const start=nodes.length;ctx.renderWidget({events:[],errors:[]},{rates:{HKD:1}});const text=nodes.slice(start).map(n=>n.text).filter(Boolean);assert(text.includes('Еда'));assert(text.includes('Прочее'));assert(text.includes('SPEND  /  КАТЕГОРИИ'))});
check('Octopus merchant with digits',()=>{const p=parse('Octopus','HK$35.00 for 7-Eleven. Your new balance is HK$65.00.');assert.equal(p.status,'expense');assert.equal(p.merchant,'7-Eleven')});
check('Empty automation input is not saved',()=>{assert.equal(ctx.ingest(''),'Пусто: не записано');assert.equal(ctx.ingest({source:'Mox',message:''}),'Пусто: не записано')});
check('QuickActions direct URL overrides shortcut',()=>{const src=quick;nodes.length=0;vm.runInNewContext('(async()=>{'+src+'})()',mock);const tiles=nodes.filter(n=>n.size?.height===61&&n.size?.width===104);assert(tiles[1].url.startsWith('https://www.notion.so/'));assert(tiles[5].url.startsWith('https://joom-team.slack.com/'));assert(tiles[0].url.startsWith('shortcuts://run-shortcut?name=QA%20'))});
check('Publication contains no personal balance or credential patterns',()=>{for(const s of [spend,quick]){assert(!s.includes('954.40'));assert(!/gh[pousr]_[A-Za-z0-9]+|github_pat_|xox[baprs]-|sk-[A-Za-z0-9]{20,}|BEGIN .*PRIVATE KEY/.test(s))}});
console.log(`${checks} checks passed; both scripts parse. iPhone runtime and rendering still require device verification.`);

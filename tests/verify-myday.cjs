const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../MyDayWidget/MyDayWidget.js'),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
new AsyncFunction(source);
const fixed=new Date(2026,9,12,12).getTime();
class Clock extends Date {constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}
function at(day,hour){return new Date(2026,9,day,hour)}
function event(id,day,start,end,title='Example meeting'){return {identifier:id,title,startDate:at(day,start),endDate:at(day,end),isAllDay:false,calendar:{color:'blue'}}}
async function run(events,{parameter='Work',calendars=[{title:'Work'}],cache=null}={}){
 const labels=[];let completed=false;let shown=false;
 class Stack{addStack(){return new Stack()}addText(t){labels.push(String(t));return {}}addImage(){return {}}addSpacer(){}centerAlignContent(){}layoutVertically(){}setPadding(){}async presentMedium(){shown=true}}
 const fm={joinPath:(a,b)=>a+'/'+b,documentsDirectory:()=>'/docs',fileExists:()=>!!cache,readString:()=>JSON.stringify(cache),writeString(){throw new Error('No weather request expected')}};
 const context={args:{widgetParameter:parameter},Date:Clock,Color:class{},FileManager:{local:()=>fm},ListWidget:Stack,Font:{semiboldSystemFont:()=>({}),systemFont:()=>({})},Size:class{},SFSymbol:{named:()=>({image:{}})},Location:{setAccuracyToThreeKilometers(){},async current(){throw new Error('Location disabled in test')}},Calendar:{async forEvents(){return calendars}},CalendarEvent:{async between(a,b,selected){assert.equal(selected.length,1);return events.filter(e=>e.startDate>=a&&e.startDate<b)}},Script:{setWidget(){},complete(){completed=true}},config:{runsInApp:true}};
 const result=await vm.runInNewContext('(async()=>{'+source+'\nreturn {agenda,agendaError,weather};})()',context);
 assert(completed&&shown);return {...result,labels};
}
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name)}
(async()=>{
 await check('Today: ongoing meeting, sorting and duplicates',async()=>{const a=event('active',12,11,13);const r=await run([event('later',12,15,16),a,a,event('finished',12,8,9)]);assert(r.agenda.isToday);assert.equal(r.agenda.count,3);assert.equal(r.agenda.events.length,2);assert.equal(r.agenda.events[0].identifier,'active');assert(r.labels.includes('СЕЙЧАС'))});
 await check('Completed day selects nearest future agenda',async()=>{const r=await run([event('finished',12,8,9),event('future',14,10,11),event('later',15,10,11)]);assert(!r.agenda.isToday);assert.equal(r.agenda.date.getDate(),14);assert.equal(r.agenda.events[0].identifier,'future')});
 await check('No meetings in next seven days',async()=>{const r=await run([event('too-far',20,10,11)]);assert.equal(r.agenda.events.length,0);assert(r.labels.includes('В ближайшие 7 дней встреч нет'))});
 await check('All-day, holidays, out-of-office and cancellations filtered',async()=>{const titles=['Non-working day','Out of Office','Отпуск','Canceled: Example'];const list=titles.map((t,i)=>event('excluded-'+i,12,15,16,t));list.push({...event('all-day',12,15,16),isAllDay:true});assert.equal((await run(list)).agenda.events.length,0)});
 await check('Missing calendar parameter shown clearly',async()=>{const r=await run([],{parameter:''});assert(r.agendaError.includes('Parameter'));assert(r.labels.includes('Укажи имя календаря в Parameter'))});
 await check('Unknown calendar name handled',async()=>{const r=await run([],{parameter:'Missing'});assert.equal(r.agendaError,'Выбранный календарь не найден')});
 await check('Cached weather renders without external request',async()=>{const r=await run([],{cache:{ts:fixed,data:{temp:25,code:0,high:28,low:22,rain:10}}});assert.equal(r.weather.temp,25);assert(r.labels.includes('25°  Ясно'))});
 await check('Public source has no embedded account or credentials',async()=>{assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(source));assert(!/github_pat_|xox[baprs]-|BEGIN .*PRIVATE KEY/.test(source));assert(source.includes("args.widgetParameter || ''"))});
 console.log(checks+' MyDay checks passed. iPhone rendering and permissions require device verification.');
})().catch(e=>{console.error(e);process.exitCode=1});

// MyDay v9 — Scriptable medium widget
// Work calendar, today's weather, next nonempty day when today's meetings are over.
// Set the exact calendar title in this field or in the widget Parameter.
const WORK_CALENDAR_NAME = String(args.widgetParameter || '').trim();
const DAYS_AHEAD = 7;
const WEATHER_CACHE_MINUTES = 45;
const LOCATION_CACHE_MINUTES = 180; // GPS — самое дорогое по батарее, берём редко
const RAIN_ALERT = 50;
const AQHI_STATION = 'Eastern'; // станция EPD: Eastern — Тин Хау / Куорри-Бэй
const AQHI_ALERT = 7;
const WIND_ALERT = 11; // м/с — сильный ветер
const TOMORROW_FROM_HOUR = 18; // с этого часа вторая строка — прогноз на завтра
const C = {bg:'#101825', mint:'#86E0CE', white:'#F6F8FC', muted:'#A2B1C3', amber:'#E9B87D', line:'#2A3849'};
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), 'myday-weather-cache.json');
const now = new Date();

function txt(stack,value,size=11,color=C.white,bold=false){
  const t=stack.addText(String(value));
  t.font=bold?Font.semiboldSystemFont(size):Font.systemFont(size);
  t.textColor=new Color(color); t.lineLimit=1; t.minimumScaleFactor=0.65; return t;
}
function hhmm(date){const d=new Date(date);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function condition(code){if(code===0)return 'Ясно';if(code<=3)return 'Облачно';if(code<=48)return 'Туман';if(code<=67)return 'Дождь';if(code<=77)return 'Снег';if(code<=82)return 'Ливни';if(code<=86)return 'Снег';if(code>=95)return 'Гроза';return 'Погода';}
function dayStart(d){const v=new Date(d);v.setHours(0,0,0,0);return v;}
function addDays(d,n){const v=new Date(d);v.setDate(v.getDate()+n);return v;}
function dayLabel(d){
  const diff=Math.round((dayStart(d)-dayStart(now))/86400000);
  if(diff===1)return 'ЗАВТРА · РАСПИСАНИЕ';
  return d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
}
function calshow(date){return 'calshow:'+(Math.floor(new Date(date).getTime()/1000)-978307200);}
function excluded(e){
  const title=(e.title||'').trim().toLowerCase();
  if(e.isAllDay || /non[- ]working days?|out of office|ooo|holiday|праздник|нерабоч(ий|ие|ая)|отпуск|^canceled:|^cancelled:/.test(title))return true;
  // Встречи, которые ты отклонил
  const me=(e.attendees||[]).find(a=>a&&a.isCurrentUser);
  return !!(me && String(me.status||'').toLowerCase()==='declined');
}
// Ссылка на звонок из места, описания или URL встречи
function meetingLink(e){
  const text=[e.location,e.notes,e.url].filter(Boolean).join(' ');
  const m=text.match(/https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/[^\s<>"')]+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')]+|teams\.live\.com\/meet\/[^\s<>"')]+|app\.slack\.com\/huddle\/[^\s<>"')]+|telemost\.yandex\.ru\/j\/[^\s<>"')]+)/i);
  return m?m[0]:null;
}
function untilText(start){
  const min=Math.round((start-now)/60000);
  if(min<1||min>180)return null;
  if(min<60)return 'через '+min+' мин';
  const h=Math.floor(min/60),r=min%60;
  return 'через '+h+' ч'+(r?' '+r+' мин':'');
}
function readCache(){try{if(fm.fileExists(cachePath))return JSON.parse(fm.readString(cachePath));}catch(e){}return {};}
async function getPosition(cache){
  if(cache.pos && Date.now()-cache.pos.ts<LOCATION_CACHE_MINUTES*60000)return cache.pos;
  try{
    Location.setAccuracyToThreeKilometers();
    const p=await Location.current();
    return {lat:p.latitude,lon:p.longitude,ts:Date.now()};
  }catch(e){return cache.pos||null;}
}
// Сигналы Обсерватории Гонконга (тайфун, дождь, жара и т.п.)
async function hkWarnings(pos){
  if(!pos||pos.lat<22.1||pos.lat>22.6||pos.lon<113.8||pos.lon>114.5)return [];
  const r=await new Request('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en').loadJSON();
  const names={WTCSGNL:'Тайфун',WRAIN:'Ливень',WTS:'Гроза',WHOT:'Жара',WCOLD:'Холод',WFIRE:'Пожароопасно',WMSGNL:'Муссон',WL:'Оползни',WTMW:'Цунами',WFROST:'Заморозки',WFNTSA:'Затопление'};
  return Object.keys(r||{}).filter(k=>names[k]).map(k=>{
    const code=String(r[k].code||'');
    let s=names[k];
    if(k==='WTCSGNL'){const n=code.match(/\d+/);if(n)s+=' T'+n[0];}
    if(k==='WRAIN'){s+={WRAINA:' янтарный',WRAINR:' красный',WRAINB:' чёрный'}[code]||'';}
    return s;
  });
}
// Индекс качества воздуха EPD (1–10+), только в Гонконге
async function hkAqhi(pos){
  if(!pos||pos.lat<22.1||pos.lat>22.6||pos.lon<113.8||pos.lon>114.5)return null;
  const list=await new Request('https://dashboard.data.gov.hk/api/aqhi-individual?format=json').loadJSON();
  const row=(list||[]).find(x=>x.station===AQHI_STATION)||(list||[])[0];
  const v=row?parseInt(String(row.aqhi),10):NaN;
  return Number.isFinite(v)?v:null;
}
async function getWeather(){
  const cache=readCache();
  // Кэш старого формата (без ветра) считаем устаревшим
  if(cache.ts && Date.now()-cache.ts<WEATHER_CACHE_MINUTES*60000 && cache.data && cache.data.unit==='ms' && cache.data.tmr)return cache.data;
  try{
    const pos=await getPosition(cache);
    if(!pos)throw new Error('no position');
    const url='https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(pos.lat)+'&longitude='+encodeURIComponent(pos.lon)+'&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&wind_speed_unit=ms&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunset&forecast_days=2&timezone=auto';
    const r=await new Request(url).loadJSON();
    const d={temp:Math.round(r.current.temperature_2m),code:r.current.weather_code,high:Math.round(r.daily.temperature_2m_max[0]),low:Math.round(r.daily.temperature_2m_min[0]),rain:r.daily.precipitation_probability_max[0],wind:Math.round(r.current.wind_speed_10m),hum:Math.round(r.current.relative_humidity_2m),warnings:[],unit:'ms'};
    const D=r.daily;if(D.time&&D.time.length>1)d.tmr={high:Math.round(D.temperature_2m_max[1]),low:Math.round(D.temperature_2m_min[1]),rain:D.precipitation_probability_max[1],wind:Math.round(D.wind_speed_10m_max[1])};
    const ss=r.daily.sunset&&r.daily.sunset[0];if(ss)d.sunset=String(ss).slice(11,16);
    try{d.warnings=await hkWarnings(pos);}catch(e){}
    try{d.aqhi=await hkAqhi(pos);}catch(e){}
    fm.writeString(cachePath,JSON.stringify({ts:Date.now(),data:d,pos}));return d;
  }catch(e){return cache.data||null;}
}
async function getAgenda(){
  if(!WORK_CALENDAR_NAME)throw new Error('Укажи имя календаря в Parameter');
  const calendars=await Calendar.forEvents();
  const selected=calendars.filter(c=>c.title.toLowerCase()===WORK_CALENDAR_NAME.toLowerCase());
  if(!selected.length)throw new Error('Выбранный календарь не найден');
  const first=dayStart(now), end=addDays(first,DAYS_AHEAD+1);
  const items=await CalendarEvent.between(first,end,selected);
  const seen=new Set();
  const valid=items.filter(e=>{
    if(excluded(e))return false;
    const key=e.identifier+'|'+e.startDate.getTime();
    if(seen.has(key))return false;seen.add(key);return true;
  }).sort((a,b)=>a.startDate-b.startDate);
  const todayAll=valid.filter(e=>e.startDate>=first && e.startDate<addDays(first,1));
  const tomorrowFirst=valid.find(e=>e.startDate>=addDays(first,1) && e.startDate<addDays(first,2))||null;
  const todayUpcoming=todayAll.filter(e=>e.endDate>now);
  if(todayUpcoming.length)return {date:first,events:todayUpcoming,count:todayAll.length,isToday:true,todayAll,tomorrowFirst};
  for(let offset=1;offset<=DAYS_AHEAD;offset++){
    const d=addDays(first,offset), next=addDays(d,1);
    const dayEvents=valid.filter(e=>e.startDate>=d && e.startDate<next);
    if(dayEvents.length)return {date:d,events:dayEvents,count:dayEvents.length,isToday:false,todayAll};
  }
  return {date:first,events:[],count:todayAll.length,isToday:true,finished:todayAll.length>0,todayAll};
}
// Свободное окно до следующей встречи (с текущего момента или с конца текущей)
function dur(min){const h=Math.floor(min/60),m=min%60;return [h?h+' ч':'',m||!h?m+' мин':''].filter(Boolean).join(' ');}
function freeWindow(agenda){
  if(!agenda||!agenda.isToday)return null;
  const active=agenda.events.find(e=>e.startDate<=now&&e.endDate>now);
  const next=agenda.events.find(e=>e.startDate>now);
  if(!next)return null;
  const from=active?active.endDate:now;
  const min=Math.round((next.startDate-from)/60000);
  if(min<15)return null;
  return (active?'после: окно ':'свободно ')+dur(min);
}
// Следующее обновление: ближайшее начало/конец встречи, но не реже чем раз в 30 мин
function nextRefresh(agenda){
  let t=Date.now()+30*60000;
  if(agenda){
    for(const e of agenda.todayAll||[]){
      for(const b of [e.startDate.getTime(),e.endDate.getTime()]){
        if(b>Date.now()+60000&&b<t)t=b+5000;
      }
    }
  }
  return new Date(t);
}

const widget=new ListWidget();
widget.backgroundColor=new Color(C.bg);widget.setPadding(12,14,10,14);
widget.url=calshow(now);
const head=widget.addStack();head.centerAlignContent();
const ico=head.addImage(SFSymbol.named('calendar').image);ico.imageSize=new Size(12,12);ico.tintColor=new Color(C.mint);
head.addSpacer(6);txt(head,'МОЙ ДЕНЬ',10,C.mint,true);head.addSpacer();
txt(head,now.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).toUpperCase(),9,C.muted,true);
widget.addSpacer(7);
const summary=widget.addStack();summary.centerAlignContent();
const weatherStack=summary.addStack();weatherStack.layoutVertically();
const weather=await getWeather();
if(weather){
  const top=weatherStack.addStack();top.bottomAlignContent();
  txt(top,weather.temp+'°  '+condition(weather.code),15,C.white,true);
  if(weather.sunset){
    top.addSpacer(8);
    const si=top.addImage(SFSymbol.named('sunset.fill').image);si.imageSize=new Size(11,11);si.tintColor=new Color(C.muted);
    top.addSpacer(2);txt(top,weather.sunset,9,C.muted);
  }
  if(weather.aqhi!=null){
    top.addSpacer(6);
    txt(top,'AQHI '+weather.aqhi,9,weather.aqhi>=AQHI_ALERT?C.amber:weather.aqhi<=3?C.mint:C.muted,true);
  }
  // Ветер и влажность; в старом кэше их нет — строка появится после обновления погоды
  const air=[weather.wind!=null?'💨 '+weather.wind+' м/с':null,weather.hum!=null?'💧 '+weather.hum+'%':null].filter(Boolean).join('  ');
  const warn=(weather.warnings||[]).concat(weather.aqhi>=AQHI_ALERT?['воздух '+weather.aqhi+' — не бегай на улице']:[]).join(' · ');
  if(warn)txt(weatherStack,'⚠ '+warn,9,C.amber,true);
  else if(weather.rain>=RAIN_ALERT)txt(weatherStack,'☂ возьми зонт · '+weather.rain+'%'+(air?'  '+air:''),9,C.amber);
  else if(weather.tmr&&now.getHours()>=TOMORROW_FROM_HOUR){const t=weather.tmr;txt(weatherStack,'завтра ↑'+t.high+'° ↓'+t.low+'°  ☂ '+t.rain+'%  💨 до '+t.wind+' м/с',9,t.rain>=RAIN_ALERT||t.wind>=WIND_ALERT?C.amber:C.muted);}
  else txt(weatherStack,'↑'+weather.high+'° ↓'+weather.low+'°  ☂ '+weather.rain+'%'+(air?'  '+air:''),9,weather.wind>=WIND_ALERT?C.amber:C.muted);
}
else{txt(weatherStack,'Погода недоступна',11,C.amber);txt(weatherStack,'Проверь геолокацию',9,C.muted);}
summary.addSpacer();
const counter=summary.addStack();counter.layoutVertically();
let agenda=null, agendaError=null;
try{agenda=await getAgenda();}catch(e){agendaError=e.message||'Нет доступа к календарю';}
let counterText='—', counterLabel='ВСТРЕЧИ';
if(!agendaError){
  if(agenda.isToday&&agenda.events.length&&agenda.events.length<agenda.count){counterText=agenda.events.length+'/'+agenda.count;counterLabel='ОСТАЛОСЬ';}
  else counterText=String(agenda.count);
  if(!agenda.isToday)counterLabel=dayStart(agenda.date)-dayStart(now)===86400000?'ЗАВТРА':'ВСТРЕЧИ';
}
txt(counter,counterLabel,8,C.muted,true);txt(counter,counterText,18,C.mint,true);
widget.addSpacer(7);
const divider=widget.addStack();divider.backgroundColor=new Color(C.line);divider.size=new Size(0,1);
widget.addSpacer(6);
if(agendaError){txt(widget,agendaError,10,C.amber);txt(widget,'Проверь доступ Scriptable к календарю',9,C.muted);}
else if(!agenda.events.length){txt(widget,agenda.finished?'Сегодня все встречи завершены':'В ближайшие 7 дней встреч нет',11,C.white);txt(widget,'Нажми, чтобы открыть календарь',9,C.muted);}
else{
  const hdr=widget.addStack();hdr.centerAlignContent();
  txt(hdr,agenda.isToday?'СЕГОДНЯ · РАСПИСАНИЕ':dayLabel(agenda.date),9,C.mint,true);
  hdr.addSpacer();
  const fw=freeWindow(agenda);
  if(fw)txt(hdr,fw,9,C.amber,true);
  widget.addSpacer(5);
  let firstUpcoming=true;
  for(const e of agenda.events.slice(0,3)){
    const link=meetingLink(e);
    const line=widget.addStack();line.centerAlignContent();
    line.url=link||calshow(e.startDate);
    const bar=line.addStack();bar.size=new Size(3,21);bar.backgroundColor=e.calendar&&e.calendar.color?e.calendar.color:new Color(C.mint);
    line.addSpacer(7);
    const times=line.addStack();times.layoutVertically();times.size=new Size(77,0);
    const active=agenda.isToday&&e.startDate<=now&&e.endDate>now;
    const soon=agenda.isToday&&!active&&firstUpcoming?untilText(e.startDate):null;
    if(agenda.isToday&&!active)firstUpcoming=false;
    txt(times,active?'СЕЙЧАС':hhmm(e.startDate),10,active?C.mint:C.white,true);
    txt(times,soon||hhmm(e.endDate),8,soon?C.amber:C.muted);
    line.addSpacer(5);
    txt(line,e.title||'Без названия',11,C.white,true);
    line.addSpacer();
    if(link){const v=line.addImage(SFSymbol.named('video.fill').image);v.imageSize=new Size(13,13);v.tintColor=new Color(C.mint);}
    widget.addSpacer(4);
  }
  if(agenda.events.length>3)txt(widget,'Ещё '+(agenda.events.length-3)+' встреч · открыть календарь',9,C.muted);
  // Когда сегодня мало встреч, внизу — первая встреча завтра
  else if(agenda.isToday&&agenda.tomorrowFirst){
    const t=agenda.tomorrowFirst;
    txt(widget,'Завтра первая: '+hhmm(t.startDate)+' · '+(t.title||'Без названия'),9,C.muted);
  }
}
widget.refreshAfterDate=nextRefresh(agenda);
Script.setWidget(widget);
if(config.runsInApp)await widget.presentMedium();
Script.complete();

// MyDay v4 — Scriptable medium widget
 // Work calendar, today's weather, next nonempty day when today's meetings are over.
 // Set the exact calendar title in this field or in the widget Parameter.
 const WORK_CALENDAR_NAME = String(args.widgetParameter || '').trim();
 const DAYS_AHEAD = 7;
 const WEATHER_CACHE_MINUTES = 45;
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
 function dayLabel(d){return d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();}
 function excluded(e){
   const title=(e.title||'').trim().toLowerCase();
   return e.isAllDay || /non[- ]working days?|out of office|ooo|holiday|праздник|нерабоч(ий|ие|ая)|отпуск|^canceled:|^cancelled:/.test(title);
 }
 async function getWeather(){
   let cached=null;
   try{if(fm.fileExists(cachePath))cached=JSON.parse(fm.readString(cachePath));}catch(e){}
   if(cached && Date.now()-cached.ts<WEATHER_CACHE_MINUTES*60000)return cached.data;
   try{
     Location.setAccuracyToThreeKilometers();
     const p=await Location.current();
     const url='https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(p.latitude)+'&longitude='+encodeURIComponent(p.longitude)+'&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto';
     const r=await new Request(url).loadJSON();
     const d={temp:Math.round(r.current.temperature_2m),code:r.current.weather_code,high:Math.round(r.daily.temperature_2m_max[0]),low:Math.round(r.daily.temperature_2m_min[0]),rain:r.daily.precipitation_probability_max[0]};
     fm.writeString(cachePath,JSON.stringify({ts:Date.now(),data:d}));return d;
   }catch(e){return cached?cached.data:null;}
 }
 async function getAgenda(){
   const calendars=await Calendar.forEvents();
   const selected=calendars.filter(c=>c.title.toLowerCase()===WORK_CALENDAR_NAME.toLowerCase());
   if(!WORK_CALENDAR_NAME)throw new Error('Укажи имя календаря в Parameter');
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
   const todayUpcoming=todayAll.filter(e=>e.endDate>now);
   if(todayUpcoming.length)return {date:first,events:todayUpcoming,count:todayAll.length,isToday:true};
   for(let offset=1;offset<=DAYS_AHEAD;offset++){
     const d=addDays(first,offset), next=addDays(d,1);
     const dayEvents=valid.filter(e=>e.startDate>=d && e.startDate<next);
     if(dayEvents.length)return {date:d,events:dayEvents,count:dayEvents.length,isToday:false};
   }
   return {date:first,events:[],count:todayAll.length,isToday:true,finished:todayAll.length>0};
 }
 const widget=new ListWidget();
 widget.backgroundColor=new Color(C.bg);widget.setPadding(12,14,10,14);
 widget.url='calshow:'+(Math.floor(now.getTime()/1000)-978307200);
 const head=widget.addStack();head.centerAlignContent();
 const ico=head.addImage(SFSymbol.named('calendar').image);ico.imageSize=new Size(12,12);ico.tintColor=new Color(C.mint);
 head.addSpacer(6);txt(head,'МОЙ ДЕНЬ',10,C.mint,true);head.addSpacer();
 txt(head,now.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).toUpperCase(),9,C.muted,true);
 widget.addSpacer(7);
 const summary=widget.addStack();summary.centerAlignContent();
 const weatherStack=summary.addStack();weatherStack.layoutVertically();
 const weather=await getWeather();
 if(weather){txt(weatherStack,weather.temp+'°  '+condition(weather.code),15,C.white,true);txt(weatherStack,'↑'+weather.high+'°  ↓'+weather.low+'°  ☂ '+weather.rain+'%',9,C.muted);}
 else{txt(weatherStack,'Погода недоступна',11,C.amber);txt(weatherStack,'Проверь геолокацию',9,C.muted);}
 summary.addSpacer();
 const counter=summary.addStack();counter.layoutVertically();
 let agenda=null, agendaError=null;
 try{agenda=await getAgenda();}catch(e){agendaError=e.message||'Нет доступа к календарю';}
 txt(counter,'ВСТРЕЧИ',8,C.muted,true);txt(counter,agendaError?'—':String(agenda.count),18,C.mint,true);
 widget.addSpacer(7);
 const divider=widget.addStack();divider.backgroundColor=new Color(C.line);divider.size=new Size(0,1);
 widget.addSpacer(6);
 if(agendaError){txt(widget,agendaError,10,C.amber);txt(widget,'Проверь доступ Scriptable к календарю',9,C.muted);}
 else if(!agenda.events.length){txt(widget,agenda.finished?'Сегодня все встречи завершены':'В ближайшие 7 дней встреч нет',11,C.white);txt(widget,'Нажми, чтобы открыть календарь',9,C.muted);}
 else{
   txt(widget,agenda.isToday?'СЕГОДНЯ · РАСПИСАНИЕ':dayLabel(agenda.date),9,C.mint,true);
   widget.addSpacer(5);
   for(const e of agenda.events.slice(0,3)){
     const line=widget.addStack();line.centerAlignContent();
     const bar=line.addStack();bar.size=new Size(3,21);bar.backgroundColor=e.calendar&&e.calendar.color?e.calendar.color:new Color(C.mint);
     line.addSpacer(7);
     const times=line.addStack();times.layoutVertically();times.size=new Size(77,0);
     const active=agenda.isToday&&e.startDate<=now&&e.endDate>now;
     txt(times,active?'СЕЙЧАС':hhmm(e.startDate),10,active?C.mint:C.white,true);
     txt(times,hhmm(e.endDate),8,C.muted);
     line.addSpacer(5);
     txt(line,e.title||'Без названия',11,C.white,true);
     widget.addSpacer(4);
   }
   if(agenda.events.length>3)txt(widget,'Ещё '+(agenda.events.length-3)+' встреч · открыть календарь',9,C.muted);
 }
 widget.refreshAfterDate=new Date(Date.now()+15*60*1000);
 Script.setWidget(widget);
 if(config.runsInApp)await widget.presentMedium();
 Script.complete();

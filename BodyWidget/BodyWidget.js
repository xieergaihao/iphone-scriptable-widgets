// BodyWidget v1.5 — Scriptable medium widget
// Сон, шаги и пульс покоя из Apple Health (туда их пишет Google Health / Fitbit).
// Данные приходят из команды «Тело: обновить» через Run Script с параметром-словарём:
//   steps — шаги за сегодня, sleepMin — сон за ночь в минутах, restingHR — пульс покоя.
// Сам Scriptable читать Apple Health не умеет, поэтому нужна команда.

const FOLDER = "BodyWidget-data-v1";
const KEEP_DAYS = 60;
const C = {
  bg: "111824", card: "202D3E", text: "FFFFFF", soft: "9AACBF",
  mint: "86E0CE", warn: "F4C479", bar: "536B85"
};
const DEFAULTS = { stepsGoal: 8000, sleepGoalMin: 450 };

const fm = FileManager.local();
const root = fm.joinPath(fm.documentsDirectory(), FOLDER);
if (!fm.fileExists(root)) fm.createDirectory(root, true);
const dataPath = fm.joinPath(root, "days.json");
const settingsPath = fm.joinPath(root, "settings.json");

function pad(n) { return String(n).padStart(2, "0"); }
function localDay(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function addDays(d, n) { const v = new Date(d); v.setDate(v.getDate() + n); return v; }

function readJSON(path, fallback) {
  try { if (fm.fileExists(path)) return JSON.parse(fm.readString(path)); } catch (_) {}
  return fallback;
}
function writeJSON(path, obj) {
  const tmp = path + ".tmp";
  fm.writeString(tmp, JSON.stringify(obj));
  if (fm.fileExists(path)) fm.remove(path);
  fm.move(tmp, path);
}
function settings() { return { ...DEFAULTS, ...readJSON(settingsPath, {}) }; }

// Команды отдают значения по-разному: числом, строкой «7 532 шаг», «58 уд/мин»,
// списком значений. Берём число; для списка — сумму (шаги, отрезки сна).
function num(v, sumList = true) {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) {
    const xs = v.map(x => num(x, false)).filter(x => x != null);
    if (!xs.length) return null;
    return sumList ? xs.reduce((a, b) => a + b, 0) : xs[xs.length - 1];
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Команды отдают список значений строкой через перевод строки: «3454\n0».
  if (typeof v === "string" && /[\r\n]/.test(v.trim()))
    return num(v.split(/[\r\n]+/).filter(x => x.trim()), sumList);
  const s = String(v).replace(/[\s  ]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Даты отрезков сна приходят текстом: «Oct 22, 2026 at 1:23 AM», «22 Oct 2026 at 01:23», ISO.
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function parseLooseDate(x) {
  if (x instanceof Date) return isNaN(x) ? null : x;
  if (typeof x === "number") return new Date(x > 1e12 ? x : x * 1000);
  const t = String(x).replace(/[  ]/g, " ").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) { const d = new Date(t); return isNaN(d) ? null : d; }
  const mon = t.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
  const tm = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  const rest = t.replace(tm ? tm[0] : "", " ");
  const nums = (rest.match(/\d+/g) || []).map(Number);
  let y, m, d;
  if (mon) {
    m = MONTHS.indexOf(mon[1]);
    y = nums.find(n => n > 1900); d = nums.find(n => n >= 1 && n <= 31);
  } else {
    const dm = rest.match(/(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/);
    if (!dm) return null;
    const a = dm.slice(1, 4).map(Number);
    if (a[0] > 1900) { y = a[0]; m = a[1] - 1; d = a[2]; } else { d = a[0]; m = a[1] - 1; y = a[2] < 100 ? 2000 + a[2] : a[2]; }
  }
  if (y == null || d == null || m < 0 || !tm) return null;
  let h = Number(tm[1]);
  const ap = (tm[4] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return new Date(y, m, d, h, Number(tm[2]), Number(tm[3] || 0));
}
function listOf(v) {
  if (Array.isArray(v)) return v;
  if (v instanceof Date) return [v];
  if (v == null) return [];
  return String(v).split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
}
// Отрезки сна из разных источников и фаз перекрываются. Склеиваем интервалы и считаем
// реальное время сна, без двойного счёта.
function mergedSleepMin(starts, ends) {
  const a = listOf(starts).map(parseLooseDate), b = listOf(ends).map(parseLooseDate);
  if (!a.length || a.length !== b.length || a.some(x => !x) || b.some(x => !x)) return null;
  const iv = a.map((s, i) => [s.getTime(), b[i].getTime()]).filter(([s, e]) => e > s).sort((p, q) => p[0] - q[0]);
  let total = 0, cs = null, ce = null;
  for (const [s, e] of iv) {
    if (cs == null || s > ce) { if (cs != null) total += ce - cs; cs = s; ce = e; }
    else if (e > ce) ce = e;
  }
  if (cs != null) total += ce - cs;
  return total / 60000;
}

// Команды отдают длительность отрезков сна как «16:00» (мм:сс) или «1:05:00» (ч:мм:сс),
// списком через перевод строки. Суммируем в минуты.
function clockMin(v) {
  const parts = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[\r\n]+/) : [];
  const xs = parts.map(x => x.trim()).filter(Boolean);
  if (!xs.length || !xs.every(x => /^\d+(:\d{1,2}){1,2}$/.test(x))) return null;
  let sec = 0;
  for (const x of xs) {
    const n = x.split(":").map(Number);
    sec += n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
  }
  return sec / 60;
}

function unpack(p) {
  let v = p;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) { v = {}; } }
  if (!v || typeof v !== "object") v = {};
  const norm = k => String(k).toLowerCase().replace(/[^a-zа-я0-9]/g, "");
  const idx = {};
  for (const k of Object.keys(v)) idx[norm(k)] = v[k];
  const pick = (...keys) => { for (const k of keys) if (idx[norm(k)] != null) return idx[norm(k)]; return null; };
  const steps = num(pick("steps", "Steps", "шаги"));
  const sleepRaw = pick("sleepMin", "sleep", "Sleep", "сон");
  let sleepMin = mergedSleepMin(pick("sleepStart", "start", "startDate"), pick("sleepEnd", "end", "endDate"));
  const st = listOf(pick("sleepStart", "start", "startDate")), en = listOf(pick("sleepEnd", "end", "endDate"));
  let how;
  if (sleepMin != null) {
    const ds = st.map(parseLooseDate).concat(en.map(parseLooseDate)).map(d => d.getTime());
    const hm = t => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + " " + d.getDate() + "." + (d.getMonth() + 1); };
    how = "интервалы " + st.length + " шт, " + hm(Math.min(...ds)) + " → " + hm(Math.max(...ds));
  } else if (!st.length) how = "нет sleepStart; пришло: " + Object.keys(v).map(k => k + "=" + (v[k] === null ? "null" : Array.isArray(v[k]) ? "list" + v[k].length : typeof v[k])).join(", ");
  else how = "даты не прочитаны (" + st.length + "/" + en.length + "): «" + st[0] + "»";
  if (sleepMin == null) sleepMin = clockMin(sleepRaw);
  if (sleepMin == null) {
    sleepMin = num(sleepRaw);
    const sleepH = num(pick("sleepHours"));
    if (sleepMin == null && sleepH != null) sleepMin = sleepH * 60;
    // Длительность может прийти в секундах, минутах или часах.
    if (sleepMin != null && sleepMin > 1440) sleepMin = sleepMin / 60;
    else if (sleepMin != null && sleepMin > 0 && sleepMin < 24) sleepMin = sleepMin * 60;
  }
  const restingHR = num(pick("restingHR", "rhr", "RestingHR", "пульс"), false);
  return {
    steps: steps != null && steps >= 0 && steps < 200000 ? Math.round(steps) : null,
    sleepMin: sleepMin != null && sleepMin > 0 && sleepMin <= 1440 ? Math.round(sleepMin) : null,
    how,
    restingHR: restingHR != null && restingHR >= 25 && restingHR <= 150 ? Math.round(restingHR) : null
  };
}

function ingest(param) {
  const v = unpack(param);
  if (v.steps == null && v.sleepMin == null && v.restingHR == null)
    return "Пусто: не записано";
  const days = readJSON(dataPath, {});
  const key = localDay(new Date());
  const old = days[key] || {};
  days[key] = {
    steps: v.steps != null ? Math.max(v.steps, old.steps || 0) : old.steps,
    sleepMin: v.sleepMin != null ? v.sleepMin : old.sleepMin,
    restingHR: v.restingHR != null ? v.restingHR : old.restingHR,
    updatedAt: new Date().toISOString()
  };
  const cutoff = localDay(addDays(new Date(), -KEEP_DAYS));
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];
  writeJSON(dataPath, days);
  const d = days[key];
  return "Записано: сон " + fmtSleep(d.sleepMin) + ", шаги " + (d.steps ?? "—") + ", пульс " + (d.restingHR ?? "—") +
    "\n[сон: " + v.how + "]";
}

function fmtSleep(min) {
  if (min == null) return "—";
  return Math.floor(min / 60) + " ч " + pad(min % 60) + " мин";
}
function fmtInt(n) { return n == null ? "—" : n.toLocaleString("ru-RU"); }
function avg(xs) { const v = xs.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

function lastDays(days, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = localDay(addDays(new Date(), -i));
    out.push({ key: k, ...(days[k] || {}) });
  }
  return out;
}

function txt(stack, value, size, color, bold = false) {
  const t = stack.addText(String(value));
  t.font = bold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = new Color(color);
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function tile(row, title, value, sub, subColor) {
  const c = row.addStack();
  c.layoutVertically();
  c.backgroundColor = new Color(C.card);
  c.cornerRadius = 8;
  c.setPadding(6, 8, 6, 8);
  c.size = new Size(98, 0);
  txt(c, title, 8, C.soft, true);
  txt(c, value, 14, C.text, true);
  txt(c, sub, 8, subColor || C.soft);
  return c;
}

function render() {
  const s = settings();
  const days = readJSON(dataPath, {});
  const week = lastDays(days, 7);
  const today = week[week.length - 1];
  const prev = week.slice(0, -1);

  const w = new ListWidget();
  w.backgroundColor = new Color(C.bg);
  w.setPadding(12, 14, 10, 14);
  w.url = "fitbit://";

  const head = w.addStack();
  head.centerAlignContent();
  txt(head, "ТЕЛО  /  СЕГОДНЯ", 10, C.mint, true);
  head.addSpacer();
  const upd = today.updatedAt ? new Date(today.updatedAt) : null;
  txt(head, upd ? "обновлено " + pad(upd.getHours()) + ":" + pad(upd.getMinutes()) : "нет данных за сегодня", 9, upd ? C.soft : C.warn);
  w.addSpacer(8);

  const row = w.addStack();
  // Сон
  const sleepAvg = avg(prev.map(d => d.sleepMin));
  const sleepOk = today.sleepMin != null && today.sleepMin >= s.sleepGoalMin;
  tile(row, "СОН", today.sleepMin != null ? Math.floor(today.sleepMin / 60) + "ч " + pad(today.sleepMin % 60) : "—",
    sleepAvg != null ? "ср. 7д " + Math.floor(sleepAvg / 60) + "ч " + pad(Math.round(sleepAvg % 60)) : "цель " + Math.round(s.sleepGoalMin / 6) / 10 + " ч",
    today.sleepMin == null ? C.soft : sleepOk ? C.mint : C.warn);
  row.addSpacer();
  // Шаги
  const pct = today.steps != null ? Math.min(100, Math.round(today.steps / s.stepsGoal * 100)) : 0;
  tile(row, "ШАГИ", fmtInt(today.steps), pct + "% от " + fmtInt(s.stepsGoal), pct >= 100 ? C.mint : C.soft);
  row.addSpacer();
  // Пульс покоя: ниже среднего — хорошо
  const hrAvg = avg(prev.map(d => d.restingHR));
  let hrSub = "пульс покоя", hrColor = C.soft;
  if (today.restingHR != null && hrAvg != null) {
    const dlt = Math.round(today.restingHR - hrAvg);
    hrSub = (dlt > 0 ? "↑ +" : dlt < 0 ? "↓ " : "= ") + (dlt || "") + " к ср. 7д";
    hrColor = dlt >= 3 ? C.warn : C.mint;
  }
  tile(row, "ПУЛЬС ПОКОЯ", today.restingHR != null ? today.restingHR + " уд" : "—", hrSub, hrColor);

  w.addSpacer(8);

  // Сон за 7 ночей: столбики, цель — пунктир
  const W = 610, H = 64, top = 4, bottom = 46, bw = 32;
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const max = Math.max(s.sleepGoalMin * 1.2, ...week.map(d => d.sleepMin || 0));
  const cell = W / 7;
  const goalY = bottom - (s.sleepGoalMin / max) * (bottom - top);
  ctx.setFillColor(new Color(C.soft, 0.5));
  for (let x = 0; x < W; x += 14) ctx.fillRect(new Rect(x, goalY, 7, 1.5));
  week.forEach((d, i) => {
    const h = d.sleepMin ? Math.max(4, (d.sleepMin / max) * (bottom - top)) : 3;
    ctx.setFillColor(new Color(i === 6 ? C.mint : (d.sleepMin && d.sleepMin < s.sleepGoalMin ? C.warn : C.bar)));
    ctx.fillRect(new Rect(i * cell + (cell - bw) / 2, bottom - h, bw, h));
    ctx.setFont(Font.mediumSystemFont(16));
    ctx.setTextColor(new Color(C.soft));
    ctx.setTextAlignedCenter();
    ctx.drawTextInRect(d.key.slice(8), new Rect(i * cell, 48, cell, 18));
  });
  const img = w.addImage(ctx.getImage());
  img.imageSize = new Size(305, 32);
  w.addSpacer(3);
  txt(w, "сон за 7 ночей · пунктир — цель " + (s.sleepGoalMin / 60).toFixed(1).replace(".0", "") + " ч", 8, C.soft);

  // Обновляем картинку часто не нужно: данные приходят только из команды.
  w.refreshAfterDate = new Date(Date.now() + 60 * 60000);
  return w;
}

async function menu() {
  while (true) {
    const a = new Alert();
    a.title = "BodyWidget";
    a.message = "Данные приходят из команды «Тело: обновить»";
    ["Предпросмотр", "Цели: шаги и сон", "Тестовые данные (без Health)", "Очистить историю"].forEach(x => a.addAction(x));
    a.addCancelAction("Готово");
    const n = await a.presentSheet();
    if (n < 0) return;
    if (n === 0) await render().presentMedium();
    if (n === 1) {
      const s = settings();
      const g = new Alert();
      g.title = "Цели";
      g.addTextField("Шаги в день", String(s.stepsGoal));
      g.addTextField("Сон, часов", String(s.sleepGoalMin / 60));
      g.addAction("Сохранить");
      g.addCancelAction("Отмена");
      if (await g.presentAlert() === 0) {
        const steps = num(g.textFieldValue(0)), sleep = num(g.textFieldValue(1));
        writeJSON(settingsPath, {
          stepsGoal: steps > 0 ? Math.round(steps) : s.stepsGoal,
          sleepGoalMin: sleep > 0 && sleep < 14 ? Math.round(sleep * 60) : s.sleepGoalMin
        });
      }
    }
    if (n === 2) {
      const r = ingest({ steps: "6 420 шаг", sleepMin: 412, restingHR: "57 уд/мин" });
      const m = new Alert(); m.title = "Тест"; m.message = r; m.addAction("OK"); await m.presentAlert();
    }
    if (n === 3) {
      const c = new Alert(); c.title = "Удалить историю?"; c.addDestructiveAction("Удалить"); c.addCancelAction("Отмена");
      if (await c.presentAlert() === 0) writeJSON(dataPath, {});
    }
  }
}

if (config.runsInWidget) {
  Script.setWidget(render());
} else if (args.shortcutParameter != null) {
  Script.setShortcutOutput(ingest(args.shortcutParameter));
} else if (config.runsInApp) {
  await menu();
}
Script.complete();

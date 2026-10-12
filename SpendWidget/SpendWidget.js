const VERSION = "1.6.1";
const FOLDER = "SpendWidget-data-v1";
const MAX_TEXT = 8192;
const DUPLICATE_WINDOW_MS = 120000;

const DECIMALS = {
  HKD: 2, CNY: 2, JPY: 0, USD: 2,
  EUR: 2, GBP: 2, SGD: 2, THB: 2,
  AUD: 2, NZD: 2, KRW: 0, VND: 0
};

const CATEGORIES = [
  "Еда", "Транспорт", "Поездки",
  "Здоровье", "Покупки", "Услуги",
  "Без категории"
];

const COLORS = {
  bg: new Color("111824"),
  card: new Color("202D3E"),
  text: new Color("FFFFFF"),
  soft: new Color("9AACBF"),
  mint: new Color("86E0CE"),
  warning: new Color("F4C479")
};

const FX_URL =
  "https://api.frankfurter.dev/v1/latest?base=HKD";

let _store = null;
let _merchantMap = null;

// ===== UTILS =====

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDay(d) {
  return d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate());
}

function validDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, day] = s.split("-").map(Number);
  return localDay(new Date(y, m - 1, day, 12)) === s;
}

function normalize(s) {
  return String(s == null ? "" : s)
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function merchantKey(s) {
  return normalize(s)
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sourceName(s) {
  const n = normalize(s).toLowerCase();

  if (/^(mox|mox bank)$/.test(n))
    return "Mox";

  if (/^(sc|sc mobile|standard chartered|standard chartered bank)$/.test(n))
    return "SC";

  if (/^(octopus|八達通|八达通)$/.test(n))
    return "Octopus";

  if (/^(alipay|alipay china|支付宝|支付寶)$/.test(n))
    return "Alipay";

  return "Unknown";
}

function currencyCode(s) {
  const n = String(s || "")
    .toUpperCase()
    .replace(/\s/g, "");

  if (n === "HK$") return "HKD";
  if (["RMB", "CN¥", "CN￥"].includes(n))
    return "CNY";
  if (["JP¥", "JP￥"].includes(n))
    return "JPY";

  return Object.prototype.hasOwnProperty.call(
    DECIMALS, n
  ) ? n : null;
}

function parseMinor(value, currency, manual = false) {
  const scale = DECIMALS[currency];
  if (scale == null)
    throw new Error("Неизвестная валюта");

  let s = String(value).trim();

  if (manual) {
    s = s.replace(/[ \u00a0\u202f]/g, "");
    if (/^\d+,\d{1,2}$/.test(s))
      s = s.replace(",", ".");
  }

  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(s))
    throw new Error("Неверный формат суммы");

  const parts = s.replace(/,/g, "").split(".");
  const whole = Number(parts[0]);
  const fraction = parts[1] || "";

  if (fraction.length > scale &&
      Number(fraction) !== 0)
    throw new Error("Слишком много знаков после запятой");

  const factor = 10 ** scale;
  const minor = whole * factor +
    Number(
      (fraction.slice(0, scale) + "00")
        .slice(0, scale) || 0
    );

  if (!Number.isSafeInteger(minor) ||
      minor <= 0 ||
      minor > 1000000000000)
    throw new Error("Недопустимая сумма");

  return minor;
}

function formatMoney(minor, currency) {
  const dp = DECIMALS[currency] || 0;
  const factor = 10 ** dp;
  const sign = minor < 0 ? "−" : "";
  const n = Math.abs(minor);

  const whole = Math.floor(n / factor)
    .toLocaleString("en-US");

  const fraction = dp && n % factor
    ? "." + String(n % factor).padStart(dp, "0")
    : "";

  return sign + whole + fraction + " " + currency;
}

function shortHKD(n) {
  return "HK$ " + n.toLocaleString(
    "en-HK", { maximumFractionDigits: 0 }
  );
}

function review(reason) {
  return { status: "review", reason };
}

// ===== STORAGE =====

function store() {
  if (_store) return _store;

  const fm = FileManager.local();
  const root = fm.joinPath(
    fm.documentsDirectory(), FOLDER
  );

  if (!fm.fileExists(root))
    fm.createDirectory(root, true);

  _store = { fm, root };
  return _store;
}

function dayDirectory(day) {
  if (!validDay(day))
    throw new Error("Неверная дата");

  const s = store();
  return s.fm.joinPath(s.root, day);
}

function atomicWrite(path, obj) {
  const fm = store().fm;
  const tmp = path + "." + UUID.string() + ".tmp";

  fm.writeString(tmp, JSON.stringify(obj, null, 2));

  // FileManager.move в Scriptable не перезаписывает файл:
  // сначала убираем старый, данные уже лежат во временном.
  if (fm.fileExists(path)) fm.remove(path);
  fm.move(tmp, path);
}

// Убирает временные файлы, оставшиеся от сбоев записи.
function cleanupTmp() {
  try {
    const s = store();
    for (const name of s.fm.listContents(s.root)) {
      if (/\.tmp$/.test(name))
        s.fm.remove(s.fm.joinPath(s.root, name));
    }
  } catch (_) {}
}

function saveEvent(e) {
  const fm = store().fm;
  const dir = dayDirectory(e.day);

  if (!fm.fileExists(dir))
    fm.createDirectory(dir, true);

  atomicWrite(
    fm.joinPath(dir, e.id + ".event.json"), e
  );
}

function overridePath(e) {
  return store().fm.joinPath(
    dayDirectory(e.day),
    e.id + ".override.json"
  );
}

function saveOverride(e, patch) {
  const fm = store().fm;
  const path = overridePath(e);

  const old = fm.fileExists(path)
    ? JSON.parse(fm.readString(path))
    : {};

  atomicWrite(path, {
    ...old,
    ...patch,
    editedAt: new Date().toISOString()
  });
}

function validEvent(e, day) {
  if (!e ||
      e.schema !== 1 ||
      e.day !== day ||
      !/^[A-Za-z0-9-]+$/.test(e.id || "") ||
      typeof e.receivedAt !== "string" ||
      typeof e.raw !== "string" ||
      typeof e.source !== "string" ||
      !Number.isFinite(new Date(e.receivedAt).getTime()) ||
      !["expense", "refund", "review", "ignored"]
        .includes(e.status))
    return false;

  if (["expense", "refund"].includes(e.status)) {
    return DECIMALS[e.currency] != null &&
      Number.isSafeInteger(e.amountMinor) &&
      e.amountMinor > 0 &&
      typeof e.merchant === "string" &&
      e.merchant.trim().length > 0;
  }

  return true;
}

function dedupeKey(e) {
  return e.duplicateKey || [
    e.source,
    e.currency,
    e.amountMinor,
    merchantKey(e.merchant)
  ].join("|");
}

function resolveDuplicates(events) {
  const sorted = events.map(e => ({ ...e }))
    .sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt) ||
      a.id.localeCompare(b.id)
    );

  const last = new Map();

  for (const e of sorted) {
    if (e.origin !== "notification" ||
        !e.currency || !e.amountMinor)
      continue;

    const key = dedupeKey(e);
    const before = last.get(key);

    const dt = before
      ? new Date(e.receivedAt).getTime() -
        new Date(before.receivedAt).getTime()
      : Infinity;

    if (e.status === "ignored" && e.duplicateKey) {
      if (!before || dt > DUPLICATE_WINDOW_MS)
        last.set(key, e);
      continue;
    }

    if (e.status !== "expense") continue;

    if (!e.confirmed &&
        before &&
        dt >= 0 &&
        dt <= DUPLICATE_WINDOW_MS) {
      e.status = "review";
      e.reason =
        "Возможный повтор уведомления. " +
        "Не включён в расходы до подтверждения.";
    } else {
      last.set(key, e);
    }
  }

  return sorted;
}

function loadMonth(day) {
  const s = store();
  const month = day.slice(0, 7);

  const [y, m] = month.split("-").map(Number);
  const previous = localDay(new Date(y, m - 1, 0, 12));

  const dirs = s.fm.listContents(s.root)
    .filter(n =>
      validDay(n) &&
      (n.slice(0, 7) === month || n === previous)
    );

  const events = [];
  const errors = [];

  for (const d of dirs) {
    const dir = s.fm.joinPath(s.root, d);
    if (!s.fm.isDirectory(dir)) continue;

    for (const name of s.fm.listContents(dir)
      .filter(n => n.endsWith(".event.json"))) {
      try {
        let e = JSON.parse(
          s.fm.readString(s.fm.joinPath(dir, name))
        );

        if (!validEvent(e, d))
          throw new Error("Неверная запись");

        const op = overridePath(e);

        if (s.fm.fileExists(op)) {
          const edit = JSON.parse(s.fm.readString(op));

          for (const k of [
            "status", "amountMinor", "currency",
            "merchant", "reason", "confirmed", "editedAt"
          ]) {
            if (Object.prototype.hasOwnProperty.call(edit, k))
              e[k] = edit[k];
          }
        }

        if (!validEvent(e, d))
          throw new Error("Неверная правка");

        events.push(e);
      } catch (_) {
        errors.push(d + "/" + name);
      }
    }
  }

  return {
    events: resolveDuplicates(events)
      .filter(e => e.day.slice(0, 7) === month),
    errors
  };
}

function loadPeriods(day) {
  const d = new Date(day + "T12:00:00");
  const prev = localDay(
    new Date(d.getFullYear(), d.getMonth(),
      d.getDate() - 6, 12)
  );

  const months = [day.slice(0, 7)];

  if (prev.slice(0, 7) !== months[0])
    months.push(prev.slice(0, 7));

  const all = months.map(m => loadMonth(m + "-01"));

  return {
    events: all.flatMap(x => x.events),
    errors: all.flatMap(x => x.errors)
  };
}

// ===== MERCHANT DATABASE =====

function categoryMapPath() {
  const s = store();
  return s.fm.joinPath(
    s.root, "merchant-categories-v1.json"
  );
}

function merchantCategories() {
  if (_merchantMap !== null)
    return _merchantMap;

  const fm = store().fm;
  const path = categoryMapPath();

  try {
    const obj = fm.fileExists(path)
      ? JSON.parse(fm.readString(path))
      : {};

    _merchantMap =
      obj && typeof obj === "object" &&
      !Array.isArray(obj) ? obj : {};
  } catch (_) {
    // Не перезаписываем битый файл пустой картой:
    // сохраняем копию, чтобы не потерять выученные категории.
    try {
      if (fm.fileExists(path))
        fm.writeString(
          path + ".broken-" + Date.now(),
          fm.readString(path)
        );
    } catch (_) {}
    _merchantMap = {};
  }

  return _merchantMap;
}

function teachMerchant(merchant, category) {
  if (!CATEGORIES.includes(category))
    throw new Error("Неизвестная категория");

  const key = merchantKey(merchant);
  if (!key)
    throw new Error("Нет названия магазина");

  const map = merchantCategories();
  map[key] = category;

  atomicWrite(categoryMapPath(), map);
}

const CATEGORY_RULES = [
  {
    category: "Транспорт",
    regex: /train|\bmtr\b|metro|subway|rail|\bbus\b|ferry|tram|taxi|uber trip|uber ride|didi|grab ride|shinkansen|jr west|octopus fare|transport|toll|地铁|地鐵|高铁|高鐵|铁路|鐵路|滴滴|出租车|出租車|巴士|港鐵|港铁|电车|電車|交通|新幹線|電鉄|電鐵/
  },
  {
    category: "Поездки",
    regex: /hotel|hostel|booking com|trip com|airbnb|airline|flight|agoda|旅馆|旅館|酒店|旅店|民宿/
  },
  {
    category: "Здоровье",
    regex: /pharmacy|hospital|clinic|doctor|watsons|mannings|health|屈臣氏|萬寧|万宁|药房|藥房|医院|醫院/
  },
  {
    category: "Еда",
    regex: /mcdonald|\bkfc\b|starbucks|coffee|cafe|café|restaurant|food|dining|tea house|heytea|sushi|pizza|burger|bakery|餐厅|餐廳|咖啡|茶饮|茶飲|美团外卖|美團外賣|foodpanda|deliveroo|genki|shake shack|jollibee|mos burger|yoshinoya|sukiya|matsuya|saizeriya|haidilao|海底捞|海底撈|喜茶|奈雪|瑞幸|luckin|coco ichibanya|ichiran|一蘭|一兰|一風堂|一风堂|鼎泰豐|鼎泰丰|大家樂|大家乐|大快活|美心|太興|太兴|譚仔|谭仔|茶餐廳|茶餐厅|麥當勞|麦当劳|肯德基|必勝客|必胜客|壽司|寿司|拉麵|拉面|飯店|饭店|麵包|面包|麵店|面店|飲食|饮食|奶茶|外卖|外賣|甜品|冰淇淋|\bpret\b|\bdomino\b|\bpizza hut\b/
  },
  {
    category: "Еда",
    regex: /supermarket|grocery|wellcome|park n shop|parknshop|aeon|7 eleven|seven eleven|familymart|lawson|circle k|ok convenience|don don donki|donki|city super|citysuper|market place|marketplace by jasons|百佳|惠康|永旺|便利店|全家|罗森|羅森|全聯|全联|盒马|盒馬|山姆|华润万家|華潤萬家|沃尔玛|沃爾瑪|大润发|大潤發|永辉|永輝|超市|生鲜|生鮮|食品店|零食|杂货|雜貨|\bcostco\b|\bcarrefour\b|\btesco\b|\baldi\b|\blidl\b/
  },
  {
    category: "Покупки",
    regex: /amazon|taobao|淘宝|淘寶|京东|京東|jd com|pinduoduo|拼多多|aliexpress|ikea|uniqlo|zara|shop|store|mall|mercari|carousell|shopee|lazada|muji|無印良品|无印良品/
  },
  {
    category: "Услуги",
    regex: /subscription|netflix|spotify|icloud|apple com bill|google one|chatgpt|openai|youtube premium|adobe|会员|會員|订阅|訂閱/
  }
];

function categoryOf(merchant) {
  const n = merchantKey(merchant);

  if (!n) return "Без категории";

  const taught = merchantCategories()[n];
  if (CATEGORIES.includes(taught))
    return taught;

  for (const rule of CATEGORY_RULES) {
    if (rule.regex.test(n))
      return rule.category;
  }

  return "Без категории";
}

// ===== NOTIFICATION PARSER =====

function textValue(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;

  if (Array.isArray(x))
    return x.map(textValue).filter(Boolean).join("\n");

  if (typeof x === "object") {
    const parts = [];

    for (const keys of [
      ["title", "Title"],
      ["subtitle", "Subtitle"],
      ["message", "Message", "body", "Body",
       "text", "Text"]
    ]) {
      const key = keys.find(k => x[k] != null);
      if (key) parts.push(textValue(x[key]));
    }

    if (parts.length) return parts.join("\n");

    const key = ["notification", "Notification"]
      .find(k => x[k] != null);

    if (key) return textValue(x[key]);

    return JSON.stringify(x);
  }

  return String(x);
}

function unpackInput(value) {
  let v = value;

  if (typeof v === "string" &&
      /^\s*[\[{]/.test(v)) {
    try {
      v = JSON.parse(v);
    } catch (_) {}
  }

  let source = "Unknown";
  let raw = "";

  if (v && typeof v === "object" &&
      !Array.isArray(v)) {
    const app = v.source || v.Source ||
      v.app || v.App || "";

    source = sourceName(
      typeof app === "object"
        ? app.name || app.displayName || ""
        : app
    );

    raw = textValue(v);
  } else {
    raw = textValue(v);
  }

  const lines = raw.replace(/\r\n?/g, "\n")
    .split("\n");

  const first = sourceName(lines[0]);

  if (first !== "Unknown") {
    if (source === "Unknown") source = first;
    lines.shift();
    raw = lines.join("\n");
  }

  return {
    source,
    raw: raw.slice(0, MAX_TEXT),
    tooLong: raw.length > MAX_TEXT
  };
}

function parseNotification(input) {
  const raw = normalize(input.raw);

  if (input.tooLong)
    return review("Слишком длинное уведомление");

  if (!raw ||
      /^(notification|уведомление|\[object object\]|ok)$/i
        .test(raw))
    return review("Нет текста покупки");

  if (/\b(otp|one[- ]time (?:password|code)|verification code|security code)\b|验证码|驗證碼|код подтверждения/i.test(raw)) {
    return {
      status: "ignored",
      reason: "Код подтверждения",
      redact: true
    };
  }

  // Alipay с картой Mox: не считаем дважды.
  if (input.source === "Alipay") {
    return {
      status: "ignored",
      reason: "Alipay исключён: учёт через Mox"
    };
  }

  // OCTOPUS
  if (input.source === "Octopus") {
    if (/\b(top[ -]?up|add[ -]?value|recharge|reload|deposit|refund|reversal)\b|增值|充值|退款/i.test(raw)) {
      return review(
        "Пополнение или возврат Octopus: не расход"
      );
    }

    const re =
      /(?:HK\$|HKD)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s+for\s+(Train|MTR|Bus|Ferry|Tram|Light Rail|Transport|[A-Za-z0-9][A-Za-z0-9&' -]{1,50}?)(?=\s+Your new balance|[.]|$)/gi;

    const hits = [...raw.matchAll(re)];

    if (hits.length !== 1)
      return review(
        "Неизвестный формат платежа Octopus"
      );

    let amountMinor;

    try {
      amountMinor = parseMinor(
        hits[0][1], "HKD"
      );
    } catch (e) {
      return review(e.message);
    }

    return {
      status: "expense",
      currency: "HKD",
      amountMinor,
      merchant: normalize(hits[0][2]).slice(0, 240),
      reason: "Octopus: покупка или поездка"
    };
  }

  // Standard Chartered пока только на проверку.
  if (input.source !== "Mox") {
    return review(
      input.source === "Unknown"
        ? "Не распознан источник уведомления"
        : "Формат " + input.source +
          " ещё не подтверждён"
    );
  }

  // MOX
  if (/\b(refund(?:ed)?|revers(?:ed|al)|declined|failed|cancelled|canceled|void(?:ed)?|unsuccessful)\b/i.test(raw)) {
    return review("Возврат или отмена Mox");
  }

  if ((raw.match(/\byou spent\b/gi) || []).length !== 1)
    return review(
      "Не найдено однозначное уведомление Mox"
    );

  const re =
    /\byou spent\s+(HKD|CNY|JPY|USD|EUR|GBP|SGD|THB|AUD|NZD|KRW|VND|HK\$|RMB|CN[¥￥]|JP[¥￥])\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s+at\s+(.+?)(?=,\s*earning\b|[.]\s*any doubt\b|$)/i;

  const m = raw.match(re);

  if (!m)
    return review(
      "Неизвестный формат Mox"
    );

  const currency = currencyCode(m[1]);
  let amountMinor;

  try {
    amountMinor = parseMinor(m[2], currency);
  } catch (e) {
    return review(e.message);
  }

  const merchant = m[3]
    .replace(/[.,; ]+$/, "")
    .trim();

  if (!merchant ||
      /(?:\.\.\.|…)/.test(m[3]))
    return review(
      "Название магазина отсутствует или обрезано"
    );

  // Не считаем пополнение Octopus покупкой.
  if (/octopus|八達通|八达通|\btop[- ]?up\b|\badd[- ]?value\b/i.test(merchant)) {
    return review(
      "Возможное пополнение Octopus"
    );
  }

  return {
    status: "expense",
    currency,
    amountMinor,
    merchant: merchant.slice(0, 240),
    reason: "Распознано Mox"
  };
}

function createEvent(input, now) {
  const parsed = parseNotification(input);

  const e = {
    schema: 1,
    id: UUID.string(),
    receivedAt: now.toISOString(),
    day: localDay(now),
    utcOffsetMinutes: -now.getTimezoneOffset(),
    source: input.source,
    raw: parsed.redact
      ? "[Код подтверждения скрыт]"
      : input.raw,
    origin: "notification",
    confirmed: false,
    ...parsed
  };

  if (e.status === "expense")
    e.duplicateKey = dedupeKey(e);

  return e;
}

function ingest(value) {
  const now = new Date();
  const input = unpackInput(value);

  // Пустой запуск автоматизации не засоряет журнал.
  if (!normalize(input.raw))
    return "Пусто: не записано";
  const e = createEvent(input, now);

  saveEvent(e);

  const data = loadMonth(e.day);
  const effective = data.events.find(
    x => x.id === e.id
  );

  if (!effective)
    throw new Error("Не удалось прочитать запись");

  if (effective.status === "expense") {
    return "Записано: " +
      formatMoney(
        effective.amountMinor,
        effective.currency
      ) + " · " + effective.merchant;
  }

  if (effective.status === "ignored")
    return "Не расход: " + effective.reason;

  return "На проверку: " + effective.reason;
}

// ===== EXCHANGE RATES =====

function fxPath() {
  const s = store();
  return s.fm.joinPath(s.root, "fx-hkd.json");
}

function readFx() {
  try {
    const s = store();
    const path = fxPath();

    if (!s.fm.fileExists(path)) return null;

    const v = JSON.parse(s.fm.readString(path));

    if (!v ||
        !v.rates ||
        !Number.isFinite(v.fetchedAt) ||
        !Number.isFinite(v.rates.JPY) ||
        !Number.isFinite(v.rates.CNY))
      return null;

    return v;
  } catch (_) {
    return null;
  }
}

async function updateFx(force = false) {
  const old = readFx();

  if (!force &&
      old &&
      Date.now() - old.fetchedAt < 86400000)
    return old;

  try {
    const req = new Request(FX_URL);
    req.timeoutInterval = 8;

    const data = await req.loadJSON();

    if (!data ||
        data.base !== "HKD" ||
        !data.rates)
      throw new Error("Неверный ответ FX");

    const rates = { HKD: 1 };

    for (const [k, v] of Object.entries(data.rates)) {
      if (/^[A-Z]{3}$/.test(k) &&
          Number.isFinite(v) &&
          v > 0)
        rates[k] = v;
    }

    if (!rates.JPY || !rates.CNY)
      throw new Error("Нет курсов JPY/CNY");

    const result = {
      base: "HKD",
      date: data.date,
      fetchedAt: Date.now(),
      rates
    };

    atomicWrite(fxPath(), result);
    return result;
  } catch (_) {
    return old;
  }
}

function hkdOf(e, fx) {
  const rate = e.currency === "HKD"
    ? 1
    : fx && fx.rates &&
      fx.rates[e.currency];

  if (!rate || !Number.isFinite(rate))
    return null;

  return (
    e.amountMinor /
    (10 ** DECIMALS[e.currency]) /
    rate
  ) * (e.status === "refund" ? -1 : 1);
}

function hkdSummary(events, day, fx) {
  const d = new Date(day + "T12:00:00");

  const firstWeek = localDay(
    new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() - 6,
      12
    )
  );

  const firstMonth = day.slice(0, 7) + "-01";

  const sums = {
    today: 0,
    week: 0,
    month: 0
  };

  const counts = {
    today: 0,
    week: 0,
    month: 0
  };

  const missing = new Set();

  for (const e of events) {
    if (!["expense", "refund"].includes(e.status))
      continue;

    if (e.day > day) continue;

    const amount = hkdOf(e, fx);

    if (amount === null) {
      missing.add(e.currency);
      continue;
    }

    if (e.day === day) {
      sums.today += amount;
      counts.today++;
    }

    if (e.day >= firstWeek) {
      sums.week += amount;
      counts.week++;
    }

    if (e.day >= firstMonth) {
      sums.month += amount;
      counts.month++;
    }
  }

  return {
    sums,
    counts,
    missing: Array.from(missing)
  };
}

// ===== WIDGET UI =====

// Empty or unrecognised parameters show categories; OVERVIEW remains available.
function widgetMode(parameter) {
  return normalize(parameter).toUpperCase() === "OVERVIEW"
    ? "OVERVIEW"
    : "CATEGORIES";
}

function categoryRows(totals) {
  const others = [
    "Покупки", "Транспорт", "Поездки",
    "Здоровье", "Услуги", "Без категории"
  ].map(name => [name, totals[name] || 0])
    .sort((a, b) => b[1] - a[1]);

  return [
    ["Еда", totals["Еда"] || 0],
    ...others.slice(0, 2),
    ["Прочее", others.slice(2).reduce((sum, entry) => sum + entry[1], 0)]
  ];
}

function addText(parent, value, size, color, bold = false) {
  const t = parent.addText(String(value));

  t.font = bold
    ? Font.semiboldSystemFont(size)
    : Font.systemFont(size);

  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.65;

  return t;
}

function renderWidget(data, fx, mode = "CATEGORIES") {
  const day = localDay(new Date());
  const stats = hkdSummary(data.events, day, fx);

  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(12, 14, 10, 14);

  w.url = URLScheme.forRunningScript();

  w.refreshAfterDate =
    new Date(Date.now() + 30 * 60000);

  const categories =
    mode === "CATEGORIES";

  const incomplete =
    stats.missing.length > 0 ||
    data.errors.length > 0 ||
    !fx;

  // HEADER
  const header = w.addStack();
  header.centerAlignContent();

  addText(
    header,
    categories
      ? "SPEND  /  КАТЕГОРИИ"
      : "SPEND  /  ОБЗОР",
    10,
    COLORS.mint,
    true
  );

  header.addSpacer();

  addText(
    header,
    "HKD  ·  " +
      day.slice(5, 7) + "/" +
      day.slice(0, 4),
    9,
    COLORS.soft
  );

  w.addSpacer(6);

  // MONTH
  const month = w.addStack();
  const left = month.addStack();
  left.layoutVertically();

  addText(
    left,
    "ЗА МЕСЯЦ",
    9,
    COLORS.soft,
    true
  );

  addText(
    left,
    shortHKD(stats.sums.month) +
      (incomplete ? "*" : ""),
    23,
    COLORS.text,
    true
  );

  w.addSpacer(8);

  if (categories) {
    // CATEGORIES VIEW
    const totals = {};

    for (const e of data.events) {
      if (e.day.slice(0, 7) !==
          day.slice(0, 7))
        continue;

      if (e.day > day) continue;

      if (!["expense", "refund"]
        .includes(e.status))
        continue;

      const amount = hkdOf(e, fx);
      if (amount === null) continue;

      const category =
        categoryOf(e.merchant || "");

      totals[category] =
        (totals[category] || 0) + amount;
    }

    const rows = categoryRows(totals);

    for (let i = 0; i < 4; i++) {
      const [name, amount] = rows[i];

      const row = w.addStack();
      row.centerAlignContent();

      addText(
        row,
        name,
        11,
        i === 3 ? COLORS.soft : COLORS.text
      );

      row.addSpacer();

      addText(
        row,
        shortHKD(amount),
        12,
        i === 3 ? COLORS.soft : COLORS.mint,
        true
      );

      if (i < 3) w.addSpacer(5);
    }
  } else {
    // OVERVIEW
    const summary = w.addStack();
    summary.layoutHorizontally();

    const items = [
      ["СЕГОДНЯ", stats.sums.today],
      ["7 ДНЕЙ", stats.sums.week]
    ];

    items.forEach(([heading, amount], index) => {
      if (index) summary.addSpacer(8);

      const cell = summary.addStack();
      cell.layoutVertically();
      cell.backgroundColor = COLORS.card;
      cell.cornerRadius = 7;
      cell.setPadding(5, 9, 5, 9);

      addText(
        cell, heading, 8, COLORS.soft, true
      );

      addText(
        cell,
        shortHKD(amount),
        12,
        COLORS.text,
        true
      );
    });

    w.addSpacer(7);

    // LAST 7 DAYS CHART
    const dt = new Date(day + "T12:00:00");
    const points = [];

    for (let i = 6; i >= 0; i--) {
      const x = new Date(
        dt.getFullYear(),
        dt.getMonth(),
        dt.getDate() - i,
        12
      );

      const date = localDay(x);
      let total = 0;

      for (const e of data.events) {
        if (e.day !== date ||
            !["expense", "refund"]
              .includes(e.status))
          continue;

        const amount = hkdOf(e, fx);
        if (amount !== null)
          total += amount;
      }

      points.push({
        date,
        total: Math.max(0, total)
      });
    }

    const W = 610;
    const H = 72;
    const chartMax = 44;
    const plotBottom = 49;

    const ctx = new DrawContext();
    ctx.size = new Size(W, H);
    ctx.opaque = false;
    ctx.respectScreenScale = true;

    const max = Math.max(
      1, ...points.map(x => x.total)
    );

    for (let i = 0; i < 7; i++) {
      const cellW = W / 7;
      const bw = 32;
      const x = i * cellW +
        (cellW - bw) / 2;

      const height = points[i].total === 0
        ? 3
        : Math.max(
            4,
            Math.round(
              points[i].total / max * chartMax
            )
          );

      ctx.setFillColor(
        i === 6
          ? COLORS.mint
          : new Color("536B85")
      );

      ctx.fillRect(
        new Rect(
          x,
          plotBottom - height,
          bw,
          height
        )
      );

      ctx.setFont(
        Font.mediumSystemFont(17)
      );
      ctx.setTextColor(COLORS.soft);
      ctx.setTextAlignedCenter();

      ctx.drawTextInRect(
        points[i].date.slice(8),
        new Rect(
          i * cellW, 53, cellW, 18
        )
      );
    }

    const image = w.addImage(ctx.getImage());
    image.imageSize = new Size(305, 36);

    w.addSpacer(4);

    addText(
      w,
      stats.counts.month +
        " операций за месяц",
      9,
      COLORS.soft
    );
  }

  if (incomplete) {
    w.addSpacer(2);

    addText(
      w,
      "* HKD: оценка, данные могут быть неполными",
      8,
      COLORS.warning
    );
  }

  return w;
}

// ===== ALERTS =====

async function message(title, body) {
  const a = new Alert();
  a.title = title;
  a.message = body;
  a.addAction("OK");
  await a.presentAlert();
}

async function choose(title, body, actions) {
  const a = new Alert();
  a.title = title;
  a.message = body || "";

  actions.forEach(x => a.addAction(x));
  a.addCancelAction("Отмена");

  return await a.presentSheet();
}

// ===== MANUAL ENTRY =====

async function manualEntry(original = null) {
  const kind = await choose(
    "Тип операции",
    "Возврат уменьшает расходы",
    ["Расход", "Возврат"]
  );

  if (kind < 0) return;

  const a = new Alert();

  a.title = original
    ? "Проверить и исправить"
    : "Добавить вручную";

  a.addTextField(
    "Сумма",
    original && original.amountMinor
      ? String(
          original.amountMinor /
          (10 ** DECIMALS[original.currency])
        )
      : ""
  );

  a.addTextField(
    "Валюта",
    original && original.currency || "HKD"
  );

  a.addTextField(
    "Магазин",
    original && original.merchant || ""
  );

  if (!original)
    a.addTextField(
      "Дата YYYY-MM-DD",
      localDay(new Date())
    );

  a.addAction("Проверить");
  a.addCancelAction("Отмена");

  if (await a.presentAlert() < 0)
    return;

  const currency =
    currencyCode(a.textFieldValue(1));

  const merchant =
    normalize(a.textFieldValue(2)).slice(0, 240);

  const day = original
    ? original.day
    : a.textFieldValue(3).trim();

  let amountMinor;

  try {
    if (!currency)
      throw new Error("Неизвестная валюта");

    amountMinor = parseMinor(
      a.textFieldValue(0),
      currency,
      true
    );

    if (!merchant)
      throw new Error("Укажи магазин");

    if (!validDay(day))
      throw new Error("Неверная дата");
  } catch (e) {
    await message("Не сохранено", e.message);
    return;
  }

  const confirm = await choose(
    "Сохранить?",
    (kind ? "Возврат: " : "Расход: ") +
      formatMoney(amountMinor, currency) +
      "\n" + merchant +
      "\n" + day,
    ["Сохранить"]
  );

  if (confirm !== 0) return;

  const patch = {
    status: kind ? "refund" : "expense",
    amountMinor,
    currency,
    merchant,
    confirmed: true,
    reason: "Проверено вручную"
  };

  if (original) {
    saveOverride(original, patch);
  } else {
    const now = new Date();

    saveEvent({
      schema: 1,
      id: UUID.string(),
      day,
      receivedAt: now.toISOString(),
      utcOffsetMinutes:
        -now.getTimezoneOffset(),
      source: "Manual",
      origin: "manual",
      raw: "",
      ...patch
    });
  }

  await message(
    "Сохранено",
    formatMoney(amountMinor, currency) +
      "\n" + merchant
  );
}

// ===== JOURNAL =====

function statusName(e) {
  return {
    expense: "Расход",
    refund: "Возврат",
    review: "На проверке",
    ignored: "Исключено"
  }[e.status];
}

async function eventDetails(e) {
  const amount = e.amountMinor && e.currency
    ? formatMoney(e.amountMinor, e.currency)
    : "Сумма не назначена";

  const n = await choose(
    statusName(e) + " · " + amount,
    (e.merchant || e.source) +
      "\n" + e.day +
      "\n\n" + (e.reason || "") +
      "\n\nТекст:\n" +
      e.raw.slice(0, 1500),
    [
      "Подтвердить / исправить",
      "Исключить из расходов",
      "Запомнить категорию магазина"
    ]
  );

  if (n === 0) {
    await manualEntry(e);
    return;
  }

  if (n === 1) {
    const ok = await choose(
      "Исключить запись?",
      "Запись останется в журнале",
      ["Исключить"]
    );

    if (ok === 0)
      saveOverride(e, {
        status: "ignored",
        reason: "Исключено вручную",
        confirmed: true
      });

    return;
  }

  if (n === 2) {
    if (!e.merchant) {
      await message(
        "Нет магазина",
        "Сначала исправь название"
      );
      return;
    }

    const choice = await choose(
      "Категория: " + e.merchant,
      "Применится к прошлым и будущим покупкам",
      CATEGORIES
    );

    if (choice >= 0) {
      teachMerchant(
        e.merchant,
        CATEGORIES[choice]
      );

      await message(
        "Сохранено",
        e.merchant + " → " +
          CATEGORIES[choice]
      );
    }
  }
}

async function journal() {
  const ask = new Alert();

  ask.title = "Журнал";
  ask.addTextField(
    "Месяц YYYY-MM",
    localDay(new Date()).slice(0, 7)
  );

  ask.addAction("Открыть");
  ask.addCancelAction("Отмена");

  if (await ask.presentAlert() < 0)
    return;

  const month =
    ask.textFieldValue(0).trim();

  if (!validDay(month + "-01")) {
    await message(
      "Неверная дата",
      "Например: 2026-10"
    );
    return;
  }

  while (true) {
    const data = loadMonth(month + "-01");

    const sorted = data.events.slice()
      .sort((a, b) =>
        b.receivedAt.localeCompare(a.receivedAt)
      );

    const t = new UITable();
    t.showSeparators = true;

    let selected = null;

    const totals = {};

    for (const e of sorted) {
      if (!["expense", "refund"]
        .includes(e.status))
        continue;

      totals[e.currency] =
        (totals[e.currency] || 0) +
        (e.status === "refund" ? -1 : 1) *
        e.amountMinor;
    }

    const header = new UITableRow();
    header.isHeader = true;
    header.height = 70;

    header.addText(
      month + " · учтено",
      Object.keys(totals).map(
        k => formatMoney(totals[k], k)
      ).join(" / ") || "Нет расходов"
    );

    t.addRow(header);

    if (data.errors.length) {
      const r = new UITableRow();
      r.addText(
        "Ошибок чтения: " + data.errors.length,
        "Итог может быть неполным"
      );
      t.addRow(r);
    }

    for (const e of sorted.slice(0, 300)) {
      const r = new UITableRow();
      r.height = 65;

      const amount =
        e.amountMinor && e.currency
          ? formatMoney(
              e.amountMinor,
              e.currency
            )
          : "";

      r.addText(
        (e.merchant || e.source) +
          (amount ? " · " + amount : ""),
        e.day + " · " + statusName(e)
      );

      r.onSelect = () => {
        selected = e;
      };

      t.addRow(r);
    }

    if (!sorted.length) {
      const r = new UITableRow();
      r.addText(
        "Пока пусто",
        "Новых платежей ещё нет"
      );
      t.addRow(r);
    }

    await t.present();

    if (!selected) break;

    await eventDetails(selected);
  }
}

// ===== UNCATEGORIZED =====

function uncategorized(day) {
  const data = loadMonth(day);
  const byKey = new Map();

  for (const e of data.events) {
    if (!["expense", "refund"].includes(e.status))
      continue;
    if (!e.merchant ||
        categoryOf(e.merchant) !== "Без категории")
      continue;

    const key = merchantKey(e.merchant);
    if (!key) continue;

    const item = byKey.get(key) || {
      merchant: e.merchant,
      count: 0,
      totals: {}
    };

    item.count++;
    item.totals[e.currency] =
      (item.totals[e.currency] || 0) +
      (e.status === "refund" ? -1 : 1) *
      e.amountMinor;

    byKey.set(key, item);
  }

  const fx = readFx();

  return Array.from(byKey.values())
    .map(x => ({
      ...x,
      hkd: Object.entries(x.totals).reduce(
        (sum, [c, minor]) =>
          sum + (hkdOf({
            currency: c,
            amountMinor: minor,
            status: "expense"
          }, fx) || 0),
        0
      )
    }))
    .sort((a, b) => b.hkd - a.hkd);
}

async function sortUncategorized() {
  const list = uncategorized(localDay(new Date()));

  if (!list.length) {
    await message(
      "Всё разобрано",
      "В этом месяце нет магазинов без категории"
    );
    return;
  }

  const choices = CATEGORIES
    .filter(c => c !== "Без категории")
    .concat(["Пропустить"]);

  let done = 0;

  for (let i = 0; i < list.length; i++) {
    const x = list[i];

    const amounts = Object.entries(x.totals)
      .map(([c, minor]) => formatMoney(minor, c))
      .join(" / ");

    const n = await choose(
      x.merchant,
      amounts + " · операций: " + x.count +
        "\n" + (i + 1) + " из " + list.length +
        "\nКатегория запомнится для магазина",
      choices
    );

    if (n < 0) break;
    if (choices[n] === "Пропустить") continue;

    teachMerchant(x.merchant, choices[n]);
    done++;
  }

  if (done)
    await message(
      "Сохранено",
      "Категорий назначено: " + done
    );
}

// ===== EXPORT =====

async function exportData() {
  const ok = await choose(
    "Экспорт содержит личные данные",
    "Суммы, магазины и тексты уведомлений",
    ["Создать JSON"]
  );

  if (ok !== 0) return;

  const s = store();

  const result = {
    application: "SpendWidget",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    records: [],
    readErrors: []
  };

  const months = Array.from(
    new Set(
      s.fm.listContents(s.root)
        .filter(validDay)
        .map(d => d.slice(0, 7))
    )
  ).sort();

  for (const month of months) {
    const data = loadMonth(month + "-01");

    result.records.push(...data.events);
    result.readErrors.push(...data.errors);
  }

  const path = s.fm.joinPath(
    s.fm.temporaryDirectory(),
    "SpendWidget-export-" +
      localDay(new Date()) + ".json"
  );

  s.fm.writeString(
    path,
    JSON.stringify(result, null, 2)
  );

  await ShareSheet.present([path]);
}

// ===== TEST =====

async function testText() {
  const a = new Alert();

  a.title = "Тест уведомления";
  a.message = "Проверка без записи в журнал";

  a.addTextField(
    "Источник: Mox / Octopus",
    "Octopus"
  );

  a.addTextField(
    "Текст",
    "HK$10.00 for Train\nYour new balance is HK$100.00."
  );

  a.addAction("Проверить");
  a.addCancelAction("Отмена");

  if (await a.presentAlert() < 0)
    return;

  const parsed = parseNotification({
    source: sourceName(
      a.textFieldValue(0)
    ),
    raw: a.textFieldValue(1),
    tooLong: false
  });

  await message(
    "Результат — без записи",
    parsed.status === "expense"
      ? formatMoney(
          parsed.amountMinor,
          parsed.currency
        ) + "\n" +
        parsed.merchant +
        "\nКатегория: " +
        categoryOf(parsed.merchant)
      : parsed.reason
  );
}

// ===== MENU =====

async function appMenu() {
  while (true) {
    const pending = uncategorized(
      localDay(new Date())
    ).length;

    const choice = await choose(
      "SpendWidget v" + VERSION,
      "Mox + Octopus: автоматический разбор. " +
        "SC: проверка. Alipay: исключён.",
      [
        "Предпросмотр — обзор",
        "Предпросмотр — категории",
        "Журнал / исправления",
        "Разобрать без категории (" + pending + ")",
        "Добавить вручную",
        "Тест уведомления",
        "Экспорт JSON",
        "Обновить курс HKD"
      ]
    );

    if (choice < 0) return;

    if (choice === 0 || choice === 1) {
      const day = localDay(new Date());
      const fx = await updateFx(false);

      const w = renderWidget(
        loadPeriods(day),
        fx,
        choice === 0
          ? "OVERVIEW"
          : "CATEGORIES"
      );

      await w.presentMedium();
    }

    if (choice === 2)
      await journal();

    if (choice === 3)
      await sortUncategorized();

    if (choice === 4)
      await manualEntry();

    if (choice === 5)
      await testText();

    if (choice === 6)
      await exportData();

    if (choice === 7) {
      const fx = await updateFx(true);

      await message(
        "Курс HKD",
        fx
          ? "Данные на " + fx.date +
            "\nJPY за HKD: " +
            fx.rates.JPY +
            "\nCNY за HKD: " +
            fx.rates.CNY
          : "Курс недоступен"
      );
    }
  }
}

// ===== MAIN =====

async function main() {
  if (config.runsInWidget) {
    const day = localDay(new Date());
    const fx = await updateFx(false);

    const mode = widgetMode(args.widgetParameter);

    Script.setWidget(
      renderWidget(
        loadPeriods(day),
        fx,
        mode
      )
    );

    return;
  }

  const parameter = args.shortcutParameter;

  const hasParameter =
    parameter !== null &&
    parameter !== undefined;

  const shareTexts =
    args.plainTexts || [];

  if (hasParameter || shareTexts.length) {
    const output = ingest(
      hasParameter
        ? parameter
        : shareTexts.join("\n")
    );

    Script.setShortcutOutput(output);
    return;
  }

  if (config.runsInApp) {
    cleanupTmp();
    await updateFx(false);
    await appMenu();
    return;
  }

  Script.setShortcutOutput(
    "Нет входных данных"
  );
}

try {
  await main();
} catch (error) {
  const text =
    "SpendWidget: " +
    String(error.message || error);

  if (config.runsInWidget) {
    const w = new ListWidget();

    w.addText("Ошибка SpendWidget");
    w.addText(
      "Данные не сброшены. Открой скрипт."
    );

    Script.setWidget(w);
  } else if (config.runsInApp) {
    await message(
      "Ошибка — данные не сброшены",
      text
    );
  } else {
    throw new Error(text);
  }
}

Script.complete();

// Updater v2: ставит свежие скрипты из GitHub.
// Находит скрипт по содержимому, а не только по имени:
// если QuickActions у тебя лежит как «Untitled Script», обновит его.
// Историю расходов не трогает.

const RAW =
  "https://raw.githubusercontent.com/xieergaihao/iphone-scriptable-widgets/main/";

// [путь в репозитории, имя по умолчанию, признак в коде]
const FILES = [
  ["SpendWidget/SpendWidget.js", "SpendWidget",
    new RegExp("const FOLDER = \"Spend" + "Widget-data-v1\"")],
  ["QuickActions/QuickActions.js", "QuickActions", /^\/\/ QuickActions/],
  ["MyDayWidget/MyDayWidget.js", "MyDay", /^\s*\/\/ MyDay v/],
  ["Updater/Updater.js", "Updater", /^\/\/ Updater/]
];

const fm = FileManager.iCloud().fileExists(module.filename)
  ? FileManager.iCloud()
  : FileManager.local();
const dir = module.filename.slice(
  0, module.filename.lastIndexOf("/")
);

function localScripts() {
  return fm.listContents(dir)
    .filter(n => n.endsWith(".js"))
    .map(n => {
      const path = fm.joinPath(dir, n);
      try {
        if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(path) &&
            fm.isFileDownloaded && !fm.isFileDownloaded(path))
          return { name: n.slice(0, -3), path, code: null };
        return { name: n.slice(0, -3), path, code: fm.readString(path) };
      } catch (_) {
        return { name: n.slice(0, -3), path, code: null };
      }
    });
}

const report = [];
const scripts = localScripts();

for (const [path, defaultName, sign] of FILES) {
  try {
    const req = new Request(RAW + path + "?t=" + Date.now());
    req.timeoutInterval = 15;
    const code = await req.loadString();

    if (req.response.statusCode !== 200 || code.length < 200)
      throw new Error("HTTP " + req.response.statusCode);

    // Синтаксис проверяем до записи, чтобы не сломать рабочий скрипт.
    new (Object.getPrototypeOf(async function () {}).constructor)(code);

    let targets = scripts.filter(s =>
      s.code && sign.test(s.code)
    );

    if (!targets.length)
      targets = [{
        name: defaultName,
        path: fm.joinPath(dir, defaultName + ".js"),
        code: null
      }];

    for (const t of targets) {
      if (t.code === code) {
        report.push("= " + t.name);
        continue;
      }
      if (t.code !== null)
        fm.writeString(t.path + ".bak", t.code);
      fm.writeString(t.path, code);
      report.push((t.code === null ? "+ " : "↑ ") + t.name);
    }
  } catch (e) {
    report.push("✗ " + path + ": " + e.message);
  }
}

const text = report.join("\n");

if (config.runsInApp) {
  const a = new Alert();
  a.title = "Обновление";
  a.message = text +
    "\n\n↑ обновлён · + установлен · = без изменений" +
    "\n\nВиджет на экране подхватит новый код при следующем обновлении. " +
    "Чтобы сразу: зажми виджет → «Изменить» → выбери скрипт заново.";
  a.addAction("OK");
  await a.presentAlert();
} else {
  Script.setShortcutOutput(text);
}

Script.complete();

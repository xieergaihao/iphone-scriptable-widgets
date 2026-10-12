// Updater: ставит свежие SpendWidget, QuickActions и MyDayWidget из GitHub.
// Один раз вставь этот код в Scriptable под именем Updater,
// дальше обновление — запуск Updater (▶ или из «Команд»).
// Данные расходов (папка SpendWidget-data-v1) не трогает.

const RAW =
  "https://raw.githubusercontent.com/xieergaihao/iphone-scriptable-widgets/main/";

// [путь в репозитории, имена скрипта в Scriptable по приоритету]
const FILES = [
  ["SpendWidget/SpendWidget.js", ["SpendWidget"]],
  ["QuickActions/QuickActions.js", ["QuickActions Fixed", "QuickActions"]],
  ["MyDayWidget/MyDayWidget.js", ["MyDayWidget-v4", "MyDayWidget"]],
  ["Updater/Updater.js", ["Updater"]]
];

const fm = FileManager.iCloud().fileExists(module.filename)
  ? FileManager.iCloud()
  : FileManager.local();
const dir = module.filename.slice(
  0, module.filename.lastIndexOf("/")
);

const report = [];

for (const [path, names] of FILES) {
  try {
    const req = new Request(RAW + path + "?t=" + Date.now());
    req.timeoutInterval = 15;
    const code = await req.loadString();

    if (req.response.statusCode !== 200 || code.length < 200)
      throw new Error("HTTP " + req.response.statusCode);

    // Синтаксис проверяем до записи, чтобы не сломать рабочий скрипт.
    new (Object.getPrototypeOf(async function () {}).constructor)(code);

    const name = names.find(n =>
      fm.fileExists(fm.joinPath(dir, n + ".js"))
    ) || names[names.length - 1];

    const target = fm.joinPath(dir, name + ".js");
    const old = fm.fileExists(target)
      ? fm.readString(target)
      : null;

    if (old === code) {
      report.push("= " + name);
      continue;
    }

    if (old !== null)
      fm.writeString(target + ".bak", old);

    fm.writeString(target, code);
    report.push((old === null ? "+ " : "↑ ") + name);
  } catch (e) {
    report.push("✗ " + path + ": " + e.message);
  }
}

const text = report.join("\n");

if (config.runsInApp) {
  const a = new Alert();
  a.title = "Обновление";
  a.message = text + "\n\n↑ обновлён · + установлен · = без изменений";
  a.addAction("OK");
  await a.presentAlert();
} else {
  Script.setShortcutOutput(text);
}

Script.complete();

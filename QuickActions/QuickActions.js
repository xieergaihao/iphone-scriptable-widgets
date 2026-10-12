// QuickActions Fixed
// Medium: широкие кнопки, 3 колонки × 2 ряда.
// Без заголовка. Все существующие команды сохранены.

const COLORS = {
  background: "101C2B",
  tile: "203244",
  border: "30485B",
  accent: "83D6CB",
  text: "F4F8FA"
};

const ACTIONS = [
  ["Happ VPN",     "globe",       "QA VPN"],
  ["Идея",         "lightbulb",   "QA Idea"],
  ["TrainChinese", "book.closed","QA Translate"],
  ["Таймер",       "timer",       "QA Timer"],
  ["Домой",        "house",       "QA Home"],
  ["Slack себе",   "bubble.left", "QA Slack"]
];

// Размеры широких кнопок сохраняем.
const TILE_W = 104;
const TILE_H = 61;

const GAP_X = 7;
const GAP_Y = 9;

const ICON = 21;
const LABEL_H = 16;
const INNER_GAP = 6;

const GRID_W = TILE_W * 3 + GAP_X * 2;
const GRID_H = TILE_H * 2 + GAP_Y;

const CONTENT_TOP =
  (TILE_H - ICON - INNER_GAP - LABEL_H) / 2;

// Подпись рисуется по центру всей ширины кнопки.
// Её положение больше не зависит от длины слова.
function labelImage(title) {
  const ctx = new DrawContext();

  ctx.size = new Size(TILE_W, LABEL_H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  ctx.setFont(Font.semiboldSystemFont(10.5));
  ctx.setTextColor(new Color(COLORS.text));
  ctx.setTextAlignedCenter();

  ctx.drawTextInRect(
    title,
    new Rect(3, 1, TILE_W - 6, LABEL_H - 2)
  );

  return ctx.getImage();
}

function addButton(row, action) {
  const [title, symbolName, shortcut] = action;

  const tile = row.addStack();
  tile.layoutVertically();

  tile.size = new Size(TILE_W, TILE_H);
  tile.setPadding(0, 0, 0, 0);
  tile.spacing = 0;

  tile.cornerRadius = 13;
  tile.backgroundColor = new Color(COLORS.tile);
  tile.borderColor = new Color(COLORS.border);
  tile.borderWidth = 0.5;

  const url =
    "shortcuts://run-shortcut?name=" +
    encodeURIComponent(shortcut);

  tile.url = url;

  // Одинаковый отступ сверху и снизу.
  tile.addSpacer(CONTENT_TOP);

  // Иконка: точное центрирование фиксированными отступами.
  const iconRow = tile.addStack();
  iconRow.layoutHorizontally();
  iconRow.setPadding(0, 0, 0, 0);
  iconRow.spacing = 0;
  iconRow.size = new Size(TILE_W, ICON);

  iconRow.addSpacer((TILE_W - ICON) / 2);

  const symbol =
    SFSymbol.named(symbolName) ||
    SFSymbol.named("circle");

  symbol.applyFont(Font.systemFont(ICON));

  const image = iconRow.addImage(symbol.image);
  image.imageSize = new Size(ICON, ICON);
  image.applyFittingContentMode();
  image.tintColor = new Color(COLORS.accent);
  image.url = url;

  iconRow.addSpacer((TILE_W - ICON) / 2);

  tile.addSpacer(INNER_GAP);

  // Полноширинная подпись с уже заданным центром.
  const label = tile.addImage(labelImage(title));
  label.imageSize = new Size(TILE_W, LABEL_H);
  label.applyFittingContentMode();
  label.url = url;

  tile.addSpacer(CONTENT_TOP);
}

const widget = new ListWidget();
widget.backgroundColor = new Color(COLORS.background);
widget.setPadding(10, 8, 10, 8);
widget.spacing = 0;

// Вертикальное центрирование всей сетки.
widget.addSpacer();

// Горизонтальное центрирование всей сетки.
const centeredRow = widget.addStack();
centeredRow.layoutHorizontally();
centeredRow.setPadding(0, 0, 0, 0);
centeredRow.spacing = 0;
centeredRow.addSpacer();

const grid = centeredRow.addStack();
grid.layoutVertically();
grid.setPadding(0, 0, 0, 0);
grid.spacing = 0;
grid.size = new Size(GRID_W, GRID_H);

for (let r = 0; r < 2; r++) {
  const row = grid.addStack();

  row.layoutHorizontally();
  row.setPadding(0, 0, 0, 0);
  row.spacing = 0;
  row.size = new Size(GRID_W, TILE_H);

  for (let c = 0; c < 3; c++) {
    if (c > 0) {
      row.addSpacer(GAP_X);
    }

    addButton(row, ACTIONS[r * 3 + c]);
  }

  if (r === 0) {
    grid.addSpacer(GAP_Y);
  }
}

centeredRow.addSpacer();
widget.addSpacer();

Script.setWidget(widget);

if (config.runsInApp) {
  await widget.presentMedium();
}

Script.complete();

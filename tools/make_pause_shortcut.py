#!/usr/bin/env python3
"""Пауза.shortcut: «фильтр импульса» для лент. Ставится на автоматизацию «Приложение открыто».
10 секунд паузы → вопрос → «Закрыть» уводит на домашний экран."""
import plistlib, subprocess, uuid, sys
from pathlib import Path
OUT = Path(__file__).resolve().parent.parent / "Shortcuts"
U = lambda: str(uuid.uuid4()).upper()
def act(i, p): return {"WFWorkflowActionIdentifier": i, "WFWorkflowActionParameters": p}
g = U()
ITEMS = ["Закрыть — не нужно", "Открыть на 5 минут"]
A = [
    act("is.workflow.actions.notification", {"WFNotificationActionTitle": "Пауза 10 секунд",
        "WFNotificationActionBody": "Зачем ты сюда пришёл? Вдох — выдох.", "WFNotificationActionSound": False}),
    act("is.workflow.actions.delay", {"WFDelayTime": 10}),
    act("is.workflow.actions.choosefrommenu", {"GroupingIdentifier": g, "WFControlFlowMode": 0,
        "WFMenuPrompt": "Точно хочешь листать?", "WFMenuItems": ITEMS}),
    act("is.workflow.actions.choosefrommenu", {"GroupingIdentifier": g, "WFControlFlowMode": 1, "WFMenuItemTitle": ITEMS[0]}),
    act("is.workflow.actions.returntohomescreen", {}),
    act("is.workflow.actions.choosefrommenu", {"GroupingIdentifier": g, "WFControlFlowMode": 1, "WFMenuItemTitle": ITEMS[1]}),
    act("is.workflow.actions.timer.start", {"WFDuration": {"Value": {"Magnitude": 5, "Unit": "min"},
        "WFSerializationType": "WFQuantityFieldValue"}}),
    act("is.workflow.actions.choosefrommenu", {"GroupingIdentifier": g, "WFControlFlowMode": 2}),
]
wf = {"WFWorkflowClientVersion": "2607.0.2", "WFWorkflowMinimumClientVersion": 900,
      "WFWorkflowMinimumClientVersionString": "900",
      "WFWorkflowIcon": {"WFWorkflowIconStartColor": 2071128575, "WFWorkflowIconGlyphNumber": 59446},
      "WFWorkflowInputContentItemClasses": [], "WFWorkflowTypes": [], "WFWorkflowImportQuestions": [],
      "WFWorkflowActions": A}
raw, signed = OUT / "Pause.unsigned.shortcut", OUT / "Пауза.shortcut"
plistlib.dump(wf, raw.open("wb"), fmt=plistlib.FMT_BINARY)
r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(signed)], capture_output=True, text=True)
raw.unlink()
sys.exit(r.stderr) if r.returncode else print("OK", signed)

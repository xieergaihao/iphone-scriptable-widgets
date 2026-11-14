#!/usr/bin/env python3
"""Собирает и подписывает QA Timer.shortcut и QA Alarm.shortcut (меню с пресетами + «Другое…»)."""
import plistlib, subprocess, uuid, sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "Shortcuts"
OUT.mkdir(exist_ok=True)
U = lambda: str(uuid.uuid4()).upper()


def act(ident, params):
    return {"WFWorkflowActionIdentifier": ident, "WFWorkflowActionParameters": params}


def ref(u, name):
    return {"Value": {"OutputUUID": u, "Type": "ActionOutput", "OutputName": name},
            "WFSerializationType": "WFTextTokenAttachment"}


def text(s):
    return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}


def tokentext(u, name):
    return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {
        "OutputUUID": u, "Type": "ActionOutput", "OutputName": name}}},
        "WFSerializationType": "WFTextTokenString"}


def menu(prompt, items, body):
    g = U()
    acts = [act("is.workflow.actions.choosefrommenu", {
        "GroupingIdentifier": g, "WFControlFlowMode": 0,
        "WFMenuPrompt": prompt, "WFMenuItems": items})]
    for t in items:
        acts.append(act("is.workflow.actions.choosefrommenu", {
            "GroupingIdentifier": g, "WFControlFlowMode": 1, "WFMenuItemTitle": t}))
        acts += body(t)
    acts.append(act("is.workflow.actions.choosefrommenu", {"GroupingIdentifier": g, "WFControlFlowMode": 2}))
    return acts


def timer(mag):
    return act("is.workflow.actions.timer.start", {
        "WFDuration": {"Value": {"Magnitude": mag, "Unit": "min"},
                       "WFSerializationType": "WFQuantityFieldValue"}})


CLOCK = {"AppIntentIdentifier": "CreateAlarmIntent", "BundleIdentifier": "com.apple.clock",
         "Name": "Clock", "TeamIdentifier": "0000000000"}


def alarm(when):
    # реальный идентификатор экшена «Добавить будильник» (как в cherri): MobileTimerIntents.MTCreateAlarmIntent
    return act("com.apple.mobiletimer-framework.MobileTimerIntents.MTCreateAlarmIntent", {
        "dateComponents": when, "name": text("Будильник"), "allowsSnooze": True,
        "ShowWhenRun": False, "AppIntentDescriptor": CLOCK})


def timer_body(t):
    if t != "Другое…":
        return [timer(t.split()[0])]
    a = U()
    return [act("is.workflow.actions.ask", {"UUID": a, "WFAskActionPrompt": "Сколько минут?", "WFInputType": "Number"}),
            timer(ref(a, "Provided Input"))]


def alarm_body(t):
    if t != "Другое…":
        return [alarm(text(t))]
    a = U()
    return [act("is.workflow.actions.ask", {"UUID": a, "WFAskActionPrompt": "Во сколько?", "WFInputType": "Time"}),
            alarm(tokentext(a, "Provided Input"))]


def workflow(actions, glyph, color):
    return {"WFWorkflowClientVersion": "2607.0.2", "WFWorkflowMinimumClientVersion": 900,
            "WFWorkflowMinimumClientVersionString": "900",
            "WFWorkflowIcon": {"WFWorkflowIconStartColor": color, "WFWorkflowIconGlyphNumber": glyph},
            "WFWorkflowInputContentItemClasses": [], "WFWorkflowTypes": [],
            "WFWorkflowImportQuestions": [], "WFWorkflowActions": actions}


def build(name, wf):
    raw = OUT / (name + ".unsigned.shortcut")
    signed = OUT / (name + ".shortcut")
    plistlib.dump(wf, raw.open("wb"), fmt=plistlib.FMT_BINARY)
    r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(signed)],
                       capture_output=True, text=True)
    raw.unlink()
    if r.returncode != 0:
        sys.exit(name + ": " + r.stderr.strip())
    print("OK", signed)


TIMERS = ["10 мин", "15 мин", "20 мин", "25 мин", "30 мин", "45 мин", "60 мин", "90 мин", "Другое…"]
ALARMS = ["06:00", "07:00", "08:00", "08:40", "09:30", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "Другое…"]

build("QA Timer", workflow(menu("Таймер", TIMERS, timer_body), 59446, 4282601983))
build("QA Alarm", workflow(menu("Будильник", ALARMS, alarm_body), 59511, 4274264319))

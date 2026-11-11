#!/usr/bin/env python3
"""Собирает и подписывает Health.shortcut и Health Morning.shortcut для BodyWidget.

Health: шаги за сегодня, сон за сутки (длительность, фаза, источник), пульс покоя →
словарь → Run Script BodyWidget → обновить виджеты.
Health Morning: то же, но сначала открывает Google Health, ждёт синхронизацию и возвращается домой.
"""
import plistlib, subprocess, uuid, sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "Shortcuts"
OUT.mkdir(exist_ok=True)
U = lambda: str(uuid.uuid4()).upper()


def act(i, p): return {"WFWorkflowActionIdentifier": i, "WFWorkflowActionParameters": p}


def ref(u, n): return {"Value": {"OutputUUID": u, "Type": "ActionOutput", "OutputName": n},
                       "WFSerializationType": "WFTextTokenAttachment"}


def tok(u, n): return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {
    "OutputUUID": u, "Type": "ActionOutput", "OutputName": n}}}, "WFSerializationType": "WFTextTokenString"}


def text(s): return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}


def type_row(t):
    return {"Bounded": True, "Operator": 4, "Property": "Type", "Removable": False,
            "Values": {"Enumeration": {"Value": t, "WFSerializationType": "WFStringSubstitutableState"}}}


def find(uid, htype, date_row=None, sort_latest=False, limit=None):
    rows = [type_row(htype)] + ([date_row] if date_row else [])
    p = {"UUID": uid, "WFContentItemFilter": {"Value": {
        "WFActionParameterFilterPrefix": 1, "WFContentPredicateBoundedDate": False,
        "WFActionParameterFilterTemplates": rows}, "WFSerializationType": "WFContentPredicateTableTemplate"}}
    if sort_latest:
        p["WFContentItemSortProperty"] = "Start Date"
        p["WFContentItemSortOrder"] = "Latest First"
    if limit:
        p["WFContentItemLimitEnabled"] = True
        p["WFContentItemLimitNumber"] = limit
    return act("is.workflow.actions.filter.health.quantity", p)


TODAY = {"Bounded": True, "Operator": 1002, "Property": "Start Date", "Removable": True, "Values": {}}
LAST_DAY = {"Bounded": True, "Operator": 1001, "Property": "Start Date", "Removable": True,
            "Values": {"Number": "1", "Unit": 16384}}


def details(uid, src, prop):
    return act("is.workflow.actions.properties.health.quantity",
               {"UUID": uid, "WFContentItemPropertyName": prop, "WFInput": ref(src, "Health Samples")})


def core():
    st, stv, sts = U(), U(), U()
    sl, dur, stg, slsrc = U(), U(), U(), U()
    hr, hrv = U(), U()
    d = U()
    items = [("steps", stv, "Value"), ("stepsSource", sts, "Source"),
             ("sleepMin", dur, "Duration"), ("sleepStage", stg, "Value"), ("sleepSource", slsrc, "Source"),
             ("restingHR", hrv, "Value")]
    acts = [
        find(st, "Steps", TODAY),
        details(stv, st, "Value"), details(sts, st, "Source"),
        find(sl, "Sleep", LAST_DAY),
        details(dur, sl, "Duration"), details(stg, sl, "Value"), details(slsrc, sl, "Source"),
        find(hr, "Resting Heart Rate", None, sort_latest=True, limit=1),
        details(hrv, hr, "Value"),
        act("is.workflow.actions.dictionary", {"UUID": d, "WFItems": {"Value": {"WFDictionaryFieldValueItems": [
            {"WFItemType": 0, "WFKey": text(k), "WFValue": tok(u, "Health Sample Details")} for k, u, _ in items
        ]}, "WFSerializationType": "WFDictionaryFieldValue"}}),
        act("dk.simonbs.Scriptable.ParameterizedRunScriptIntent", {
            "fileName": "BodyWidget", "parameter": ref(d, "Dictionary"), "runInApp": False, "ShowWhenRun": False}),
        act("dk.simonbs.Scriptable.RefreshAllWidgetsIntent", {"ShowWhenRun": False}),
    ]
    return acts


def morning():
    app = {"BundleIdentifier": "com.fitbit.FitbitMobile", "Name": "Google Health"}
    return ([act("is.workflow.actions.openapp", {"WFAppIdentifier": app["BundleIdentifier"], "WFSelectedApp": app}),
             act("is.workflow.actions.delay", {"WFDelayTime": 15})]
            + core()
            + [act("is.workflow.actions.returntohomescreen", {})])


def wf(actions):
    return {"WFWorkflowClientVersion": "2607.0.2", "WFWorkflowMinimumClientVersion": 900,
            "WFWorkflowMinimumClientVersionString": "900",
            "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59683},
            "WFWorkflowInputContentItemClasses": [], "WFWorkflowTypes": [], "WFWorkflowImportQuestions": [],
            "WFWorkflowActions": actions}


def build(name, w):
    raw, out = OUT / (name + ".unsigned.shortcut"), OUT / (name + ".shortcut")
    plistlib.dump(w, raw.open("wb"), fmt=plistlib.FMT_BINARY)
    r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(out)],
                       capture_output=True, text=True)
    raw.unlink()
    if r.returncode:
        sys.exit(name + ": " + r.stderr)
    print("OK", out)


build("Health", wf(core()))
build("Health Morning", wf(morning()))

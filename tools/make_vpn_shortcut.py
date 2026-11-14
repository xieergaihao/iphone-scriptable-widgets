#!/usr/bin/env python3
"""QA VPN.shortcut: переключает VPN-конфигурацию Happ (Set VPN → Toggle) и показывает статус.
Конфигурацию ищем через «Найти VPN» по имени, содержащему «Happ»; если не нашли — выбор из списка."""
import plistlib, subprocess, uuid, sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "Shortcuts"
U = lambda: str(uuid.uuid4()).upper()
def act(i, p): return {"WFWorkflowActionIdentifier": i, "WFWorkflowActionParameters": p}
def att(u, name): return {"Value": {"OutputUUID": u, "Type": "ActionOutput", "OutputName": name},
                          "WFSerializationType": "WFTextTokenAttachment"}
def tok(u, name, pre="", post=""):
    return {"Value": {"string": pre + "￼" + post, "attachmentsByRange": {"{%d, 1}" % len(pre): {
        "OutputUUID": u, "Type": "ActionOutput", "OutputName": name}}}, "WFSerializationType": "WFTextTokenString"}
def text(s): return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}

find, cnt, allv, pick, cur = U(), U(), U(), U(), U()
g1, g2 = U(), U()
filt = {"Value": {"WFActionParameterFilterPrefix": 1, "WFContentPredicateBoundedDate": False,
                  "WFActionParameterFilterTemplates": [{"Bounded": True, "Operator": 99, "Property": "Name",
                                                        "Removable": True, "Values": {"String": "Happ", "Unit": 4}}]},
        "WFSerializationType": "WFContentPredicateTableTemplate"}
A = [
    act("is.workflow.actions.filter.vpns", {"UUID": find, "WFContentItemFilter": filt,
                                            "WFContentItemInputParameter": "Library",
                                            "WFContentItemLimitEnabled": True, "WFContentItemLimitNumber": 1}),
    act("is.workflow.actions.count", {"UUID": cnt, "Input": att(find, "VPNs")}),
    act("is.workflow.actions.conditional", {"GroupingIdentifier": g1, "WFControlFlowMode": 0, "WFCondition": 2,
                                            "WFNumberValue": "0", "WFInput": {"Type": "Variable", "Variable": att(cnt, "Count")}}),
    act("is.workflow.actions.vpn.set", {"WFVPNOperation": "Toggle", "WFVPN": att(find, "VPNs")}),
    act("is.workflow.actions.conditional", {"GroupingIdentifier": g1, "WFControlFlowMode": 1}),
    act("is.workflow.actions.filter.vpns", {"UUID": allv, "WFContentItemInputParameter": "Library"}),
    act("is.workflow.actions.choosefromlist", {"UUID": pick, "WFInput": att(allv, "VPNs"),
                                               "WFChooseFromListActionPrompt": "Какой VPN переключить?"}),
    act("is.workflow.actions.vpn.set", {"WFVPNOperation": "Toggle", "WFVPN": att(pick, "Chosen Item")}),
    act("is.workflow.actions.conditional", {"GroupingIdentifier": g1, "WFControlFlowMode": 2}),
    act("is.workflow.actions.delay", {"WFDelayTime": 1.5}),
    act("is.workflow.actions.vpn.get", {"UUID": cur}),
    act("is.workflow.actions.conditional", {"GroupingIdentifier": g2, "WFControlFlowMode": 0, "WFCondition": 100,
                                            "WFInput": {"Type": "Variable", "Variable": att(cur, "Current VPN")}}),
    act("is.workflow.actions.notification", {"WFNotificationActionTitle": "VPN включён",
                                             "WFNotificationActionBody": tok(cur, "Current VPN"),
                                             "WFNotificationActionSound": False}),
    act("is.workflow.actions.conditional", {"GroupingIdentifier": g2, "WFControlFlowMode": 1}),
    act("is.workflow.actions.notification", {"WFNotificationActionTitle": "VPN выключен",
                                             "WFNotificationActionBody": text("Китайские приложения работают напрямую"),
                                             "WFNotificationActionSound": False}),
    act("is.workflow.actions.conditional", {"GroupingIdentifier": g2, "WFControlFlowMode": 2}),
]
wf = {"WFWorkflowClientVersion": "2607.0.2", "WFWorkflowMinimumClientVersion": 900,
      "WFWorkflowMinimumClientVersionString": "900",
      "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59511},
      "WFWorkflowInputContentItemClasses": [], "WFWorkflowTypes": [], "WFWorkflowImportQuestions": [],
      "WFWorkflowActions": A}
raw, signed = OUT / "QA VPN.unsigned.shortcut", OUT / "QA VPN.shortcut"
plistlib.dump(wf, raw.open("wb"), fmt=plistlib.FMT_BINARY)
r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(signed)],
                   capture_output=True, text=True)
raw.unlink()
sys.exit(r.stderr) if r.returncode else print("OK", signed)

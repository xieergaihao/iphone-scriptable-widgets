#!/usr/bin/env python3
"""Текст со скриншота: последний скриншот → распознать текст → в буфер + уведомление."""
import plistlib, subprocess, uuid, sys
from pathlib import Path
OUT = Path(__file__).resolve().parent.parent / "Shortcuts"
U = lambda: str(uuid.uuid4()).upper()
def act(i, p): return {"WFWorkflowActionIdentifier": i, "WFWorkflowActionParameters": p}
def ref(u, n): return {"Value": {"OutputUUID": u, "Type": "ActionOutput", "OutputName": n}, "WFSerializationType": "WFTextTokenAttachment"}
def tok(u, n): return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"OutputUUID": u, "Type": "ActionOutput", "OutputName": n}}}, "WFSerializationType": "WFTextTokenString"}
s, t = U(), U()
acts = [
  act("is.workflow.actions.getlastscreenshot", {"UUID": s}),
  act("is.workflow.actions.extracttextfromimage", {"UUID": t, "WFImage": ref(s, "Latest Screenshot")}),
  act("is.workflow.actions.setclipboard", {"WFInput": ref(t, "Text from Image")}),
  act("is.workflow.actions.notification", {"WFNotificationActionTitle": "Текст скопирован", "WFNotificationActionBody": tok(t, "Text from Image")}),
]
wf = {"WFWorkflowClientVersion": "2607.0.2", "WFWorkflowMinimumClientVersion": 900, "WFWorkflowMinimumClientVersionString": "900",
      "WFWorkflowIcon": {"WFWorkflowIconStartColor": 1440408063, "WFWorkflowIconGlyphNumber": 59772},
      "WFWorkflowInputContentItemClasses": [], "WFWorkflowTypes": [], "WFWorkflowImportQuestions": [], "WFWorkflowActions": acts}
raw, out = OUT / "ocr.unsigned.shortcut", OUT / "Текст со скриншота.shortcut"
plistlib.dump(wf, raw.open("wb"), fmt=plistlib.FMT_BINARY)
r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(out)], capture_output=True, text=True)
raw.unlink()
sys.exit(r.stderr) if r.returncode else print("OK", out)

#!/usr/bin/env python3
"""Перевести скриншот: последний скриншот → текст → перевод на русский → в буфер + показать."""
import plistlib, subprocess, uuid, sys
from pathlib import Path
OUT = Path(__file__).resolve().parent.parent / "Shortcuts"
U = lambda: str(uuid.uuid4()).upper()
def act(i, p): return {"WFWorkflowActionIdentifier": i, "WFWorkflowActionParameters": p}
def ref(u, n): return {"Value": {"OutputUUID": u, "Type": "ActionOutput", "OutputName": n}, "WFSerializationType": "WFTextTokenAttachment"}
def tok(u, n): return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"OutputUUID": u, "Type": "ActionOutput", "OutputName": n}}}, "WFSerializationType": "WFTextTokenString"}
s, t, tr = U(), U(), U()
acts = [
  act("is.workflow.actions.getlastscreenshot", {"UUID": s}),
  act("is.workflow.actions.extracttextfromimage", {"UUID": t, "WFImage": ref(s, "Latest Screenshot")}),
  act("is.workflow.actions.text.translate", {"UUID": tr, "WFInputText": tok(t, "Text from Image"),
      "WFSelectedFromLanguage": "Detect Language", "WFSelectedLanguage": "Russian"}),
  act("is.workflow.actions.setclipboard", {"WFInput": ref(tr, "Translated Text")}),
  act("is.workflow.actions.showresult", {"Text": tok(tr, "Translated Text")}),
]
wf = {"WFWorkflowClientVersion": "2607.0.2", "WFWorkflowMinimumClientVersion": 900, "WFWorkflowMinimumClientVersionString": "900",
      "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59772},
      "WFWorkflowInputContentItemClasses": [], "WFWorkflowTypes": [], "WFWorkflowImportQuestions": [], "WFWorkflowActions": acts}
raw, out = OUT / "ocrtr.unsigned.shortcut", OUT / "Перевести скриншот.shortcut"
plistlib.dump(wf, raw.open("wb"), fmt=plistlib.FMT_BINARY)
r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(raw), "--output", str(out)], capture_output=True, text=True)
raw.unlink()
sys.exit(r.stderr) if r.returncode else print("OK", out)

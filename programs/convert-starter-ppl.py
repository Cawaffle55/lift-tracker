"""Converts starter-ppl.json (from build.py) into the app's program format: starter-ppl.program.json."""
import json,re
DEFAULT_REST="1:30"  # 90 s for every exercise (Cody's default)
p=json.load(open("starter-ppl.json"))
def conv(e):
    tech=e["technique"]; load=""
    if re.search(r"% 1RM",tech): load,tech=tech,""
    sup=""
    m=re.search(r"\(superset ([AB])\)",e["name"])
    name=e["name"]
    if m: sup="A"; name=name.replace(m.group(0),"").strip()
    return dict(name=name,warmupSets=e["warmupSets"],workingSets=e["workingSets"],reps=e["reps"],rpe=e["rpe"],
      technique=tech,load=load,rest=DEFAULT_REST,notes=e["notes"],substitutions=e["substitutions"],superset=sup)
out=dict(schema="lift-tracker/program@1",id="starter-ppl",name=p["name"],author="",
  description=p["description"]+" "+" ".join(p["generalNotes"]),
  schedule=p["schedule"],
  weeks=[dict(name="Week 1",notes="Repeat weekly; add load or reps week to week. Schedule: "+" → ".join(p["schedule"]),
    days=[dict(name=d["name"],notes=d["notes"],exercises=[conv(e) for e in d["exercises"]]) for d in p["days"]])])
json.dump(out,open("starter-ppl.program.json","w"),indent=2,ensure_ascii=False)

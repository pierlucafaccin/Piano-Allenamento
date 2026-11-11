#!/usr/bin/env python3
"""Build public Garmin summary from raw local JSON snapshots (stdlib only)."""
import datetime as dt
import json
import pathlib
import sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server import metrics

def main():
    v=metrics()
    v.pop('keyConfigured',None)
    v['dashboardBuilt']=(ROOT/'garmin'/'dashboard.html').is_file()
    v['publishedAt']=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    dst=ROOT/'garmin'/'summary.json'
    dst.parent.mkdir(parents=True,exist_ok=True)
    dst.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Public summary: {v.get("totalActivities",0)} activities, last Garmin pull: {v.get("lastPull")}')
if __name__=='__main__': main()

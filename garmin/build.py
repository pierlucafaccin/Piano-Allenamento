"""Step 6: read data/ and write ONE self-contained file, dashboard.html.

    py -3 build.py           build only
    py -3 build.py --open    build and open in your browser
"""
import datetime as dt
import json
import math
import os
import statistics as st
import sys
import webbrowser

import journal_store

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "dashboard.html")
TEMPLATE = os.path.join(HERE, "template.html")
HM_KM = 21.0975


# ------------------------------------------------------------------ io
def load(name, default):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def D(s):
    return dt.date.fromisoformat(str(s)[:10])


def monday(d):
    return d - dt.timedelta(days=d.weekday())


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def r(x, n=1):
    return None if x is None else round(x, n)


# ------------------------------------------------------------------ sports
GYM = {"strength_training", "indoor_cardio", "hiit", "yoga", "pilates", "mobility",
       "fitness_equipment", "breathwork", "elliptical", "stair_climbing", "rowing"}
SPORTS = [  # fixed order = fixed colour slot
    ("run", "Corsa"),
    ("gym", "Palestra e forza"),
    ("ride", "Ciclismo"),
    ("other", "Altro"),
]


def sport(tk):
    t = (tk or "").lower()
    if "run" in t:
        return "run"
    if "cycl" in t or "bik" in t or "ride" in t or "spin" in t:
        return "ride"
    if t in GYM or "strength" in t or "training" in t:
        return "gym"
    return "other"


def pretty_type(tk):
    names = {"running": "Corsa", "treadmill_running": "Tapis roulant", "strength_training": "Forza",
             "road_biking": "Bici da strada", "indoor_cycling": "Bici indoor", "paddelball": "Padel",
             "walking": "Camminata", "hiking": "Escursione", "trail_running": "Trail",
             "mountain_biking": "MTB", "yoga": "Yoga", "pilates": "Pilates", "hiit": "HIIT",
             "lap_swimming": "Nuoto", "cardio": "Cardio", "indoor_cardio": "Cardio indoor"}
    return names.get(tk, (tk or "Attività").replace("_", " ").capitalize())


TYPE_IT = {"rehab": "Riabilitazione", "gym": "Palestra", "mobility": "Mobilità",
           "physio": "Fisioterapia", "other": "Seduta"}


# ------------------------------------------------------------------ phases
def phase_at(phases, d):
    cur = None
    for p in phases:
        if D(p["start"]) <= d:
            cur = p
    return cur


def main():
    acts_raw = load("activities.json", [])
    daily = load("daily.json", {})
    sleep = load("sleep.json", {})
    hrv = load("hrv.json", {})
    weight = load("weight.json", {})
    profile = load("profile.json", {})
    state = load("state.json", {})
    J = journal_store.load()
    # Include manually completed sessions from the unified diary, but never
    # count 'partial' seed annotations as completed workouts.
    unified_file = os.path.join(HERE, "..", "local", "workout-log.json")
    try:
        with open(unified_file, encoding="utf-8") as f:
            unified_logs = json.load(f)
    except (OSError, ValueError):
        unified_logs = {}
    try:
        with open(os.path.join(HERE, "..", "training-plan.json"), encoding="utf-8") as f:
            public_plan = json.load(f)
        ex_lookup = {ex["id"]: ex["name"] for day in public_plan["schedule"].values() for ex in day.get("exercises", [])}
    except (OSError, ValueError, KeyError):
        ex_lookup = {}
    for date, rec in unified_logs.items():
        if rec.get("status") != "done":
            continue
        if not any(s.get("date") == date for s in J.get("sessions", [])):
            weekday = D(date).weekday()
            typ = "rehab" if weekday == 0 else "gym" if weekday in (1, 2, 3) else "other"
            summary = "; ".join(
                f"{ex_lookup.get(k, k)}: {v.get('sets', '')} {v.get('load', '')}".strip()
                for k, v in rec.get("exercises", {}).items()
            )
            J["sessions"].append({"date": date, "type": typ, "with": "Diario Copenhagen21K",
                                  "minutes": rec.get("minutes") or 0,
                                  "exercises": [], "notes": (rec.get("notes", "") + " | " + summary).strip(" | ")})
        if rec.get("painAfter") not in (None, "") and not any(c.get("date") == date for c in J.get("checkins", [])):
            J["checkins"].append({"date": date, "pain_rest": None,
                                   "pain_after": rec.get("painAfter"), "ankle": rec.get("notes", "")})
    phases = sorted(J["phases"], key=lambda p: p["start"])
    today = dt.date.today()

    # ---------------------------------------------------------- activities
    acts = []
    for a in acts_raw:
        if not a.get("startTimeLocal"):
            continue
        tk = (a.get("activityType") or {}).get("typeKey")
        dur = a.get("duration") or a.get("elapsedDuration") or 0
        dist = a.get("distance") or 0
        acts.append({
            "id": a.get("activityId"),
            "date": a["startTimeLocal"][:10],
            "time": a["startTimeLocal"][11:16],
            "name": a.get("activityName") or pretty_type(tk),
            "type": tk, "label": pretty_type(tk), "sport": sport(tk),
            "km": round(dist / 1000, 2) if dist else 0,
            "min": round(dur / 60, 1),
            "elev": r(a.get("elevationGain"), 0),
            "hr": r(a.get("averageHR"), 0), "hrMax": r(a.get("maxHR"), 0),
            "load": r(a.get("activityTrainingLoad"), 0),
            "te": r(a.get("aerobicTrainingEffect"), 1),
            "teAn": r(a.get("anaerobicTrainingEffect"), 1),
            "teLabel": a.get("trainingEffectLabel"),
            "moving": r((a.get("movingDuration") or 0) / 60, 1),
            "stride": r(a.get("avgStrideLength"), 0),
            "power": r(a.get("avgPower"), 0),
            "imMod": a.get("moderateIntensityMinutes"), "imVig": a.get("vigorousIntensityMinutes"),
            "sets": a.get("activeSets") or a.get("totalSets"), "reps": a.get("totalReps"),
            "steps": a.get("steps"),
            "kcal": r(a.get("calories"), 0),
            "zones": [round((a.get(f"hrTimeInZone_{i}") or 0) / 60, 1) for i in range(1, 6)],
            "f1k": a.get("fastestSplit_1000"), "f5k": a.get("fastestSplit_5000"),
            "f10k": a.get("fastestSplit_10000"), "fhm": a.get("fastestSplit_21098"),
            "cad": r(a.get("averageRunningCadenceInStepsPerMinute"), 0),
            "treadmill": "treadmill" in (tk or "") or "indoor" in (tk or ""),
        })
    acts.sort(key=lambda a: (a["date"], a["time"]))
    runs = [a for a in acts if a["sport"] == "run" and a["km"] > 0.3]

    sessions = sorted(J.get("sessions", []), key=lambda s: s.get("date", ""))
    checkins = sorted(J.get("checkins", []), key=lambda s: s.get("date", ""))

    # ---------------------------------------------------------- span
    dates = [D(a["date"]) for a in acts] + [D(k) for k in sleep] + [D(k) for k in daily] + \
            [D(s["date"]) for s in sessions if s.get("date")]
    first = min(dates) if dates else today - dt.timedelta(days=90)
    first_week = monday(first)
    this_week = monday(today)
    weeks = []
    w = first_week
    while w <= this_week:
        weeks.append(w)
        w += dt.timedelta(days=7)

    # ---------------------------------------------------------- weekly aggregates
    wk = {w.isoformat(): {"w": w.isoformat(), "load": 0, "logged": 0, "loggedMin": 0,
                          **{s: {"n": 0, "h": 0.0, "km": 0.0} for s, _ in SPORTS}} for w in weeks}
    for a in acts:
        k = monday(D(a["date"])).isoformat()
        if k not in wk:
            continue
        b = wk[k][a["sport"]]
        b["n"] += 1
        b["h"] += a["min"] / 60
        b["km"] += a["km"]
        wk[k]["load"] += a["load"] or 0
    # A logged session on a day the watch already recorded a gym/strength activity
    # is the same workout: don't count it twice.
    gym_days = {a["date"] for a in acts if a["sport"] == "gym"}
    for s in sessions:
        if not s.get("date") or s["date"] in gym_days:
            continue
        k = monday(D(s["date"])).isoformat()
        if k in wk:
            wk[k]["logged"] += 1
            wk[k]["loggedMin"] += float(s.get("minutes") or 0)
    weekly = []
    for w in weeks:
        x = wk[w.isoformat()]
        p = phase_at(phases, w + dt.timedelta(days=3))
        weekly.append({
            "w": x["w"], "load": round(x["load"]), "logged": x["logged"],
            "phase": p["kind"] if p else None,
            **{s: {"n": x[s]["n"], "h": round(x[s]["h"], 2), "km": round(x[s]["km"], 1)} for s, _ in SPORTS},
        })

    # this week vs previous 4 weeks
    def wsum(ws, s, f):
        return sum(x[s][f] for x in ws)
    cur = weekly[-1] if weekly else None
    prev4 = weekly[-5:-1]
    week_cmp = []
    for s, label in SPORTS:
        week_cmp.append({
            "sport": s, "label": label,
            "n": cur[s]["n"] if cur else 0, "h": cur[s]["h"] if cur else 0, "km": cur[s]["km"] if cur else 0,
            "avgN": r(wsum(prev4, s, "n") / max(len(prev4), 1)),
            "avgH": r(wsum(prev4, s, "h") / max(len(prev4), 1), 2),
            "avgKm": r(wsum(prev4, s, "km") / max(len(prev4), 1)),
        })
    week_cmp.append({"sport": "logged", "label": "Sedute di riabilitazione (log)",
                     "n": cur["logged"] if cur else 0, "h": None, "km": None,
                     "avgN": r(sum(x["logged"] for x in prev4) / max(len(prev4), 1)), "avgH": None, "avgKm": None})

    # ---------------------------------------------------------- recovery series
    def series(store, field, start=None):
        out = []
        for k in sorted(store):
            v = store[k].get(field) if isinstance(store[k], dict) else None
            if v is not None and (start is None or k >= start):
                out.append([k, v])
        return out

    rhr = series(daily, "rhr")
    rhr_src = "Frequenza cardiaca a riposo"
    if len(rhr) < 7:  # fallback while daily summaries are unavailable
        rhr = series(sleep, "hr")
        rhr_src = "Frequenza cardiaca media nel sonno"
    hrv_s = series(hrv, "night")
    sleep_h = [[k, round(v["total"] / 3600, 2)] for k, v in sorted(sleep.items()) if v.get("total")]
    sleep_sc = series(sleep, "score")
    hrv_base = None
    for k in sorted(hrv, reverse=True):
        b = hrv[k].get("baseline")
        if b:
            hrv_base = b
            break
    hrv_status = next((hrv[k].get("status") for k in sorted(hrv, reverse=True) if hrv[k].get("status")), None)

    def window(s, end, days):
        lo = (end - dt.timedelta(days=days - 1)).isoformat()
        return [v for k, v in s if lo <= k <= end.isoformat()]

    def kpi(s, lower_is_better=False):
        if not s:
            return None
        last_day = D(s[-1][0])
        cur7 = mean(window(s, last_day, 7))
        base = mean(window(s, last_day - dt.timedelta(days=7), 28))
        return {"last": s[-1][1], "lastDate": s[-1][0], "avg7": r(cur7, 1), "base28": r(base, 1),
                "delta": r(cur7 - base, 1) if cur7 is not None and base is not None else None,
                "lowerIsBetter": lower_is_better}

    # 7-day load vs 4-week average (acute vs chronic)
    def load_window(end, days):
        lo = end - dt.timedelta(days=days - 1)
        return sum(a["load"] or 0 for a in acts if lo <= D(a["date"]) <= end)
    acute = load_window(today, 7)
    chronic = load_window(today, 28) / 4

    # ---------------------------------------------------------- phase
    cur_phase = phase_at(phases, today) or {"kind": "build", "start": first.isoformat(), "name": "Training"}
    kind = cur_phase["kind"]
    meta = journal_store.PHASE_KINDS.get(kind, journal_store.PHASE_KINDS["build"])
    days_in = (today - D(cur_phase["start"])).days + 1
    target = int(cur_phase.get("weekly_target") or 4)
    sessions_this_week = (cur["logged"] + sum(cur[s]["n"] for s, _ in SPORTS)) if cur else 0
    # Days that count as "trained": a Garmin activity or a logged session
    trained_days = {a["date"] for a in acts} | {s["date"] for s in sessions if s.get("date")}

    # consistency streak: consecutive complete weeks hitting the phase target (current week excluded)
    def week_total(x):
        return x["logged"] + sum(x[s]["n"] for s, _ in SPORTS)
    streak = 0
    for x in reversed(weekly[:-1]):
        p = phase_at(phases, D(x["w"]) + dt.timedelta(days=3))
        t = int((p or {}).get("weekly_target") or 4)
        if week_total(x) >= t:
            streak += 1
        else:
            break

    # ---------------------------------------------------------- calendar heat (last 16 weeks)
    cal_start = this_week - dt.timedelta(weeks=15)
    by_day = {}
    for a in acts:
        by_day.setdefault(a["date"], []).append(f'{a["label"]} · {int(a["min"])} min')
    for s in sessions:
        if s.get("date"):
            by_day.setdefault(s["date"], []).append(f'{TYPE_IT.get(s.get("type"), "Seduta")} (dal log)'
                                                     + (f' · {int(float(s["minutes"]))} min' if s.get("minutes") else ""))
    mins_by_day = {}
    for a in acts:
        mins_by_day[a["date"]] = mins_by_day.get(a["date"], 0) + a["min"]
    for s in sessions:
        if s.get("date"):
            mins_by_day[s["date"]] = mins_by_day.get(s["date"], 0) + float(s.get("minutes") or 30)
    calendar = []
    d = cal_start
    while d <= this_week + dt.timedelta(days=6):
        k = d.isoformat()
        calendar.append({"d": k, "min": round(mins_by_day.get(k, 0)), "items": by_day.get(k, []),
                         "future": d > today, "logged": any(s.get("date") == k for s in sessions)})
        d += dt.timedelta(days=1)

    # ---------------------------------------------------------- running
    def pace(sec_per_km):
        return sec_per_km
    run_rows = []
    for a in runs:
        if a["km"] < 1 or not a["min"]:
            continue
        p = a["min"] * 60 / a["km"]
        eff = None
        if a["hr"] and a["km"] >= 2:
            eff = round((a["km"] * 1000 / a["min"]) / a["hr"], 3)  # metres per heartbeat
        run_rows.append({"id": a["id"], "date": a["date"], "km": a["km"], "pace": round(p), "hr": a["hr"], "eff": eff,
                         "name": a["name"], "treadmill": a["treadmill"]})

    months = []
    if acts or sessions:
        m = dt.date(first.year, first.month, 1)
        while m <= today:
            months.append(m)
            m = dt.date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    monthly = []
    for m in months:
        key = m.strftime("%Y-%m")
        ra = [x for x in runs if x["date"].startswith(key)]
        p = phase_at(phases, m + dt.timedelta(days=14))
        monthly.append({"m": key, "km": round(sum(x["km"] for x in ra), 1), "n": len(ra),
                        "phase": p["kind"] if p else None})

    # ---------------------------------------------------------- goal & prediction
    G = J["goal"]
    hm_runs = [a for a in runs if 20.8 <= a["km"] <= 21.8]
    pb = None
    if hm_runs:
        best = min(hm_runs, key=lambda a: a["min"] * HM_KM / a["km"])
        pb = {"s": round(best["min"] * 60), "date": best["date"], "name": best["name"], "km": best["km"]}
    if G.get("pb_s"):
        pb = {"s": int(G["pb_s"]), "date": G.get("pb_date", ""), "name": G.get("pb_label") or "Manual entry", "km": HM_KM}

    recent = [a for a in runs if (today - D(a["date"])).days <= 42]
    longest_recent = max((a["km"] for a in recent), default=0)
    need = {"runs": 12, "longKm": 12.0}
    eligible = kind == "build" and len(recent) >= need["runs"] and longest_recent >= need["longKm"]
    prediction = None
    if eligible:
        cands = []
        for a in recent:
            for key, km in (("f5k", 5), ("f10k", 10), ("fhm", HM_KM)):
                if a.get(key):
                    cands.append(a[key] * (HM_KM / km) ** 1.06)
            if a["km"] >= 8 and not a["treadmill"]:
                cands.append(a["min"] * 60 * (HM_KM / a["km"]) ** 1.06)
        if cands:
            prediction = round(min(cands))
    readiness = {"eligible": eligible, "runs": len(recent), "longKm": round(longest_recent, 1),
                 "need": need, "rehab": kind == "rehab", "prediction": prediction}

    # ---------------------------------------------------------- records
    records = []

    def add_record(cat, label, value, unit, a):
        if a:
            records.append({"cat": cat, "label": label, "value": value, "unit": unit, "id": a.get("id"),
                            "date": a["date"], "name": a.get("name") or a.get("label")})

    for key, lab, km in (("f1k", "1 km più veloce", 1), ("f5k", "5 km più veloci", 5),
                         ("f10k", "10 km più veloci", 10), ("fhm", "Mezza maratona più veloce", HM_KM)):
        if key == "fhm" and pb:
            continue  # use the whole-race time below so both cards agree
        c = [a for a in runs if a.get(key)]
        if c:
            a = min(c, key=lambda a: a[key])
            add_record("run", lab, a[key], "time", a)
    if pb and not any(x["label"] == "Mezza maratona più veloce" for x in records):
        pb_act = next((a for a in runs if a["date"] == pb.get("date")), None)
        records.append({"cat": "run", "label": "Mezza maratona più veloce", "value": pb["s"], "unit": "time",
                        "id": pb_act["id"] if pb_act else None,
                        "date": pb["date"], "name": pb["name"]})
    if runs:
        a = max(runs, key=lambda a: a["km"]); add_record("run", "Corsa più lunga", a["km"], "km", a)
    rides = [a for a in acts if a["sport"] == "ride" and a["km"] > 0]
    if rides:
        a = max(rides, key=lambda a: a["km"]); add_record("ride", "Uscita in bici più lunga", a["km"], "km", a)
        a = max(rides, key=lambda a: a["elev"] or 0); add_record("ride", "Più dislivello", a["elev"], "m", a)
    gyms = [a for a in acts if a["sport"] == "gym"]
    if gyms:
        a = max(gyms, key=lambda a: a["min"]); add_record("gym", "Seduta in palestra più lunga", a["min"], "min", a)
    if acts:
        a = max(acts, key=lambda a: a["load"] or 0); add_record("any", "Carico più alto", a["load"], "load", a)
        a = max(acts, key=lambda a: a["kcal"] or 0); add_record("any", "Più calorie", a["kcal"], "kcal", a)
    if weekly:
        bw = max(weekly, key=lambda x: x["run"]["km"])
        if bw["run"]["km"]:
            records.append({"cat": "run", "label": "Settimana con più km", "value": bw["run"]["km"], "unit": "km",
                            "date": bw["w"], "name": "week"})
        bw = max(weekly, key=lambda x: sum(x[s]["h"] for s, _ in SPORTS))
        records.append({"cat": "any", "label": "Settimana con più ore",
                        "value": round(sum(bw[s]["h"] for s, _ in SPORTS), 1), "unit": "h",
                        "date": bw["w"], "name": "week"})
    top_days = sorted(acts, key=lambda a: a["load"] or 0, reverse=True)[:6]

    # ---------------------------------------------------------- notes (phase-aware, no false alarms)
    notes = []
    k_rhr, k_hrv, k_sleep = kpi(rhr, True), kpi(hrv_s), kpi(sleep_h)
    if kind == "rehab":
        notes.append(("info", "Running is paused by plan. Zero running distance during Phase 1 is expected, not lost progress."))
    if k_rhr and k_rhr["delta"] is not None and k_rhr["delta"] >= 4:
        notes.append(("watch", f"{rhr_src} is {k_rhr['delta']:+.0f} bpm above your 4-week baseline this week. Could be fatigue, stress or illness."))
    if k_hrv and hrv_base and k_hrv["avg7"] is not None and hrv_base.get("balancedLow") and k_hrv["avg7"] < hrv_base["balancedLow"]:
        notes.append(("watch", f"HRV 7-day average ({k_hrv['avg7']:.0f} ms) is below your balanced range ({hrv_base['balancedLow']}–{hrv_base['balancedUpper']} ms)."))
    if k_sleep and k_sleep["avg7"] is not None and k_sleep["avg7"] < 6.5:
        notes.append(("watch", f"Sleep averaged {k_sleep['avg7']:.1f} h this week. Recovery and tissue repair need sleep."))
    last_ci = checkins[-1] if checkins else None
    if last_ci and (float(last_ci.get("pain_after") or 0) >= 4 or float(last_ci.get("pain_rest") or 0) >= 3):
        notes.append(("watch", f"Pain logged on {last_ci['date']}: worth mentioning to Francesco."))
    if not checkins and not sessions:
        notes.append(("tip", "Usa il diario della dashboard Copenhagen21K per registrare sedute, carichi e fastidi alla caviglia."))

    # ---------------------------------------------------------- per-day detail
    days_out = {}
    for k in set(daily) | set(sleep) | set(hrv):
        rec = {}
        for src, prefix in ((daily.get(k), ""), (sleep.get(k), "sl_"), (hrv.get(k), "hrv_")):
            if isinstance(src, dict):
                for f, v in src.items():
                    if v is not None and f != "baseline":
                        rec[prefix + f] = v
        if isinstance(hrv.get(k), dict) and hrv[k].get("baseline"):
            b = hrv[k]["baseline"]
            rec["hrv_lo"], rec["hrv_hi"] = b.get("balancedLow"), b.get("balancedUpper")
        days_out[k] = rec

    # ---------------------------------------------------------- payload
    payload = {
        "generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "lastPull": state.get("last_pull"),
        "today": today.isoformat(),
        "first": first.isoformat(),
        "sports": [{"key": s, "label": l} for s, l in SPORTS],
        "phase": {"kind": kind, "label": meta["label"], "focus": meta["focus"], "name": cur_phase.get("name"),
                  "start": cur_phase["start"], "daysIn": days_in, "target": target,
                  "sessionsThisWeek": sessions_this_week, "streak": streak},
        "phases": phases,
        "phaseKinds": journal_store.PHASE_KINDS,
        "goal": {**G, "pb": pb, "targetPace": round(G["target_s"] / HM_KM)},
        "readiness": readiness,
        "kpi": {"rhr": k_rhr, "rhrSrc": rhr_src, "hrv": k_hrv, "hrvBase": hrv_base, "hrvStatus": hrv_status,
                "sleep": k_sleep, "sleepScore": kpi(sleep_sc),
                "acute": round(acute), "chronic": round(chronic),
                "fitnessAge": (profile.get("fitnessAge") or {}).get("fitnessAge"),
                "age": (profile.get("fitnessAge") or {}).get("chronologicalAge"),
                "weight": (sorted(weight.items())[-1] if weight else None)},
        "notes": notes,
        "weekly": weekly,
        "weekCmp": week_cmp,
        "monthly": monthly,
        "series": {"rhr": rhr, "hrv": hrv_s, "sleepH": sleep_h, "sleepScore": sleep_sc},
        "runs": run_rows,
        "calendar": calendar,
        "records": records,
        "topDays": [a["id"] for a in top_days],
        "acts": [{k: v for k, v in a.items() if v not in (None, "") and k not in ("f1k", "f5k", "f10k", "fhm")}
                 for a in acts],
        "days": days_out,
        "journal": {"checkins": checkins[-60:], "sessions": sessions[-40:], "physio": J.get("physio", [])[-10:],
                    "program": J.get("program"), "exercises": J.get("exercises", []),
                    "checklist": J.get("return_checklist", [])},
        "hrZones": (profile.get("hrZones") or [None])[0],
    }

    with open(TEMPLATE, encoding="utf-8") as f:
        html = f.read()
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace("/*__DATA__*/null", blob)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"dashboard.html generata ({len(html)//1024} KB): {len(acts)} attività, "
          f"{len(sleep)} notti, fase: {meta['label']}")
    if "--open" in sys.argv:
        webbrowser.open("file:///" + OUT.replace("\\", "/"))


if __name__ == "__main__":
    main()

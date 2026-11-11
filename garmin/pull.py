"""Step 5: download your Garmin history into data/ as JSON (read-only).

    py -3 pull.py          last 12 months the first time, then only what's new
    py -3 pull.py --full   your whole history (a few more minutes)

Safe to re-run: it only fetches what is new (plus the last few days, which
Garmin keeps updating).
"""
import datetime as dt
import json
import os
import sys
import time

import garmin_api as g

DATA = g.DATA
SAMPLES = os.path.join(DATA, "_samples")
TODAY = dt.date.today()
FULL_START = dt.date(2005, 1, 1)  # floor for "full history"


# ----------------------------------------------------------------- helpers
def path(name):
    return os.path.join(DATA, name)


def load(name, default):
    try:
        with open(path(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(name, obj):
    os.makedirs(DATA, exist_ok=True)
    tmp = path(name) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path(name))


def sample(name, obj):
    """Keep one raw example per endpoint (helps fix parsing later)."""
    os.makedirs(SAMPLES, exist_ok=True)
    p = os.path.join(SAMPLES, name + ".json")
    if not os.path.exists(p) and obj:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)


def dig(d, dotted):
    for k in dotted.split("."):
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def d2s(d):
    return d.isoformat()


def s2d(s):
    return dt.date.fromisoformat(s[:10])


LOG = []


def say(msg, end="\n"):
    print(msg, end=end, flush=True)
    if not msg.startswith("\r") and msg.strip():
        LOG.append(msg.strip("\n"))


def ranges(start, end, days):
    cur = start
    while cur <= end:
        stop = min(cur + dt.timedelta(days=days - 1), end)
        yield cur, stop
        cur = stop + dt.timedelta(days=1)


def fetch_range(label, start, end, chunk, call):
    """Call call(a, b) over [start, end] in chunks; halve the chunk on HTTP 500."""
    out = []
    todo = list(ranges(start, end, chunk))
    total_days = (end - start).days + 1
    done_days = 0
    while todo:
        a, b = todo.pop(0)
        try:
            got = call(a, b) or []
            out.extend(got)
            done_days += (b - a).days + 1
            pct = 100 * done_days // max(total_days, 1)
            say(f"\r  {label}: {d2s(a)} -> {d2s(b)}  [{pct:3d}%]  {len(out)} records   ", end="")
        except g.TooLarge:
            n = (b - a).days + 1
            if n <= 1:
                say(f"\n  {label}: skipped {d2s(a)} (too large)")
                continue
            half = a + dt.timedelta(days=n // 2 - 1)
            todo[0:0] = [(a, half), (half + dt.timedelta(days=1), b)]
        except Exception as e:  # never crash on a gap
            say(f"\n  {label}: skipped {d2s(a)}..{d2s(b)} ({type(e).__name__})")
            done_days += (b - a).days + 1
    say("")
    return out


def plan(store, want_start, refresh_days=3):
    """Return the date ranges still needed for a date-keyed store."""
    if not store:
        return [(want_start, TODAY)]
    keys = sorted(store)
    have_min, have_max = s2d(keys[0]), s2d(keys[-1])
    jobs = []
    if want_start < have_min:
        jobs.append((want_start, have_min - dt.timedelta(days=1)))
    jobs.append((min(have_max, TODAY) - dt.timedelta(days=refresh_days), TODAY))
    return jobs


# ----------------------------------------------------------------- activities
ACT_KEEP = [
    "activityId", "activityName", "startTimeLocal", "startTimeGMT", "activityType",
    "distance", "duration", "movingDuration", "elapsedDuration", "elevationGain",
    "elevationLoss", "averageSpeed", "maxSpeed", "averageHR", "maxHR", "calories",
    "activityTrainingLoad", "aerobicTrainingEffect", "anaerobicTrainingEffect",
    "trainingEffectLabel", "vO2MaxValue", "averageRunningCadenceInStepsPerMinute",
    "avgStrideLength", "steps", "avgPower", "normPower", "averageBikingCadenceInRevPerMinute",
    "totalSets", "activeSets", "totalReps", "summarizedExerciseSets", "minTemperature",
    "maxTemperature", "lapCount", "fastestSplit_1000", "fastestSplit_1609",
    "fastestSplit_5000", "fastestSplit_10000", "fastestSplit_21098", "pr",
    "locationName", "manualActivity", "moderateIntensityMinutes", "vigorousIntensityMinutes",
] + [f"hrTimeInZone_{i}" for i in range(1, 6)]


def slim_activity(a):
    out = {k: a[k] for k in ACT_KEEP if k in a and a[k] is not None}
    t = a.get("activityType") or {}
    out["activityType"] = {"typeKey": t.get("typeKey"), "parentTypeId": t.get("parentTypeId")}
    return out


def pull_activities(want_start, state):
    store = {str(a["activityId"]): a for a in load("activities.json", [])}
    covered_from = state.get("activities_from")
    complete = bool(store) and covered_from and s2d(covered_from) <= want_start
    say(f"Attività ({'controllo nuove' if complete else 'download'})")
    start, limit, new = 0, 20, 0
    first_page = True
    while True:
        try:
            page = g.get("/activitylist-service/activities/search/activities",
                         {"start": start, "limit": limit}) or []
        except g.TooLarge:
            if limit > 1:
                limit = max(1, limit // 2)
                continue
            say(f"\n  skipped one activity at position {start} (too large)")
            start += 1
            continue
        if first_page:
            sample("activity", page[:1])
            first_page = False
        stop = False
        for a in page:
            aid = str(a.get("activityId"))
            day = (a.get("startTimeLocal") or "")[:10]
            if day and s2d(day) < want_start:
                stop = True
                break
            if aid in store and complete:
                stop = True
            if aid not in store:
                new += 1
            store[aid] = slim_activity(a)
        start += len(page)
        say(f"\r  {len(store)} attività salvate, {new} nuove (controllate {start})   ", end="")
        if stop or len(page) < limit:
            break
        limit = 20
    say("")
    acts = sorted(store.values(), key=lambda a: a.get("startTimeLocal", ""), reverse=True)
    save("activities.json", acts)
    if not complete:
        state["activities_from"] = d2s(want_start)
    return acts, new


# ----------------------------------------------------------------- daily summaries
def slim_day(it):
    return {
        "steps": dig(it, "movement.steps.value"),
        "rhr": dig(it, "heartRate.restingValue"),
        "stress": dig(it, "stress.avgLevel"),
        "bbMax": dig(it, "bodyBattery.maxValue"),
        "bbMin": dig(it, "bodyBattery.minValue"),
        "imMod": dig(it, "intensityMinutes.moderate"),
        "imVig": dig(it, "intensityMinutes.vigorous"),
        "resp": dig(it, "respiration.avgValue"),
    }


def day_of(it):
    for k in ("calendarDate", "summaryDate", "date", "day"):
        v = it.get(k) if isinstance(it, dict) else None
        if isinstance(v, str) and len(v) >= 10:
            return v[:10]
    return None


def slim_day_v1(it):
    return {
        "steps": it.get("totalSteps"),
        "rhr": it.get("restingHeartRate"),
        "stress": it.get("averageStressLevel") if (it.get("averageStressLevel") or -1) >= 0 else None,
        "bbMax": it.get("bodyBatteryHighestValue"),
        "bbMin": it.get("bodyBatteryLowestValue"),
        "bbWake": it.get("bodyBatteryAtWakeTime"),
        "imMod": it.get("moderateIntensityMinutes"),
        "imVig": it.get("vigorousIntensityMinutes"),
        "kcal": it.get("totalKilocalories"),
    }


def pull_daily(want_start):
    """Range endpoint first; if Garmin answers 'not found' (as on some accounts),
    fall back to one call per day."""
    store = load("daily.json", {})
    say("Riepiloghi giornalieri (passi, FC a riposo, stress, Body Battery)")
    jobs = plan(store, want_start)
    probe = None
    try:
        probe = g.get("/usersummary-service/v2/dailySummaries",
                      {"startDate": d2s(TODAY - dt.timedelta(days=2)), "endDate": d2s(TODAY)})
    except Exception:
        probe = None
    if isinstance(probe, dict) and probe.get("data"):
        def call(a, b):
            r = g.get("/usersummary-service/v2/dailySummaries",
                      {"startDate": d2s(a), "endDate": d2s(b)})
            items = (r or {}).get("data", []) if isinstance(r, dict) else (r or [])
            sample("daily", items[:1])
            return items
        for a, b in jobs:
            for it in fetch_range("days", a, b, 60, call):
                d = day_of(it)
                rec = {k: v for k, v in slim_day(it).items() if v is not None}
                if d and rec:
                    store[d] = rec
    else:
        days = []
        for a, b in jobs:
            x = a
            while x <= b:
                days.append(x)
                x += dt.timedelta(days=1)
        for i, x in enumerate(days, 1):
            try:
                it = g.get("/usersummary-service/usersummary/daily", {"calendarDate": d2s(x)})
            except Exception as e:
                say(f"\n  days: skipped {d2s(x)} ({type(e).__name__})")
                continue
            if isinstance(it, dict):
                sample("daily", [it])
                rec = {k: v for k, v in slim_day_v1(it).items() if v is not None}
                if rec:
                    store[d2s(x)] = rec
            say(f"\r  days: {d2s(x)}  [{100 * i // len(days):3d}%]  {len(store)} stored   ", end="")
            if i % 25 == 0:
                save("daily.json", dict(sorted(store.items())))  # keep progress if interrupted
        say("")
    save("daily.json", dict(sorted(store.items())))
    return store


# ----------------------------------------------------------------- sleep
def pull_sleep(want_start):
    store = load("sleep.json", {})

    def call(a, b):
        r = g.get("/sleep-service/sleep/dailySleepSummariesByDate",
                  {"startDate": d2s(a), "endDate": d2s(b)})
        if isinstance(r, dict):
            for v in r.values():
                if isinstance(v, list):
                    r = v
                    break
            else:
                r = [r]
        sample("sleep", (r or [])[:1])
        return r or []

    say("Sonno")
    for a, b in plan(store, want_start):
        for it in fetch_range("nights", a, b, 31, call):
            src = it.get("dailySleepDTO", it) if isinstance(it, dict) else {}
            d = day_of(src) or day_of(it)
            total = src.get("sleepTimeSeconds")
            if not d or not total:
                continue
            store[d] = {k: v for k, v in {
                "total": total,
                "deep": src.get("deepSleepSeconds"),
                "light": src.get("lightSleepSeconds"),
                "rem": src.get("remSleepSeconds"),
                "awake": src.get("awakeSleepSeconds"),
                "score": dig(src, "sleepScores.overall.value"),
                "hr": src.get("avgHeartRate"),
                "stress": src.get("avgSleepStress"),
                "resp": src.get("averageRespirationValue"),
            }.items() if v is not None}
    save("sleep.json", dict(sorted(store.items())))
    return store


# ----------------------------------------------------------------- HRV
def pull_hrv(want_start):
    store = load("hrv.json", {})

    def call(a, b):
        r = g.get(f"/hrv-service/hrv/daily/{d2s(a)}/{d2s(b)}") or {}
        items = r.get("hrvSummaries", []) if isinstance(r, dict) else r
        sample("hrv", items[:1])
        return items

    say("HRV")
    for a, b in plan(store, want_start):
        for it in fetch_range("nights", a, b, 365, call):
            d = day_of(it)
            if not d or it.get("lastNightAvg") is None:
                continue
            store[d] = {k: v for k, v in {
                "night": it.get("lastNightAvg"),
                "week": it.get("weeklyAvg"),
                "status": it.get("status"),
                "baseline": it.get("baseline"),
            }.items() if v is not None}
    save("hrv.json", dict(sorted(store.items())))
    return store


# ----------------------------------------------------------------- weight
def pull_weight(want_start):
    store = load("weight.json", {})

    def call(a, b):
        r = g.get(f"/weight-service/weight/range/{d2s(a)}/{d2s(b)}") or {}
        items = r.get("dailyWeightSummaries", []) if isinstance(r, dict) else []
        sample("weight", items[:1])
        return items

    say("Peso")
    for a, b in plan(store, want_start, refresh_days=7):
        for it in fetch_range("weigh-ins", a, b, 365, call):
            lw = it.get("latestWeight") or {}
            grams = lw.get("weight")
            d = it.get("summaryDate") or lw.get("calendarDate") or day_of(it)
            if grams and d:
                rec = {"kg": round(grams / 1000, 2)}
                if lw.get("bodyFat"):
                    rec["fat"] = lw["bodyFat"]
                if lw.get("muscleMass"):
                    rec["muscleKg"] = round(lw["muscleMass"] / 1000, 2)
                store[d[:10]] = rec
    save("weight.json", dict(sorted(store.items())))
    return store


# ----------------------------------------------------------------- snapshots
def pull_snapshots():
    say("Età fitness e zone cardio")
    out = load("profile.json", {})
    for key, p in (("fitnessAge", f"/fitnessage-service/fitnessage/v2/{d2s(TODAY)}"),
                   ("hrZones", "/biometric-service/heartRateZones/v2")):
        try:
            r = g.get(p)
            if r:
                out[key] = r
        except Exception as e:
            say(f"  {key}: not available ({type(e).__name__})")
    out["updated"] = dt.datetime.now().isoformat(timespec="seconds")
    save("profile.json", out)
    return out


# ----------------------------------------------------------------- main
def main():
    full = "--full" in sys.argv
    state = load("state.json", {})
    if full:
        state["mode"] = "full"
    mode = state.get("mode", "12m")
    t0 = time.time()

    try:
        g.token()
    except g.KeyProblem as e:
        say(f"PROBLEMA CON LA CHIAVE: {e}\nControlla .env.local: la chiave potrebbe mancare, essere sbagliata o scaduta.")
        sys.exit(1)

    if mode == "full":
        want_start = FULL_START
    else:
        want_start = TODAY - dt.timedelta(days=365)
    if state.get("start") and s2d(state["start"]) < want_start:
        want_start = s2d(state["start"])  # never shrink what we already have

    if state.get("schema", 1) < 2:  # v2 stores extra sleep fields: refetch sleep once
        save("sleep.json", {})
        state["schema"] = 2

    say(f"Scarico i dati Garmin ({'storico completo' if mode == 'full' else 'ultimi 12 mesi'})\n")
    acts, new = pull_activities(want_start, state)

    # For daily data, start from the oldest activity in full mode (no point
    # asking for years before you owned a watch).
    day_start = want_start
    if mode == "full" and acts:
        day_start = max(want_start, s2d(acts[-1]["startTimeLocal"]))
    daily = pull_daily(day_start)
    sleep = pull_sleep(day_start)
    hrv = pull_hrv(day_start)
    weight = pull_weight(day_start)
    pull_snapshots()

    state["start"] = d2s(want_start if mode != "full" else day_start)
    state["last_pull"] = dt.datetime.now().isoformat(timespec="seconds")
    save("state.json", state)

    def span(keys):
        keys = sorted(keys)
        return f"dal {keys[0]} al {keys[-1]}" if keys else "nessuno"

    act_days = sorted(a["startTimeLocal"][:10] for a in acts if a.get("startTimeLocal"))
    say("\n================ RIEPILOGO ================")
    say(f"Attività   : {len(acts):5d}  ({new} nuove)  {span(act_days)}")
    say(f"Giorni     : {len(daily):5d}               {span(daily)}")
    say(f"Sonno      : {len(sleep):5d} notti         {span(sleep)}")
    say(f"HRV        : {len(hrv):5d} notti         {span(hrv)}")
    say(f"Pesate     : {len(weight):5d}               {span(weight)}")
    say(f"Fatto in {time.time() - t0:.0f} s")
    with open(path("pull-log.txt"), "w", encoding="utf-8") as f:
        f.write(state["last_pull"] + "\n" + "\n".join(LOG) + "\n")


if __name__ == "__main__":
    main()

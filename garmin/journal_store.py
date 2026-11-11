"""Your manual training journal: phases, pain check-ins, rehab/gym sessions,
gym program and physio notes. Stored in data/journal.json (stays on your PC)."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
JOURNAL = os.path.join(HERE, "data", "journal.json")

PHASE_KINDS = {
    "rehab": {"label": "Fase 1 · Riabilitazione e ricostruzione",
              "focus": "Forza della caviglia, mobilità dell'anca, controllo del bacino, stabilità su una gamba. Corsa in pausa per scelta."},
    "return": {"label": "Fase 2 · Ritorno alla corsa",
               "focus": "Corse brevi e controllate sul tapis roulant. Si aumenta solo quanto la gamba destra lo consente."},
    "build": {"label": "Fase 3 · Preparazione mezza maratona",
              "focus": "Resistenza ed efficienza aerobica verso Copenaghen; obiettivi cronometrici da rivalutare dopo il recupero."},
}

EXERCISES_IT = [
    "Foam roller e pallina + mobilità caviglia/anca",
    "Box Squat Goblet 3 × 10–12 (controllo ginocchia)",
    "Pressa monopodalica 3 × (12 destra + 8 sinistra)",
    "RDL monopodalico con piede posteriore sulla panca",
    "Calf Raises a ginocchio flesso e Tibialis Raises",
    "Side Plank: 3 × 25–35 secondi",
    "Equilibrio monopodalico e 90/90 Hip (rehab)",
    "Upper A: panca manubri, rematore, croci, multipower, face pull, reverse fly, Pallof",
]

PROGRAM_IT = {
    "Monday": "LOWER A + REHAB\nBox Squat Goblet, pressa monopodalica (12 DX + 8 SX), RDL monopodalico, calf/tibialis, side plank e stabilità; Hip Thrust solo dalla sesta settimana.",
    "Tuesday": "UPPER A + TAPIS\nPanca piana manubri, rematore cavo basso, croci ai cavi, lento avanti multipower, face pull, reverse fly, Pallof Press. Tapis: progressione 8 settimane.",
    "Wednesday": "SCHEDA IN ARRIVO — nessun esercizio inserito prima della foto.",
    "Thursday": "SCHEDA IN ARRIVO — nessun esercizio inserito prima della foto.",
    "Friday": "TAPIS confermato: progressione corsa/camminata come martedì. Altri esercizi da integrare dalla foto.",
    "Saturday": "REST totale OPPURE rest attivo: camminata 30–40 minuti + mobilità (ordine libero con domenica).",
    "Sunday": "REST totale OPPURE rest attivo: camminata 30–40 minuti + mobilità (ordine libero con sabato).",
}

DEFAULT = {
    "version": 2,
    "goal": {
        "race": "Mezza Maratona di Copenaghen",
        "date": "2027-09-19",
        "distance_km": 21.0975,
        "target_s": 6000,   # obiettivo originale indicativo, non un ritmo prescritto in riabilitazione
        "pb_s": None,          # filled automatically from your Garmin half marathon
        "pb_label": "",
    },
    "phases": [
        {"start": "2026-03-01", "kind": "rehab", "name": "Infortunio caviglia · bici e palestra", "weekly_target": 4},
        {"start": "2026-06-02", "kind": "return", "name": "Ritorno alla corsa", "weekly_target": 4},
        {"start": "2026-10-26", "kind": "rehab", "name": "Riabilitazione e ricostruzione", "weekly_target": 4},
        {"start": "2026-11-09", "kind": "return", "name": "Ritorno graduale: palestra + tapis (8 settimane)", "weekly_target": 5},
    ],
    "exercises": list(EXERCISES_IT),
    "program": {
        "title": "Scheda Giovanni · 9 novembre 2026 · in completamento",
        "updated": "2026-11-11",
        "days": dict(PROGRAM_IT),
    },
    "return_checklist": [],   # criteria agreed with your physio, e.g. {"text": "...", "done": false}
    "checkins": [],           # {"date", "pain_rest", "pain_after", "ankle", "notes"}
    "sessions": [],           # {"date", "type", "with", "minutes", "exercises": [], "rpe", "pain", "notes"}
    "physio": [],             # {"date", "who", "text"}
}

# English defaults from version 1, translated automatically if you never changed them
_V1 = {
    "Ankle injury · bike & gym": "Infortunio caviglia · bici e palestra",
    "Return to running": "Ritorno alla corsa",
    "Rehab & rebuild": "Riabilitazione e ricostruzione",
    "Copenhagen build": "Preparazione Copenaghen",
    "Copenhagen Half Marathon": "Mezza Maratona di Copenaghen",
    "Preliminary plan (official program from Giovanni on Friday)": DEFAULT["program"]["title"],
}
_V1_EX = ["Foam roller & massage ball (glutes)", "Stationary bike + mobility (towel slides)",
          "Single-leg balance on mat", "Balance blocks + band (knee control)",
          "Calf work, knee at 90° + glute bridge", "Eccentric calf raises",
          "Leg press ~60 kg, 4 rounds descending reps", "Stretching + foam roller"]
_V1_PROG_MON = "Rehab & stability with Francesco"


def _migrate(j):
    for p in j.get("phases", []):
        p["name"] = _V1.get(p.get("name"), p.get("name"))
    g = j.get("goal") or {}
    g["race"] = _V1.get(g.get("race"), g.get("race"))
    j["exercises"] = [EXERCISES_IT[_V1_EX.index(e)] if e in _V1_EX else e for e in j.get("exercises", [])]
    pr = j.get("program") or {}
    pr["title"] = _V1.get(pr.get("title"), pr.get("title"))
    if (pr.get("days") or {}).get("Monday", "").startswith(_V1_PROG_MON):
        pr["days"] = dict(PROGRAM_IT)
    j["version"] = 2
    return j


def load():
    try:
        with open(JOURNAL, encoding="utf-8") as f:
            j = json.load(f)
    except (OSError, ValueError):
        j = {}
    out = json.loads(json.dumps(DEFAULT))
    if j and j.get("version", 1) < 2:
        j = _migrate(j)
    out.update(j)
    # Upgrade the old preliminary plan, but preserve any user-edited program.
    old_program = j.get("program") or {}
    title = old_program.get("title", "")
    if not old_program or "Piano provvisorio" in title or "official program from Giovanni" in title:
        out["program"] = json.loads(json.dumps(DEFAULT["program"]))
    # Existing Garmin history may have an October rehab phase; add the newly
    # confirmed November return-to-running block without replacing other phases.
    phases = out.get("phases") or []
    if not any(x.get("start") == "2026-11-09" for x in phases):
        phases.append({"start": "2026-11-09", "kind": "return", "name": "Ritorno graduale: palestra + tapis (8 settimane)", "weekly_target": 5})
    out["phases"] = sorted(phases,key=lambda p:p.get("start", ""))
    for k in ("goal",):
        merged = dict(DEFAULT[k])
        merged.update(j.get(k) or {})
        out[k] = merged
    return out


def save(j):
    os.makedirs(os.path.dirname(JOURNAL), exist_ok=True)
    tmp = JOURNAL + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, indent=1)
    os.replace(tmp, JOURNAL)

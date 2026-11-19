/* Copenhagen 21K — Modalità allenamento ("Coach").
 * Guida la seduta passo per passo: riscaldamento, serie con contatore, timer di recupero,
 * esercizi a tempo, intervalli sul tapis, defaticamento e salvataggio nel diario esistente.
 * Scrive nello stesso formato di progressi.js (performedSets / loadUnit / repUnit) tramite api.save.
 * Nessuna credenziale nel browser; la sessione in corso sopravvive a un ricaricamento della pagina.
 */
(() => {
  'use strict';
  const KEYS = ['mon','tue','wed','thu','fri','sat','sun'];
  const DAYNAMES = ['lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica'];
  const SESSION_KEY = 'piano-allenamento-coach-session';
  const PREFS_KEY = 'piano-allenamento-coach-prefs';
  const ESC = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nfmt = n => Number(n).toLocaleString('it-IT', {maximumFractionDigits: 2});
  const dec = v => { if (v === undefined || v === null || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const clock = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; };
  const LOADS = [
    {id: 'per_manubrio', short: 'kg per manubrio'}, {id: 'per_lato', short: 'kg per lato'},
    {id: 'macchina', short: 'kg macchina'}, {id: 'totale', short: 'kg totali'}, {id: 'corpo_libero', short: 'corpo libero'}
  ];
  const PLYO = /pogo|skater|salt|jump/i;

  /* Prescrizioni che il testo libero della scheda non descrive in modo leggibile per una macchina.
   * La fonte resta training-plan.json: qui c'è solo l'interpretazione per il contaserie. */
  const OVERRIDES = {
    'cable-hip-abd-band': w => ({sets: 2, timed: true, perSide: true, secMin: [30,35,40,35,45,50,45,60][w-1] || 30}),
    'step-down': w => ({sets: 3, perSide: true, repMin: [5,6,7,4,5,6,6,8][w-1] || 5, hint: `Gradino da ${[10,10,10,15,15,15,20,20][w-1] || 10} cm`}),
    'leg-press': () => ({sets: 3, repMin: 12, repMax: 12, hint: '12 ripetizioni con la destra, 8 con la sinistra. Registra la destra, annota la sinistra.'}),
    'bike-zone2': () => ({sets: 1, timed: true, secMin: 1200, hint: 'Zona 2: devi riuscire a parlare in frasi complete.'}),
    'ring-ab-roll': () => ({sets: 3, repMin: null, hint: 'Ripetizioni massime con tecnica pulita: ti fermi quando la schiena cede.'}),
    'hip-thrust': w => ({sets: 3, repMin: null, tentative: true, hint: ['Settimana 6: si introduce secondo scheda, dettagli da verificare con il trainer.', 'Settimana 7: variante a corpo libero.', 'Settimana 8: variante con manubrio.'][Math.min(2, Math.max(0, w - 6))]})
  };

  let api = null, root = null, S = null, ticker = null, wakeLock = null, audio = null;
  let prefs = loadJSON(PREFS_KEY, {voice: true, sound: true});

  function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch (_) { return fallback; } }
  function persist() { try { if (S) localStorage.setItem(SESSION_KEY, JSON.stringify(S)); } catch (_) {} }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {} }

  /* ---------- Date e settimana ---------- */
  function weekOf(date) {
    const start = new Date(api.getPlan().startDate + 'T12:00:00'), d = new Date(date + 'T12:00:00');
    return Math.floor((d - start) / 86400000 / 7) + 1;
  }
  const dayOf = date => KEYS[(new Date(date + 'T12:00:00').getDay() + 6) % 7];

  /* ---------- Lettura della prescrizione ---------- */
  function segmentForWeek(text, w) {
    const parts = String(text || '').split(';').map(s => s.trim()).filter(Boolean);
    const numbered = [];
    for (const p of parts) {
      const m = p.match(/^(?:sett(?:imane|imana|\.)?\s*)?(\d+)(?:\s*[–-]\s*(\d+))?\s*:\s*(.+)$/i);
      if (m) numbered.push({from: +m[1], to: +(m[2] || m[1]), text: m[3]});
    }
    if (!numbered.length) return {text: String(text || ''), tentative: false};
    const hit = numbered.find(x => w >= x.from && w <= x.to);
    if (hit) return {text: hit.text, tentative: false};
    const before = numbered.filter(x => x.to < w).pop() || numbered[0];
    return {text: before.text, tentative: true};
  }
  function rangeOf(str) { const m = String(str || '').match(/(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/); return m ? [dec(m[1]), dec(m[2] || m[1])] : [null, null]; }

  function prescription(e, w) {
    const seg = segmentForWeek(e.sets, w);
    const t = seg.text.replace(/(\d)\s*x\s*/gi, '$1 × ');
    const rest = String(e.rest || '');
    const [rMin, rMax] = /senza recupero/i.test(rest) ? [0, 0] : rangeOf(rest.match(/\d+[^a-z]*s\b/i)?.[0] || '');
    const rpe = (t.match(/RPE\s*([\d–-]+)/i) || String(e.notes || '').match(/RPE\s*([\d–-]+)/i) || [])[1];
    const p = {
      sets: Number(t.match(/(\d+)\s*(?:×|serie)/)?.[1]) || 3,
      repMin: null, repMax: null, secMin: null, secMax: null, timed: false,
      perSide: /per lato/i.test(e.sets || ''), rpe: rpe ? rangeOf(rpe) : null,
      rest: rMax ?? 60, restText: rest || '—', restKnown: rMax !== null,
      paired: /coppia/i.test(rest), tentative: seg.tentative, label: seg.text, hint: ''
    };
    const after = t.split('×').slice(1).join('×');
    if (/massim/i.test(after)) { /* ripetizioni massime */ }
    else if (/\d\s*(?:s\b|sec|secondi)/i.test(after)) { p.timed = true; [p.secMin, p.secMax] = rangeOf(after); }
    else if (/\d\s*min/i.test(t) && !after) { p.timed = true; p.sets = 1; p.secMin = (rangeOf(t)[0] || 1) * 60; }
    else { [p.repMin, p.repMax] = rangeOf(after); }
    const o = OVERRIDES[e.id]?.(w);
    if (o) Object.assign(p, {repMin: null, repMax: null, secMin: null, secMax: null, timed: false, tentative: false}, o);
    if (p.timed && p.secMax == null) p.secMax = p.secMin;
    if (!p.timed && p.repMax == null) p.repMax = p.repMin;
    p.sets = Math.max(1, Math.min(8, p.sets));
    return p;
  }
  const goal = (st, p) => p.sets + (S.ex[st.id]?.extra || 0);
  const targetText = p => p.timed
    ? `${p.sets} × ${p.secMin === p.secMax ? p.secMin : p.secMin + '–' + p.secMax} s${p.perSide ? ' per lato' : ''}`
    : `${p.sets} × ${p.repMin == null ? 'max' : p.repMin === p.repMax ? p.repMin : p.repMin + '–' + p.repMax}${p.perSide ? ' per lato' : ''}`;

  /* ---------- Storico e coach ---------- */
  function lastRecord(id, beforeDate) {
    const logs = api.getLogs();
    const dates = Object.keys(logs).filter(d => d < beforeDate && logs[d]?.exercises?.[id]?.performedSets?.length).sort();
    const d = dates.pop();
    return d ? {date: d, rec: logs[d].exercises[id]} : null;
  }
  function bestKg(id, unit, beforeDate) {
    let best = null;
    for (const [d, log] of Object.entries(api.getLogs())) {
      if (d >= beforeDate) continue;
      const r = log?.exercises?.[id]; if (!r || (r.loadUnit || 'totale') !== unit) continue;
      for (const s of r.performedSets || []) { const kg = dec(s.kg); if (kg !== null && (best === null || kg > best)) best = kg; }
    }
    return best;
  }
  function guessUnit(e) {
    const n = e.name.toLowerCase();
    if (/plank|bird dog|hollow|pogo|skater|ab roll|ponte|step down|tibialis|cyclette|equilibrio/.test(n)) return 'corpo_libero';
    if (/manubri/.test(n)) return 'per_manubrio';
    if (/bilanciere/.test(n)) return 'per_lato';
    return 'macchina';
  }
  function stepFor(unit, kg) { return unit === 'per_manubrio' ? (kg >= 10 ? 2 : 1) : unit === 'per_lato' ? 1.25 : 2.5; }

  /* Suggerimento prudente: sale solo se la settimana scorsa era piena e controllata. Non scende mai da solo. */
  function advice(e, p) {
    const last = lastRecord(e.id, S.date);
    if (!last) return {kg: null, text: p.timed ? 'Prima volta che lo registri: parti dalla durata minima con forma pulita.'
      : guessUnit(e) === 'corpo_libero' ? 'Prima volta che lo registri: ripetizioni prescritte, lente e controllate.'
      : 'Prima volta che lo registri: scegli un carico che ti lasci 2 ripetizioni in tasca.'};
    const sets = (last.rec.performedSets || []).filter(s => dec(s.reps) !== null);
    const unit = last.rec.loadUnit || 'totale';
    const kgs = sets.map(s => dec(s.kg)).filter(x => x !== null);
    const topKg = kgs.length ? Math.max(...kgs) : null;
    const reps = sets.map(s => dec(s.reps));
    const rpes = sets.map(s => dec(s.rpe)).filter(x => x !== null);
    const rpeMax = p.rpe?.[1] ?? 9;
    const summary = sets.map(s => `${s.reps}${dec(s.kg) !== null ? '×' + nfmt(dec(s.kg)) : ''}`).join(' · ');
    const when = new Date(last.date + 'T12:00:00').toLocaleDateString('it-IT', {weekday: 'short', day: 'numeric', month: 'short'});
    let text = `Ultima volta (${when}): ${summary}${unit === 'corpo_libero' ? '' : ' kg'}.`;
    if (p.timed || topKg === null || unit === 'corpo_libero') {
      if (p.timed && reps.length && Math.min(...reps) >= (p.secMax || 0)) text += ' Hai già tenuto il massimo: oggi resta lì e cura la qualità.';
      return {kg: topKg, unit, text};
    }
    const allTop = p.repMax != null && reps.length >= Math.min(p.sets, sets.length) && reps.every(r => r >= p.repMax);
    const struggled = (p.repMin != null && reps.some(r => r < p.repMin)) || rpes.some(r => r >= 10);
    const easier = rpes.length ? rpes.every(r => r <= rpeMax) : true;
    const lastPresc = prescription(e, weekOf(last.date));
    const schemeDown = lastPresc.repMin != null && p.repMax != null && p.repMax < lastPresc.repMin;
    const step = stepFor(unit, topKg);
    if (schemeDown) return {kg: topKg + step, unit, text: text + ` Lo schema scende a ${p.repMin}–${p.repMax} ripetizioni: puoi provare ${nfmt(topKg + step)} kg.`};
    if (allTop && !rpes.length) return {kg: topKg, unit, text: text + ` Range completato. Se l'ultima serie era comoda prova ${nfmt(topKg + step)} kg, altrimenti resta su ${nfmt(topKg)}. Segna l'RPE: la prossima volta te lo dico io.`};
    if (allTop && easier) return {kg: topKg + step, unit, text: text + ` Range completato con margine: prova ${nfmt(topKg + step)} kg.`};
    if (struggled) return {kg: topKg, unit, text: text + ` Resta su ${nfmt(topKg)} kg finché non chiudi tutte le serie nel range.`};
    return {kg: topKg, unit, text: text + ` Stesso carico, punta a una ripetizione in più.`};
  }

  const LINES = {
    setDone: ['Fatta. Respira.', 'Pulita. Avanti così.', 'Bene, recupera davvero.', 'Una in meno.', 'Questa conta.'],
    lastSet: ['Ultima serie: tecnica prima del peso.', 'Ultima. Falla bella.', 'Ultima, poi si cambia.'],
    exDone: ['Esercizio chiuso.', 'Archiviato. Prossimo.', 'Fatto, si va avanti.'],
    restEnd: ['Si riparte.', 'Tocca a te.', 'Recupero finito.']
  };
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  /* ---------- Audio, voce, vibrazione, schermo acceso ---------- */
  function unlockAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (_) {}
  }
  function beep(freq = 880, ms = 140, times = 1) {
    if (!prefs.sound || !audio) return;
    for (let i = 0; i < times; i++) {
      const t = audio.currentTime + i * (ms / 1000 + 0.08);
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
    }
  }
  function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch (_) {} }
  function say(text) {
    if (!prefs.voice || !('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'it-IT'; u.rate = 1.05; speechSynthesis.speak(u); } catch (_) {}
  }
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (_) {}
  }
  function releaseAwake() { try { wakeLock?.release(); } catch (_) {} wakeLock = null; }

  /* ---------- Costruzione della seduta ---------- */
  function buildSteps(plan, day, w) {
    const d = plan.schedule?.[day] || {exercises: []};
    const steps = [{type: 'checkin', key: 'checkin', title: 'Check-in'}];
    if (d.warmup?.length) steps.push({type: 'list', key: 'warmup', title: 'Riscaldamento', items: d.warmup});
    const ex = (d.exercises || []).filter(e => !(e.notBeforeWeek && w < e.notBeforeWeek)).map(e => ({type: 'exercise', key: 'ex:' + e.id, id: e.id, title: e.name}));
    // Mercoledì e venerdì la scheda dice "come lunedì": in palestra serve la lista vera, non il rimando.
    const rehabItems = d.rehab?.length === 1 && /luned/i.test(d.rehab[0]) && plan.schedule?.mon?.rehab?.length ? plan.schedule.mon.rehab : d.rehab;
    const rehab = rehabItems?.length ? [{type: 'list', key: 'rehab', title: 'Riabilitazione e stabilità', items: rehabItems}] : [];
    const run = (day === 'tue' || day === 'fri') && w >= 1 && w <= 8 ? [{type: 'run', key: 'run', title: 'Tapis roulant'}] : [];
    if (day === 'fri') steps.push(...run, ...ex, ...rehab);
    else steps.push(...rehab, ...ex, ...run);
    if (d.kind === 'rest') steps.push({type: 'walk', key: 'walk', title: 'Camminata e mobilità'});
    if (d.cooldown?.length) steps.push({type: 'list', key: 'cooldown', title: 'Defaticamento', items: d.cooldown});
    steps.push({type: 'summary', key: 'summary', title: 'Chiudi la seduta'});
    // Superserie: due esercizi consecutivi con recupero "(coppia)" si alternano.
    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i], b = steps[i + 1];
      if (a.type === 'exercise' && b.type === 'exercise' && !a.pair && /coppia/i.test(exById(a.id)?.rest || '') && /coppia/i.test(exById(b.id)?.rest || '')) { a.pair = b.id; b.pair = a.id; b.pairSecond = true; i++; }
    }
    return steps;
  }
  function exById(id) {
    const sch = api.getPlan().schedule || {};
    for (const k of KEYS) { const e = sch[k]?.exercises?.find(x => x.id === id); if (e) return e; }
    return null;
  }
  function runPhases(day, w) {
    const plan = api.getPlan();
    const r = (day === 'fri' ? (plan.runProgressionFriday || plan.runProgression) : plan.runProgression)?.[w - 1];
    if (!r) return [];
    const ph = [{kind: 'walk', sec: 300, label: 'Camminata di riscaldamento'}];
    if (r.continuous) ph.push({kind: 'run', sec: r.continuous * 60, label: 'Corsa continua'});
    else for (let i = 1; i <= r.sets; i++) { ph.push({kind: 'run', sec: r.run * 60, label: `Corsa ${i} di ${r.sets}`}); ph.push({kind: 'walk', sec: r.walk * 60, label: `Camminata ${i} di ${r.sets}`}); }
    ph.push({kind: 'walk', sec: 300, label: 'Camminata di defaticamento'});
    return ph;
  }

  function newSession(date) {
    const w = weekOf(date), day = dayOf(date), plan = api.getPlan();
    const log = api.getLogs()[date] || {};
    const steps = buildSteps(plan, day, Math.max(1, Math.min(8, w)));
    const ex = {};
    for (const st of steps.filter(s => s.type === 'exercise')) {
      const prev = log.exercises?.[st.id];
      ex[st.id] = {sets: (prev?.performedSets || []).map(s => ({...s})), loadUnit: prev?.loadUnit || null, note: prev?.note || '', skipped: false};
    }
    return {v: 1, date, week: w, day, startedAt: Date.now(), stepIdx: 0, steps, ex, checks: {}, painBefore: null,
      run: {phases: day === 'tue' || day === 'fri' ? runPhases(day, Math.max(1, Math.min(8, w))) : [], startedAt: null, pausedAt: null, pausedTotal: 0, done: false, form: {...(log.run || {})}},
      walk: {startedAt: null, stoppedAt: null, km: log.walkKm || '', mobility: !!log.mobilityDone},
      rest: null, timed: null, draft: {}, summary: {rpe: log.rpe || '', painAfter: log.painAfter || '', notes: log.notes || ''}, prs: []};
  }

  /* ---------- API pubblica ---------- */
  function mount(params) {
    api = params;
    root = document.getElementById('coach-root');
    if (!root) return;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && !root.hidden) { keepAwake(); tick(); } });
    const saved = loadJSON(SESSION_KEY, null);
    if (saved?.v === 1 && saved.date) offerResume(saved);
  }
  function offerResume(saved) {
    const bar = document.createElement('div');
    bar.className = 'coach-resume';
    bar.innerHTML = `<span>Hai una seduta aperta (${ESC(DAYNAMES[KEYS.indexOf(saved.day)])} ${ESC(saved.date.slice(8))}/${ESC(saved.date.slice(5, 7))}).</span><button type="button" class="btn btn-sm" data-resume>Riprendi</button><button type="button" class="btn btn-outline btn-sm" data-drop>Scarta</button>`;
    document.body.appendChild(bar);
    bar.addEventListener('click', ev => {
      if (ev.target.closest('[data-resume]')) { bar.remove(); S = saved; open(); }
      if (ev.target.closest('[data-drop]')) { if (confirm('Scartare la seduta aperta? Le serie non salvate andranno perse.')) { localStorage.removeItem(SESSION_KEY); bar.remove(); } }
    });
  }
  function start(date) {
    if (!api) return;
    document.querySelector('.coach-resume')?.remove();
    const saved = loadJSON(SESSION_KEY, null);
    if (saved?.date === date && saved.v === 1) S = saved;
    else {
      if (saved?.date && !confirm(`C'è una seduta aperta del ${saved.date}. Iniziarne una nuova la scarta. Procedere?`)) return;
      S = newSession(date);
    }
    unlockAudio();
    open();
  }
  function open() {
    root.hidden = false; document.body.classList.add('coach-open');
    keepAwake(); persist(); render();
    clearInterval(ticker); ticker = setInterval(tick, 250);
  }
  function close(keep = true) {
    clearInterval(ticker); ticker = null; releaseAwake();
    try { speechSynthesis.cancel(); } catch (_) {}
    root.hidden = true; root.innerHTML = ''; document.body.classList.remove('coach-open');
    if (!keep) { localStorage.removeItem(SESSION_KEY); S = null; }
    else if (S) { persist(); offerResume(S); S = null; }
  }

  /* ---------- Render ---------- */
  const step = () => S.steps[S.stepIdx];
  function elapsed() { return (Date.now() - S.startedAt) / 1000; }

  function render() {
    if (!S || !root) return;
    const st = step(), d = api.getPlan().schedule?.[S.day] || {};
    const outOfBlock = S.week < 1 || S.week > 8;
    root.innerHTML = `<div class="coach" role="dialog" aria-modal="true" aria-label="Modalità allenamento">
      <header class="coach-top">
        <button type="button" class="coach-icon" data-act="exit" aria-label="Esci dalla modalità allenamento">✕</button>
        <div class="coach-top-mid"><b>${ESC(d.title || 'Seduta')}</b><span><span data-live="elapsed">${clock(elapsed())}</span> · settimana ${S.week}</span></div>
        <button type="button" class="coach-icon ${prefs.voice ? 'on' : ''}" data-act="voice" aria-pressed="${prefs.voice}" aria-label="Voce del coach">${prefs.voice ? '🔊' : '🔈'}</button>
      </header>
      <nav class="coach-rail" aria-label="Passi della seduta">${S.steps.map((s, i) => `<button type="button" data-goto="${i}" class="${i === S.stepIdx ? 'now' : ''} ${stepDone(s) ? 'done' : ''}" title="${ESC(s.title)}" aria-label="${ESC(s.title)}"></button>`).join('')}</nav>
      ${outOfBlock ? `<p class="coach-warn">Questa data è fuori dal blocco di 8 settimane: la prescrizione mostrata è quella della settimana ${S.week < 1 ? 1 : 8}.</p>` : ''}
      <main class="coach-body">${renderStep(st)}</main>
      ${S.rest ? renderRest() : ''}
    </div>`;
    const focus = root.querySelector('[data-autofocus]'); if (focus) focus.focus();
  }

  function stepDone(s) {
    if (s.type === 'exercise') { const x = S.ex[s.id]; return x.skipped || x.sets.length >= goal(s, prescription(exById(s.id), clampW())); }
    if (s.type === 'list') { const c = S.checks[s.key] || []; return s.items.every((_, i) => c[i]); }
    if (s.type === 'run') return S.run.done;
    if (s.type === 'checkin') return S.painBefore !== null;
    if (s.type === 'walk') return !!S.walk.stoppedAt;
    return false;
  }
  const clampW = () => Math.max(1, Math.min(8, S.week));

  function navFooter(nextLabel = 'Avanti') {
    const last = S.stepIdx >= S.steps.length - 1;
    return `<div class="coach-nav"><button type="button" class="btn btn-outline" data-act="prev" ${S.stepIdx === 0 ? 'disabled' : ''}>Indietro</button>${last ? '' : `<button type="button" class="btn btn-outline" data-act="next">${ESC(nextLabel)}</button>`}</div>`;
  }

  function renderStep(st) {
    if (st.type === 'checkin') return renderCheckin();
    if (st.type === 'list') return renderList(st);
    if (st.type === 'exercise') return renderExercise(st);
    if (st.type === 'run') return renderRun();
    if (st.type === 'walk') return renderWalk();
    return renderSummary();
  }

  function scale(name, value, from = 0, to = 10) {
    return `<div class="coach-scale" role="group">${Array.from({length: to - from + 1}, (_, i) => i + from).map(n => `<button type="button" data-scale="${name}" data-val="${n}" class="${String(value) === String(n) ? 'on' : ''} ${n >= 7 ? 'hi' : n >= 4 ? 'mid' : ''}" aria-pressed="${String(value) === String(n)}">${n}</button>`).join('')}</div>`;
  }

  function renderCheckin() {
    const d = api.getPlan().schedule?.[S.day] || {};
    const plyo = (d.exercises || []).some(e => PLYO.test(e.name) && !(e.notBeforeWeek && S.week < e.notBeforeWeek));
    const warn = S.painBefore !== null && S.painBefore >= 4;
    const nEx = S.steps.filter(s => s.type === 'exercise').length;
    return `<section class="coach-card">
      <h1 class="coach-h">Prima di iniziare</h1>
      <p class="coach-sub">${ESC(d.short || '')}${nEx ? ` · ${nEx} esercizi` : ''}${S.run.phases.length ? ' · tapis' : ''}</p>
      <h2 class="coach-q">Come sta la caviglia adesso?</h2>
      <p class="coach-hint">0 nessun fastidio, 10 dolore forte.</p>
      ${scale('painBefore', S.painBefore)}
      ${warn ? `<div class="coach-alert"><b>Fastidio ${S.painBefore}/10.</b> Oggi tieni carichi e ampiezze dove non aumenta${plyo ? ', e lascia stare i salti' : ''}. Se peggiora durante la seduta fermati e segnalalo a ${ESC(api.getPlan().coach || 'chi ti segue')}.</div>` : ''}
      <button type="button" class="coach-go" data-act="next" ${S.painBefore === null ? 'disabled' : ''}>Iniziamo</button>
    </section>`;
  }

  /* "…Progressione: settimane 1–2 versione base; settimane 3–4 con lanci…" → variante della settimana corrente */
  function splitProgression(text, w) {
    const [base, prog] = String(text).split(/\.\s*Progressione:\s*/i);
    if (!prog) return {base: text, now: ''};
    for (const part of prog.split(';')) {
      const m = part.trim().match(/^sett(?:imane|\.)?\s*(\d+)(?:\s*[–-]\s*(\d+))?\s+(.+)$/i);
      if (m && w >= +m[1] && w <= +(m[2] || m[1])) return {base, now: m[3]};
    }
    return {base, now: ''};
  }
  function renderList(st) {
    const c = S.checks[st.key] || [];
    const done = st.items.filter((_, i) => c[i]).length;
    return `<section class="coach-card">
      <h1 class="coach-h">${ESC(st.title)}</h1>
      <p class="coach-sub">${done} di ${st.items.length} · tocca una voce quando l'hai fatta</p>
      <ul class="coach-checks">${st.items.map((it, i) => `<li><button type="button" data-check="${ESC(st.key)}" data-i="${i}" class="${c[i] ? 'on' : ''}" aria-pressed="${!!c[i]}"><span class="coach-tick" aria-hidden="true"></span><span>${(sp => `${ESC(sp.base)}${sp.now ? `<small class="coach-variant">Settimana ${clampW()}: ${ESC(sp.now)}</small>` : ''}`)(splitProgression(it, clampW()))}</span></button></li>`).join('')}</ul>
      <div class="coach-row"><button type="button" class="btn btn-outline btn-sm" data-act="timer60">Timer 60 s</button><button type="button" class="btn btn-outline btn-sm" data-act="timer30">Timer 30 s</button></div>
      <button type="button" class="coach-go" data-act="next">${done === st.items.length ? 'Avanti' : 'Prosegui comunque'}</button>
      ${navFooter()}
    </section>`;
  }

  /* --- Esercizio --- */
  function draftFor(st, e, p, x) {
    const i = x.sets.length;
    const unit = x.loadUnit || lastRecord(e.id, S.date)?.rec.loadUnit || guessUnit(e);
    if (S.draft.id === st.id && S.draft.i === i) return S.draft;
    const adv = advice(e, p);
    const lastSets = lastRecord(e.id, S.date)?.rec.performedSets || [];
    const prevHere = x.sets[i - 1];
    let kg = prevHere?.kg ?? (adv.kg != null ? String(adv.kg) : (lastSets[i]?.kg ?? lastSets[lastSets.length - 1]?.kg ?? ''));
    if (unit === 'corpo_libero') kg = prevHere?.kg ?? '';
    const reps = p.timed ? String(p.secMin ?? '') : String(prevHere?.reps ?? (p.repMax ?? p.repMin ?? lastSets[i]?.reps ?? ''));
    S.draft = {id: st.id, i, unit, kg: String(kg ?? ''), reps, rpe: ''};
    return S.draft;
  }

  function renderExercise(st) {
    const e = exById(st.id), p = prescription(e, clampW()), x = S.ex[st.id];
    if (!x.loadUnit) x.loadUnit = lastRecord(e.id, S.date)?.rec.loadUnit || guessUnit(e);
    const adv = advice(e, p);
    const target = goal(st, p), doneAll = x.sets.length >= target;
    const dr = draftFor(st, e, p, x);
    const pairName = st.pair ? exById(st.pair)?.name : '';
    const plyoWarn = PLYO.test(e.name) && S.painBefore >= 4;
    const setsHtml = x.sets.length ? `<ol class="coach-done-sets">${x.sets.map((s, i) => `<li><span>${i + 1}</span><b>${ESC(s.reps)}${p.timed ? ' s' : ''}</b>${dec(s.kg) !== null ? `<em>${nfmt(dec(s.kg))} kg</em>` : ''}${s.rpe ? `<small>RPE ${ESC(s.rpe)}</small>` : ''}<button type="button" data-undo="${i}" aria-label="Annulla serie ${i + 1}">↺</button></li>`).join('')}</ol>` : '';
    const unitLabel = LOADS.find(l => l.id === x.loadUnit)?.short || 'kg';
    return `<section class="coach-card coach-ex">
      <div class="coach-ex-head">
        <h1 class="coach-h">${ESC(e.name)}</h1>
        <p class="coach-sub">${ESC(targetText(p))}${p.rpe ? ` · RPE ${p.rpe[0] === p.rpe[1] ? p.rpe[0] : p.rpe[0] + '–' + p.rpe[1]}` : ''} · recupero ${ESC(p.restText)}</p>
        ${pairName ? `<p class="coach-pair">In coppia con <b>${ESC(pairName)}</b>: alterna senza pausa, recupera dopo il secondo.</p>` : ''}
      </div>
      ${p.tentative ? '<p class="coach-warn">Progressione per questa settimana non ancora trascritta: uso lo schema precedente. Chiedi conferma al trainer.</p>' : ''}
      ${plyoWarn ? '<p class="coach-alert">Caviglia sopra 4/10 al check-in: questo oggi lo salterei.</p>' : ''}
      ${p.hint ? `<p class="coach-hint">${ESC(p.hint)}</p>` : ''}
      <p class="coach-say">${ESC(adv.text)}</p>
      ${doneAll ? `<div class="coach-complete"><b>${x.sets.length} serie fatte.</b> ${x.sets.length < 10 ? '<button type="button" class="btn btn-outline btn-sm" data-act="extra">Aggiungi una serie</button>' : ''}</div>` : `
      <div class="coach-setno">Serie <b>${x.sets.length + 1}</b> di ${target}${x.sets.length + 1 > p.sets ? ' · extra' : x.sets.length + 1 === p.sets ? ' · ultima' : ''}</div>
      ${p.timed ? renderTimedControls(p, dr) : `
      <div class="coach-steppers">
        <div class="coach-stepper"><span class="coach-stepper-label">Ripetizioni${p.perSide ? ' per lato' : ''}</span>
          <div><button type="button" data-step="reps" data-d="-1" aria-label="Una ripetizione in meno">−</button><input data-field="reps" inputmode="numeric" value="${ESC(dr.reps)}" aria-label="Ripetizioni"><button type="button" data-step="reps" data-d="1" aria-label="Una ripetizione in più">+</button></div></div>
        ${x.loadUnit === 'corpo_libero' ? '' : `<div class="coach-stepper"><span class="coach-stepper-label">${ESC(unitLabel)}</span>
          <div><button type="button" data-step="kg" data-d="-1" aria-label="Meno carico">−</button><input data-field="kg" inputmode="decimal" value="${ESC(dr.kg)}" aria-label="Chili"><button type="button" data-step="kg" data-d="1" aria-label="Più carico">+</button></div></div>`}
      </div>`}
      <div class="coach-rpe"><span class="coach-stepper-label">Fatica della serie (RPE)</span>${[6, 7, 8, 9, 10].map(n => `<button type="button" data-rpe="${n}" class="${dr.rpe === String(n) ? 'on' : ''}" aria-pressed="${dr.rpe === String(n)}">${n}</button>`).join('')}</div>
      ${p.timed ? '' : `<button type="button" class="coach-go" data-act="setdone">Serie fatta</button>`}`}
      ${setsHtml}
      <details class="coach-more"><summary>Unità di carico, nota, note del trainer</summary>
        <div class="coach-units">${LOADS.map(l => `<button type="button" data-unit="${l.id}" class="${x.loadUnit === l.id ? 'on' : ''}">${ESC(l.short)}</button>`).join('')}</div>
        <label class="coach-label">Nota sull'esercizio<input type="text" data-field="note" maxlength="500" value="${ESC(x.note)}" placeholder="Tecnica, sensazioni, fastidi"></label>
        ${e.notes ? `<p class="coach-hint">Trainer: ${ESC(e.notes)}</p>` : ''}
        <button type="button" class="btn btn-outline btn-sm" data-act="skip">${x.skipped ? 'Riprendi esercizio' : 'Salta esercizio oggi'}</button>
      </details>
      ${navFooter(doneAll ? 'Prossimo esercizio' : 'Avanti')}
    </section>`;
  }

  function renderTimedControls(p, dr) {
    const t = S.timed;
    if (t && t.id === step().id) {
      return `<div class="coach-hold">
        <div class="coach-hold-side" data-live="hold-side">${p.perSide ? (t.side === 1 ? 'Primo lato' : 'Secondo lato') : 'Tieni'}</div>
        <div class="coach-hold-num" data-live="hold">${t.prep ? '' : clock(t.target)}</div>
        <div class="coach-row center"><button type="button" class="btn btn-outline" data-act="holdstop">Ho finito</button><button type="button" class="btn btn-outline" data-act="holdcancel">Annulla</button></div>
      </div>`;
    }
    return `<div class="coach-steppers"><div class="coach-stepper"><span class="coach-stepper-label">Secondi${p.perSide ? ' per lato' : ''}${p.secMax && p.secMax !== p.secMin ? ` (${p.secMin}–${p.secMax})` : ''}</span>
      <div><button type="button" data-step="reps" data-d="-5" aria-label="5 secondi in meno">−</button><input data-field="reps" inputmode="numeric" value="${ESC(dr.reps)}" aria-label="Secondi"><button type="button" data-step="reps" data-d="5" aria-label="5 secondi in più">+</button></div></div></div>
      <button type="button" class="coach-go" data-act="holdstart">Avvia ${dec(dr.reps) >= 60 ? clock(dec(dr.reps)) : dr.reps + ' s'}${p.perSide ? ' per lato' : ''}</button>
      <button type="button" class="btn btn-outline btn-sm coach-manual" data-act="setdone">Registra senza timer</button>`;
  }

  /* --- Recupero a tutto schermo --- */
  function renderRest() {
    const r = S.rest, left = (r.endsAt - Date.now()) / 1000;
    return `<div class="coach-rest" role="timer" aria-live="off">
      <div class="coach-rest-fill" data-live="restfill" style="transform:scaleY(${Math.max(0, Math.min(1, left / r.total))})"></div>
      <div class="coach-rest-inner">
        <span class="coach-rest-label">Recupero</span>
        <div class="coach-rest-num" data-live="rest">${clock(left)}</div>
        <p class="coach-rest-next">${ESC(r.next || '')}</p>
        <div class="coach-rest-actions"><button type="button" data-act="rest-15">−15 s</button><button type="button" data-act="rest+15">+15 s</button><button type="button" class="skip" data-act="restskip">Riparto ora</button></div>
      </div>
    </div>`;
  }
  function startRest(seconds, next) {
    if (!seconds) return;
    S.rest = {endsAt: Date.now() + seconds * 1000, total: seconds, next, warned: false};
    persist();
  }

  /* --- Tapis --- */
  function runState() {
    const R = S.run; if (!R.startedAt) return {i: 0, inPhase: 0, total: R.phases.reduce((a, p) => a + p.sec, 0), done: 0};
    const now = R.pausedAt || Date.now();
    let t = (now - R.startedAt - R.pausedTotal) / 1000;
    const total = R.phases.reduce((a, p) => a + p.sec, 0), done = Math.min(t, total);
    for (let i = 0; i < R.phases.length; i++) { if (t < R.phases[i].sec) return {i, inPhase: t, total, done}; t -= R.phases[i].sec; }
    return {i: R.phases.length, inPhase: 0, total, done: total};
  }
  function renderRun() {
    const R = S.run, plan = api.getPlan();
    if (!R.phases.length) return `<section class="coach-card"><h1 class="coach-h">Tapis roulant</h1><p class="coach-sub">Nessuna progressione definita per questa settimana.</p>${navFooter()}</section>`;
    const rs = runState(), ph = R.phases[rs.i];
    const runMin = R.phases.filter(p => p.kind === 'run').reduce((a, p) => a + p.sec, 0) / 60;
    if (R.done || rs.i >= R.phases.length) return renderRunForm(runMin);
    const f = R.form;
    return `<section class="coach-card coach-run ${ph.kind}">
      <p class="coach-sub">${ESC((S.day === 'fri' ? 'Venerdì' : 'Martedì'))}, settimana ${clampW()} · ${nfmt(runMin)} min di corsa in totale</p>
      <div class="coach-run-phase" data-live="runphase">${ph.kind === 'run' ? 'Corri' : 'Cammina'}</div>
      <div class="coach-run-label" data-live="runlabel">${ESC(ph.label)}</div>
      <div class="coach-run-num" data-live="run">${clock(ph.sec - rs.inPhase)}</div>
      <div class="coach-run-bar"><span data-live="runbar" style="width:${(rs.done / rs.total) * 100}%"></span></div>
      <div class="coach-run-next" data-live="runnext">${R.phases[rs.i + 1] ? `Poi: ${R.phases[rs.i + 1].kind === 'run' ? 'corsa' : 'camminata'} ${clock(R.phases[rs.i + 1].sec)}` : 'Ultima fase'}</div>
      <div class="coach-row center">
        ${!R.startedAt ? '<button type="button" class="coach-go" data-act="runstart">Avvia il tapis</button>' :
          R.pausedAt ? '<button type="button" class="coach-go" data-act="runresume">Riprendi</button>' : '<button type="button" class="coach-go alt" data-act="runpause">Pausa</button>'}
      </div>
      ${R.startedAt ? '<div class="coach-row center"><button type="button" class="btn btn-outline btn-sm" data-act="runskip">Salta fase</button><button type="button" class="btn btn-outline btn-sm" data-act="runend">Termina corsa</button></div>' : ''}
      <ol class="coach-phases">${R.phases.map((p, i) => `<li class="${p.kind} ${i < rs.i ? 'past' : i === rs.i ? 'now' : ''}" style="flex-grow:${p.sec}" title="${ESC(p.label)} ${clock(p.sec)}"></li>`).join('')}</ol>
      <p class="coach-hint">${ESC(plan.runProgressionNote ? 'Riscaldamento e defaticamento: 5 minuti di camminata ciascuno.' : '')} Il tapis è riabilitazione, non qualità: passo comodo.</p>
      ${navFooter()}
    </section>`;
  }
  function renderRunForm(runMin) {
    const f = S.run.form;
    return `<section class="coach-card">
      <h1 class="coach-h">Corsa chiusa</h1>
      <p class="coach-sub">Prescritti ${nfmt(runMin)} minuti di corsa. Completa con i dati del tapis o dell'orologio.</p>
      <div class="coach-grid">
        <label class="coach-label">Distanza (km)<input data-run="distanceKm" inputmode="decimal" value="${ESC(f.distanceKm ?? '')}" placeholder="Es. 3,2"></label>
        <label class="coach-label">FC media (bpm)<input data-run="avgHr" inputmode="numeric" value="${ESC(f.avgHr ?? '')}"></label>
        <label class="coach-label">Passo medio (mm:ss)<input data-run="pace" value="${ESC(f.pace ?? '')}" placeholder="6:10"></label>
        <label class="coach-label">Minuti di corsa<input data-run="runMinutes" inputmode="decimal" value="${ESC(f.runMinutes ?? '')}"></label>
      </div>
      <label class="coach-label">Come è andata?<input data-run="notes" value="${ESC(f.notes ?? '')}" placeholder="Respiro, caviglia, sensazioni"></label>
      <div class="coach-row"><button type="button" class="btn btn-outline btn-sm" data-act="runreset">Rifai il timer</button></div>
      <button type="button" class="coach-go" data-act="next">Avanti</button>
      ${navFooter()}
    </section>`;
  }

  /* --- Riposo attivo --- */
  function renderWalk() {
    const W = S.walk, t = W.startedAt ? ((W.stoppedAt || Date.now()) - W.startedAt) / 1000 : 0;
    return `<section class="coach-card">
      <h1 class="coach-h">Camminata e mobilità</h1>
      <p class="coach-sub">Se oggi è il giorno di riposo attivo: 30–40 minuti facili. Se è riposo completo, salta pure.</p>
      <div class="coach-run-num" data-live="walk">${clock(t)}</div>
      <div class="coach-row center">${!W.startedAt ? '<button type="button" class="coach-go" data-act="walkstart">Avvia</button>' : !W.stoppedAt ? '<button type="button" class="coach-go alt" data-act="walkstop">Stop</button>' : '<button type="button" class="btn btn-outline" data-act="walkreset">Azzera</button>'}</div>
      <div class="coach-grid"><label class="coach-label">Camminata (km)<input data-walk="km" inputmode="decimal" value="${ESC(W.km)}"></label>
      <button type="button" class="coach-toggle ${W.mobility ? 'on' : ''}" data-act="mobility" aria-pressed="${W.mobility}">Mobilità fatta</button></div>
      ${navFooter()}
    </section>`;
  }

  /* --- Riepilogo e salvataggio --- */
  function exerciseStepsDone() {
    const exSteps = S.steps.filter(s => s.type === 'exercise');
    return {all: exSteps.length, done: exSteps.filter(s => S.ex[s.id].sets.length).length};
  }
  function renderSummary() {
    const sm = S.summary, c = exerciseStepsDone();
    const rows = S.steps.filter(s => s.type === 'exercise').map(s => {
      const x = S.ex[s.id], e = exById(s.id);
      return `<li class="${x.sets.length ? '' : 'empty'}"><b>${ESC(e.name)}</b><span>${x.skipped ? 'Saltato' : x.sets.length ? x.sets.map(t => `${t.reps}${dec(t.kg) !== null ? '×' + nfmt(dec(t.kg)) : ''}`).join(' · ') : 'Nessuna serie'}</span></li>`;
    }).join('');
    return `<section class="coach-card">
      <h1 class="coach-h">Chiudi la seduta</h1>
      <p class="coach-sub">${clock(elapsed())} in totale · ${c.done} di ${c.all} esercizi registrati${S.run.done ? ' · corsa fatta' : ''}</p>
      ${S.prs.length ? `<div class="coach-pr"><b>Nuovi massimi oggi</b>${S.prs.map(p => `<span>${ESC(p)}</span>`).join('')}</div>` : ''}
      ${rows ? `<ul class="coach-recap">${rows}</ul>` : ''}
      <h2 class="coach-q">Quanto è stata dura, nel complesso?</h2>${scale('rpe', sm.rpe, 1, 10)}
      <h2 class="coach-q">Caviglia adesso</h2>${scale('painAfter', sm.painAfter)}
      ${sm.painAfter !== '' && S.painBefore !== null && Number(sm.painAfter) >= Number(S.painBefore) + 2 ? `<p class="coach-alert">Il fastidio è salito di ${Number(sm.painAfter) - Number(S.painBefore)} punti durante la seduta. Annotalo e parlane con ${ESC(api.getPlan().coach || 'chi ti segue')} prima della prossima.</p>` : ''}
      <label class="coach-label">Note della seduta<textarea data-sum="notes" rows="3" maxlength="10000" placeholder="Cosa ricordare la prossima volta">${ESC(sm.notes)}</textarea></label>
      <button type="button" class="coach-go" data-act="save">Salva nel diario</button>
      <p class="coach-hint" data-live="savemsg"></p>
      ${navFooter()}
    </section>`;
  }

  async function saveSession() {
    const logs = api.getLogs(), old = logs[S.date] || {};
    const entry = {...old, exercises: {...(old.exercises || {})}};
    for (const [id, x] of Object.entries(S.ex)) {
      if (!x.sets.length && !x.note) continue;
      const p = prescription(exById(id), clampW());
      entry.exercises[id] = {...(entry.exercises[id] || {}), performedSets: x.sets.map(s => ({reps: String(s.reps ?? ''), kg: String(s.kg ?? ''), rpe: String(s.rpe ?? '')})),
        loadUnit: x.loadUnit || 'totale', repUnit: p.timed ? 'secondi' : 'ripetizioni', note: x.note || entry.exercises[id]?.note || ''};
    }
    const exSteps = S.steps.filter(s => s.type === 'exercise'), active = exSteps.filter(s => !S.ex[s.id].skipped);
    const anything = exSteps.some(s => S.ex[s.id].sets.length) || S.run.startedAt || S.walk.startedAt;
    const hasRun = S.steps.some(s => s.type === 'run');
    entry.status = !anything ? 'skipped' : active.every(s => S.ex[s.id].sets.length) && (!hasRun || S.run.done) ? 'done' : 'partial';
    entry.minutes = String(Math.round(elapsed() / 60));
    if (S.summary.rpe !== '') entry.rpe = String(S.summary.rpe);
    if (S.summary.painAfter !== '') entry.painAfter = String(S.summary.painAfter);
    if (S.painBefore !== null) entry.painBefore = String(S.painBefore);
    entry.notes = S.summary.notes;
    if (S.day === 'tue' || S.day === 'fri') {
      const f = S.run.form;
      if (S.run.startedAt || Object.values(f).some(Boolean)) {
        const walkMin = S.run.phases.filter(p => p.kind === 'walk').reduce((a, p) => a + p.sec, 0) / 60;
        entry.run = {...(old.run || {}), ...f, status: S.run.done ? 'done' : 'partial', walkMinutes: f.walkMinutes || String(walkMin)};
      }
    }
    if (S.day === 'sat' || S.day === 'sun') {
      entry.walkKm = S.walk.km; entry.mobilityDone = S.walk.mobility;
    }
    entry.coach = {startedAt: new Date(S.startedAt).toISOString(), finishedAt: new Date().toISOString(), version: 1};
    await api.save(S.date, entry);
  }

  /* ---------- Azioni ---------- */
  function go(i) {
    S.stepIdx = Math.max(0, Math.min(S.steps.length - 1, i));
    S.timed = null; S.draft = {};
    persist(); render();
    root.querySelector('.coach-body')?.scrollTo?.(0, 0);
  }

  function commitSet(override = {}) {
    const st = step(), e = exById(st.id), p = prescription(e, clampW()), x = S.ex[st.id];
    const dr = S.draft;
    const reps = String(override.reps ?? dr.reps ?? '').trim();
    if (reps === '' && p.repMin != null && !p.timed) { flashMsg('Inserisci le ripetizioni fatte.'); return; }
    const set = {reps: reps || '0', kg: dr.kg || '', rpe: dr.rpe || ''};
    // Massimale personale (stessa unità di carico, date precedenti e serie di oggi)
    const kg = dec(set.kg);
    if (kg !== null && x.loadUnit !== 'corpo_libero') {
      const prevBest = bestKg(e.id, x.loadUnit, S.date), todayBest = Math.max(-Infinity, ...x.sets.map(s => dec(s.kg) ?? -Infinity));
      if (prevBest !== null && kg > prevBest && kg > todayBest) { S.prs.push(`${e.name}: ${nfmt(kg)} kg`); beep(1320, 120, 3); say('Nuovo massimo. ' + nfmt(kg) + ' chili.'); }
    }
    x.sets.push(set); x.skipped = false;
    S.draft = {}; S.timed = null;
    buzz(60);
    const finished = x.sets.length >= goal(st, p);
    const pIdx = st.pair ? S.steps.findIndex(s => s.id === st.pair) : -1;
    const partner = pIdx >= 0 ? S.ex[st.pair] : null;
    const partnerLeft = partner && !partner.skipped && partner.sets.length < goal(S.steps[pIdx], prescription(exById(st.pair), clampW()));
    const leave = (idx, restSec, next, line) => { if (restSec) startRest(restSec, next); say(line); S.stepIdx = idx; S.draft = {}; persist(); render(); };
    // Superserie: dal primo si passa subito al secondo; il recupero arriva dopo il secondo.
    if (partnerLeft && !st.pairSecond) return leave(pIdx, 0, '', 'Subito ' + exById(st.pair).name);
    if (partnerLeft && st.pairSecond) return leave(pIdx, p.rest, `Poi: ${exById(st.pair).name}, serie ${partner.sets.length + 1}`, pick(LINES.setDone));
    if (finished) {
      const after = Math.max(S.stepIdx, pIdx) + 1, ns = S.steps[Math.min(after, S.steps.length - 1)];
      return leave(Math.min(after, S.steps.length - 1), ns.type === 'exercise' ? p.rest : 0, `Poi: ${ns.title}`, pick(LINES.exDone));
    }
    const n = x.sets.length + 1, tot = goal(st, p);
    leave(S.stepIdx, p.rest, `Poi: serie ${n} di ${tot}${n === tot ? ' (ultima)' : ''}`, n === tot ? pick(LINES.lastSet) : pick(LINES.setDone));
  }

  function flashMsg(t) {
    let el = root.querySelector('.coach-toast');
    if (!el) { el = document.createElement('div'); el.className = 'coach-toast'; el.setAttribute('role', 'status'); root.querySelector('.coach')?.appendChild(el); }
    el.textContent = t; clearTimeout(el._t); el._t = setTimeout(() => el.remove(), 2600);
  }

  function onClick(ev) {
    const t = ev.target.closest('button,[data-goto]'); if (!t || !S) return;
    unlockAudio();
    const act = t.dataset.act;
    if (t.dataset.goto !== undefined) { go(Number(t.dataset.goto)); return; }
    if (t.dataset.scale) {
      const v = Number(t.dataset.val);
      if (t.dataset.scale === 'painBefore') S.painBefore = v; else S.summary[t.dataset.scale] = v;
      persist(); render(); return;
    }
    if (t.dataset.check) { const c = S.checks[t.dataset.check] = S.checks[t.dataset.check] || []; c[t.dataset.i] = !c[t.dataset.i]; buzz(20); persist(); render(); return; }
    if (t.dataset.step) {
      const f = t.dataset.step, d = Number(t.dataset.d), x = S.ex[step().id];
      const cur = dec(S.draft[f]) ?? 0;
      const inc = f === 'kg' ? stepFor(x.loadUnit, cur) * d : d;
      S.draft[f] = String(Math.max(0, +(cur + inc).toFixed(2)));
      persist(); render(); return;
    }
    if (t.dataset.rpe) { S.draft.rpe = S.draft.rpe === t.dataset.rpe ? '' : t.dataset.rpe; persist(); render(); return; }
    if (t.dataset.unit) { S.ex[step().id].loadUnit = t.dataset.unit; S.draft = {}; persist(); render(); return; }
    if (t.dataset.undo !== undefined) { const x = S.ex[step().id]; x.sets.splice(Number(t.dataset.undo), 1); S.draft = {}; persist(); render(); return; }
    switch (act) {
      case 'exit': close(true); return;
      case 'voice': prefs.voice = !prefs.voice; savePrefs(); if (prefs.voice) say('Voce attiva'); render(); return;
      case 'next': go(S.stepIdx + 1); return;
      case 'prev': go(S.stepIdx - 1); return;
      case 'timer30': case 'timer60': startRest(act === 'timer30' ? 30 : 60, 'Timer libero'); render(); return;
      case 'setdone': commitSet(); return;
      case 'extra': { const x = S.ex[step().id]; x.extra = (x.extra || 0) + 1; S.draft = {}; persist(); render(); return; }
      case 'skip': { const x = S.ex[step().id]; x.skipped = !x.skipped; persist(); if (x.skipped) go(S.stepIdx + 1); else render(); return; }
      case 'holdstart': {
        const p = prescription(exById(step().id), clampW());
        const sec = dec(S.draft.reps) || p.secMin || 30;
        S.timed = {id: step().id, target: sec, side: 1, perSide: p.perSide, prep: true, startsAt: Date.now() + 3000, sides: []};
        beep(660, 90); persist(); render(); return;
      }
      case 'holdstop': finishHold(true); return;
      case 'holdcancel': S.timed = null; persist(); render(); return;
      case 'rest-15': S.rest.endsAt -= 15000; S.rest.total = Math.max(S.rest.total - 15, 1); tick(); return;
      case 'rest+15': S.rest.endsAt += 15000; S.rest.total += 15; tick(); return;
      case 'restskip': S.rest = null; persist(); render(); return;
      case 'runstart': S.run.startedAt = Date.now(); S.run.lastPhase = -1; persist(); render(); return;
      case 'runpause': S.run.pausedAt = Date.now(); persist(); render(); return;
      case 'runresume': S.run.pausedTotal += Date.now() - S.run.pausedAt; S.run.pausedAt = null; persist(); render(); return;
      case 'runskip': { const rs = runState(); const left = S.run.phases[rs.i] ? S.run.phases[rs.i].sec - rs.inPhase : 0; S.run.startedAt -= left * 1000; tick(); render(); return; }
      case 'runend': if (confirm('Terminare adesso la corsa?')) endRun(); return;
      case 'runreset': S.run.startedAt = null; S.run.pausedAt = null; S.run.pausedTotal = 0; S.run.done = false; persist(); render(); return;
      case 'walkstart': S.walk.startedAt = Date.now(); S.walk.stoppedAt = null; persist(); render(); return;
      case 'walkstop': S.walk.stoppedAt = Date.now(); persist(); render(); return;
      case 'walkreset': S.walk.startedAt = null; S.walk.stoppedAt = null; persist(); render(); return;
      case 'mobility': S.walk.mobility = !S.walk.mobility; persist(); render(); return;
      case 'save': {
        t.disabled = true;
        saveSession().then(() => { say('Seduta salvata. Bravo.'); close(false); window.TrainingTracker?.render?.(); })
          .catch(err => { t.disabled = false; const m = root.querySelector('[data-live="savemsg"]'); if (m) m.textContent = 'Salvataggio non riuscito: ' + err.message + '. La seduta resta aperta su questo dispositivo.'; });
        return;
      }
    }
  }
  function finishHold(early) {
    const t = S.timed; if (!t) return;
    const held = t.prep ? 0 : Math.min(t.target, Math.round((Date.now() - t.startsAt) / 1000));
    t.sides.push(early ? held : t.target);
    if (t.perSide && t.side === 1) {
      t.side = 2; t.prep = true; t.startsAt = Date.now() + 5000; say('Cambia lato'); beep(660, 90, 2); persist(); render(); return;
    }
    const value = Math.min(...t.sides);
    S.timed = null;
    commitSet({reps: String(value)});
  }
  function endRun() {
    const R = S.run, rs = runState();
    let runSec = 0, walkSec = 0, t = rs.done;
    for (const p of R.phases) { const s = Math.min(p.sec, Math.max(0, t)); if (p.kind === 'run') runSec += s; else walkSec += s; t -= p.sec; }
    R.done = true; R.pausedAt = R.pausedAt || Date.now();
    R.form.runMinutes = R.form.runMinutes || String(Math.round(runSec / 30) / 2);
    R.form.walkMinutes = String(Math.round(walkSec / 30) / 2);
    beep(990, 160, 3); buzz([200, 100, 200]); say('Corsa finita. Ottimo lavoro.');
    persist(); render();
  }
  function onChange(ev) { onInput(ev); }
  function onInput(ev) {
    const el = ev.target; if (!S) return;
    if (el.dataset.field === 'note') { S.ex[step().id].note = el.value; persist(); return; }
    if (el.dataset.field) { S.draft[el.dataset.field] = el.value.replace(',', '.'); persist(); return; }
    if (el.dataset.run) { S.run.form[el.dataset.run] = el.value; persist(); return; }
    if (el.dataset.walk) { S.walk.km = el.value; persist(); return; }
    if (el.dataset.sum) { S.summary[el.dataset.sum] = el.value; persist(); }
  }

  /* ---------- Tick: aggiorna solo i numeri, senza ridisegnare ---------- */
  function setLive(name, text) { const el = root.querySelector(`[data-live="${name}"]`); if (el && el.textContent !== text) el.textContent = text; return el; }
  function tick() {
    if (!S || root.hidden) return;
    setLive('elapsed', clock(elapsed()));
    if (S.rest) {
      const left = (S.rest.endsAt - Date.now()) / 1000;
      if (!root.querySelector('.coach-rest')) render();
      setLive('rest', clock(Math.ceil(left)));
      const fill = root.querySelector('[data-live="restfill"]');
      if (fill) { fill.style.transform = `scaleY(${Math.max(0, Math.min(1, left / S.rest.total))})`; fill.classList.toggle('late', left <= 10); }
      if (left <= 10 && !S.rest.warned) { S.rest.warned = true; beep(740, 100); }
      if (left <= 0) { S.rest = null; beep(990, 180, 2); buzz([250, 120, 250]); say(pick(LINES.restEnd)); persist(); render(); }
    }
    if (S.timed) {
      const t = S.timed, now = Date.now();
      if (t.prep) {
        const c = Math.ceil((t.startsAt - now) / 1000);
        setLive('hold', c > 0 ? String(c) : 'Via');
        if (c !== t.lastC) { t.lastC = c; if (c > 0) beep(660, 80); }
        if (now >= t.startsAt) { t.prep = false; beep(990, 160); buzz(120); }
      } else {
        const left = t.target - (now - t.startsAt) / 1000;
        setLive('hold', clock(Math.ceil(left)));
        const c = Math.ceil(left);
        if (c <= 3 && c > 0 && c !== t.lastC) { t.lastC = c; beep(740, 80); }
        if (left <= 0) { beep(990, 220, 2); buzz([200, 80, 200]); finishHold(false); }
      }
    }
    if (step()?.type === 'run' && S.run.startedAt && !S.run.done && !S.run.pausedAt) {
      const rs = runState(), R = S.run;
      if (rs.i >= R.phases.length) { endRun(); return; }
      const ph = R.phases[rs.i], left = ph.sec - rs.inPhase;
      if (R.lastPhase !== rs.i) {
        R.lastPhase = rs.i; persist();
        const sec = root.querySelector('.coach-run'); if (sec) { sec.classList.toggle('run', ph.kind === 'run'); sec.classList.toggle('walk', ph.kind === 'walk'); }
        setLive('runphase', ph.kind === 'run' ? 'Corri' : 'Cammina'); setLive('runlabel', ph.label);
        const nx = R.phases[rs.i + 1];
        setLive('runnext', nx ? `Poi: ${nx.kind === 'run' ? 'corsa' : 'camminata'} ${clock(nx.sec)}` : 'Ultima fase');
        root.querySelectorAll('.coach-phases li').forEach((li, i) => { li.classList.toggle('past', i < rs.i); li.classList.toggle('now', i === rs.i); });
        beep(ph.kind === 'run' ? 1046 : 523, 200, 2); buzz([300, 100, 300]);
        say(ph.kind === 'run' ? `Corri. ${nfmt(ph.sec / 60)} minuti.` : ph.label.includes('defaticamento') ? 'Cammina. Defaticamento.' : 'Cammina.');
      }
      const c = Math.ceil(left);
      if (c <= 3 && c > 0 && R.lastC !== c) { R.lastC = c; beep(740, 80); }
      setLive('run', clock(left));
      const bar = root.querySelector('[data-live="runbar"]'); if (bar) bar.style.width = (rs.done / rs.total * 100) + '%';
    }
    if (step()?.type === 'walk' && S.walk.startedAt && !S.walk.stoppedAt) setLive('walk', clock((Date.now() - S.walk.startedAt) / 1000));
  }

  window.WorkoutCoach = {mount, start, _prescription: prescription, _segmentForWeek: segmentForWeek};
})();

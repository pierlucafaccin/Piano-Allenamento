/* Copenhagen 21K — Registro allenamenti progressivo (8 settimane).
 * I dati restano nel diario esistente, indicizzato dalla data ISO.
 * Nessuna credenziale GitHub/Garmin è necessaria nel browser.
 */
(() => {
  'use strict';
  const KEYS = ['mon','tue','wed','thu','fri','sat','sun'];
  const WEEKDAYS = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
  const MONTHS = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const ESC = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateAt = (start, days) => { const [y,m,d]=start.split('-').map(Number);const r=new Date(y,m-1,d,12);r.setDate(r.getDate()+days);return [r.getFullYear(),String(r.getMonth()+1).padStart(2,'0'),String(r.getDate()).padStart(2,'0')].join('-'); };
  const human = s => {const [y,m,d]=s.split('-').map(Number);return d+' '+MONTHS[m-1]+' '+y;};
  const dec = value => {if(value===undefined || value===null || value==='')return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;};
  const nfmt = n => Number(n).toLocaleString('it-IT',{maximumFractionDigits:2});
  const max8 = n => Math.max(1,Math.min(8,n));
  const today = () => {const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const states = {done:'Completata',partial:'Annotazioni parziali',skipped:'Non svolta'};
  const kinds = [{id:'per_manubrio',text:'kg per manubrio'},{id:'per_lato',text:'kg per lato'},{id:'macchina',text:'kg macchina'},{id:'totale',text:'kg totali'},{id:'corpo_libero',text:'Corpo libero / nessun kg'}];
  let api=null,root=null,week=2,day='mon',view='tracker',selectedExercise='',dirty=false;
  const data = () => api.getLogs();
  const plan = () => api.getPlan();
  const isoDay = (w,k) => dateAt(plan().startDate,(w-1)*7+KEYS.indexOf(k));
  const entryAt = (w,k) => data()[isoDay(w,k)]||{};
  const exerciseLog = (w,k,id) => entryAt(w,k).exercises?.[id]||{};
  const dayFromISO = date => KEYS[(new Date(date+'T12:00:00').getDay()+6)%7];
  const weekFromISO = date => {const start=new Date(plan().startDate+'T12:00:00');const d=new Date(date+'T12:00:00');return max8(Math.floor((d-start)/86400000/7)+1);};
  function runPrescription(w,k) {
    const p=plan(); const series = k==='fri'?(p.runProgressionFriday||p.runProgression):p.runProgression;
    const r=series?.[w-1];
    if(!r) return 'Da definire';
    const minutes = x => Number.isInteger(x)?`${x} min`:`${Math.floor(x)} min ${Math.round((x%1)*60)} s`;
    return r.continuous ? `${minutes(r.continuous)} corsa continua` : `${r.sets} × (${minutes(r.run)} corsa + ${minutes(r.walk)} camminata)`;
  }
  const units = kind => kinds.find(k=>k.id===kind)?.text || 'kg';
  function parsedSets(rec) {
    if(!Array.isArray(rec?.performedSets))return [];
    return rec.performedSets.filter(row=>row && (dec(row.reps)!==null || dec(row.kg)!==null));
  }
  function formatRecord(rec) {
    if(!rec) return 'Non registrato';
    const sets=parsedSets(rec);
    if(sets.length){
      const details=sets.map(r=>{const x=dec(r.reps),kg=dec(r.kg);return `${x!==null?nfmt(x)+(rec.repUnit==='secondi'?' s':' rip.'): '—'}${kg!==null?' · '+nfmt(kg)+' kg':''}`;}).join(' / ');
      return `${sets.length} serie: ${details} (${units(rec.loadUnit)})`;
    }
    if(rec.sets||rec.load)return [rec.sets,rec.load].filter(Boolean).join(' · ');
    if(rec.note)return rec.note;
    return 'Non registrato';
  }
  function rawNum(record,field) {const vals=parsedSets(record).map(x=>dec(x[field])).filter(x=>x!==null);return vals.length?Math.max(...vals):null;}
  function volume(record) {
    const sets=parsedSets(record);if(!sets.length || sets.some(x=>dec(x.kg)===null||dec(x.reps)===null) || record.repUnit==='secondi')return null;
    return sets.reduce((s,x)=>s+dec(x.kg)*dec(x.reps),0);
  }
  function recordCard(e,w,k) {
    const logged=exerciseLog(w,k,e.id);
    const prev= w>1 ? exerciseLog(w-1,k,e.id) : null;
    const blocked=e.notBeforeWeek&&w<e.notBeforeWeek;
    const existing=parsedSets(logged);
    const count = Math.max(3,Math.min(8,existing.length||Math.min(5,Number(e.sets?.match(/\b(\d+)\s*[×x]/)?.[1]||3))));
    const rows=existing.length?existing:Array.from({length:count},()=>({reps:'',kg:'',rpe:''}));
    const kind=logged.loadUnit||'totale';const repUnit=logged.repUnit||'ripetizioni';
    const rowsHtml=rows.map((r,i)=>seriesRow(i,r)).join('');
    return `<article class="tracker-exercise" data-exercise="${ESC(e.id)}" data-exercise-name="${ESC(e.name)}">
      <div class="tracker-exercise-head"><div><h3>${ESC(e.name)}</h3><p>Prescritto: ${ESC(e.sets)} · recupero: ${ESC(e.rest||'—')}</p></div><span class="tracker-ex-index">${ESC(e.id)}</span></div>
      ${blocked?`<div class="tracker-tip">Programmazione dalla settimana ${e.notBeforeWeek}: non è richiesto registrare serie ora.</div>`:''}
      ${prev&&Object.keys(prev).length?`<div class="tracker-prev"><b>Sett. ${w-1}:</b> ${ESC(formatRecord(prev))}</div>`:''}
      ${logged.sets||logged.load?`<div class="tracker-prev"><b>Dato originale sett. ${w}:</b> ${ESC([logged.sets,logged.load].filter(Boolean).join(' · '))}</div>`:''}
      <div class="tracker-controls"><label>Unità carico<select data-kind="loadUnit">${kinds.map(a=>`<option value="${a.id}" ${kind===a.id?'selected':''}>${ESC(a.text)}</option>`).join('')}</select></label>
       <label>Misura ripetizioni<select data-kind="repUnit"><option value="ripetizioni" ${repUnit==='ripetizioni'?'selected':''}>Ripetizioni</option><option value="secondi" ${repUnit==='secondi'?'selected':''}>Secondi</option></select></label></div>
      <div class="tracker-sets"><div class="tracker-set-head"><span>Serie</span><span>Rip. / sec</span><span>Kg</span><span>RPE</span><span></span></div><div data-series-list>${rowsHtml}</div></div>
      <button type="button" class="tracker-small-btn" data-add-set="${ESC(e.id)}">+ Aggiungi serie</button>
      <label class="tracker-full-label">Note su tecnica, esecuzione, recupero<input data-ex-note type="text" maxlength="1000" value="${ESC(logged.note||'')}" placeholder="Es. ultima serie difficile, nessun fastidio"></label>
     </article>`;
  }
  function seriesRow(i,r) {
    return `<div class="tracker-set-row" data-set-row><span class="tracker-set-index">${i+1}</span>
      <input type="number" inputmode="numeric" min="0" max="1000" step="1" data-series="reps" aria-label="Ripetizioni serie ${i+1}" placeholder="—" value="${ESC(r.reps??'')}">
      <input type="number" inputmode="decimal" min="0" max="2000" step="0.5" data-series="kg" aria-label="Kg serie ${i+1}" placeholder="—" value="${ESC(r.kg??'')}">
      <input type="number" inputmode="decimal" min="0" max="10" step="0.5" data-series="rpe" aria-label="RPE serie ${i+1}" placeholder="—" value="${ESC(r.rpe??'')}">
      <button type="button" data-remove-set aria-label="Rimuovi serie ${i+1}" title="Elimina questa riga">×</button></div>`;
  }
  function progressHistory(exercise) {
    if(!exercise)return '<div class="tracker-empty">Seleziona un esercizio per visualizzare lo storico.</div>';
    const rows=[];
    for(let w=1;w<=8;w++){
      const rec=exerciseLog(w,day,exercise.id),has=Object.keys(rec).length>0;
      const kg=rawNum(rec,'kg'),v=volume(rec);
      rows.push({week:w,has,kg,vol:v,rec});
    }
    const previous=week>1?rows[week-2]:null,current=rows[week-1];
    let comparison='Per un confronto numerico inserisci le serie della settimana corrente e precedente.';
    if(previous&&previous.kg!==null && current.kg!==null && current.rec.loadUnit===previous.rec.loadUnit && current.rec.repUnit===previous.rec.repUnit){
      const diff=+(current.kg-previous.kg).toFixed(2);
      comparison=`Carico massimo registrato: ${diff>0?'+':''}${nfmt(diff)} kg rispetto alla settimana ${week-1}, a parità di unità.`;
      if(previous.vol!==null&&current.vol!==null){comparison+=` Volume (ripetizioni × kg registrati): ${nfmt(current.vol)} vs ${nfmt(previous.vol)}.`;}
    } else if(previous?.has && current?.has)comparison='Entrambe le settimane hanno note; per un confronto numerico servono serie strutturate e unità di carico uguali.';
    const known=rows.filter(x=>x.kg!==null);
    const peak=Math.max(1,...known.map(x=>x.kg));
    const chart=known.length>=2?`<div class="tracker-load-chart" role="img" aria-label="Andamento del carico massimo registrato, per settimana, in chilogrammi">${rows.map(x=>`<div class="tracker-load-bar"><span class="${x.week===week?'current':''}" style="height:${x.kg===null?'2':Math.max(5,Math.round(x.kg/peak*100))}%" title="W${x.week}: ${x.kg===null?'nessun dato':nfmt(x.kg)+' kg'}"></span><small>W${x.week}</small></div>`).join('')}</div>`:'';
    return `<div class="tracker-compare-head"><h3>${ESC(exercise.name)}</h3><p>${ESC(comparison)}</p></div>${chart}<div class="tracker-history-table-wrap"><table class="tracker-history"><thead><tr><th>Sett.</th><th>Risultato registrato</th><th>Max kg</th></tr></thead><tbody>${rows.map(x=>`<tr class="${x.week===week?'is-current':''}"><td>W${x.week}</td><td>${x.has?ESC(formatRecord(x.rec)):'—'}</td><td>${x.kg!==null?nfmt(x.kg):'—'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function weekButtons() {
    const current=weekFromISO(today());
    return `<div class="tracker-week-grid">${Array.from({length:8},(_,i)=>{const w=i+1;const dates=KEYS.map(k=>isoDay(w,k));const entries=dates.filter(x=>!!data()[x] && data()[x].status!=='skipped').length;return `<button type="button" class="tracker-week ${week===w?'selected':''}" data-tracker-week="${w}" aria-pressed="${week===w?'true':'false'}"><b>W${w}</b><span>${human(dates[0]).replace(' 2026','').replace(' 2027','')}</span>${w===current?'<small>Attuale</small>':entries?`<small>${entries} note</small>`:'<small>—</small>'}</button>`;}).join('')}</div>`;
  }
  function dayButtons() {
    return `<div class="tracker-days">${KEYS.map((k,i)=>{const d=isoDay(week,k),z=entryAt(week,k);return `<button type="button" class="tracker-day ${day===k?'selected':''}" data-tracker-day="${k}" aria-pressed="${day===k?'true':'false'}"><b>${WEEKDAYS[i]}</b><span>${d.slice(-2)}</span>${z.status?'<i class="tracker-status-dot '+ESC(z.status)+'"></i>':''}</button>`;}).join('')}</div>`;
  }
  function dropdownForExercise(exercises){
    if(!exercises.length)return '';
    if(!selectedExercise||!exercises.some(e=>e.id===selectedExercise))selectedExercise=exercises[0].id;
    const selected=exercises.find(x=>x.id===selectedExercise);
    return `<div class="tracker-compare-top"><label for="tracker-compare-exercise">Esercizio da confrontare</label><select id="tracker-compare-exercise">${exercises.map(e=>`<option value="${ESC(e.id)}" ${e.id===selectedExercise?'selected':''}>${ESC(e.name)}</option>`).join('')}</select></div>${progressHistory(selected)}`;
  }
  function render() {
    if(!root||!api)return;
    const d=plan().schedule?.[day]||{title:'Seduta',exercises:[],short:'',confirmed:false};
    const date=isoDay(week,day),log=data()[date]||{},exercises=d.exercises||[];
    const isRun=(day==='tue'||day==='fri');const isRest=(day==='sat'||day==='sun');
    const form= `<div class="tracker-head"><div><div class="eyebrow">DIARIO · 8 SETTIMANE</div><h2>Registra, confronta, migliora</h2><p>Ogni settimana ha i propri carichi. Le note del trainer restano separate dalle tue prestazioni.</p></div><span class="tracker-now">W${week} / 8</span></div>
      <div class="tracker-storage-note"><b>Salvataggio:</b> su GitHub Pages il diario resta in questo browser. Per recuperarlo su un altro dispositivo usa <b>Esporta</b> e <b>Importa</b>; non viene ancora sincronizzato automaticamente online.</div>
      ${weekButtons()} ${dayButtons()}
      <div class="tracker-editor-head"><div><span class="eyebrow">${ESC(human(date))} · SETTIMANA ${week}</span><h3>${ESC(d.title)}</h3><p>${ESC(d.short||'')}</p></div><span class="tracker-entry-status">${ESC(states[log.status]||'Non registrato')}</span></div>
      <div class="tracker-columns"><section class="tracker-main"><form id="tracker-form">
        <div class="tracker-form-params"><label>Stato seduta<select id="tracker-status"><option value="partial" ${log.status!=='done'&&log.status!=='skipped'?'selected':''}>In corso / parziale</option><option value="done" ${log.status==='done'?'selected':''}>Completata</option><option value="skipped" ${log.status==='skipped'?'selected':''}>Non svolta</option></select></label>
        <label>Durata totale (min)<input id="tracker-minutes" type="number" inputmode="decimal" step="0.5" min="0" max="600" value="${ESC(log.minutes??'')}" placeholder="Es. 65"></label>
        <label>RPE seduta (0–10)<input id="tracker-rpe" type="number" inputmode="decimal" step="0.5" min="0" max="10" value="${ESC(log.rpe??'')}" placeholder="Es. 7"></label>
        <label>Fastidio caviglia (0–10)<input id="tracker-pain" type="number" inputmode="numeric" step="1" min="0" max="10" value="${ESC(log.painAfter??'')}" placeholder="0"></label></div>
        ${exercises.length?`<div class="tracker-list-head"><h3>Esercizi della giornata</h3><span>${exercises.length} esercizi prescritti</span></div>${exercises.map(e=>recordCard(e,week,day)).join('')}`:`<div class="tracker-tip">${isRest?'Giornata di recupero: registra camminata, mobilità e note.':'Scheda non ancora dettagliata: puoi comunque registrare la seduta e la corsa.'}</div>`}
        ${isRun?`<section class="tracker-run"><h3>Corsa sul tapis</h3><p><b>Prescritto W${week}:</b> ${ESC(runPrescription(week,day))}. Camminata iniziale e finale: 5 minuti ciascuna.</p>
           <div class="tracker-form-params"><label>Stato corsa<select id="tracker-run-status"><option value="" ${!log.run?.status?'selected':''}>Non registrato</option><option value="done" ${log.run?.status==='done'?'selected':''}>Svolta</option><option value="partial" ${log.run?.status==='partial'?'selected':''}>Parziale</option><option value="skipped" ${log.run?.status==='skipped'?'selected':''}>Non svolta</option></select></label>
           <label>Distanza (km)<input id="tracker-run-km" type="number" step="0.01" min="0" max="100" inputmode="decimal" value="${ESC(log.run?.distanceKm??'')}" placeholder="Es. 3,25"></label>
           <label>Minuti di corsa<input id="tracker-run-min" type="number" step="0.5" min="0" max="300" inputmode="decimal" value="${ESC(log.run?.runMinutes??'')}"></label>
           <label>Minuti di camminata<input id="tracker-run-walk" type="number" step="0.5" min="0" max="300" inputmode="decimal" value="${ESC(log.run?.walkMinutes??'')}"></label>
           <label>FC media (bpm)<input id="tracker-run-hr" type="number" step="1" min="0" max="250" inputmode="numeric" value="${ESC(log.run?.avgHr??'')}"></label>
           <label>Passo medio (mm:ss/km)<input id="tracker-run-pace" type="text" maxlength="12" value="${ESC(log.run?.pace??'')}" placeholder="Es. 6:10"></label></div>
           <label class="tracker-full-label">Come è andata la corsa?<input id="tracker-run-notes" type="text" maxlength="1000" value="${ESC(log.run?.notes??'')}" placeholder="Respiro, caviglia, facilità del tapis..."></label></section>`:''}
        ${isRest?`<div class="tracker-run"><h3>Riposo attivo</h3><div class="tracker-form-params"><label>Camminata (km)<input id="tracker-walk-km" type="number" step="0.1" min="0" max="100" value="${ESC(log.walkKm??'')}" placeholder="Es. 6"></label><label class="tracker-check"><input type="checkbox" id="tracker-mobility" ${log.mobilityDone?'checked':''}> Mobilità / stretching svolti</label></div></div>`:''}
        <label class="tracker-full-label">Note generali della seduta<textarea id="tracker-notes" rows="3" maxlength="10000" placeholder="Ripetizioni, sensazioni, esercizi svolti, dolore, osservazioni...">${ESC(log.notes||'')}</textarea></label>
        <div class="tracker-save-actions"><button type="submit" class="btn btn-mint">Salva W${week} · ${WEEKDAYS[KEYS.indexOf(day)]}</button><span id="tracker-save-message" role="status" aria-live="polite"></span></div>
      </form></section><aside class="tracker-comparison"><div class="tracker-compare-card"><div class="eyebrow">CONFRONTO SETTIMANALE</div>${dropdownForExercise(exercises)}</div>
      <div class="tracker-compare-card"><h3>Riepilogo progressi</h3>${weekSummary(day)}<div class="tracker-export-buttons"><button type="button" class="btn btn-outline btn-sm" id="tracker-export">Esporta diario JSON</button><label class="btn btn-outline btn-sm tracker-import-label">Importa JSON<input type="file" id="tracker-import" accept=".json,application/json" hidden></label></div><p class="tracker-small-print">L'importazione chiede conferma prima di sostituire annotazioni con la stessa data.</p></div></aside></div>`;
    root.innerHTML=form;
    root.querySelector('#tracker-form').addEventListener('submit',saveFromForm);
    root.querySelector('#tracker-import').addEventListener('change',importJson);
    dirty=false;
  }
  function weekSummary(key) {
    const entries=[];for(let w=1;w<=8;w++){const log=entryAt(w,key);if(!Object.keys(log).length)continue;
      const exercises=Object.values(log.exercises||{}).filter(x=>x&&Object.keys(x).length).length;
      entries.push(`<div class="tracker-week-summary"><b>W${w}</b><span>${ESC(states[log.status]||'Annotata')}</span><small>${exercises} esercizi con note${log.run?.status?' · Corsa '+ESC(states[log.run.status]||log.run.status).toLowerCase():''}</small></div>`);
    }return entries.length?entries.join(''):'<p class="tracker-small-print">Ancora nessuna seduta registrata per questo giorno.</p>';
  }
  function gatherForm() {
    const date=isoDay(week,day);
    const old=data()[date]||{};
    const entry={...old, status:root.querySelector('#tracker-status').value, minutes:root.querySelector('#tracker-minutes').value, rpe:root.querySelector('#tracker-rpe').value, painAfter:root.querySelector('#tracker-pain').value,notes:root.querySelector('#tracker-notes').value,exercises:{...(old.exercises||{})}};
    root.querySelectorAll('[data-exercise]').forEach(card=>{
      const id=card.dataset.exercise;const prev={...(entry.exercises[id]||{})};
      const performedSets=[...card.querySelectorAll('[data-set-row]')].map(row=>Object.fromEntries(['reps','kg','rpe'].map(k=>[k,row.querySelector(`[data-series="${k}"]`).value.trim()])))
        .filter(item=>item.reps!==''||item.kg!==''||item.rpe!=='');
      const note=card.querySelector('[data-ex-note]').value.trim();
      if(performedSets.length||note||Object.keys(prev).length){
        const result={...prev,note,performedSets,loadUnit:card.querySelector('[data-kind="loadUnit"]').value,repUnit:card.querySelector('[data-kind="repUnit"]').value};
        if(performedSets.length)entry.exercises[id]=result;
        else if(prev.sets||prev.load||note) {delete result.performedSets;entry.exercises[id]=result;}
        else delete entry.exercises[id];
      }
    });
    if(day==='tue'||day==='fri'){
      const run={...(old.run||{}),status:root.querySelector('#tracker-run-status').value,distanceKm:root.querySelector('#tracker-run-km').value,runMinutes:root.querySelector('#tracker-run-min').value,walkMinutes:root.querySelector('#tracker-run-walk').value,avgHr:root.querySelector('#tracker-run-hr').value,pace:root.querySelector('#tracker-run-pace').value.trim(),notes:root.querySelector('#tracker-run-notes').value.trim()};
      if(Object.values(run).some(Boolean))entry.run=run;
      else delete entry.run;
    }
    if(day==='sat'||day==='sun') {entry.walkKm=root.querySelector('#tracker-walk-km').value;entry.mobilityDone=root.querySelector('#tracker-mobility').checked;}
    return {date,entry};
  }
  async function saveFromForm(event) {
    event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;
    const {date,entry}=gatherForm();
    try{await api.save(date,entry);dirty=false;render();const msg=root.querySelector('#tracker-save-message');if(msg)msg.textContent='Salvato correttamente nel diario.';}
    catch(e){button.disabled=false;const msg=root.querySelector('#tracker-save-message');if(msg)msg.textContent='Errore: '+e.message;}
  }
  function exportJson() {
    const payload=JSON.stringify(data(),null,2);const blob=new Blob([payload],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='piano-allenamento-diario-'+today()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  async function importJson(e) {
    const f=e.target.files?.[0];if(!f)return;
    try {
      if(f.size>2_000_000)throw Error('File troppo grande (limite 2 MB).');
      const json=JSON.parse(await f.text());const content=json.logs&&typeof json.logs==='object'?json.logs:json;
      if(!content||Array.isArray(content)||typeof content!=='object')throw Error('Formato diario non valido.');
      const entries=Object.fromEntries(Object.entries(content).filter(([date,log])=>/^20\d\d-\d\d-\d\d$/.test(date)&&log&&!Array.isArray(log)&&typeof log==='object'&&['done','partial','skipped'].includes(log.status)));
      if(!Object.keys(entries).length)throw Error('Nessuna registrazione di allenamento valida trovata.');
      if(!window.confirm(`Importare ${Object.keys(entries).length} giornate? Le date già presenti nel diario verranno sostituite.`))return;
      await api.importEntries(entries);dirty=false;render();window.alert('Diario importato. Le annotazioni sono ora disponibili su questo dispositivo.');
    } catch(err){window.alert('Importazione non riuscita: '+err.message);} finally{e.target.value='';}
  }
  function canDiscard(){return !dirty||window.confirm('Ci sono modifiche non salvate nella seduta. Vuoi scartarle?');}
  function click(event){
    const target=event.target;
    const weekBtn=target.closest('[data-tracker-week]');if(weekBtn){if(!canDiscard())return;week=Number(weekBtn.dataset.trackerWeek);render();return;}
    const dayBtn=target.closest('[data-tracker-day]');if(dayBtn){if(!canDiscard())return;day=dayBtn.dataset.trackerDay;selectedExercise='';render();return;}
    const addBtn=target.closest('[data-add-set]');if(addBtn){const card=addBtn.closest('[data-exercise]'),list=card.querySelector('[data-series-list]');const i=list.querySelectorAll('[data-set-row]').length;if(i>=12)return;list.insertAdjacentHTML('beforeend',seriesRow(i,{}));dirty=true;return;}
    const delBtn=target.closest('[data-remove-set]');if(delBtn){const list=delBtn.closest('[data-series-list]');if(list.querySelectorAll('[data-set-row]').length<=1){list.querySelectorAll('input').forEach(x=>x.value='');}else{delBtn.closest('[data-set-row]').remove();list.querySelectorAll('[data-set-row]').forEach((row,i)=>{row.querySelector('.tracker-set-index').textContent=i+1;});}dirty=true;return;}
    if(target.id==='tracker-export'){exportJson();return;}
  }
  function change(event){
    if(event.target.id==='tracker-compare-exercise'){selectedExercise=event.target.value;const parent=root.querySelector('.tracker-compare-card');if(parent){const exercise=(plan().schedule[day]?.exercises||[]).find(x=>x.id===selectedExercise);parent.querySelector('.tracker-compare-head')?.remove();parent.querySelector('.tracker-history-table-wrap')?.remove();parent.insertAdjacentHTML('beforeend',progressHistory(exercise));}return;}
  }
  function mount(params){api=params;root=document.getElementById('tracker-root');if(!root)return;
    const d=today();week=weekFromISO(d);day=dayFromISO(d);
    root.addEventListener('click',click);root.addEventListener('change',change);
    root.addEventListener('input',()=>dirty=true);
    document.querySelectorAll('[data-training-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.trainingView)));
    setView('tracker');render();
  }
  function setView(next){if(next==='trainer'&&!canDiscard())return;view=next;const tracker=document.getElementById('tracker-root'),trainer=document.getElementById('trainer-plan');if(!tracker||!trainer)return;tracker.hidden=next!=='tracker';trainer.hidden=next==='tracker';document.querySelectorAll('[data-training-view]').forEach(b=>{const active=b.dataset.trainingView===next;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
  function selectDate(date){if(!canDiscard())return;week=weekFromISO(date);day=dayFromISO(date);selectedExercise='';setView('tracker');render();}
  window.TrainingTracker={mount,render,selectDate,formatRecord};
})();

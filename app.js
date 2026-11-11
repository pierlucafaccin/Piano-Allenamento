(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DOW = ['LUN','MAR','MER','GIO','VEN','SAB','DOM'];
  const KEYS = ['mon','tue','wed','thu','fri','sat','sun'];
  const MONTHS = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const longMonths = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12); };
  const iso = d => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const offset = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
  const today = new Date();
  const TODAY = iso(today);
  const countDays = (start,end) => Math.round((parse(end)-parse(start))/86400000);
  const datelabel = (s,year=true) => { const d=parse(s); return d.getDate()+' '+MONTHS[d.getMonth()]+(year?' '+d.getFullYear():''); };
  const niceDate = (s) => { const d=parse(s); return d.getDate()+' '+longMonths[d.getMonth()]+' '+d.getFullYear(); };
  let P=null, LOGS={}, G={}, SYNC={}, live=true, week=0, strengthTab='mon', refreshTicker=null;
  const LOCAL_KEY='piano-allenamento-copenhagen-2027-local-log';
  const dashboardUrl=()=>live?'/garmin/dashboard':'./garmin/dashboard.html';
  function localSaved(){try{return JSON.parse(localStorage.getItem(LOCAL_KEY)||'{}')||{};}catch(_){return {};}}
  function storeLocal(){localStorage.setItem(LOCAL_KEY,JSON.stringify(LOGS));}

  function flash(message, error=false) {
    const n=$('flash'); n.textContent=message; n.hidden=false; n.classList.toggle('error',error);
    clearTimeout(flash.timer);flash.timer=setTimeout(()=>{n.hidden=true;},7000);
  }
  function weekNumber(date) { return Math.floor(countDays(P.startDate,date)/7)+1; }
  function phaseWeek() { return weekNumber(TODAY); }
  function trainingWeek(i) { return i>=0 && i<P.confirmedWeeks; }
  function runOfWeek(i) { return P.runProgression[i] || null; }
  function runText(i) {
    const s=runOfWeek(i);
    if(!s) return 'Programma da concordare';
    if(s.continuous) return s.continuous+' minuti di corsa continua';
    return s.sets+' × ('+s.run+' min corsa + '+s.walk+' min camminata)';
  }
  function runMinutes(i) { const s=runOfWeek(i);return s ? (s.continuous || s.sets*s.run) : null; }
  function runTotal(i) { const s=runOfWeek(i);return s ? 10 + (s.continuous || s.sets*(s.run+s.walk)) : null; }
  function dayDate(i,k) {return iso(offset(parse(P.startDate),i*7+KEYS.indexOf(k)));}
  function getDay(k,i) {
    let d=P.schedule[k];
    if(!trainingWeek(i)) {
      return k==='sat'||k==='sun'
       ? {...d,title:'Weekend · Da concordare',short:'Riposo e recupero da confermare',confirmed:false}
       : {title:DOW[KEYS.indexOf(k)]+' · Nuova scheda in attesa',kind:'pending',short:'Da definire con il trainer dopo il blocco di 8 settimane',confirmed:false,warmup:[],exercises:[],rehab:[],cooldown:[]};
    }
    return d;
  }
  function dayCard(k,i) {return {key:k, date:dayDate(i,k),data:getDay(k,i),index:i,run:(k==='tue'||k==='fri') && trainingWeek(i)};}
  function statusOf(date) {return LOGS[date]?.status||'none';}
  function stateLabel(date) {let t=statusOf(date);return t==='done'?'COMPLETATO':t==='partial'?'ANNOTAZIONI':t==='skipped'?'SALTATO':'DA REGISTRARE';}
  function statusTag(date) {let t=statusOf(date);return t==='done'?'<span class="tag tag-mint">COMPLETATO</span>':t==='partial'?'<span class="tag tag-amber">ANNOTATO</span>':t==='skipped'?'<span class="tag tag-red">SALTATO</span>':'<span class="tag">NON REGISTRATO</span>';}
  function isAfterRace() {return countDays(TODAY,P.race.date)<0;}
  const btn = (txt,fnId,klass='btn btn-outline btn-sm')=>`<button class="${klass}" type="button" ${fnId}>${txt}</button>`;
  function navigate(page) {
    if(!$('page-'+page))return;
    document.querySelectorAll('.page').forEach(x=>x.classList.toggle('on',x.id==='page-'+page));
    document.querySelectorAll('.navitem').forEach(x=>x.classList.toggle('active',x.dataset.page===page));
    if(page==='garmin') renderGarmin();
    if(page==='week')renderWeek();
    if(page==='strength')renderStrength();
    if(page==='roadmap')renderRoadmap();
    window.scrollTo({top:0,behavior:'instant'});
    location.hash=page;
  }
  function statsMetric(label,value,foot,color='') {
    return `<article class="metric"><div class="label">${esc(label)}</div><div class="num ${color}">${esc(value)}</div><div class="foot">${esc(foot)}</div></article>`;
  }
  function renderOverview() {
    const days=Math.max(0,countDays(TODAY,P.race.date));$('days-left').textContent=String(days);
    const wi=phaseWeek(), idx=wi-1;
    const complete=Object.entries(LOGS).filter(([k,v])=>weekNumber(k)===wi&&v.status==='done').length;
    const runKm=G?.weekly?.runKm||0;
    const gRecent=G?.recent||[];
    $('stat-cards').innerHTML=[
      statsMetric('Settimana del blocco',wi<=0?'Non iniziato':wi<=8?`${wi} / 8`:'Blocco concluso',wi>8?'Nuova scheda da definire':'Rientro alla corsa', 'mint'),
      statsMetric('Corsa · questa settimana',G.available?`${runKm.toLocaleString('it-IT')} km`:'—',G.available?`${G.weekly.runs} attività di corsa Garmin`:'Collega Garmin per rilevare i km','blue'),
      statsMetric('Sedute confermate',String(complete),`Settimana ${wi>0?wi:'—'} · solo registro manuale`,'amber'),
      statsMetric('Ultima attività Garmin',gRecent.length?datelabel(gRecent[0].date,false):'—',gRecent.length?gRecent[0].name:'Storico Garmin non importato')
    ].join('');
    const inPlan=idx>=0 && idx<P.confirmedWeeks;
    const key=KEYS[(today.getDay()+6)%7];
    const d=getDay(key,idx);const date=TODAY;
    $('today-badge').textContent=inPlan?'SETT. '+wi:'IN DEFINIZIONE';
    let info=inPlan?d.short:'Da aggiornare con la nuova scheda del trainer';
    const eCount=d.exercises?.filter(e=>!(e.notBeforeWeek && wi<e.notBeforeWeek)).length||0;
    const r=(key==='tue'||key==='fri')&&inPlan;
    $('today-session').innerHTML=`<h3 class="today-title">${esc(d.title)}</h3><p class="today-sub">${esc(info)}</p>
    <div class="today-points">${eCount?`<span><b>${eCount}</b> esercizi principali</span>`:''}
    ${r?`<span><b>${esc(runText(idx))}</b></span>`:''}
    ${d.kind==='rest'?'<span>Un giorno riposo completo, uno attivo</span>':''}
    ${!d.confirmed?'<span>Dettagli da confermare</span>':''}</div>
    <div class="btn-row"><button type="button" class="btn btn-mint" data-open="${esc(date)}">Apri e registra la seduta</button>${statusTag(date)}</div>`;
    const step=idx>=0&&idx<8?idx:-1;
    $('run-progress-label').textContent=step>=0?`SETT. ${step+1} / 8`:'PIANO 8 SETTIMANE';
    $('run-progress').innerHTML=`<div class="run-line"><div><strong>${step>=0?esc(runText(step)):'Progressione completata / in attesa'}</strong>
      <small>Martedì e venerdì · 5' cammino iniziali e finali</small></div></div>
      <div class="run-steps">${Array.from({length:8},(_,j)=>`<span title="Settimana ${j+1}" class="${step>j?'completed':step===j?'current':''}"></span>`).join('')}</div>
      <div class="run-line"><div class="subtle small">Minuti effettivi di corsa per seduta</div><strong>${step>=0?runMinutes(step)+' min':'—'}</strong></div>
      <div class="progress-line"><span style="width:${step>=0?((step+1)/8)*100:0}%"></span></div>
      <p class="muted-p" style="margin-bottom:0">Il tapis è parte della riabilitazione, non un allenamento di qualità a ritmo gara. La progressione segue la prescrizione originale.</p>`;
    const currentIdx=Math.max(0,Math.min(idx,P.confirmedWeeks-1));
    $('overview-week').innerHTML=KEYS.map(k=>{
      const x=dayCard(k,currentIdx),d=x.data,z=x.date;
      return `<button type="button" class="mini-day ${z===TODAY?'today':''}" data-open="${z}">
        <div class="miniday-top"><span>${DOW[KEYS.indexOf(k)]}</span><b>${parse(z).getDate()}</b></div>
        <div class="miniday-title"><span class="dot ${esc(d.kind)}" style="display:inline-block;margin-right:6px"></span>${esc(d.title.replace(' · ',' · '))}</div>
        <div class="miniday-sub">${statusOf(z)==='done'?'Completato':statusOf(z)==='partial'?'Con annotazioni':d.confirmed?'Previsto':'Da integrare'}</div></button>`;
    }).join('');
  }
  function renderWeek() {
    const wi=week+1, w0=dayDate(week,'mon'),w6=dayDate(week,'sun');
    $('week-label').textContent=trainingWeek(week)?`Settimana ${wi} / 8 · Recupero`:`Settimana ${wi} · Da pianificare`;
    $('week-range').textContent=`${datelabel(w0)} — ${datelabel(w6)}`;
    $('week-prev').disabled=week<=0;
    $('week-next').disabled=countDays(w0,P.race.date)<0;
    $('week-note').innerHTML=trainingWeek(week)
     ? `<strong>Settimana ${wi}.</strong> ${esc(runText(week))} sul tapis martedì e venerdì. Gli altri giorni seguono solo le schede disponibili.`
     : '<strong>Programma futuro non ancora definito.</strong> Non vengono riproposti automaticamente i carichi del primo blocco, né prescritte corse aggiuntive.';
    $('week-days').innerHTML=KEYS.map(k=>{
      const x=dayCard(k,week),d=x.data,z=x.date;
      const status=statusOf(z);
      return `<button type="button" class="week-day" data-open="${z}">
         <div class="wd-date"><small>${DOW[KEYS.indexOf(k)]}</small><strong>${parse(z).getDate()}</strong></div>
         <span class="wd-stripe ${esc(d.kind)}"></span><div class="wd-info"><b>${esc(d.title)}</b><small>${esc(x.run?runText(week):d.short)}</small></div>
         <span class="wd-mark ${esc(status)}">${status==='done'?'✓ FATTO':status==='partial'?'● ANNOTATO':status==='skipped'?'NON SVOLTO':d.confirmed?'VEDI SCHEDA':'DA INTEGRARE'}</span>
        </button>`;
    }).join('');
  }
  function trainingItem(e,date,w) {
    const logged=LOGS[date]?.exercises?.[e.id];
    const blocked=e.notBeforeWeek && w<e.notBeforeWeek;
    return `<tr><td>${esc(e.name)}${blocked?'<br><span class="badge-inline">DALLA SETTIMANA '+e.notBeforeWeek+'</span>':''}<small>${esc(e.notes)}</small>
      ${logged?`<div class="actual">ANNOTATO: ${esc(logged.sets||'')} ${logged.load?`· ${esc(logged.load)}`:''}</div>`:''}</td>
      <td>${esc(e.sets)}</td><td>${esc(e.rest||'—')}</td></tr>`;
  }
  function listPanel(title,arr) {return arr?.length?`<article class="panel"><h3>${esc(title)}</h3><ul class="check-list">${arr.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article>`:'';}
  function renderStrength() {
    $('strength-tabs').innerHTML=KEYS.slice(0,5).map(k=>`<button type="button" class="${k===strengthTab?'active':''}" data-strength="${k}">${esc(DOW[KEYS.indexOf(k)])}<small>${P.schedule[k].confirmed?'Scheda presente':k==='fri'?'Solo tapis':'In attesa'}</small></button>`).join('');
    const wIndex=Math.max(0,Math.min(phaseWeek()-1,P.confirmedWeeks-1));
    const d=P.schedule[strengthTab],date=dayDate(wIndex,strengthTab);
    let head=`<div class="detail-head"><div><div class="eyebrow">${d.confirmed?'SCHEDA DEL TRAINER':'IN ATTESA DELLA SCHEDA'}</div><h2 class="detail-title">${esc(d.title)}</h2><span class="subtle">${esc(d.short)}</span></div>
      <button class="btn btn-mint" type="button" data-open="${date}">Registra l'allenamento</button></div>`;
    if(!d.confirmed){
      head+=`<div class="panel blank-state"><div class="blank-icon">＋</div><strong>${strengthTab==='fri'?'Tapis confermato, altri esercizi in arrivo':'Scheda da aggiungere'}</strong>
        <p>Questo spazio è predisposto per la fotografia del ${esc(DOW[KEYS.indexOf(strengthTab)])}. Non sono stati inventati esercizi né carichi.</p>
        ${strengthTab==='fri'?`<div class="notice">Corsa: ${esc(runText(wIndex))}, con 5 minuti di cammino all'inizio e alla fine.</div>`:''}</div>`;
    }else{
      const exercises=d.exercises||[];
      head+=`<div class="detail-layout"><article class="panel"><h3>Esercizi principali</h3><div class="run-table"><table class="exercise-table"><thead><tr><th>Esercizio e note</th><th>Serie / ripetizioni</th><th>Recupero</th></tr></thead><tbody>${exercises.map(e=>trainingItem(e,date,wIndex+1)).join('')}</tbody></table></div></article>
       <div class="stack">${listPanel('Riscaldamento',d.warmup)}${listPanel('Rehab / propriocezione',d.rehab)}
       ${strengthTab==='tue'?`<article class="panel"><h3>Corsa sul tapis</h3><p class="muted-p">${esc(runText(wIndex))} · Totale seduta ${runTotal(wIndex)} min, con 5 min di camminata iniziale e finale.</p></article>`:''}
       ${listPanel('Defaticamento e stretching',d.cooldown)}</div></div>`;
    }
    $('strength-detail').innerHTML=head;
  }
  function metricVal(k,unit='') { const m=G?.metrics?.[k];return m?`${m.value}${unit}`:'—'; }
  function lastMetricDate(k) {const m=G?.metrics?.[k];return m?`Ultimo dato: ${datelabel(m.date)}`:'Dato non presente';}
  function syncText() {
    if(!live) return G.lastPull ? `Dati Garmin pubblicati online. Ultima acquisizione: ${G.lastPull.replace('T',' ')}. Aggiornamento programmato su GitHub Actions; puoi ricaricare gli ultimi dati dal pulsante.` : 'Dati Garmin pubblicati in modo statico; attiva il workflow GitHub Actions per gli aggiornamenti automatici.';
    if(SYNC.status==='running')return 'Aggiornamento Garmin in corso. Il download avviene localmente: puoi continuare a usare il diario.';
    if(SYNC.status==='error')return `Ultimo tentativo non riuscito: ${SYNC.error||'controlla local/sync-output.log'}.`;
    if(!G.keyConfigured)return 'Non è ancora stata importata la configurazione Garmin. Esegui import-existing.bat usando la cartella del progetto originale.';
    if(G.lastPull)return `Ultimo download Garmin: ${G.lastPull.replace('T',' ')}. Aggiornamento automatico impostabile ogni giorno alle 06:30 e all'accesso a Windows.`;
    return 'Configurazione importata. Aggiorna i dati ora oppure attiva l’attività pianificata di Windows.';
  }
  function renderGarmin() {
    $('garmin-sync-notice').textContent=syncText();
    $('garmin-stats').innerHTML=[
      statsMetric('Attività Garmin',G.totalActivities??0,live?'Nello storico locale':'Nello storico pubblicato','mint'),
      statsMetric('Corsa settimanale',G?.weekly?Math.max(0, Number(G.weekly.runKm||0)).toLocaleString('it-IT')+' km':'—',G.weekly?`${G.weekly.runs} attività registrate`:'Nessun dato','blue'),
      statsMetric('FC a riposo',metricVal('rhr',' bpm'),lastMetricDate('rhr')),
      statsMetric('HRV notturna',metricVal('hrv',' ms'),lastMetricDate('hrv'),'amber')
    ].join('');
    $('garmin-sync').disabled=SYNC.status==='running';
    $('top-sync').disabled=SYNC.status==='running';
    $('full-garmin').hidden=!G.dashboardBuilt;
    $('full-garmin').href=dashboardUrl();
    const frame=$('garmin-frame');
    if(G.dashboardBuilt){
      if(!frame.dataset.loaded){frame.src=dashboardUrl();frame.dataset.loaded='yes';}
    }else if(!frame.dataset.placeholder){
      frame.srcdoc='<!doctype html><html lang="it"><meta charset="utf-8"><style>body{margin:0;background:#101920;color:#e8f2f4;font:16px system-ui;display:flex;min-height:60vh;align-items:center;justify-content:center;padding:30px;text-align:center}p{color:#9aafc2;line-height:1.6;max-width:450px}</style><div><h2>Garmin non ancora collegato</h2><p>Importa i dati dal progetto originale con import-existing.bat; poi la dashboard analitica si aprirà qui.</p></div></html>';
      frame.dataset.placeholder='yes';
    }
  }
  function renderRoadmap() {
    const wi=phaseWeek(),progress=Math.max(0,Math.min(1,(wi-1)/8));
    $('current-phase').textContent=wi<=8?'Riabilitazione e ritorno alla corsa':'Programma successivo da definire';
    $('phase-progress').style.width=(progress*100)+'%';
    $('phase-caption').textContent=wi<=8?`Settimana ${Math.max(1,wi)} di 8 · progressione prescritta`:'Dopo il blocco iniziale · attendere aggiornamento del trainer';
    $('phases-list').innerHTML=P.phases.map((p,i)=>`<div class="phase-item ${TODAY>=p.start&&TODAY<=p.end?'active':''}"><div class="phase-index">${i+1}</div>
      <div><h3>${esc(p.name)} <span class="tag ${p.confirmed?'tag-mint':'tag-amber'}">${p.confirmed?'CONFERMATA':'DA DEFINIRE'}</span></h3><p>${esc(p.desc)}</p></div>
      <div class="phase-dates">${datelabel(p.start,false)} — ${datelabel(p.end)}</div></div>`).join('');
    $('run-table').innerHTML=`<div class="run-table"><table><thead><tr><th>Settimana</th><th>Sessione (mar + ven)</th><th>Corsa effettiva</th><th>Durata complessiva</th></tr></thead><tbody>${P.runProgression.map((r,i)=>`<tr class="${wi===i+1?'current':''}"><td><strong>${i+1}</strong></td><td>${esc(runText(i))}</td><td>${runMinutes(i)} min</td><td>${runTotal(i)} min</td></tr>`).join('')}</tbody></table></div><p class="subtle small">Durata totale comprensiva di 5' di camminata di riscaldamento + 5' di defaticamento. Nelle prime cinque settimane include anche le pause camminate tra le ripetizioni.</p>`;
  }
  function openDrawer(date) {
    const idx=weekNumber(date)-1, dow=(parse(date).getDay()+6)%7;
    const k=KEYS[dow],d=getDay(k,idx),e=(d.exercises||[]);
    $('drawer-date').textContent=DOW[dow]+' · '+niceDate(date);
    $('drawer-heading').textContent=d.title;
    const log=LOGS[date]||{status:'partial',notes:'',exercises:{}};
    $('drawer-content').innerHTML=`
      <div class="drawer-quick"><strong>Piano:</strong> ${esc(d.short)}<br>${!d.confirmed?'Dettaglio della scheda non ancora ricevuto. Puoi comunque lasciare una nota.':''}
      ${(k==='tue'||k==='fri')&&trainingWeek(idx)?`<br><strong>Tapis:</strong> ${esc(runText(idx))} · ${runTotal(idx)} minuti totali (previsti, non automaticamente svolti).`:''}</div>
      <form id="log-form" data-date="${date}">
        <div class="field"><label for="session-status">Stato della sessione</label><select id="session-status" name="status">
          <option value="partial" ${log.status==='partial'?'selected':''}>Annotazioni parziali / da completare</option>
          <option value="done" ${log.status==='done'?'selected':''}>Completata realmente</option>
          <option value="skipped" ${log.status==='skipped'?'selected':''}>Non svolta</option>
        </select></div>
        <div class="stage-label">Carichi e ripetizioni effettivi</div>
        ${e.map(item=>{
          const a=log.exercises?.[item.id]||{};
          return `<article class="drawer-exercise" data-exercise="${esc(item.id)}"><h3>${esc(item.name)}</h3><div class="subtle">Prescritto: ${esc(item.sets)} · recupero: ${esc(item.rest||'—')}</div>
            ${item.notBeforeWeek&&idx+1<item.notBeforeWeek?`<div class="notice tip" style="margin:0 0 12px">Non previsto prima della settimana ${item.notBeforeWeek}.</div>`:''}
            <div class="form-grid"><div class="field"><label>Serie / ripetizioni fatte</label><input data-field="sets" value="${esc(a.sets||'')}" placeholder="es. 3 × 10" maxlength="300"></div>
            <div class="field"><label>Carico effettivo</label><input data-field="load" value="${esc(a.load||'')}" placeholder="es. 7,5 kg per mano" maxlength="300"></div></div>
            <div class="field"><label>Note esercizio</label><input data-field="note" value="${esc(a.note||'')}" placeholder="Tecnica, sensazioni, modifiche" maxlength="1000"></div>
          </article>`;
        }).join('')}
        <div class="form-grid">
          <div class="field"><label for="session-minutes">Durata effettiva (min)</label><input id="session-minutes" type="number" min="0" max="600" step="0.1" value="${esc(log.minutes||'')}" placeholder="es. 60"></div>
          <div class="field"><label for="session-rpe">RPE percepito (0–10)</label><input id="session-rpe" type="number" min="0" max="10" step="0.5" value="${esc(log.rpe||'')}" placeholder="es. 7"></div>
        </div>
        <div class="field"><label for="session-pain">Fastidio caviglia dopo (0–10, opzionale)</label><input id="session-pain" type="number" min="0" max="10" step="1" value="${esc(log.painAfter??'')}" placeholder="0 = nessun fastidio"></div>
        <div class="field"><label for="session-notes">Note seduta / corsa / caviglia</label><textarea id="session-notes" rows="4" maxlength="10000" placeholder="Come è andata realmente? Allenamento Garmin associato? Dolore, RPE, ecc.">${esc(log.notes||'')}</textarea></div>
        <div class="drawer-actions"><button type="button" class="btn btn-outline" id="cancel-log">Annulla</button><button type="submit" class="btn btn-mint">Salva nel diario</button></div>
      </form>`;
    $('drawer').setAttribute('aria-hidden','false');$('drawer-backdrop').hidden=false;
    requestAnimationFrame(()=>$('drawer').classList.add('open'));
    document.body.style.overflow='hidden';
    $('cancel-log').onclick=closeDrawer;
    $('log-form').onsubmit=saveLog;
    $('drawer-close').focus();
  }
  function closeDrawer(){
    $('drawer').classList.remove('open');$('drawer').setAttribute('aria-hidden','true');
    $('drawer-backdrop').hidden=true;document.body.style.overflow='';
  }
  async function saveLog(ev){
    ev.preventDefault();const form=ev.target,date=form.dataset.date,entry={status:$('session-status').value,notes:$('session-notes').value,minutes:$('session-minutes').value,rpe:$('session-rpe').value,painAfter:$('session-pain').value,exercises:{}};
    form.querySelectorAll('[data-exercise]').forEach(el=>{
      const record={}; el.querySelectorAll('[data-field]').forEach(x=>record[x.dataset.field]=x.value.trim());
      if(Object.values(record).some(Boolean))entry.exercises[el.dataset.exercise]=record;
    });
    if(!live){try{LOGS[date]=entry;storeLocal();closeDrawer();renderAll();flash('Seduta salvata in questo browser. Esporta il diario per conservarne una copia.');}catch(err){flash('Salvataggio nel browser non riuscito: '+err.message,true);}return;}
    const saveBtn=form.querySelector('[type=submit]');saveBtn.disabled=true;
    try{
      const r=await fetch('/api/logs',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Dashboard':'1'},body:JSON.stringify({date,entry})});
      const result=await r.json();if(!r.ok)throw new Error(result.error||'Errore di salvataggio');
      LOGS[date]=entry; closeDrawer();
      if(result.analyticsUpdated){const frame=$('garmin-frame');frame.src='/garmin/dashboard?t='+Date.now();frame.dataset.loaded='yes';G.dashboardBuilt=true;}
      renderAll();flash('Seduta del '+datelabel(date)+' salvata nel diario privato.');
    }catch(err){flash('Impossibile salvare: '+err.message,true);saveBtn.disabled=false;}
  }
  function renderAll(){renderOverview();renderWeek();renderStrength();renderGarmin();renderRoadmap();}
  async function loadStatus(){
    if(!live)return;
    try{
      const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)return;
      const obj=await r.json(),wasRunning=SYNC.status==='running';G=obj.garmin||{};SYNC=obj.sync||{};
      if(wasRunning && SYNC.status==='ok'){
        const frame=$('garmin-frame');frame.dataset.loaded='';frame.src='/garmin/dashboard?t='+Date.now();
        flash('Sincronizzazione Garmin conclusa.');
      }
      if(wasRunning && SYNC.status==='error')flash('Aggiornamento non riuscito. Consulta i log locali.',true);
      renderOverview();renderGarmin();
    }catch(_){/* Server could be closing. */}
  }
  async function startSync() {
    if(!live){try{const r=await fetch('./garmin/summary.json?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Riepilogo Garmin non disponibile');G=await r.json();G.dashboardBuilt=true;const f=$('garmin-frame');f.src='./garmin/dashboard.html?v='+Date.now();f.dataset.loaded='yes';renderOverview();renderGarmin();flash('Dati pubblicati ricaricati. Per acquisirne di nuovi usa il workflow GitHub Actions.');}catch(e){flash(e.message,true);}return;}
    try{
      const r=await fetch('/api/refresh',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Dashboard':'1'},body:JSON.stringify({confirm:true})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Errore');
      SYNC.status='running';renderGarmin();flash('Download Garmin avviato sul PC.');
      if(!refreshTicker)refreshTicker=setInterval(loadStatus,5000);
    }catch(e){flash(e.message,true);}
  }
  async function init(){
    try{const response=await fetch('./training-plan.json',{cache:'no-store'});if(!response.ok)throw Error('File piano non disponibile');P=await response.json();}
    catch(e){$('flash').hidden=false;$('flash').textContent='Impossibile leggere il piano allenamenti: '+e.message;return;}
    try{
      const r=await fetch('/api/bootstrap',{cache:'no-store'});if(!r.ok)throw new Error('Non disponibile');
      const obj=await r.json();LOGS=obj.logs||{};G=obj.garmin||{};SYNC=obj.sync||{};
    }catch(e){live=false;SYNC={status:'published'};
      try{const r=await fetch('./garmin/summary.json',{cache:'no-store'});G=r.ok?await r.json():{available:false};}catch(_){G={available:false};}
      try{const r=await fetch('./training-log-public.json',{cache:'no-store'});LOGS=r.ok?await r.json():{};}catch(_){LOGS={};}
      LOGS={...LOGS,...localSaved()};
    }
    const start=Math.max(0,phaseWeek()-1);week=Math.min(start,Math.max(0,Math.floor(countDays(P.startDate,P.race.date)/7)));
    $('top-date').textContent=new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(today);
    document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
    document.body.addEventListener('click',e=>{
      const go=e.target.closest('[data-go]');if(go){navigate(go.dataset.go);return;}
      const day=e.target.closest('[data-open]');if(day){openDrawer(day.dataset.open);return;}
      const tab=e.target.closest('[data-strength]');if(tab){strengthTab=tab.dataset.strength;renderStrength();return;}
    });
    $('week-prev').onclick=()=>{week=Math.max(0,week-1);renderWeek();};
    $('week-next').onclick=()=>{week=Math.min(Math.floor(countDays(P.startDate,P.race.date)/7),week+1);renderWeek();};
    $('week-now').onclick=()=>{week=Math.max(0,phaseWeek()-1);renderWeek();};
    $('backup-log').onclick=async()=>{
      if(!live){const blob=new Blob([JSON.stringify(LOGS,null,2)],{type:'application/json;charset=utf-8'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='piano-allenamento-diario-'+TODAY+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);return;}
      try{
        const r=await fetch('/api/backup',{cache:'no-store'});if(!r.ok)throw Error('Backup non disponibile');
        const contents=await r.text();const blob=new Blob([contents],{type:'application/json;charset=utf-8'});
        const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='copenhagen21k-diario-'+TODAY+'.json';
        document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
      }catch(e){flash(e.message,true);}
    };
    $('top-sync').onclick=startSync;$('garmin-sync').onclick=startSync;
    $('drawer-close').onclick=closeDrawer;$('drawer-backdrop').onclick=closeDrawer;
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
    renderAll();
    const anchor=location.hash.slice(1);if(['overview','week','strength','garmin','roadmap'].includes(anchor))navigate(anchor);
    refreshTicker=setInterval(loadStatus,12000);
  }
  init();
})();

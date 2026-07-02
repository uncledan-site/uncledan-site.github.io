/* =====================================================================
   Tabellone Baskin - logica applicativa
   Autore: Daniele Lolli (UncleDan)
   PWA offline, due schermate: principale e impostazioni.
   ===================================================================== */
'use strict';

const APP_VERSION = '1.13.2';
const STORE_KEY = 'baskin-tabellone-v1';

/* Repository del codice sorgente (modifica l'URL se cambi repo) */
const REPO_URL = 'https://github.com/UncleDan/baskin-tabellone';

/* ---------- Configurazione predefinita (modificabile da Impostazioni) ---------- */
const DEFAULT_CONFIG = {
  minutes: 8,            // durata di un periodo regolamentare (quarto)
  overtimeMinutes: 4,    // durata di un tempo supplementare
  periods: 4,            // numero di periodi regolamentari
  timeoutMode: 'baskin', // logica timeout: 'baskin' (riporto all'indietro) o 'fiba'
  timeoutsPerHalf: 2,    // timeout per squadra in ciascun tempo (meta' gara): 1 per quarto, riportabili nella coppia di quarti
  timeoutsOvertime: 1,   // timeout per squadra in ogni supplementare
  bonusMode: 'last2',    // 'last2' (Baskin: ultimi 2'), 'teamFouls' (Basket: dopo N falli), 'off'
  bonus: 5,              // soglia falli per il bonus (modalita' 'teamFouls')
  manualFouls: false,    // conteggio falli manuale (tasti +/-): default disattivato
  possession: false,     // frecce possesso alternato (default off in Baskin)
  scoreTeamColor: false, // punteggio nel colore della squadra (default: verde)
  resetFoulsEachPeriod: true,
  autoHorn: true
};

/* Preset di disciplina: i pulsanti "Baskin"/"Basket FIBA" reimpostano i campi
   di gara a questi valori (le opzioni personali come scoreTeamColor non cambiano). */
const PRESET_BASKIN = {
  minutes: 8, overtimeMinutes: 4, periods: 4,
  timeoutMode: 'baskin', timeoutsPerHalf: 2, timeoutsOvertime: 1,
  bonusMode: 'last2', bonus: 5, manualFouls: false, possession: false,
  resetFoulsEachPeriod: true, autoHorn: true
};
const PRESET_BASKET_FIBA = {
  minutes: 10, overtimeMinutes: 5, periods: 4,
  timeoutMode: 'fiba', timeoutsPerHalf: 2, timeoutsOvertime: 1,
  bonusMode: 'teamFouls', bonus: 4, manualFouls: true, possession: true,
  resetFoulsEachPeriod: true, autoHorn: true
};

/* Durata (minuti / ms) del periodo indicato: i periodi oltre quelli
   regolamentari sono supplementari e durano overtimeMinutes. */
function periodMinutes(period){
  const c = state.config;
  return (period > c.periods) ? c.overtimeMinutes : c.minutes;
}
function periodFullMs(period){ return periodMinutes(period) * 60000; }

/* ---------- Timeout: raggruppamento per "fase" --------------------------
   I timeout sono 1 per quarto ma si riportano all'interno della stessa meta'
   gara: i quarti 1-2 condividono un monte (timeoutsPerHalf), cosi' come i
   quarti 3-4; ogni supplementare ha un monte a se' (timeoutsOvertime).      */
function phaseKey(period){
  const c = state.config;
  if(period > c.periods) return 'ot' + (period - c.periods);  // ogni supplementare separato
  const half = Math.ceil(c.periods / 2);
  return (period <= half) ? 'h1' : 'h2';                       // prima / seconda meta'
}
function timeoutPool(period){
  const c = state.config;
  if(c.timeoutMode === 'fiba'){
    if(period > c.periods) return 1;                 // ogni supplementare: 1
    const half = Math.ceil(c.periods / 2);
    return (period <= half) ? 2 : 3;                 // FIBA: 2 nel 1° tempo, 3 nel 2°
  }
  return (period > c.periods) ? c.timeoutsOvertime : c.timeoutsPerHalf;
}

/* Siamo negli ultimi 2 minuti dell'ultimo periodo regolamentare? (regola FIBA) */
function inLastTwoMinutes(){
  return state.period === state.config.periods && state.remainingMs < 120000;
}

/* ---------- Stato della partita ---------- */
let state = loadState();

function freshState(cfg){
  const c = { ...DEFAULT_CONFIG, ...(cfg || {}) };
  return {
    config: c,
    period: 1,
    remainingMs: c.minutes * 60000,
    running: false,
    scores: [0, 0],
    fouls: [0, 0],
    timeoutsUsed: [0, 0],
    timeoutsLate: [0, 0],    // FIBA: timeout usati negli ultimi 2' dell'ultimo periodo
    bonusActive: [false, false],  // bonus per squadra (modalita' 'teamFouls')
    possession: [false, false],   // freccia possesso: [sinistra, destra]
    toPhase: 'h1',           // fase a cui si riferisce timeoutsUsed
    names: ['Squadra 1', 'Squadra 2'],
    colors: ['#ffffff', '#ffffff']   // colore della scritta nome, per squadra
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw){
      const s = JSON.parse(raw);
      s.config = { ...DEFAULT_CONFIG, ...(s.config || {}) };
      // migrazione: vecchio flag autoBonusLast2 -> bonusMode
      if(typeof s.config.bonusMode !== 'string'){
        s.config.bonusMode = s.config.autoBonusLast2 === false ? 'off' : 'last2';
      }
      delete s.config.autoBonusLast2;
      s.running = false;            // non si riprende mai "in corsa"
      if(!Array.isArray(s.names)) s.names = ['Squadra 1','Squadra 2'];
      if(!Array.isArray(s.colors)) s.colors = ['#ffffff','#ffffff'];
      if(!Array.isArray(s.timeoutsUsed)) s.timeoutsUsed = [0,0];
      if(!Array.isArray(s.timeoutsLate)) s.timeoutsLate = [0,0];
      if(!Array.isArray(s.bonusActive)) s.bonusActive = [false,false];
      if(!Array.isArray(s.possession)) s.possession = [false,false];
      if(typeof s.period !== 'number') s.period = 1;
      if(typeof s.toPhase !== 'string') s.toPhase = phaseKeyFor(s, s.period);
      return s;
    }
  }catch(e){ /* ignora */ }
  return freshState(DEFAULT_CONFIG);
}
/* variante di phaseKey utilizzabile prima che 'state' sia assegnato */
function phaseKeyFor(s, period){
  const c = s.config;
  if(period > c.periods) return 'ot' + (period - c.periods);
  const half = Math.ceil(c.periods / 2);
  return (period <= half) ? 'h1' : 'h2';
}

let muted = false;
try{ muted = localStorage.getItem(STORE_KEY+':muted') === '1'; }catch(e){}

let wakeWantedInit = false;
try{ wakeWantedInit = localStorage.getItem(STORE_KEY+':wake') === '1'; }catch(e){}

/* Salvataggio dello stato completo (partita + opzioni) ad ogni comando.
   Aggiunge un timestamp così, in caso di chiusura/crash, alla riapertura
   si riprende esattamente da qui (a orologio fermo). */
function saveState(){
  try{
    state.savedAt = Date.now();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }catch(e){}
}

/* =====================================================================
   DISPLAY A 7 SEGMENTI (SVG generato)
   ===================================================================== */
const SEG_MAP = {
  '0':['a','b','c','d','e','f'],
  '1':['b','c'],
  '2':['a','b','g','e','d'],
  '3':['a','b','g','c','d'],
  '4':['f','g','b','c'],
  '5':['a','f','g','c','d'],
  '6':['a','f','g','e','c','d'],
  '7':['a','b','c'],
  '8':['a','b','c','d','e','f','g'],
  '9':['a','b','c','d','f','g'],
  ' ':[]
};

const SEG_POLY = buildSegmentPolygons();
function buildSegmentPolygons(){
  const W=100,H=180,p=11,ht=8,inset=5;
  const xL=p, xR=W-p, yA=p, yG=H/2, yD=H-p;
  const hx1=xL+inset, hx2=xR-inset;
  const horiz = (yc)=>[
    [hx1,yc],[hx1+ht,yc-ht],[hx2-ht,yc-ht],[hx2,yc],[hx2-ht,yc+ht],[hx1+ht,yc+ht]
  ];
  const vert = (xc,y1,y2)=>{
    const a=y1+inset, b=y2-inset;
    return [[xc,a],[xc+ht,a+ht],[xc+ht,b-ht],[xc,b],[xc-ht,b-ht],[xc-ht,a+ht]];
  };
  const toStr = pts => pts.map(p=>p.join(',')).join(' ');
  return {
    a: toStr(horiz(yA)),
    g: toStr(horiz(yG)),
    d: toStr(horiz(yD)),
    f: toStr(vert(xL,yA,yG)),
    b: toStr(vert(xR,yA,yG)),
    e: toStr(vert(xL,yG,yD)),
    c: toStr(vert(xR,yG,yD))
  };
}

function digitSVG(ch){
  const on = new Set(SEG_MAP[ch] || []);
  let polys = '';
  for(const seg of ['a','b','c','d','e','f','g']){
    const cls = on.has(seg) ? 'seg' : 'seg off';
    polys += `<polygon class="${cls}" points="${SEG_POLY[seg]}"/>`;
  }
  return `<svg class="seg-digit" viewBox="0 0 100 180" aria-hidden="true">${polys}</svg>`;
}

function colonSVG(){
  return `<svg class="seg-colon" viewBox="0 0 30 180" aria-hidden="true">`+
         `<circle class="dot" cx="15" cy="64" r="9"/>`+
         `<circle class="dot" cx="15" cy="116" r="9"/></svg>`;
}

function renderNumber(el, value){
  const s = String(value);
  el.innerHTML = [...s].map(digitSVG).join('');
}

/* =====================================================================
   RIFERIMENTI DOM
   ===================================================================== */
const $ = sel => document.querySelector(sel);
const body = document.body;
const elTimer = $('#timer');
const elPeriod = $('#period');
const elScore = [ $('#score1'), $('#score2') ];
const elFoul  = [ $('#foul1'),  $('#foul2')  ];
const elTO    = [ $('#timeouts1'), $('#timeouts2') ];
const elName  = [ $('#name1'), $('#name2') ];
const bonusLeft = $('#bonusLeft');
const bonusRight = $('#bonusRight');

/* colori base selezionabili per la scritta del nome squadra
   (bianco, nero, rosso, blu, giallo, viola, verde, azzurro) */
const TEAM_COLORS = ['#ffffff','#000000','#ff2b2b','#2962ff','#ffe000','#9b30ff','#1ee63a','#29b6f6'];

function luminance(hex){
  const c = String(hex||'#ffffff').replace('#','');
  if(c.length < 6) return 1;
  const r = parseInt(c.substr(0,2),16)/255, g = parseInt(c.substr(2,2),16)/255, b = parseInt(c.substr(4,2),16)/255;
  const lin = x => (x <= 0.03928) ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4);
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}

/* campi nome modificabili + selettore colore (iniettati) */
const nameInputs = [];
const colorRows = [];
[0,1].forEach(i=>{
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'team-name-input';
  inp.maxLength = 18;
  elName[i].insertAdjacentElement('afterend', inp);
  inp.addEventListener('input', ()=>{ state.names[i] = inp.value; saveState(); });
  inp.addEventListener('blur', ()=>{ if(!inp.value.trim()){ inp.value = `Squadra ${i+1}`; state.names[i]=inp.value; saveState(); } });
  nameInputs.push(inp);

  // riga di scelta colore (visibile solo in modifica)
  const row = document.createElement('div');
  row.className = 'color-row only-edit';
  TEAM_COLORS.forEach(col=>{
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.style.background = col;
    sw.dataset.color = col.toLowerCase();
    sw.setAttribute('aria-label', 'Colore ' + col);
    sw.addEventListener('click', ()=> setTeamColor(i, col));
    row.appendChild(sw);
  });
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'swatch custom';
  custom.setAttribute('aria-label', 'Colore personalizzato');
  custom.addEventListener('input', ()=> setTeamColor(i, custom.value));
  row.appendChild(custom);
  inp.insertAdjacentElement('afterend', row);
  colorRows.push({ row, custom });
});

function setTeamColor(team, col){
  state.colors[team] = col;
  applyTeamColors();
  saveState();
}

function applyTeamColors(){
  for(let i=0;i<2;i++){
    const col = (state.colors && state.colors[i]) || '#ffffff';
    const dark = luminance(col) < 0.25;
    [elName[i], nameInputs[i]].forEach(el=>{
      el.style.color = col;
      el.classList.toggle('outline', dark);   // lieve bordatura bianca se troppo scuro
    });
    // evidenzia lo swatch selezionato e allinea il selettore personalizzato
    const cr = colorRows[i];
    if(cr){
      cr.row.querySelectorAll('.swatch[data-color]').forEach(sw=>{
        sw.classList.toggle('sel', sw.dataset.color === String(col).toLowerCase());
      });
      try{ cr.custom.value = /^#[0-9a-f]{6}$/i.test(col) ? col : '#ffffff'; }catch(e){}
    }
  }
  applyScoreColors();
}

/* Punteggio nel colore della squadra (opzionale). Di default i punti restano
   verdi; se attivo, ogni punteggio prende il colore della propria squadra,
   con lieve alone bianco se il colore è troppo scuro. */
function applyScoreColors(){
  const on = state.config.scoreTeamColor;
  for(let i=0;i<2;i++){
    if(on){
      const col = (state.colors && state.colors[i]) || '#ffffff';
      elScore[i].style.color = col;
      elScore[i].classList.toggle('outline-svg', luminance(col) < 0.25);
    } else {
      elScore[i].style.color = '';                 // torna al verde definito nel CSS
      elScore[i].classList.remove('outline-svg');
    }
  }
}

/* =====================================================================
   RENDER COMPLETO
   ===================================================================== */
function pad2(n){ return String(n).padStart(2,'0'); }

function mmss(ms){
  const t = Math.max(0, Math.ceil(ms/1000));
  return [ pad2(Math.floor(t/60)), pad2(t%60) ];
}

/* Regolamento FIBA: negli ultimi 60 secondi di ogni periodo o supplementare
   il cronometro mostra i decimi di secondo (SS.d invece di MM:SS). */
function renderTimer(){
  const ms = Math.max(0, state.remainingMs);
  const tenths = Math.ceil(ms / 100);            // decimi totali (0..600 nell'ultimo minuto)
  if(tenths >= 600){
    // 60,0 s o piu' -> formato MM:SS
    const [mm, ss] = mmss(ms);
    elTimer.classList.remove('tenths');
    elTimer.innerHTML = digitSVG(mm[0]) + digitSVG(mm[1]) + colonSVG() + digitSVG(ss[0]) + digitSVG(ss[1]);
  } else {
    // ultimo minuto -> formato SS:d con i decimi (stessi due punti, tanto i minuti non ci sono)
    const ss = pad2(Math.floor(tenths / 10));
    const d  = String(tenths % 10);
    elTimer.classList.add('tenths');
    elTimer.innerHTML = digitSVG(ss[0]) + digitSVG(ss[1]) + colonSVG() + digitSVG(d);
  }
  updateNextButton();
}

/* Il pulsante "periodo successivo" compare accanto al play quando il tempo è
   finito (es. dopo la sirena automatica) e l'orologio è fermo.
   Alla fine del 4° quarto e di ogni supplementare si propone SOLO in parità
   (se non è pareggio la partita è finita). */
function updateNextButton(){
  const atEnd = (state.remainingMs <= 0) && !state.running;
  const last = state.period >= (state.config.periods + 9);  // 9TS: non si avanza oltre
  let allow = atEnd && !last;
  if(allow && state.period >= state.config.periods){
    allow = (state.scores[0] === state.scores[1]);          // 4° o supplementare: solo in parità
  }
  body.classList.toggle('end-of-period', allow);
}

function renderAll(){
  renderTimer();
  // periodo a LED bianco + due spie: ° (ordinario) sopra, TS (supplementare) sotto
  const isOT = state.period > state.config.periods;
  const num = isOT ? (state.period - state.config.periods) : state.period;
  elPeriod.classList.toggle('ot', isOT);
  elPeriod.innerHTML =
    `<span class="period-num">${digitSVG(String(num))}</span>` +
    `<span class="period-ind">` +
      `<svg class="ind-deg" viewBox="0 0 40 44" aria-hidden="true"><circle cx="20" cy="15" r="10" fill="none" stroke="currentColor" stroke-width="7"/></svg>` +
      `<span class="ind-ts">TS</span>` +
    `</span>`;
  for(let i=0;i<2;i++){
    renderNumber(elScore[i], state.scores[i]);
    renderNumber(elFoul[i], state.fouls[i]);
    elFoul[i].classList.toggle('limit', state.fouls[i] >= state.config.bonus);
    renderTimeouts(i);
    elName[i].textContent = state.names[i];
    nameInputs[i].value = state.names[i];
  }
  updateBonus();
  renderPossession();
  applyTeamColors();

  body.dataset.running = state.running ? 'true' : 'false';
  body.dataset.muted = muted ? 'true' : 'false';
  applyFoulMode();
}

/* Conteggio falli manuale: se attivo mostra contatori e tasti +/- dei falli,
   altrimenti resta solo l'etichetta "Falli" con le frecce del bonus. */
function applyFoulMode(){
  body.classList.toggle('manual-fouls', !!state.config.manualFouls);
}
function updateFoulLabel(){
  const el = $('#foulState'); if(el) el.textContent = state.config.manualFouls ? 'on' : 'off';
}

/* Bonus "ultimi 2'" (Baskin): negli ultimi 2' del 4° periodo e dei supplementari
   vale per entrambe le squadre. */
function autoBonusActive(){
  const c = state.config;
  if(c.bonusMode !== 'last2') return false;
  const inFinalPhase = state.period >= c.periods;   // Q4 (== periods) o supplementari (> periods)
  // il bonus si accende quando il cronometro NON mostra più 2:00 (cioè a 1:59):
  // il display arrotonda per eccesso, quindi confrontiamo gli stessi secondi mostrati
  const shownSeconds = Math.ceil(state.remainingMs / 1000);
  return inFinalPhase && shownSeconds < 120;
}

/* Bonus "dopo N falli" (Basket/FIBA): per squadra, si accende quando i falli
   raggiungono la soglia, ma solo a cronometro avviato; resta acceso (latch)
   fino all'azzeramento dei falli (cambio periodo). */
function updateTeamFoulBonus(){
  const c = state.config;
  if(c.bonusMode !== 'teamFouls') return;
  if(!state.running) return;                 // si accende alla ripartenza del tempo
  for(let t=0; t<2; t++){
    if(state.fouls[t] >= c.bonus) state.bonusActive[t] = true;
  }
}

function updateBonus(){
  const c = state.config;
  let l = false, r = false, auto = false;
  if(c.bonusMode === 'last2'){
    auto = autoBonusActive();
    l = r = auto;
  } else if(c.bonusMode === 'teamFouls'){
    l = !!state.bonusActive[0];
    r = !!state.bonusActive[1];
  }
  bonusLeft.classList.toggle('active', l);    // pallino bonus squadra 1
  bonusRight.classList.toggle('active', r);   // pallino bonus squadra 2
  body.classList.toggle('auto-bonus', auto);
}

/* ---------- Possesso alternato ---------- */
function renderPossession(){
  const on = !!state.config.possession;
  const wrap = $('#possession');
  if(wrap) wrap.hidden = !on;
  if(!on) return;
  $('#possLeft').classList.toggle('active', !!state.possession[0]);
  $('#possRight').classList.toggle('active', !!state.possession[1]);
}
function tapPossession(side){
  const i = (side === 'left') ? 0 : 1;
  if(body.classList.contains('mode-edit')){
    // in IMPOSTAZIONI: toggle indipendente (si puo' tornare anche a spento)
    state.possession[i] = !state.possession[i];
  } else {
    // in OPERATIVA: accende quella toccata e spegne l'altra
    state.possession = (side === 'left') ? [true, false] : [false, true];
  }
  renderPossession();
  saveState();
}

/* Quanti timeout sono assegnabili "adesso" alla singola squadra:
   - primo quarto del tempo (Q1, Q3): massimo 1 (assegnando il primo si blocca il secondo)
   - secondo quarto del tempo (Q2, Q4): fino all'intero monte del tempo (riporto dal quarto precedente)
   - tempi supplementari: 1 ciascuno */
/* Numero massimo di pallini assegnabili "adesso" per la singola squadra.
   BASKIN: 1 nel primo quarto del tempo, monte pieno nel secondo (riporto
   all'indietro entro la stessa metà); ogni supplementare = timeoutsOvertime.
   FIBA: monte pieno della metà (2 nel 1° tempo, 3 nel 2°), ma negli ultimi 2'
   dell'ultimo periodo al massimo 2 timeout possono essere chiamati in quella
   finestra; ogni supplementare = 1. */
function timeoutAssignableCap(period, team){
  const c = state.config;
  if(c.timeoutMode === 'fiba'){
    const pool = timeoutPool(period);
    if(period > c.periods) return pool;              // supplementare: tutti (=1)
    const half = Math.ceil(c.periods / 2);
    const secondHalf = period > half;
    if(secondHalf && inLastTwoMinutes()){
      const late = (state.timeoutsLate && state.timeoutsLate[team]) || 0;
      // già usati + quanti ancora chiamabili nella finestra (max 2)
      return Math.min(pool, state.timeoutsUsed[team] + Math.max(0, 2 - late));
    }
    return pool;
  }
  // BASKIN
  if(period > c.periods) return c.timeoutsOvertime;
  const firstOfHalf = ((period - 1) % 2) === 0;      // Q1, Q3 = primo quarto del tempo
  return firstOfHalf ? 1 : c.timeoutsPerHalf;
}

function renderTimeouts(i){
  const total = timeoutPool(state.period);
  const lit = state.timeoutsUsed[i];   // numero di pallini accesi (timeout chiamati)
  const cap = timeoutAssignableCap(state.period, i);
  const gameMode = !body.classList.contains('mode-edit');
  const wrap = elTO[i];
  wrap.innerHTML = '';
  if(total <= 0){ wrap.style.display='none'; return; }
  wrap.style.display = 'inline-flex';
  wrap.setAttribute('role', 'button');
  for(let d=0; d<total; d++){
    let cls = 'to-dot';
    if(d < lit) cls += ' on';                     // acceso (timeout chiamato)
    else if(gameMode && d >= cap) cls += ' blocked';  // non disponibile in questo quarto
    const dot = document.createElement('span');
    dot.className = cls;
    wrap.appendChild(dot);
  }
}

/* =====================================================================
   MOTORE DEL TEMPO
   ===================================================================== */
let tickId = null;
let tickStart = 0;
let tickBase = 0;

function startClock(){
  if(state.running || state.remainingMs <= 0) return;
  state.running = true;
  tickBase = state.remainingMs;
  tickStart = performance.now();
  updateTeamFoulBonus();      // Basket: il bonus si accende alla ripartenza
  updateBonus();
  lastAutoBonus = autoBonusActive();
  lastTickSave = performance.now();
  body.dataset.running = 'true';
  tickId = setInterval(onTick, 100);
  saveState();
}

function stopClock(){
  if(tickId){ clearInterval(tickId); tickId = null; }
  if(state.running){
    state.remainingMs = Math.max(0, tickBase - (performance.now() - tickStart));
  }
  state.running = false;
  body.dataset.running = 'false';
  renderTimer();
  saveState();
  // se c'era un aggiornamento in attesa (rinviato per non interrompere la partita), applicalo ora
  if(window.__applyPendingUpdate){ window.__applyPendingUpdate(); }
}

let lastAutoBonus = false;
let lastTickSave = 0;
function onTick(){
  const rem = Math.max(0, tickBase - (performance.now() - tickStart));
  state.remainingMs = rem;
  renderTimer();
  // aggiorna il bonus automatico in tempo reale (entrata negli ultimi 2')
  const ab = autoBonusActive();
  if(ab !== lastAutoBonus){ updateBonus(); lastAutoBonus = ab; }
  // persistenza anti-crash: salva il tempo residuo ~ ogni secondo mentre scorre
  const now = performance.now();
  if(now - lastTickSave >= 1000){ saveState(); lastTickSave = now; }
  if(rem <= 0){
    stopClock();
    if(state.config.autoHorn) horn();
    toast('Fine tempo');
  }
}

function togglePlay(){
  if(state.running) stopClock(); else startClock();
}

/* =====================================================================
   AZIONI DI GIOCO
   ===================================================================== */
function addPoints(team, pts){
  state.scores[team] = Math.max(0, state.scores[team] + pts);
  renderNumber(elScore[team], state.scores[team]);
  updateNextButton();   // a fine 4°/supplementare il "successivo" dipende dalla parità
  saveState();
}

function addFoul(team, delta){
  if(!state.config.manualFouls) return;
  state.fouls[team] = Math.max(0, state.fouls[team] + delta);
  updateTeamFoulBonus();   // se a crono avviato e raggiunta la soglia, accende il bonus
  renderAll();
  saveState();
}

function tapTimeout(team){
  const pool = timeoutPool(state.period);
  if(pool <= 0) return;
  if(body.classList.contains('mode-edit')){
    // in IMPOSTAZIONI: ciclo libero con azzeramento al pieno (per correggere)
    let n = state.timeoutsUsed[team] + 1;
    if(n > pool) n = 0;
    state.timeoutsUsed[team] = n;
    if(n === 0 && state.timeoutsLate) state.timeoutsLate[team] = 0;
  } else {
    // in OPERATIVA: il timeout si assegna solo a cronometro fermo
    if(state.running){
      toast('Cronometro in movimento');   // niente fischio
      return;
    }
    // assegna solo se disponibile, altrimenti fischio + popup
    const cap = timeoutAssignableCap(state.period, team);
    if(state.timeoutsUsed[team] < cap){
      state.timeoutsUsed[team] += 1;
      // FIBA: conta i timeout chiamati negli ultimi 2' (max 2 in quella finestra)
      if(state.config.timeoutMode === 'fiba' && inLastTwoMinutes()){
        if(!Array.isArray(state.timeoutsLate)) state.timeoutsLate = [0,0];
        state.timeoutsLate[team] += 1;
      }
    } else {
      whistle();
      toast('Timeout non disponibile');
      return;
    }
  }
  renderTimeouts(team);
  saveState();
}

function applyPeriod(p, resetTime){
  const max = state.config.periods + 9;   // fino a 9 tempi supplementari (1TS..9TS)
  p = Math.max(1, Math.min(max, p));
  state.period = p;
  // i timeout si riportano dentro la stessa meta' gara; si azzerano al cambio
  // fase (inizio seconda meta', ogni supplementare)
  const newPhase = phaseKey(p);
  if(newPhase !== state.toPhase){ state.timeoutsUsed = [0,0]; state.timeoutsLate = [0,0]; state.toPhase = newPhase; }
  if(state.config.resetFoulsEachPeriod){ state.fouls = [0,0]; state.bonusActive = [false,false]; }
  // il tempo si ricarica solo se richiesto esplicitamente (es. "periodo successivo"):
  // cambiando manualmente il numero del periodo il tempo NON si azzera.
  if(resetTime && !state.running){ state.remainingMs = periodFullMs(p); }
  renderAll();
  saveState();
  const label = (p > state.config.periods) ? `Supplementare ${p - state.config.periods}TS` : `Periodo ${p}`;
  toast(label);
}

function resetClock(){
  stopClock();
  state.remainingMs = periodFullMs(state.period);
  renderTimer();
  saveState();
  toast('Tempo azzerato');
}

function newGame(){
  stopClock();
  state = freshState(state.config);
  state.names = state.names || ['Squadra 1','Squadra 2'];
  renderAll();
  saveState();
  toast('Nuova partita');
}

/* Reset della sola partita: azzera punteggi, falli, timeout, tempo e periodo,
   mantenendo impostazioni e nomi squadra. */
/* Reset della partita: azzera punteggi, falli, timeout, tempo, periodo,
   nomi e colori delle squadre; mantiene solo le impostazioni di gara. */
function resetGame(){
  stopClock();
  const cfg = state.config;
  state = freshState(cfg);
  renderAll();
  saveState();
  toast('Partita azzerata');
}

/* =====================================================================
   AUDIO
   Suoni reali (file WAV originali, licenza CC0) in /sounds, con sintetizzatore
   di riserva via WebAudio se i file non sono disponibili.
   ===================================================================== */
let actx = null;
const SOUND_FILES = { horn: 'sounds/horn.wav', whistle: 'sounds/whistle.wav' };
const soundBuffers = { horn: null, whistle: null };
let soundsLoading = false;

function ensureAudio(){
  if(!actx){
    try{ actx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ actx = null; }
  }
  if(actx && actx.state === 'suspended'){ actx.resume(); }
  if(actx && !soundsLoading){ loadSounds(); }
  return actx;
}

async function loadSounds(){
  if(soundsLoading || !actx) return;
  soundsLoading = true;
  for(const key of Object.keys(SOUND_FILES)){
    if(soundBuffers[key]) continue;
    try{
      const res = await fetch(SOUND_FILES[key]);
      const buf = await res.arrayBuffer();
      soundBuffers[key] = await actx.decodeAudioData(buf);
    }catch(e){ /* si usera' il sintetizzatore di riserva */ }
  }
}

function playBuffer(key){
  const ctx = actx; if(!ctx) return false;
  const buf = soundBuffers[key]; if(!buf) return false;
  try{
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.95;
    src.connect(g); g.connect(ctx.destination);
    src.start();
    return true;
  }catch(e){ return false; }
}

/* sintetizzatori di riserva (nessun file) */
function beep(freq, start, dur, gainPeak, type){
  const ctx = actx; if(!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  osc.connect(g); g.connect(ctx.destination);
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.02);
  g.gain.setValueAtTime(gainPeak, t0 + dur - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function hornSynth(){ beep(311, 0.0, 1.0, 0.35, 'sawtooth'); beep(233, 0.0, 1.0, 0.30, 'sawtooth'); }
function whistleSynth(){
  const ctx = actx; if(!ctx) return;
  const osc = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
  osc.type='sine'; osc.frequency.value=3100;
  lfo.type='sine'; lfo.frequency.value=22; lg.gain.value=90;
  lfo.connect(lg); lg.connect(osc.frequency);
  osc.connect(g); g.connect(ctx.destination);
  const t0=ctx.currentTime;
  g.gain.setValueAtTime(0.0001,t0);
  g.gain.exponentialRampToValueAtTime(0.4,t0+0.02);
  g.gain.setValueAtTime(0.4,t0+0.45);
  g.gain.exponentialRampToValueAtTime(0.0001,t0+0.55);
  lfo.start(t0); osc.start(t0); osc.stop(t0+0.6); lfo.stop(t0+0.6);
}

function horn(){
  if(muted) return;
  ensureAudio();
  if(!playBuffer('horn')) hornSynth();
}
function whistle(){
  if(muted) return;
  ensureAudio();
  if(!playBuffer('whistle')) whistleSynth();
}

/* =====================================================================
   MODALITA' IMPOSTAZIONI / GIOCO
   ===================================================================== */
function enterEdit(){
  stopClock();
  body.classList.remove('mode-game');
  body.classList.add('mode-edit');
  renderAll();   // ridisegna i pallini timeout senza lo stato "bloccato"
}
function exitEdit(){
  // assicura nomi validi
  for(let i=0;i<2;i++){ if(!state.names[i].trim()) state.names[i] = `Squadra ${i+1}`; }
  body.classList.remove('mode-edit');
  body.classList.add('mode-game');
  renderAll();
  saveState();
  toast('Modifiche salvate');
}

/* =====================================================================
   FOGLI MODALI
   ===================================================================== */
function openSheet(id){ const el = document.getElementById(id); el.hidden = false; }
function closeSheet(id){ const el = document.getElementById(id); el.hidden = true; }

/* =====================================================================
   ROTORI (picker a rotella, con scroll-snap)
   ===================================================================== */
const ROTOR_ITEM_H = 44;   // deve combaciare con il CSS (.rotor-item height)

function buildRotor(el, values, initialIndex){
  el._values = values;
  el.innerHTML = '';
  values.forEach((v, idx)=>{
    const it = document.createElement('div');
    it.className = 'rotor-item';
    it.textContent = v;
    it.dataset.idx = idx;
    it.addEventListener('click', ()=> setRotorIndex(el, idx, true));
    el.appendChild(it);
  });
  setRotorIndex(el, initialIndex, false);
  // ri-applica la posizione dopo il layout (il foglio può essere appena diventato visibile)
  if(typeof requestAnimationFrame === 'function'){
    requestAnimationFrame(()=>{
      const i = parseInt(el.dataset.idx, 10) || 0;
      el.scrollTop = i * ROTOR_ITEM_H;
    });
  }
  if(!el._wired){
    let t = null;
    el.addEventListener('scroll', ()=>{
      clearTimeout(t);
      t = setTimeout(()=>{
        const i = Math.round(el.scrollTop / ROTOR_ITEM_H);
        setRotorIndex(el, i, false);
      }, 110);
    });
    el._wired = true;
  }
}
function setRotorIndex(el, idx, smooth){
  const n = (el._values ? el._values.length : 1);
  idx = Math.max(0, Math.min(n - 1, idx));
  el.dataset.idx = idx;
  const top = idx * ROTOR_ITEM_H;
  try{
    if(smooth && el.scrollTo){ el.scrollTo({ top, behavior:'smooth' }); }
    else { el.scrollTop = top; }
  }catch(e){ el.scrollTop = top; }
  const items = el.querySelectorAll('.rotor-item');
  items.forEach((it,i)=> it.classList.toggle('sel', i === idx));
}
function rotorIndex(el){ return parseInt(el.dataset.idx, 10) || 0; }
function rotorValue(el){ return el._values ? el._values[rotorIndex(el)] : null; }
function rangeStr(a, b){ const out=[]; for(let n=a;n<=b;n++) out.push(pad2(n)); return out; }

/* --- editor del tempo (rotori minuti / secondi / decimi) --- */
const rotorMin = () => $('#rotorMin');
const rotorSec = () => $('#rotorSec');
const rotorTenth = () => $('#rotorTenth');

function openTimeEditor(){
  const tenths = Math.round(state.remainingMs / 100);
  const mm = Math.floor(tenths / 600);
  const ss = Math.floor((tenths % 600) / 10);
  const dd = tenths % 10;
  openSheet('timeBackdrop');                 // prima rendo visibile il foglio…
  buildRotor(rotorMin(),   rangeStr(0, 60), Math.min(60, mm));  // …poi posiziono i rotori
  buildRotor(rotorSec(),   rangeStr(0, 59), ss);
  buildRotor(rotorTenth(), rangeStr(0, 9),  dd);
}
function applyTimeEditor(){
  const mm = parseInt(rotorValue(rotorMin()), 10) || 0;
  const ss = parseInt(rotorValue(rotorSec()), 10) || 0;
  const dd = parseInt(rotorValue(rotorTenth()), 10) || 0;
  state.remainingMs = (mm * 60 + ss) * 1000 + dd * 100;
  closeSheet('timeBackdrop');
  renderTimer();
  saveState();
}
function timeEditorFull(){
  buildRotor(rotorMin(),   rangeStr(0, 60), periodMinutes(state.period));
  buildRotor(rotorSec(),   rangeStr(0, 59), 0);
  buildRotor(rotorTenth(), rangeStr(0, 9),  0);
}

/* --- editor del periodo (rotore 1..N, poi 1TS..9TS) --- */
const rotorPeriod = () => $('#rotorPeriod');
function periodValues(){
  const c = state.config;
  const v = [];
  for(let p=1; p<=c.periods; p++) v.push(String(p));
  for(let k=1; k<=9; k++) v.push(k + 'TS');
  return v;
}
function openPeriodEditor(){
  openSheet('periodBackdrop');
  buildRotor(rotorPeriod(), periodValues(), state.period - 1);
}
function applyPeriodEditor(){
  applyPeriod(rotorIndex(rotorPeriod()) + 1);
  closeSheet('periodBackdrop');
}

/* --- impostazioni partita --- */
let pendingTimeoutMode = 'baskin';
function fillSettingsForm(c){
  $('#cfgMinutes').value = c.minutes;
  $('#cfgPeriods').value = c.periods;
  $('#cfgOvertime').value = c.overtimeMinutes;
  $('#cfgTimeoutsHalf').value = c.timeoutsPerHalf;
  $('#cfgTimeoutsOt').value = c.timeoutsOvertime;
  $('#cfgBonus').value = c.bonus;
  $('#cfgBonusMode').value = (c.bonusMode === 'teamFouls' || c.bonusMode === 'off') ? c.bonusMode : 'last2';
  $('#cfgResetFouls').checked = !!c.resetFoulsEachPeriod;
  $('#cfgFouls').checked = !!c.manualFouls;
  $('#cfgPossession').checked = !!c.possession;
  $('#cfgAutoHorn').checked = !!c.autoHorn;
  pendingTimeoutMode = (c.timeoutMode === 'fiba') ? 'fiba' : 'baskin';
}
function openSettings(){
  fillSettingsForm(state.config);
  openSheet('settingsBackdrop');
}
function saveSettings(){
  const num = (id, def, min, max)=>{
    let v = parseInt($(id).value, 10);
    if(isNaN(v)) v = def;
    return Math.min(max, Math.max(min, v));
  };
  state.config.minutes  = num('#cfgMinutes', 8, 1, 60);
  state.config.periods  = num('#cfgPeriods', 4, 1, 12);
  state.config.overtimeMinutes = num('#cfgOvertime', 4, 1, 30);
  state.config.timeoutsPerHalf = num('#cfgTimeoutsHalf', 2, 0, 9);
  state.config.timeoutsOvertime = num('#cfgTimeoutsOt', 1, 0, 9);
  state.config.bonus    = num('#cfgBonus', 5, 1, 20);
  const bm = $('#cfgBonusMode').value;
  state.config.bonusMode = (bm === 'teamFouls' || bm === 'off') ? bm : 'last2';
  state.config.resetFoulsEachPeriod = $('#cfgResetFouls').checked;
  state.config.manualFouls = $('#cfgFouls').checked;
  state.config.possession = $('#cfgPossession').checked;
  state.config.autoHorn = $('#cfgAutoHorn').checked;
  state.config.timeoutMode = (pendingTimeoutMode === 'fiba') ? 'fiba' : 'baskin';
  if(!state.config.manualFouls){ state.fouls = [0,0]; }   // falli off: azzera i contatori
  if(state.config.bonusMode !== 'teamFouls'){ state.bonusActive = [false,false]; }
  if(!state.config.possession){ state.possession = [false,false]; }
  // ricalibra i timeout gia' segnati sul nuovo monte della fase corrente
  const pool = timeoutPool(state.period);
  state.timeoutsUsed[0] = Math.min(state.timeoutsUsed[0], pool);
  state.timeoutsUsed[1] = Math.min(state.timeoutsUsed[1], pool);
  if(!state.running){ state.remainingMs = periodFullMs(state.period); }
  closeSheet('settingsBackdrop');
  applyFoulMode();
  updateFoulLabel();
  renderAll();
  saveState();
  toast('Impostazioni salvate');
}

/* Applica un preset di disciplina ai campi del form (non salva: serve "Salva") */
function applyPreset(preset){
  // mantiene durata/periodo correnti? no: il preset reimposta tutti i campi di gara
  const merged = { ...state.config, ...preset };
  fillSettingsForm(merged);
  toast(preset.timeoutMode === 'fiba' ? 'Preset Basket FIBA (poi Salva)' : 'Preset Baskin (poi Salva)');
}

/* Reset applicazione: riporta TUTTO ai valori predefiniti (Baskin) */
function resetApp(){
  stopClock();
  state = freshState(DEFAULT_CONFIG);
  pendingTimeoutMode = 'baskin';
  closeSheet('settingsBackdrop');
  applyFoulMode();
  updateFoulLabel();
  renderAll();
  saveState();
  toast('Applicazione azzerata');
}

/* --- toast --- */
let toastTimer = null;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ t.hidden = true; }, 1600);
}

/* =====================================================================
   WAKE LOCK (schermo sempre acceso)
   ===================================================================== */
let wakeLock = null, wakeWanted = wakeWantedInit;
function persistWake(){ try{ localStorage.setItem(STORE_KEY+':wake', wakeWanted?'1':'0'); }catch(e){} }
async function toggleWake(){
  wakeWanted = !wakeWanted;
  persistWake();
  if(wakeWanted) await acquireWake(); else releaseWake();
  $('#wakeState').textContent = wakeWanted ? 'on' : 'off';
}
async function acquireWake(){
  try{
    if('wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', ()=>{});
    }
  }catch(e){ /* spesso richiede un gesto: si riproverà al primo tocco/visibilità */ }
}
function releaseWake(){ if(wakeLock){ wakeLock.release().catch(()=>{}); wakeLock = null; } }
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden'){ saveState(); return; }   // salva quando si va in background
  if(wakeWanted && document.visibilityState === 'visible'){ acquireWake(); }
});
window.addEventListener('pagehide', saveState);
window.addEventListener('beforeunload', saveState);

/* =====================================================================
   INSTALL PROMPT
   ===================================================================== */
let deferredPrompt = null;

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.navigator.standalone === true;
}
function updateInstallButtons(){
  const show = !!deferredPrompt && !isStandalone();
  const a = $('#actInstall');    if(a) a.hidden = !show;
  const b = $('#rotateInstall'); if(b) b.hidden = !show;
}
async function doInstall(){
  if(deferredPrompt){
    deferredPrompt.prompt();
    try{ await deferredPrompt.userChoice; }catch(_){}
    deferredPrompt = null;
    updateInstallButtons();
  } else {
    // browser senza supporto a beforeinstallprompt (es. iOS/Firefox) o gia' installata
    toast('Usa il menu del browser: "Installa app" / "Aggiungi a schermata Home"');
  }
}
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  updateInstallButtons();
});
window.addEventListener('appinstalled', ()=>{
  deferredPrompt = null;
  updateInstallButtons();
  toast('App installata');
});

/* =====================================================================
   VERIFICA AGGIORNAMENTI (PWA)
   Chiede al service worker di ricontrollare i file: se ne trova di nuovi,
   propone il ricaricamento per applicare la versione aggiornata.
   ===================================================================== */
async function checkForUpdates(){
  closeSheet('moreBackdrop');
  if(!('serviceWorker' in navigator)){ toast('Aggiornamenti non disponibili'); return; }
  let reg = null;
  try{ reg = await navigator.serviceWorker.getRegistration(); }catch(e){}
  if(!reg){ toast('Service worker non attivo'); return; }
  toast('Controllo aggiornamenti…');

  // versione già scaricata e in attesa: attivala subito.
  // Il ricaricamento avviene tramite l'evento 'controllerchange' (vedi avvio),
  // che attende anche che il cronometro sia fermo per non interrompere la partita.
  if(reg.waiting){ reg.waiting.postMessage({ type:'SKIP_WAITING' }); return; }

  let found = false;
  reg.addEventListener('updatefound', ()=>{
    found = true;
    const nw = reg.installing;
    if(!nw) return;
    nw.addEventListener('statechange', ()=>{
      if(nw.state === 'installed' && navigator.serviceWorker.controller){
        nw.postMessage({ type:'SKIP_WAITING' });   // attiva -> controllerchange -> reload
      }
    });
  });

  try{ await reg.update(); }catch(e){}
  setTimeout(()=>{ if(!found && !reg.waiting){ toast(`Sei aggiornato (v${APP_VERSION})`); } }, 2000);
}

/* =====================================================================
   EVENTI
   ===================================================================== */
function onActivate(el, handler){
  el.addEventListener('click', handler);
}

/* punti: +1/+2/+3 in gioco, -1/-2/-3 in modifica (data-pts puo' essere negativo) */
document.querySelectorAll('.side-buttons').forEach(group=>{
  const team = parseInt(group.dataset.team,10) - 1;
  group.querySelectorAll('.pts-btn').forEach(btn=>{
    onActivate(btn, ()=>{ ensureAudio(); addPoints(team, parseInt(btn.dataset.pts,10)); });
  });
});

/* timeout: un tocco sulla pillola accende un pallino in piu' (azzera se pieni) */
document.querySelector('.scores').addEventListener('click', (e)=>{
  const pill = e.target.closest('.timeouts');
  if(!pill) return;
  tapTimeout(parseInt(pill.dataset.team,10) - 1);
});

/* falli: + in operativa, - in impostazioni (attivi solo col conteggio falli on) */
document.querySelector('.fouls').addEventListener('click', (e)=>{
  const b = e.target.closest('.foul-btn');
  if(!b) return;
  addFoul(parseInt(b.dataset.team,10), parseInt(b.dataset.delta,10));
});

/* barra superiore */
onActivate($('#btnPlay'), ()=>{ if(body.classList.contains('mode-edit')) return; ensureAudio(); togglePlay(); });
onActivate($('#btnEdit'), enterEdit);
onActivate($('#btnConfirm'), exitEdit);

/* periodo: in modifica apre il selettore a rotore */
function periodTap(){ if(body.classList.contains('mode-edit')) openPeriodEditor(); }
elPeriod.addEventListener('click', periodTap);
elPeriod.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); periodTap(); }});

/* tempo: in modifica apre l'editor */
function timerTap(){ if(body.classList.contains('mode-edit')) openTimeEditor(); }
elTimer.addEventListener('click', timerTap);
elTimer.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); timerTap(); }});

/* nomi: in modifica, toccando la squadra (o il nome) si modifica il nome */
[0,1].forEach(i=>{
  const team = elName[i].closest('.team') || elName[i].parentElement;
  const focusName = ()=>{
    if(!body.classList.contains('mode-edit')) return;
    nameInputs[i].focus();
    nameInputs[i].select();
  };
  elName[i].addEventListener('click', focusName);
  team.addEventListener('click', (e)=>{
    // evita di rubare il focus quando si toccano i tasti -1/-2/-3, i timeout o il campo stesso
    if(e.target.closest('.pts-btn') || e.target.closest('.timeouts') || e.target.closest('.color-row') || e.target === nameInputs[i]) return;
    focusName();
  });
});

/* sirena / fischietto (angolo in basso a destra) */
onActivate($('#btnHorn'), ()=>{ ensureAudio(); horn(); });
onActivate($('#btnWhistle'), ()=>{ ensureAudio(); whistle(); });

function updateMuteLabel(){
  const el = $('#muteState'); if(el) el.textContent = muted ? 'off' : 'on';
}
function toggleMute(){
  muted = !muted;
  body.dataset.muted = muted ? 'true':'false';
  try{ localStorage.setItem(STORE_KEY+':muted', muted?'1':'0'); }catch(e){}
  updateMuteLabel();
  toast(muted ? 'Suono disattivato' : 'Suono attivato');
}

function toggleManualFouls(){
  state.config.manualFouls = !state.config.manualFouls;
  if(!state.config.manualFouls){ state.fouls = [0,0]; }  // spegnendolo azzera i contatori
  updateFoulLabel();
  renderAll();
  saveState();
  toast(state.config.manualFouls ? 'Conteggio falli attivato' : 'Conteggio falli disattivato');
}

function updateScoreColorLabel(){
  const el = $('#scoreColorState'); if(el) el.textContent = state.config.scoreTeamColor ? 'on' : 'off';
}
function toggleScoreColor(){
  state.config.scoreTeamColor = !state.config.scoreTeamColor;
  updateScoreColorLabel();
  applyScoreColors();
  saveState();
  toast(state.config.scoreTeamColor ? 'Punti nel colore squadra' : 'Punti verdi');
}

/* menu "..." (Informazioni + aggiornamenti) */
onActivate($('#btnMore'), ()=>{ updateMuteLabel(); updateFoulLabel(); updateScoreColorLabel(); openSheet('moreBackdrop'); });
onActivate($('#moreClose'), ()=> closeSheet('moreBackdrop'));
onActivate($('#actCheckUpdate'), checkForUpdates);
onActivate($('#actScoreColor'), toggleScoreColor);
onActivate($('#actMute'), toggleMute);
onActivate($('#actSettings'), ()=>{ closeSheet('moreBackdrop'); openSettings(); });
onActivate($('#actResetApp'), ()=>{
  closeSheet('moreBackdrop');
  if(confirm('Reset applicazione: azzera punteggi, falli, timeout, possesso, nomi e riporta le impostazioni ai valori Baskin. Procedere?')) resetApp();
});

/* chiudi l'applicazione (PWA): salva e prova a chiudere la finestra */
onActivate($('#actQuit'), ()=>{
  closeSheet('moreBackdrop');
  if(!confirm('Chiudere l\'applicazione?')) return;
  saveState();
  try{ window.close(); }catch(e){}
  // se il browser blocca la chiusura (es. scheda normale), avvisa
  setTimeout(()=>{ toast('Per uscire chiudi la finestra o la scheda'); }, 300);
});

/* link al repository del codice (apre nel browser) */
{
  const repo = $('#actRepo');
  if(repo){
    repo.href = REPO_URL;
    repo.addEventListener('click', ()=> closeSheet('moreBackdrop'));
  }
}
onActivate($('#actWake'), toggleWake);
onActivate($('#actInstall'), ()=>{ closeSheet('moreBackdrop'); doInstall(); });
onActivate($('#rotateInstall'), doInstall);

/* impostazioni */
onActivate($('#settingsSave'), saveSettings);
onActivate($('#settingsClose'), ()=> closeSheet('settingsBackdrop'));
onActivate($('#presetBaskin'), ()=> applyPreset(PRESET_BASKIN));
onActivate($('#presetBasket'), ()=> applyPreset(PRESET_BASKET_FIBA));

/* frecce possesso */
onActivate($('#possLeft'), ()=> tapPossession('left'));
onActivate($('#possRight'), ()=> tapPossession('right'));

/* editor tempo (rotori) */
onActivate($('#timeApply'), ()=>{ stopClock(); applyTimeEditor(); });
onActivate($('#timeFull'), timeEditorFull);
onActivate($('#timeClose'), ()=> closeSheet('timeBackdrop'));

/* editor periodo (rotore) */
onActivate($('#periodApply'), applyPeriodEditor);
onActivate($('#periodClose'), ()=> closeSheet('periodBackdrop'));

/* reset partita (basso a sinistra, solo in impostazioni) con conferma */
onActivate($('#btnReset'), ()=> openSheet('resetBackdrop'));
onActivate($('#resetConfirm'), ()=>{ closeSheet('resetBackdrop'); resetGame(); });
onActivate($('#resetCancel'), ()=> closeSheet('resetBackdrop'));

/* periodo successivo (accanto al play, a fine tempo) con conferma */
function nextPeriodLabel(){
  const p = state.period + 1;
  return (p > state.config.periods) ? `${p - state.config.periods}° tempo supplementare (${p - state.config.periods}TS)` : `${p}° periodo`;
}
onActivate($('#btnNext'), ()=>{
  const tx = $('#nextText');
  if(tx) tx.textContent = `Si passa al ${nextPeriodLabel()} e il cronometro viene riportato al tempo pieno.`;
  openSheet('nextBackdrop');
});
onActivate($('#nextConfirm'), ()=>{ closeSheet('nextBackdrop'); applyPeriod(state.period + 1, true); });
onActivate($('#nextCancel'), ()=> closeSheet('nextBackdrop'));

/* chiudi i fogli toccando lo sfondo */
document.querySelectorAll('.sheet-backdrop').forEach(bd=>{
  bd.addEventListener('click', (e)=>{ if(e.target === bd) bd.hidden = true; });
});

/* tasto spazio = play/pausa (comodo da tastiera/telecomando) */
document.addEventListener('keydown', (e)=>{
  if(e.code === 'Space' && body.classList.contains('mode-game') && !isTyping(e)){
    e.preventDefault(); ensureAudio(); togglePlay();
  }
});
function isTyping(e){ const t=e.target; return t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'); }

/* =====================================================================
   AVVIO
   ===================================================================== */
renderAll();

/* ripristina le preferenze salvate (schermo sempre acceso) */
{
  const ws = $('#wakeState'); if(ws) ws.textContent = wakeWanted ? 'on' : 'off';
  if(wakeWanted) acquireWake();
}

/* service worker per il funzionamento offline + applicazione affidabile degli aggiornamenti */
if('serviceWorker' in navigator){
  const hadController = !!navigator.serviceWorker.controller;  // false al primissimo install
  let refreshing = false, pendingReload = false;

  function applyUpdateReload(){
    if(refreshing) return;
    // non interrompere una partita in corso: rinvia a cronometro fermo
    if(typeof state !== 'undefined' && state.running){
      pendingReload = true;
      toast('Aggiornamento pronto: si applica a cronometro fermo');
      return;
    }
    refreshing = true;
    location.reload();
  }
  // richiamato da stopClock() quando il cronometro viene fermato
  window.__applyPendingUpdate = ()=>{ if(pendingReload){ pendingReload = false; applyUpdateReload(); } };

  // quando il nuovo service worker prende il controllo, ricarica per servire i file aggiornati
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(!hadController) return;     // al primo install non serve ricaricare
    applyUpdateReload();
  });

  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').then(reg=>{
      // se all'avvio c'è già una versione in attesa, attivala
      if(reg.waiting && navigator.serviceWorker.controller){
        reg.waiting.postMessage({ type:'SKIP_WAITING' });
      }
      // quando arriva una nuova versione, appena installata chiedine l'attivazione
      reg.addEventListener('updatefound', ()=>{
        const nw = reg.installing;
        if(!nw) return;
        nw.addEventListener('statechange', ()=>{
          if(nw.state === 'installed' && navigator.serviceWorker.controller){
            nw.postMessage({ type:'SKIP_WAITING' });
          }
        });
      });
    }).catch(()=>{});
  });
}

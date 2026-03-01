// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
const socket = io();
let myId       = socket.id;
let roomCode   = null;
let isHost     = false;
let gameState  = null;
let startingChips = 500;
let tempHigh = [], tempLow = [];
let pendingJoinName = null; // name stored while showing seat picker

socket.on('connect', () => { myId = socket.id; });

socket.on('roomCreated', ({ code }) => {
  roomCode = code; isHost = true;
  document.getElementById('display-code').textContent = code;
  document.getElementById('header-code').textContent  = code;
  showWaitingRoom(true);
});

socket.on('joinedRoom', ({ code }) => {
  roomCode = code;
  document.getElementById('header-code').textContent = code;
  // If game in progress go straight to table; otherwise waiting room
  if (gameState && gameState.phase !== 'lobby') {
    showScreen('game-screen');
  } else {
    document.getElementById('display-code').textContent = code;
    showWaitingRoom(false);
  }
});

socket.on('seatList', ({ takenSeats, phase }) => {
  renderSeatPicker(takenSeats, phase);
  showScreen('seat-screen');
});

socket.on('error', msg => toast(msg));
socket.on('playerLeft', ({ name }) => toast(`${name} disconnected`));

socket.on('state', state => {
  const justDealt = gameState && gameState.phase === 'bet' && state.phase === 'set';
  gameState = state;
  if (state.phase === 'lobby') {
    renderWaiting(state);
  } else {
    showScreen('game-screen');
    if (justDealt) runGhostDealAnimation(state);
    else renderGame(state);
  }
});

socket.on('houseWaySuggestion', ({ high, low }) => {
  tempHigh = high; tempLow = low;
  renderSetter();
  toast('House Way applied — review and confirm');
});

// ═══════════════════════════════════════════════════
//  LOBBY
// ═══════════════════════════════════════════════════
function switchTab(a, b, el) {
  document.getElementById(a).classList.add('active');
  document.getElementById(b).classList.remove('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}
function selectChips(el, v) {
  startingChips = v;
  document.querySelectorAll('.chip-preset').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
}
function getBP() {
  const g = id => parseInt(document.getElementById(id).value) || 0;
  return { threepair:g('bp-threepair')||2, trips:g('bp-trips')||3, straight:g('bp-straight')||10,
    flush:g('bp-flush')||15, fullhouse:g('bp-fullhouse')||25, quads:g('bp-quads')||50,
    sf:g('bp-sf')||200, royal:g('bp-royal')||8000, sf7joker:g('bp-sf7joker')||1000,
    sf7natural:g('bp-sf7natural')||2000, fiveaces:g('bp-fiveaces')||2000 };
}
function hostGame() {
  const name = document.getElementById('host-name').value.trim();
  if (!name) { toast('Enter your name'); return; }
  socket.emit('createRoom', { name, startingChips, bonusPayouts: getBP() });
}
// Step 1: look up seats before joining
function lookupSeats() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { toast('Enter your name'); return; }
  if (code.length !== 4) { toast('Enter the 4-letter room code'); return; }
  pendingJoinName = name;
  roomCode = code;
  document.getElementById('header-code').textContent = code;
  socket.emit('requestSeats', { code });
}
// Step 2: called when player clicks a seat button
function pickSeat(seatIndex) {
  socket.emit('joinRoom', { code: roomCode, name: pendingJoinName, seatIndex });
}
function startGame() { socket.emit('startGame', { code: roomCode }); }

function showWaitingRoom(host) {
  document.getElementById('main-tabs').style.display    = 'none';
  document.getElementById('host-tab').style.display    = 'none';
  document.getElementById('join-tab').style.display    = 'none';
  document.getElementById('waiting-room').style.display = 'block';
  document.getElementById('host-start-row').style.display = host ? 'flex' : 'none';
  showScreen('lobby-screen');
}
function renderWaiting(state) {
  document.getElementById('waiting-players').innerHTML = state.players.map(p => `
    <div class="waiting-player">
      <span class="waiting-player-name">${esc(p.name)}</span>
      ${p.id===state.players[0].id?'<span class="host-badge">HOST</span>':''}
      ${p.id===myId?'<span class="me-badge">YOU</span>':''}
    </div>`).join('');
}

// ═══════════════════════════════════════════════════
//  SEAT PICKER
// ═══════════════════════════════════════════════════
// 6 arc seat positions — same geometry as game table but normalized 0..1
function getSeatPickerPositions() {
  const positions = [];
  const startDeg = 205, endDeg = 335;
  for (let i = 0; i < 6; i++) {
    const t   = i / 5;
    const deg = startDeg + t * (endDeg - startDeg);
    const rad = deg * Math.PI / 180;
    const rx = 0.42, ry = 0.38; // slightly inward from oval edge
    const x  = 0.50 + rx * Math.cos(rad);
    const y  = 0.50 + ry * Math.sin(rad);
    positions.push({ x, y });
  }
  return positions;
}

function renderSeatPicker(takenSeats, phase) {
  const wrap = document.getElementById('seat-table-wrap');
  const w = wrap.offsetWidth  || 480;
  const h = wrap.offsetHeight || 340;
  // Remove old seat buttons
  wrap.querySelectorAll('.seat-btn').forEach(e => e.remove());

  const positions = getSeatPickerPositions();
  positions.forEach((pos, i) => {
    const seatIndex = i; // 0-5
    const taken = takenSeats.find(s => s.seatIndex === seatIndex);
    const btn = document.createElement('div');
    btn.className = taken
      ? (taken.disconnected ? 'seat-btn taken-dc' : 'seat-btn taken')
      : 'seat-btn available';
    btn.style.left = (w * pos.x) + 'px';
    btn.style.top  = (h * pos.y) + 'px';
    btn.innerHTML = `
      <div class="seat-btn-num">Seat ${i + 1}</div>
      <div class="seat-btn-name">${taken ? esc(taken.name) : ''}</div>
      <div class="seat-btn-status">${taken ? (taken.disconnected ? 'away' : 'taken') : 'open'}</div>`;
    if (!taken) btn.onclick = () => pickSeat(seatIndex);
    wrap.appendChild(btn);
  });

  // Dealer seat label (top center, not selectable)
  const dealerBtn = document.createElement('div');
  dealerBtn.className = 'seat-btn banker-fixed';
  dealerBtn.style.left = (w * 0.50) + 'px';
  dealerBtn.style.top  = (h * 0.14) + 'px';
  dealerBtn.innerHTML = `<div class="seat-btn-num">🎩</div><div class="seat-btn-name">Dealer</div><div class="seat-btn-status" style="color:var(--gold)">host</div>`;
  wrap.appendChild(dealerBtn);

  document.getElementById('seat-screen-sub').textContent =
    phase === 'lobby' ? 'Click an open seat to join' : 'Game in progress — click a seat to join next round';
}

// ═══════════════════════════════════════════════════
//  TABLE GEOMETRY
// ═══════════════════════════════════════════════════
// 6 arc positions around bottom of oval, pulled inward so all seats visible
function getArcPositions() {
  const positions = [];
  const startDeg = 210, endDeg = 330;
  for (let i = 0; i < 6; i++) {
    const t   = i / 5;
    const deg = startDeg + t * (endDeg - startDeg);
    const rad = deg * Math.PI / 180;
    // Inward radii — well inside oval boundary
    const rx = 0.36, ry = 0.34;
    const x  = 0.50 + rx * Math.cos(rad); // fraction of table width
    const y  = 0.50 + ry * Math.sin(rad); // fraction of table height
    positions.push({ x, y, deg });
  }
  return positions;
}

// ═══════════════════════════════════════════════════
//  GHOST DEAL ANIMATION
// ═══════════════════════════════════════════════════
function runGhostDealAnimation(state) {
  renderGame(state);
  const tableEl = document.getElementById('casino-table');
  const tw = tableEl.offsetWidth, th = tableEl.offsetHeight;
  const arcPos = getArcPositions();

  // Find which arc slots have no real player (by seatIndex)
  const ghostSlots = [];
  for (let slot = 0; slot < 6; slot++) {
    const hasPlayer = state.players.some(p => p.seatIndex === slot && !p.disconnected);
    if (!hasPlayer) ghostSlots.push(slot);
  }
  if (ghostSlots.length === 0) return;

  const ghostContainer = document.createElement('div');
  ghostContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20';
  tableEl.appendChild(ghostContainer);

  const dealNum = state.dealOrderNum || 1;
  // Build deal order for all 7 slots (0=banker, 1-6=arc slots)
  const order = [];
  for (let s = 0; s < 7; s++) order.push((dealNum - 1 + s) % 7);

  const ghostEls = [];
  let step = 0;

  function dealNext() {
    if (step >= 7) { setTimeout(collectGhosts, 1100); return; }
    const slotIdx = order[step] - 1; // -1 because slot 0 = banker (arc slots are 0-5 = order slots 1-6)
    if (slotIdx >= 0 && ghostSlots.includes(slotIdx)) {
      const pos = arcPos[slotIdx];
      const px = tw * pos.x, py = th * pos.y;
      for (let c = 0; c < 7; c++) {
        const el = document.createElement('div');
        el.className = 'card ghost-card dealing';
        el.style.cssText = `position:absolute;left:${px-8}px;top:${py-12+c*2}px;animation-delay:${c*25}ms`;
        ghostContainer.appendChild(el);
        ghostEls.push(el);
      }
    }
    step++;
    setTimeout(dealNext, 130);
  }

  function collectGhosts() {
    ghostEls.forEach((el, i) => {
      el.style.animation = `collect-out .35s ease forwards`;
      el.style.animationDelay = `${i * 12}ms`;
    });
    setTimeout(() => { ghostContainer.remove(); renderGame(state); }, 700);
  }

  setTimeout(dealNext, 200);
}

// ═══════════════════════════════════════════════════
//  MAIN RENDER
// ═══════════════════════════════════════════════════
function renderGame(state) {
  document.getElementById('ace-push-banner').style.display =
    (state.phase === 'done' && state.bankerAceHighPush) ? 'block' : 'none';

  // Banker spot + deal puck in dealer row
  const banker  = state.players[state.bankerIdx];
  const puckHTML = (state.dealOrderNum && state.phase !== 'bet')
    ? `<div class="deal-puck">
        <div class="deal-puck-inner">
          <div class="deal-puck-num">${state.dealOrderNum}</div>
          <div class="deal-puck-lbl">Deal</div>
        </div>
      </div>` : '';
  document.getElementById('dealer-row').innerHTML =
    puckHTML + renderSpotHTML(banker, state.bankerIdx, state);

  renderArcSpots(state);
  renderControls(state);
  updatePhaseBadge(state.phase);
}

function renderArcSpots(state) {
  const container = document.getElementById('player-spots');
  const tableEl   = document.getElementById('casino-table');
  const tw = tableEl.offsetWidth  || 600;
  const th = tableEl.offsetHeight || 400;
  const arcPos = getArcPositions();
  const spotW  = 170;

  let html = '';
  for (let slot = 0; slot < 6; slot++) {
    const pos = arcPos[slot];
    const px  = tw * pos.x;
    const py  = th * pos.y;

    // Alignment: left side hang left, right side hang right, center hang center
    let ox;
    if (pos.x < 0.36)      ox = -spotW;
    else if (pos.x > 0.64) ox = 0;
    else                    ox = -spotW / 2;
    const oy = -36;

    const style = `position:absolute;left:${px}px;top:${py}px;transform:translate(${ox}px,${oy}px)`;

    // Find player in this seat
    const p = state.players.find(p => p.seatIndex === slot && !p.disconnected);
    const dcP = state.players.find(p => p.seatIndex === slot && p.disconnected);

    if (p) {
      const idx = state.players.indexOf(p);
      html += `<div class="spot-anchor" style="${style}">${renderSpotHTML(p, idx, state)}</div>`;
    } else if (dcP) {
      // Disconnected player holding seat
      html += `<div class="spot-anchor" style="${style}">
        <div class="table-spot dc ghost">
          <div class="spot-header">
            <div class="spot-name">${esc(dcP.name)}</div>
            <span class="dc-badge">Away</span>
          </div>
          <div class="not-playing">Reconnecting…</div>
        </div>
      </div>`;
    } else {
      // Empty ghost seat
      html += `<div class="spot-anchor" style="${style}">
        <div class="table-spot ghost">
          <div style="font-family:'Cinzel',serif;font-size:7px;letter-spacing:1px;
            color:rgba(201,168,76,.18);text-align:center;padding:3px 0">Seat ${slot + 1}</div>
          <div class="card-zones" style="justify-content:center">
            <div class="card-zone">
              <div class="card-zone-lbl">High</div>
              <div class="card-zone-slots">${Array(5).fill('<div class="card-slot" style="opacity:.25"></div>').join('')}</div>
            </div>
            <div class="card-zone">
              <div class="card-zone-lbl">Low</div>
              <div class="card-zone-slots">${Array(2).fill('<div class="card-slot bonus-slot" style="opacity:.25"></div>').join('')}</div>
            </div>
          </div>
        </div>
      </div>`;
    }
  }
  container.innerHTML = html;
}

// ── SPOT HTML ────────────────────────────────
function renderSpotHTML(p, idx, state) {
  const isMe    = p.id === myId;
  const isBanker = idx === state.bankerIdx;
  const isDone  = state.phase === 'done';

  let cls = 'table-spot';
  if (isMe)    cls += ' is-me';
  if (isBanker) cls += ' is-banker';
  if (p.folded && !p.lateJoiner) cls += ' folded';
  if (p.disconnected) cls += ' dc';
  if (isDone && p.result === 'win')  cls += ' winner';
  if (isDone && p.result === 'lose') cls += ' loser';
  if (isDone && p.result === 'push') cls += ' push-res';
  if (isDone && p.revealed && state.revealStep > 0) cls += ' being-revealed';

  let rtHTML = '';
  if (isDone && p.result && !isBanker) {
    const lbl = p.result==='win'?'WIN':p.result==='lose'?'LOSE':'PUSH';
    const rc  = p.result==='win'?'rtag-win':p.result==='lose'?'rtag-lose':
                state.bankerAceHighPush?'rtag-acepush':'rtag-push';
    const nc  = p.netChips>0?'nc-pos':p.netChips<0?'nc-neg':'nc-zero';
    rtHTML = `<span class="rtag ${rc}">${lbl}</span><span class="net-chip ${nc}">${p.netChips>0?'+':''}${p.netChips}</span>`;
  }
  if (isDone && p.folded) rtHTML = `<span class="rtag rtag-fold">FOLDED</span>`;

  const namePart = isMe ? `${esc(p.name)} <span class="me-badge">YOU</span>` : esc(p.name);
  const buyinBtn = isMe && state.phase==='bet' && !isBanker
    ? `<button class="buyin-btn" onclick="openBuyIn()">+</button>` : '';
  const lateTag = p.lateJoiner ? `<span class="late-badge">Next round</span>` : '';

  return `<div class="${cls}">
    <div class="spot-header">
      <div class="spot-name">${namePart}</div>
      ${isBanker?'<span class="banker-chip">BANKER</span>':''}
      ${lateTag}${rtHTML}
      <div class="chips-disp">💰<span class="amt">${p.chips}</span></div>
      ${buyinBtn}
    </div>
    ${renderSpotBody(p, idx, state, isMe, isBanker)}
  </div>`;
}

function renderSpotBody(p, idx, state, isMe, isBanker) {
  const isDone = state.phase === 'done';

  if (p.lateJoiner && !isBanker)
    return `<div class="not-playing">Joining next round</div>`;

  if (state.phase === 'bet') {
    if (isBanker) return `<div class="not-playing">Covering all bets</div>`;
    if (p.folded) return `<div class="not-playing">Folded</div>`;
    return renderBetCircles(p) + (isMe ? renderBetUI(p) : `<div class="not-playing">${p.bet>0?`Bet:${p.bet}`:'—'}</div>`);
  }

  if (state.phase === 'set') {
    if (p.folded || (p.bet===0 && !isBanker)) return `<div class="not-playing">Not playing</div>`;
    const zones  = renderCardZones(p, state, isMe, isBanker);
    const setBtn = (isMe && !p.handSet)
      ? `<button class="btn btn-primary btn-sm" style="margin-top:2px;font-size:8px;padding:3px 7px" onclick="openSetter()">Set Hand</button>` : '';
    const status = p.handSet ? `<div class="set-status">✓ Hand set</div>` : '';
    return renderBetCircles(p) + zones + setBtn + status;
  }

  if (isDone) {
    if (p.folded || (p.bet===0 && !isBanker)) return `<div class="not-playing">Not playing</div>`;
    const bonus = (p.bonusBet>0 && p.revealed && !isBanker)
      ? `<div class="bonus-row" style="margin-top:2px">
          <span class="bonus-row-lbl">🎰</span>
          <span class="brtag ${p.bonusWon?'brtag-win':'brtag-lose'}">${p.bonusLabel||'—'}</span>
          ${p.bonusNet!=null?`<span class="net-chip ${p.bonusNet>0?'nc-pos':'nc-neg'}" style="font-size:8px">${p.bonusNet>0?'+':''}${p.bonusNet}</span>`:''}
        </div>` : '';
    return renderBetCircles(p) + renderCardZones(p, state, isMe, isBanker) + bonus;
  }
  return '';
}

// ── BET CIRCLES ─────────────────────────────
function renderBetCircles(p) {
  const hasBet = p.bet > 0, hasBonus = p.bonusBet > 0;
  const chipCls = p.bet>=500?'vhi':p.bet>=100?'hi':'';
  const mainChip = hasBet
    ? `<div class="circle-chip circle-chip-main ${chipCls}"><span class="circle-chip-amount">${fmtChip(p.bet)}</span></div>` : '';
  const bonusChip = hasBonus
    ? `<div class="circle-chip circle-chip-bonus"><span class="circle-chip-amount">${fmtChip(p.bonusBet)}</span></div>` : '';
  return `<div class="bet-circles-row">
    <div class="bet-circle-wrap">
      <div class="bet-circle bet-circle-main ${hasBet?'has-bet':''}">${mainChip}</div>
      <div class="bet-circle-lbl">Main</div>
    </div>
    <div class="bet-circle-wrap">
      <div class="bet-circle bet-circle-bonus ${hasBonus?'has-bet':''}">${bonusChip}</div>
      <div class="bet-circle-lbl">Bonus</div>
    </div>
  </div>`;
}

// ── CARD ZONES ──────────────────────────────
function renderCardZones(p, state, isMe, isBanker) {
  const isDone   = state.phase === 'done';
  const showFace = isMe || isBanker;
  const hasCards = p.hand && p.hand.length > 0;

  if (!hasCards) return emptyZones();

  if (state.phase === 'set') {
    const hi = p.highHand.length > 0 ? p.highHand : p.hand;
    const lo = p.lowHand.length  > 0 ? p.lowHand  : [];
    const hiLbl = p.handSet ? `Hi(${evalFiveClient(p.highHand)})` : 'High';
    const loLbl = p.handSet && lo.length===2 ? `Lo(${evalTwoClient(p.lowHand)})` : 'Low';
    const hiSlots = Math.max(0, 5 - hi.length);
    const loSlots = Math.max(0, 2 - lo.length);
    return `<div class="card-zones">
      <div class="card-zone">
        <div class="card-zone-lbl">${hiLbl}</div>
        <div class="card-zone-slots">
          ${hi.map(c=>cHTML(c,showFace,' dealing')).join('')}
          ${Array(hiSlots).fill('<div class="card-slot"></div>').join('')}
        </div>
      </div>
      <div class="card-zone">
        <div class="card-zone-lbl">${loLbl}</div>
        <div class="card-zone-slots">
          ${lo.map(c=>cHTML(c,showFace,'')).join('')}
          ${Array(loSlots).fill('<div class="card-slot bonus-slot"></div>').join('')}
        </div>
      </div>
    </div>`;
  }

  if (isDone) {
    if (!p.revealed) return `<div class="card-zones">
      <div class="card-zone"><div class="card-zone-lbl">High</div>
        <div class="card-zone-slots">${Array(5).fill('<div class="card back"></div>').join('')}</div>
      </div>
      <div class="card-zone"><div class="card-zone-lbl">Low</div>
        <div class="card-zone-slots">${Array(2).fill('<div class="card back"></div>').join('')}</div>
      </div>
    </div>`;
    return `<div class="card-zones">
      <div class="card-zone"><div class="card-zone-lbl">Hi(${evalFiveClient(p.highHand)})</div>
        <div class="card-zone-slots">${p.highHand.map(c=>cHTML(c,true,'')).join('')}</div>
      </div>
      <div class="card-zone"><div class="card-zone-lbl">Lo(${evalTwoClient(p.lowHand)})</div>
        <div class="card-zone-slots">${p.lowHand.map(c=>cHTML(c,true,'')).join('')}</div>
      </div>
    </div>`;
  }
  return emptyZones();
}

function emptyZones() {
  return `<div class="card-zones">
    <div class="card-zone"><div class="card-zone-lbl">High</div>
      <div class="card-zone-slots">${Array(5).fill('<div class="card-slot"></div>').join('')}</div>
    </div>
    <div class="card-zone"><div class="card-zone-lbl">Low</div>
      <div class="card-zone-slots">${Array(2).fill('<div class="card-slot bonus-slot"></div>').join('')}</div>
    </div>
  </div>`;
}

function cHTML(card, showFace, extraCls='') {
  if (!card || card.hidden || !showFace) return `<div class="card back${extraCls}"></div>`;
  if (card.isJoker) return `<div class="card joker${extraCls}"><div class="card-rank">★</div><div class="card-suit" style="font-size:4px">JKR</div></div>`;
  const col = (card.suit==='♥'||card.suit==='♦')?'red':'black';
  return `<div class="card ${col}${extraCls}"><div class="card-rank">${card.rank}</div><div class="card-suit">${card.suit}</div></div>`;
}

function fmtChip(n) {
  return n >= 1000 ? (n/1000).toFixed(n%1000===0?0:1)+'k' : String(n);
}

// ── INLINE BET UI ────────────────────────────
function renderBetUI(p) {
  const avail  = p.chips - p.bonusBet;
  const availB = p.chips - p.bet - p.bonusBet;
  const chipBtns = (max, fn) => [1,5,25,100,500].filter(v => max >= v).map(v =>
    `<div class="chip chip-${v}" onclick="${fn}(${v})">${v}</div>`).join('');
  return `<div class="bet-ui">
    <div class="bet-row">
      <div class="bet-lbl">Bet:<span class="val">${p.bet}</span></div>
      <div class="chip-stack">${chipBtns(avail,'placeBet')}</div>
      ${p.bet>0?`<button class="clear-btn" onclick="clearBet()">✕</button>`:''}
      <button class="btn btn-sm" style="font-size:8px;padding:2px 6px" onclick="doFold()">${p.folded?'Unfold':'Fold'}</button>
    </div>
    <div class="bonus-row">
      <span class="bonus-row-lbl">🎰</span>
      <div class="bet-lbl"><span class="val" style="color:#e0a8ff">${p.bonusBet}</span></div>
      <div class="chip-stack">${chipBtns(availB,'placeBonusBet')}</div>
      ${p.bonusBet>0?`<button class="clear-btn" onclick="clearBonusBet()">✕</button>`:''}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════
//  PHASE CONTROLS
// ═══════════════════════════════════════════════════
function renderControls(state) {
  const prompt = document.getElementById('phase-prompt');
  const btns   = document.getElementById('phase-buttons');
  btns.innerHTML = '';
  const myPlayer = state.players.find(p => p.id === myId);

  if (state.phase === 'bet') {
    prompt.textContent = 'Place bets · Host deals when ready';
    if (isHost) {
      addBtn(btns,'🔄 Rotate Banker','btn',()=>socket.emit('rotateBanker',{code:roomCode}));
      addBtn(btns,'Deal Cards','btn btn-primary',()=>socket.emit('deal',{code:roomCode}));
    }
  } else if (state.phase === 'set') {
    const active = state.players.filter((p,i)=>i===state.bankerIdx?p.hand.length>0:!p.folded&&p.bet>0);
    const ready  = active.filter(p=>p.handSet).length;
    prompt.textContent = `Setting hands… ${ready}/${active.length} ready · Banker visible to all`;
    if (myPlayer && myPlayer.hand.length>0 && !myPlayer.handSet)
      addBtn(btns,'Set My Hand','btn btn-primary',openSetter);
    if (isHost)
      addBtn(btns,'Force Reveal','btn btn-danger',()=>socket.emit('reveal',{code:roomCode}));
  } else if (state.phase === 'done') {
    const activePlayers = state.players.filter((p,i)=>i!==state.bankerIdx&&p.hand.length>0&&!p.folded);
    const allRevealed   = activePlayers.every(p=>p.revealed);
    if (!allRevealed) {
      const next = activePlayers.find(p=>!p.revealed);
      prompt.textContent = 'Banker revealed · Flip each player';
      if (isHost)
        addBtn(btns,`▶ Reveal ${next?next.name:''}`,
          'btn btn-reveal',()=>socket.emit('advanceReveal',{code:roomCode}));
    } else {
      prompt.textContent = 'Round complete!';
      if (isHost)
        addBtn(btns,'Next Round','btn btn-primary',()=>socket.emit('nextRound',{code:roomCode}));
    }
  }
}

function addBtn(c, lbl, cls, fn) {
  const b = document.createElement('button');
  b.className=cls; b.textContent=lbl; b.onclick=fn; c.appendChild(b);
}
function updatePhaseBadge(phase) {
  const el = document.getElementById('phase-badge');
  const map = {bet:'Betting',set:'Setting Hands',done:'Showdown',lobby:'Lobby'};
  const cls = {bet:'phase-bet',set:'phase-set',done:'phase-done',lobby:'phase-lobby'};
  el.textContent = map[phase]||phase;
  el.className   = `phase-badge ${cls[phase]||'phase-lobby'}`;
}

// ═══════════════════════════════════════════════════
//  BET ACTIONS
// ═══════════════════════════════════════════════════
function placeBet(a)      { socket.emit('placeBet',      {code:roomCode,amount:a}); }
function clearBet()       { socket.emit('clearBet',      {code:roomCode}); }
function placeBonusBet(a) { socket.emit('placeBonusBet', {code:roomCode,amount:a}); }
function clearBonusBet()  { socket.emit('clearBonusBet', {code:roomCode}); }
function doFold() {
  const me = gameState.players.find(p=>p.id===myId);
  socket.emit(me&&me.folded?'unfold':'fold',{code:roomCode});
}

// ═══════════════════════════════════════════════════
//  HAND SETTER
// ═══════════════════════════════════════════════════
function openSetter() {
  const me = gameState.players.find(p=>p.id===myId);
  if (!me||me.hand.length===0) return;
  tempHigh = [...me.hand]; tempLow = [];
  document.getElementById('setter-title').textContent = `${me.name}'s Hand`;
  document.getElementById('setter-sub').textContent =
    `${me.chips} chips · bet: ${me.bet}${me.bonusBet>0?` + bonus ${me.bonusBet}`:''}`;
  document.getElementById('hand-setter').classList.add('open');
  renderSetter();
}
function closeSetter() { document.getElementById('hand-setter').classList.remove('open'); }
function renderSetter() {
  const rem = 2 - tempLow.length;
  document.getElementById('target-ind').textContent =
    tempLow.length===2 ? '✓ Ready to confirm'
    : `▶ Tap a High Hand card to move to Low Hand (${rem} more needed)`;
  document.getElementById('high-hand-cards').innerHTML =
    tempHigh.map((c,i)=>`<div onclick="moveToLow(${i})">${setterCard(c)}</div>`).join('') +
    (tempHigh.length<5?`<span style="font-size:9px;color:rgba(245,237,216,.2);align-self:center">&nbsp;${5-tempHigh.length} slot${5-tempHigh.length!==1?'s':''}</span>`:'');
  document.getElementById('low-hand-cards').innerHTML =
    tempLow.map((c,i)=>`<div onclick="moveToHigh(${i})">${setterCard(c)}</div>`).join('') +
    (tempLow.length<2?`<span style="font-size:9px;color:rgba(245,237,216,.2);align-self:center">&nbsp;${2-tempLow.length} needed</span>`:'');
  document.getElementById('high-hand-rank').textContent =
    tempHigh.length===5 ? evalFiveClient(tempHigh)
    : tempHigh.length>5 ? `${tempHigh.length} cards — move ${tempHigh.length-5} to Low` : '';
  document.getElementById('low-hand-rank').textContent =
    tempLow.length===2 ? evalTwoClient(tempLow) : '';
  document.getElementById('high-hand-box').classList.toggle('active-target', tempLow.length<2);
  document.getElementById('low-hand-box').classList.toggle('active-target',  tempLow.length===2);
}
function moveToLow(i) {
  if (tempLow.length>=2) { toast('Low hand full — tap a Low card to swap it back'); return; }
  tempLow.push(tempHigh.splice(i,1)[0]); renderSetter();
}
function moveToHigh(i) { tempHigh.push(tempLow.splice(i,1)[0]); renderSetter(); }
function setterCard(card) {
  if (card.isJoker) return `<div class="card card-lg joker" style="cursor:pointer"><div class="card-rank">★</div><div class="card-suit" style="font-size:9px">JKR</div></div>`;
  const col = (card.suit==='♥'||card.suit==='♦')?'red':'black';
  return `<div class="card card-lg ${col}" style="cursor:pointer"><div class="card-rank">${card.rank}</div><div class="card-suit">${card.suit}</div></div>`;
}
function requestHouseWay() { socket.emit('houseWay',{code:roomCode}); }
function confirmHand() {
  if (tempHigh.length!==5||tempLow.length!==2) {
    toast(`Need 5 High + 2 Low (have ${tempHigh.length}+${tempLow.length})`); return;
  }
  socket.emit('setHand',{code:roomCode,highHand:tempHigh,lowHand:tempLow});
  closeSetter();
}

// ═══════════════════════════════════════════════════
//  BUY-IN
// ═══════════════════════════════════════════════════
function openBuyIn() {
  const me = gameState.players.find(p=>p.id===myId);
  document.getElementById('buyin-sub').textContent=`${me.name} · ${me.chips} chips`;
  document.getElementById('buyin-custom').value='';
  document.getElementById('buyin-modal').classList.add('open');
}
function closeBuyIn() { document.getElementById('buyin-modal').classList.remove('open'); }
function doBuyIn(a) { socket.emit('buyIn',{code:roomCode,amount:a}); toast(`+${a} chips`); closeBuyIn(); }
function doBuyInCustom() {
  const v=parseInt(document.getElementById('buyin-custom').value);
  if(!v||v<1){toast('Enter a valid amount');return;}
  doBuyIn(v);
}

// ═══════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════
function showStats() {
  if (!gameState) return;
  const sbh = gameState.sessionBestHand;
  const hb  = gameState.houseBonus||{collected:0,paid:0,rounds:0};
  const hn  = hb.collected - hb.paid;
  const bestHTML = sbh
    ? `<div class="best-hand-block">
        <div class="best-hand-crown">🏆</div>
        <div class="best-hand-label">Session Best High Hand</div>
        <div class="best-hand-name">${esc(sbh.handName)}</div>
        <div class="best-hand-who">held by <span>${esc(sbh.playerName)}</span>${sbh.isBanker?' <span style="font-size:10px;opacity:.5">(as Banker)</span>':''}</div>
        <div class="best-hand-round">Round ${sbh.round}</div>
      </div>`
    : `<div class="best-hand-block">
        <div class="best-hand-crown" style="opacity:.3">🏆</div>
        <div class="best-hand-label">Session Best High Hand</div>
        <div class="best-hand-empty">No hands played yet</div>
      </div>`;
  const houseHTML=`<div class="stat-card house-block">
    <div class="stat-player">🎰 House Bonus Ledger</div>
    <div class="house-nums">
      <div class="house-num"><div class="house-num-lbl">Collected</div><div class="house-num-val" style="color:#5dde8a">+${hb.collected}</div></div>
      <div class="house-num"><div class="house-num-lbl">Paid Out</div><div class="house-num-val" style="color:#f08080">-${hb.paid}</div></div>
      <div class="house-num"><div class="house-num-lbl">Net</div><div class="house-num-val ${hn>=0?'nc-pos':'nc-neg'}">${hn>=0?`+${hn}`:hn}</div></div>
    </div>
  </div>`;
  const playerHTML = gameState.players.map(p=>{
    const s=p.stats,net=s.netChips,nc=net>0?'nc-pos':net<0?'nc-neg':'';
    return `<div class="stat-card">
      <div class="stat-player">${esc(p.name)}${p.id===myId?' (You)':''}</div>
      <div class="stat-row"><span>Chips</span><span class="val">${p.chips}</span></div>
      <div class="stat-row"><span>Net</span><span class="val ${nc}">${net>0?`+${net}`:net}</span></div>
      <div class="stat-row"><span>Wins</span><span class="val" style="color:#5dde8a">${s.wins}</span></div>
      <div class="stat-row"><span>Losses</span><span class="val" style="color:#f08080">${s.losses}</span></div>
      <div class="stat-row"><span>Pushes</span><span class="val">${s.pushes}</span></div>
      <div class="stat-row"><span>Rounds</span><span class="val">${s.rounds}</span></div>
      ${s.buyins?`<div class="stat-row"><span>Re-bought</span><span class="val" style="opacity:.5">+${s.buyins}</span></div>`:''}
    </div>`;
  }).join('');
  document.getElementById('stats-content').innerHTML =
    bestHTML + `<div class="stats-grid">${houseHTML}${playerHTML}</div>`;
  document.getElementById('stats-panel').classList.add('open');
}
function hideStats() { document.getElementById('stats-panel').classList.remove('open'); }

// ═══════════════════════════════════════════════════
//  HAND EVALUATION
// ═══════════════════════════════════════════════════
const RV={2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13,A:14};
function evalFiveClient(cards) {
  if (!cards||cards.length!==5||cards.some(c=>!c||c.hidden)) return '?';
  if (cards.some(c=>c.isJoker)) {
    const o=cards.filter(c=>!c.isJoker); let best={rank:-1,name:''};
    for(const s of['♠','♥','♦','♣'])for(const r of['2','3','4','5','6','7','8','9','10','J','Q','K','A']){
      const v=evalNJ([...o,{rank:r,suit:s}]);if(v.rank>best.rank)best=v;
    }
    return best.name;
  }
  return evalNJ(cards).name;
}
function evalNJ(cards) {
  const rv=cards.map(c=>RV[c.rank]).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.suit);
  const cnt={};rv.forEach(v=>cnt[v]=(cnt[v]||0)+1);
  const freq=Object.values(cnt).sort((a,b)=>b-a);
  const fl=suits.every(s=>s===suits[0]);
  const uv=[...new Set(rv)];
  const st=uv.length===5&&(uv[0]-uv[4]===4||JSON.stringify(uv)==='[14,5,4,3,2]');
  if(fl&&st)return{rank:8,name:rv[0]===14?'Royal Flush':'Straight Flush'};
  if(freq[0]===4)return{rank:7,name:'Four of a Kind'};
  if(freq[0]===3&&freq[1]===2)return{rank:6,name:'Full House'};
  if(fl)return{rank:5,name:'Flush'};
  if(st)return{rank:4,name:'Straight'};
  if(freq[0]===3)return{rank:3,name:'Three of a Kind'};
  if(freq[0]===2&&freq[1]===2)return{rank:2,name:'Two Pair'};
  if(freq[0]===2)return{rank:1,name:'One Pair'};
  return{rank:0,name:'High Card'};
}
function evalTwoClient(cards) {
  if(!cards||cards.length!==2||cards.some(c=>!c||c.hidden))return'?';
  const rv=cards.map(c=>c.isJoker?14:RV[c.rank]).sort((a,b)=>b-a);
  return rv[0]===rv[1]?'Pair':'High Card';
}

// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function toast(msg, dur=2800) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),dur);
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
document.getElementById('join-code').addEventListener('input', function(){this.value=this.value.toUpperCase();});
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (gameState && gameState.phase !== 'lobby') renderGame(gameState); }, 150);
});

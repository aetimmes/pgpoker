const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── ROOMS ───────────────────────────────────────────────────────────────────
const rooms = {}; // roomCode -> gameState

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── DECK ────────────────────────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13,A:14};

function buildDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ rank, suit, isJoker: false });
  deck.push({ rank: 'Joker', suit: '', isJoker: true });
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─── HAND EVALUATION ─────────────────────────────────────────────────────────
function evalFiveHand(cards) {
  if (!cards || cards.length !== 5) return { rank: -1, name: 'Incomplete', tiebreak: [] };
  if (cards.some(c => c.isJoker)) return tryJokerFive(cards);
  return evalFiveNoJoker(cards);
}

function tryJokerFive(cards) {
  const others = cards.filter(c => !c.isJoker);
  let best = { rank: -1, name: '', tiebreak: [] };
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const test = [...others, { rank, suit, isJoker: false }];
      const r = evalFiveNoJoker(test);
      if (compareFive(r, best) > 0) best = r;
    }
  }
  return best;
}

function evalFiveNoJoker(cards) {
  const rv = cards.map(c => RANK_VAL[c.rank]);
  const suits = cards.map(c => c.suit);
  rv.sort((a, b) => b - a);
  const counts = {};
  rv.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const freq = Object.values(counts).sort((a, b) => b - a);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(rv);
  if (isFlush && isStraight) return { rank: 8, name: 'Straight Flush', tiebreak: rv, isRoyal: rv[0] === 14 };
  if (freq[0] === 4) return { rank: 7, name: 'Four of a Kind', tiebreak: sortByFreq(rv, counts) };
  if (freq[0] === 3 && freq[1] === 2) return { rank: 6, name: 'Full House', tiebreak: sortByFreq(rv, counts) };
  if (isFlush) return { rank: 5, name: 'Flush', tiebreak: rv };
  if (isStraight) return { rank: 4, name: 'Straight', tiebreak: rv };
  if (freq[0] === 3) return { rank: 3, name: 'Three of a Kind', tiebreak: sortByFreq(rv, counts) };
  if (freq[0] === 2 && freq[1] === 2) return { rank: 2, name: 'Two Pair', tiebreak: sortByFreq(rv, counts) };
  if (freq[0] === 2) return { rank: 1, name: 'One Pair', tiebreak: sortByFreq(rv, counts) };
  return { rank: 0, name: 'High Card', tiebreak: rv };
}

function checkStraight(sortedVals) {
  const v = [...new Set(sortedVals)];
  if (v.length !== 5) return false;
  if (v[0] - v[4] === 4) return true;
  if (JSON.stringify(v) === '[14,5,4,3,2]') return true;
  return false;
}

function sortByFreq(vals, counts) {
  const res = [];
  const byCount = {};
  vals.forEach(v => { const c = counts[v] || 0; byCount[c] = byCount[c] || []; if (!byCount[c].includes(v)) byCount[c].push(v); });
  [4, 3, 2, 1].forEach(c => { if (byCount[c]) byCount[c].sort((a, b) => b - a).forEach(v => { for (let i = 0; i < c; i++) res.push(v); }); });
  return res;
}

function compareFive(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.tiebreak.length, b.tiebreak.length); i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
  }
  return 0;
}

function evalTwoHand(cards) {
  if (!cards || cards.length !== 2) return { rank: -1, name: 'Incomplete', tiebreak: [] };
  if (cards.some(c => c.isJoker)) {
    const other = cards.find(c => !c.isJoker);
    return evalTwoNoJoker([{ rank: 'A', suit: '♠', isJoker: false }, other]);
  }
  return evalTwoNoJoker(cards);
}

function evalTwoNoJoker(cards) {
  const rv = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
  return rv[0] === rv[1]
    ? { rank: 1, name: 'Pair', tiebreak: rv }
    : { rank: 0, name: 'High Card', tiebreak: rv };
}

function compareTwo(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < a.tiebreak.length; i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
  }
  return 0;
}

// ─── HOUSE WAY ───────────────────────────────────────────────────────────────
function applyHouseWay(cards) {
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
    const low = [cards[i], cards[j]];
    const high = cards.filter((_, k) => k !== i && k !== j);
    const twoEv = evalTwoHand(low);
    const fiveEv = evalFiveHand(high);
    const score = fiveEv.rank * 1000 + twoEv.rank * 10;
    if (score > bestScore) { bestScore = score; best = { high, low }; }
  }
  return best || { high: cards.slice(0, 5), low: cards.slice(5, 7) };
}

// ─── BONUS EVALUATION ────────────────────────────────────────────────────────
function hasFiveAces(cards) {
  if (!cards.some(c => c.isJoker)) return false;
  return cards.filter(c => !c.isJoker && c.rank === 'A').length === 4;
}

function sevenCardSFType(cards) {
  const hasJoker = cards.some(c => c.isJoker);
  if (!hasJoker) {
    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return null;
    const vals = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => a - b);
    const isConsec = vals[6] - vals[0] === 6 && new Set(vals).size === 7;
    const isWheel = JSON.stringify(vals) === '[2,3,4,5,6,7,14]';
    return (isConsec || isWheel) ? 'natural' : null;
  } else {
    const naturals = cards.filter(c => !c.isJoker);
    const suit = naturals[0].suit;
    if (!naturals.every(c => c.suit === suit)) return null;
    const vals = naturals.map(c => RANK_VAL[c.rank]).sort((a, b) => a - b);
    if (new Set(vals).size !== 6) return null;
    for (let low = 1; low <= 8; low++) {
      const window = [low,low+1,low+2,low+3,low+4,low+5,low+6].map(v => v === 1 ? 14 : v);
      if (window.filter(v => !vals.includes(v)).length === 1) return 'joker';
    }
    const wheelMissing = [2,3,4,5,6,7,14].filter(v => !vals.includes(v));
    if (wheelMissing.length === 1) return 'joker';
    return null;
  }
}

function hasThreePairs(cards) {
  const hasJoker = cards.some(c => c.isJoker);
  const naturals = cards.filter(c => !c.isJoker);
  const counts = {};
  naturals.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);

  if (hasJoker) {
    const aceCount = counts['A'] || 0;
    if (aceCount < 1) return false;
    const remaining = { ...counts };
    remaining['A'] -= 1;
    if (remaining['A'] === 0) delete remaining['A'];
    const remVals = Object.values(remaining);
    return remVals.filter(v => v >= 2).length === 2 && remVals.filter(v => v === 1).length === 1;
  }
  const pairRanks = Object.keys(counts).filter(r => counts[r] >= 2);
  if (pairRanks.length !== 3) return false;
  return !pairRanks.some(r => counts[r] >= 3);
}

function evalSevenCardBonus(cards) {
  const sfType = sevenCardSFType(cards);
  if (sfType === 'natural') return { bonusType: 'sf7natural' };
  if (sfType === 'joker')   return { bonusType: 'sf7joker' };
  if (hasFiveAces(cards))   return { bonusType: 'fiveaces' };

  let best = { rank: -1, name: '', tiebreak: [], isRoyal: false };
  for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
    const five = cards.filter((_, k) => k !== i && k !== j);
    const ev = evalFiveHand(five);
    if (ev.rank === 8 && ev.tiebreak[0] === 14) ev.isRoyal = true;
    if (compareFive(ev, best) > 0 || (ev.rank === best.rank && ev.isRoyal && !best.isRoyal)) best = { ...ev };
  }

  if (best.rank >= 3) return { bonusType: '_five', fiveEval: best };
  if (hasThreePairs(cards)) return { bonusType: 'threepair' };
  return { bonusType: '_five', fiveEval: best };
}

function getBonusPayout(sevenResult, bp) {
  const bt = sevenResult.bonusType;
  if (bt === 'sf7natural') return { mult: bp.sf7natural, label: 'Natural 7-Card Straight Flush 🔥' };
  if (bt === 'sf7joker')   return { mult: bp.sf7joker,   label: '7-Card Straight Flush (Joker) ⭐' };
  if (bt === 'fiveaces')   return { mult: bp.fiveaces,   label: 'Five Aces 👑' };
  if (bt === 'threepair')  return { mult: bp.threepair,  label: '3 Pairs' };
  const ev = sevenResult.fiveEval;
  if (!ev || ev.rank < 0) return null;
  if (ev.isRoyal)    return { mult: bp.royal,    label: 'Royal Flush' };
  if (ev.rank === 8) return { mult: bp.sf,        label: 'Straight Flush' };
  if (ev.rank === 7) return { mult: bp.quads,     label: 'Four of a Kind' };
  if (ev.rank === 6) return { mult: bp.fullhouse, label: 'Full House' };
  if (ev.rank === 5) return { mult: bp.flush,     label: 'Flush' };
  if (ev.rank === 4) return { mult: bp.straight,  label: 'Straight' };
  if (ev.rank === 3) return { mult: bp.trips,     label: 'Three of a Kind' };
  return null;
}

// ─── GAME STATE FACTORY ──────────────────────────────────────────────────────
function makeGame(hostId, hostName, startingChips, bonusPayouts) {
  return {
    hostId,
    phase: 'lobby',   // lobby | bet | set | reveal | done
    round: 1,
    bankerIdx: 0,
    deck: [],
    startingChips,
    bonusPayouts,
    houseBonus: { collected: 0, paid: 0, rounds: 0 },
    players: [{
      id: hostId,
      name: hostName,
      chips: startingChips,
      bet: 0,
      bonusBet: 0,
      hand: [],
      highHand: [],
      lowHand: [],
      handSet: false,
      folded: false,
      result: null,
      netChips: null,
      bonusNet: null,
      bonusLabel: '',
      bonusWon: false,
      stats: { wins: 0, losses: 0, pushes: 0, rounds: 0, netChips: 0, buyins: 0 }
    }]
  };
}

// ─── SAFE STATE (strip private hand data before broadcasting) ────────────────
function safeState(room, forSocketId) {
  const g = rooms[room];
  if (!g) return null;
  return {
    phase: g.phase,
    round: g.round,
    bankerIdx: g.bankerIdx,
    startingChips: g.startingChips,
    bonusPayouts: g.bonusPayouts,
    houseBonus: g.houseBonus,
    players: g.players.map(p => {
      const isMe = p.id === forSocketId;
      const isRevealing = g.phase === 'reveal' || g.phase === 'done';
      return {
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        bonusBet: p.bonusBet,
        handSet: p.handSet,
        folded: p.folded,
        result: p.result,
        netChips: p.netChips,
        bonusNet: p.bonusNet,
        bonusLabel: p.bonusLabel,
        bonusWon: p.bonusWon,
        stats: p.stats,
        // Hand cards: visible to owner always, to all during reveal
        hand: (isMe || isRevealing) ? p.hand : (p.hand.length > 0 ? p.hand.map(() => ({ hidden: true })) : []),
        highHand: (isMe || isRevealing) ? p.highHand : (p.highHand.length > 0 ? p.highHand.map(() => ({ hidden: true })) : []),
        lowHand: (isMe || isRevealing) ? p.lowHand : (p.lowHand.length > 0 ? p.lowHand.map(() => ({ hidden: true })) : []),
      };
    })
  };
}

function broadcastState(room) {
  const g = rooms[room];
  if (!g) return;
  g.players.forEach(p => {
    io.to(p.id).emit('state', safeState(room, p.id));
  });
}

// ─── SETTLE ROUND ────────────────────────────────────────────────────────────
function settleRound(room) {
  const g = rooms[room];
  const banker = g.players[g.bankerIdx];
  const bankerHigh = evalFiveHand(banker.highHand);
  const bankerLow = evalTwoHand(banker.lowHand);

  g.players.forEach((p, idx) => {
    if (idx === g.bankerIdx || p.folded || p.bet === 0) return;
    const pHigh = evalFiveHand(p.highHand);
    const pLow = evalTwoHand(p.lowHand);
    const highWin = compareFive(pHigh, bankerHigh);
    const lowWin = compareTwo(pLow, bankerLow);

    let result, net;
    if (highWin > 0 && lowWin > 0)       { net =  p.bet; result = 'win'; }
    else if (highWin < 0 && lowWin < 0)  { net = -p.bet; result = 'lose'; }
    else                                  { net = 0;      result = 'push'; }

    p.chips += net;
    banker.chips -= net;
    p.result = result;
    p.netChips = net;
    p.stats.rounds++;
    p.stats.netChips += net;
    if (result === 'win')       p.stats.wins++;
    else if (result === 'lose') p.stats.losses++;
    else                        p.stats.pushes++;

    // Bonus
    let bonusNet = 0, bonusLabel = '', bonusWon = false;
    if (p.bonusBet > 0 && p.hand.length === 7) {
      const sr = evalSevenCardBonus(p.hand);
      const payout = getBonusPayout(sr, g.bonusPayouts);
      if (payout) {
        bonusNet = p.bonusBet * payout.mult;
        bonusLabel = `${payout.label} (${payout.mult}×)`;
        bonusWon = true;
        g.houseBonus.paid += bonusNet;
      } else {
        bonusNet = -p.bonusBet;
        bonusLabel = 'No bonus';
        g.houseBonus.collected += p.bonusBet;
      }
      p.chips += bonusNet;
      g.houseBonus.rounds++;
    }
    p.bonusNet = bonusNet;
    p.bonusLabel = bonusLabel;
    p.bonusWon = bonusWon;
  });

  g.phase = 'done';
}

// ─── SOCKET EVENTS ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Create room
  socket.on('createRoom', ({ name, startingChips, bonusPayouts }) => {
    let code;
    do { code = makeCode(); } while (rooms[code]);
    rooms[code] = makeGame(socket.id, name, startingChips, bonusPayouts);
    socket.join(code);
    socket.emit('roomCreated', { code });
    broadcastState(code);
  });

  // Join room
  socket.on('joinRoom', ({ code, name }) => {
    const g = rooms[code];
    if (!g) { socket.emit('error', 'Room not found'); return; }
    if (g.phase !== 'lobby') { socket.emit('error', 'Game already in progress'); return; }
    if (g.players.length >= 7) { socket.emit('error', 'Room is full (max 7 players)'); return; }
    if (g.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      socket.emit('error', 'That name is already taken'); return;
    }
    g.players.push({
      id: socket.id, name,
      chips: g.startingChips, bet: 0, bonusBet: 0,
      hand: [], highHand: [], lowHand: [],
      handSet: false, folded: false,
      result: null, netChips: null, bonusNet: null, bonusLabel: '', bonusWon: false,
      stats: { wins: 0, losses: 0, pushes: 0, rounds: 0, netChips: 0, buyins: 0 }
    });
    socket.join(code);
    socket.emit('joinedRoom', { code });
    broadcastState(code);
  });

  // Start game (host only)
  socket.on('startGame', ({ code }) => {
    const g = rooms[code];
    if (!g || g.hostId !== socket.id) return;
    if (g.players.length < 2) { socket.emit('error', 'Need at least 2 players to start'); return; }
    g.phase = 'bet';
    broadcastState(code);
  });

  // Place bet
  socket.on('placeBet', ({ code, amount }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'bet') return;
    const p = g.players.find(p => p.id === socket.id);
    if (!p || p.folded) return;
    const idx = g.players.indexOf(p);
    if (idx === g.bankerIdx) return;
    const available = p.chips - p.bonusBet;
    const add = Math.min(amount, available - p.bet);
    if (add <= 0) return;
    p.bet += add;
    broadcastState(code);
  });

  socket.on('clearBet', ({ code }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'bet') return;
    const p = g.players.find(p => p.id === socket.id);
    if (p) { p.bet = 0; broadcastState(code); }
  });

  socket.on('placeBonusBet', ({ code, amount }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'bet') return;
    const p = g.players.find(p => p.id === socket.id);
    if (!p || p.folded) return;
    const idx = g.players.indexOf(p);
    if (idx === g.bankerIdx) return;
    const available = p.chips - p.bet - p.bonusBet;
    const add = Math.min(amount, available);
    if (add <= 0) return;
    p.bonusBet += add;
    broadcastState(code);
  });

  socket.on('clearBonusBet', ({ code }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'bet') return;
    const p = g.players.find(p => p.id === socket.id);
    if (p) { p.bonusBet = 0; broadcastState(code); }
  });

  socket.on('fold', ({ code }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'bet') return;
    const p = g.players.find(p => p.id === socket.id);
    if (p) { p.folded = true; p.bet = 0; p.bonusBet = 0; broadcastState(code); }
  });

  socket.on('unfold', ({ code }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'bet') return;
    const p = g.players.find(p => p.id === socket.id);
    if (p && p.chips > 0) { p.folded = false; broadcastState(code); }
  });

  // Deal (host only)
  socket.on('deal', ({ code }) => {
    const g = rooms[code];
    if (!g || g.hostId !== socket.id || g.phase !== 'bet') return;
    const nonBankers = g.players.filter((p, i) => i !== g.bankerIdx && !p.folded);
    const bettors = nonBankers.filter(p => p.bet > 0);
    if (bettors.length === 0) { socket.emit('error', 'At least one player must bet'); return; }
    const missing = nonBankers.filter(p => p.bet === 0);
    if (missing.length > 0) { socket.emit('error', `${missing.map(p => p.name).join(', ')} must bet or fold`); return; }

    g.deck = shuffle(buildDeck());
    g.players.forEach(p => {
      p.hand = []; p.highHand = []; p.lowHand = [];
      p.handSet = false; p.result = null;
      p.netChips = null; p.bonusNet = null;
      p.bonusLabel = ''; p.bonusWon = false;
    });
    const active = g.players.filter((p, i) => i === g.bankerIdx || (!p.folded && p.bet > 0));
    active.forEach(p => { for (let i = 0; i < 7; i++) p.hand.push(g.deck.pop()); });
    g.phase = 'set';
    broadcastState(code);
  });

  // Set hand
  socket.on('setHand', ({ code, highHand, lowHand }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'set') return;
    const p = g.players.find(p => p.id === socket.id);
    if (!p || p.hand.length === 0) return;
    if (highHand.length !== 5 || lowHand.length !== 2) {
      socket.emit('error', 'Must have 5 cards in high hand and 2 in low hand'); return;
    }
    // Validate cards belong to player's hand
    const handKeys = p.hand.map(c => `${c.rank}${c.suit}`);
    const submitted = [...highHand, ...lowHand].map(c => `${c.rank}${c.suit}`);
    const valid = submitted.every(k => handKeys.includes(k)) && new Set(submitted).size === 7;
    if (!valid) { socket.emit('error', 'Invalid hand — cards do not match your dealt hand'); return; }
    p.highHand = highHand;
    p.lowHand = lowHand;
    p.handSet = true;
    broadcastState(code);

    // Auto-reveal if everyone is set
    const needToSet = g.players.filter((p, i) => i === g.bankerIdx ? p.hand.length > 0 : !p.folded && p.bet > 0);
    if (needToSet.every(p => p.handSet)) {
      settleRound(code);
      broadcastState(code);
    }
  });

  // House way request
  socket.on('houseWay', ({ code }) => {
    const g = rooms[code];
    if (!g) return;
    const p = g.players.find(p => p.id === socket.id);
    if (!p || p.hand.length === 0) return;
    const { high, low } = applyHouseWay(p.hand);
    socket.emit('houseWaySuggestion', { high, low });
  });

  // Reveal (host manually triggers if needed)
  socket.on('reveal', ({ code }) => {
    const g = rooms[code];
    if (!g || g.hostId !== socket.id || g.phase !== 'set') return;
    const needToSet = g.players.filter((p, i) => i === g.bankerIdx ? p.hand.length > 0 : !p.folded && p.bet > 0);
    const unset = needToSet.filter(p => !p.handSet).map(p => p.name);
    if (unset.length > 0) { socket.emit('error', `${unset.join(', ')} haven't set their hand yet`); return; }
    settleRound(code);
    broadcastState(code);
  });

  // Next round
  socket.on('nextRound', ({ code }) => {
    const g = rooms[code];
    if (!g || g.hostId !== socket.id || g.phase !== 'done') return;
    g.players.forEach(p => {
      p.bet = 0; p.bonusBet = 0;
      p.hand = []; p.highHand = []; p.lowHand = [];
      p.handSet = false; p.folded = false;
      p.result = null; p.netChips = null;
      p.bonusNet = null; p.bonusLabel = ''; p.bonusWon = false;
    });
    g.bankerIdx = (g.bankerIdx + 1) % g.players.length;
    g.round++;
    g.phase = 'bet';
    broadcastState(code);
  });

  // Rotate banker
  socket.on('rotateBanker', ({ code }) => {
    const g = rooms[code];
    if (!g || g.hostId !== socket.id || g.phase !== 'bet') return;
    g.bankerIdx = (g.bankerIdx + 1) % g.players.length;
    broadcastState(code);
  });

  // Buy in
  socket.on('buyIn', ({ code, amount }) => {
    const g = rooms[code];
    if (!g || g.phase !== 'bet') return;
    const p = g.players.find(p => p.id === socket.id);
    if (!p || amount < 1) return;
    p.chips += amount;
    p.stats.buyins += amount;
    broadcastState(code);
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const [code, g] of Object.entries(rooms)) {
      const idx = g.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;
      // Notify others
      io.to(code).emit('playerLeft', { name: g.players[idx].name });
      // If game hasn't started just remove them
      if (g.phase === 'lobby') {
        g.players.splice(idx, 1);
        if (g.players.length === 0) { delete rooms[code]; break; }
        // Transfer host if needed
        if (g.hostId === socket.id) g.hostId = g.players[0].id;
      }
      // If game in progress, mark as folded/inactive
      else {
        g.players[idx].folded = true;
        g.players[idx].bet = 0;
        g.players[idx].disconnected = true;
      }
      broadcastState(code);
      break;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pai Gow server running on port ${PORT}`));

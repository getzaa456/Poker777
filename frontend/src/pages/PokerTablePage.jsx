import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE, Auth, Tables, fmtChips, getToken } from '../lib/api.js';
import { AvatarFace, normalizeAvatarId } from '../components/avatars.jsx';
import { usePageStyles } from '../hooks/usePageStyles.js';
import { sound } from '../lib/sound.js';

const RANK_VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
const HANDS = [
  ['Royal flush', 'A-K-Q-J-10, same suit', ['A♥','K♥','Q♥','J♥','10♥']],
  ['Straight flush', 'Five sequential cards, same suit', ['9♦','8♦','7♦','6♦','5♦']],
  ['Four of a kind', 'Four cards of the same rank', ['A♠','A♥','A♦','A♣']],
  ['Full house', 'Three of a kind plus a pair', ['K♠','K♥','K♦','4♣','4♥']],
  ['Flush', 'Five cards of the same suit', ['2♥','5♥','8♥','J♥','K♥']],
  ['Straight', 'Five sequential cards', ['10♠','9♥','8♦','7♣','6♠']],
  ['Three of a kind', 'Three cards of the same rank', ['Q♠','Q♥','Q♦']],
  ['Two pair', 'Two different pairs', ['J♠','J♦','3♣','3♥']],
  ['Pair', 'Two cards of the same rank', ['7♠','7♥']],
  ['High card', 'Highest card when no hand matches', ['A♠','J♥','8♦','4♣','2♠']],
];
const BETTING_PHASES = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
const DEAL_PHASE = { 'deal-flop': 'FLOP', 'deal-turn': 'TURN', 'deal-river': 'RIVER' };
const seatedKey = (code) => `poker777_seated_${code}`;
// Server keeps a dropped player's seat this long (DISCONNECT_GRACE_MS in ws-server.js).
const RECONNECT_GRACE_MS = 30000;
// No message this long after a turn deadline means the socket is silently dead.
const STALE_AFTER_DEADLINE_MS = 6000;
// A handshake over a stalled network can hang without ever failing.
const CONNECT_TIMEOUT_MS = 8000;
// Turn length on the server (TURN_TIMEOUT_MS in ws-server.js); drives the countdown ring.
const TURN_MS = 15000;
// Community cards turn over one at a time, this far apart (an all-in runout is 5 cards).
const CARD_REVEAL_MS = 650;

// Backend sends ten as rank "T"; the UI and evaluator use "10".
function parseCard(card) {
  const raw = typeof card === 'string' ? { rank: card.slice(0, -1), suit: card.slice(-1) } : (card || { rank: '', suit: '' });
  const rank = String(raw.rank || '').toUpperCase();
  return { rank: rank === 'T' ? '10' : rank, suit: String(raw.suit || '').toUpperCase() };
}

function normalizeCards(cards) {
  return (Array.isArray(cards) ? cards : cards ? [cards] : []).map(parseCard).filter((card) => card.rank && card.suit);
}

function suitSymbol(value) {
  return ({ S: '♠', H: '♥', D: '♦', C: '♣' })[value] || value;
}

function PlayingCard({ card, className = 'playing-card' }) {
  const parsed = parseCard(card);
  const suit = suitSymbol(parsed.suit);
  const red = suit === '♥' || suit === '♦';
  return <div className={`${className} ${red ? 'red' : ''}`} title={`${parsed.rank}${suit}`}><b>{parsed.rank}</b><span>{suit}</span></div>;
}

function evaluateHand(rawCards) {
  const cards = rawCards.map(parseCard).filter((card) => card.rank && card.suit);
  if (!cards.length) return { name: 'Waiting for cards', detail: 'Your best hand will appear here' };
  const ranks = cards.map((card) => RANK_VALUE[card.rank] || 0).sort((a, b) => b - a);
  const counts = new Map();
  cards.forEach((card) => counts.set(card.rank, (counts.get(card.rank) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || RANK_VALUE[b[0]] - RANK_VALUE[a[0]]);
  const suits = new Map();
  cards.forEach((card) => suits.set(card.suit, [...(suits.get(card.suit) || []), RANK_VALUE[card.rank] || 0]));
  const flush = [...suits.entries()].find(([, values]) => values.length >= 5);
  const unique = [...new Set(ranks)];
  if (unique.includes(14)) unique.push(1);
  let straight = 0;
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique[index] - unique[index + 4] === 4) { straight = unique[index]; break; }
  }
  let suitStraight = 0;
  if (flush) {
    const suited = [...new Set(flush[1])].sort((a, b) => b - a);
    if (suited.includes(14)) suited.push(1);
    for (let index = 0; index <= suited.length - 5; index += 1) {
      if (suited[index] - suited[index + 4] === 4) { suitStraight = suited[index]; break; }
    }
  }
  const highCard = [...cards].sort((a, b) => (RANK_VALUE[b.rank] || 0) - (RANK_VALUE[a.rank] || 0))[0];
  if (suitStraight) return { name: suitStraight === 14 ? 'Royal flush' : 'Straight flush', detail: 'Five cards in sequence, same suit' };
  if (groups[0]?.[1] === 4) return { name: 'Four of a kind', detail: `${groups[0][0]} four of a kind` };
  if (groups[0]?.[1] === 3 && groups[1]?.[1] >= 2) return { name: 'Full house', detail: `${groups[0][0]} full of ${groups[1][0]}` };
  if (flush) return { name: 'Flush', detail: 'Five cards share a suit' };
  if (straight) return { name: 'Straight', detail: 'Five cards in sequence' };
  if (groups[0]?.[1] === 3) return { name: 'Three of a kind', detail: `Three ${groups[0][0]}s` };
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) return { name: 'Two pair', detail: `${groups[0][0]} and ${groups[1][0]}` };
  if (groups[0]?.[1] === 2) return { name: 'Pair', detail: `Pair of ${groups[0][0]}s` };
  return { name: 'High card', detail: `High card ${highCard.rank}` };
}

// ---------------------------------------------------------------------------
// Table state. The backend mixes full snapshots (table_state, game_started,
// showdown, tournament_finished) with incremental events (game-action,
// deal-*, turn-start, winner, player-join, left-room), so the page keeps its
// own copy and applies both kinds. Per-street bets are not in the snapshot;
// they are tracked from events and marked unknown after a mid-hand reconnect.
// ---------------------------------------------------------------------------

function snapshotPlayer(player) {
  return {
    client_id: String(player.client_id),
    seat: Number(player.seat) - 1, // backend seats are 1-based
    username: player.username || '',
    chips: Number(player.chips) || 0,
    avatar_id: player.avatar_id || null,
    hole_cards: normalizeCards(player.hole_cards),
    status: player.status || 'WAITING',
    bet: 0,
    act: null, // last action this street, shown as a badge on the seat
  };
}

// Badge for a player's last move. FOLD and ALL IN stay for the rest of the hand.
function actionBadge(action, amount, bet, allIn, timedOut) {
  const clock = timedOut ? ' ⏱' : '';
  if (action === 'FOLD') return { kind: 'fold', label: `FOLD${clock}` };
  if (allIn) return { kind: 'allin', label: `ALL IN ${fmtChips(bet)}` };
  if (action === 'CHECK') return { kind: 'check', label: `CHECK${clock}` };
  if (action === 'CALL') return { kind: 'call', label: `CALL ${fmtChips(amount)}` };
  if (action === 'BET') return { kind: 'raise', label: `BET ${fmtChips(bet)}` };
  if (action === 'RAISE') return { kind: 'raise', label: `RAISE ${fmtChips(bet)}` };
  return null;
}
const keepsBadge = (act) => act && (act.kind === 'fold' || act.kind === 'allin');

// Seats sit on an ellipse around the table in turn (seat-index) order, rotated so the
// viewer's own seat is at the bottom — where their panel is — and the rest go clockwise.
function seatPosition(seat, anchorSeat, seatCount) {
  const offset = (seat - anchorSeat + seatCount) % seatCount;
  const angle = Math.PI / 2 + (offset * 2 * Math.PI) / seatCount;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const side = Math.abs(cos) > 0.55 ? (cos < 0 ? 'left' : 'right') : (sin < 0 ? 'top' : 'bottom');
  // Radius comes from CSS (--rx/--ry) so narrow tables can pull the ring in.
  return { style: { '--cos': cos.toFixed(3), '--sin': sin.toFixed(3) }, side };
}

function blindBets(players, params) {
  const inHand = players.filter((player) => ['ACTIVE', 'ALL_IN'].includes(player.status)).sort((a, b) => a.seat - b.seat);
  if (inHand.length < 2) return {};
  const dealerIndex = Math.max(0, inHand.findIndex((player) => player.seat === Number(params.dealer_seat)));
  const sbIndex = inHand.length === 2 ? dealerIndex : (dealerIndex + 1) % inHand.length;
  const sb = inHand[sbIndex];
  const bb = inHand[(sbIndex + 1) % inHand.length];
  const pot = Number(params.pot) || 0;
  let sbBet = sb.status === 'ALL_IN' ? null : Number(params.small_blind) || 0;
  let bbBet = bb.status === 'ALL_IN' ? null : Number(params.big_blind) || 0;
  if (sbBet === null && bbBet === null) { sbBet = Math.min(Number(params.small_blind) || 0, pot); bbBet = pot - sbBet; }
  else if (sbBet === null) sbBet = Math.max(0, pot - bbBet);
  else if (bbBet === null) bbBet = Math.max(0, pot - sbBet);
  return { [sb.client_id]: sbBet, [bb.client_id]: bbBet, sbId: sb.client_id, bbId: bb.client_id };
}

function fromSnapshot(prev, kind, params, clockOffset) {
  const players = (params.players || []).map(snapshotPlayer);
  const inHand = BETTING_PHASES.includes(params.phase);
  // betsKnown: every player's street bet is tracked. ownBetKnown: only this client's own bet is —
  // it survives a reconnect because a player cannot put chips in while offline (timeouts only check/fold).
  let betsKnown = !inHand;
  let ownBetKnown = !inHand;
  const prevInHand = Boolean(prev && BETTING_PHASES.includes(prev.phase));
  // Different hole cards for anyone means a whole new hand was dealt while we were away.
  const sameHand = prevInHand && !players.some((player) => {
    const before = prev.players.find((item) => item.client_id === player.client_id);
    const key = (cards) => cards.map((card) => card.rank + card.suit).join();
    return before?.hole_cards.length && player.hole_cards.length && key(before.hole_cards) !== key(player.hole_cards);
  });
  const before = (player) => prev?.players.find((item) => item.client_id === player.client_id);
  if (kind === 'game_started') {
    const bets = blindBets(players, params);
    players.forEach((player) => {
      player.bet = bets[player.client_id] || 0;
      if (player.client_id === bets.sbId) player.act = { kind: 'blind', label: `SB ${fmtChips(player.bet)}` };
      if (player.client_id === bets.bbId) player.act = { kind: 'blind', label: `BB ${fmtChips(player.bet)}` };
    });
    betsKnown = true;
    ownBetKnown = true;
  } else if (inHand && sameHand && prev.phase === params.phase) {
    // Same street: keep tracked bets and badges.
    players.forEach((player) => { player.bet = before(player)?.bet || 0; player.act = before(player)?.act || null; });
    betsKnown = prev.betsKnown;
    ownBetKnown = prev.ownBetKnown !== false;
  } else if (inHand && sameHand) {
    // New street (e.g. someone left and the board advanced): all bets start at zero.
    players.forEach((player) => { player.act = keepsBadge(before(player)?.act) ? before(player).act : null; });
    betsKnown = true;
    ownBetKnown = true;
  } else if (!inHand && prev?.result && kind === 'table_state') {
    // Snapshot right after a showdown: keep the revealed cards and badges until the next hand.
    players.forEach((player) => {
      if (!player.hole_cards.length) player.hole_cards = before(player)?.hole_cards || [];
      player.act = before(player)?.act || null;
    });
  }
  const nextHandAt = Number(params.next_hand_at) || 0;
  const deadline = Number(params.turn_deadline) || 0;
  return {
    room_name: params.room_name || '',
    max_players: Number(params.max_players) || 6,
    status: params.status,
    phase: params.phase || 'WAITING',
    host_id: params.host_id ? String(params.host_id) : null,
    current_turn: params.current_turn ? String(params.current_turn) : null,
    turn_deadline: deadline ? deadline - clockOffset : null,
    next_hand_at: nextHandAt ? nextHandAt - clockOffset : null,
    pot: Number(params.pot) || 0,
    current_bet: Number(params.current_bet) || 0,
    min_raise: Number(params.min_raise) || Number(params.big_blind) || 0,
    dealer_seat: Number(params.dealer_seat) || 0,
    small_blind: Number(params.small_blind) || 0,
    big_blind: Number(params.big_blind) || 0,
    community_cards: normalizeCards(params.community_cards),
    winner: params.winner ? String(params.winner) : null,
    winner_name: params.winner_name || null,
    players,
    betsKnown,
    ownBetKnown,
    result: kind === 'showdown' || kind === 'tournament_finished'
      ? {
        winnerIds: (params.winnerIds?.length ? params.winnerIds : [params.winner]).filter(Boolean).map(String),
        payouts: params.payouts || {},
        hand: params.winningHand || params.winning_hand || null,
        final: kind === 'tournament_finished',
      }
      : (inHand ? null : prev?.result || null),
  };
}

function tableReducer(state, { type, params = {}, clockOffset = 0 }) {
  if (type === 'reset') return null;
  if (['table_state', 'table-state', 'game_started', 'showdown', 'tournament_finished'].includes(type)) {
    return fromSnapshot(state, type.replace('-', '_'), params, clockOffset);
  }
  if (!state) return state;

  switch (type) {
    case 'resync':
      // Events were missed while offline: tracked bets are no longer trustworthy until the next street.
      return { ...state, betsKnown: false };
    case 'player-join': {
      const known = new Set(state.players.map((player) => player.client_id));
      const added = (params.currentPlayers || [])
        .filter((player) => !known.has(String(player.clientId)))
        .map((player) => ({ client_id: String(player.clientId), seat: Number(player.seat) - 1, username: player.username || '', chips: Number(player.money) || 0, avatar_id: null, hole_cards: [], status: 'WAITING', bet: 0 }));
      return added.length ? { ...state, players: [...state.players, ...added] } : state;
    }
    case 'left-room': {
      const remaining = (params.currentPlayers || []).map((player) => String(player.clientId));
      const players = state.players.filter((player) => remaining.includes(player.client_id));
      return { ...state, players };
    }
    case 'turn-start': {
      const deadline = Number(params.turn_deadline) || 0;
      return { ...state, current_turn: params.clientId ? String(params.clientId) : null, turn_deadline: deadline ? deadline - clockOffset : null };
    }
    case 'game-action': {
      // The server publishes the acting event after a showdown/early finish; that hand is already settled.
      if (!BETTING_PHASES.includes(state.phase)) return state;
      const actorId = String(params.clientId);
      const amount = Number(params.amount) || 0;
      const action = String(params.action || '').toUpperCase();
      let min_raise = state.min_raise;
      const players = state.players.map((player) => {
        if (player.client_id !== actorId) return player;
        const chips = player.chips - amount;
        const bet = player.bet + amount;
        if (bet > state.current_bet && bet - state.current_bet >= state.min_raise) min_raise = bet - state.current_bet;
        const allIn = amount > 0 && chips <= 0;
        const status = action === 'FOLD' ? 'FOLDED' : allIn ? 'ALL_IN' : player.status;
        const act = actionBadge(action, amount, bet, allIn, params.timed_out) || player.act;
        return { ...player, chips, bet, status, act };
      });
      return {
        ...state,
        players,
        min_raise,
        pot: Number(params.pot) || 0,
        current_bet: Number(params.currentBet) || 0,
        current_turn: state.current_turn === actorId ? null : state.current_turn,
        turn_deadline: state.current_turn === actorId ? null : state.turn_deadline,
      };
    }
    case 'deal-flop':
    case 'deal-turn':
    case 'deal-river':
      return {
        ...state,
        phase: DEAL_PHASE[type],
        community_cards: [...state.community_cards, ...normalizeCards(params.card)],
        current_bet: 0,
        min_raise: state.big_blind,
        betsKnown: true,
        ownBetKnown: true,
        players: state.players.map((player) => ({ ...player, bet: 0, act: keepsBadge(player.act) ? player.act : null })),
      };
    case 'winner': {
      // Everyone else folded (or left): the pot goes to one player without a showdown.
      const winnerId = String(params.winnerId);
      const winner = state.players.find((player) => player.client_id === winnerId);
      const money = Number(params.current_money);
      const won = winner && Number.isFinite(money) ? money - winner.chips : state.pot;
      return {
        ...state,
        phase: 'WAITING',
        status: 'WAITING',
        pot: 0,
        current_bet: 0,
        current_turn: null,
        turn_deadline: null,
        winner: winnerId,
        winner_name: winner?.username || null,
        betsKnown: true,
        ownBetKnown: true,
        players: state.players.map((player) => ({
          ...player,
          chips: player.client_id === winnerId && Number.isFinite(money) ? money : player.chips,
          bet: 0,
          hole_cards: [],
          status: player.status === 'DISCONNECTED' ? player.status : 'WAITING',
        })),
        result: { winnerIds: [winnerId], payouts: { [winnerId]: won }, hand: null, final: false },
      };
    }
    default:
      return state;
  }
}

// Chips won this hand; for "won the table" the server sends no payouts, so show the winner's stack.
function winnerAmount(result, players) {
  const paid = result.winnerIds.reduce((sum, id) => sum + (Number(result.payouts?.[id]) || 0), 0);
  if (paid > 0) return paid;
  return result.winnerIds.reduce((sum, id) => sum + (players.find((player) => player.client_id === id)?.chips || 0), 0);
}

export default function PokerTablePage() {
  usePageStyles('/assets/css/poker-table.css');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const roomCode = (searchParams.get('code') || '').toUpperCase();
  const socketRef = useRef(null);
  const clockOffsetRef = useRef(0);
  const stateRef = useRef(null);
  const userRef = useRef(null);
  const leavingRef = useRef(false);
  const pendingResultRef = useRef([]); // showdown messages/sounds, held until the board is revealed
  const lastRevealAtRef = useRef(0);
  const [shownCards, setShownCards] = useState(0); // community cards turned over so far
  const [user, setUser] = useState(null);
  const [table, setTable] = useState(null);
  const [state, dispatch] = useReducer(tableReducer, null);
  const [roomStatus, setRoomStatus] = useState('Loading table...');
  const [buyIn, setBuyIn] = useState(0);
  const [seatRequest, setSeatRequest] = useState(null); // buy-in to sit with; null = not sitting yet
  const [raiseTo, setRaiseTo] = useState(0);
  const [betDraft, setBetDraft] = useState(null); // text being typed in the bet box, null = not editing
  const [nextHandIn, setNextHandIn] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [countdown, setCountdown] = useState('--');
  const [timeLeftPct, setTimeLeftPct] = useState(0);
  const [muted, setMuted] = useState(sound.isMuted());
  const [connection, setConnection] = useState('idle'); // idle | connecting | online | reconnecting

  stateRef.current = state;
  userRef.current = user;

  function notify(message, tone = '') {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications((items) => [{ id, message, tone }, ...items].slice(0, 5));
    setTimeout(() => setNotifications((items) => items.filter((item) => item.id !== id)), 5000);
  }

  function playerName(clientId) {
    const player = stateRef.current?.players.find((item) => item.client_id === String(clientId));
    if (String(clientId) === String(userRef.current?.id)) return 'You';
    return player?.username || `Player ${clientId}`;
  }

  // Load profile + table, then sit automatically if this tab already holds a seat (refresh / reconnect).
  useEffect(() => {
    document.title = 'Poker777 — Game Room';
    if (!Auth.hasSession() || !roomCode) {
      navigate(Auth.hasSession() ? '/lobby' : '/', { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [current, tableInfo] = await Promise.all([Auth.me(), Tables.get(roomCode)]);
        if (cancelled) return;
        setUser(current);
        setTable(tableInfo);
        const min = Number(tableInfo.min_bet) || 0;
        const max = Math.min(Number(tableInfo.max_bet) || min, Number(current.balance) || 0);
        setBuyIn(Math.max(min, Math.min(max, min)));
        let remembered = null;
        try { remembered = sessionStorage.getItem(seatedKey(roomCode)); } catch { /* storage unavailable */ }
        if (remembered) setSeatRequest(Number(remembered) || min);
        else setRoomStatus('Choose your buy-in to take a seat');
      } catch (error) {
        if (!cancelled) setRoomStatus(error.message || 'Unable to load table');
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, roomCode]);

  // WebSocket session: connects once the player has chosen a buy-in, reconnects with backoff.
  useEffect(() => {
    if (seatRequest === null || !user) return undefined;
    let closed = false;
    let reconnectTimer = null;
    let watchdog = null;
    let attempt = 0;
    let droppedAt = null;
    let lastMessageAt = Date.now();

    const handle = (message) => {
      const { type } = message;
      const params = message.params || {};
      if (type === 'turn-start' && params.server_time) clockOffsetRef.current = Number(params.server_time) - Date.now();
      const me = String(user.id);

      switch (type) {
        case 'join':
          try { sessionStorage.setItem(seatedKey(roomCode), String(seatRequest)); } catch { /* ignore */ }
          setRoomStatus('Seated');
          setConnection('online');
          if (droppedAt) {
            notify('Reconnected');
            dispatch({ type: 'resync' });
          }
          droppedAt = null;
          return;
        case 'error':
          sound.error();
          notify(message.error || 'Server error', 'warning');
          if (!stateRef.current) {
            // Join was rejected: stop retrying and let the player pick again.
            closed = true;
            try { sessionStorage.removeItem(seatedKey(roomCode)); } catch { /* ignore */ }
            socketRef.current?.close();
            setSeatRequest(null);
            setRoomStatus(message.error || 'Unable to join table');
          }
          return;
        case 'seat-left':
          try { sessionStorage.removeItem(seatedKey(roomCode)); } catch { /* ignore */ }
          leavingRef.current = false;
          dispatch({ type: 'reset' });
          setConnection('idle');
          setRoomStatus('Choose your buy-in to take a seat');
          setSeatRequest(null);
          Auth.me().then((current) => {
            setUser(current);
            const min = Number(table?.min_bet) || 0;
            const max = Math.min(Number(table?.max_bet) || min, Number(current.balance) || 0);
            setBuyIn(max >= min ? min : max);
          }).catch(() => notify('Seat released, but wallet balance could not be refreshed.', 'warning'));
          return;
        case 'player-join':
          if (String(params.clientId) !== me) {
            const joined = (params.currentPlayers || []).find((player) => String(player.clientId) === String(params.clientId));
            notify(`${joined?.username || 'A player'} joined the table`);
            sound.join();
          }
          break;
        case 'left-room':
          if (String(params.clientId) !== me) { notify(`${playerName(params.clientId)} left the table`); sound.leave(); }
          break;
        case 'game-action':
          if (BETTING_PHASES.includes(stateRef.current?.phase)) {
            const amount = Number(params.amount) || 0;
            const verb = String(params.action || '').toLowerCase();
            const actor = stateRef.current.players.find((player) => player.client_id === String(params.clientId));
            if (verb === 'fold') sound.fold();
            else if (verb === 'check') sound.check();
            else if (amount > 0 && actor && amount >= actor.chips) sound.allIn();
            else if (amount > 0) sound.chips(verb === 'call' ? 2 : 4);
            notify(`${playerName(params.clientId)} ${verb}${amount ? ` ${fmtChips(amount)}` : ''}${params.timed_out ? ' (time ran out)' : ''}`, params.timed_out ? 'warning' : '');
          }
          break;
        case 'game_started':
          notify('New hand started');
          sound.deal(2);
          if (String(params.current_turn) === me) setTimeout(() => sound.yourTurn(), 350);
          break;
        case 'winner':
          notify(`${playerName(params.winnerId)} won the pot`);
          if (String(params.winnerId) === me) sound.win(); else sound.chips(5);
          break;
        case 'showdown': {
          // Announced once the remaining board cards have been turned over.
          const winners = (params.winnerIds || []).map(playerName).join(' & ');
          const stillIn = stateRef.current?.players.some((player) => player.client_id === me && player.status !== 'FOLDED' && player.hole_cards.length);
          pendingResultRef.current.push(() => {
            notify(`${winners || 'Showdown'} won${params.winningHand ? ` with ${params.winningHand}` : ''}`);
            if ((params.winnerIds || []).map(String).includes(me)) sound.win();
            else if (stillIn) sound.lose();
            else sound.chips(5);
          });
          break;
        }
        case 'tournament_finished': {
          const name = params.winner_name || playerName(params.winner);
          pendingResultRef.current.push(() => notify(`${name} is the last player with chips`));
          break;
        }
        case 'turn-start':
          if (String(params.clientId) === me) setTimeout(() => sound.yourTurn(), 250);
          break;
        default:
          break;
      }
      dispatch({ type, params, clockOffset: clockOffsetRef.current });
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer) return;
      if (!droppedAt) droppedAt = Date.now();
      setConnection('reconnecting');
      setRoomStatus('Connection lost. Reconnecting...');
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, Math.min(5000, 500 * (2 ** attempt)));
      attempt += 1;
    };

    // Abandon the current socket without waiting for a close handshake that may never finish.
    const dropSocket = () => {
      const socket = socketRef.current;
      if (socket) {
        socket.abandoned = true;
        try { socket.close(); } catch { /* ignore */ }
      }
      scheduleReconnect();
    };

    // Away longer than the server's grace period: the seat is gone and the chips went back
    // to the wallet. Ask again instead of silently buying in a second time.
    const seatExpired = async () => {
      closed = true;
      try { sessionStorage.removeItem(seatedKey(roomCode)); } catch { /* ignore */ }
      notify('You were offline too long and left the table. Your chips went back to your wallet.', 'warning');
      setConnection('idle');
      setRoomStatus('Choose your buy-in to take a seat');
      try { setUser(await Auth.me()); } catch { /* keep the old profile */ }
      setSeatRequest(null);
    };

    const connect = () => {
      if (closed) return;
      if (!navigator.onLine) { scheduleReconnect(); return; }
      setConnection(droppedAt ? 'reconnecting' : 'connecting');
      setRoomStatus(droppedAt ? 'Reconnecting...' : 'Connecting...');
      const socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(getToken())}`);
      socketRef.current = socket;
      const handshakeTimer = setTimeout(() => {
        if (!socket.abandoned && socket.readyState === WebSocket.CONNECTING && socketRef.current === socket) dropSocket();
      }, CONNECT_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(handshakeTimer);
        if (socket.abandoned) return;
        attempt = 0;
        lastMessageAt = Date.now();
        if (droppedAt && Date.now() - droppedAt > RECONNECT_GRACE_MS) {
          socket.abandoned = true;
          socket.close();
          seatExpired();
          return;
        }
        setRoomStatus('Joining table...');
        socket.send(JSON.stringify({ type: 'join', params: { clientId: String(user.id), roomCode, buyIn: Number(seatRequest) } }));
      });
      socket.addEventListener('message', (event) => {
        if (socket.abandoned) return;
        lastMessageAt = Date.now();
        try { handle(JSON.parse(event.data)); } catch (error) { console.error('Bad table message', error); }
      });
      socket.addEventListener('close', () => {
        clearTimeout(handshakeTimer);
        if (socket.abandoned) return;
        scheduleReconnect();
      });
    };

    // A half-open connection never fires 'close'. During a hand the server always sends something
    // by the turn deadline (an action or a timeout), so silence well past it means the link is dead.
    watchdog = setInterval(() => {
      const current = stateRef.current;
      const socket = socketRef.current;
      if (closed || !socket || socket.readyState !== WebSocket.OPEN || !current?.turn_deadline) return;
      if (!BETTING_PHASES.includes(current.phase)) return;
      if (Date.now() > current.turn_deadline + STALE_AFTER_DEADLINE_MS && lastMessageAt < current.turn_deadline) dropSocket();
    }, 1000);

    const onOffline = () => {
      setConnection('reconnecting');
      setRoomStatus('You are offline');
      if (!droppedAt) droppedAt = Date.now();
    };
    const onOnline = () => {
      if (closed) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      dropSocket(); // the old socket may look open but be dead after a network switch
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(watchdog);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (socketRef.current) socketRef.current.abandoned = true;
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatRequest, user, roomCode, navigate]);

  useEffect(() => {
    if (!state?.turn_deadline) {
      setCountdown('--');
      setTimeLeftPct(0);
      return undefined;
    }
    const tick = () => {
      const left = Math.max(0, state.turn_deadline - Date.now());
      setCountdown(String(Math.ceil(left / 1000)));
      setTimeLeftPct(Math.min(100, (left / TURN_MS) * 100));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state?.turn_deadline]);

  useEffect(() => {
    const at = state?.next_hand_at;
    if (!at || BETTING_PHASES.includes(state?.phase)) { setNextHandIn(0); return undefined; }
    const tick = () => setNextHandIn(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state?.next_hand_at, state?.phase]);

  // Ticking clock for the last five seconds of the player's own turn.
  const tickTurn = state?.current_turn && String(state.current_turn) === String(user?.id) && BETTING_PHASES.includes(state?.phase);
  useEffect(() => {
    const left = Number(countdown);
    if (tickTurn && left > 0 && left <= 5) sound.tick();
  }, [countdown, tickTurn]);

  function toggleMute() {
    sound.setMuted(!muted);
    setMuted(!muted);
  }

  // Turn the board over one card at a time: a flop is three flips, and an all-in runout
  // (the showdown snapshot brings all five at once) plays out card by card before the result.
  const boardCards = state?.community_cards || [];
  const boardTotal = boardCards.length;
  const hasState = Boolean(state);
  useEffect(() => {
    if (!hasState) { setShownCards(0); return undefined; }
    if (shownCards > boardTotal) { setShownCards(boardTotal); return undefined; } // new hand
    if (shownCards === boardTotal) return undefined;
    const wait = Math.max(0, lastRevealAtRef.current + CARD_REVEAL_MS - Date.now());
    const id = setTimeout(() => {
      lastRevealAtRef.current = Date.now();
      sound.card();
      setShownCards((count) => Math.min(count + 1, boardTotal));
    }, wait);
    return () => clearTimeout(id);
  }, [hasState, boardTotal, shownCards]);
  // Joining or reconnecting mid-hand: show what is already on the table without replaying it.
  useEffect(() => { if (hasState) setShownCards(boardTotal); }, [hasState]); // eslint-disable-line react-hooks/exhaustive-deps
  const revealing = shownCards < boardTotal;
  const shownBoard = boardCards.slice(0, shownCards);
  useEffect(() => {
    if (revealing || !pendingResultRef.current.length) return;
    const pending = pendingResultRef.current;
    pendingResultRef.current = [];
    pending.forEach((run) => run());
  }, [revealing, state]);

  const players = state?.players || [];
  const maxPlayers = Number(state?.max_players || table?.max_seats || 6);
  const myId = String(user?.id ?? '');
  const me = players.find((player) => player.client_id === myId);
  const inHand = BETTING_PHASES.includes(state?.phase);
  // Buttons wait until the new street is fully turned over (about a second on the flop).
  const myTurn = Boolean(inHand && state?.current_turn === myId && !revealing);
  // Sat down while a hand was running: no cards this hand, dealt in from the next one.
  const waitingForNextHand = Boolean(inHand && me && !me.hole_cards.length);
  const isHost = Boolean(table?.host_id && String(table.host_id) === myId);
  const readyPlayers = players.filter((player) => player.chips > 0 && player.status !== 'DISCONNECTED').length;
  const hand = useMemo(() => evaluateHand([...(me?.hole_cards || []), ...shownBoard]), [me?.hole_cards, shownBoard.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentTurnName = state?.current_turn ? (players.find((player) => player.client_id === state.current_turn)?.username || '') : '';

  // Betting numbers for the action bar.
  const currentBet = state?.current_bet || 0;
  const myBet = state?.ownBetKnown ? me?.bet || 0 : 0;
  const myChips = me?.chips || 0;
  const toCall = Math.max(0, currentBet - myBet);
  const canCheck = state?.ownBetKnown ? toCall === 0 : true;
  const canCall = state?.ownBetKnown ? toCall > 0 : currentBet > 0;
  const isBet = currentBet === 0;
  const maxTarget = myBet + myChips;
  const minTarget = Math.min(maxTarget, isBet ? Math.max(1, state?.big_blind || 1) : currentBet + Math.max(1, state?.min_raise || state?.big_blind || 1));
  const canRaise = maxTarget > currentBet && myChips > 0;
  // +/- step: the room's setting (chosen when it was created), else the big blind.
  const step = Math.max(1, Number(table?.bet_step) || state?.big_blind || 20);
  const clampBet = (value) => Math.min(maxTarget, Math.max(minTarget, Math.floor(Number(value) || 0)));
  const target = clampBet(raiseTo);
  const pot = state?.pot || 0;
  // Pot-sized raise: call first, then raise by the whole pot (including that call).
  const potTarget = isBet ? pot : currentBet + pot + toCall;
  const halfPotTarget = isBet ? Math.floor(pot / 2) : currentBet + Math.floor((pot + toCall) / 2);
  const draftNumber = betDraft === null ? null : Math.floor(Number(betDraft));
  const draftTooLow = draftNumber !== null && draftNumber > 0 && draftNumber < minTarget;
  const draftTooHigh = draftNumber !== null && draftNumber > maxTarget;

  // New street: start from the minimum again. Within a street keep the player's amount
  // while it is still legal (another player's raise can push the minimum above it).
  useEffect(() => { setRaiseTo(minTarget); setBetDraft(null); }, [state?.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRaiseTo((value) => (value >= minTarget && value <= maxTarget ? value : minTarget)); }, [minTarget, maxTarget]);

  function nudgeBet(direction) {
    setBetDraft(null);
    setRaiseTo(clampBet(target + direction * step));
  }

  function commitBetDraft() {
    if (betDraft === null) return target;
    const value = clampBet(betDraft);
    setRaiseTo(value);
    setBetDraft(null);
    return value;
  }

  function send(type, params) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(params ? { type, params } : { type }));
      return true;
    }
    notify('Not connected to the table', 'warning');
    return false;
  }

  function act(action, amount = 0) {
    send('game-action', { action, amount: Math.floor(Number(amount) || 0) });
  }

  function allIn() {
    if (isBet) act('BET', maxTarget);
    else if (maxTarget > currentBet) act('RAISE', maxTarget);
    else act('CALL');
  }

  function leaveRoom() {
    if (leavingRef.current) return;
    if (seatRequest === null) {
      navigate('/lobby');
      return;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      leavingRef.current = true;
      setRoomStatus('Returning chips to your wallet...');
      send('leave-room');
    } else {
      notify('Reconnect to the table before leaving your seat.', 'warning');
    }
  }

  const minBuyIn = Number(table?.min_bet) || 0;
  const maxBuyIn = Math.min(Number(table?.max_bet) || 0, Number(user?.balance) || 0);
  const canAfford = Boolean(table && user && maxBuyIn >= minBuyIn);
  // While the board is still turning over, the hand's outcome stays hidden.
  const result = revealing ? null : state?.result;
  const pendingPayouts = revealing ? state?.result?.payouts || {} : {};
  const chipsShown = (player) => player.chips - (Number(pendingPayouts[player.client_id]) || 0);
  // The showdown snapshot already has pot 0; show what is being paid out instead.
  const payoutTotal = Object.values(pendingPayouts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const potShown = revealing && state?.result ? payoutTotal || state?.pot : state?.pot;

  return (
    <div className="game">
      <div className="background"><div className="glow glow-1" /><div className="glow glow-2" /><div className="glow glow-3" /><div className="cityscape" /><div className="suit-badge" style={{ left: '12%', top: '15%' }}>♠</div><div className="suit-badge" style={{ left: '25%', top: '35%' }}>♥</div><div className="suit-badge" style={{ right: '15%', top: '20%' }}>♣</div><div className="suit-badge" style={{ right: '22%', top: '40%' }}>♦</div></div>

      <header className="header"><div className="room-panel"><button className="menu-button" aria-label="Menu"><span /><span /><span /></button><div><div className="room-title"><strong>Poker777</strong> | {table?.name || 'Table'} <small>#{roomCode}</small></div><div className="room-subtitle">No Limit Hold'em • {state?.big_blind ? `Blinds ${fmtChips(state.small_blind)} / ${fmtChips(state.big_blind)} • ` : ''}Buy-in {fmtChips(table?.min_bet)} – {fmtChips(table?.max_bet)}</div></div><button className="table-tool-button" onClick={toggleMute} title={muted ? 'Sound off' : 'Sound on'} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>{muted ? '🔇' : '🔊'}</button><button className="table-tool-button" onClick={() => setGuideOpen(true)}>Hand guide</button><button className="table-leave-button" onClick={leaveRoom}>{seatRequest === null ? 'Back to lobby' : leavingRef.current ? 'Cashing out…' : 'Leave seat'}</button></div></header>

      {guideOpen && <aside className="hand-guide"><div className="hand-guide-header"><div><h2>Hand rankings</h2></div><button className="guide-close" onClick={() => setGuideOpen(false)}>×</button></div><ol className="hand-ranking-list">{HANDS.map(([name, detail, cards]) => <li key={name}><div><strong>{name}</strong><span>{detail}</span></div><div className={`guide-example ${cards.some((card) => /[♥♦]/.test(card)) ? 'red-cards' : ''}`}>{cards.map((card) => <i key={card}>{card}</i>)}</div></li>)}</ol></aside>}

      {seatRequest !== null && connection === 'reconnecting' && <div className="connection-banner">⚠ Connection lost — reconnecting… Your seat is held for 30 seconds.</div>}

      <section className="table-notifications">{notifications.map((item) => <div key={item.id} className={`table-notification ${item.tone}`}>{item.message}</div>)}</section>

      {seatRequest === null && table && user && (
        <div className="seat-overlay">
          <div className="seat-dialog">
            <h2>Take a seat</h2>
            <p>Buy-in {fmtChips(minBuyIn)} – {fmtChips(table.max_bet)} • Wallet {fmtChips(user.balance)}</p>
            {canAfford ? <>
              <input type="range" min={minBuyIn} max={maxBuyIn} step={1} value={buyIn} onChange={(event) => setBuyIn(Number(event.target.value))} />
              <strong className="seat-amount">{fmtChips(buyIn)}</strong>
              <button className="start-game-button" onClick={() => setSeatRequest(buyIn)}>SIT DOWN</button>
            </> : <p className="seat-warning">You need at least {fmtChips(minBuyIn)} chips in your wallet to sit here.</p>}
            <button className="table-leave-button" onClick={() => navigate('/lobby')}>Back to lobby</button>
          </div>
        </div>
      )}

      <main className="table-wrapper"><div className="table-outer-glow"><div className="table-border"><div className="table">
        {result && !inHand ? (
          <div className={`winner-banner ${result.winnerIds.includes(myId) ? 'is-me' : ''}`} role="status">
            <span className="winner-trophy">🏆</span>
            <div>
              <strong>{result.winnerIds.map((id) => (id === myId ? 'You' : players.find((player) => player.client_id === id)?.username || 'Player')).join(' & ')} {result.final ? 'win the table' : result.winnerIds.length > 1 ? 'split the pot' : 'won'} {fmtChips(winnerAmount(result, players))}</strong>
              <small>{result.hand ? `with ${result.hand}` : 'everyone else folded'}</small>
            </div>
          </div>
        ) : <div className="pot"><span>POT</span><strong>{fmtChips(potShown)}</strong></div>}
        <div className="turn-timer" style={{ visibility: inHand && state?.current_turn ? 'visible' : 'hidden' }}><div className={`timer-ring ${timeLeftPct <= 34 ? 'is-low' : ''}`} style={{ '--left': `${timeLeftPct}%` }}><span>{countdown}</span></div><div><strong>{myTurn ? 'Your Turn' : `${currentTurnName || 'Waiting'}'s turn`}</strong><small>{state?.phase || ''}{currentBet ? ` • to call ${fmtChips(currentBet)}` : ''}</small></div></div>
        <section className="community-area"><div className="community-title">COMMUNITY CARDS</div><div className="community-cards">{shownBoard.map((card, index) => <PlayingCard key={index} card={card} className="user-card community-card" />)}</div></section>
        <div className="live-player-list">{Array.from({ length: maxPlayers }, (_, seat) => {
          const player = players.find((item) => item.seat === seat);
          const { style: seatStyle, side } = seatPosition(seat, me ? me.seat : 0, maxPlayers);
          if (!player) return <div key={seat} className={`waiting-seat seat-${side}`} style={seatStyle}>Empty seat</div>;
          const isMe = player.client_id === myId;
          if (isMe) return null; // shown in the panel at the bottom instead
          const isTurn = inHand && state?.current_turn === player.client_id;
          const isDealer = state?.dealer_seat === seat && (inHand || result);
          const won = result?.winnerIds.includes(player.client_id);
          const payout = won ? Number(result.payouts?.[player.client_id]) || 0 : 0;
          const tags = [player.status, player.bet && (state.betsKnown || (isMe && state.ownBetKnown)) ? `Bet ${fmtChips(player.bet)}` : null].filter(Boolean).join(' • ');
          return <div key={seat} className={`player live-player seat-${side} ${isTurn ? 'is-turn' : ''} ${won ? 'is-winner' : ''}`} style={seatStyle}>{isDealer && <span className="dealer-chip" title="Dealer">D</span>}{won && !inHand && payout > 0 ? <div className="seat-action act-win">+{fmtChips(payout)}</div> : player.act && <div className={`seat-action act-${player.act.kind}`}>{player.act.label}</div>}<div className="avatar"><div className="avatar-inner">{player.avatar_id ? <AvatarFace id={player.avatar_id} prefix={`player-${player.client_id}`} /> : String(player.username || '?').slice(0, 1).toUpperCase()}</div></div><div className="player-info"><div className="player-name">{isMe ? `${player.username} (you)` : player.username}</div><div className="player-chips">🪙 {fmtChips(chipsShown(player))}</div><div className="player-status">{tags}</div>{!isMe && !revealing && player.hole_cards.length > 0 && <div className="seat-cards">{player.hole_cards.map((card, index) => <PlayingCard key={index} card={card} className="mini-playing-card" />)}</div>}</div></div>;
        })}</div>
        <div className="live-room-status">{state ? `${players.length}/${maxPlayers} players • ${inHand ? state.phase : nextHandIn ? `next hand in ${nextHandIn}s` : 'WAITING'}` : roomStatus}</div><div className="current-hand"><strong>{hand.name}</strong><span>{hand.detail}</span></div>
      </div></div></div></main>

      <div className="table-dock">
      <section className={`user-section ${myTurn ? 'is-your-turn' : ''} ${me?.status === 'FOLDED' ? 'is-folded' : ''}`}><div className="user-avatar"><div className="avatar-art"><AvatarFace id={normalizeAvatarId(user?.avatar_id)} prefix="user" /></div></div><div className="user-info"><div className="user-name">{me?.username || user?.display_name || user?.username || 'Me'}</div><div className="user-chips">{me ? `🪙 ${fmtChips(chipsShown(me))} at table` : `Wallet ${fmtChips(user?.balance)}`}</div>{me && <div className="user-tags">{[state?.dealer_seat === me.seat && (inHand || result) ? 'Dealer' : null, me.act?.label || (waitingForNextHand ? 'Next hand' : me.status), me.bet && state?.ownBetKnown ? `Bet ${fmtChips(me.bet)}` : null].filter(Boolean).join(' • ')}</div>}<div className="progress"><div className={`progress-value ${myTurn && timeLeftPct <= 34 ? 'is-low' : ''}`} style={{ width: `${myTurn ? timeLeftPct : 0}%` }} /></div></div><div className="user-cards">{(me?.hole_cards || []).map((card, index) => <PlayingCard key={index} card={card} className="user-card" />)}</div></section>

      <section className={`action-bar ${inHand ? 'in-hand' : 'between-hands'}`}>
        {isHost && !inHand && me && <button className="start-game-button" disabled={readyPlayers < 2} title={readyPlayers < 2 ? 'Need at least 2 players with chips' : 'Start the next hand now'} onClick={() => send('start-game')}>{readyPlayers < 2 ? 'WAITING FOR PLAYERS' : nextHandIn ? <>START NOW <small>auto in {nextHandIn}s</small></> : 'START GAME'}</button>}
        {!isHost && !inHand && me && <div className="waiting-hint">{readyPlayers < 2 ? 'Waiting for more players…' : nextHandIn ? `Next hand starts in ${nextHandIn}s` : 'Waiting for the next hand…'}</div>}
        {waitingForNextHand && <div className="waiting-hint">You're seated — you'll be dealt in next hand</div>}
        {inHand && !waitingForNextHand && <>
        <button className="action-button fold" disabled={!myTurn} onClick={() => act('FOLD')}><span className="action-icon">✕</span><strong>FOLD</strong></button>
        <button className="action-button check" disabled={!myTurn || !canCheck} onClick={() => act('CHECK')}><span className="action-icon">✓</span><strong>CHECK</strong></button>
        <button className="action-button call" disabled={!myTurn || !canCall} onClick={() => act('CALL')}><span className="action-icon">↔</span><strong>CALL{state?.ownBetKnown && toCall ? ` ${fmtChips(Math.min(toCall, myChips))}` : ''}</strong></button>
        <div className="bet-control">
          <div className="bet-quick">
            <button type="button" disabled={!myTurn || !canRaise} onClick={() => { setBetDraft(null); setRaiseTo(minTarget); }}>Min</button>
            <button type="button" disabled={!myTurn || !canRaise || pot <= 0} onClick={() => { setBetDraft(null); setRaiseTo(clampBet(halfPotTarget)); }}>½ Pot</button>
            <button type="button" disabled={!myTurn || !canRaise || pot <= 0} onClick={() => { setBetDraft(null); setRaiseTo(clampBet(potTarget)); }}>Pot</button>
          </div>
          <div className="bet-row">
            <button className="small-control" disabled={!myTurn || target <= minTarget} onClick={() => nudgeBet(-1)} aria-label={`Decrease by ${step}`}>−</button>
            <label className="bet-value">
              <span>{isBet ? 'BET' : 'RAISE TO'} <em>±{fmtChips(step)}</em></span>
              <input
                className={`bet-input ${draftTooLow || draftTooHigh ? 'is-invalid' : ''}`}
                type="number"
                inputMode="numeric"
                min={minTarget}
                max={maxTarget}
                step={step}
                disabled={!myTurn || !canRaise}
                value={betDraft ?? target}
                onChange={(event) => setBetDraft(event.target.value)}
                onBlur={commitBetDraft}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitBetDraft(); } }}
                aria-label="Bet amount"
              />
            </label>
            <button className="small-control" disabled={!myTurn || target >= maxTarget} onClick={() => nudgeBet(1)} aria-label={`Increase by ${step}`}>+</button>
          </div>
          {draftTooLow && <div className="bet-hint">Minimum {fmtChips(minTarget)}</div>}
          {draftTooHigh && <div className="bet-hint">You have {fmtChips(maxTarget)} — that is all-in</div>}
        </div>
        <button className="action-button raise" disabled={!myTurn || !canRaise} onClick={() => act(isBet ? 'BET' : 'RAISE', commitBetDraft())}><span>{isBet ? 'BET' : 'RAISE TO'}</span><strong>{fmtChips(betDraft === null ? target : clampBet(betDraft))}</strong></button>
        <button className="action-button bet" disabled={!myTurn || myChips <= 0} onClick={allIn}><span>ALL IN</span><strong>{fmtChips(maxTarget)}</strong></button>
        </>}
      </section>
      </div>
    </div>
  );
}

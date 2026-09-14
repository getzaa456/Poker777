import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE, Auth, Tables, fmtChips, getToken } from '../lib/api.js';
import { AvatarFace, normalizeAvatarId } from '../components/avatars.jsx';
import { usePageStyles } from '../hooks/usePageStyles.js';

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

function parseCard(card) {
  if (typeof card === 'string') {
    const suitCode = card.slice(-1);
    return { rank: card.slice(0, -1), suit: suitCode };
  }
  return card || { rank: '', suit: '' };
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
  if (suitStraight) return { name: suitStraight === 14 ? 'Royal flush' : 'Straight flush', detail: 'Five cards in sequence, same suit' };
  if (groups[0]?.[1] === 4) return { name: 'Four of a kind', detail: `${groups[0][0]} four of a kind` };
  if (groups[0]?.[1] === 3 && groups[1]?.[1] >= 2) return { name: 'Full house', detail: `${groups[0][0]} full of ${groups[1][0]}` };
  if (flush) return { name: 'Flush', detail: 'Five cards share a suit' };
  if (straight) return { name: 'Straight', detail: 'Five cards in sequence' };
  if (groups[0]?.[1] === 3) return { name: 'Three of a kind', detail: `Three ${groups[0][0]}s` };
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) return { name: 'Two pair', detail: `${groups[0][0]} and ${groups[1][0]}` };
  if (groups[0]?.[1] === 2) return { name: 'Pair', detail: `Pair of ${groups[0][0]}s` };
  return { name: 'High card', detail: `High card ${cards[0].rank}` };
}

export default function PokerTablePage() {
  usePageStyles('/assets/css/poker-table.css');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const roomCode = searchParams.get('code');
  const socketRef = useRef(null);
  const lastActionKey = useRef('');
  const [user, setUser] = useState(null);
  const [table, setTable] = useState(null);
  const [state, setState] = useState(null);
  const [roomStatus, setRoomStatus] = useState('Connecting to table...');
  const [betAmount, setBetAmount] = useState(100);
  const [guideOpen, setGuideOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [countdown, setCountdown] = useState('--');

  function notify(message, tone = '') {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications((items) => [{ id, message, tone }, ...items]);
    setTimeout(() => setNotifications((items) => items.filter((item) => item.id !== id)), 5000);
  }

  useEffect(() => {
    document.title = 'Poker777 — Game Room';
    if (!Auth.hasSession() || !roomCode) {
      navigate(Auth.hasSession() ? '/lobby' : '/', { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const current = await Auth.me();
        const tableInfo = await Tables.get(roomCode);
        if (cancelled) return;
        setUser(current);
        setTable(tableInfo);
        const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(getToken())}`;
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;
        socket.addEventListener('open', () => {
          setRoomStatus('Connected. Joining table...');
          socket.send(JSON.stringify({ type: 'join', params: { type: 'join', clientId: String(current.id), roomCode: roomCode.toUpperCase(), buyIn: Number(tableInfo.min_bet) } }));
        });
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (['TABLE_STATE', 'GAME_STARTED', 'SHOWDOWN'].includes(message.type)) setState(message.params);
          if (message.type === 'GAME_ACTION') setRoomStatus(`${message.params.client_id} selected ${message.params.action}`);
          if (message.type === 'LEFT_ROOM') navigate('/lobby');
          if (message.type === 'error') setRoomStatus(message.error || 'Unable to join table');
        });
        socket.addEventListener('close', () => setRoomStatus('Disconnected from table'));
        socket.addEventListener('error', () => setRoomStatus('WebSocket connection failed'));
      } catch (error) {
        if (!cancelled) setRoomStatus(error.message || 'Unable to join table');
      }
    })();

    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [navigate, roomCode]);

  useEffect(() => {
    if (!state?.turn_deadline) {
      setCountdown('--');
      return;
    }
    const tick = () => setCountdown(String(Math.max(0, Math.ceil((Number(state.turn_deadline) - Date.now()) / 1000))));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state?.turn_deadline]);

  useEffect(() => {
    if (!state?.last_action || !user) return;
    const action = state.last_action;
    const key = `${action.client_id}:${action.action}:${action.amount}:${action.timed_out}`;
    if (lastActionKey.current && lastActionKey.current !== key) {
      const actor = state.players?.find((player) => String(player.client_id) === String(action.client_id));
      notify(`${actor?.username || action.client_id} chose ${action.action}${action.timed_out ? ' (time expired, folded)' : ''}`, action.timed_out ? 'warning' : '');
    }
    lastActionKey.current = key;
  }, [state?.last_action, state?.players, user]);

  const players = state?.players || [];
  const maxPlayers = Number(state?.max_players || table?.max_seats || 6);
  const me = players.find((player) => String(player.client_id) === String(user?.id));
  const myTurn = Boolean(state?.current_turn && String(state.current_turn) === String(user?.id));
  const isHost = Boolean(state && user && String(state.host_id) === String(user.id));
  const hand = useMemo(() => evaluateHand([...(me?.hole_cards || []), ...(state?.community_cards || [])]), [me?.hole_cards, state?.community_cards]);

  useEffect(() => {
    if (!state) return;
    setRoomStatus(`${players.length}/${maxPlayers} players connected • ${state.phase || 'WAITING'}${state.last_action ? ` • ${state.last_action.action}` : ''}`);
  }, [state, players.length, maxPlayers]);

  function send(type, params) {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(params ? { type, params } : { type }));
  }

  function leaveRoom() {
    if (socketRef.current?.readyState === WebSocket.OPEN) send('LEAVE_ROOM');
    else navigate('/lobby');
  }

  const disabledActions = !state || state.phase === 'WAITING' || !myTurn;

  return (
    <div className="game">
      <div className="background"><div className="glow glow-1" /><div className="glow glow-2" /><div className="glow glow-3" /><div className="cityscape" /><div className="suit-badge" style={{ left: '12%', top: '15%' }}>♠</div><div className="suit-badge" style={{ left: '25%', top: '35%' }}>♥</div><div className="suit-badge" style={{ right: '15%', top: '20%' }}>♣</div><div className="suit-badge" style={{ right: '22%', top: '40%' }}>♦</div></div>

      <header className="header"><div className="room-panel"><button className="menu-button" aria-label="Menu"><span /><span /><span /></button><div><div className="room-title"><strong>Poker777</strong> | {table?.name || 'Dream Room'}</div><div className="room-subtitle">No Limit Hold'em • Blinds {fmtChips(table?.min_bet)} / {fmtChips(table?.max_bet)}</div></div><button className="table-tool-button" onClick={() => setGuideOpen(true)}>Hand guide</button><button className="table-leave-button" onClick={leaveRoom}>Leave</button></div></header>

      {guideOpen && <aside className="hand-guide"><div className="hand-guide-header"><div><h2>Hand rankings</h2></div><button className="guide-close" onClick={() => setGuideOpen(false)}>×</button></div><ol className="hand-ranking-list">{HANDS.map(([name, detail, cards]) => <li key={name}><div><strong>{name}</strong><span>{detail}</span></div><div className={`guide-example ${cards.some((card) => /[♥♦]/.test(card)) ? 'red-cards' : ''}`}>{cards.map((card) => <i key={card}>{card}</i>)}</div></li>)}</ol></aside>}

      <section className="table-notifications">{notifications.map((item) => <div key={item.id} className={`table-notification ${item.tone}`}>{item.message}</div>)}</section>

      <main className="table-wrapper"><div className="table-outer-glow"><div className="table-border"><div className="table">
        <div className="pot"><span>POT</span><strong>{fmtChips(state?.pot)}</strong></div>
        <div className="turn-timer" style={{ visibility: state?.current_turn ? 'visible' : 'hidden' }}><div className="timer-ring"><span>{countdown}</span></div><div><strong>{myTurn ? 'Your Turn' : `${state?.current_turn_name || 'Waiting'}'s turn`}</strong><small>{state?.winner ? `${state.winner_name || state.winner} wins with ${state.winning_hand || 'best hand'}` : `${state?.last_action ? `${state.last_action.action} played` : ''} ${state?.phase || ''}`}</small></div></div>
        <section className="community-area"><div className="community-title">COMMUNITY CARDS</div><div className="community-cards">{(state?.community_cards || []).map((card, index) => <PlayingCard key={index} card={card} className="user-card community-card" />)}</div></section>
        <div className="live-player-list">{Array.from({ length: maxPlayers }, (_, seat) => {
          const player = players.find((item) => Number(item.seat) === seat);
          if (!player) return <div key={seat} className={`waiting-seat player-seat-${seat}`}>Waiting for player</div>;
          if (String(player.client_id) === String(user?.id)) return <div key={seat} className={`waiting-seat player-seat-${seat}`}>Your seat</div>;
          return <div key={seat} className={`player live-player player-seat-${seat}`}><div className="avatar"><div className="avatar-inner">{player.avatar_id ? <AvatarFace id={player.avatar_id} prefix={`player-${player.client_id}`} /> : String(player.username || player.client_id || '?').slice(0, 1).toUpperCase()}</div></div><div className="player-info"><div className="player-name">{player.username || player.client_id}</div><div className="player-chips">🪙 {fmtChips(player.chips)}</div><div className="player-status">{player.status || 'WAITING'}</div></div></div>;
        })}</div>
        <div className="live-room-status">{roomStatus}</div><div className="current-hand"><strong>{hand.name}</strong><span>{hand.detail}</span></div>
      </div></div></div></main>

      <section className={`user-section ${myTurn ? 'is-your-turn' : ''}`}><div className="user-avatar"><div className="avatar-art"><AvatarFace id={normalizeAvatarId(user?.avatar_id)} prefix="user" /></div></div><div className="user-info"><div className="user-name">{me?.username || user?.username || 'Me'}</div><div className="user-chips">{fmtChips(me?.chips ?? user?.balance)}</div><div className="progress"><div className="progress-value" /></div></div><div className="user-cards">{(me?.hole_cards || []).map((card, index) => <PlayingCard key={index} card={card} className="user-card" />)}</div></section>

      <section className="action-bar">
        {isHost && state?.phase === 'WAITING' && <button className="start-game-button" onClick={() => send('START_GAME')}>START GAME</button>}
        {['FOLD','CHECK','CALL'].map((action) => <button key={action} className={`action-button ${action.toLowerCase()}`} disabled={disabledActions} onClick={() => send('GAME_ACTION', { action, amount: 0 })}><span className="action-icon">{action === 'FOLD' ? '✕' : action === 'CHECK' ? '✓' : '↔'}</span><strong>{action}</strong></button>)}
        <div className="bet-control"><button className="small-control" onClick={() => setBetAmount((value) => Math.max(10, value - 10))}>−</button><div className="bet-value"><span>BET</span><strong>{betAmount}</strong></div><button className="small-control" onClick={() => setBetAmount((value) => value + 10)}>+</button></div>
        <button className="action-button bet" disabled={disabledActions} onClick={() => send('GAME_ACTION', { action: 'BET', amount: betAmount })}><span>BET</span><strong>{betAmount}</strong></button>
        <button className="action-button raise" disabled={disabledActions} onClick={() => send('GAME_ACTION', { action: 'RAISE', amount: betAmount })}><span>RAISE TO</span><strong>{betAmount}</strong></button>
      </section>
    </div>
  );
}

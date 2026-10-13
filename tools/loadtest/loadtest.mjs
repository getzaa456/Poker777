// Poker777 load test: N bots that register/log in, take seats and play real hands over WebSocket.
//
//   node loadtest.mjs --base https://poker777.club --room TREJ5B --bots 10 --minutes 5
//
// --room     fill this room first (a table has at most 9 seats); extra bots go to new bot-hosted rooms
// --bots     total bots (default 10)
// --minutes  how long to play before everyone leaves (default 5)
// --per-room seats to fill in each new bot room (default 6, max 9)
// --reuse-only use only saved accounts whose token still works: never registers or logs in
// --accounts-only create/refresh the accounts, then exit without playing
// --browse-rps  once seated, also open the room list / wallet history N times a second (pages served by the read replicas)
// --seat-parallel N  fill N rooms at once while seating (default 1)
//
// Accounts are saved in .bots.json next to this file and reused (tokens last 24h), so only the
// first run has to wait for the server's login/register rate limit (10 per minute per IP).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1] === undefined || all[index + 1].startsWith('--') ? 'true' : all[index + 1]]); // a bare flag (even the last one) means true
  return pairs;
}, []));
const BASE = (args.base || 'http://localhost:4000').replace(/\/$/, '');
const WS_URL = `${BASE.replace(/^http/, 'ws')}/ws`;
const TOTAL = Number(args.bots || 10);
const MINUTES = Number(args.minutes || 5);
const PER_ROOM = Math.min(9, Number(args['per-room'] || 6));
const IS_LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const AUTH_GAP_MS = IS_LOCAL ? 50 : 6500; // stay under 10 auth calls / minute / IP
const REUSE_ONLY = args['reuse-only'] === 'true';
const ACCOUNTS_ONLY = args['accounts-only'] === 'true';
const BROWSE_RPS = Number(args['browse-rps'] || 0);
const SEAT_PARALLEL = Math.max(1, Math.min(20, Number(args['seat-parallel'] || 1)));
const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.bots.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);

const stats = { actions: 0, latencies: [], errors: {}, hands: 0, disconnects: 0, joinFailed: 0, rest: [], restLimited: 0, restFailed: 0 };
const bump = (key) => { stats.errors[key] = (stats.errors[key] || 0) + 1; };

async function api(pathname, { method = 'GET', body, token } = {}, tries = 3) {
  let res;
  try {
    res = await fetch(BASE + pathname, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // our own internet hiccup (ECONNRESET, timeout) — try again instead of killing every bot
    if (tries <= 1) throw err;
    console.log(`  network error on ${method} ${pathname} (${err.cause?.code || err.message}) — retrying in 3s`);
    await sleep(3000);
    return api(pathname, { method, body, token }, tries - 1);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429 && !pathname.startsWith('/auth/')) {
    console.log(`  rate limited on ${method} ${pathname} — waiting 60s`);
    await sleep(60_000);
    return api(pathname, { method, body, token });
  }
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `HTTP ${res.status}`), { status: res.status, code: data?.error?.code });
  return data;
}

// ---- accounts (created once, then reused) ----
function loadStore() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; } }
function saveStore(store) { fs.writeFileSync(STORE, JSON.stringify(store, null, 2)); }

async function ensureAccounts(count) {
  const store = loadStore();
  store[BASE] ||= [];
  const accounts = store[BASE];
  for (let index = 0; index < count; index += 1) {
    let account = accounts[index];
    const fresh = account?.token && account.tokenAt && Date.now() - account.tokenAt < 20 * 3600 * 1000;
    if (fresh && !IS_LOCAL) continue; // remote DB keeps its users; tokens last 24h
    if (fresh) {
      // The token must still belong to this bot (an in-memory demo server forgets everyone on restart).
      // Paced and retried: the server allows ~100 API calls a minute per IP, and a 429 here does not
      // mean the account is gone.
      let me = null;
      for (;;) {
        try { me = await api('/users/me', { token: account.token }); break; } catch (error) {
          if (error.status === 429) { console.log('  rate limited (account check) — waiting 60s'); await sleep(60_000); continue; }
          break;
        }
      }
      if (!IS_LOCAL) await sleep(700);
      if (me?.user?.username === account.username) continue;
      account = null;
    }
    if (REUSE_ONLY) { accounts[index] = null; console.log(`  account ${index + 1}/${count}: no working saved token, skipped`); continue; }
    for (;;) {
      try {
        if (!account) {
          const tag = Math.random().toString(36).slice(2, 7);
          account = { username: `bot_${tag}`, password: `bot-pass-${Math.random().toString(36).slice(2, 12)}` };
          const data = await api('/auth/register', { method: 'POST', body: { username: account.username, email: `${account.username}@bots.poker777.test`, password: account.password } });
          Object.assign(account, { id: String(data.user.id), token: data.token, tokenAt: Date.now() });
          accounts[index] = account;
        } else {
          const data = await api('/auth/login', { method: 'POST', body: { identifier: account.username, password: account.password } });
          Object.assign(account, { id: String(data.user.id), token: data.token, tokenAt: Date.now() });
        }
        saveStore(store);
        console.log(`  account ${index + 1}/${count}: ${account.username}`);
        break;
      } catch (error) {
        if (error.status === 429) {
          // A register that was refused never created the account: register it again, don't log in.
          if (!account?.id) account = null;
          console.log('  rate limited — waiting 60s');
          await sleep(60_000);
          continue;
        }
        // Saved account no longer exists (e.g. the in-memory demo server restarted): make a new one.
        if (error.status === 401 && account?.id) { account = null; continue; }
        throw error;
      }
      finally { await sleep(AUTH_GAP_MS); }
    }
  }
  return accounts.slice(0, count).filter(Boolean);
}

// ---- one bot ----
class Bot {
  // counter: one bot per room counts finished hands, so a hand isn't counted once per player
  constructor(account, roomCode, buyIn, autostart, counter = autostart) {
    Object.assign(this, { account, roomCode, buyIn, autostart, counter, state: null, pending: null, closed: false, seated: false });
  }

  // Resolves once seated. A reconnect reuses the same promise (a new one would leave the caller waiting
  // forever), and a seat that never comes counts as a failed join after 30 s so seating carries on.
  connect() {
    return new Promise((resolve) => {
      this.onSeated = (ok) => { clearTimeout(this.seatTimer); this.onSeated = null; resolve(ok); };
      this.seatTimer = setTimeout(() => { if (!this.seated && this.onSeated) { stats.joinFailed += 1; this.onSeated(false); } }, 30_000);
      this.open();
    });
  }

  open() {
    this.ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(this.account.token)}`, { headers: { origin: BASE } });
    this.ws.on('open', () => this.send('join', { clientId: this.account.id, roomCode: this.roomCode, buyIn: this.buyIn }));
    this.ws.on('message', (raw) => this.onMessage(JSON.parse(raw)));
    this.ws.on('close', () => { if (!this.closed) { stats.disconnects += 1; setTimeout(() => this.open(), 2000); } });
    this.ws.on('error', () => {});
  }

  send(type, params) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(params ? { type, params } : { type }));
  }

  onMessage(message) {
    const { type } = message;
    const params = message.params || {};
    if (type === 'join') { this.seated = true; this.onSeated?.(true); }
    if (type === 'error') {
      bump(message.error);
      if (!this.seated) { stats.joinFailed += 1; this.closed = true; this.ws.close(); this.onSeated?.(false); return; }
      if (this.pending) this.fallback();
      return;
    }
    if (['table_state', 'game_started', 'showdown', 'tournament_finished'].includes(type)) {
      this.state = params;
      if (type === 'showdown' && this.counter) stats.hands += 1;
    }
    if (type === 'winner' && this.counter) stats.hands += 1;
    if (type === 'game-action' && String(params.clientId) === this.account.id && this.pending) {
      stats.actions += 1;
      stats.latencies.push(Date.now() - this.pending.at);
      this.pending = null;
    }
    const turn = type === 'turn-start' ? String(params.clientId) : (params.current_turn ? String(params.current_turn) : null);
    if (turn === this.account.id && ['turn-start', 'game_started', 'table_state'].includes(type)) this.think();
    if (this.autostart && ['showdown', 'winner', 'player-join', 'table_state', 'tournament_finished'].includes(type)) this.maybeStart();
  }

  think() {
    setTimeout(() => {
      const roll = Math.random();
      const action = roll < 0.08 ? 'FOLD' : roll < 0.2 ? 'RAISE' : 'CALL';
      this.act(action);
    }, rand(400, 1800));
  }

  act(action, step = 0) {
    this.pending = { at: Date.now(), action, step };
    const bet = Number(this.state?.current_bet || 0);
    const amount = action === 'RAISE' ? bet + Math.max(Number(this.state?.min_raise || 20), 20) : 0;
    this.send('game-action', { action: action === 'RAISE' && bet === 0 ? 'BET' : action, amount: action === 'RAISE' && bet === 0 ? 20 : amount });
  }

  // Rejected move (e.g. nothing to call): try the next safest one.
  fallback() {
    const order = ['CALL', 'CHECK', 'FOLD'];
    const next = order[Math.min(order.length - 1, (this.pending.step || 0) + (this.pending.action === 'CHECK' ? 2 : 1))];
    if (this.pending.step >= 3) { this.pending = null; return; }
    this.act(next, this.pending.step + 1);
  }

  maybeStart() {
    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      // The server checks there are 2+ players with chips; a rejected start is harmless.
      const inHand = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(this.state?.phase);
      if (!inHand) this.send('start-game');
    }, 2500);
  }

  leave() { this.closed = true; this.send('leave-room'); setTimeout(() => this.ws.terminate(), 1500); }
}

// ---- run ----
console.log(`Poker777 load test → ${BASE} | bots=${TOTAL} | ${MINUTES} min${args.room ? ` | room ${args.room}` : ''}`);
const accounts = await ensureAccounts(TOTAL);
if (accounts.length < TOTAL) console.log(`using ${accounts.length} of ${TOTAL} bots (reuse-only)`);
const PLAYERS = accounts.length;
if (ACCOUNTS_ONLY) { console.log(`${PLAYERS} accounts ready — exiting (--accounts-only)`); process.exit(0); }
const bots = [];
let cursor = 0;

if (args.room) {
  const table = (await api(`/tables/${args.room}`, { token: accounts[0].token })).table;
  const free = Math.max(0, Number(table.max_seats) - Number(table.seats_taken || 0));
  console.log(`room ${args.room}: ${table.seats_taken}/${table.max_seats} seated → adding ${Math.min(free, PLAYERS)} bots`);
  for (; cursor < Math.min(free, PLAYERS); cursor += 1) {
    const bot = new Bot(accounts[cursor], args.room, Number(table.min_bet), false, cursor === 0);
    bots.push(bot);
    await bot.connect();
    await sleep(300);
  }
}

// --seat-parallel N: fill N rooms at the same time (thousands of bots otherwise take hours to sit down).
// Each worker reserves its block of accounts before any await, so two workers never share a bot.
async function seatWorker() {
  while (cursor < PLAYERS) {
    const first = cursor;
    const size = Math.min(PER_ROOM, PLAYERS - first);
    cursor += size;
    const table = (await api('/tables', { method: 'POST', token: accounts[first].token, body: { name: `Load test ${first}`, min_bet: 100, max_bet: 500, max_seats: 9 } })).table;
    console.log(`room ${table.room_code}: seating ${size} bots`);
    for (let seat = 0; seat < size; seat += 1) {
      const bot = new Bot(accounts[first + seat], table.room_code, 100, seat === 0);
      bots.push(bot);
      await bot.connect();
      await sleep(250);
    }
  }
}
const seatingTicker = setInterval(() => console.log(`seating… ${bots.filter((bot) => bot.seated).length}/${PLAYERS} seated, failed joins ${stats.joinFailed}, disconnects ${stats.disconnects}`), 30_000);
await Promise.all(Array.from({ length: SEAT_PARALLEL }, seatWorker));
clearInterval(seatingTicker);

const percentile = (values, p) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; };
const maxOf = (values) => values.reduce((top, value) => (value > top ? value : top), 0);

// Browsing: the pages a real player opens between hands. They read from the RDS read replicas.
const BROWSE = ['/tables', '/wallet/history', '/wallet/transactions?page=1&limit=10'];
let browseTimer = null;
if (BROWSE_RPS > 0 && accounts.length) {
  let turn = 0;
  browseTimer = setInterval(async () => {
    const account = accounts[Math.floor(Math.random() * accounts.length)];
    const pathname = BROWSE[turn++ % BROWSE.length];
    const at = Date.now();
    try {
      const res = await fetch(BASE + pathname, { headers: { authorization: `Bearer ${account.token}`, origin: BASE } });
      await res.arrayBuffer();
      if (res.status === 429) stats.restLimited += 1;
      else if (!res.ok) stats.restFailed += 1;
      else stats.rest.push(Date.now() - at);
    } catch { stats.restFailed += 1; }
  }, Math.max(50, 1000 / BROWSE_RPS));
}

const report = () => {
  const lat = stats.latencies;
  const rest = stats.rest;
  console.log(`[${new Date().toLocaleTimeString()}] seated=${bots.filter((bot) => bot.seated && !bot.closed).length}/${PLAYERS} actions=${stats.actions} hands=${stats.hands} `
    + `latency p50=${percentile(lat, 0.5)}ms p95=${percentile(lat, 0.95)}ms p99=${percentile(lat, 0.99)}ms max=${maxOf(lat)}ms `
    + `browse n=${rest.length} p50=${percentile(rest, 0.5)}ms p95=${percentile(rest, 0.95)}ms limited=${stats.restLimited} failed=${stats.restFailed} `
    + `disconnects=${stats.disconnects} errors=${JSON.stringify(stats.errors)}`);
};
const ticker = setInterval(report, 10_000);
const stop = async () => {
  clearInterval(ticker);
  clearInterval(browseTimer);
  report();
  console.log('leaving tables…');
  bots.forEach((bot) => bot.leave());
  await sleep(2500);
  process.exit(0);
};
process.on('SIGINT', stop);
setTimeout(stop, MINUTES * 60_000);

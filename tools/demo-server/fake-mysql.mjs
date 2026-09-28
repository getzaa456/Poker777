// In-memory stand-in for mysql2/promise covering only the queries Poker777 issues.
const db = { users: [], wallets: new Map(), transactions: [], tables: [] };
globalThis.__fakeDb = db;
let ids = { users: 0, tables: 0, tx: 0 };
const norm = (s) => s.replace(/\s+/g, ' ').trim();

async function query(sql, p = {}) {
  const q = norm(sql);
  if (q.startsWith('SELECT username FROM users WHERE username')) return [db.users.filter((u) => u.username === p.username || u.email === p.email).slice(0, 1)];
  if (q.startsWith('INSERT INTO users')) { const id = ++ids.users; db.users.push({ id, username: p.username, email: p.email, password_hash: p.passwordHash, display_name: null, avatar_id: null, created_at: new Date() }); return [{ insertId: id }]; }
  if (q.startsWith('INSERT INTO wallets')) { db.wallets.set(String(p.userId), Number(p.bonus)); return [{}]; }
  if (q.startsWith('INSERT INTO transactions')) {
    if (db.transactions.some((t) => t.ref_id === p.refId)) { const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; throw e; }
    const type = p.txType || (q.includes("'BONUS'") ? 'BONUS' : q.includes("'TOPUP'") ? 'TOPUP' : 'X');
    db.transactions.push({ id: ++ids.tx, user_id: String(p.userId), amount: Number(p.amount ?? p.bonus), type, ref_id: p.refId, balance_after: Number(p.balanceAfter ?? p.bonus), note: p.note || null, created_at: new Date() });
    return [{}];
  }
  if (q.startsWith('SELECT id, username, email, password_hash FROM users')) return [db.users.filter((u) => u.username === p.identifier || u.email === p.identifier).slice(0, 1)];
  if (q.startsWith('SELECT u.id, u.username')) { const u = db.users.find((x) => String(x.id) === String(p.userId)); return [u ? [{ ...u, balance: db.wallets.get(String(u.id)) ?? 0 }] : []]; }
  if (q.startsWith('UPDATE users SET')) { const u = db.users.find((x) => String(x.id) === String(p.userId)); if (u) { if (p.avatar_id != null) u.avatar_id = p.avatar_id; if (p.display_name != null) u.display_name = p.display_name; } return [{ affectedRows: u ? 1 : 0 }]; }
  if (q.startsWith('SELECT balance FROM wallets')) { const b = db.wallets.get(String(p.userId)); return [b === undefined ? [] : [{ balance: b }]]; }
  if (q.startsWith('UPDATE wallets SET balance')) { db.wallets.set(String(p.userId), Number(p.balanceAfter)); return [{}]; }
  if (q.startsWith('SELECT balance_after, amount FROM transactions WHERE ref_id')) return [db.transactions.filter((t) => t.ref_id === p.refId)];
  if (q.startsWith('SELECT id, amount, type, ref_id')) return [db.transactions.filter((t) => t.user_id === String(p.userId)).reverse().slice(p.offset, p.offset + p.limit)];
  if (q.startsWith('SELECT COUNT(*) as total FROM transactions')) return [[{ total: db.transactions.filter((t) => t.user_id === String(p.userId)).length }]];
  if (q.startsWith('INSERT INTO tables')) { const id = ++ids.tables; db.tables.push({ id, room_code: p.roomCode, name: p.name, host_id: p.hostId, min_bet: p.minBet, max_bet: p.maxBet, max_seats: p.maxSeats, status: 'OPEN', created_at: new Date() }); return [{ insertId: id }]; }
  if (q.startsWith('SELECT * FROM tables WHERE id')) return [db.tables.filter((t) => t.id === p.id)];
  if (q.startsWith('SELECT * FROM tables WHERE room_code')) return [db.tables.filter((t) => t.room_code === p.code)];
  if (q.startsWith("SELECT * FROM tables WHERE status = 'OPEN'")) return [[...db.tables].reverse()];
  if (q.startsWith('DELETE FROM tables WHERE room_code')) { db.tables = db.tables.filter((t) => t.room_code !== p.roomCode); return [{}]; }
  if (q.startsWith('SELECT 1')) return [[{ 1: 1 }]];
  throw new Error(`fake-mysql: unhandled query: ${q}`);
}
const conn = { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
export function createPool() { return { query, getConnection: async () => conn, end: async () => {} }; }
export default { createPool };

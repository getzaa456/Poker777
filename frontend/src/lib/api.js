const configuredBase = (import.meta.env.VITE_API_BASE || '').trim();
const fallbackBase = `${window.location.protocol}//${window.location.hostname}:4000`;
export const API_BASE = (configuredBase || fallbackBase).replace(/\/$/, '');

const TOKEN_KEY = 'poker777_token';
const USER_KEY = 'poker777_user';
export const AVATAR_KEY = 'poker777_avatar_id';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (user?.avatar_id) localStorage.setItem(AVATAR_KEY, String(user.avatar_id));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error(`Cannot reach server — is the backend running on ${API_BASE} ?`);
    error.code = 'NETWORK';
    error.status = 0;
    throw error;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // API may intentionally return no body.
  }

  if (response.status === 401 && auth && getToken()) {
    clearSession();
    if (window.location.pathname !== '/') window.location.assign('/');
  }

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed (${response.status})`);
    error.code = data?.error?.code;
    error.status = response.status;
    error.details = data?.error?.details;
    throw error;
  }

  return data;
}

export const Auth = {
  async register(payload) {
    const data = await api('/auth/register', { method: 'POST', body: payload, auth: false });
    setSession(data.token, data.user);
    return data;
  },
  async login(identifier, password) {
    const data = await api('/auth/login', { method: 'POST', body: { identifier, password }, auth: false });
    setSession(data.token, data.user);
    return data;
  },
  async me() {
    const data = await api('/users/me');
    return data.user;
  },
  async updateMe(patch) {
    const data = await api('/users/me', { method: 'PATCH', body: patch });
    return data.user;
  },
  hasSession() {
    return Boolean(getToken());
  },
  logout() {
    clearSession();
  },
};

export const Wallet = {
  async topUp(amount) {
    return api('/wallet/topup', { method: 'POST', body: { amount } });
  },
  async transactions(page = 1, limit = 20) {
    return api(`/wallet/transactions?page=${page}&limit=${limit}`);
  },
};

export const Tables = {
  async list() {
    const data = await api('/tables');
    return data.tables || [];
  },
  async create(payload) {
    const data = await api('/tables', { method: 'POST', body: payload });
    return data.table;
  },
  async get(roomCode) {
    const data = await api(`/tables/${encodeURIComponent(roomCode)}`);
    return data.table;
  },
  async join(roomCode, payload = {}) {
    const data = await api(`/tables/${encodeURIComponent(roomCode)}/join`, {
      method: 'POST',
      body: payload,
    });
    return data.table;
  },
};

export function fmtChips(value) {
  return Number(value || 0).toLocaleString('en-US');
}

export function fmtTableError(error) {
  const messages = {
    NETWORK: error.message,
    ROOM_NOT_FOUND: 'Room not found — double-check the room code and try again.',
    ROOM_CLOSED: 'This room has been closed by the host.',
    ROOM_IN_PROGRESS: 'This room already has a hand in progress. Try again shortly.',
    ROOM_FULL: 'This room is full.',
    INSUFFICIENT_BALANCE: error.details?.required
      ? `You need ${fmtChips(error.details.required)} chips to join (you have ${fmtChips(error.details.balance)}).`
      : 'Your chip balance is not enough to join this room.',
    BUY_IN_TOO_LOW: error.message,
    BUY_IN_TOO_HIGH: error.message,
    BAD_REQUEST: error.details?.length ? error.details.map((detail) => detail.issue).join(' ') : error.message,
  };
  return messages[error.code] || error.message || 'Something went wrong. Please try again.';
}

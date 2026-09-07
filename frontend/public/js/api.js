/**
 * Poker777 shared API client (Core REST).
 * Exposes window.PokerAPI — used by index.html, lobby.html, poker-table.html.
 */
(function () {
  const API_BASE = window.POKER_API_BASE || 'http://localhost:4000';
  const TOKEN_KEY = 'poker777_token';
  const USER_KEY = 'poker777_user';
  const AVATAR_KEY = 'poker777_avatar_id';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (user && user.avatar_id) localStorage.setItem(AVATAR_KEY, String(user.avatar_id));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * fetch wrapper: JSON in/out, attaches Bearer token, normalizes errors.
   * Throws Error with .code and .status on non-2xx.
   */
  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const t = getToken();
      if (t) headers.Authorization = 'Bearer ' + t;
    }
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (netErr) {
      const e = new Error('Cannot reach server — is the backend running on ' + API_BASE + ' ?');
      e.code = 'NETWORK';
      e.status = 0;
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON */ }

    if (res.status === 401 && auth && getToken()) {
      // Token expired/invalid: clear session and bounce to login (unless already there).
      clearSession();
      if (!/index\.html$/.test(location.pathname) && !location.pathname.endsWith('/')) {
        location.href = 'index.html';
      }
    }
    if (!res.ok) {
      const e = new Error((data && data.error && data.error.message) || ('Request failed (' + res.status + ')'));
      e.code = data && data.error && data.error.code;
      e.status = res.status;
      e.details = data && data.error && data.error.details;
      throw e;
    }
    return data;
  }

  const Auth = {
    /** POST /auth/register -> { token, user } */
    async register(payload) {
      const data = await api('/auth/register', { method: 'POST', body: payload, auth: false });
      setSession(data.token, data.user);
      return data;
    },
    /** POST /auth/login -> { token, user } */
    async login(identifier, password) {
      const data = await api('/auth/login', { method: 'POST', body: { identifier, password }, auth: false });
      setSession(data.token, data.user);
      return data;
    },
    /** GET /users/me -> user object */
    async me() {
      const data = await api('/users/me');
      return data.user;
    },
    /** PATCH /users/me -> user object */
    async updateMe(patch) {
      const data = await api('/users/me', { method: 'PATCH', body: patch });
      return data.user;
    },
    /** Auth guard: redirect to login if no token; then fetch fresh profile. */
    async requireUser() {
      if (!getToken()) {
        location.href = 'index.html';
        return null;
      }
      return Auth.me();
    },
    /** True if there is a saved session in this browser. */
    hasSession() {
      return !!getToken();
    },
    logout() {
      clearSession();
      location.href = 'index.html';
    },
  };

  const Wallet = {
    /** POST /wallet/topup -> { balance, amount, type } */
    async topUp(amount) {
      return api('/wallet/topup', { method: 'POST', body: { amount } });
    },
    /** GET /wallet/transactions?page=&limit= -> { transactions, pagination } */
    async transactions(page = 1, limit = 20) {
      return api('/wallet/transactions?page=' + page + '&limit=' + limit);
    },
  };

  const Tables = {
    /** POST /tables -> { table } — create a room. payload: { name, min_bet, max_bet, max_seats } */
    async create(payload) {
      const data = await api('/tables', { method: 'POST', body: payload });
      return data.table;
    },
    /** GET /tables/:room_code -> table (name, blinds, seats, status) for the waiting-room / join preview. */
    async get(roomCode) {
      const data = await api('/tables/' + encodeURIComponent(roomCode));
      return data.table;
    },
    /** POST /tables/:room_code/join -> validates + returns table. payload: { buy_in? } */
    async join(roomCode, payload) {
      const data = await api('/tables/' + encodeURIComponent(roomCode) + '/join', {
        method: 'POST',
        body: payload || {},
      });
      return data.table;
    },
  };

  /** Format chips with thousands separator, e.g. 2680 -> "2,680". */
  function fmtChips(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /**
   * Turn a thrown API error (see api()/`e.code`) into a short, friendly
   * message for room create/join flows. Falls back to the server message.
   */
  function fmtTableError(err) {
    const messages = {
      NETWORK: err.message,
      ROOM_NOT_FOUND: 'Room not found — double-check the room code and try again.',
      ROOM_CLOSED: 'This room has been closed by the host.',
      ROOM_IN_PROGRESS: 'This room already has a hand in progress. Try again shortly.',
      ROOM_FULL: 'This room is full.',
      INSUFFICIENT_BALANCE:
        err.details && err.details.required
          ? `You need ${fmtChips(err.details.required)} chips to join (you have ${fmtChips(err.details.balance)}).`
          : 'Your chip balance is not enough to join this room.',
      BUY_IN_TOO_LOW: err.message,
      BUY_IN_TOO_HIGH: err.message,
      BAD_REQUEST:
        err.details && err.details.length
          ? err.details.map((d) => d.issue).join(' ')
          : err.message,
    };
    return messages[err.code] || err.message || 'Something went wrong. Please try again.';
  }

  window.PokerAPI = {
    API_BASE,
    api,
    Auth,
    Wallet,
    Tables,
    getToken,
    setSession,
    clearSession,
    fmtChips,
    fmtTableError,
    AVATAR_KEY,
  };
})();
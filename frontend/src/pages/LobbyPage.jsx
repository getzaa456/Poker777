import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth, Tables, Wallet, fmtChips } from '../lib/api.js';
import { AvatarFace, avatarIds, normalizeAvatarId } from '../components/avatars.jsx';
import { usePageStyles } from '../hooks/usePageStyles.js';
import { GlassButton } from '../components/GlassButton.jsx';

const blindOptions = [
  [10, 1000], [50, 5000], [100, 10000], [500, 50000],
];
const seatOptions = [2, 4, 6, 9];
const topupOptions = [100, 500, 1000, 5000, 10000, 50000];

const recentHands = [
  ['WIN', ['A♥', 'K♥', 'Q♥', 'J♥', '10♥'], '+15,200', '10 min ago'],
  ['LOSS', ['K♠', 'Q♠', 'J♠', '10♠', '9♠'], '-8,300', '25 min ago'],
  ['WIN', ['A♠', 'A♥', 'K♠', 'Q♠', 'J♠'], '+22,100', '45 min ago'],
  ['WIN', ['Q♠', 'J♠', '10♠', '9♠', '8♠'], '+9,500', '1 hr ago'],
  ['LOSS', ['J♠', '10♠', '9♠', '8♠', '7♠'], '-7,800', '2 hr ago'],
];

function transactionLabel(type) {
  return ({ TOPUP: '💰 Top Up', BONUS: '🎁 Bonus', WIN: '🏆 Win', LOSS: '❌ Loss', BUYIN: '🎫 Buy-in', SETTLE: '⚖️ Settle' })[type] || type;
}

export default function LobbyPage() {
  usePageStyles('/assets/css/lobby.css', '/assets/css/glassmorphism-button.css');
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loadingError, setLoadingError] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(1);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [txPage, setTxPage] = useState(1);
  const [txHasMore, setTxHasMore] = useState(false);
  const [txLoading, setTxLoading] = useState(false);

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const [selectedTopup, setSelectedTopup] = useState(null);
  const [topupMessage, setTopupMessage] = useState({ text: '', tone: '' });
  const [topupBusy, setTopupBusy] = useState(false);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [createdTable, setCreatedTable] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [minBet, setMinBet] = useState(10);
  const [maxBet, setMaxBet] = useState(1000);
  const [maxSeats, setMaxSeats] = useState(6);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy code');

  const [roomCode, setRoomCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    document.title = 'Poker777 — Lobby';
    let active = true;
    (async () => {
      if (!Auth.hasSession()) {
        navigate('/', { replace: true });
        return;
      }
      try {
        const current = await Auth.me();
        if (!active) return;
        setUser(current);
        setSelectedAvatar(normalizeAvatarId(current.avatar_id));
      } catch (error) {
        if (active) setLoadingError(error.message || 'Unable to load profile');
      }
    })();
    return () => { active = false; };
  }, [navigate]);

  async function loadTransactions(page = 1) {
    setTxLoading(true);
    try {
      const data = await Wallet.transactions(page, 10);
      const rows = data.transactions || [];
      setTransactions((current) => page === 1 ? rows : [...current, ...rows]);
      setTxHasMore(Boolean(data.pagination && data.pagination.page < data.pagination.totalPages));
      setTxPage(page);
    } catch {
      if (page === 1) setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }

  function openProfile() {
    setProfileOpen(true);
    loadTransactions(1);
  }

  async function saveAvatar(event) {
    event.stopPropagation();
    setAvatarSaving(true);
    try {
      const updated = await Auth.updateMe({ avatar_id: String(selectedAvatar) });
      setUser(updated);
      setTimeout(() => setProfileOpen(false), 500);
    } catch (error) {
      if (error.code === 'NETWORK') window.alert(error.message);
    } finally {
      setAvatarSaving(false);
    }
  }

  function logout(event) {
    event.stopPropagation();
    Auth.logout();
    navigate('/');
  }

  function openTopup(event) {
    event?.stopPropagation();
    setTopupAmount('');
    setSelectedTopup(null);
    setTopupMessage({ text: '', tone: '' });
    setTopupOpen(true);
  }

  async function doTopup() {
    const amount = Number.parseInt(topupAmount, 10);
    if (!amount || amount < 1 || amount > 100000) {
      setTopupMessage({ text: '⚠️ Please enter an amount from 1 to 100,000', tone: 'error' });
      return;
    }
    setTopupBusy(true);
    setTopupMessage({ text: 'Processing…', tone: '' });
    try {
      const result = await Wallet.topUp(amount);
      setUser((current) => ({ ...current, balance: result.balance }));
      setTopupMessage({ text: `✅ Topped up ${fmtChips(result.amount)} chips!`, tone: 'success' });
      loadTransactions(1);
      setTimeout(() => setTopupOpen(false), 900);
    } catch (error) {
      setTopupMessage({ text: `❌ ${error.message || 'Top up failed'}`, tone: 'error' });
    } finally {
      setTopupBusy(false);
    }
  }

  function openCreateRoom() {
    if (!user) return;
    setRoomName(`${user.display_name || user.username}'s Room`);
    setMinBet(10);
    setMaxBet(1000);
    setMaxSeats(6);
    setCreateError('');
    setCreatedTable(null);
    setRoomModalOpen(true);
  }

  async function createRoom() {
    setCreateError('');
    setCreating(true);
    try {
      const table = await Tables.create({
        name: roomName.trim(),
        min_bet: Number(minBet),
        max_bet: Number(maxBet),
        max_seats: Number(maxSeats),
      });
      setCreatedTable(table);
    } catch (error) {
      setCreateError(error.message || 'Failed to create room');
    } finally {
      setCreating(false);
    }
  }

  async function copyRoomCode() {
    if (!createdTable) return;
    try {
      await navigator.clipboard.writeText(createdTable.room_code);
      setCopyLabel('Copied ✓');
      setTimeout(() => setCopyLabel('Copy code'), 1200);
    } catch {
      // Clipboard may be unavailable in non-secure development contexts.
    }
  }

  async function attemptJoin() {
    setJoinError('');
    const code = roomCode.trim();
    if (!code) return setJoinError('Please enter a room code.');
    if (code.length !== 6) return setJoinError('Room codes are 6 characters long.');
    setJoining(true);
    try {
      const table = await Tables.join(code);
      navigate(`/poker-table?code=${encodeURIComponent(table.room_code)}`);
    } catch (error) {
      setJoinError(error.message || 'Failed to join room');
    } finally {
      setJoining(false);
    }
  }

  const displayName = user?.display_name || user?.username || 'Loading…';
  const chipsText = `🪙 ${fmtChips(user?.balance)}`;
  const currentAvatar = normalizeAvatarId(user?.avatar_id || selectedAvatar);
  const chosenBlind = useMemo(() => `${minBet}:${maxBet}`, [minBet, maxBet]);

  if (loadingError) return <div className="app-background"><div className="inline-error">{loadingError}</div></div>;

  return (
    <div className="app-background" id="appBackground">
      <div className="cloud" style={{ width: 280, height: 280, top: '5%', left: '5%' }} />
      <div className="cloud" style={{ width: 220, height: 220, top: '10%', left: '70%' }} />
      <div className="cloud" style={{ width: 320, height: 320, top: '2%', left: '35%' }} />
      <div className="castle-silhouette" />

      {['♠','♥','♣','♦','♠'].map((suit, index) => <div key={index} className="balloon" data-suit={suit} style={{ width: 48 + index * 2, height: 48 + index * 2, top: `${8 + index * 2}%`, left: `${25 + index * 12}%`, animationDelay: `${index * .3}s` }} />)}

      <header className="profile-widget" onClick={openProfile}>
        <div className="avatar avatar-svg" role="img" aria-label="Player Avatar"><AvatarFace id={currentAvatar} prefix="header" className="avatar-svg-inner" /></div>
        <div className="profile-info">
          <div className="profile-name">{displayName}</div>
          <div className="profile-chips">{chipsText}</div>
          <div className="xp-bar"><div className="xp-fill" /></div>
        </div>
        <button className="topup-quick-btn" title="Top up chips" onClick={openTopup}><span className="topup-quick-icon">🪙</span><span>Top Up</span></button>
        <button className="expand-btn logout-btn" title="Log out" onClick={logout}><span className="logout-icon">↪</span><span>Log Out</span></button>
      </header>

      <section className={`profile-panel ${profileOpen ? 'open' : ''}`}>
        <button className="close-btn" onClick={() => setProfileOpen(false)}>✕</button>
        <div className="avatar-picker">
          <div className="avatar-picker-banner" />
          <div className="avatar-picker-body">
            <div className="avatar-main-frame"><div className="avatar-main"><AvatarFace id={selectedAvatar} prefix="main" className="avatar-svg-inner" /></div></div>
            <div className="avatar-picker-identity">
              <h2 className="panel-name">{displayName}</h2>
              <p className="avatar-picker-hint">Select your avatar</p>
              <div className="panel-meta"><span className="level-chip">Lv. 1</span><span className="title-badge">Rookie</span></div>
              <div className="rank-points">{chipsText}</div>
            </div>
            <div className="avatar-choices">
              {avatarIds.map((id) => (
                <button key={id} type="button" className={`avatar-choice ${selectedAvatar === id ? 'is-selected' : ''}`} aria-pressed={selectedAvatar === id} onClick={() => setSelectedAvatar(id)}>
                  <span className="avatar-choice-face"><AvatarFace id={id} prefix={`pick-${id}`} /></span><span className="avatar-choice-ring" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="section-label">◆ Stats ◆</div>
        <div className="stats-grid">
          <div className="stat"><div className="stat-label">Win / Loss</div><div className="stat-value"><span className="win">123</span> / <span className="loss">87</span></div></div>
          <div className="stat"><div className="stat-label">Win Rate</div><div className="stat-value">58.6%</div></div>
          <div className="stat"><div className="stat-label">Total Chips Won</div><div className="stat-value">🪙 2.45M</div></div>
        </div>

        <div className="section-label">◆ Recent 5 Hands ◆</div>
        {recentHands.map(([result, cards, chips, time], index) => (
          <div className="hand-row" key={index}>
            <div className="hand-index">{index + 1}</div>
            <div className={`hand-result ${result === 'WIN' ? 'win-text' : 'loss-text'}`}>{result}</div>
            <div className="mini-cards">{cards.map((card) => <div key={card} className={`mini-card ${/[♥♦]/.test(card) ? 'red' : ''}`}>{card}</div>)}</div>
            <div className={`hand-chips ${chips.startsWith('+') ? 'pos' : 'neg'}`}>{chips}</div><div className="hand-time">{time}</div>
          </div>
        ))}

        <div className="section-label">◆ Transaction History ◆</div>
        <div className="tx-list">
          {!txLoading && transactions.length === 0 && <div className="tx-empty">No transactions yet</div>}
          {transactions.map((tx) => {
            const positive = tx.amount > 0;
            const time = new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return <div className="tx-row" key={tx.id}><div className="tx-type">{transactionLabel(tx.type)}</div><div className={`tx-amount ${positive ? 'pos' : 'neg'}`}>{positive ? '+' : ''}{fmtChips(tx.amount)}</div><div className="tx-balance">Bal: {fmtChips(tx.balance_after)}</div><div className="tx-time">{time}</div></div>;
          })}
        </div>
        {txHasMore && <button className="tx-load-more" disabled={txLoading} onClick={() => loadTransactions(txPage + 1)}>{txLoading ? 'Loading…' : 'Load more'}</button>}

        <GlassButton className="glass-cta-full glass-cta-gold" style={{ marginTop: 14 }} onClick={openTopup} label="Top Up Chips" />
        <GlassButton className="glass-cta-full glass-cta-gold" style={{ marginTop: 14 }} disabled={avatarSaving} onClick={saveAvatar} label={avatarSaving ? 'Saving…' : 'Confirm Avatar'} />
      </section>

      <div className="logo-section"><img src="/assets/images/logo.png" alt="Poker Logo" className="animated-logo" /></div>

      <div className="action-buttons">
        <GlassButton className="glass-cta-lobby glass-cta-pink" onClick={openCreateRoom} label="CREATE ROOM" sub="Be the host and invite friends!" />
        <GlassButton className="glass-cta-lobby glass-cta-cyan" onClick={() => navigate('/rooms')} label="JOIN ROOM" sub="Join a room with friends!" />
      </div>

      <div className="room-code-bar">
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && attemptJoin()} placeholder="Enter Room Code" maxLength={6} autoComplete="off" />
        <GlassButton className="glass-cta-sm glass-cta-purple" onClick={attemptJoin} disabled={joining} label={joining ? 'Joining…' : 'Join'} />
      </div>
      {joinError && <div className="inline-error">{joinError}</div>}

      {roomModalOpen && <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setRoomModalOpen(false)}>
        {!createdTable ? <section className="room-modal">
          <button className="close-btn" onClick={() => setRoomModalOpen(false)}>✕</button>
          <div className="section-label">◆ Create Room ◆</div>
          <label className="field-label">Table name</label><input className="room-field" maxLength={60} value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          <label className="field-label">Blinds (min / max bet)</label>
          <div className="preset-row">{blindOptions.map(([min, max]) => <button key={min} type="button" className={`preset-chip ${chosenBlind === `${min}:${max}` ? 'is-active' : ''}`} onClick={() => { setMinBet(min); setMaxBet(max); }}>{fmtChips(min)} / {fmtChips(max)}</button>)}</div>
          <div className="field-row"><div className="field-col"><label className="field-label">Min bet</label><input type="number" className="room-field" min="1" value={minBet} onChange={(e) => setMinBet(e.target.value)} /></div><div className="field-col"><label className="field-label">Max bet</label><input type="number" className="room-field" min="1" value={maxBet} onChange={(e) => setMaxBet(e.target.value)} /></div></div>
          <label className="field-label">Max seats</label><div className="preset-row">{seatOptions.map((seats) => <button key={seats} type="button" className={`preset-chip ${Number(maxSeats) === seats ? 'is-active' : ''}`} onClick={() => setMaxSeats(seats)}>{seats}</button>)}</div>
          {createError && <div className="inline-error">{createError}</div>}
          <GlassButton className="glass-cta-full glass-cta-pink" style={{ marginTop: 14 }} disabled={creating} onClick={createRoom} label={creating ? 'Creating…' : 'Create Room'} />
        </section> : <section className="room-modal">
          <button className="close-btn" onClick={() => setRoomModalOpen(false)}>✕</button><div className="section-label">◆ Room Created ◆</div>
          <p className="waiting-hint">Share this code with friends so they can join</p><div className="room-code-display">{createdTable.room_code}</div><button className="copy-code-btn" onClick={copyRoomCode}>{copyLabel}</button>
          <div className="waiting-summary"><strong>{createdTable.name}</strong><br />Blinds {fmtChips(createdTable.min_bet)} / {fmtChips(createdTable.max_bet)} &nbsp;•&nbsp; {createdTable.max_seats} seats</div>
          <div className="waiting-status">Waiting for players…</div><GlassButton className="glass-cta-full glass-cta-cyan" style={{ marginTop: 14 }} onClick={() => navigate(`/poker-table?code=${encodeURIComponent(createdTable.room_code)}`)} label="Enter Table" />
        </section>}
      </div>}

      {topupOpen && <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setTopupOpen(false)}>
        <div className="modal-card topup-card">
          <button className="modal-close" onClick={() => setTopupOpen(false)}>✕</button>
          <div className="topup-header"><div className="topup-icon">🪙</div><div><div className="modal-title">Top Up Chips</div><div className="topup-subtitle">Choose an amount, then confirm your top up.</div></div></div>
          <div className="topup-balance-card"><span className="topup-balance-label">Current balance</span><span className="topup-balance-value">{chipsText}</span></div>
          <div className="topup-section-label">Quick amount</div><div className="topup-presets">{topupOptions.map((amount) => <button key={amount} type="button" className={`topup-preset ${selectedTopup === amount ? 'is-active' : ''}`} onClick={() => { setSelectedTopup(amount); setTopupAmount(String(amount)); setTopupMessage({ text: '', tone: '' }); }}><span>🪙</span>{fmtChips(amount)}</button>)}</div>
          <div className="topup-section-label">Custom amount</div><div className="topup-custom"><div className="topup-input-wrap"><span className="topup-input-icon">🪙</span><input type="number" value={topupAmount} onChange={(e) => { setTopupAmount(e.target.value); setSelectedTopup(null); }} onKeyDown={(e) => e.key === 'Enter' && !topupBusy && doTopup()} placeholder="Enter chips" min="1" max="100000" /></div><button type="button" className="topup-confirm-btn" disabled={topupBusy} onClick={doTopup}>Top Up</button></div>
          <div className="topup-hint">Maximum 100,000 chips per top up.</div><div className={`topup-message ${topupMessage.tone}`}>{topupMessage.text}</div>
        </div>
      </div>}
    </div>
  );
}

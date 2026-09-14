import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth, Tables, fmtChips, fmtTableError } from '../lib/api.js';
import { usePageStyles } from '../hooks/usePageStyles.js';

export default function RoomsPage() {
  usePageStyles('/assets/css/lobby.css', '/assets/css/rooms.css');
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joiningCode, setJoiningCode] = useState('');

  useEffect(() => {
    document.title = 'Poker777 — Room List';
    if (!Auth.hasSession()) {
      navigate('/', { replace: true });
      return;
    }
    loadRooms();
  }, [navigate]);

  async function loadRooms() {
    setLoading(true);
    setError('');
    try {
      await Auth.me();
      setRooms(await Tables.list());
    } catch (err) {
      setError(`Failed to load rooms: ${err.message || 'Unknown error'}`);
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return rooms;
    return rooms.filter((room) => room.name.toLowerCase().includes(value) || room.room_code.toLowerCase().includes(value));
  }, [query, rooms]);

  async function joinRoom(code) {
    if (joiningCode) return;
    setJoiningCode(code);
    setError('');
    try {
      const table = await Tables.join(code);
      navigate(`/poker-table?code=${encodeURIComponent(table.room_code)}`);
    } catch (err) {
      setError(fmtTableError(err));
      setJoiningCode('');
    }
  }

  return (
    <div className="app-background">
      <div className="cloud" style={{ width: 280, height: 280, top: '5%', left: '5%' }} />
      <div className="cloud" style={{ width: 220, height: 220, top: '10%', left: '70%' }} />
      <div className="cloud" style={{ width: 320, height: 320, top: '2%', left: '35%' }} />

      <div className="rooms-container">
        <div className="rooms-header">
          <h1>Open Rooms</h1>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="refresh-btn" onClick={loadRooms}>↻ Refresh</button>
            <button className="back-btn" onClick={() => navigate('/lobby')}>← Back to Lobby</button>
          </div>
        </div>

        <div className="search-bar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search room name or code…" autoComplete="off" /></div>

        <div className="room-list">
          {loading ? <div className="loading-spinner"><div className="spinner" />Loading rooms…</div> : filtered.length === 0 ? (
            <div className="rooms-empty"><span className="emoji">{rooms.length ? '🔍' : '🃏'}</span>{rooms.length ? 'No rooms match your search.' : <>No open rooms right now.<br />Create one from the lobby or check back later!</>}</div>
          ) : filtered.map((room) => {
            const taken = room.seats_taken ?? 0;
            const full = taken >= room.max_seats;
            return (
              <div className="room-card" key={room.id || room.room_code}>
                <div className="room-info">
                  <h3>{room.name}</h3>
                  <div className="room-meta">
                    <span>🪙 Blinds: {fmtChips(room.min_bet)} / {fmtChips(room.max_bet)}</span>
                    <span className="seats-indicator"><span>👥 Seats:</span><span className="seats-dots">{Array.from({ length: room.max_seats }, (_, index) => <span key={index} className={`seat-dot ${index < taken ? 'taken' : 'empty'}`} />)}</span><span>{taken}/{room.max_seats}</span></span>
                    <span>🔑 <span className="room-code-badge">{room.room_code}</span></span>
                  </div>
                </div>
                <div className="room-actions"><button className="join-room-btn" disabled={full || Boolean(joiningCode)} onClick={() => joinRoom(room.room_code)}>{full ? 'Full' : joiningCode === room.room_code ? 'Joining…' : 'Join'}</button></div>
              </div>
            );
          })}
        </div>
        {error && <div className="inline-error">{error}</div>}
      </div>
    </div>
  );
}

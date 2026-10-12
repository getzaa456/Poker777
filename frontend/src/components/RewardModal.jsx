import { useEffect, useRef, useState } from 'react';
import { Wallet, fmtChips } from '../lib/api.js';
import { Icon } from './Icon.jsx';

// Free chips: watch a clip, then pick one of three boxes.
// The page only shows things — the server keeps the timer, draws the prizes and pays out,
// so skipping the clip or calling the API by hand gains nothing.
const VIDEO_ID = 'dQw4w9WgXcQ';
const TICK_MS = 250;
const PLAYING = 1;

let youTubeApi;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youTubeApi) {
    youTubeApi = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { youTubeApi = null; reject(new Error('timeout')); }, 10000);
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); previous?.(); resolve(window.YT); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { clearTimeout(timer); youTubeApi = null; reject(new Error('blocked')); };
      document.head.appendChild(script);
    });
  }
  return youTubeApi;
}

function blockedText(status) {
  if (status.reason === 'BALANCE_TOO_HIGH') return `Free chips are for players with less than ${fmtChips(status.max_balance)} chips. You have ${fmtChips(status.balance)}.`;
  if (status.reason === 'DAILY_LIMIT') return 'You have opened all your boxes for today. Come back tomorrow!';
  const minutes = Math.floor(status.cooldown_seconds / 60);
  const seconds = String(status.cooldown_seconds % 60).padStart(2, '0');
  return `Next box in ${minutes}:${seconds}`;
}

export default function RewardModal({ onClose, onBalance }) {
  const [phase, setPhase] = useState('loading'); // loading | blocked | intro | watch | pick | opening | result | error
  const [status, setStatus] = useState(null);
  const [session, setSession] = useState(null);
  const [watchedMs, setWatchedMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const hostRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    let active = true;
    Wallet.rewardStatus()
      .then((data) => { if (!active) return; setStatus(data); setPhase(data.eligible ? 'intro' : 'blocked'); })
      .catch((err) => { if (active) { setError(err.message); setPhase('error'); } });
    return () => { active = false; };
  }, []);

  // Cooldown counts down while the dialog is open.
  useEffect(() => {
    if (phase !== 'blocked' || status?.reason !== 'COOLDOWN') return undefined;
    const id = setInterval(() => setStatus((current) => {
      const left = Math.max(0, current.cooldown_seconds - 1);
      if (left === 0) setPhase('intro');
      return { ...current, cooldown_seconds: left };
    }), 1000);
    return () => clearInterval(id);
  }, [phase, status?.reason]);

  async function startWatching() {
    setPhase('loading');
    try {
      const started = await Wallet.startReward();
      setSession(started);
      setWatchedMs(0);
      setPhase('watch');
    } catch (err) {
      if (err.details?.reason) { setStatus(err.details); setPhase('blocked'); return; }
      setError(err.message);
      setPhase('error');
    }
  }

  // Player + watch counter: only time spent actually playing, with the tab in front, counts.
  useEffect(() => {
    if (phase !== 'watch') return undefined;
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId: VIDEO_ID,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3 },
      });
    }).catch(() => {
      if (!cancelled) { setError('The video could not load (an ad blocker may be blocking YouTube). Allow it and try again.'); setPhase('error'); }
    });
    const id = setInterval(() => {
      const player = playerRef.current;
      const playing = typeof player?.getPlayerState === 'function' && player.getPlayerState() === PLAYING;
      const visible = document.visibilityState === 'visible';
      setPaused(!playing || !visible);
      setMuted(Boolean(playing && player.isMuted?.()));
      if (playing && visible) setWatchedMs((ms) => ms + TICK_MS);
    }, TICK_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [phase]);

  const watchMs = (session?.watch_seconds || status?.watch_seconds || 10) * 1000;
  useEffect(() => {
    if (phase === 'watch' && watchedMs >= watchMs) setPhase('pick');
  }, [phase, watchedMs, watchMs]);

  useEffect(() => () => { try { playerRef.current?.destroy(); } catch { /* ignore */ } }, []);

  async function pick(box) {
    if (phase !== 'pick') return;
    setPicked(box);
    setPhase('opening');
    try {
      let claimed;
      try {
        claimed = await Wallet.claimReward(session.session_id, box);
      } catch (err) {
        // Our clock ran a little ahead of the server's: wait the rest and try once more.
        if (err.code !== 'REWARD_TOO_EARLY') throw err;
        await new Promise((resolve) => setTimeout(resolve, (err.details?.ready_in_ms || 500) + 100));
        claimed = await Wallet.claimReward(session.session_id, box);
      }
      await new Promise((resolve) => setTimeout(resolve, 700)); // let the box shake a little
      try { playerRef.current?.stopVideo(); } catch { /* ignore */ }
      setResult(claimed);
      setPhase('result');
      onBalance?.(claimed.balance);
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  }

  const progress = Math.min(100, (watchedMs / watchMs) * 100);
  const secondsLeft = Math.max(0, Math.ceil((watchMs - watchedMs) / 1000));
  const showVideo = ['watch', 'pick', 'opening'].includes(phase);

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && phase !== 'opening' && onClose()}>
      <div className="modal-card reward-card">
        <button className="modal-close" onClick={onClose} disabled={phase === 'opening'}>✕</button>
        <div className="modal-title">Free Chips</div>

        {phase === 'loading' && <p className="reward-text">Loading…</p>}
        {phase === 'error' && <p className="reward-text reward-error">{error}</p>}
        {phase === 'blocked' && status && <p className="reward-text">{blockedText(status)}</p>}
        {phase === 'intro' && <>
          <p className="reward-text">Watch a short video from our very serious sponsor, then pick one of three mystery boxes.</p>
          <p className="reward-sub">{status?.remaining_today} {status?.remaining_today === 1 ? 'box' : 'boxes'} left today</p>
          <button className="reward-cta" onClick={startWatching}>Watch &amp; unlock boxes</button>
        </>}

        <div className={`reward-video ${showVideo ? '' : 'is-hidden'} ${phase !== 'watch' ? 'is-small' : ''}`}><div ref={hostRef} /></div>

        {phase === 'watch' && <div className="reward-watch">
          <div className="reward-progress"><div style={{ width: `${progress}%` }} /></div>
          <p className="reward-sub">{paused ? 'Paused — keep the video playing to unlock the boxes' : muted ? `Rick is sad you muted him… ${secondsLeft}s` : `Boxes unlock in ${secondsLeft}s`}</p>
          {/* The video itself ignores clicks (no pause/skip); this covers browsers that block autoplay. */}
          {paused && <button className="reward-cta" onClick={() => { try { playerRef.current?.playVideo(); } catch { /* not ready yet */ } }}>Play video</button>}
        </div>}

        {['pick', 'opening', 'result'].includes(phase) && <>
          <p className="reward-text">{phase === 'result' ? (result.amount >= 1000 ? 'Jackpot!' : 'Here is what was inside') : 'Pick a box!'}</p>
          <div className="reward-boxes">
            {[0, 1, 2].map((box) => {
              const opened = phase === 'result';
              const mine = picked === box;
              return (
                <button
                  key={box}
                  type="button"
                  className={`reward-box ${mine ? 'is-picked' : ''} ${opened ? 'is-open' : ''} ${phase === 'opening' && mine ? 'is-shaking' : ''}`}
                  disabled={phase !== 'pick'}
                  onClick={() => pick(box)}
                  aria-label={`Box ${box + 1}`}
                >
                  <span className="reward-box-icon"><Icon name={opened ? (mine ? 'coin' : 'box') : 'gift'} /></span>
                  {opened && <span className="reward-box-amount">{fmtChips(result.prizes[box])}</span>}
                  {opened && <span className="reward-box-label">{mine ? 'You got' : 'Not picked'}</span>}
                  {opened && mine && <span className="reward-burst" aria-hidden="true">{Array.from({ length: result.amount >= 1000 ? 14 : 8 }, (_, index) => <i key={index} style={{ '--angle': `${index * (360 / (result.amount >= 1000 ? 14 : 8))}deg` }} />)}</span>}
                </button>
              );
            })}
          </div>
          {phase === 'result' && <>
            <p className="reward-sub">+{fmtChips(result.amount)} chips • balance {fmtChips(result.balance)}</p>
            <button className="reward-cta" onClick={onClose}>Collect</button>
          </>}
        </>}
      </div>
    </div>
  );
}

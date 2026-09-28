// Game sound effects synthesized with the Web Audio API — no audio files, no licensing.
// Browsers only allow audio after a user gesture, so the context is created lazily
// and resumed on the first click/keypress.

const MUTE_KEY = 'poker777_muted';
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage unavailable */ }

function audio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function tone(freq, { at = 0, dur = 0.15, type = 'sine', vol = 0.3, slide = null } = {}) {
  const ac = audio();
  if (!ac || muted) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ at = 0, dur = 0.12, vol = 0.25, from = 2000, to = 800, type = 'bandpass' } = {}) {
  const ac = audio();
  if (!ac || muted) return;
  const t = ac.currentTime + at;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
}

const chip = (at = 0) => {
  tone(2400, { at, dur: 0.05, type: 'triangle', vol: 0.18 });
  tone(3300, { at: at + 0.01, dur: 0.04, type: 'triangle', vol: 0.12 });
};

export const sound = {
  deal(count = 2) { for (let i = 0; i < count; i += 1) noise({ at: i * 0.12, dur: 0.09, vol: 0.3, from: 4000, to: 1500 }); },
  card() { noise({ dur: 0.1, vol: 0.3, from: 3500, to: 1200 }); },
  chips(count = 3) { for (let i = 0; i < count; i += 1) chip(i * 0.06); },
  allIn() { for (let i = 0; i < 8; i += 1) chip(i * 0.045); tone(220, { at: 0.05, dur: 0.4, type: 'sawtooth', vol: 0.08, slide: 440 }); },
  check() { tone(140, { dur: 0.07, type: 'square', vol: 0.2 }); tone(140, { at: 0.12, dur: 0.07, type: 'square', vol: 0.2 }); },
  fold() { noise({ dur: 0.25, vol: 0.2, from: 1800, to: 300, type: 'lowpass' }); },
  yourTurn() { tone(660, { dur: 0.12, vol: 0.25 }); tone(880, { at: 0.12, dur: 0.2, vol: 0.25 }); },
  tick() { tone(1000, { dur: 0.05, type: 'square', vol: 0.1 }); },
  join() { tone(523, { dur: 0.1 }); tone(784, { at: 0.1, dur: 0.15 }); },
  leave() { tone(784, { dur: 0.1 }); tone(523, { at: 0.1, dur: 0.15 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.25, type: 'triangle', vol: 0.3 })); this.chips(6); },
  lose() { tone(392, { dur: 0.25, type: 'triangle' }); tone(311, { at: 0.22, dur: 0.4, type: 'triangle' }); },
  error() { tone(200, { dur: 0.18, type: 'sawtooth', vol: 0.15 }); },
  isMuted: () => muted,
  setMuted(value) {
    muted = Boolean(value);
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  },
};

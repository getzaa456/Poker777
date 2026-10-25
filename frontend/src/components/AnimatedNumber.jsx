import { useEffect, useRef, useState } from 'react';
import { fmtChips } from '../lib/api.js';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Chip amounts roll to their new value instead of jumping; a rise also gives a small bump.
export function AnimatedNumber({ value, duration = 600, format = fmtChips, bump = false, className = '' }) {
  const ready = value !== null && value !== undefined;
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const shownRef = useRef(ready ? target : null); // null until the first real value: that one appears without rolling
  const spanRef = useRef(null);

  useEffect(() => {
    if (!ready) return undefined;
    const from = shownRef.current;
    if (from === null) { shownRef.current = target; setShown(target); return undefined; }
    if (from === target) return undefined;
    if (bump && target > from && !reducedMotion()) {
      spanRef.current?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
    }
    if (reducedMotion() || Math.abs(target - from) < 2) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    const start = performance.now();
    let frame;
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration)); // a frame stamp can be a bit before start
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(from + (target - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ready, target, duration, bump]);

  return <span ref={spanRef} className={`animated-number ${className}`} style={{ display: 'inline-block' }}>{format(shown)}</span>;
}

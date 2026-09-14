import { useEffect, useRef } from 'react';

export function LatticeBackground({
  strokeRGB = '139, 110, 247',
  accentRGB = '79, 179, 255',
  maxDistance = 140,
  transparent = true,
  backgroundColor = null,
  zIndex = 2,
} = {}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d', { alpha: transparent });
    if (!ctx) return undefined;

    let animationFrameId;
    let width = 0;
    let height = 0;
    let points = [];
    let lastTime = performance.now();

    const mouse = {
      x: -1000,
      y: -1000,
      targetX: -1000,
      targetY: -1000,
    };

    const maxDistSq = maxDistance * maxDistance;

    function initPoints(w, h) {
      points = [];
      const density = Math.floor((w * h) / 9500);
      const count = Math.min(Math.max(density, 45), 115);

      for (let i = 0; i < count; i += 1) {
        points.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.75,
          vy: (Math.random() - 0.5) * 0.75,
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 1 + Math.random() * 1.5,
        });
      }
    }

    function handleResize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initPoints(width, height);
    }

    function handleMouseMove(event) {
      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
    }

    function handleMouseLeave() {
      mouse.targetX = -1000;
      mouse.targetY = -1000;
    }

    function render(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.033);
      lastTime = now;

      mouse.x += (mouse.targetX - mouse.x) * 0.1;
      mouse.y += (mouse.targetY - mouse.y) * 0.1;

      if (transparent) {
        ctx.clearRect(0, 0, width, height);
        if (backgroundColor) {
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, width, height);
        }
      } else {
        ctx.fillStyle = backgroundColor || '#04060a';
        ctx.fillRect(0, 0, width, height);
      }

      const pointCount = points.length;

      for (let i = 0; i < pointCount; i += 1) {
        const point = points[i];
        point.pulse += dt * point.pulseSpeed;
        point.x += point.vx * dt * 60;
        point.y += point.vy * dt * 60;

        if (point.x < 0) {
          point.x = 0;
          point.vx *= -1;
        } else if (point.x > width) {
          point.x = width;
          point.vx *= -1;
        }

        if (point.y < 0) {
          point.y = 0;
          point.vy *= -1;
        } else if (point.y > height) {
          point.y = height;
          point.vy *= -1;
        }

        const dx = mouse.x - point.x;
        const dy = mouse.y - point.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 40000 && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / 200) * 35;
          point.x -= (dx / dist) * force * dt * 6;
          point.y -= (dy / dist) * force * dt * 6;
        }
      }

      const cellSize = maxDistance;
      const cols = Math.max(1, Math.ceil(width / cellSize));
      const rows = Math.max(1, Math.ceil(height / cellSize));
      const grid = Array.from({ length: cols }, () =>
        Array.from({ length: rows }, () => []),
      );

      for (let i = 0; i < pointCount; i += 1) {
        const column = Math.min(cols - 1, Math.max(0, Math.floor(points[i].x / cellSize)));
        const row = Math.min(rows - 1, Math.max(0, Math.floor(points[i].y / cellSize)));
        grid[column][row].push(i);
      }

      for (let column = 0; column < cols; column += 1) {
        for (let row = 0; row < rows; row += 1) {
          const cellPoints = grid[column][row];
          const neighbors = [];

          for (let nearbyColumn = Math.max(0, column - 1); nearbyColumn <= Math.min(cols - 1, column + 1); nearbyColumn += 1) {
            for (let nearbyRow = Math.max(0, row - 1); nearbyRow <= Math.min(rows - 1, row + 1); nearbyRow += 1) {
              neighbors.push(...grid[nearbyColumn][nearbyRow]);
            }
          }

          for (let i = 0; i < cellPoints.length; i += 1) {
            const idx1 = cellPoints[i];
            const p1 = points[idx1];

            for (let j = 0; j < neighbors.length; j += 1) {
              const idx2 = neighbors[j];
              if (idx1 >= idx2) continue;
              const p2 = points[idx2];

              const dx12 = p1.x - p2.x;
              const dy12 = p1.y - p2.y;
              if (dx12 * dx12 + dy12 * dy12 > maxDistSq) continue;

              for (let k = j + 1; k < neighbors.length; k += 1) {
                const idx3 = neighbors[k];
                if (idx2 >= idx3) continue;
                const p3 = points[idx3];

                const dx23 = p2.x - p3.x;
                const dy23 = p2.y - p3.y;
                if (dx23 * dx23 + dy23 * dy23 > maxDistSq) continue;

                const dx31 = p3.x - p1.x;
                const dy31 = p3.y - p1.y;
                if (dx31 * dx31 + dy31 * dy31 > maxDistSq) continue;

                const avgX = (p1.x + p2.x + p3.x) / 3;
                const avgY = (p1.y + p2.y + p3.y) / 3;
                const mouseDx = mouse.x - avgX;
                const mouseDy = mouse.y - avgY;
                const mouseDistSq = mouseDx * mouseDx + mouseDy * mouseDy;
                const isNearMouse = mouseDistSq < 48400;
                const fillAlpha = isNearMouse
                  ? (1 - Math.sqrt(mouseDistSq) / 220) * 0.22
                  : 0.035;

                ctx.fillStyle = isNearMouse
                  ? `rgba(${accentRGB}, ${fillAlpha.toFixed(2)})`
                  : `rgba(${strokeRGB}, ${fillAlpha.toFixed(2)})`;
                ctx.strokeStyle = isNearMouse
                  ? `rgba(${accentRGB}, ${(fillAlpha * 1.6).toFixed(2)})`
                  : `rgba(${strokeRGB}, 0.09)`;
                ctx.lineWidth = isNearMouse ? 0.8 : 0.45;

                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(p3.x, p3.y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              }
            }
          }
        }
      }

      for (let i = 0; i < pointCount; i += 1) {
        const point = points[i];
        const mouseDx = mouse.x - point.x;
        const mouseDy = mouse.y - point.y;
        const isNear = mouseDx * mouseDx + mouseDy * mouseDy < 48400;
        const pulseRadius = 1.6 + Math.sin(point.pulse) * 0.9;

        ctx.fillStyle = isNear
          ? `rgba(${accentRGB}, 0.9)`
          : `rgba(${strokeRGB}, 0.4)`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, isNear ? 3.2 : pulseRadius, 0, Math.PI * 2);
        ctx.fill();

        if (isNear) {
          ctx.strokeStyle = `rgba(${accentRGB}, 0.35)`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 6.5 + Math.sin(point.pulse * 2) * 2.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      animationFrameId = window.requestAnimationFrame(render);
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseleave', handleMouseLeave, { passive: true });
    animationFrameId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [accentRGB, backgroundColor, maxDistance, strokeRGB, transparent]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex,
      }}
    />
  );
}

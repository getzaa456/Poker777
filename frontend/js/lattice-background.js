/**
 * LatticeBackground (Delaunay Triangulation Network with Cursor Field Deformation)
 * Vanilla JS implementation matching the React LatticeBackground component
 */

function initLatticeBackground(options = {}) {
  const {
    canvasId = "lattice-canvas",
    strokeRGB = "148, 163, 184",
    accentRGB = "129, 140, 248",
    maxDistance = 140,
    transparent = true,
    backgroundColor = null,
    zIndex = 0
  } = options;

  let canvas = document.getElementById(canvasId);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = canvasId;
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = zIndex;
    document.body.prepend(canvas);
  }

  const ctx = canvas.getContext("2d", { alpha: transparent });
  if (!ctx) return;

  let animationFrameId;
  let width = 0;
  let height = 0;

  const mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000 };
  let points = [];
  const maxDistSq = maxDistance * maxDistance;

  const initPoints = (w, h) => {
    points = [];
    const density = Math.floor((w * h) / 9500);
    const count = Math.min(Math.max(density, 45), 115);

    for (let i = 0; i < count; i++) {
      points.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.75,
        vy: (Math.random() - 0.5) * 0.75,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 1 + Math.random() * 1.5,
      });
    }
  };

  const handleResize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    initPoints(width, height);
  };

  const handleMouseMove = (e) => {
    mouse.targetX = e.clientX;
    mouse.targetY = e.clientY;
  };

  const handleMouseLeave = () => {
    mouse.targetX = -1000;
    mouse.targetY = -1000;
  };

  handleResize();
  window.addEventListener("resize", handleResize);
  window.addEventListener("mousemove", handleMouseMove, { passive: true });
  window.addEventListener("mouseleave", handleMouseLeave, { passive: true });

  let lastTime = performance.now();

  const render = (now) => {
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;

    // Smooth cursor lerp
    mouse.x += (mouse.targetX - mouse.x) * 0.1;
    mouse.y += (mouse.targetY - mouse.y) * 0.1;

    // Clear Canvas
    if (transparent) {
      ctx.clearRect(0, 0, width, height);
      if (backgroundColor) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }
    } else {
      ctx.fillStyle = backgroundColor || "#04060a";
      ctx.fillRect(0, 0, width, height);
    }

    // 1. Update Particle Physics
    const pCount = points.length;
    for (let i = 0; i < pCount; i++) {
      const p = points[i];
      p.pulse += dt * p.pulseSpeed;

      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;

      // Bounce walls
      if (p.x < 0) {
        p.x = 0;
        p.vx *= -1;
      } else if (p.x > width) {
        p.x = width;
        p.vx *= -1;
      }

      if (p.y < 0) {
        p.y = 0;
        p.vy *= -1;
      } else if (p.y > height) {
        p.y = height;
        p.vy *= -1;
      }

      // Mouse repelling force (200px radius)
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < 40000 && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const force = (1 - dist / 200) * 35;
        p.x -= (dx / dist) * force * dt * 6;
        p.y -= (dy / dist) * force * dt * 6;
      }
    }

    // 2. Spatial Grid Partitioning (Fast O(N) Triangulation Lookup)
    const cellSize = maxDistance;
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const grid = Array.from({ length: cols }, () =>
      Array.from({ length: rows }, () => [])
    );

    for (let i = 0; i < pCount; i++) {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(points[i].x / cellSize)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor(points[i].y / cellSize)));
      grid[c][r].push(i);
    }

    // 3. Draw Triangulated Geometry Mesh using Grid Lookup
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const cellPoints = grid[c][r];

        // Check adjacent neighboring cells (3x3 neighborhood)
        const neighbors = [];
        for (let nc = Math.max(0, c - 1); nc <= Math.min(cols - 1, c + 1); nc++) {
          for (let nr = Math.max(0, r - 1); nr <= Math.min(rows - 1, r + 1); nr++) {
            const nList = grid[nc][nr];
            for (let k = 0; k < nList.length; k++) {
              neighbors.push(nList[k]);
            }
          }
        }

        const neighborCount = neighbors.length;

        for (let i = 0; i < cellPoints.length; i++) {
          const idx1 = cellPoints[i];
          const p1 = points[idx1];

          for (let j = 0; j < neighborCount; j++) {
            const idx2 = neighbors[j];
            if (idx1 >= idx2) continue;
            const p2 = points[idx2];

            const dx12 = p1.x - p2.x;
            const dy12 = p1.y - p2.y;
            const d12Sq = dx12 * dx12 + dy12 * dy12;
            if (d12Sq > maxDistSq) continue;

            for (let k = j + 1; k < neighborCount; k++) {
              const idx3 = neighbors[k];
              if (idx2 >= idx3) continue;
              const p3 = points[idx3];

              const dx23 = p2.x - p3.x;
              const dy23 = p2.y - p3.y;
              const d23Sq = dx23 * dx23 + dy23 * dy23;
              if (d23Sq > maxDistSq) continue;

              const dx31 = p3.x - p1.x;
              const dy31 = p3.y - p1.y;
              const d31Sq = dx31 * dx31 + dy31 * dy31;
              if (d31Sq > maxDistSq) continue;

              // Polygon rendering
              const avgX = (p1.x + p2.x + p3.x) * 0.3333;
              const avgY = (p1.y + p2.y + p3.y) * 0.3333;
              const mDx = mouse.x - avgX;
              const mDy = mouse.y - avgY;
              const mouseDistSq = mDx * mDx + mDy * mDy;

              const isNearMouse = mouseDistSq < 48400; // 220px radius
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

    // 4. Render Nodes & Active Pulse Rings
    for (let i = 0; i < pCount; i++) {
      const p = points[i];
      const mDx = mouse.x - p.x;
      const mDy = mouse.y - p.y;
      const isNear = mDx * mDx + mDy * mDy < 48400;

      const pulseRadius = 1.6 + Math.sin(p.pulse) * 0.9;

      ctx.fillStyle = isNear
        ? `rgba(${accentRGB}, 0.9)`
        : `rgba(${strokeRGB}, 0.4)`;

      ctx.beginPath();
      ctx.arc(p.x, p.y, isNear ? 3.2 : pulseRadius, 0, Math.PI * 2);
      ctx.fill();

      if (isNear) {
        ctx.strokeStyle = `rgba(${accentRGB}, 0.35)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6.5 + Math.sin(p.pulse * 2) * 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    animationFrameId = requestAnimationFrame(render);
  };

  animationFrameId = requestAnimationFrame(render);
}

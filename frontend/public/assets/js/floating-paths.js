/**
 * Floating Paths Animation
 * Vanilla JS/CSS adaptation of the React FloatingPaths component.
 * Generates animated SVG <path> elements that flow across a container
 * using stroke-dasharray / stroke-dashoffset CSS keyframes.
 *
 * Usage:
 *   initFloatingPaths('containerId', { position: 1 });
 *   initFloatingPaths('containerId', { position: -1 });
 */
function initFloatingPaths(containerId, options) {
  options = options || {};
  var container = document.getElementById(containerId);
  if (!container) return;

  var position = options.position !== undefined ? options.position : 1;
  var svgNS = 'http://www.w3.org/2000/svg';

  /* ---- create <svg> ---- */
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 696 316');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.style.cssText = 'width:100%;height:100%;display:block;';

  var title = document.createElementNS(svgNS, 'title');
  title.textContent = 'Background Paths';
  svg.appendChild(title);

  /* ---- generate 36 flowing cubic-bezier paths ---- */
  for (var i = 0; i < 36; i++) {
    var path = document.createElementNS(svgNS, 'path');

    var p = position;
    var d =
      'M-' + (380 - i * 5 * p) + ' -' + (189 + i * 6) +
      'C-' + (380 - i * 5 * p) + ' -' + (189 + i * 6) +
      ' -' + (312 - i * 5 * p) + ' ' + (216 - i * 6) +
      ' ' + (152 - i * 5 * p) + ' ' + (343 - i * 6) +
      'C' + (616 - i * 5 * p) + ' ' + (470 - i * 6) +
      ' ' + (684 - i * 5 * p) + ' ' + (875 - i * 6) +
      ' ' + (684 - i * 5 * p) + ' ' + (875 - i * 6);

    path.setAttribute('d', d);
    path.setAttribute('pathLength', '1');          // normalise length → 1

    /* ---- colour: cycle through purple / pink / white tones ---- */
    var baseOpacity = 0.06 + i * 0.02;
    var color;
    switch (i % 4) {
      case 0: color = 'rgba(255,154,209,' + baseOpacity + ')'; break;   // light pink  #ff9ad1
      case 1: color = 'rgba(201,184,255,' + baseOpacity + ')'; break;   // light purple #c9b8ff
      case 2: color = 'rgba(255,255,255,' + (baseOpacity * 0.7) + ')'; break; // white (subtler)
      default: color = 'rgba(143,123,255,' + baseOpacity + ')'; break;  // purple #8f7bff
    }

    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(0.5 + i * 0.03));
    path.setAttribute('stroke-linecap', 'round');
    path.classList.add('floating-path');

    /* ---- randomise duration & stagger ---- */
    var duration = 20 + Math.random() * 10;           // 20 – 30 s
    var delay    = -(Math.random() * duration);        // negative → staggered
    path.style.animation =
      'floatingPath ' + duration.toFixed(2) + 's ' + delay.toFixed(2) + 's linear infinite';

    svg.appendChild(path);
  }

  container.appendChild(svg);
}

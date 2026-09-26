/**
 * Small charts drawn as SVG (the history in numbers: HistorySystem.samples). Colours come from the
 * interface's own tokens, so they follow the theme.
 */
// (No imports: it only draws — and the tests can draw it too.)
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A line over time. points: [{ x (day), y }] · marks: [{ x, label }] (moments worth marking) ·
 * fmt(y) → text · yearDays: gridlines each year.
 */
export function lineChart(points, { w = 560, h = 170, fmt = (v) => String(v), marks = [], yearDays = 56, label = '' } = {}) {
  if (points.length < 2) return `<div class="chart-empty muted small">${escapeHtml(label)}</div>`;
  const pad = { l: 44, r: 12, t: 12, b: 22 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  let y0 = Math.min(0, ...ys);
  let y1 = Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1;
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const X = (x) => pad.l + ((x - x0) / (x1 - x0)) * pw;
  const Y = (y) => pad.t + ph - ((y - y0) / (y1 - y0)) * ph;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${X(x1).toFixed(1)},${Y(y0).toFixed(1)} L${X(x0).toFixed(1)},${Y(y0).toFixed(1)} Z`;
  let grid = '';
  // A line at each year, and the top and bottom values.
  for (let d = Math.ceil(x0 / yearDays) * yearDays; d <= x1; d += yearDays) {
    grid += `<line class="chart-grid" x1="${X(d)}" y1="${pad.t}" x2="${X(d)}" y2="${pad.t + ph}"/><text class="chart-axis" x="${X(d) + 3}" y="${h - 6}">${escapeHtml(String(Math.floor(d / yearDays) + 1))}</text>`;
  }
  for (const v of [y0, y1]) grid += `<line class="chart-grid" x1="${pad.l}" y1="${Y(v)}" x2="${pad.l + pw}" y2="${Y(v)}"/><text class="chart-axis" x="${pad.l - 4}" y="${Y(v) + 4}" text-anchor="end">${escapeHtml(fmt(v))}</text>`;
  const mk = marks
    .filter((m) => m.x >= x0 && m.x <= x1)
    .map((m) => `<g class="chart-mark"><line x1="${X(m.x)}" y1="${pad.t}" x2="${X(m.x)}" y2="${pad.t + ph}"/><circle cx="${X(m.x)}" cy="${pad.t + 4}" r="4"><title>${escapeHtml(m.label)}</title></circle></g>`)
    .join('');
  const last = points[points.length - 1];
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(label)}">
    ${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${mk}
    <circle class="chart-dot" cx="${X(last.x)}" cy="${Y(last.y)}" r="3.5"/><text class="chart-last" x="${Math.min(X(last.x), w - 60)}" y="${Math.max(12, Y(last.y) - 8)}">${escapeHtml(fmt(last.y))}</text></svg>`;
}

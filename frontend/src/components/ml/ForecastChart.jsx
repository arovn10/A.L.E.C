/**
 * frontend/src/components/ml/ForecastChart.jsx
 *
 * Inline SVG sparkline of a forecast with optional 80%/95% prediction
 * interval ribbons. No chart library — the payload is small and we want
 * the dashboard to stay fast.
 *
 * Point shape: { t, yhat, lo80?, hi80?, lo95?, hi95? }
 */
export default function ForecastChart({ points, width = 240, height = 40, showBands = true }) {
  if (!points?.length) return null;

  const hasBands = showBands && points.some(p => p.lo95 != null && p.hi95 != null);

  // Compute y-range across yhat + band edges so ribbons fit.
  const ys = [];
  for (const p of points) {
    ys.push(p.yhat);
    if (hasBands) {
      if (p.lo95 != null) ys.push(p.lo95);
      if (p.hi95 != null) ys.push(p.hi95);
    }
  }
  const min = Math.min(...ys), max = Math.max(...ys);
  const range = max - min || 1;
  const step = width / Math.max(1, points.length - 1);
  const yAt = v => (height - ((v - min) / range) * height).toFixed(1);
  const xAt = i => (i * step).toFixed(1);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.yhat)}`).join(' ');

  const ribbonPath = (loKey, hiKey) => {
    if (!points.every(p => p[loKey] != null && p[hiKey] != null)) return null;
    const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p[hiKey])}`).join(' ');
    const bot = points.slice().reverse().map((p, j) => {
      const i = points.length - 1 - j;
      return `L ${xAt(i)} ${yAt(p[loKey])}`;
    }).join(' ');
    return `${top} ${bot} Z`;
  };

  const r95 = hasBands ? ribbonPath('lo95', 'hi95') : null;
  const r80 = hasBands ? ribbonPath('lo80', 'hi80') : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
      {r95 && <path d={r95} fill="#60a5fa" fillOpacity="0.12" />}
      {r80 && <path d={r80} fill="#60a5fa" fillOpacity="0.22" />}
      <path d={linePath} stroke="#60a5fa" strokeWidth="1.5" fill="none" />
      <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].yhat)} r="2.5" fill="#60a5fa" />
    </svg>
  );
}

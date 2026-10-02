import React from 'react';

/** 环形额度表：size 直径，stroke 环宽，percent 剩余百分比（0-100，null=未知） */
export function RingGauge({ size = 168, stroke = 14, percent, label, sub, tone = 'auto' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const valid = percent != null && Number.isFinite(percent);
  const p = valid ? Math.max(0, Math.min(100, percent)) : 0;
  const low = valid && percent < 15;
  const cls = tone !== 'auto' ? tone : low ? 'crit' : percent < 30 ? 'low' : '';
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="ring-svg">
        <defs>
          <linearGradient id={`ringGrad-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className="ring-stop-a" />
            <stop offset="100%" className="ring-stop-b" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} />
        {valid && (
          <circle
            cx={size / 2} cy={size / 2} r={r}
            className={`ring-fill ${cls}`}
            stroke={`url(#ringGrad-${size})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - p / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="ring-text">
        <div className="ring-value">{valid ? `${p.toFixed(0)}%` : '—'}</div>
        {label && <div className="ring-label">{label}</div>}
        {sub && <div className="ring-sub">{sub}</div>}
      </div>
    </div>
  );
}

/** 额度趋势 sparkline：history=[{t,remaining}]，画剩余量走势（面积+线） */
export function Sparkline({ history, width = 200, height = 44 }) {
  const pts = (history || []).filter((h) => h && h.remaining != null).slice(-60);
  if (pts.length < 2) {
    return <div className="spark empty">数据积累中（自动刷新后出现趋势）</div>;
  }
  const values = pts.map((h) => h.remaining);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const step = (width - pad * 2) / (pts.length - 1);
  const xy = pts.map((h, i) => [
    pad + i * step,
    height - pad - ((h.remaining - min) / span) * (height - pad * 2),
  ]);
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${height - pad} L${xy[0][0].toFixed(1)} ${height - pad} Z`;
  const last = values[values.length - 1];
  const first = values[0];
  const down = last < first;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="spark-stop-a" />
          <stop offset="100%" className="spark-stop-b" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkFill)" />
      <path d={line} className={`spark-line ${down ? 'down' : ''}`} fill="none" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.5" className={`spark-dot ${down ? 'down' : ''}`} />
    </svg>
  );
}

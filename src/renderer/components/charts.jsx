import React, { useMemo, useRef, useState } from 'react';
import { fmtNum } from '../util.js';

/**
 * 额度趋势 sparkline：hover 显示该点的时间与剩余量。
 * history=[{t,remaining}]，取最近 60 点。
 */
export function Sparkline({ history, width = 200, height = 44 }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // {x, y, point}

  const pts = useMemo(
    () => (history || []).filter((h) => h && h.remaining != null).slice(-60),
    [history],
  );

  const geom = useMemo(() => {
    if (pts.length < 2) return null;
    const values = pts.map((h) => h.remaining);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 4;
    const step = (width - pad * 2) / (pts.length - 1);
    const xy = pts.map((h, i) => ({
      x: pad + i * step,
      y: height - pad - ((h.remaining - min) / span) * (height - pad * 2),
      point: h,
    }));
    const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L${xy[xy.length - 1].x.toFixed(1)} ${height - pad} L${xy[0].x.toFixed(1)} ${height - pad} Z`;
    return { xy, line, area, min, max };
  }, [pts, width, height]);

  if (!geom) {
    return <div className="spark empty">数据积累中（自动刷新后出现趋势）</div>;
  }

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let nearest = geom.xy[0];
    for (const p of geom.xy) {
      if (Math.abs(p.x - mx) < Math.abs(nearest.x - mx)) nearest = p;
    }
    setHover({ ...nearest });
  };

  const last = geom.xy[geom.xy.length - 1];
  const first = geom.xy[0];
  const down = last.point.remaining < first.point.remaining;

  return (
    <div className="spark-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="spark-stop-a" />
            <stop offset="100%" className="spark-stop-b" />
          </linearGradient>
        </defs>
        <path d={geom.area} fill="url(#sparkFill)" />
        <path d={geom.line} className={`spark-line ${down ? 'down' : ''}`} fill="none" />
        {hover && (
          <line x1={hover.x} y1={2} x2={hover.x} y2={height - 2} className="spark-cursor" />
        )}
        <circle cx={last.x} cy={last.y} r="2.5" className={`spark-dot ${down ? 'down' : ''}`} />
        {hover && <circle cx={hover.x} cy={hover.y} r="3" className="spark-hover-dot" />}
      </svg>
      {hover && (
        <div
          className="spark-tip"
          style={{
            left: Math.max(4, Math.min(width - 96, hover.x - 46)),
            top: Math.max(0, hover.y - 44),
          }}
        >
          <b>{fmtNum(hover.point.remaining)}</b>
          <span>{new Date(hover.point.t).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
    </div>
  );
}

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

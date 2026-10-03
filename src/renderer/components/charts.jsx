import React, { useMemo, useRef, useState } from 'react';
import { fmtNum } from '../util.js';

/**
 * 消耗柱状图：每根柱 = 两次刷新之间的用量（remaining 差值）。
 * history=[{t,remaining}]，取最近 maxBars 点，悬停显示时间与消耗量。
 * full=true 时宽度自适应容器（SVG viewBox 缩放，悬停坐标做换算）。
 */
export function UsageBars({ history, width = 230, height = 72, maxBars = 28, full = false }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // {x, y, w, h, bar}

  const bars = useMemo(() => {
    const pts = (history || []).filter((h) => h && h.remaining != null).slice(-maxBars);
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1].remaining ?? pts[i].remaining;
      out.push({ t: pts[i].t, used: Math.max(0, prev - pts[i].remaining) });
    }
    return out;
  }, [history, maxBars]);

  const PAD_BOTTOM = 3;
  const gap = 2;

  const geom = useMemo(() => {
    if (bars.length < 2) return null;
    const max = Math.max(...bars.map((b) => b.used), 1);
    const barW = Math.max(3, Math.floor((width - (bars.length - 1) * gap) / bars.length));
    const totalW = bars.length * barW + (bars.length - 1) * gap;
    const x0 = Math.floor((width - totalW) / 2);
    const rects = bars.map((b, i) => {
      const h = Math.max(2, (b.used / max) * (height - PAD_BOTTOM - 4));
      return {
        x: x0 + i * (barW + gap),
        y: height - PAD_BOTTOM - h,
        w: barW,
        h,
        bar: b,
      };
    });
    return { rects, max };
  }, [bars, width, height]);

  if (!geom) {
    return <div className="spark empty">数据积累中（自动刷新后出现消耗柱状图）</div>;
  }

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const scale = full && rect.width > 0 ? width / rect.width : 1; // 满宽模式下鼠标坐标 → 逻辑坐标
    const mx = (e.clientX - rect.left) * scale;
    let nearest = geom.rects[0];
    for (const r of geom.rects) {
      const cx = r.x + r.w / 2;
      if (Math.abs(cx - mx) < Math.abs(nearest.x + nearest.w / 2 - mx)) nearest = r;
    }
    setHover(nearest);
  };

  return (
    <div className="spark-wrap" style={full ? { width: '100%' } : undefined} ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg
        className="spark"
        width={full ? '100%' : width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={full ? 'none' : 'xMidYMid meet'}
      >
        <defs>
          <linearGradient id="usageBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="spark-stop-a" />
            <stop offset="100%" className="usage-stop-b" />
          </linearGradient>
        </defs>
        {geom.rects.map((r, i) => (
          <rect
            key={i}
            x={r.x} y={r.y} width={r.w} height={r.h} rx={Math.min(2, r.w / 2)}
            className={`usage-bar ${hover === r ? 'hot' : ''}`}
            fill="url(#usageBarGrad)"
          />
        ))}
        <line x1="0" y1={height - PAD_BOTTOM} x2={width} y2={height - PAD_BOTTOM} className="usage-base" />
      </svg>
      {hover && (() => {
        const rect = wrapRef.current ? wrapRef.current.getBoundingClientRect() : { width };
        const rscale = full && rect.width > 0 ? width / rect.width : 1; // 逻辑坐标 → 渲染像素
        const leftPx = (hover.x + hover.w / 2) / rscale - 55;
        return (
          <div
            className="spark-tip"
            style={{
              left: Math.max(4, Math.min(rect.width - 110, leftPx)),
              top: Math.max(0, hover.y - 46),
            }}
          >
            <b>消耗 {fmtNum(hover.bar.used)}</b>
            <span>{new Date(hover.bar.t).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        );
      })()}
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

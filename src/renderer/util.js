import React, { useEffect, useRef, useState } from 'react';

export const fmtNum = (v) => (v == null ? '未知' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v));

/** 大数的近似后缀（≥100 万 ≈M，≥10 亿 ≈B），不足 100 万返回 null */
export const approxNum = (v) => {
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `≈${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `≈${(v / 1e6).toFixed(1)}M`;
  return null;
};

/** token 数展示：完整数字 + 大数近似后缀（≥100 万 ≈M，≥10 亿 ≈B） */
export const fmtToken = (v) => {
  if (v == null) return '未知';
  const ap = approxNum(v);
  return ap ? `${fmtNum(v)} ${ap}` : fmtNum(v);
};
export const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—');
export const fmtDay = (ts) => (ts ? new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—');

/** 到期倒计时文案 */
export function fmtExpiry(ts) {
  if (!ts) return null;
  const days = Math.ceil((ts - Date.now()) / 86400000);
  if (days < 0) return '已到期';
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
  return `${days} 天后到期`;
}

/** 今日消耗：今天之内相邻历史点之间「剩余量下降」的累加（与消耗柱状图同口径；
 *  额度刷新导致的剩余上涨自动跳过，不会把当日消耗错误地记为 0） */
export function usedToday(history) {
  const pts = (history || []).filter((h) => h && h.remaining != null);
  if (pts.length < 2) return null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  let sum = 0, has = false, prev = null;
  for (const p of pts) {
    if (prev != null && p.t >= todayStart.getTime()) {
      const drop = prev - p.remaining;
      if (drop > 0) { sum += drop; has = true; }
    }
    prev = p.remaining;
  }
  return has ? sum : null;
}

/** 数字滚动动画（缓出），value 为 null 时返回 null */
export function useCountUp(value, duration = 700) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (value == null) { setDisplay(null); fromRef.current = null; return; }
    const from = fromRef.current == null ? value : fromRef.current;
    const to = value;
    if (from === to) { setDisplay(to); return; }
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

// ---- 账号头像：按 id 稳定散列到一组渐变色 ----
const AVATAR_GRADS = [
  ['#6c7bff', '#9d6bff'],
  ['#4cc9f0', '#6c7bff'],
  ['#3ecf8e', '#4cc9f0'],
  ['#f5a623', '#ff8b4c'],
  ['#ff5c6c', '#c06bff'],
  ['#9d6bff', '#ff6b9e'],
  ['#7c8cff', '#3ecf8e'],
  ['#ff8b4c', '#ffd166'],
];

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarGrad(id) {
  return AVATAR_GRADS[hashStr(String(id || '?')) % AVATAR_GRADS.length];
}

export function initialsOf(name) {
  const s = String(name || '?').trim();
  const cleaned = s.replace(/[^\p{L}\p{N}]/gu, '');
  return (cleaned.slice(0, 2) || s.slice(0, 2) || '?').toUpperCase();
}

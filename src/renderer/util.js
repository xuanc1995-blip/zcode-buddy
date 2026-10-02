export const fmtNum = (v) => (v == null ? '未知' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v));
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

/** 今日消耗：history 里今天最早的 remaining 与最新 remaining 的差值 */
export function usedToday(history) {
  const pts = (history || []).filter((h) => h && h.remaining != null);
  if (pts.length < 2) return null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todays = pts.filter((h) => h.t >= todayStart.getTime());
  if (todays.length < 1) return null;
  const base = todays[0].remaining;
  const now = pts[pts.length - 1].remaining;
  return Math.max(0, base - now);
}

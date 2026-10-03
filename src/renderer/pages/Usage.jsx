import React, { useEffect, useState } from 'react';
import { UsageBars } from '../components/charts.jsx';
import Avatar from '../components/Avatar.jsx';
import { fmtNum, fmtToken, approxNum, fmtDate, usedToday, usedYesterday } from '../util.js';

/** 本地时区 YYYY-MM-DD 日期键（offset=1 即昨天），与 store 的 daily.json 键一致 */
function dayKey(offset = 0) {
  const d = new Date(Date.now() - offset * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 用量统计页：单账号 / 全部合并两种视图，当日 + 总计两组数字 */
export default function Usage({ state, accounts, showToast }) {
  const currentId = state?.current?.shortId;
  const [mode, setMode] = useState('merged'); // 'merged' | 'single'
  const [selId, setSelId] = useState(null);
  const [daily, setDaily] = useState(null); // 按日聚合（daily.json），跨 48 小时历史上限仍可看昨日/近 7 天
  const [trendDays, setTrendDays] = useState(7); // 趋势区间：7 / 30 天
  const [trendModel, setTrendModel] = useState('__total__'); // 趋势视角：合计或某模型
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    window.buddy.statsDaily?.().then(setDaily).catch(() => {});
  }, []);

  const dailyMap = daily ? Object.fromEntries(daily.days.map((d) => [d.date, d])) : {};
  const yesterdayDaily = dailyMap[dayKey(1)]?.total ?? null;
  const trend = daily ? daily.days.slice(-trendDays) : [];
  // 趋势视角：合计 或 某个模型（模型清单=窗口期内出现过的，按窗口总量降序）
  const modelNames = Object.keys(Object.assign({}, ...trend.map((d) => d.models || {})));
  modelNames.sort((a, b) => (trend.reduce((s, d) => s + (d.models?.[b] || 0), 0)) - (trend.reduce((s, d) => s + (d.models?.[a] || 0), 0)));
  const trendValue = (d) => (trendModel === '__total__' ? (d.total || 0) : (d.models?.[trendModel] || 0));
  const maxTrend = Math.max(...trend.map(trendValue), 1);

  const doExport = async () => {
    setExporting(true);
    try {
      const r = await window.buddy.exportDailyCsv();
      if (!r.canceled) showToast(r.empty ? '暂无可导出的每日数据' : `已导出 ${r.days} 天数据到 CSV`);
    } catch (e) {
      showToast(e.message.replace(/^.*Error: /, ''), 'err');
    } finally {
      setExporting(false);
    }
  };

  const withData = accounts.filter((a) => a.quota && a.quota.percentUsed != null);
  const merged = {
    today: withData.reduce((s, a) => s + (a.todayUsed ?? usedToday(a.history) ?? 0), 0),
    yesterday: yesterdayDaily ?? withData.reduce((s, a) => s + (usedYesterday(a.history) || 0), 0),
    used: withData.reduce((s, a) => s + (a.quota.used || 0), 0),
    remaining: withData.reduce((s, a) => s + (a.quota.remaining || 0), 0),
    points: withData.reduce((s, a) => s + (a.history || []).length, 0),
  };

  // 单账号视图的当前选中账号
  const singleId = accounts.find((a) => a.id === selId) ? selId
    : (accounts.find((a) => a.id === currentId) ? currentId : accounts[0]?.id);
  const account = accounts.find((a) => a.id === singleId);
  const yesterdaySingle = account ? (dailyMap[dayKey(1)]?.accounts?.[singleId] ?? usedYesterday(account.history)) : null;

  // 合并视图：按账号顺序（store 层已按名称数字升序）逐个统计

  const StatCard = ({ value, label, tone }) => (
    <div className={`stat ${tone || ''}`}>
      <span className="stat-num">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>用量统计</h1>
          <p className="page-sub">当日与总计两组数字，支持单账号或全部合并查看</p>
        </div>
        <div className="theme-switch segmented">
          <button className={`theme-btn ${mode === 'merged' ? 'active' : ''}`} onClick={() => setMode('merged')}>全部合并</button>
          <button className={`theme-btn ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>单账号</button>
        </div>
      </header>

      {accounts.length === 0 ? (
        <div className="empty"><p>暂无账号数据</p><p className="dim">先到「账号管理」保存账号，额度自动刷新后这里会出现统计</p></div>
      ) : mode === 'merged' ? (
        <>
          {/* 合并视图：当日 + 总计 两组汇总 */}
          <section className="merged-cards">
            <div className="merged-group">
              <span className="sec-label">当日（按各账号历史记录累加）</span>
              <div className="stat"><span className="stat-label">今日总消耗</span><span className="stat-num">{merged.today > 0 ? fmtNum(merged.today) : '—'}</span><span className="stat-approx">{merged.today > 0 && approxNum(merged.today)}</span></div>
            </div>
            <div className="merged-group">
              <span className="sec-label">概览</span>
              <div className="stat-grid4">
                <div className="stat"><span className="stat-label">昨日消耗</span><span className="stat-num">{merged.yesterday != null ? fmtNum(merged.yesterday) : '—'}</span><span className="stat-approx">{merged.yesterday != null && approxNum(merged.yesterday)}</span></div>
                <div className="stat"><span className="stat-label">全部剩余</span><span className="stat-num">{fmtNum(merged.remaining)}</span><span className="stat-approx">{approxNum(merged.remaining)}</span></div>
                <div className="stat"><span className="stat-label">账号数</span><span className="stat-num">{accounts.length}</span></div>
                <div className="stat"><span className="stat-label">历史点数</span><span className="stat-num">{merged.points}</span></div>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2 style={{ marginBottom: 4 }}>各账号用量</h2>
            <div className="rows">
              {accounts.map((a) => {
                const today = a.todayUsed ?? usedToday(a.history);
                const yesterday = dailyMap[dayKey(1)]?.accounts?.[a.id] ?? usedYesterday(a.history);
                const pct = a.quota?.percentUsed != null ? 100 - a.quota.percentUsed : null;
                const isCurrent = a.id === currentId;
                return (
                  <div key={a.id} className="usage-row">
                    <div className="usage-who">
                      <Avatar name={a.name} id={a.id} size={32} />
                      <b>{a.name}</b>
                      {isCurrent && <span className="badge">当前</span>}
                      <span className="hint">{a.quota?.plan?.tier || '—'}</span>
                    </div>
                    <div className="usage-col"><span className="uc-label">今日</span><b className="uc-val">{today != null ? fmtNum(today) : '—'}</b></div>
                    <div className="usage-col"><span className="uc-label">昨日</span><b className="uc-val">{yesterday != null ? fmtNum(yesterday) : '—'}</b></div>
                    <div className="model-bar"><div className="model-fill" style={{ width: pct != null ? `${pct}%` : '0%' }} /></div>
                    <em className="usage-pct">{pct != null ? `剩${pct.toFixed(0)}%` : '—'}</em>
                  </div>
                );
              })}
            </div>
            <p className="hint block">「今日消耗」为服务器实时口径（各活跃额度当日已用之和）；「昨日 / 近 7 天」来自按日聚合存档（daily.json），应用关闭期间的数据在下次启动后仍完整保留。</p>
          </section>

          {trend.length > 0 && (
            <section className="panel">
              <div className="page-head" style={{ marginBottom: 4 }}>
                <h2>每日消耗趋势{trendModel !== '__total__' ? ` · ${trendModel}` : '（全部账号合计）'}</h2>
                <div className="row-gap">
                  {modelNames.length > 0 && (
                    <select value={trendModel} onChange={(e) => setTrendModel(e.target.value)} style={{ padding: '4px 8px' }}>
                      <option value="__total__">全部模型合计</option>
                      {modelNames.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  <div className="theme-switch segmented">
                    <button className={`theme-btn ${trendDays === 7 ? 'active' : ''}`} onClick={() => setTrendDays(7)}>7 天</button>
                    <button className={`theme-btn ${trendDays === 30 ? 'active' : ''}`} onClick={() => setTrendDays(30)}>30 天</button>
                  </div>
                  <button className="btn ghost" disabled={exporting} onClick={doExport}>导出 CSV</button>
                </div>
              </div>
              <div className="rows">
                {trend.map((d) => {
                  const v = trendValue(d);
                  return (
                    <div key={d.date} className="usage-row" style={{ gridTemplateColumns: 'minmax(84px, auto) 1fr minmax(90px, auto)' }}>
                      <span className="hint">{d.date.slice(5).replace('-', '/')}{d.date === dayKey(0) ? '（今天）' : ''}</span>
                      <div className="model-bar"><div className="model-fill" style={{ width: `${Math.max(2, (v / maxTrend) * 100)}%`, opacity: v > 0 ? 1 : 0.25 }} /></div>
                      <em className="usage-pct" style={{ fontStyle: 'normal' }}>{fmtNum(v)}</em>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          {/* 单账号视图 */}
          <div className="account-chips">
            {accounts.map((a) => (
              <button key={a.id} className={`chip ${a.id === singleId ? 'active' : ''}`} onClick={() => setSelId(a.id)}>
                <Avatar name={a.name} id={a.id} size={22} />
                {a.name}
              </button>
            ))}
          </div>
          {account ? (
            <>
              <section className="stats">
                <div className="stat"><span className="stat-label">今日消耗</span><span className="stat-num">{account.todayUsed != null ? fmtNum(account.todayUsed) : (usedToday(account.history) != null ? fmtNum(usedToday(account.history)) : '—')}</span><span className="stat-approx">{(account.todayUsed != null || usedToday(account.history) != null) && approxNum(account.todayUsed ?? usedToday(account.history))}</span></div>
                <div className="stat"><span className="stat-label">昨日消耗</span><span className="stat-num">{yesterdaySingle != null ? fmtNum(yesterdaySingle) : '—'}</span><span className="stat-approx">{yesterdaySingle != null && approxNum(yesterdaySingle)}</span></div>
                <div className="stat"><span className="stat-label">剩余额度</span><span className="stat-num">{fmtNum(account.quota?.remaining)}</span><span className="stat-approx">{approxNum(account.quota?.remaining)}</span></div>
                <div className="stat"><span className="stat-label">历史记录点</span><span className="stat-num">{(account.history || []).length}</span></div>
              </section>
              <section className="panel">
                <h2 style={{ marginBottom: 4 }}>消耗趋势 · {account.name}</h2>
                <UsageBars history={account.history} width={880} height={170} maxBars={60} full />
                {(account.history || []).length < 2 && <p className="hint block">柱状图需要至少两次刷新记录；保持应用开启，每 5 分钟自动积累一个数据点。</p>}
              </section>
              {account.quota && !account.quota.isEmpty && (account.quota.items || []).length > 0 && (
                <section className="panel">
                  <h2 style={{ marginBottom: 4 }}>分模型明细（截至 {fmtDate(account.quotaRefreshedAt)}）</h2>
                  <div className="rows">
                    {account.quota.items.map((it, i) => {
                      const pct = it.total ? Math.max(0, Math.min(100, ((it.remaining ?? 0) / it.total) * 100)) : null;
                      return (
                        <div key={i} className="setting-row">
                          <div className="setting-info"><b>{it.name}</b><span className="hint">剩 {fmtToken(it.remaining)} / {fmtToken(it.total)}</span></div>
                          <div className="setting-ctl" style={{ flex: 1, maxWidth: 320 }}>
                            <div className="model-bar" style={{ flex: 1, height: 8 }}><div className="model-fill" style={{ width: pct != null ? `${pct}%` : '0%' }} /></div>
                            <em className="ctl-value">{pct != null ? `${pct.toFixed(0)}%` : '—'}</em>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

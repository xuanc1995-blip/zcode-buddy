import React, { useState } from 'react';
import { UsageBars } from '../components/charts.jsx';
import Avatar from '../components/Avatar.jsx';
import { fmtNum, fmtDate, usedToday } from '../util.js';

/** 用量统计页：单账号 / 全部合并两种视图，当日 + 总计两组数字 */
export default function Usage({ state, accounts }) {
  const currentId = state?.current?.shortId;
  const [mode, setMode] = useState('merged'); // 'merged' | 'single'
  const [selId, setSelId] = useState(null);

  const withData = accounts.filter((a) => a.quota && a.quota.percentUsed != null);
  const merged = {
    today: withData.reduce((s, a) => s + (usedToday(a.history) || 0), 0),
    used: withData.reduce((s, a) => s + (a.quota.used || 0), 0),
    remaining: withData.reduce((s, a) => s + (a.quota.remaining || 0), 0),
    points: withData.reduce((s, a) => s + (a.history || []).length, 0),
  };

  // 单账号视图的当前选中账号
  const singleId = accounts.find((a) => a.id === selId) ? selId
    : (accounts.find((a) => a.id === currentId) ? currentId : accounts[0]?.id);
  const account = accounts.find((a) => a.id === singleId);

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
              <div className="stat"><span className="stat-num">{merged.today > 0 ? fmtNum(merged.today) : '—'}</span><span className="stat-label">今日总消耗</span></div>
            </div>
            <div className="merged-group">
              <span className="sec-label">总计</span>
              <div className="stat-grid4">
                <div className="stat"><span className="stat-num">{fmtNum(merged.used)}</span><span className="stat-label">累计已用</span></div>
                <div className="stat"><span className="stat-num">{fmtNum(merged.remaining)}</span><span className="stat-label">全部剩余</span></div>
                <div className="stat"><span className="stat-num">{accounts.length}</span><span className="stat-label">账号数</span></div>
                <div className="stat"><span className="stat-num">{merged.points}</span><span className="stat-label">历史点数</span></div>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2 style={{ marginBottom: 4 }}>各账号用量</h2>
            <div className="rows">
              {accounts.map((a) => {
                const today = usedToday(a.history);
                const pct = a.quota?.percentUsed != null ? 100 - a.quota.percentUsed : null;
                const isCurrent = a.id === currentId;
                return (
                  <div key={a.id} className="setting-row">
                    <div className="setting-info" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Avatar name={a.name} id={a.id} size={32} />
                      <b>{a.name}</b>
                      {isCurrent && <span className="badge">当前</span>}
                      <span className="hint">{a.quota?.plan?.tier || '—'}</span>
                    </div>
                    <div className="setting-ctl" style={{ flex: 1, maxWidth: 420, justifyContent: 'flex-end' }}>
                      <span className="rank-col" title="今日消耗">今日 <b>{today != null ? fmtNum(today) : '—'}</b></span>
                      <span className="rank-col" title="累计已用">累计 <b>{fmtNum(a.quota?.used)}</b></span>
                      <div className="model-bar" style={{ width: 110, height: 8 }}><div className="model-fill" style={{ width: pct != null ? `${pct}%` : '0%' }} /></div>
                      <em className="ctl-value">{pct != null ? `剩${pct.toFixed(0)}%` : '—'}</em>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="hint block">「今日消耗」基于各账号的历史记录（自动轮询每 5 分钟积累一个点），应用关闭期间不统计。</p>
          </section>
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
                <div className="stat"><span className="stat-num">{usedToday(account.history) != null ? fmtNum(usedToday(account.history)) : '—'}</span><span className="stat-label">今日消耗</span></div>
                <div className="stat"><span className="stat-num">{fmtNum(account.quota?.used)}</span><span className="stat-label">累计已用</span></div>
                <div className="stat"><span className="stat-num">{fmtNum(account.quota?.remaining)}</span><span className="stat-label">剩余额度</span></div>
                <div className="stat"><span className="stat-num">{(account.history || []).length}</span><span className="stat-label">历史记录点</span></div>
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
                          <div className="setting-info"><b>{it.name}</b><span className="hint">剩 {fmtNum(it.remaining)} / {fmtNum(it.total)}</span></div>
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

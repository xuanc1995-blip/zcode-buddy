import React, { useState } from 'react';
import { UsageBars } from '../components/charts.jsx';
import Avatar from '../components/Avatar.jsx';
import { fmtNum, fmtDate, usedToday } from '../util.js';

/** 用量统计页：按账号查看消耗柱状大图与汇总数字 */
export default function Usage({ state, accounts }) {
  const currentId = state?.current?.shortId;
  const [selId, setSelId] = useState(null);
  const id = accounts.find((a) => a.id === selId) ? selId : (accounts.find((a) => a.id === currentId) ? currentId : accounts[0]?.id);
  const account = accounts.find((a) => a.id === id);

  if (!account) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>用量统计</h1><p className="page-sub">消耗趋势与数字概览</p></div></header>
        <div className="empty"><p>暂无账号数据</p><p className="dim">先到「账号管理」保存账号，额度自动刷新后这里会出现趋势图</p></div>
      </div>
    );
  }

  const q = account.quota;
  const histCount = (account.history || []).length;
  const today = usedToday(account.history);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>用量统计</h1>
          <p className="page-sub">消耗趋势与数字概览（历史随自动轮询积累，最多 240 点）</p>
        </div>
        {accounts.length > 1 && (
          <div className="theme-switch segmented">
            {accounts.map((a) => (
              <button key={a.id} className={`theme-btn ${a.id === id ? 'active' : ''}`} onClick={() => setSelId(a.id)}>
                {a.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <section className="hero usage-hero">
        <div className="usage-side">
          <Avatar name={account.name} id={account.id} size={44} />
          <div className="usage-side-info">
            <div className="who-line"><span className="name">{account.name}</span>{account.id === currentId && <span className="badge">当前</span>}</div>
            <span className="hint">{q?.plan?.tier || '—'}{q?.plan?.expiresAt ? ` · ${fmtDate(q.plan.expiresAt)} 到期` : ''}</span>
          </div>
        </div>
        <div className="usage-stats">
          <div className="stat"><span className="stat-num">{today != null ? fmtNum(today) : '—'}</span><span className="stat-label">今日消耗</span></div>
          <div className="stat"><span className="stat-num">{fmtNum(q?.used)}</span><span className="stat-label">累计已用</span></div>
          <div className="stat"><span className="stat-num">{fmtNum(q?.remaining)}</span><span className="stat-label">剩余额度</span></div>
          <div className="stat"><span className="stat-num">{histCount}</span><span className="stat-label">历史记录点</span></div>
        </div>
      </section>

      <section className="panel">
        <h2 style={{ marginBottom: 4 }}>消耗趋势</h2>
        <UsageBars history={account.history} width={880} height={170} maxBars={60} full />
        {histCount < 2 && <p className="hint block">柱状图需要至少两次刷新记录；保持应用开启，每 5 分钟自动积累一个数据点。</p>}
      </section>

      {q && !q.isEmpty && (q.items || []).length > 0 && (
        <section className="panel">
          <h2 style={{ marginBottom: 4 }}>分模型明细</h2>
          <div className="rows">
            {q.items.map((it, i) => {
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
    </div>
  );
}

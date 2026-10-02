import React from 'react';
import { RingGauge, Sparkline } from '../components/charts.jsx';
import { IconZap, IconSwitch, IconAlert, IconClock, IconRefresh, IconCheck } from '../components/icons.jsx';
import { fmtNum, fmtDate, fmtExpiry, usedToday } from '../util.js';

export default function Dashboard({ state, accounts, settings, busy, run, setConfirm, goPage }) {
  const currentId = state?.current?.shortId;
  const current = accounts.find((a) => a.id === currentId);
  const others = accounts.filter((a) => a.id !== currentId);

  const withData = accounts.filter((a) => a.quota && a.quota.percentUsed != null);
  const totalRemaining = withData.reduce((s, a) => s + (a.quota.remaining || 0), 0);
  const totalUsed = withData.reduce((s, a) => s + (a.quota.used || 0), 0);
  const threshold = settings?.lowQuotaThreshold ?? 10;
  const lowAccounts = withData.filter((a) => 100 - a.quota.percentUsed < threshold);
  const expiredAccounts = accounts.filter((a) => a.tokenStatus === 'expired');
  const todayUsed = usedToday(current?.history);

  const doUse = (account) => setConfirm({
    title: `切换到「${account.name}」？`,
    body: '将自动关闭 ZCode → 替换登录态 → 重新启动 ZCode。当前登录态会先备份，可一键回滚。',
    danger: false,
    onOk: () => run(async () => { await window.buddy.useAccount(account.id); }, '切换完成，ZCode 已重启'),
  });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>仪表盘</h1>
          <p className="page-sub">当前账号与所有账号额度总览</p>
        </div>
        <button className="btn" disabled={busy} onClick={() => run(async () => { await window.buddy.refreshQuota('all'); }, '额度已刷新')}>
          <IconRefresh size={15} /> 刷新全部额度
        </button>
      </header>

      {/* 当前账号 Hero */}
      <section className="hero">
        {current ? (
          <>
            <RingGauge
              size={176}
              percent={current.quota?.percentUsed != null ? 100 - current.quota.percentUsed : null}
              label="剩余额度"
              sub={current.quota?.remaining != null ? fmtNum(current.quota.remaining) : ''}
            />
            <div className="hero-info">
              <div className="hero-title">
                <span className="hero-name">{current.name}</span>
                <span className="badge">当前</span>
                {current.tokenStatus === 'expired' && <span className="badge warn"><IconAlert size={11} /> Token 过期</span>}
              </div>
              {current.email && <div className="hero-email">{current.email}</div>}
              <div className="hero-rows">
                <div className="hrow"><IconZap size={14} /><span>套餐：{current.quota?.plan?.tier || current.quota?.plan?.planName || '—'}</span></div>
                <div className="hrow"><IconClock size={14} /><span>
                  {current.quota?.plan?.expiresAt
                    ? <>套餐 {fmtExpiry(current.quota.plan.expiresAt)}（{fmtDate(current.quota.plan.expiresAt)}）</>
                    : '套餐到期：—'}
                </span></div>
                <div className="hrow"><IconCheck size={14} /><span>
                  总量 {fmtNum(current.quota?.total)} · 已用 {fmtNum(current.quota?.used)}
                  {todayUsed != null && <> · 今日消耗 {fmtNum(todayUsed)}</>}
                </span></div>
              </div>
              {current.quota && !current.quota.isEmpty && (
                <div className="hero-models">
                  {current.quota.items.map((it, i) => (
                    <div key={i} className="model-row">
                      <span className="model-name">{it.name}</span>
                      <div className="model-bar"><div
                        className="model-fill"
                        style={{ width: it.total ? `${Math.max(0, Math.min(100, ((it.remaining ?? 0) / it.total) * 100))}%` : '0%' }}
                      /></div>
                      <span className="model-num">{fmtNum(it.remaining)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="hero-trend">
              <span className="sec-label">近 60 次刷新 · 剩余量趋势</span>
              <Sparkline history={current.history} width={220} height={56} />
            </div>
          </>
        ) : (
          <div className="hero-empty">
            <IconZap size={30} />
            <p>尚未识别到当前登录的账号</p>
            <p className="dim">请先登录 ZCode 客户端，然后到「账号管理」保存账号</p>
            <button className="btn primary" onClick={() => goPage('accounts')}>前往账号管理</button>
          </div>
        )}
      </section>

      {/* 汇总统计 */}
      <section className="stats">
        <div className="stat">
          <span className="stat-num">{accounts.length}</span>
          <span className="stat-label">账号总数</span>
        </div>
        <div className="stat">
          <span className="stat-num">{fmtNum(totalRemaining)}</span>
          <span className="stat-label">全部剩余额度</span>
        </div>
        <div className="stat">
          <span className="stat-num">{fmtNum(totalUsed)}</span>
          <span className="stat-label">累计已用</span>
        </div>
        <div className={`stat ${lowAccounts.length ? 'warn' : ''}`}>
          <span className="stat-num">{lowAccounts.length}</span>
          <span className="stat-label">低额度账号（&lt;{threshold}%）</span>
        </div>
      </section>

      {/* 告警与快捷切换 */}
      {(lowAccounts.length > 0 || expiredAccounts.length > 0) && (
        <section className="alert-box">
          <IconAlert size={16} />
          <div>
            {lowAccounts.length > 0 && <div>额度不足：{lowAccounts.map((a) => a.name).join('、')}（剩余低于 {threshold}%）</div>}
            {expiredAccounts.length > 0 && <div>Token 已过期：{expiredAccounts.map((a) => a.name).join('、')}，请在 ZCode 重新登录后再「保存当前账号」</div>}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <span className="sec-label">快捷切换</span>
          <div className="quick-grid">
            {others.map((a) => {
              const pct = a.quota?.percentUsed != null ? 100 - a.quota.percentUsed : null;
              return (
                <button key={a.id} className="quick-card" disabled={busy} onClick={() => doUse(a)}>
                  <div className="quick-top">
                    <span className="quick-name">{a.name}</span>
                    <IconSwitch size={14} />
                  </div>
                  <div className="quick-quota">
                    {pct != null ? <>剩余 <b>{pct.toFixed(0)}%</b> · {fmtNum(a.quota.remaining)}</> : '额度未知'}
                  </div>
                  {a.quota?.plan?.tier && <div className="quick-plan">{a.quota.plan.tier}</div>}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

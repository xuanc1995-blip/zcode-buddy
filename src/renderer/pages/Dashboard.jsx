import React, { useEffect, useMemo, useState } from 'react';
import { RingGauge, UsageBars } from '../components/charts.jsx';
import Avatar from '../components/Avatar.jsx';
import { IconZap, IconSwitch, IconAlert, IconClock, IconRefresh, IconLayers, IconFlame, IconCalendar } from '../components/icons.jsx';
import { fmtNum, fmtToken, approxNum, fmtDate, fmtExpiry, usedToday, useCountUp } from '../util.js';

function Stat({ value, label, warn, token }) {
  const animated = useCountUp(value);
  const v = animated == null ? null : Math.round(animated);
  const ap = token && v != null ? approxNum(v) : null;
  return (
    <div className={`stat ${warn ? 'warn' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-num">{token ? (v == null ? '—' : fmtNum(v)) : animated == null ? '—' : String(animated)}</span>
      {ap && <span className="stat-approx">{ap}</span>}
    </div>
  );
}

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
  const remainingPct = current?.quota?.percentUsed != null ? 100 - current.quota.percentUsed : null;
  const currentLow = remainingPct != null && remainingPct < threshold;

  // 环形表的口径：null=自动跟随最常用模型，'all'=全部合计，数字=指定模型下标
  const models = current?.quota?.items || [];
  const [selModel, setSelModel] = useState(null);
  useEffect(() => { setSelModel(null); }, [currentId, models.length]);
  const autoIdx = useMemo(() => {
    let best = -1, max = -1;
    models.forEach((m, i) => { if ((m.used ?? 0) > max) { max = m.used ?? 0; best = i; } });
    return best;
  }, [models]);
  const sel = typeof selModel === 'number'
    ? models[selModel]
    : selModel === 'all'
      ? null
      : (autoIdx >= 0 ? models[autoIdx] : null);
  const ringModel = sel && sel.total ? { percent: Math.max(0, (sel.remaining ?? 0) / sel.total * 100), name: sel.name, remaining: sel.remaining } : null;

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
            <div className="hero-ring">
              <RingGauge
                size={176}
                percent={ringModel ? ringModel.percent : remainingPct}
                label={ringModel ? ringModel.name : '剩余额度'}
                sub={'剩 ' + (ringModel ? fmtNum(ringModel.remaining) : (current.quota?.remaining != null ? fmtNum(current.quota.remaining) : '—'))}
              />
              <button
                className={`all-chip ${selModel === 'all' ? 'active' : ''}`}
                onClick={() => setSelModel(selModel === 'all' ? null : 'all')}
                title="显示全部模型合计"
              >
                合计
              </button>
            </div>
            <div className="hero-info">
              <div className="hero-title">
                <Avatar name={current.name} id={current.id} size={44} />
                <div className="hero-who">
                  <div className="hero-name-line">
                    <span className="hero-name">{current.name}</span>
                    <span className="badge">当前</span>
                    {current.tokenStatus === 'expired' && <span className="badge warn"><IconAlert size={11} /> Token 过期</span>}
                  </div>
                  {current.email && <div className="hero-email">{current.email}</div>}
                </div>
              </div>
              <div className="hero-rows">
                <div className="hrow"><IconZap size={14} /><span>套餐：{current.quota?.plan?.tier || current.quota?.plan?.planName || '—'}</span></div>
                <div className="hrow"><IconClock size={14} /><span>
                  {current.quota?.plan?.expiresAt
                    ? <>套餐 {fmtExpiry(current.quota.plan.expiresAt)}（{fmtDate(current.quota.plan.expiresAt)}）</>
                    : '套餐到期：—'}
                </span></div>
                <div className="hrow"><IconLayers size={14} /><span>总量 <b>{fmtToken(current.quota?.total)}</b></span></div>
                <div className="hrow"><IconFlame size={14} /><span>已用 <b>{fmtToken(current.quota?.used)}</b>{current.quota?.percentUsed != null && `（${current.quota.percentUsed.toFixed(1)}%）`}</span></div>
                <div className="hrow"><IconCalendar size={14} /><span>今日消耗 <b className="today-used">{todayUsed != null ? fmtToken(todayUsed) : '—'}</b></span></div>
              </div>
            </div>
            <div className="hero-trend">
              <span className="sec-label">消耗趋势 · 每根柱 = 两次刷新间的用量（悬停查看）</span>
              <UsageBars history={current.history} width={230} height={76} />
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

      {/* 模型额度卡片：点击切换环形表口径 */}
      {current && models.length > 0 && !current.quota?.isEmpty && (
        <section>
          <span className="sec-label">模型额度（点击卡片，环形表跟随显示该模型）</span>
          <div className="model-grid">
            <button
              className={`model-card ${selModel === 'all' ? 'active' : ''}`}
              onClick={() => setSelModel(selModel === 'all' ? null : 'all')}
            >
              <div className="mc-head"><span className="mc-name">全部合计</span><span className="mc-pct">{remainingPct != null ? `${remainingPct.toFixed(0)}%` : '—'}</span></div>
              <div className="mc-bar"><div className="mc-fill" style={{ width: remainingPct != null ? `${remainingPct}%` : '0%' }} /></div>
              <div className="mc-foot">剩 {fmtNum(current.quota?.remaining)} / {fmtNum(current.quota?.total)}</div>
            </button>
            {models.map((it, i) => {
              const pct = it.total ? Math.max(0, Math.min(100, ((it.remaining ?? 0) / it.total) * 100)) : null;
              const active = selModel === 'all' ? false : (selModel == null ? autoIdx === i : selModel === i);
              return (
                <button
                  key={i}
                  className={`model-card ${active ? 'active' : ''}`}
                  onClick={() => setSelModel(selModel === i ? 'all' : i)}
                >
                  <div className="mc-head"><span className="mc-name">{it.name}</span><span className="mc-pct">{pct != null ? `${pct.toFixed(0)}%` : '—'}</span></div>
                  <div className="mc-bar"><div className="mc-fill" style={{ width: pct != null ? `${pct}%` : '0%' }} /></div>
                  <div className="mc-foot">剩 {fmtNum(it.remaining)} / {fmtNum(it.total)}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 汇总统计 */}
      <section className="stats">
        <Stat value={accounts.length} label="账号总数" formatter={(v) => String(v)} />
        <Stat value={totalRemaining} label="全部剩余额度" token />
        <Stat value={totalUsed} label="累计已用" token />
        <Stat value={lowAccounts.length} label={`低额度账号（<${threshold}%）`} warn={lowAccounts.length > 0} formatter={(v) => String(v)} />
      </section>

      {/* 告警与快捷切换：只有当前账号额度不足才是主告警，其他账号仅作参考 */}
      {(lowAccounts.length > 0 || expiredAccounts.length > 0) && (
        <section className={`alert-box ${currentLow ? 'hot' : ''}`}>
          <IconAlert size={16} />
          <div>
            {currentLow
              ? <div>当前账号「{current.name}」额度不足（剩余 {remainingPct.toFixed(1)}%），建议切换到额度充足的账号</div>
              : lowAccounts.length > 0 && <div className="dim">其他低额度账号：{lowAccounts.map((a) => a.name).join('、')}（剩余低于 {threshold}%，仅供参考）</div>}
            {expiredAccounts.length > 0 && <div className="dim">Token 已过期：{expiredAccounts.map((a) => a.name).join('、')}，请在 ZCode 重新登录后再「保存当前账号」</div>}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <span className="sec-label">快捷切换{settings?.globalHotkeys ? '（全局快捷键 Ctrl+Alt+1~9）' : ''}</span>
          <div className="quick-grid">
            {others.map((a, i) => {
              const pct = a.quota?.percentUsed != null ? 100 - a.quota.percentUsed : null;
              return (
                <button key={a.id} className="quick-card enter" style={{ animationDelay: `${i * 40}ms` }} disabled={busy} onClick={() => doUse(a)}>
                  <div className="quick-top">
                    <span className="quick-who">
                      <Avatar name={a.name} id={a.id} size={26} />
                      <span className="quick-name">{a.name}</span>
                    </span>
                    {settings?.globalHotkeys && <kbd className="hotkey">Ctrl+Alt+{i + 1}</kbd>}
                    {!settings?.globalHotkeys && <IconSwitch size={14} />}
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

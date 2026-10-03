import React, { useEffect, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import {
  IconSave, IconRefresh, IconUndo, IconTrash, IconEdit, IconSwitch, IconCheck, IconAlert, IconFolder, IconUsers,
} from '../components/icons.jsx';
import { fmtNum, approxNum, fmtToken, fmtDate, fmtExpiry, usedToday } from '../util.js';

export default function Accounts({ state, accounts, busy, run, setConfirm, showToast }) {
  const [naming, setNaming] = useState(null);
  const [nameDraft, setNamingDraft] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginUrl, setLoginUrl] = useState(null);
  const currentId = state?.current?.shortId;

  // 浏览器登录进度：主进程广播授权链接，页面内展示可点击的横幅
  useEffect(() => {
    window.buddy.on('login:event', (e) => {
      if (e?.type === 'authorize-url') setLoginUrl(e.url);
      if (e?.type === 'done') { setLoginUrl(null); setLoggingIn(false); }
    });
  }, []);

  const doCapture = () => run(async () => {
    await window.buddy.captureAccount();
  }, '已保存当前登录账号');

  const doAddViaLogin = () => setConfirm({
    title: '通过浏览器登录添加账号？',
    body: '将打开 Z.AI 授权页，登录新账号后自动保存为快照并进入登录态。当前登录态若未保存会先自动保存。整个过程约 1–3 分钟。',
    danger: false,
    onOk: async () => {
      setConfirm(null);
      setLoggingIn(true);
      setLoginUrl(null);
      try {
        const r = await window.buddy.addAccountViaLogin();
        showToast(`登录成功，已添加「${r.account.name}」`);
      } catch (e) {
        showToast(e.message.replace(/^.*Error: /, ''), 'err');
      } finally {
        setLoggingIn(false);
        setLoginUrl(null);
      }
    },
  });

  const doUse = (account) => setConfirm({
    title: `切换到「${account.name}」？`,
    body: '默认热切换：只重启 ZCode 的会话进程，主窗口保持打开，新消息立即由新账号驱动（额度即时切换）。注意：ZCode 界面左下角显示的用户名是客户端缓存，会在下次完整重启 ZCode 后刷新。可在设置关闭热切换。',
    danger: false,
    onOk: () => run(async () => { await window.buddy.useAccount(account.id); }, '切换完成'),
  });

  const doDelete = (account) => setConfirm({
    title: `删除账号「${account.name}」？`,
    body: '仅删除本工具保存的快照，不影响 ZCode 当前登录。',
    danger: true,
    onOk: () => run(async () => { await window.buddy.deleteAccount(account.id); }, '已删除'),
  });

  const doRename = (account) => {
    setNaming(account.id);
    setNamingDraft(account.name);
  };

  const submitRename = async (account) => {
    const name = nameDraft.trim();
    setNaming(null);
    if (!name || name === account.name) return;
    await run(async () => { await window.buddy.renameAccount(account.id, name); }, '已重命名');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>账号管理</h1>
          <p className="page-sub">保存 / 切换 / 删除账号快照，快照含登录凭证请勿外传</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={doAddViaLogin} disabled={busy || loggingIn} title="打开浏览器登录一个新账号，自动保存为快照">
            <IconUsers size={15} /> {loggingIn ? '登录中…' : '浏览器登录添加'}
          </button>
          <button className="btn" onClick={doCapture} disabled={busy || loggingIn}>
            <IconSave size={15} /> 保存当前账号
          </button>
          <button className="btn" onClick={() => run(async () => { await window.buddy.refreshQuota('all'); }, '额度已刷新')} disabled={busy}>
            <IconRefresh size={15} /> 刷新额度
          </button>
          <button className="btn ghost" onClick={() => setConfirm({
            title: '回滚到上次切换前？',
            body: '将关闭并重启 ZCode，恢复上一份登录态。',
            danger: false,
            onOk: () => run(async () => { await window.buddy.rollback(); }, '已回滚'),
          })} disabled={busy || !state?.canRollback}>
            <IconUndo size={15} /> 回滚
          </button>
          <button className="btn ghost" title="打开快照目录" onClick={() => window.buddy.openPath(state?.storeDir)}>
            <IconFolder size={15} />
          </button>
        </div>
      </header>

      {loggingIn && (
        <section className="panel" style={{ padding: '10px 14px', marginBottom: 12 }}>
          <p className="hint block" style={{ margin: 0 }}>
            浏览器登录进行中：请在浏览器里完成 Z.AI 授权，完成后会自动加入列表。期间请勿切换账号。
            {loginUrl && <> 浏览器未打开？<a href={loginUrl} target="_blank" rel="noreferrer">点此打开授权页</a>。</>}
          </p>
        </section>
      )}

      {accounts.length === 0 ? (
        <div className="empty">
          <IconSave size={34} />
          <p>还没有任何账号</p>
          <p className="dim">登录过的账号会自动出现在这里（自动保存历史登录态开启时），<br />也可点上方按钮手动保存；存好两个以上账号就能一键切换了</p>
        </div>
      ) : (
        <div className="card-grid">
          {accounts.map((a, i) => {
            const isCurrent = a.id === currentId;
            const q = a.quota;
            const pct = q?.percentUsed != null ? 100 - q.percentUsed : null;
            const critical = pct != null && pct < 5;
            const low = pct != null && pct < 15 && !critical;
            const today = usedToday(a.history);
            return (
              <div key={a.id} className={`card enter ${isCurrent ? 'current' : ''} ${critical ? 'critical' : ''}`} style={{ animationDelay: `${i * 45}ms` }}>
                <div className="card-head">
                  {naming === a.id ? (
                    <input
                      className="rename-input"
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNamingDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitRename(a); if (e.key === 'Escape') setNaming(null); }}
                      onBlur={() => submitRename(a)}
                    />
                  ) : (
                    <div className="who">
                      <div className="who-line">
                        <Avatar name={a.name} id={a.id} size={34} />
                        <div className="who-text">
                          <span className="name">{a.name}</span>
                          <span className="email">{a.email || `[${a.id}]`}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="badges">
                    {a.tokenStatus === 'expired' && <span className="badge warn"><IconAlert size={11} /> 过期</span>}
                    {a.tokenStatus === 'valid' && <span className="badge ok"><IconCheck size={11} /> 正常</span>}
                    {a.source === 'auto' && <span className="badge" title="登录态变化时自动捕捉的历史登录状态">自动</span>}
                    {isCurrent && <span className="badge">当前</span>}
                  </div>
                </div>

                <div className="meta">
                  <span>{q?.plan?.tier || '—'}</span>
                  {q?.plan?.expiresAt && <span>· {fmtExpiry(q.plan.expiresAt)}</span>}
                  {today != null && today > 0 && <span className="today-chip">今日消耗 {fmtToken(today)}</span>}
                </div>

                {q && !q.isEmpty && (
                  <div className="quota">
                    <div className="bar"><div className={`fill ${critical ? 'crit' : low ? 'low' : ''}`} style={{ width: pct != null ? `${pct}%` : '100%' }} /></div>
                    <div className="quota-text">
                      {q.remaining != null
                        ? <>剩余 <b>{fmtToken(q.remaining)}</b> / {fmtToken(q.total)}{q.percentUsed != null && `（已用 ${q.percentUsed.toFixed(1)}%）`}</>
                        : <>总量 <b>{fmtToken(q.total)}</b>（已用未知）</>}
                    </div>
                    {q.items?.length > 0 && (
                      <div className="card-models">
                        {q.items.map((it, i) => (
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
                )}

                <div className="card-foot">
                  <span className="time">刷新 {fmtDate(a.quotaRefreshedAt)}</span>
                  <div className="ops">
                    <button className="btn primary sm" onClick={() => doUse(a)} disabled={busy || isCurrent}>
                      <IconSwitch size={12} /> {isCurrent ? '使用中' : '切换'}
                    </button>
                    <button className="btn ghost sm" onClick={() => run(async () => { await window.buddy.refreshQuota(a.id); })} disabled={busy} title="查询该账号额度">
                      <IconRefresh size={12} />
                    </button>
                    <button className="btn ghost sm" onClick={() => doRename(a)} title="重命名"><IconEdit size={12} /></button>
                    <button className="btn ghost sm danger" onClick={() => doDelete(a)} title="删除"><IconTrash size={12} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

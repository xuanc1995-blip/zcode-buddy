import React, { useEffect, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import {
  IconSave, IconRefresh, IconUndo, IconTrash, IconEdit, IconSwitch, IconCheck, IconAlert, IconFolder, IconUsers,
} from '../components/icons.jsx';
import { fmtNum, approxNum, fmtToken, fmtDate, fmtExpiry, usedToday } from '../util.js';

export default function Accounts({ state, accounts, busy, run, setConfirm, showToast }) {
  const [naming, setNaming] = useState(null);
  const [nameDraft, setNamingDraft] = useState('');
  const currentId = state?.current?.shortId;

  // 浏览器登录过程的提示（授权 URL 事件由主进程广播）
  useEffect(() => {
    window.buddy.on('login:event', (e) => {
      if (e?.type === 'authorize-url') showToast('浏览器已打开 Z.AI 授权页；若未打开，请访问控制台日志中的链接', 'ok');
    });
  }, [showToast]);

  const doCapture = () => run(async () => {
    await window.buddy.captureAccount();
  }, '已保存当前登录账号');

  const doAddViaLogin = () => setConfirm({
    title: '通过浏览器登录添加账号？',
    body: '将打开 Z.AI 授权页，登录新账号后自动保存为快照并进入登录态。当前登录态若未保存会先自动保存。整个过程约 1–3 分钟。',
    danger: false,
    onOk: () => run(async () => {
      const r = await window.buddy.addAccountViaLogin();
      return r;
    }, '登录成功，新账号已加入列表'),
  });

  const doUse = (account) => setConfirm({
    title: `切换到「${account.name}」？`,
    body: '默认热切换：只重启 ZCode 的会话进程，主窗口保持打开，会话将在下次使用时以新账号拉起（可在设置关闭，改走完整重启）。',
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
          <button className="btn primary" onClick={doAddViaLogin} disabled={busy} title="打开浏览器登录一个新账号，自动保存为快照">
            <IconUsers size={15} /> 浏览器登录添加
          </button>
          <button className="btn" onClick={doCapture} disabled={busy}>
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

      {accounts.length === 0 ? (
        <div className="empty">
          <IconSave size={34} />
          <p>还没有保存任何账号</p>
          <p className="dim">先在 ZCode 里登录一个账号，然后点上方「保存当前账号」；<br />换下一个账号后重复一次，就能一键切换了</p>
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

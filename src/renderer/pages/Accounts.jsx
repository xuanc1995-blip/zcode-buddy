import React, { useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import {
  IconSave, IconRefresh, IconUndo, IconTrash, IconEdit, IconSwitch, IconCheck, IconAlert, IconFolder,
} from '../components/icons.jsx';
import { fmtNum, fmtDate, fmtExpiry, usedToday } from '../util.js';

export default function Accounts({ state, accounts, busy, run, setConfirm }) {
  const [naming, setNaming] = useState(null);
  const [nameDraft, setNamingDraft] = useState('');
  const currentId = state?.current?.shortId;

  const doCapture = () => run(async () => {
    await window.buddy.captureAccount();
  }, '已保存当前登录账号');

  const doUse = (account) => setConfirm({
    title: `切换到「${account.name}」？`,
    body: '将自动关闭 ZCode → 替换登录态 → 重新启动 ZCode。当前登录态会先备份，可一键回滚。',
    danger: false,
    onOk: () => run(async () => { await window.buddy.useAccount(account.id); }, '切换完成，ZCode 已重启'),
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
          <button className="btn primary" onClick={doCapture} disabled={busy}>
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
                  {today != null && today > 0 && <span className="today-chip">今日消耗 {fmtNum(today)}</span>}
                </div>

                {q && !q.isEmpty && (
                  <div className="quota">
                    <div className="bar"><div className={`fill ${critical ? 'crit' : low ? 'low' : ''}`} style={{ width: pct != null ? `${pct}%` : '100%' }} /></div>
                    <div className="quota-text">
                      {q.remaining != null
                        ? <>剩余 <b>{fmtNum(q.remaining)}</b> / {fmtNum(q.total)}{q.percentUsed != null && `（已用 ${q.percentUsed.toFixed(1)}%）`}</>
                        : <>总量 <b>{fmtNum(q.total)}</b>（已用未知）</>}
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

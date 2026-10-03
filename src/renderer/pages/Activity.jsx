import React, { useCallback, useEffect, useState } from 'react';
import { IconTrash } from '../components/icons.jsx';
import { fmtDate } from '../util.js';

const TYPE_LABEL = {
  switch: '切换',
  capture: '保存',
  delete: '删除',
  rollback: '回滚',
  notify: '提醒',
  autoswitch: '自动切换',
  export: '导出',
  import: '导入',
};

/** 操作记录页：本地 activity.jsonl 的最近 500 条 */
export default function Activity({ busy, run, setConfirm }) {
  const [items, setItems] = useState(null);

  const reload = useCallback(async () => {
    setItems(await window.buddy.activityList());
  }, []);

  useEffect(() => {
    reload();
    window.buddy.on('activity:updated', reload);
    const t = setInterval(reload, 15 * 1000);
    return () => clearInterval(t);
  }, [reload]);

  const doClear = () => setConfirm({
    title: '清空全部操作记录？',
    body: '仅清除本页展示的日志，不影响账号快照与设置。',
    danger: true,
    onOk: () => run(async () => { await window.buddy.activityClear(); }, '已清空'),
  });

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>操作记录</h1>
          <p className="page-sub">切换、保存、提醒等事件（本地保留最近 500 条，不上传）</p>
        </div>
        <button className="btn ghost danger" onClick={doClear} disabled={busy || !items || items.length === 0}>
          <IconTrash size={15} /> 清空
        </button>
      </header>

      {items == null ? (
        <div className="empty"><p>加载中…</p></div>
      ) : items.length === 0 ? (
        <div className="empty"><p>还没有操作记录</p><p className="dim">切换账号、保存快照、触发提醒后，这里会出现时间线</p></div>
      ) : (
        <div className="activity-list">
          {items.map((it, i) => (
            <div key={i} className="activity-item">
              <span className={`activity-type t-${it.type}`}>{TYPE_LABEL[it.type] || it.type}</span>
              <span className="activity-msg">{it.message}</span>
              <span className="activity-time">{fmtDate(it.t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

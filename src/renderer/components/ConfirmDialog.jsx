import React from 'react';

export default function ConfirmDialog({ title, body, extra, danger, busy, onOk, onCancel }) {
  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="confirm-body">{body}</p>
        {extra}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onOk} disabled={busy}>
            {busy ? '处理中…' : '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}

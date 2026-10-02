import React, { useCallback, useEffect, useState } from 'react';
import { IconZap, IconGauge, IconUsers, IconSettings } from './components/icons.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Accounts from './pages/Accounts.jsx';
import SettingsPage from './pages/Settings.jsx';
import Toast from './components/Toast.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';

const NAV = [
  { id: 'dashboard', label: '仪表盘', icon: IconGauge },
  { id: 'accounts', label: '账号管理', icon: IconUsers },
  { id: 'settings', label: '设置', icon: IconSettings },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [state, setState] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const reload = useCallback(async () => {
    const [st, list] = await Promise.all([window.buddy.getState(), window.buddy.listAccounts()]);
    setState(st);
    setAccounts(list);
  }, []);

  useEffect(() => {
    reload();
    window.buddy.getSettings().then((s) => {
      setSettings(s);
      document.documentElement.dataset.theme = s.theme || 'dark';
    });
    window.buddy.getVersion().then(setVersion);
    window.buddy.on('state:changed', reload);
    window.buddy.on('quota:updated', reload);
    window.buddy.on('theme:changed', (t) => {
      document.documentElement.dataset.theme = t || 'dark';
    });
    const t = setInterval(reload, 10 * 1000);
    return () => clearInterval(t);
  }, [reload]);

  /** 供页面调用的通用动作包装：busy 管理 + 错误提示 */
  const run = useCallback(async (fn, okText) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      if (okText) showToast(okText);
    } catch (e) {
      showToast(e.message.replace(/^.*Error: /, ''), 'err');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [busy, reload, showToast]);

  const ctx = { state, accounts, settings, busy, run, showToast, setConfirm, setSettings, reload, goPage: setPage };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo"><IconZap size={22} /></span>
          <div className="brand-text">
            <b>ZCode Buddy</b>
            <span>多账号切换 · 额度管理</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => setPage(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {id === 'accounts' && accounts.length > 0 && <em className="nav-count">{accounts.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`status-pill ${state?.zcodeRunning ? 'on' : 'off'}`}>
            <span className="dot" />
            ZCode {state?.zcodeRunning ? '运行中' : '未运行'}
          </div>
          <span className="version">v{version || '0.2.0'}</span>
        </div>
      </aside>

      <main className="content">
        {page === 'dashboard' && <Dashboard {...ctx} />}
        {page === 'accounts' && <Accounts {...ctx} />}
        {page === 'settings' && <SettingsPage {...ctx} />}
      </main>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          danger={confirm.danger}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onOk={confirm.onOk}
        />
      )}
      {toast && <Toast text={toast.text} kind={toast.kind} />}
      {busy && <div className="busy-mask" />}
    </div>
  );
}

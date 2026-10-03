import React, { useCallback, useEffect, useState } from 'react';
import { IconZap, IconGauge, IconUsers, IconSettings, IconMin, IconMax, IconRestore, IconX, IconChart, IconHistory, IconInfo } from './components/icons.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Usage from './pages/Usage.jsx';
import Activity from './pages/Activity.jsx';
import About from './pages/About.jsx';
import Accounts from './pages/Accounts.jsx';
import SettingsPage from './pages/Settings.jsx';
import Toast from './components/Toast.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';

const NAV = [
  { id: 'dashboard', label: '仪表盘', icon: IconGauge },
  { id: 'accounts', label: '账号管理', icon: IconUsers },
  { id: 'usage', label: '用量统计', icon: IconChart },
  { id: 'activity', label: '操作记录', icon: IconHistory },
  { id: 'settings', label: '设置', icon: IconSettings },
  { id: 'about', label: '关于', icon: IconInfo },
];

function applyAppearance(s) {
  const pct = Math.max(0, Math.min(80, s.transparency ?? 0));
  document.documentElement.style.setProperty('--win-alpha', String(1 - pct / 100));
}

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [state, setState] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [maximized, setMaximized] = useState(false);

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
    // 首帧用渲染进程自身的系统偏好着色（matchMedia 会跟随 nativeTheme），避免闪错主题
    document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    // 再向主进程要一次权威值（首次广播可能早于本页监听器注册）
    window.buddy.getTheme().then((t) => { document.documentElement.dataset.theme = t; });
    window.buddy.getSettings().then((s) => {
      setSettings(s);
      applyAppearance(s);
    });
    window.buddy.getVersion().then(setVersion);
    window.buddy.on('state:changed', reload);
    window.buddy.on('quota:updated', reload);
    window.buddy.on('theme:changed', (t) => {
      document.documentElement.dataset.theme = t || 'dark';
    });
    window.buddy.on('win:maximized', setMaximized);
    const t = setInterval(reload, 10 * 1000);
    return () => clearInterval(t);
  }, [reload]);

  // 窗口不透明度 → CSS 变量（0% 透明 = 完全不透明）
  useEffect(() => {
    if (settings) applyAppearance(settings);
  }, [settings]);

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

      <main className="main-col">
        <div className="titlebar">
          <div className="win-controls">
            <button className="win-btn" title="最小化" onClick={() => window.buddy.winMinimize()}>
              <IconMin size={14} />
            </button>
            <button className="win-btn" title={maximized ? '还原' : '最大化'} onClick={() => window.buddy.winMaximize()}>
              {maximized ? <IconRestore size={13} /> : <IconMax size={13} />}
            </button>
            <button className="win-btn close" title="关闭（最小化到托盘）" onClick={() => window.buddy.winClose()}>
              <IconX size={14} />
            </button>
          </div>
        </div>
        <div className="content">
          {page === 'dashboard' && <Dashboard {...ctx} />}
          {page === 'accounts' && <Accounts {...ctx} />}
          {page === 'usage' && <Usage {...ctx} />}
          {page === 'activity' && <Activity {...ctx} />}
          {page === 'settings' && <SettingsPage {...ctx} />}
          {page === 'about' && <About {...ctx} />}
        </div>
      </main>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          extra={confirm.extra}
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

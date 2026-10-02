import React, { useEffect, useState } from 'react';
import {
  IconMoon, IconSun, IconDownload, IconUpload, IconFolder, IconMonitor, IconKey, IconInfo, IconHeart, IconSwitch,
} from '../components/icons.jsx';

export default function SettingsPage({ state, settings, setSettings, busy, run, showToast }) {
  // hooks 必须在任何条件 return 之前调用
  const [draft, setDraft] = useState(settings);
  const [pass, setPass] = useState('');
  useEffect(() => { if (settings) setDraft(settings); }, [settings]);

  if (!settings || !draft) return null;

  const save = async (patch) => {
    const next = await window.buddy.setSettings(patch);
    setSettings(next);
    setDraft(next);
  };

  const doExport = () => run(async () => {
    const r = await window.buddy.exportData(pass);
    if (!r.canceled) showToast(`已导出 ${r.count} 个账号到备份文件`);
  });

  const doImport = () => run(async () => {
    const r = await window.buddy.importData(pass);
    if (!r.canceled) showToast(`导入完成：新增 ${r.imported} 个，跳过已存在 ${r.skipped} 个`);
  });

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <p className="page-sub">提醒、切换策略、通用与数据管理</p>
        </div>
      </header>

      <section className="panel">
        <h2><IconKey size={15} /> 提醒与轮询</h2>
        <label className="field">
          <span>低额度阈值：剩余低于 <b>{draft.lowQuotaThreshold}%</b> 时发送 Windows 通知</span>
          <input
            type="range" min={1} max={50} value={draft.lowQuotaThreshold}
            onChange={(e) => setDraft({ ...draft, lowQuotaThreshold: Number(e.target.value) })}
            onMouseUp={() => save({ lowQuotaThreshold: draft.lowQuotaThreshold })}
            onTouchEnd={() => save({ lowQuotaThreshold: draft.lowQuotaThreshold })}
          />
        </label>
        <label className="field">
          <span>额度自动轮询间隔（分钟，0 = 关闭）</span>
          <input
            type="number" min={0} max={720} value={draft.pollIntervalMinutes}
            onChange={(e) => setDraft({ ...draft, pollIntervalMinutes: Number(e.target.value) })}
            onBlur={() => save({ pollIntervalMinutes: draft.pollIntervalMinutes })}
          />
          <span className="hint">窗口聚焦时会自动刷新（节流 1 分钟），不受此项影响</span>
        </label>
        <label className="field row">
          <input
            type="checkbox" checked={!!draft.autoStartPolling}
            onChange={(e) => save({ autoStartPolling: e.target.checked })}
          />
          <span>启动时立即进行一轮额度刷新</span>
        </label>
      </section>

      <section className="panel">
        <h2><IconSwitch size={15} /> 切换策略</h2>
        <label className="field row">
          <input
            type="checkbox" checked={!!draft.autoSwitch}
            onChange={(e) => save({ autoSwitch: e.target.checked })}
          />
          <span>自动切换：轮询发现当前账号剩余低于阈值时，自动切到剩余最多的账号（会关闭并重启 ZCode，并发通知）</span>
        </label>
        <label className="field row">
          <input
            type="checkbox" checked={!!draft.globalHotkeys}
            onChange={(e) => save({ globalHotkeys: e.target.checked })}
          />
          <span>全局快捷键：<kbd className="hotkey">Ctrl+Alt+1~9</kbd> 切到第 N 个账号（应用在后台也生效）</span>
        </label>
      </section>

      <section className="panel">
        <h2><IconMonitor size={15} /> 通用</h2>
        <div className="theme-row">
          <span>界面主题</span>
          <div className="theme-switch">
            <button className={`theme-btn ${draft.theme === 'dark' ? 'active' : ''}`} onClick={() => save({ theme: 'dark' })}>
              <IconMoon size={14} /> 深色
            </button>
            <button className={`theme-btn ${draft.theme === 'light' ? 'active' : ''}`} onClick={() => save({ theme: 'light' })}>
              <IconSun size={14} /> 浅色
            </button>
            <button className={`theme-btn ${draft.theme === 'system' ? 'active' : ''}`} onClick={() => save({ theme: 'system' })}>
              <IconMonitor size={14} /> 跟随系统
            </button>
          </div>
        </div>
        <label className="field row">
          <input
            type="checkbox" checked={!!draft.autoLaunch}
            onChange={(e) => save({ autoLaunch: e.target.checked })}
          />
          <span>开机自动启动 ZCode Buddy</span>
        </label>
      </section>

      <section className="panel">
        <h2><IconDownload size={15} /> 数据备份</h2>
        <p className="hint block">把所有账号快照加密导出为 .zbak 文件（AES-256-GCM），可用于跨电脑迁移或手动备份；导入时按账号自动合并。口令用于加解密，丢失后无法恢复备份。</p>
        <label className="field">
          <span>备份口令（至少 4 位）</span>
          <input
            type="password" placeholder="输入口令" value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <div className="row-gap">
          <button className="btn" disabled={busy || pass.length < 4} onClick={doExport}><IconDownload size={14} /> 导出备份…</button>
          <button className="btn" disabled={busy || pass.length < 4} onClick={doImport}><IconUpload size={14} /> 导入备份…</button>
          <button className="btn ghost" onClick={() => window.buddy.openPath(state?.storeDir)}><IconFolder size={14} /> 打开快照目录</button>
        </div>
      </section>

      <section className="panel about">
        <h2><IconInfo size={15} /> 关于</h2>
        <p>ZCode Buddy — 开源的 ZCode 多账号快捷切换与额度管理工具（MIT License）。</p>
        <p className="hint">原理：切换 = 备份并替换 <code>~\.zcode\v2\</code> 下的登录态文件；额度通过 ZCode billing 接口实时查询。本工具与 ZCode / 智谱官方无任何隶属关系，请遵守对应服务条款。</p>
        <p className="hint">设计参考了 WorkDaddy、zcode-account-switcher、ZCodex-Manager、workbuddy-switch 等优秀开源项目，感谢社区。<IconHeart size={12} /></p>
      </section>
    </div>
  );
}

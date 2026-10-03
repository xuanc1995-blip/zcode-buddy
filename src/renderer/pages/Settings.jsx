import React, { useEffect, useState } from 'react';
import Toggle from '../components/Toggle.jsx';
import {
  IconMoon, IconSun, IconDownload, IconUpload, IconFolder, IconMonitor, IconKey, IconInfo, IconHeart, IconSwitch,
} from '../components/icons.jsx';

/** 统一的设置行：左侧标题+说明，右侧控件 */
function Row({ title, desc, children }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <b>{title}</b>
        {desc && <span className="hint">{desc}</span>}
      </div>
      <div className="setting-ctl">{children}</div>
    </div>
  );
}

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

  const transparency = draft.transparency ?? 0;

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
        <div className="rows">
          <Row title="低额度阈值" desc={`剩余低于该值时发送 Windows 通知`}>
            <input
              type="range" min={1} max={50} value={draft.lowQuotaThreshold}
              onChange={(e) => setDraft({ ...draft, lowQuotaThreshold: Number(e.target.value) })}
              onMouseUp={() => save({ lowQuotaThreshold: draft.lowQuotaThreshold })}
              onTouchEnd={() => save({ lowQuotaThreshold: draft.lowQuotaThreshold })}
            />
            <em className="ctl-value">{draft.lowQuotaThreshold}%</em>
          </Row>
          <Row title="自动轮询间隔" desc="定时刷新全部账号额度，0 = 关闭">
            <input
              type="number" min={0} max={720} value={draft.pollIntervalMinutes}
              onChange={(e) => setDraft({ ...draft, pollIntervalMinutes: Number(e.target.value) })}
              onBlur={() => save({ pollIntervalMinutes: draft.pollIntervalMinutes })}
            />
            <em className="ctl-value">分钟</em>
          </Row>
          <Row title="启动时立即刷新" desc="应用启动后马上进行一轮额度查询">
            <Toggle checked={draft.autoStartPolling} onChange={(v) => save({ autoStartPolling: v })} />
          </Row>
          <Row title="自动检查更新" desc="启动及每 12 小时静默检查一次 GitHub Releases，发现新版本会通知（可在「关于」页手动操作）">
            <Toggle checked={draft.autoCheckUpdates !== false} onChange={(v) => save({ autoCheckUpdates: v })} />
          </Row>
          <Row title="自动安装更新" desc="发现新版本后自动后台下载，退出应用时自动安装（关闭则只提醒，到「关于」页手动安装）">
            <Toggle checked={!!draft.autoInstallUpdates} onChange={(v) => save({ autoInstallUpdates: v })} />
          </Row>
        </div>
      </section>

      <section className="panel">
        <h2><IconSwitch size={15} /> 切换策略</h2>
        <div className="rows">
          <Row title="自动切换" desc="当前账号剩余低于阈值时，自动切到剩余最多的账号（会重启 ZCode 并通知）">
            <Toggle checked={draft.autoSwitch} onChange={(v) => save({ autoSwitch: v })} />
          </Row>
          <Row title="自动保存历史登录态" desc="检测到登录态变化（如你在 ZCode 里手动登录了新账号）时自动存为快照，任何登录过的状态都可一键恢复；随启动与额度轮询检测">
            <Toggle checked={draft.autoCaptureLoginState !== false} onChange={(v) => save({ autoCaptureLoginState: v })} />
          </Row>
          <Row title="热切换" desc="切换时只重启 ZCode 的会话进程（agent）、不关主窗口；会话在下次使用时自动以新账号拉起，失败自动回退完整重启。关闭后始终走完整重启切换">
            <Toggle checked={!!draft.hotSwitch} onChange={(v) => save({ hotSwitch: v })} />
          </Row>
          <Row title="全局快捷键" desc={<><kbd className="hotkey">Ctrl+Alt+1~9</kbd> 切到第 N 个账号，应用在后台也生效</>}>
            <Toggle checked={draft.globalHotkeys} onChange={(v) => save({ globalHotkeys: v })} />
          </Row>
        </div>
      </section>

      <section className="panel">
        <h2><IconMonitor size={15} /> 通用</h2>
        <div className="rows">
          <Row title="界面主题" desc="跟随系统时，Windows 深浅色切换会实时联动">
            <div className="theme-switch segmented">
              <button className={`theme-btn ${draft.theme === 'dark' ? 'active' : ''}`} onClick={() => save({ theme: 'dark' })}>
                <IconMoon size={13} /> 深色
              </button>
              <button className={`theme-btn ${draft.theme === 'light' ? 'active' : ''}`} onClick={() => save({ theme: 'light' })}>
                <IconSun size={13} /> 浅色
              </button>
              <button className={`theme-btn ${draft.theme === 'system' ? 'active' : ''}`} onClick={() => save({ theme: 'system' })}>
                <IconMonitor size={13} /> 跟随系统
              </button>
            </div>
          </Row>
          <Row title="开机自动启动" desc="登录 Windows 后自动运行 ZCode Buddy">
            <Toggle checked={!!draft.autoLaunch} onChange={(v) => save({ autoLaunch: v })} />
          </Row>
          <Row title="窗口透明度" desc={transparency === 0 ? '不透明' : '配合 Windows 11 亚克力模糊'}>
            <input
              type="range" min={0} max={80} step={5} value={transparency}
              onChange={(e) => setDraft({ ...draft, transparency: Number(e.target.value) })}
              onMouseUp={() => save({ transparency: draft.transparency })}
              onTouchEnd={() => save({ transparency: draft.transparency })}
            />
            <em className="ctl-value">{transparency}%</em>
          </Row>
        </div>
        <p className="hint block">提示：透明度从 0% 调整到其他值（或调回 0）时窗口会短暂重建闪烁一下，属正常现象。</p>
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

    </div>
  );
}

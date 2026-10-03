'use strict';
/**
 * 自动更新（electron-updater + GitHub Releases）。
 * - 安装版：启动与定时静默检查，发现新版本弹通知，下载进度/安装走 IPC（关于页操作）
 * - 便携版 / 开发模式：不支持自动更新，仅展示状态供界面引导去 Releases 页
 * latest.yml 由 CI 发布时生成并作为 Release 附件上传（见 .github/workflows/release.yml）；
 * 未上传 latest.yml 的历史版本（≤v0.5.16）检查会报错，属预期，界面会显示失败原因。
 */
const { autoUpdater } = require('electron-updater');

const REPO = { owner: 'xuanc1995-blip', repo: 'zcode-buddy' };

let emit = () => {};
let status = { mode: 'dev', state: 'idle', version: null, percent: null, error: null };

function setState(patch) {
  status = { ...status, ...patch, at: Date.now() };
  try { emit({ ...status }); } catch (_) {}
  return status;
}

function setupUpdater({ isPackaged, isPortable, onEvent }) {
  emit = onEvent || (() => {});
  if (!isPackaged) { status = { ...status, mode: 'dev' }; return status; }
  if (isPortable) { status = { ...status, mode: 'portable' }; return status; }
  status = { ...status, mode: 'installed' };
  autoUpdater.setFeedURL({ provider: 'github', ...REPO });
  autoUpdater.autoDownload = false; // 用户确认后才下载
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => setState({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => setState({ state: 'available', version: i && i.version }));
  autoUpdater.on('update-not-available', (i) => setState({ state: 'not-available', version: i && i.version }));
  autoUpdater.on('download-progress', (p) => setState({ state: 'downloading', percent: p ? Math.min(100, Math.round(p.percent || 0)) : null }));
  autoUpdater.on('update-downloaded', (i) => setState({ state: 'downloaded', version: i && i.version, percent: 100 }));
  autoUpdater.on('error', (e) => setState({ state: 'error', error: String((e && e.message) || e) }));
  return status;
}

function checkForUpdates() {
  if (status.mode !== 'installed') return status;
  try { autoUpdater.checkForUpdates(); } catch (e) { setState({ state: 'error', error: String((e && e.message) || e) }); }
  return status;
}

function downloadUpdate() {
  if (status.mode === 'installed' && status.state === 'available') {
    try { autoUpdater.downloadUpdate(); } catch (e) { setState({ state: 'error', error: String((e && e.message) || e) }); }
  }
  return status;
}

function installUpdate() {
  if (status.mode === 'installed' && status.state === 'downloaded') {
    autoUpdater.quitAndInstall(false, true);
  }
  return status;
}

/** 自动下载 + 退出时自动安装（设置「自动安装更新」开关调用；v 为 false 时回到仅提醒模式） */
function setAutoInstall(v) {
  if (status.mode !== 'installed') return status;
  autoUpdater.autoDownload = Boolean(v);
  autoUpdater.autoInstallOnAppQuit = Boolean(v);
  return status;
}

module.exports = { REPO, setupUpdater, checkForUpdates, downloadUpdate, installUpdate, setAutoInstall, getStatus: () => ({ ...status }) };

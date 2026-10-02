'use strict';
/**
 * Electron 主进程：窗口、托盘、IPC（把 core 能力暴露给渲染进程）、低额度轮询提醒。
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const fingerprint = require('../core/fingerprint');
const store = require('../core/store');
const switcher = require('../core/switcher');
const quota = require('../core/quota');
const exporter = require('../core/exporter');
const { findZCodeExe } = require('../core/paths');

let mainWindow = null;
let tray = null;
let pollTimer = null;
let quitting = false;

// 开发实例与打包版隔离（避免单实例锁 / 设置互相干扰）；快照目录不受影响（见 core/paths.js）
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('userData'), 'dev'));
}

// ---------------------------------------------------------------------------
// 设置（userData/settings.json）
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = { lowQuotaThreshold: 10, pollIntervalMinutes: 5, autoStartPolling: true, theme: 'dark' };

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
    // 一次性迁移：v0.1.0 的默认 30 分钟对用户太稀，升级到 5 分钟
    if (!saved.intervalMigrated && saved.pollIntervalMinutes === 30) {
      saved.pollIntervalMinutes = DEFAULT_SETTINGS.pollIntervalMinutes;
      saved.intervalMigrated = true;
      try { fs.writeFileSync(settingsFile(), JSON.stringify(saved, null, 2), 'utf8'); } catch (_) {}
    }
    return saved;
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// ---------------------------------------------------------------------------
// 低额度轮询提醒（M3）
// ---------------------------------------------------------------------------
async function pollQuotaOnce({ notify = true } = {}) {
  const settings = loadSettings();
  const accounts = store.listAccounts({ withPayload: true });
  const results = [];
  for (const account of accounts) {
    try {
      const info = await quota.queryAccount(account);
      store.saveQuota(account.id, info, { tokenStatus: 'valid' });
      results.push({ account, info });
    } catch (e) {
      if (/TOKEN_INVALID/.test(e.message)) store.markTokenExpired(account.id);
      results.push({ account, info: account.quota });
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  if (notify) checkLowQuotaAndNotify(results, settings);
  broadcast('quota:updated');
  return results;
}

function checkLowQuotaAndNotify(results, settings) {
  if (!Notification.isSupported()) return;
  const withData = results.filter(({ info }) => info && info.percentUsed != null);
  const low = withData.filter(({ info }) => 100 - info.percentUsed < settings.lowQuotaThreshold);
  if (low.length === 0) return;
  const candidates = withData
    .filter(({ info }) => info.remaining != null && 100 - info.percentUsed >= settings.lowQuotaThreshold)
    .sort((a, b) => b.info.remaining - a.info.remaining);
  const best = candidates[0];
  const names = low.map(({ account }) => account.name).join('、');
  const body = best
    ? `点击切换到「${best.account.name}」（剩余 ${formatNum(best.info.remaining)}）`
    : '所有账号额度都不足了，请前往充值或等待每日额度刷新';
  const notification = new Notification({ title: `额度不足：${names}`, body, silent: false });
  if (best) notification.on('click', () => {
    switchToId(best.account.id).catch(() => {});
    showMainWindow();
  });
  notification.show();
}

/** 托盘/通知共用的切换入口 */
async function switchToId(id) {
  const account = store.findAccount(id);
  if (!account) throw new Error(`找不到账号：${id}`);
  const result = await switcher.applyState(
    { credentials: account.credentials, config: account.config },
    { restart: true },
  );
  store.touch(id);
  broadcast('state:changed');
  return result;
}

const formatNum = (v) => (v == null ? '未知' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v));

function startPolling() {
  stopPolling();
  const { pollIntervalMinutes } = loadSettings();
  if (!pollIntervalMinutes || pollIntervalMinutes <= 0) return;
  pollTimer = setInterval(() => {
    pollQuotaOnce().catch(() => {});
  }, pollIntervalMinutes * 60 * 1000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('state:get', () => ({
    current: fingerprint.extractCurrent(),
    zcodeRunning: switcher.isZCodeRunning(),
    zcodeExe: findZCodeExe(),
    canRollback: switcher.hasLastBackup(),
    storeDir: store.STORE_DIR,
  }));

  ipcMain.handle('accounts:list', () => store.listAccounts());

  ipcMain.handle('account:capture', (_e, name) => store.captureCurrent({ name: name || undefined }));

  ipcMain.handle('account:use', async (_e, id) => {
    const account = store.findAccount(String(id || ''));
    if (!account) throw new Error(`找不到账号：${id}`);
    const result = await switcher.applyState(
      { credentials: account.credentials, config: account.config },
      { restart: true },
    );
    store.touch(account.id);
    broadcast('state:changed');
    return result;
  });

  ipcMain.handle('account:rename', (_e, { id, name }) => store.renameAccount(id, name));
  ipcMain.handle('account:delete', (_e, id) => store.deleteAccount(id));

  ipcMain.handle('quota:refresh', async (_e, target) => {
    if (target === 'current' || !target) {
      const info = await quota.queryCurrent();
      return { info };
    }
    const ids = target === 'all'
      ? store.listAccounts().map((a) => a.id)
      : [target];
    const out = [];
    for (const id of ids) {
      const account = store.listAccounts({ withPayload: true }).find((a) => a.id === id);
      if (!account) continue;
      try {
        const info = await quota.queryAccount(account);
        store.saveQuota(id, info, { tokenStatus: 'valid' });
        out.push({ id, ok: true, info });
      } catch (e) {
        if (/TOKEN_INVALID/.test(e.message)) store.markTokenExpired(id);
        out.push({ id, ok: false, error: e.message, info: account.quota });
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    const settings = loadSettings();
    checkLowQuotaAndNotify(out.map(({ id, info }) => ({ account: { id, name: (store.readAccount(id) || {}).name || id }, info })), settings);
    return { results: out };
  });

  ipcMain.handle('switch:rollback', async () => {
    const result = await switcher.rollback({ restart: true });
    broadcast('state:changed');
    return result;
  });

  ipcMain.handle('zcode:launch', () => switcher.launchZCode());

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const clean = { ...(patch || {}) };
    // 自启设置走系统接口，不落 settings.json
    if (typeof clean.autoLaunch === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: clean.autoLaunch, path: process.execPath });
      delete clean.autoLaunch;
    }
    const next = saveSettings(clean);
    startPolling();
    applyTheme(next.theme);
    return readSettingsForRenderer();
  });

  ipcMain.handle('quota:pollOnce', () => pollQuotaOnce({ notify: true }));

  ipcMain.handle('data:export', async (_e, passphrase) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出账号备份',
      defaultPath: `zcode-buddy-backup-${new Date().toISOString().slice(0, 10)}.zbak`,
      filters: [{ name: 'ZCode Buddy 备份', extensions: ['zbak'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const count = exporter.exportToFile(filePath, passphrase);
    return { canceled: false, filePath, count };
  });

  ipcMain.handle('data:import', async (_e, passphrase) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入账号备份',
      filters: [{ name: 'ZCode Buddy 备份', extensions: ['zbak'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { canceled: true };
    const result = exporter.importFromFile(filePaths[0], passphrase);
    broadcast('quota:updated');
    return { canceled: false, ...result };
  });

  ipcMain.handle('app:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('app:version', () => app.getVersion());
}

function readSettingsForRenderer() {
  const s = loadSettings();
  s.autoLaunch = app.getLoginItemSettings().openAtLogin;
  return s;
}

function applyTheme(theme) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme:changed', theme || 'dark');
  }
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// 窗口与托盘
// ---------------------------------------------------------------------------
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    autoHideMenuBar: true,
    backgroundColor: '#101014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 窗口聚焦时自动刷新额度（节流 60s，不弹通知）
  let lastFocusPoll = 0;
  mainWindow.on('focus', () => {
    const now = Date.now();
    if (now - lastFocusPoll < 60 * 1000) return;
    lastFocusPoll = now;
    pollQuotaOnce({ notify: false }).catch(() => {});
  });

  mainWindow.on('close', (e) => {
    // 关窗=最小化到托盘，真正退出走托盘菜单/Alt+F4 确认
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // 1x1 透明兜底：图标文件缺失时托盘仍可用
  let img = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (img.isEmpty()) {
    img = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
  }
  try {
    tray = new Tray(img);
  } catch (_) {
    tray = null; // 托盘不可用时不阻塞主流程
  }
  if (!tray) return;
  const rebuild = () => {
    const accounts = store.listAccounts();
    const current = fingerprint.extractCurrent();
    const menu = Menu.buildFromTemplate([
      { label: '打开 ZCode Buddy', click: showMainWindow },
      { type: 'separator' },
      ...accounts.map((a) => {
        const pct = a.quota && a.quota.percentUsed != null ? Math.max(0, Math.round(100 - a.quota.percentUsed)) : null;
        const quotaLabel = pct == null ? '额度未知' : `剩 ${pct}%`;
        return {
          label: `${current && current.shortId === a.id ? '● ' : ''}${a.name}（${quotaLabel}）`,
          click: () => switchToId(a.id).catch(() => {}),
        };
      }),
      { type: 'separator' },
      { label: '刷新全部额度', click: () => pollQuotaOnce().catch(() => {}) },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip('ZCode Buddy — 账号快捷切换');
    tray.on('click', showMainWindow);
  };
  rebuild();
  // 账号列表变化时重建菜单
  setInterval(() => { try { rebuild(); } catch (_) {} }, 30 * 1000);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    createTray();
    if (loadSettings().autoStartPolling) startPolling();
  });

  app.on('before-quit', () => { quitting = true; stopPolling(); });
  app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
}

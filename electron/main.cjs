'use strict';
/**
 * Electron 主进程：窗口、托盘、IPC（把 core 能力暴露给渲染进程）、低额度轮询提醒。
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, nativeImage, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const fingerprint = require('../core/fingerprint');
const store = require('../core/store');
const switcher = require('../core/switcher');
const quota = require('../core/quota');
const exporter = require('../core/exporter');
const autologin = require('../core/autologin');
const updater = require('./updater.cjs');
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
const DEFAULT_SETTINGS = { lowQuotaThreshold: 10, pollIntervalMinutes: 5, autoStartPolling: true, theme: 'system', autoSwitch: false, globalHotkeys: false, transparency: 0, hotSwitch: true, autoCheckUpdates: true, autoInstallUpdates: false, autoCaptureLoginState: true };

// 浏览器登录进行中：登录态文件正被官方 CLI 改写，此时切换/回滚必须拒绝
let loginInFlight = false;

// ---------------------------------------------------------------------------
// 登录态历史：检测当前登录态变化并自动存档，保证任何登录过的状态都可回溯恢复
// ---------------------------------------------------------------------------
function loginStateFile() {
  return path.join(app.getPath('userData'), 'login-state.json');
}

function loadLoginState() {
  try { return JSON.parse(fs.readFileSync(loginStateFile(), 'utf8')) || {}; } catch (_) { return {}; }
}

function saveLoginState(patch) {
  const next = { ...loadLoginState(), ...patch, updatedAt: Date.now() };
  try { fs.writeFileSync(loginStateFile(), JSON.stringify(next, null, 2), 'utf8'); } catch (_) {}
  return next;
}

/**
 * 对比当前登录态与上次记录：
 * - 变化且未保存过 → 自动存为新快照（可在设置关闭，仅记录事件）
 * - 变化 → 记录「登录态切换」事件并刷新 lastSeen
 * 启动后与每轮轮询各检查一次（手动在 ZCode 里登录的账号由此自动入库）。
 */
function checkLoginStateChange() {
  const fp = fingerprint.extractCurrent();
  if (!fp || loginInFlight) return null;
  const seen = loadLoginState();
  if (seen.lastShortId === fp.shortId) return null;

  const prevName = seen.lastShortId
    ? ((store.readAccount(seen.lastShortId) || {}).name || seen.lastLabel || seen.lastShortId)
    : null;
  let captured = null;
  if (loadSettings().autoCaptureLoginState !== false && !store.findAccount(fp.shortId)) {
    try {
      captured = store.captureCurrent({ name: fp.label || undefined, source: 'auto' }).account;
      logActivity('capture', `检测到新登录态，自动保存「${captured.name}」`);
    } catch (_) { /* 凭证读取失败等，不影响记录 */ }
  }
  logActivity('state-change', prevName
    ? `登录态变化：${prevName} → ${fp.label || fp.shortId}`
    : `记录当前登录态：${fp.label || fp.shortId}`);
  saveLoginState({ lastShortId: fp.shortId, lastLabel: fp.label });
  broadcast('state:changed');
  return { fp, captured, prevName };
}

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
    // 一次性迁移：v0.3.2 起支持主题跟随系统
    if (!saved.themeMigrated && saved.theme === 'dark') {
      saved.theme = 'system';
      saved.themeMigrated = true;
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
  // 先检测登录态变化（手动在 ZCode 里登录的新账号会在此自动入库并参与本轮查询）
  checkLoginStateChange();
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

  // 自动切换策略：当前账号剩余低于阈值时，切到剩余最多的其他账号（需开启且 ZCode 运行中）
  if (notify && settings.autoSwitch) {
    try {
      const curFp = fingerprint.extractCurrent();
      const cur = results.find((r) => r.account.id === curFp?.shortId);
      const curRemainingPct = cur?.info?.percentUsed != null ? 100 - cur.info.percentUsed : null;
      if (curRemainingPct != null && curRemainingPct < settings.lowQuotaThreshold && switcher.isZCodeRunning()) {
        const best = results
          .filter((r) => r.account.id !== cur.account.id && r.info?.remaining != null
            && (r.info.percentUsed == null || 100 - r.info.percentUsed >= settings.lowQuotaThreshold))
          .sort((a, b) => b.info.remaining - a.info.remaining)[0];
        if (best) {
          await switchToId(best.account.id);
          logActivity('autoswitch', `额度不足自动切换到「${best.account.name}」`);
          if (Notification.isSupported()) {
            new Notification({
              title: '已自动切换账号',
              body: `「${cur.account.name}」剩余不足 ${settings.lowQuotaThreshold}%，已切换到「${best.account.name}」`,
            }).show();
          }
        }
      }
    } catch (_) { /* 自动切换失败不影响轮询 */ }
  }

  broadcast('quota:updated');
  return results;
}

function checkLowQuotaAndNotify(results, settings) {
  if (!Notification.isSupported()) return;
  const withData = results.filter(({ info }) => info && info.percentUsed != null);
  // 只关注当前登录账号：其他账号额度再低也不弹通知（仪表盘里作参考展示）
  const curFp = fingerprint.extractCurrent();
  const cur = curFp ? withData.find(({ account }) => account.id === curFp.shortId) : null;
  if (!cur || 100 - cur.info.percentUsed >= settings.lowQuotaThreshold) return;

  const candidates = withData
    .filter(({ account, info }) => account.id !== cur.account.id && info.remaining != null
      && 100 - info.percentUsed >= settings.lowQuotaThreshold)
    .sort((a, b) => b.info.remaining - a.info.remaining);
  const best = candidates[0];
  const curRemainingPct = 100 - cur.info.percentUsed;
  const body = best
    ? `剩余 ${curRemainingPct.toFixed(1)}%，点击切换到「${best.account.name}」（剩 ${formatNum(best.info.remaining)}）`
    : `剩余 ${curRemainingPct.toFixed(1)}%，其他账号额度也不足，请等待每日额度刷新或充值`;
  logActivity('notify', `低额度提醒：当前账号「${cur.account.name}」剩余 ${curRemainingPct.toFixed(1)}%`);
  const notification = new Notification({ title: `当前账号额度不足：${cur.account.name}`, body, silent: false });
  if (best) notification.on('click', () => {
    switchToId(best.account.id).catch(() => {});
    showMainWindow();
  });
  notification.show();
}

/** 托盘/通知共用的切换入口。设置开启「热切换」时优先走热切换，失败/不可用自动回退完整切换 */
async function switchToId(id) {
  if (loginInFlight) throw new Error('浏览器登录进行中，请等登录完成后再切换账号');
  const account = store.findAccount(id);
  if (!account) throw new Error(`找不到账号：${id}`);
  const targetState = { credentials: account.credentials, config: account.config };
  const settings = loadSettings();

  if (settings.hotSwitch) {
    try {
      const hot = await switcher.hotSwitchState(targetState);
      if (hot.hot) {
        store.touch(id);
        saveLoginState({ lastShortId: account.id, lastLabel: account.name });
        logActivity('hotswitch', hot.respawned
          ? `热切换到「${account.name}」（agent 已重启，共 ${hot.killed.length} 个会话）`
          : `热切换到「${account.name}」（登录态已替换；agent 将在下次使用时自动以新账号拉起）`);
        broadcast('state:changed');
        return hot;
      }
      logActivity('switch', `热切换不可用（${hot.reason}），改用完整切换`);
    } catch (e) {
      logActivity('switch', `热切换失败：${e.message}，改用完整切换`);
    }
  }

  const result = await switcher.applyState(targetState, { restart: true });
  store.touch(id);
  saveLoginState({ lastShortId: account.id, lastLabel: account.name });
  logActivity('switch', `切换到「${account.name}」`);
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

  ipcMain.handle('account:capture', (_e, name) => {
    const r = store.captureCurrent({ name: name || undefined });
    logActivity('capture', `保存快照「${r.account.name}」`);
    applyGlobalHotkeys(loadSettings().globalHotkeys);
    return r;
  });

  ipcMain.handle('account:use', async (_e, id) => {
    // 与托盘/通知共用 switchToId，保证操作记录、热键等口径一致
    return switchToId(String(id || ''));
  });

  ipcMain.handle('account:rename', (_e, { id, name }) => store.renameAccount(id, name));
  ipcMain.handle('account:delete', (_e, id) => {
    const r = store.deleteAccount(id);
    logActivity('delete', `删除快照「${(store.readAccount(id) || {}).name || id}」`);
    applyGlobalHotkeys(loadSettings().globalHotkeys);
    return r;
  });

  // 浏览器登录添加账号：复用 ZCode 官方 CLI 的 login --json（浏览器授权 → CLI 写登录态 → 这里照常存快照）
  ipcMain.handle('account:addViaLogin', async () => {
    if (loginInFlight) throw new Error('已有登录流程进行中');
    const zcodeExe = findZCodeExe();
    // login 会覆盖 ~/.zcode/v2 登录态文件：当前账号若还没快照，先自动保存一份
    const curFp = fingerprint.extractCurrent();
    if (curFp && !store.findAccount(curFp.shortId)) {
      const { account } = store.captureCurrent({ name: curFp.label || undefined, source: 'auto' });
      logActivity('capture', `添加账号前自动保存当前登录态「${account.name}」`);
    }
    loginInFlight = true;
    try {
      const result = await autologin.loginViaCli({
        zcodeExe,
        onEvent: (e) => broadcast('login:event', e),
      });
      const { account, updated } = store.captureCurrent({ source: 'login' });
      logActivity('login-add', `${updated ? '更新' : '添加'}账号「${account.name}」（浏览器登录，${result.user.email || result.user.user_id}）`);
      saveLoginState({ lastShortId: account.id, lastLabel: account.name });
      applyGlobalHotkeys(loadSettings().globalHotkeys);
      broadcast('state:changed');
      broadcast('quota:updated');
      return { account, updated, user: result.user };
    } finally {
      loginInFlight = false;
      broadcast('login:event', { type: 'done' });
    }
  });

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
    if (loginInFlight) throw new Error('浏览器登录进行中，请等登录完成后再回滚');
    const result = await switcher.rollback({ restart: true });
    logActivity('rollback', '回滚到上次切换前的登录态');
    checkLoginStateChange(); // 回滚后的登录态重新登记（必要时自动存档）
    broadcast('state:changed');
    return result;
  });

  ipcMain.handle('zcode:launch', () => switcher.launchZCode());

  ipcMain.handle('settings:get', () => readSettingsForRenderer());
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
    if (typeof clean.autoInstallUpdates === 'boolean') updater.setAutoInstall(clean.autoInstallUpdates);
    if (typeof clean.globalHotkeys === 'boolean') applyGlobalHotkeys(next.globalHotkeys);
    // 透明度跨越 0 边界需要重建窗口（transparent 属性不可运行时更改）
    if (typeof clean.transparency === 'number') {
      const wantTransparent = Math.max(0, Math.min(80, next.transparency ?? 0)) > 0;
      if (wantTransparent !== currentTransparent) {
        try { if (mainWindow && !mainWindow.isDestroyed()) saveSettings({ windowBounds: mainWindow.getNormalBounds() }); } catch (_) {}
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
        createWindow();
      }
    }
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
    logActivity('export', `导出 ${count} 个账号到备份文件`);
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
    logActivity('import', `导入备份：新增 ${result.imported} 个`);
    broadcast('quota:updated');
    return { canceled: false, ...result };
  });

  ipcMain.handle('theme:current', () => effectiveTheme());
  ipcMain.handle('activity:list', () => readActivity());
  ipcMain.handle('activity:clear', () => { try { fs.rmSync(activityFile(), { force: true }); } catch (_) {} return []; });
  ipcMain.handle('app:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('app:version', () => app.getVersion());

  // 每日消耗聚合（daily.json）：昨日/近 7 天不再依赖 48 小时历史点
  ipcMain.handle('stats:daily', () => ({ days: store.readDailySummary({ days: 60 }) }));

  // 导出每日消耗 CSV（date,total,各账号列）
  ipcMain.handle('stats:daily:export', async () => {
    const days = store.readDailySummary({ days: 120 });
    if (days.length === 0) return { canceled: true, empty: true };
    const nameById = new Map(store.listAccounts().map((a) => [a.id, a.name]));
    const ids = [...new Set(days.flatMap((d) => Object.keys(d.accounts)))];
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const header = ['date', 'total', ...ids.map((id) => esc(nameById.get(id) || id))].join(',');
    const rows = days.map((d) =>
      [d.date, d.total ?? '', ...ids.map((id) => d.accounts[id] ?? '')].join(','),
    );
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出每日消耗（CSV）',
      defaultPath: `zcode-buddy-daily-${store.localDateKey()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, '\ufeff' + [header, ...rows].join('\r\n') + '\r\n', 'utf8');
    return { canceled: false, filePath, days: rows.length };
  });

  // 自动更新
  ipcMain.handle('updater:getStatus', () => updater.getStatus());
  ipcMain.handle('updater:check', () => updater.checkForUpdates());
  ipcMain.handle('updater:download', () => updater.downloadUpdate());
  ipcMain.handle('updater:install', () => updater.installUpdate());

  // 自绘窗口控制键
  ipcMain.on('win:minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); });
  ipcMain.on('win:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  ipcMain.on('win:close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
}

function readSettingsForRenderer() {
  const s = loadSettings();
  s.autoLaunch = app.getLoginItemSettings().openAtLogin;
  return s;
}

// ---------------------------------------------------------------------------
// 操作记录（userData/activity.jsonl，保留最近 500 条）
// ---------------------------------------------------------------------------
const ACTIVITY_MAX = 500;

function activityFile() {
  return path.join(app.getPath('userData'), 'activity.jsonl');
}

function logActivity(type, message) {
  try {
    fs.appendFileSync(activityFile(), JSON.stringify({ t: Date.now(), type, message }) + '\n', 'utf8');
    broadcast('activity:updated');
  } catch (_) {}
}

function readActivity() {
  try {
    return fs.readFileSync(activityFile(), 'utf8')
      .trim().split('\n').filter(Boolean)
      .slice(-ACTIVITY_MAX)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean)
      .reverse();
  } catch (_) {
    return [];
  }
}

function applyTheme(theme) {
  const t = theme || 'system';
  // 跟随系统：themeSource 交给系统；effective 取实际生效的深浅
  try { nativeTheme.themeSource = t === 'system' ? 'system' : t; } catch (_) {}
  const effective = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme:changed', effective);
  }
  return effective;
}

function effectiveTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** 全局快捷键：Ctrl+Alt+1~9 切到第 N 个账号（按账号列表顺序） */
function applyGlobalHotkeys(enabled) {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  if (!enabled) return;
  store.listAccounts().slice(0, 9).forEach((a, i) => {
    try {
      globalShortcut.register(`CommandOrControl+Alt+${i + 1}`, () => switchToId(a.id).catch(() => {}));
    } catch (_) {}
  });
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

let currentTransparent = false; // 当前窗口是否处于透明模式（transparent 属性无法运行时切换，需重建窗口）

function createWindow() {
  const saved = loadSettings();
  const transparency = Math.max(0, Math.min(80, saved.transparency ?? 0));
  currentTransparent = transparency > 0;
  mainWindow = new BrowserWindow({
    width: saved.windowBounds?.width ?? 1060,
    height: saved.windowBounds?.height ?? 700,
    x: saved.windowBounds?.x,
    y: saved.windowBounds?.y,
    minWidth: 880,
    minHeight: 580,
    autoHideMenuBar: true,
    backgroundColor: currentTransparent ? '#00000000' : '#101014',
    transparent: currentTransparent,
    backgroundMaterial: currentTransparent ? 'acrylic' : undefined,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // 记忆窗口位置尺寸（防抖落盘）
  let boundsTimer = null;
  const saveBounds = () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
        saveSettings({ windowBounds: mainWindow.getNormalBounds() });
      }
    } catch (_) {}
  };
  mainWindow.on('resize', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 600); });
  mainWindow.on('move', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 600); });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 页面就绪后按当前设置应用主题（跟随系统/深/浅），系统切换时实时联动
  mainWindow.webContents.on('did-finish-load', () => applyTheme(loadSettings().theme));
  nativeTheme.on('updated', () => applyTheme(loadSettings().theme));

  // 窗口聚焦时自动刷新额度（节流 60s，不弹通知）
  let lastFocusPoll = 0;
  mainWindow.on('focus', () => {
    const now = Date.now();
    if (now - lastFocusPoll < 60 * 1000) return;
    lastFocusPoll = now;
    pollQuotaOnce({ notify: false }).catch(() => {});
  });

  mainWindow.on('maximize', () => broadcast('win:maximized', true));
  mainWindow.on('unmaximize', () => broadcast('win:maximized', false));

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

  // 更新器状态 → 界面广播 + 关键节点 Windows 通知
  updater.setupUpdater({
    isPackaged: app.isPackaged,
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    onEvent: (st) => {
      broadcast('updater:event', st);
      try {
        if (!Notification.isSupported()) return;
        if (st.state === 'available' && st.version) {
          const n = new Notification({ title: `发现新版本 v${st.version}`, body: '点击后台下载，完成后会提示安装' });
          n.on('click', () => { updater.downloadUpdate(); showMainWindow(); });
          n.show();
        } else if (st.state === 'downloaded') {
          const n = new Notification({ title: '新版本已下载完成', body: '点击重启并安装' });
          n.on('click', () => updater.installUpdate());
          n.show();
        }
      } catch (_) { /* 通知失败不影响更新流程 */ }
    },
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    createTray();
    if (loadSettings().autoStartPolling) startPolling();
    applyGlobalHotkeys(loadSettings().globalHotkeys);
    // 启动即登记当前登录态（首次运行会把现有登录账号自动入库）
    checkLoginStateChange();
    // 「自动安装更新」开关：自动下载 + 退出应用时自动安装
    updater.setAutoInstall(loadSettings().autoInstallUpdates === true);
    // 启动后 15 秒静默检查一次更新，之后每 12 小时一次（设置里可关）
    const silentCheck = () => { if (loadSettings().autoCheckUpdates !== false) updater.checkForUpdates(); };
    setTimeout(silentCheck, 15 * 1000);
    setInterval(silentCheck, 12 * 60 * 60 * 1000);
  });

  app.on('before-quit', () => { quitting = true; stopPolling(); try { globalShortcut.unregisterAll(); } catch (_) {} });
  app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
}

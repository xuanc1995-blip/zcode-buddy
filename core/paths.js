'use strict';
/**
 * 路径常量：ZCode 登录态文件、客户端可执行文件、账号快照存储目录。
 * ZCode 更新导致文件位置/结构变化时，只需要改这里。
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

// ZCode 登录态所在目录，credentials.json + config.json 两份文件构成一个完整账号快照
const ZCODE_V2_DIR = path.join(HOME, '.zcode', 'v2');
const CREDENTIALS_FILE = path.join(ZCODE_V2_DIR, 'credentials.json');
const CONFIG_FILE = path.join(ZCODE_V2_DIR, 'config.json');

// ZCode 客户端可执行文件候选路径，取第一个存在的
const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const ZCODE_EXE_CANDIDATES = [
  process.env.ZCODE_EXE,
  path.join(PROGRAM_FILES, 'ZCode', 'ZCode.exe'),
  path.join(PROGRAM_FILES_X86, 'ZCode', 'ZCode.exe'),
  path.join(LOCAL_APPDATA, 'Programs', 'ZCode', 'ZCode.exe'),
].filter(Boolean);

let cachedExeFromProcess = null;

/** ZCode 运行中时，从进程本身反查安装路径（覆盖非标准安装位置） */
function findZCodeExeFromProcess() {
  if (cachedExeFromProcess) return cachedExeFromProcess;
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'powershell -NoProfile -Command "(Get-Process ZCode -ErrorAction SilentlyContinue | Select-Object -First 1).Path"',
      { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    );
    const p = (out || '').trim();
    if (p && /\.exe$/i.test(p) && require('fs').existsSync(p)) {
      cachedExeFromProcess = p;
      return p;
    }
  } catch (_) {}
  return null;
}

function findZCodeExe() {
  for (const p of ZCODE_EXE_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return findZCodeExeFromProcess();
}

/**
 * 账号快照存储目录。
 * 优先级：环境变量 ZCODE_BUDDY_DATA_DIR > Electron 打包后的 userData > 项目根 accounts/。
 * CLI 与开发中的 GUI 共用项目根目录；打包后的 GUI 用 userData，避免写进只读 asar。
 */
function resolveStoreDir() {
  if (process.env.ZCODE_BUDDY_DATA_DIR) {
    return path.join(process.env.ZCODE_BUDDY_DATA_DIR, 'accounts');
  }
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return path.join(app.getPath('userData'), 'accounts');
    }
  } catch (_) { /* CLI 环境，忽略 */ }
  return path.join(__dirname, '..', 'accounts');
}

const STORE_DIR = resolveStoreDir();

module.exports = {
  HOME,
  APPDATA,
  ZCODE_V2_DIR,
  CREDENTIALS_FILE,
  CONFIG_FILE,
  ZCODE_EXE_CANDIDATES,
  STORE_DIR,
  findZCodeExe,
};

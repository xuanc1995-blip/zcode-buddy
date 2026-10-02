'use strict';
/**
 * 切换核心。安全策略：
 *   1. ZCode 运行中改登录态文件会被客户端退出时回写覆盖 → 切换前必须关闭 ZCode
 *   2. 替换前把当前两份文件备份到 .last/，支持一键回滚
 *   3. 原子写：先写 .tmp 再 rename，避免半写损坏登录态
 *   4. 替换失败时自动用 .last 恢复
 */
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { CREDENTIALS_FILE, CONFIG_FILE, findZCodeExe, STORE_DIR } = require('./paths');

// .last 备份目录与账号快照放在一起
const BACKUP_DIR = path.join(path.dirname(STORE_DIR), '.last');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isZCodeRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq ZCode.exe" /NH /FO CSV', {
      encoding: 'utf8',
      windowsHide: true,
    });
    return /"ZCode\.exe"/i.test(out);
  } catch (_) {
    return false;
  }
}

/** 强制关闭 ZCode 及其子进程，最多等 waitMs */
async function killZCode({ waitMs = 8000 } = {}) {
  if (!isZCodeRunning()) return true;
  try {
    execSync('taskkill /F /T /IM ZCode.exe', { windowsHide: true, stdio: 'ignore' });
  } catch (_) { /* taskkill 失败也继续轮询确认 */ }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!isZCodeRunning()) return true;
    await sleep(400);
  }
  return !isZCodeRunning();
}

function launchZCode() {
  const exe = findZCodeExe();
  if (!exe) throw new Error('找不到 ZCode.exe，请设置环境变量 ZCODE_EXE 指向安装路径');
  const child = exec(`start "" "${exe}"`, { windowsHide: false });
  child.unref();
  return true;
}

/** 读取当前登录态（两份文件原始文本） */
function readCurrentState() {
  return {
    credentials: fs.readFileSync(CREDENTIALS_FILE, 'utf8'),
    config: fs.readFileSync(CONFIG_FILE, 'utf8'),
  };
}

function atomicWrite(file, content) {
  const tmp = file + '.buddy.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function writeState(state) {
  atomicWrite(CREDENTIALS_FILE, state.credentials);
  atomicWrite(CONFIG_FILE, state.config);
}

/** 备份当前登录态到 .last/（切换前调用） */
function backupCurrent() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const state = readCurrentState();
  fs.writeFileSync(path.join(BACKUP_DIR, 'credentials.json'), state.credentials, 'utf8');
  fs.writeFileSync(path.join(BACKUP_DIR, 'config.json'), state.config, 'utf8');
}

function hasLastBackup() {
  return fs.existsSync(path.join(BACKUP_DIR, 'credentials.json')) &&
         fs.existsSync(path.join(BACKUP_DIR, 'config.json'));
}

/**
 * 切换登录态到目标快照。
 * @param {{credentials:string, config:string}} targetState
 * @param {{restart?:boolean}} opts restart: 切换后重新拉起 ZCode（默认 true）
 */
async function applyState(targetState, { restart = true } = {}) {
  if (!targetState || !targetState.credentials || !targetState.config) {
    throw new Error('目标账号快照不完整');
  }

  const wasRunning = isZCodeRunning();
  if (wasRunning) {
    const killed = await killZCode();
    if (!killed) throw new Error('关闭 ZCode 超时，已取消切换（避免登录态被回写损坏）');
  }

  backupCurrent();

  try {
    writeState(targetState);
  } catch (e) {
    try { restoreLast(); } catch (_) {}
    throw new Error('写入登录态失败，已自动回滚：' + e.message);
  }

  let restarted = false;
  if (restart) {
    try { launchZCode(); restarted = true; } catch (e) {
      // 登录态已切换成功，只是拉起失败，不抛错
      console.warn('登录态已切换，但启动 ZCode 失败：' + e.message);
    }
  }
  return { wasRunning, restarted };
}

/** 回滚到上次切换前的登录态 */
async function rollback({ restart = true } = {}) {
  if (!hasLastBackup()) throw new Error('没有可回滚的备份（.last 不存在）');
  if (isZCodeRunning()) {
    const killed = await killZCode();
    if (!killed) throw new Error('关闭 ZCode 超时');
  }
  restoreLast();
  let restarted = false;
  if (restart) {
    try { launchZCode(); restarted = true; } catch (_) {}
  }
  return { restarted };
}

function restoreLast() {
  const credentials = fs.readFileSync(path.join(BACKUP_DIR, 'credentials.json'), 'utf8');
  const config = fs.readFileSync(path.join(BACKUP_DIR, 'config.json'), 'utf8');
  writeState({ credentials, config });
}

module.exports = {
  BACKUP_DIR,
  isZCodeRunning,
  killZCode,
  launchZCode,
  readCurrentState,
  applyState,
  rollback,
  hasLastBackup,
};

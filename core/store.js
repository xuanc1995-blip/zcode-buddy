'use strict';
/**
 * 账号快照存储：每个账号一个 JSON 文件（accounts/<shortId>.json）。
 * 文件里内嵌 credentials.json / config.json 的原始文本，切账号即整体回写。
 * 注意：快照包含登录凭证，accounts/ 已加入 .gitignore，绝不能提交或外传。
 */
const fs = require('fs');
const path = require('path');
const { CREDENTIALS_FILE, CONFIG_FILE, STORE_DIR } = require('./paths');
const { extractFrom } = require('./fingerprint');

function ensureStore() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function accountFile(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

function readAccount(id) {
  try {
    return JSON.parse(fs.readFileSync(accountFile(id), 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeAccount(account) {
  ensureStore();
  fs.writeFileSync(accountFile(account.id), JSON.stringify(account, null, 2), 'utf8');
}

/**
 * 抓取当前登录态，保存/更新为一份账号快照。
 * 同一账号（user_id 相同）重复 capture 会更新原有快照，除非显式传 overwrite=false。
 * @returns {{account, updated:boolean}}
 */
function captureCurrent({ name, overwrite = true } = {}) {
  let credentialsText;
  let configText;
  try { credentialsText = fs.readFileSync(CREDENTIALS_FILE, 'utf8'); } catch (_) { credentialsText = null; }
  try { configText = fs.readFileSync(CONFIG_FILE, 'utf8'); } catch (_) { configText = null; }
  if (!credentialsText) throw new Error(`读取登录态失败：${CREDENTIALS_FILE} 不存在，请先登录 ZCode`);

  const fp = extractFrom(tryParse(credentialsText), tryParse(configText));
  if (!fp) throw new Error('无法从登录态中识别账号身份（user_id）');

  const existing = readAccount(fp.shortId);
  if (existing && !overwrite) {
    throw new Error(`账号已存在：${existing.name}（${fp.shortId}）`);
  }

  const account = {
    id: fp.shortId,
    userId: fp.userId,
    name: (name && name.trim()) || existing?.name || fp.label,
    email: fp.email,
    provider: fp.provider,
    capturedAt: existing?.capturedAt || Date.now(),
    updatedAt: Date.now(),
    lastUsedAt: existing?.lastUsedAt || null,
    quota: existing?.quota || null,
    quotaRefreshedAt: existing?.quotaRefreshedAt || null,
    credentials: credentialsText,
    config: configText,
  };
  writeAccount(account);
  return { account, updated: Boolean(existing) };
}

/** 列出所有快照（按 lastUsedAt/capturedAt 倒序），可选择性隐藏大字段 */
function listAccounts({ withPayload = false } = {}) {
  ensureStore();
  const accounts = [];
  for (const file of fs.readdirSync(STORE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const account = readAccount(file.slice(0, -5));
    if (account) accounts.push(account);
  }
  accounts.sort((a, b) => (b.lastUsedAt || b.capturedAt) - (a.lastUsedAt || a.capturedAt));
  if (withPayload) return accounts;
  return accounts.map(({ credentials, config, ...meta }) => meta);
}

/** 按 id / id 前缀 / 名称查找账号 */
function findAccount(query) {
  const all = listAccounts({ withPayload: true });
  if (all.length === 0) return null;
  let hit = all.find((a) => a.id === query);
  if (hit) return hit;
  const prefixHits = all.filter((a) => a.id.startsWith(query));
  if (prefixHits.length === 1) return prefixHits[0];
  hit = all.find((a) => a.name === query);
  if (hit) return hit;
  const nameHits = all.filter((a) => a.name.includes(query));
  if (nameHits.length === 1) return nameHits[0];
  return null;
}

function renameAccount(id, name) {
  const account = readAccount(id);
  if (!account) throw new Error(`账号不存在：${id}`);
  account.name = name.trim();
  account.updatedAt = Date.now();
  writeAccount(account);
  return account;
}

function deleteAccount(id) {
  const file = accountFile(id);
  if (!fs.existsSync(file)) throw new Error(`账号不存在：${id}`);
  fs.rmSync(file);
}

/** 更新快照的额度缓存（quota 查询成功后调用），并追加历史记录用于趋势图 */
function saveQuota(id, quota, { tokenStatus } = {}) {
  const account = readAccount(id);
  if (!account) return;
  account.quota = quota;
  account.quotaRefreshedAt = Date.now();
  if (tokenStatus) account.tokenStatus = tokenStatus;
  if (quota && quota.used != null) {
    const history = Array.isArray(account.history) ? account.history : [];
    const last = history[history.length - 1];
    // 60 秒内的重复点直接覆盖，避免高频刷新灌爆历史
    if (last && Date.now() - last.t < 60 * 1000) history[history.length - 1] = { t: Date.now(), used: quota.used, total: quota.total, remaining: quota.remaining };
    else history.push({ t: Date.now(), used: quota.used, total: quota.total, remaining: quota.remaining });
    account.history = history.slice(-240);
  }
  writeAccount(account);
}

/** 标记账号 Token 已过期（quota 查询返回 TOKEN_INVALID 时调用） */
function markTokenExpired(id) {
  const account = readAccount(id);
  if (!account) return;
  account.tokenStatus = 'expired';
  writeAccount(account);
}

/** 标记账号刚被使用（切换成功后调用） */
function touch(id) {
  const account = readAccount(id);
  if (!account) return;
  account.lastUsedAt = Date.now();
  writeAccount(account);
}

function tryParse(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

module.exports = { STORE_DIR, captureCurrent, listAccounts, findAccount, renameAccount, deleteAccount, saveQuota, markTokenExpired, touch, readAccount };

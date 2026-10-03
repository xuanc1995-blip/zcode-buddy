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

// 每日消耗聚合文件：与 accounts/ 同级（打包版在 userData/daily.json，开发时在项目根）
const DAILY_FILE = path.join(path.dirname(STORE_DIR), 'daily.json');
const DAILY_MAX_DAYS = 120; // 保留最近 120 天

/** 本地时区的 YYYY-MM-DD 日期键（「今日/昨日」语义跟随本机时钟） */
function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readDailyRaw() {
  try {
    const data = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
    return data && typeof data === 'object' && data.days && typeof data.days === 'object' ? data : { version: 1, days: {} };
  } catch (_) {
    return { version: 1, days: {} };
  }
}

/**
 * 记录一个账号的当日消耗观察值（额度轮询时调用，同一天同一账号反复覆盖=取最后一次观察）。
 * 注意：应用不运行时没有观察值，某天有记录代表当天至少轮询过一次。
 */
function recordDailySample(accountId, todayUsed, { now = Date.now() } = {}) {
  if (todayUsed == null || !accountId) return false;
  const data = readDailyRaw();
  const key = localDateKey(now);
  const day = data.days[key] || { accounts: {} };
  day.accounts = day.accounts || {};
  day.accounts[accountId] = Math.max(0, Number(todayUsed) || 0);
  day.total = Object.values(day.accounts).reduce((s, v) => s + v, 0);
  data.days[key] = day;
  data.updatedAt = now;

  // 只保留最近 DAILY_MAX_DAYS 天
  const keys = Object.keys(data.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAILY_MAX_DAYS))) delete data.days[k];

  try {
    fs.writeFileSync(DAILY_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/** 读取最近 N 天（默认 14）的每日消耗，按日期升序返回 [{date, total, accounts}] */
function readDailySummary({ days = 14 } = {}) {
  const data = readDailyRaw();
  const keys = Object.keys(data.days).sort().slice(-Math.max(1, days));
  return keys.map((k) => ({ date: k, total: data.days[k].total ?? null, accounts: data.days[k].accounts || {} }));
}

/** 某日期（默认昨日）的消耗：all=合计，accountId 指定则返回该账号的 */
function readDailyUsed(dateKey, accountId) {
  const data = readDailyRaw();
  const day = data.days[dateKey];
  if (!day) return null;
  return accountId ? (day.accounts[accountId] ?? null) : (day.total ?? null);
}

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

/** 列出所有快照。排序：名称中的数字小的在前（如 01→02→03），无数字的按名称排最后 */
function listAccounts({ withPayload = false } = {}) {
  ensureStore();
  const accounts = [];
  for (const file of fs.readdirSync(STORE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const account = readAccount(file.slice(0, -5));
    if (account) accounts.push(account);
  }
  const nameNum = (a) => {
    const m = /\d+/.exec(a.name || '');
    return m ? parseInt(m[0], 10) : null;
  };
  accounts.sort((a, b) => {
    const na = nameNum(a), nb = nameNum(b);
    if (na != null && nb != null && na !== nb) return na - nb;
    if (na != null) return -1;
    if (nb != null) return 1;
    const c = String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    if (c !== 0) return c;
    return (a.capturedAt || 0) - (b.capturedAt || 0);
  });
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
    account.history = history.slice(-576);
  }

  // 当日消耗：各活跃额度的 used_units 之和。
  // 这些额度每日续期，used 计数随续期清零，服务器报的 used 即当日用量（跨零点自动重新起算）。
  if (quota && Array.isArray(quota.items)) {
    let todayUsed = null;
    for (const it of quota.items) {
      if (it.used == null) continue;
      todayUsed = (todayUsed ?? 0) + Math.max(0, it.used);
    }
    account.todayUsed = todayUsed;
    account.todayUsedAt = Date.now();
    // 落盘到每日聚合（历史点只保留 48 小时，按日聚合让昨日/近 7 天趋势不依赖应用连续在线）
    recordDailySample(id, todayUsed);
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

module.exports = {
  STORE_DIR,
  DAILY_FILE,
  localDateKey,
  captureCurrent,
  listAccounts,
  findAccount,
  renameAccount,
  deleteAccount,
  saveQuota,
  markTokenExpired,
  touch,
  readAccount,
  recordDailySample,
  readDailySummary,
  readDailyUsed,
};

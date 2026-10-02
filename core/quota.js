'use strict';
/**
 * 额度查询：直连 ZCode billing 接口，实时获取套餐与已用量。
 *
 *   GET https://zcode.z.ai/api/v1/zcode-plan/billing/current?app_version=<客户端版本>
 *   GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=<客户端版本>
 *   Authorization: Bearer <zcodejwttoken 或 provider apiKey>
 *
 * balance 接口校验完整客户端身份头，缺一不可（尤其 X-Device-Mid，
 * 来自 ~/.zcode/v2/telemetry-state.json 的 deviceMid，逆向 ZCode 客户端确认），
 * 缺失时返回 400 "parameter error"。current 接口较宽松。
 *
 * token 候选顺序：zcodejwttoken（查 billing 的正确 token）→ oauth:<active>:access_token →
 * config.json 各 provider 的 apiKey。401/403 换下一个候选，429 退避重试。
 * 客户端日志解析仅作 balance 直连失败时的兜底。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { CREDENTIALS_FILE, CONFIG_FILE } = require('./paths');
const { decrypt, isEncrypted } = require('./crypto');

const BILLING_ORIGIN = 'https://zcode.z.ai';
const BILLING_CURRENT_URL = `${BILLING_ORIGIN}/api/v1/zcode-plan/billing/current`;
const BILLING_BALANCE_URL = `${BILLING_ORIGIN}/api/v1/zcode-plan/billing/balance`;
const CLIENT_APP_VERSION = '3.14.4'; // 与本机 ZCode 客户端版本一致
const RETRY_DELAYS = [500, 1500, 4000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TELEMETRY_STATE_FILE = path.join(os.homedir(), '.zcode', 'v2', 'telemetry-state.json');
let cachedDeviceMid;
function readDeviceMid() {
  if (cachedDeviceMid !== undefined) return cachedDeviceMid;
  try {
    const st = JSON.parse(fs.readFileSync(TELEMETRY_STATE_FILE, 'utf8'));
    cachedDeviceMid = typeof st.deviceMid === 'string' && st.deviceMid ? st.deviceMid : null;
  } catch (_) {
    cachedDeviceMid = null;
  }
  return cachedDeviceMid;
}

/** 复刻 ZCode 客户端的完整身份头（服务端据此校验，缺 X-Device-Mid 会 400） */
function clientHeaders() {
  const headers = {
    accept: 'application/json, text/plain, */*',
    'http-referer': BILLING_ORIGIN,
    'user-agent': `ZCode/${CLIENT_APP_VERSION}`,
    'x-zcode-app-version': CLIENT_APP_VERSION,
    'x-title': 'Z Code@electron',
    'x-platform': `${process.platform}-${process.arch}`,
    'x-client-language': 'zh-CN',
    'x-client-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    'x-os-category': process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    'x-os-version': os.release(),
    'x-request-id': crypto.randomUUID(),
  };
  const mid = readDeviceMid();
  if (mid) headers['x-device-mid'] = mid;
  return headers;
}

function billingUrl(base) {
  return `${base}?app_version=${CLIENT_APP_VERSION}`;
}

function safeDecrypt(value) {
  try { return isEncrypted(value) ? decrypt(value) : value; } catch (_) { return null; }
}

/** 从一份登录态（credentials/config 对象）里取出候选 token 列表 */
function tokenCandidates(credentials, config) {
  if (!credentials || typeof credentials !== 'object') return [];
  const activeProvider = safeDecrypt(credentials['oauth:active_provider']) || 'bigmodel';
  const tokens = [];
  const push = (v) => {
    const plain = safeDecrypt(v);
    if (typeof plain === 'string' && plain.trim().length > 20 && !tokens.includes(plain)) tokens.push(plain);
  };
  push(credentials.zcodejwttoken);
  push(credentials[`oauth:${activeProvider}:access_token`]);
  const providers = (config && typeof config.provider === 'object' && config.provider) || {};
  for (const p of Object.values(providers)) {
    const key = p && p.options && p.options.apiKey;
    if (typeof key === 'string' && key.length > 30 && !key.startsWith('enc:')) push(key);
  }
  return tokens;
}

async function fetchBilling(url, token) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { ...clientHeaders(), Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      lastError = new Error('网络请求失败：' + e.message);
      if (attempt < RETRY_DELAYS.length) { await sleep(RETRY_DELAYS[attempt]); continue; }
      throw lastError;
    }

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }

    if (response.ok) return data;

    if (response.status === 429 && attempt < RETRY_DELAYS.length) {
      lastError = new Error('服务端限流，退避重试中');
      await sleep(RETRY_DELAYS[attempt]);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`TOKEN_INVALID(${response.status})`);
    }
    const msg = data && typeof data === 'object' ? (data.message || data.msg || data.error) : text;
    throw new Error(`HTTP ${response.status}: ${msg || response.statusText}`);
  }
  throw lastError || new Error('请求失败');
}

// ---------------------------------------------------------------------------
// 客户端日志解析：提取 billing/balance 请求完成 负载（含 used_units/remaining_units）
// ---------------------------------------------------------------------------

const LOG_DIR = path.join(os.homedir(), '.zcode', 'v2', 'logs');
const BALANCE_MARK = 'billing/balance 请求完成 {';
let logCache = { mtime: -1, entries: null };

function extractBalancedJson(text, start) {
  // text[start] === '{'，按括号配对取出完整 JSON（字符串内的引号已考虑）
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

/** 解析最近两天客户端日志里的 balance 负载，返回 [{payload, time}]（时间倒序） */
function readBalancePayloads() {
  let mtime = 0;
  const files = [];
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      const st = fs.statSync(full);
      mtime = Math.max(mtime, st.mtimeMs);
      files.push({ full, mtime: st.mtimeMs });
    }
  } catch (_) {
    return [];
  }
  if (logCache.entries && logCache.mtime === mtime) return logCache.entries;

  files.sort((a, b) => b.mtime - a.mtime);
  const entries = [];
  for (const { full } of files.slice(0, 2)) { // 最近两天足够
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    let idx = text.lastIndexOf(BALANCE_MARK);
    while (idx !== -1 && entries.length < 10) {
      const payload = extractBalancedJson(text, idx + BALANCE_MARK.length - 1);
      if (payload && Array.isArray(payload.balances)) {
        // 行首时间戳
        const lineStart = text.lastIndexOf('\n', idx) + 1;
        const ts = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(text.slice(lineStart, idx));
        entries.push({
          payload,
          time: ts ? new Date(ts[1].replace(' ', 'T') + '+08:00').getTime() : 0,
        });
      }
      idx = idx > 0 ? text.lastIndexOf(BALANCE_MARK, idx - 1) : -1;
    }
    if (entries.length > 0) break; // 最新日志里有就够了
  }
  entries.sort((a, b) => b.time - a.time);
  logCache = { mtime, entries };
  return entries;
}

/** 从日志负载里找出与 current 的 plans 匹配（user_plan_id 有交集）且最新的一份 balances */
function matchUsageFromLogs(currentData) {
  const myPlanIds = new Set((currentData.plans || []).map((p) => p.user_plan_id).filter(Boolean));
  if (myPlanIds.size === 0) return null;
  for (const { payload, time } of readBalancePayloads()) {
    // 客户端日志顶层的 plans 被裁剪过（只有 name/plan_id/status），原始数据在 payload.data.plans
    const nested = (((payload.payload || {}).data || {}).plans) || [];
    const payloadPlanIds = nested.map((p) => p.user_plan_id).filter(Boolean);
    if (payloadPlanIds.some((id) => myPlanIds.has(id))) {
      return { balances: payload.balances, plans: nested, observedAt: time };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

function unwrap(data) {
  let cur = data;
  for (let i = 0; i < 4; i++) {
    if (!cur || typeof cur !== 'object') return cur || {};
    if (cur.data !== undefined) { cur = cur.data; continue; }
    if (cur.result !== undefined) { cur = cur.result; continue; }
    break;
  }
  return cur || {};
}

const toNum = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
};

/** 秒/毫秒时间戳统一转毫秒（<1e12 视为秒） */
const toMs = (v) => {
  const n = toNum(v);
  if (n == null) return null;
  return n < 1e12 ? n * 1000 : n;
};

/** 从 plans[] 里识别套餐等级与到期时间 */
function extractPlan(current) {
  const plans = Array.isArray(current.plans) ? current.plans : [];
  const active = plans.filter((p) => String((p && p.status) || '').toLowerCase() === 'active');
  if (active.length === 0) return null;
  const match = (p, kw) =>
    String(p.plan_id || '').toLowerCase().includes(kw) || String(p.name || '').toLowerCase().includes(kw);
  let tier = null;
  if (active.some((p) => match(p, 'max'))) tier = 'Max';
  else if (active.some((p) => match(p, 'pro'))) tier = 'Pro';
  else if (active.some((p) => match(p, 'lite'))) tier = 'Lite';
  else if (active.some((p) => match(p, 'start'))) tier = 'Start Plan';
  const expiresAt = active
    .map((p) => toMs(p.ends_at) ?? toMs(p.expires_at) ?? (p.period_end ? Date.parse(p.period_end) || null : null))
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || null;
  return { tier, expiresAt, planName: (active[0] && (active[0].name || active[0].plan_id)) || null };
}

/** 归一化为 {total, used, remaining, percentUsed, plan, items, isEmpty, usageSource} */
function normalize(currentRaw, balances) {
  const current = unwrap(currentRaw);
  const items = (Array.isArray(balances) ? balances : []).map((b) => {
    const total = toNum(b.total_units) ?? toNum(b.grant_units);
    const used = toNum(b.used_units);
    const remaining = toNum(b.remaining_units) ?? toNum(b.available_units);
    const baseName = b.show_name || b.name || b.entitlement_id || '模型额度';
    return {
      name: baseName,
      entitlementId: b.entitlement_id || null,
      total,
      used,
      remaining,
      percentUsed: total && used != null ? Math.min(100, (used / total) * 100) : null,
      expiresAt: toMs(b.period_end) ?? toMs(b.expires_at) ?? (b.period_end ? Date.parse(b.period_end) || null : null),
    };
  });
  // 同名模型区分：一次性包 / 每日包等重名时附加 entitlement 尾缀
  const seen = {};
  for (const it of items) {
    seen[it.name] = (seen[it.name] || 0) + 1;
    if (seen[it.name] > 1 && it.entitlementId) it.name = `${it.name}·${String(it.entitlementId).slice(-4)}`;
  }
  // balance 不可用时，用 current 的 entitlements 展示发放量（无已用数据）
  if (items.length === 0 && Array.isArray(current.plans)) {
    for (const plan of current.plans) {
      if (String(plan.status || '').toLowerCase() !== 'active') continue;
      for (const ent of plan.entitlements || []) {
        const existing = items.find((it) => it.name === (ent.show_name || ent.entitlement_id));
        const grant = toNum(ent.grant_units);
        if (existing) {
          existing.total = Math.max(existing.total || 0, grant || 0);
        } else {
          items.push({
            name: ent.show_name || ent.entitlement_id || '模型额度',
            total: grant,
            used: null,
            remaining: null,
            percentUsed: null,
            expiresAt: toMs(plan.ends_at),
          });
        }
      }
    }
  }
  const sum = (key) => items.reduce((acc, it) => (it[key] != null ? acc + it[key] : acc), null);
  const total = sum('total');
  const used = sum('used');
  const remaining = sum('remaining');
  const percentUsed = total && used != null ? Math.min(100, (used / total) * 100) : null;
  const isEmpty = (!Array.isArray(current.plans) || current.plans.length === 0) && items.length === 0;
  return { total, used, remaining, percentUsed, plan: extractPlan(current), items, isEmpty };
}

/**
 * 查询一份登录态的额度：current + balance 实时直连；
 * balance 失败（如 deviceMid 不可用）时回退客户端日志匹配。
 */
async function queryState(credentials, config) {
  const tokens = tokenCandidates(credentials, config);
  if (tokens.length === 0) throw new Error('该账号快照里没有可用的 token');

  let currentRaw = null;
  let workingToken = null;
  let lastError = null;
  let authFail = 0;
  for (const token of tokens) {
    try {
      currentRaw = await fetchBilling(billingUrl(BILLING_CURRENT_URL), token);
      workingToken = token;
      break;
    } catch (e) {
      lastError = e;
      if (/TOKEN_INVALID/.test(e.message)) authFail++;
    }
  }
  if (!currentRaw && authFail === tokens.length) {
    // 服务端对新 token 有缓存延迟，等 1.5s 用首个 token 重试一次
    await sleep(1500);
    try {
      currentRaw = await fetchBilling(billingUrl(BILLING_CURRENT_URL), tokens[0]);
      workingToken = tokens[0];
    } catch (e) {
      lastError = e;
      if (/TOKEN_INVALID/.test(e.message)) throw new Error('该账号 Token 已过期，请重新登录后再抓取');
    }
  }
  if (!currentRaw) throw lastError || new Error('额度查询失败');

  const current = unwrap(currentRaw);

  // 已用量：balance 接口直连 → 客户端日志兜底
  let balances = null;
  let usageSource = null;
  let observedAt = null;
  try {
    const balanceRaw = await fetchBilling(billingUrl(BILLING_BALANCE_URL), workingToken);
    balances = unwrap(balanceRaw).balances;
    usageSource = 'api';
  } catch (_) {
    const fromLog = matchUsageFromLogs(current);
    if (fromLog) {
      balances = fromLog.balances;
      usageSource = 'client-log';
      observedAt = fromLog.observedAt;
    }
  }

  const info = normalize(currentRaw, balances);
  info.usageSource = usageSource;
  info.usageObservedAt = observedAt;
  return info;
}

/** 查询当前登录中的账号 */
async function queryCurrent() {
  const fs2 = require('fs');
  let credentials = null;
  let config = null;
  try { credentials = JSON.parse(fs2.readFileSync(CREDENTIALS_FILE, 'utf8')); } catch (_) {}
  try { config = JSON.parse(fs2.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  return queryState(credentials, config);
}

/** 查询快照账号（接受内嵌 credentials/config 文本的账号对象） */
async function queryAccount(account) {
  let credentials = null;
  let config = null;
  try { credentials = JSON.parse(account.credentials); } catch (_) {}
  try { config = JSON.parse(account.config); } catch (_) {}
  return queryState(credentials, config);
}

module.exports = {
  BILLING_CURRENT_URL,
  BILLING_BALANCE_URL,
  queryCurrent,
  queryAccount,
  normalize,
  tokenCandidates,
  readBalancePayloads,
};

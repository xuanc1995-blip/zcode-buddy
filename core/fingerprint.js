'use strict';
/**
 * 账号指纹：从当前登录态里提取能唯一标识一个账号的信息。
 *
 * 依据（本机已验证）：
 *   - credentials.json 的 zcodejwttoken（解密后为 JWT），payload 含 user_id —— 最稳定的标识
 *   - config.json 中启用 provider 的 apiKey 也是明文 JWT，payload 同样含 user_id，作备选
 *   - oauth:<active_provider>:user_info 解密后含 email/name，用于展示
 */
const fs = require('fs');
const { CREDENTIALS_FILE, CONFIG_FILE } = require('./paths');
const { decrypt, decryptJson, isEncrypted } = require('./crypto');

/** 解析 JWT payload（不验签，只读内容） */
function decodeJwt(jwt) {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function safeDecrypt(value) {
  try { return isEncrypted(value) ? decrypt(value) : value; } catch (_) { return null; }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 从 credentials/config 对象提取指纹。
 * credentials/config 传原始 JSON 对象（当前登录态或快照均可）。
 * @returns {{userId, shortId, email, name, provider, label} | null}
 */
function extractFrom(credentials, config) {
  if (!credentials || typeof credentials !== 'object') return null;
  const activeProvider = safeDecrypt(credentials['oauth:active_provider']) || 'bigmodel';

  // 1) zcodejwttoken 的 payload.user_id 是首选标识
  let userId = null;
  const jwt = decodeJwt(safeDecrypt(credentials.zcodejwttoken));
  if (jwt && jwt.user_id != null) userId = String(jwt.user_id);

  // 2) 备选：config.json 里启用 provider 的 apiKey JWT
  let providerId = null;
  const providers = (config && typeof config.provider === 'object' && config.provider) || {};
  const candidates = Object.entries(providers)
    .filter(([, p]) => p && p.options && typeof p.options.apiKey === 'string' && p.options.apiKey.length > 30)
    .sort((a, b) => (b[1].enabled ? 1 : 0) - (a[1].enabled ? 1 : 0));
  for (const [id, p] of candidates) {
    const payload = decodeJwt(p.options.apiKey);
    if (payload && payload.user_id != null) {
      if (!userId) userId = String(payload.user_id);
      providerId = id;
      break;
    }
  }

  // 3) 展示信息：user_info 里的邮箱/昵称
  const userInfo = decryptJson(credentials[`oauth:${activeProvider}:user_info`]) || {};
  const email = userInfo.email || null;
  const name = userInfo.name || userInfo.username || userInfo.displayName || null;

  if (!userId) return null;
  const shortId = userId.slice(0, 8);
  return {
    userId,
    shortId,
    email,
    name,
    provider: providerId || activeProvider,
    label: email || name || `账号-${shortId}`,
  };
}

/** 提取当前正在使用的账号指纹 */
function extractCurrent() {
  const credentials = readJsonFile(CREDENTIALS_FILE);
  const config = readJsonFile(CONFIG_FILE);
  return extractFrom(credentials, config);
}

module.exports = { decodeJwt, extractFrom, extractCurrent };

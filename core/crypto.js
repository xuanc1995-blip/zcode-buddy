'use strict';
/**
 * ZCode credentials.json 中 enc:v1 字段的解密（只解密，不加密）。
 *
 * 格式：enc:v1:<nonce_b64url>.<authTag_b64url>.<cipherText_b64url>
 * 算法：aes-256-gcm，key = sha256(secret)
 * secret：优先环境变量 ZCODE_CREDENTIAL_SECRET，否则
 *         `zcode-credential-fallback:<platform>:<homedir>:<username>`
 *
 * 仅用于读取本机当前用户的登录态（快照指纹、额度查询），工具本身不修改单字段。
 */
const crypto = require('crypto');
const os = require('os');

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

function defaultSecret() {
  if (process.env.ZCODE_CREDENTIAL_SECRET) return process.env.ZCODE_CREDENTIAL_SECRET;
  let username = 'unknown';
  try { username = os.userInfo().username; } catch (_) {}
  return `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function decrypt(value, secret = defaultSecret()) {
  if (!isEncrypted(value)) return value;
  const parts = value.slice(PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('enc:v1 格式不正确');
  const [nonce, tag, cipherText] = parts;
  const decipher = crypto.createDecipheriv(ALGO, crypto.createHash('sha256').update(secret).digest(), Buffer.from(nonce, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherText, 'base64url')), decipher.final()]).toString('utf8');
}

function decryptJson(value) {
  try {
    return JSON.parse(decrypt(value));
  } catch (_) {
    return null;
  }
}

module.exports = { PREFIX, isEncrypted, decrypt, decryptJson };

'use strict';
/**
 * 账号数据加密备份：导出为 .zbak 文件（AES-256-GCM + PBKDF2 口令派生），
 * 用于跨机器迁移或手动备份。文件格式：
 *   zcodebuddy-backup v1 (ASCII 20B) | salt(16) | iv(12) | authTag(16) | ciphertext(JSON)
 * ciphertext JSON: { exportedAt, accounts: [完整快照] }
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const MAGIC = 'zcodebuddy-backup v1';
const SALT_LEN = 16;
const IV_LEN = 12;

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(String(passphrase), salt, 200000, 32, 'sha256');
}

/** 导出全部账号到目标文件，返回写入的账号数量 */
function exportToFile(filePath, passphrase) {
  if (!passphrase || String(passphrase).length < 4) {
    throw new Error('备份口令至少 4 位（用于加密，请牢记，导入时需要）');
  }
  const accounts = store.listAccounts({ withPayload: true });
  if (accounts.length === 0) throw new Error('还没有任何账号快照可导出');

  const plain = Buffer.from(JSON.stringify({
    exportedAt: Date.now(),
    accounts,
  }), 'utf8');

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);

  const out = Buffer.concat([
    Buffer.from(MAGIC, 'ascii'),
    salt,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, out);
  return accounts.length;
}

/** 从备份文件导入，与现有快照按 id 合并（重名快照自动加后缀），返回 {imported, skipped} */
function importFromFile(filePath, passphrase) {
  const buf = fs.readFileSync(filePath);
  if (buf.slice(0, MAGIC.length).toString('ascii') !== MAGIC) {
    throw new Error('不是有效的 ZCode Buddy 备份文件');
  }
  let off = MAGIC.length;
  const salt = buf.slice(off, off + SALT_LEN); off += SALT_LEN;
  const iv = buf.slice(off, off + IV_LEN); off += IV_LEN;
  const tag = buf.slice(off, off + 16); off += 16;
  let decipher;
  try {
    decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(buf.slice(off)), decipher.final()]).toString('utf8');
    var data = JSON.parse(plain);
  } catch (_) {
    throw new Error('解密失败：口令错误或文件已损坏');
  }

  let imported = 0;
  let skipped = 0;
  for (const account of data.accounts || []) {
    if (!account || !account.id || !account.credentials) { skipped++; continue; }
    const existing = store.readAccount(account.id);
    if (existing) {
      // 已存在：保留本地命名与使用记录，仅补充本地缺失的数据（额度、历史）
      existing.quota = existing.quota || account.quota || null;
      existing.history = existing.history && existing.history.length ? existing.history : (account.history || []);
      existing.updatedAt = Date.now();
      fs.writeFileSync(path.join(store.STORE_DIR, `${existing.id}.json`), JSON.stringify(existing, null, 2), 'utf8');
    } else {
      fs.writeFileSync(path.join(store.STORE_DIR, `${account.id}.json`), JSON.stringify(account, null, 2), 'utf8');
      imported++;
    }
  }
  return { imported, skipped };
}

module.exports = { exportToFile, importFromFile };

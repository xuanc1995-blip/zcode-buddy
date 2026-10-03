'use strict';
/** core/crypto：enc:v1 解密与真实加密方案（aes-256-gcm）互逆 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { PREFIX, isEncrypted, decrypt, decryptJson } = require('../../core/crypto');

const SECRET = 'unit-test-secret';
// decryptJson 走默认 secret（优先读该环境变量），与测试用 SECRET 对齐
process.env.ZCODE_CREDENTIAL_SECRET = SECRET;

/** 与 ZCode 相同方案构造 enc:v1 字符串：nonce.tag.ciphertext（均 base64url） */
function encrypt(value, secret = SECRET) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [nonce.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

describe('crypto', () => {
  test('isEncrypted 只认 enc:v1: 前缀', () => {
    assert.equal(isEncrypted('enc:v1:abc.def.ghi'), true);
    assert.equal(isEncrypted('plain-text'), false);
    assert.equal(isEncrypted(null), false);
    assert.equal(isEncrypted(42), false);
  });

  test('decrypt 与加密方案互逆（aes-256-gcm + sha256(secret)）', () => {
    const plain = '{"token":"abc","nested":{"n":1}}';
    assert.equal(decrypt(encrypt(plain), SECRET), plain);
  });

  test('密钥不对时解密失败（authTag 校验）', () => {
    assert.throws(() => decrypt(encrypt('hello', SECRET), 'wrong-secret'));
  });

  test('非 enc 值原样透传', () => {
    assert.equal(decrypt('plain', SECRET), 'plain');
  });

  test('格式不正确（段数不对）抛错', () => {
    assert.throws(() => decrypt('enc:v1:only-one-segment', SECRET));
  });

  test('decryptJson 返回对象；坏数据返回 null', () => {
    assert.deepEqual(decryptJson(encrypt('{"a":1}', SECRET)), { a: 1 });
    assert.equal(decryptJson(encrypt('not-json', SECRET)), null);
    assert.equal(decryptJson('plain-json{"a":1}{', SECRET), null);
  });

  test('默认 secret 支持环境变量覆盖（ZCODE_CREDENTIAL_SECRET）', () => {
    process.env.ZCODE_CREDENTIAL_SECRET = 'env-secret';
    try {
      const v = encrypt('x', 'env-secret');
      // 用 env secret 加密后，不传 secret（走默认=env）可解
      assert.equal(decrypt(v), 'x');
    } finally {
      delete process.env.ZCODE_CREDENTIAL_SECRET;
    }
  });
});

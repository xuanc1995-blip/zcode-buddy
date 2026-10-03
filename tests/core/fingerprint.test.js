'use strict';
/** core/fingerprint：JWT 解析与账号身份提取 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.ZCODE_CREDENTIAL_SECRET = 'fp-test-secret'; // 必须在 require 之前设置

const { decodeJwt, extractFrom } = require('../../core/fingerprint');
const { PREFIX } = require('../../core/crypto');

const SECRET = 'fp-test-secret';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** 构造假 JWT（不验签） */
function makeJwt(payload) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

function enc(value, secret = SECRET) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + [nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

describe('fingerprint', () => {
  test('decodeJwt 解析 payload，坏输入返回 null', () => {
    assert.deepEqual(decodeJwt(makeJwt({ user_id: 42 })).user_id, 42);
    assert.equal(decodeJwt('not-a-jwt'), null);
    assert.equal(decodeJwt(null), null);
  });

  test('extractFrom：zcodejwttoken 优先，user_info 提供展示信息', () => {
    const credentials = {
      'oauth:active_provider': enc('bigmodel'),
      zcodejwttoken: enc(makeJwt({ user_id: '987654321', exp: 9999999999 })),
      'oauth:bigmodel:user_info': enc(JSON.stringify({ email: 'a@b.c', name: '小明' })),
    };
    const fp = extractFrom(credentials, null);
    assert.equal(fp.userId, '987654321');
    assert.equal(fp.shortId, '98765432');
    assert.equal(fp.email, 'a@b.c');
    assert.equal(fp.name, '小明');
    assert.equal(fp.label, 'a@b.c');
    assert.equal(fp.provider, 'bigmodel');
  });

  test('extractFrom：无 zcodejwttoken 时回退 provider apiKey', () => {
    const credentials = { 'oauth:active_provider': enc('bigmodel') };
    const config = {
      provider: {
        other: { enabled: false, options: { apiKey: makeJwt({ user_id: '111' }) } },
        bigmodel: { enabled: true, options: { apiKey: makeJwt({ user_id: '222' }) } },
      },
    };
    const fp = extractFrom(credentials, config);
    assert.equal(fp.userId, '222'); // enabled 的 provider 优先
    assert.equal(fp.provider, 'bigmodel');
  });

  test('extractFrom：无 user_id 返回 null', () => {
    assert.equal(extractFrom({ zcodejwttoken: enc(makeJwt({ exp: 1 })) }, null), null);
    assert.equal(extractFrom(null, null), null);
    assert.equal(extractFrom({}, {}), null);
  });

  test('extractFrom：user_info 为明文 JSON（未加密）时同样可用', () => {
    const credentials = {
      zcodejwttoken: makeJwt({ user_id: '55' }), // 明文 JWT
      'oauth:bigmodel:user_info': JSON.stringify({ email: 'p@q.r' }),
    };
    const fp = extractFrom(credentials, null);
    assert.equal(fp.userId, '55');
    assert.equal(fp.email, 'p@q.r');
  });
});

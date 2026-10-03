'use strict';
/** core/autologin：CLI 输出解析（纯函数）与路径推导 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { cliPathFromExe, parseLoginOutput, parseReadyResult } = require('../../core/autologin');

describe('autologin：cliPathFromExe', () => {
  test('由 ZCode.exe 推导 resources/glm/zcode.cjs', () => {
    const exe = 'D:\\AI-Tool\\ZCode\\ZCode.exe';
    assert.equal(cliPathFromExe(exe), path.join('D:\\AI-Tool\\ZCode', 'resources', 'glm', 'zcode.cjs'));
  });
});

describe('autologin：parseLoginOutput', () => {
  test('识别浏览器打开失败时的 fallback URL（json 模式走 stderr）', () => {
    const ev = parseLoginOutput('Opening browser for Z.AI authorization. Fallback URL: https://zcode.z.ai/oauth/authorize?flow=abc ');
    assert.equal(ev.type, 'authorize-url');
    assert.equal(ev.url, 'https://zcode.z.ai/oauth/authorize?flow=abc');
  });

  test('识别 no-browser 模式的 sign in URL', () => {
    const ev = parseLoginOutput('Open this URL to sign in: https://example.com/x?y=1');
    assert.equal(ev.type, 'authorize-url');
    assert.equal(ev.url, 'https://example.com/x?y=1');
  });

  test('普通行与空行返回 null', () => {
    assert.equal(parseLoginOutput('some noise'), null);
    assert.equal(parseLoginOutput(''), null);
    assert.equal(parseLoginOutput(null), null);
  });
});

describe('autologin：parseReadyResult', () => {
  test('从 stdout 提取最终的 ready JSON', () => {
    const out = [
      'some leading noise',
      JSON.stringify({ status: 'pending' }),
      JSON.stringify({
        status: 'ready', provider: 'zai',
        user: { user_id: '123', email: 'a@b.c', name: '小明' },
        model: 'glm-5.3',
        credentialsPath: 'C:\\Users\\x\\.zcode\\v2\\credentials.json',
        configPath: 'C:\\Users\\x\\.zcode\\v2\\config.json',
        browser: { opened: true },
      }),
    ].join('\n');
    const r = parseReadyResult(out);
    assert.equal(r.status, 'ready');
    assert.equal(r.user.user_id, '123');
    assert.match(r.credentialsPath, /v2[\\/]credentials\.json$/);
  });

  test('没有 ready JSON 时返回 null', () => {
    assert.equal(parseReadyResult(''), null);
    assert.equal(parseReadyResult('no json at all'), null);
    assert.equal(parseReadyResult('{"status":"error","message":"x"}'), null);
    assert.equal(parseReadyResult('{"status":"ready"}'), null); // 缺 user
  });

  test('坏 JSON 行不抛错，继续找合法行', () => {
    const out = '{broken\n{"status":"ready","user":{"user_id":"9"}}';
    assert.equal(parseReadyResult(out).user.user_id, '9');
  });
});

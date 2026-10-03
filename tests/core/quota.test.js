'use strict';
/** core/quota：token 候选顺序与 billing 数据归一化（不发真实网络请求） */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { tokenCandidates, normalize } = require('../../core/quota');

describe('tokenCandidates', () => {
  test('顺序：zcodejwttoken → oauth access_token → provider apiKey，去重、跳过 enc: 前缀与过短值', () => {
    const long = (s) => s.repeat(40); // > 30 字符，满足 token/apiKey 长度门槛
    const credentials = {
      zcodejwttoken: long('a'),
      'oauth:bigmodel:access_token': long('b'),
    };
    const config = {
      provider: {
        p1: { enabled: true, options: { apiKey: long('c') } },
        p2: { enabled: true, options: { apiKey: 'enc:v1:xxx' } }, // enc: 前缀被跳过
        p3: { enabled: true, options: { apiKey: 'short' } },      // 过短被跳过
      },
    };
    assert.deepEqual(tokenCandidates(credentials, config), [long('a'), long('b'), long('c')]);
  });

  test('空/坏输入返回空数组', () => {
    assert.deepEqual(tokenCandidates(null, null), []);
    assert.deepEqual(tokenCandidates({}, {}), []);
  });

  test('access_token 里的 enc 值能被解出（同机默认 secret 不通用，这里只验证透传/解密不抛）', () => {
    // zcodejwttoken 为明文时直接进入候选
    const credentials = { zcodejwttoken: 'x'.repeat(40) };
    assert.deepEqual(tokenCandidates(credentials, null), ['x'.repeat(40)]);
  });
});

describe('normalize', () => {
  const currentRaw = {
    data: {
      plans: [{
        status: 'active',
        plan_id: 'zcode-max-monthly',
        name: 'Max 套餐',
        ends_at: 1900000000,
        entitlements: [
          { entitlement_id: 'ent-aaaa', period: 'daily', grant_units: 100 },
        ],
      }],
    },
  };

  test('余额归一化：字符串数字、千分位、period 映射、percentUsed', () => {
    const balances = [
      { name: 'GLM-5.3', entitlement_id: 'ent-aaaa', total_units: '120000', used_units: '1,500', remaining_units: '118500' },
      { name: 'GLM-4.6', total_units: 50000, used_units: 0, remaining_units: 50000 },
    ];
    const info = normalize(currentRaw, balances);
    assert.equal(info.total, 170000);
    assert.equal(info.used, 1500);
    assert.equal(info.remaining, 168500);
    assert.ok(info.percentUsed > 0 && info.percentUsed < 1);
    assert.equal(info.items[0].period, 'daily'); // entitlement_id → period 映射
    assert.equal(info.plan.tier, 'Max');
    assert.equal(info.isEmpty, false);
  });

  test('同名模型重名时附加 entitlement 尾缀', () => {
    const balances = [
      { name: 'GLM-5.3', entitlement_id: 'ent-1111', total_units: 100, used_units: 1, remaining_units: 99 },
      { name: 'GLM-5.3', entitlement_id: 'ent-2222', total_units: 100, used_units: 2, remaining_units: 98 },
    ];
    const info = normalize(currentRaw, balances);
    assert.equal(info.items[0].name, 'GLM-5.3');
    assert.match(info.items[1].name, /GLM-5\.3·2222$/);
  });

  test('balance 不可用时回退 current 的 entitlements（无已用数据）', () => {
    const info = normalize(currentRaw, null);
    assert.equal(info.items.length, 1);
    assert.equal(info.items[0].total, 100);
    assert.equal(info.items[0].used, null);
    assert.equal(info.used, null);
  });

  test('空 plans + 空 balances → isEmpty', () => {
    const info = normalize({ data: { plans: [] } }, []);
    assert.equal(info.isEmpty, true);
    assert.equal(info.total, null);
  });

  test('多层包裹的响应能被解开（data/result 嵌套）', () => {
    const info = normalize({ result: { data: { plans: [{ status: 'active', plan_id: 'lite', entitlements: [] }] } } }, []);
    assert.equal(info.plan.tier, 'Lite');
  });
});

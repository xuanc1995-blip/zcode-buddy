'use strict';
/** core/switcher：agent 进程枚举输出的解析（纯函数，不碰真实进程） */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseAgentOutput, AGENT_SIGNATURE } = require('../../core/switcher');

describe('switcher：parseAgentOutput', () => {
  test('解析 pid\tcmdline 行', () => {
    const sample = [
      '15644\tD:\\AI-Tool\\ZCode\\ZCode.exe D:\\AI-Tool\\ZCode\\resources\\glm\\zcode.cjs app-server --stdio --surface desktop',
      '34600\tD:\\AI-Tool\\ZCode\\ZCode.exe D:\\AI-Tool\\ZCode\\resources\\glm\\zcode.cjs app-server --stdio --surface desktop',
    ].join('\r\n');
    const out = parseAgentOutput(sample);
    assert.deepEqual(out.map((x) => x.pid), [15644, 34600]);
    assert.match(out[0].cmdline, /app-server --stdio/);
  });

  test('忽略空行、无 tab 行与坏 pid 行', () => {
    const sample = ['', 'not a process line', 'abc\tbroken', '0\tpid-zero', '123\tvalid'];
    const out = parseAgentOutput(sample.join('\n'));
    assert.deepEqual(out, [{ pid: 123, cmdline: 'valid' }]);
  });

  test('空输入返回空数组', () => {
    assert.deepEqual(parseAgentOutput(''), []);
    assert.deepEqual(parseAgentOutput(null), []);
  });

  test('AGENT_SIGNATURE 与真实 agent 命令行匹配（app-server）', () => {
    const real = 'D:\\AI-Tool\\ZCode\\ZCode.exe D:\\AI-Tool\\ZCode\\resources\\glm\\zcode.cjs app-server --stdio --surface desktop';
    assert.ok(real.includes(AGENT_SIGNATURE));
    // 不误伤其他子进程类型
    assert.ok(!'--type=renderer --user-data-dir=x'.includes(AGENT_SIGNATURE));
    assert.ok(!'zcode.cjs __zcode-plugin-host server.js'.includes(AGENT_SIGNATURE));
    assert.ok(!'zcode.cjs mcp server.js'.includes(AGENT_SIGNATURE));
  });
});

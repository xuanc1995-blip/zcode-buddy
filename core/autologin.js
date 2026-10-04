'use strict';
/**
 * 浏览器登录添加账号：复用 ZCode 自带 CLI 的 login 命令（不自己复刻 OAuth）。
 * 逆向 resources/glm/zcode.cjs 确认（v0.13.3，2026-10-03）：
 *   - 调用：ZCode.exe（env ELECTRON_RUN_AS_NODE=1）resources/glm/zcode.cjs login --json
 *   - 流程：CLI 打开浏览器授权（fallback URL 打到 stderr）→ 服务端 /oauth/cli/{init,poll} 轮询
 *           → 完成后官方 CLI 自己写 ~/.zcode/v2/credentials.json + config.json（与 Buddy 管理的同一份）
 *   - 成功输出（stdout，JSON）：{status:"ready", provider:"zai", user:{user_id,...}, model,
 *           credentialsPath, configPath, browser:{opened}}
 * Buddy 只负责拉起、转发授权 URL、解析结果；随后照常 captureCurrent 存快照。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** 由 ZCode.exe 路径推导 CLI 脚本路径（resources/glm/zcode.cjs，与 app-server 的拉起方式同源） */
function cliPathFromExe(zcodeExe) {
  return path.join(path.dirname(zcodeExe), 'resources', 'glm', 'zcode.cjs');
}

/** 解析 CLI 输出行为事件（纯函数，供测试） */
function parseLoginOutput(line) {
  const m = /(?:Fallback URL|sign in):\s*(\S+)/.exec(line || '');
  if (m) return { type: 'authorize-url', url: m[1] };
  return null;
}

/** 从 stdout 全文里提取最终的 ready JSON（纯函数，供测试） */
function parseReadyResult(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && obj.status === 'ready' && obj.user) return obj;
    } catch (_) { /* 继续往前找 */ }
  }
  return null;
}

/**
 * 拉起官方 CLI 登录流程并等待完成。
 * @param {{zcodeExe:string, cliPath?:string, timeoutMs?:number, onEvent?:Function}} opts
 * @returns {Promise<{user:object, model?:string, credentialsPath:string, configPath:string}>}
 */
function loginViaCli({ zcodeExe, cliPath, timeoutMs = LOGIN_TIMEOUT_MS, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const cli = cliPath || cliPathFromExe(zcodeExe);
    if (!zcodeExe) return reject(new Error('找不到 ZCode.exe，无法调用其登录命令'));
    if (!fs.existsSync(cli)) return reject(new Error(`找不到 ZCode CLI（${cli}），客户端目录结构可能已变化`));

    const emit = (e) => { try { onEvent && onEvent(e); } catch (_) {} };
    const child = spawn(zcodeExe, [cli, 'login', '--json'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: os.homedir(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    let outBuf = '';
    let errBuf = '';
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) {}
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error('登录超时（5 分钟）——请重试并在浏览器里尽快完成授权')), timeoutMs);

    const handleLine = (line) => {
      const ev = parseLoginOutput(line);
      if (ev) emit(ev);
    };
    // 按 chunk 逐行解析：缓冲不完整行，避免跨 chunk 边界拆散 URL 行
    const feed = (chunk, into) => {
      const text = chunk.toString('utf8');
      if (into === 'err') { err += text; errBuf += text; } else { out += text; outBuf += text; }
      const buf = into === 'err' ? errBuf : outBuf;
      const lines = buf.split(/\r?\n/);
      const rest = lines.pop();
      if (into === 'err') errBuf = rest; else outBuf = rest;
      for (const line of lines) handleLine(line);
    };
    child.stdout.on('data', (d) => feed(d, 'out'));
    child.stderr.on('data', (d) => feed(d, 'err'));

    child.on('error', (e) => finish(reject, new Error('拉起 ZCode CLI 失败：' + e.message)));
    child.on('exit', (code) => {
      if (code === 0) {
        const result = parseReadyResult(out);
        if (result && result.user && result.user.user_id != null) return finish(resolve, result);
        return finish(reject, new Error('登录流程结束但未取到账号信息（输出格式可能已变化）'));
      }
      const lastErr = err.trim().split(/\r?\n/).filter(Boolean).pop();
      finish(reject, new Error(lastErr || `登录命令退出码 ${code}（未完成授权或服务端拒绝）`));
    });
  });
}

module.exports = { LOGIN_TIMEOUT_MS, cliPathFromExe, parseLoginOutput, parseReadyResult, loginViaCli };

# ZCode Buddy 交接文档

> 最后更新：2026-10-03 · 当前版本 v0.5.16（本地）· 维护者接手前请完整阅读本文档

---

## 一、项目是什么

**ZCode Buddy** 是 ZCode（智谱 GLM Coding / Start Plan 桌面客户端）的第三方增强工具，核心能力：

1. **多账号快捷切换**：保存 ZCode 登录态快照，一键切换账号（免扫码），支持回滚
2. **额度实时看板**：仪表盘（环形额度表/分模型额度/消耗柱状图）、账号管理卡片、低额度 Windows 通知与建议切换
3. **用量统计**：今日/昨日消耗、合并与单账号双视图、历史趋势
4. **配套**：账号加密备份导出导入（.zbak）、系统托盘、全局快捷键 Ctrl+Alt+1~9、开机自启、跟随系统深浅色、窗口透明度调节

技术栈：**Electron 33 + React 18 + Vite 5**；核心逻辑为零依赖 Node（≥18，仅内置模块），与界面解耦。目标平台 Windows（macOS/Linux 未做）。

## 二、当前状态（⚠ 接手必读）

| 事项 | 状态 |
|---|---|
| 本地 git | master 领先 origin/main **18 个提交**（实验批，**未推 GitHub**——等待验收后一次性推送） |
| GitHub 仓库 | https://github.com/xuanc1995-blip/zcode-buddy （公开、MIT、描述/topics 已配置） |
| 远端最新 Release | **v0.4.1**（本地 v0.5.0~v0.5.16 均未发布） |
| 发布流程 | 打 tag（如 `v0.5.16`）→ GitHub Actions 自动构建 NSIS+portable 并挂到 Release（`.github/workflows/release.yml`） |
| gh CLI 账号 | 双账号：**xuanc1995-blip（active，发布用）**、daxieba（inactive）。设备流程登录（client_id `178c6fc778ccc68e1d6a`）。推送如遇 403，确认活动账号：`gh api user --jq .login` |

**推送前检查清单**：① 用户验收实验批功能；② `git push origin master:main`；③ `git tag v0.5.16 && git push --tags` 触发 CI 或本地挂 Release；④ Release 附件（Setup/portable/source zip）；⑤ 可选：把仓库关联到用户的 Projects 看板 `users/xuanc1995-blip/projects/1`（需 token 有 `read:project` scope，当前没有）。

## 三、架构与目录

```
core/                 # 零依赖 Node 核心（可独立 CLI）
  paths.js            #   路径常量 + ZCode.exe 定位（含运行中进程反查，适配非标准安装路径）
  crypto.js           #   ZCode enc:v1 字段解密（aes-256-gcm）
  fingerprint.js      #   从登录态提取账号身份（user_id/邮箱）
  store.js            #   快照存储 + 额度缓存 + 当日消耗计算 + 历史记录（576 点）
  switcher.js         #   进程检测/备份/原子替换/回滚（切换核心）
  quota.js            #   billing 接口客户端 + 客户端身份头复刻
  exporter.js         #   .zbak 加密备份导出/导入
  cli.js              #   命令行入口
electron/
  main.cjs            # 主进程：窗口/托盘/IPC/轮询提醒/自绘窗口键/全局快捷键
  preload.cjs         # contextBridge API
src/renderer/         # React UI（App + pages/{Dashboard,Accounts,Usage,Activity,Settings,About}）
scripts/              # gen-icon.js（纯 Node 图标光栅化）、add-shortcut.ps1
build/icon.png        # 应用图标（1024，electron-builder 自动生成 ico）
dist/                 # vite 构建产物（gitignore）
release/              # 打包产物（gitignore）：Setup exe + portable exe
accounts/             # 账号快照（含明文凭证！已 gitignore，严禁外传/入库）
.github/workflows/release.yml  # tag → 自动打包发布
```

数据目录：安装版/便携版 `%APPDATA%\zcode-buddy\accounts`（快照）+ 同级 `settings.json`；开发实例隔离在 `%APPDATA%\zcode-buddy\dev`（避免与打包版单实例锁冲突）。

## 四、关键技术事实（踩坑换来的，改代码前必读）

### 1. 登录态与切换机制
- ZCode 登录态 = `%USERPROFILE%\.zcode\v2\credentials.json` + `config.json` 两份文件
- **切换 = 关闭 ZCode → 备份当前到 `.last/` → 原子替换（.tmp+rename）→ 重启 ZCode**。运行中直接改文件会被客户端退出时回写覆盖
- `credentials.json` 中敏感字段是 `enc:v1` 加密：aes-256-gcm，key = sha256(`zcode-credential-fallback:<platform>:<homedir>:<username>`)。解密仅用于指纹与额度查询；快照因此**仅限本机使用**

### 2. 额度接口（core/quota.js）
- `GET https://zcode.z.ai/api/v1/zcode-plan/billing/current` 与 `/billing/balance`，参数 `?app_version=<客户端版本>`，`Authorization: Bearer <zcodejwttoken>`
- token 候选顺序：`zcodejwttoken` → `oauth:<active>:access_token` → config.json 各 provider apiKey；401/403 换下一个，429 退避重试
- **balance 接口校验完整客户端身份头**：`User-Agent: ZCode/<版本>`、`X-ZCode-App-Version`、`X-Platform`、`X-Title: Z Code@electron`、`X-Device-Mid`（取自 `~\.zcode\v2\telemetry-state.json` 的 deviceMid）等，缺头返回 400 "parameter error"——已全部复刻在 `clientHeaders()`
- ⚠ **ZCode 客户端升级后**需更新 `CLIENT_APP_VERSION`（取 `%LOCALAPPDATA%` 下 ZCode 版本，或客户端日志 `billing/balance?app_version=` 处）
- 逆向方法（将来接口再变时）：解析 asar 索引定位 `out/host/index.js`，沿 `$y → ot(readApiJson) → NodeApiClient.request → fpe → ppe(withZCodeEndpointHeaders) → zy(buildZCodeSourceHeaders) → dpe(readExistingDeviceMid)` 找头构建链

### 3. 今日消耗口径（经过三次迭代的最终方案）
- **直接求和服务器各活跃额度的 `used_units`**——这些额度每日续期，used 计数随续期清零，服务器的 used 即当日用量，跨零点自动重新起算
- 已否决的方案及原因：① 历史点差值（应用重启/关闭期的采样缺口会漏计）；② 当日基线差值（基线晚于消耗开始时低估）
- 历史记录保留 576 点（5 分钟轮询 ≈ 48 小时），用于 sparkline/趋势与昨日消耗（`usedYesterday`，跨零点前需历史覆盖昨日）

### 4. 其他
- ZCode.exe 可能装在非标准路径：`findZCodeExe()` 有运行中进程反查兜底（PowerShell Get-Process）
- `execSync`（tasklist/taskkill）**必须带 timeout**（现 5 秒）：WMI 拥塞时会无限挂起并冻结主进程事件循环
- 自绘窗口控制键（弃用系统 titleBarOverlay）：overlay 在深色/透明模式下颜色不可控
- 打包版运行中无法覆盖 win-unpacked exe（文件锁）→ 重打包前 `taskkill /F /IM "ZCode Buddy.exe"`

## 五、常用命令

```bash
npm install            # 安装（本机 npm 会拦 install scripts：需 npm approve-scripts electron esbuild）
npm run dev:electron   # 开发运行（渲染层改动后先 npm run build:renderer，或另开 dev:vite）
npm run build          # 构建安装版+便携版到 release/（先关正在运行的 ZCode Buddy.exe）
npm run icon           # 重新生成应用图标
node core/cli.js status|list|capture|use|quota|rollback   # CLI
node scripts/add-shortcut.ps1   # 重建桌面快捷方式
```

调试技巧：开发实例加 `--remote-debugging-port=9341`，用 **Node 24 内置 WebSocket** 客户端连页面 target 做 CDP 检查（⚠ 手搓 WS 帧解析不支持分片消息，响应大了会"假超时"——本次排查的最大弯路）。

## 六、已知问题与限制

- 「昨日消耗」需要历史覆盖昨日（历史约 48 小时 + 应用需在运行轮询），刚装前两天数据不全属正常
- one_time 额度若当日中途续期，续期前的消耗计入当日（used 随续期清零后只统计续期后的）——与用户观察口径一致
- 快照含明文凭证且与机器绑定（enc:v1），跨机器需走「导出/导入备份」
- 浅色主题下模型进度条曾因 Chromium button 子元素不拉伸塌陷——现已用显式宽度修复，改动相关布局时注意
- 账号顺序 = 名称中数字升序（01→02→03），全局快捷键 Ctrl+Alt+N 与此对应

## 七、Roadmap（未实现）

- 浏览器 OAuth 直接添加新账号（免手动切换登录）
- 热切换（不关闭 ZCode 主窗口，仅重启 agent 子进程）
- 跨账号会话迁移
- macOS / Linux 支持

## 八、发布操作手册（下次发版照做）

1. 确认 `CHANGELOG.md` 已更新、`npm run build:renderer` + `npm run build` 通过
2. 本地验收：`release\win-unpacked\ZCode Buddy.exe` 启动正常、额度数字正确
3. 提交并推送：`git push origin master:main`（网络抖动多重试；需用户确认实验批可发布）
4. `git tag v0.x.x && git push --tags` → CI 自动构建（或本地 `gh release create`）
5. 本地发布：`gh release create v0.x.x "release/ZCode Buddy Setup 0.x.x.exe" "release/ZCode Buddy-x.x.x-portable.exe" "release/zcode-buddy-x.x.x-source.zip" --repo xuanc1995-blip/zcode-buddy --title "..." --notes-file ...`
6. 清理 release/ 旧版本附件

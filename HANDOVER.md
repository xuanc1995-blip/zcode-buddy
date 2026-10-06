# ZCode Buddy 交接文档

> 最后更新：2026-10-04 · 当前版本 v0.7.0（已发布）· 维护者接手前请完整阅读本文档

---

## 一、项目是什么

**ZCode Buddy** 是 ZCode（智谱 GLM Coding / Start Plan 桌面客户端）的第三方增强工具，核心能力：

1. **多账号快捷切换**：热切换（默认，仅重启 agent 会话进程、不关主窗口）与完整重启切换可按次选择，失败自动回退；浏览器登录添加新账号（复用官方 CLI）；历史登录态自动捕捉与登录历史面板；Ctrl+Alt+1~9 切号、Ctrl+Alt+0 切回上次账号；回滚
2. **额度实时看板**：仪表盘（环形额度表/分模型额度卡/全部账号汇总含本地累计已用）、账号管理卡片（含「≈可撑 X 天」预测 chip）、低额度 Windows 通知（同账号每小时去重）与建议切换
3. **用量统计**：合并与单账号双视图；当日/昨日/近 7 天合计概览（语义分组）；各账号用量表（今日/昨日/剩余/已用比例）；按日聚合落盘（daily.json，120 天含分模型，随 .zbak 备份携带）
4. **配套**：自动更新（electron-updater，可选自动安装）、账号加密备份导出导入（.zbak，v0.6.13 起携带每日消耗历史，导入自动补录缺失日期）、系统托盘（含账号额度与切回上次账号）、全局快捷键 Ctrl+Alt+0~9、开机自启、跟随系统深浅色、窗口透明度调节

技术栈：**Electron 33 + React 18 + Vite 5**；核心逻辑为零依赖 Node（≥18，仅内置模块），与界面解耦。目标平台 Windows（macOS/Linux 未做）。

## 二、当前状态（⚠ 接手必读）

| 事项 | 状态 |
|---|---|
| git 同步 | master 与 origin/main 同步（持续发版中）；v0.5.0~v0.7.1 **逐版本打 tag**（多数一提交一版本，v0.5.12/v0.5.16/v0.7.0 等含 2 提交） |
| GitHub 仓库 | https://github.com/xuanc1995-blip/zcode-buddy （公开、MIT、描述/topics 已配置） |
| Release | **v0.5.0~v0.7.1 全部发布**（Latest=v0.7.1）：tag 推送触发 CI（先跑 npm test 再构建 NSIS+portable，生成 latest.yml 支持应用内更新）挂到 Release；CI 生成说明为 compare 链接，用 `gh release edit` 补标题与说明 |
| 发布流程 | **推荐 `npm run release X.Y.Z`**（scripts/release.mjs：版本号→提交→tag 单推→推送重试→盯 CI）；发版前补 CHANGELOG.md 并同步本文档头部版本行；⚠ 新版本号必须 **≥ Latest 的 semver**（0.6.29 曾误发回退版本号，已撤） |
| gh CLI 账号 | 双账号：**xuanc1995-blip（active，发布用）**、daxieba（inactive）。设备流程登录（client_id `178c6fc778ccc68e1d6a`）。推送如遇 403，确认活动账号：`gh api user --jq .login` |

**下次发版流程**：① 补 `CHANGELOG.md` + 同步本文档**头部版本行**（易漏！）；② `npm test` + `npm run build:renderer` + 本地验收；③ `npm run release X.Y.Z` 一条龙（自动校验 semver ≥ Latest、tag 单推触发 CI、推送重试、盯构建）；④ 网络中断致推送失败时按脚本提示手动补推，用 `git ls-remote --tags` 验证真伪；⑤ 可选：把仓库关联到用户的 Projects 看板 `users/xuanc1995-blip/projects/1`（需 token 有 `read:project` scope，当前没有）。

**版本史速览（2026-10-03 ~ 10-04）**：v0.5.0~v0.5.16 实验批上云（侧栏 6 页/用量统计/操作记录）→ v0.6.0~v0.6.28 快速迭代（热切换默认开与按次选完整重启、浏览器登录添加、历史登录态自动捕捉、可撑天数预测、自动更新、按模型每日聚合、安全加固、UI 全面梳理，过程版本详见 Releases）→ v0.7.0 里程碑（README 重写、切回上次账号）→ v0.7.1（启动动画 + 启动居中；其前身的 0.6.29 误发已撤回）。**当前稳定基线 v0.7.1**。

## 三、架构与目录

```
core/                 # 零依赖 Node 核心（可独立 CLI）
  paths.js            #   路径常量 + ZCode.exe 定位（含运行中进程反查，适配非标准安装路径）
  crypto.js           #   ZCode enc:v1 字段解密（aes-256-gcm）
  （安全）账号 id 写入前强制白名单校验（^[A-Za-z0-9_-]{1,64}$）防路径穿越；快照与 daily.json 均为 tmp+rename 原子写；窗口外链走系统浏览器、will-navigate 已拦截（v0.6.14 审查加固）
  fingerprint.js      #   从登录态提取账号身份（user_id/邮箱）
  store.js            #   快照存储 + 额度缓存 + 当日消耗计算 + 历史记录（576 点）+ 每日聚合（daily.json，120 天）
  switcher.js         #   进程检测/备份/原子替换/回滚（切换核心）+ 热切换（agent 子进程重启）
  quota.js            #   billing 接口客户端 + 客户端身份头复刻
  autologin.js        #   浏览器登录添加账号（复用官方 CLI login --json）
  exporter.js         #   .zbak 加密备份导出/导入
  cli.js              #   命令行入口
electron/
  main.cjs            # 主进程：窗口/托盘/IPC/轮询提醒/自绘窗口键/全局快捷键
  updater.cjs         # 自动更新（electron-updater + GitHub Releases，安装版专用）
  preload.cjs         # contextBridge API
  splash.html         # 启动闪屏（品牌动画+功能展示，主窗就绪后淡出交接）
src/renderer/         # React UI（App + pages/{Dashboard,Accounts,Usage,Settings,About}；侧栏 5 项）
scripts/              # gen-icon.js（纯 Node 图标光栅化）、add-shortcut.ps1、release.mjs（发版一条龙）、run-tests.cjs（测试启动器，兼容 CI Node20 与本机 Node24）
tests/core/           # 单元测试（node:test，npm test）——不发网络请求、不碰真实登录态
build/icon.png        # 应用图标（1024，electron-builder 自动生成 ico）
dist/                 # vite 构建产物（gitignore）
release/              # 打包产物（gitignore）：Setup exe + portable exe
accounts/             # 账号快照（含明文凭证！已 gitignore，严禁外传/入库）
.github/workflows/release.yml  # tag → 自动打包发布（含 latest.yml 生成，供 electron-updater 检测更新）
```

数据目录：安装版/便携版 `%APPDATA%\zcode-buddy\accounts`（快照）+ 同级 `settings.json`；开发实例隔离在 `%APPDATA%\zcode-buddy\dev`（避免与打包版单实例锁冲突）。

## 四、关键技术事实（踩坑换来的，改代码前必读）

### 1. 登录态与切换机制
- ZCode 登录态 = `%USERPROFILE%\.zcode\v2\credentials.json` + `config.json` 两份文件
- **完整切换 = 关闭 ZCode → 备份当前到 `.last/` → 原子替换（.tmp+rename）→ 重启 ZCode**。运行中直接改文件会被客户端退出时回写覆盖
- **热切换（v0.6.2 起默认开启）**：agent 子进程 = 命令行含 `zcode.cjs app-server` 的 ZCode.exe。流程 = 杀全部 agent（taskkill /T）→ 立即原子替换 → 轮询检测。**已逆向确认可行性**（out/host/chunk-MZDDONWW.js 的 AgentProcessManager）：agent 按 workspace 按需管理，死亡后下一次 `getClient` 重新 spawn 并载入新登录态，另有空闲回收——即使未检测到立即重启，会话也会在下次使用时自动恢复。失败仍自动回退完整切换
- **浏览器登录添加账号**：复用官方 CLI `zcode.cjs login --json`（spawn 方式同 app-server：ZCode.exe + `ELECTRON_RUN_AS_NODE=1`）。CLI 自己完成浏览器授权（/oauth/cli/{init,poll}）并写同一份 `~/.zcode/v2` 登录态，stdout 输出 `{status:"ready", user, credentialsPath, configPath}`；Buddy 随后照常 captureCurrent。实现见 `core/autologin.js`
- **快照凭证保活**：pollQuotaOnce 每轮调用 syncCurrentAccountSnapshot()，当前账号的活体凭证与快照不一致（客户端轮换 token）时自动 captureCurrent 同步，减少「过期」。
- **历史登录态自动捕捉**：`login-state.json`（userData）记录 lastShortId；启动与每轮轮询时 `checkLoginStateChange()` 对比当前指纹，变化则记录事件并自动 captureCurrent（source:'auto'，可关）。快照字段 source 区分来源（manual/auto/login）。注意：检测依赖 Buddy 运行，Buddy 未运行期间发生的登录变化在其下次启动时补捉
- **快速切回上次账号（v0.7.0）**：`switcher.readLastBackupFingerprint()` 读 `.last/` 备份的账号指纹 → 定位快照 → 走统一切换入口（含热切换/回退）；入口为 `Ctrl+Alt+0` 全局快捷键与托盘菜单项「切回上次账号」；无备份/快照缺失时报错提示
- **启动动画与启动居中（v0.6.29）**：`electron/splash.html` 闪屏先展示（`showInactive` 不抢焦点）；主窗 `show:false` + `center:true`（启动自动居中，**不再恢复 x/y，仅记忆大小**），ready-to-show 后等够 `SPLASH_MIN_MS=1500` → 闪屏加 `.bye` 淡出 → 主窗 show + `setOpacity` 0→1 渐显；5 秒兜底强制呈现。透明度跨 0 重建窗口也走同一渐显流程
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
- 历史记录保留 576 点（5 分钟轮询 ≈ 48 小时），用于 sparkline/趋势
- **每日聚合（v0.6.0 起）**：saveQuota 时把当日 used 求和落盘 `daily.json`（数据目录根，与 accounts/ 同级，保留 120 天）；「昨日消耗」「近 7 天」读这里，不再依赖应用连续在线。某天有记录 = 当天至少轮询过一次（应用全天没跑则该天无数据，这是采样口径的天限）

### 4. 其他
- **账号 id 白名单（v0.6.14 安全加固）**：id 拼快照路径前强制 `^[A-Za-z0-9_-]{1,64}$` 校验（rename/delete/写入与备份导入），杜绝目录穿越；快照与 daily.json 均为 tmp+rename **原子写**；窗口 `setWindowOpenHandler` 外链走系统浏览器 + `will-navigate` 已拦截
- ZCode.exe 可能装在非标准路径：`findZCodeExe()` 有运行中进程反查兜底（PowerShell Get-Process）
- `execSync`（tasklist/taskkill）**必须带 timeout**（现 5 秒）：WMI 拥塞时会无限挂起并冻结主进程事件循环
- 自绘窗口控制键（弃用系统 titleBarOverlay）：overlay 在深色/透明模式下颜色不可控
- 打包版运行中无法覆盖 win-unpacked exe（文件锁）→ 重打包前 `taskkill /F /IM "ZCode Buddy.exe"`

## 五、常用命令

```bash
npm install            # 安装（本机 npm 会拦 install scripts：需 npm approve-scripts electron esbuild）
npm run dev:electron   # 开发运行（渲染层改动后先 npm run build:renderer，或另开 dev:vite）
npm run build          # 构建安装版+便携版到 release/（先关正在运行的 ZCode Buddy.exe）
npm test               # core 单元测试（node:test，不碰真实登录态）
npm run icon           # 重新生成应用图标
npm run release 0.7.0  # 发版一条龙：版本号→提交→tag→推送→盯 CI（先手写 CHANGELOG）
node core/cli.js status|list|capture|use|quota|rollback   # CLI
node scripts/add-shortcut.ps1   # 重建桌面快捷方式
```

调试技巧：开发实例加 `--remote-debugging-port=9341`，用 **Node 24 内置 WebSocket** 客户端连页面 target 做 CDP 检查（⚠ 手搓 WS 帧解析不支持分片消息，响应大了会"假超时"——本次排查的最大弯路）。

## 六、已知问题与限制

- **热切换后 ZCode 界面左下角用户名不刷新**：客户端把登录身份缓存在主进程内存，且对 credentials.json 无文件监听（逆向确认 main 分包无 watch），只有它自己的登录/登出或整窗重启才会刷新。热切换的会话与额度是即时切换的（agent 层面已生效），仅该显示滞后；Buddy 无法安全地从外部刷新它，已在切换确认弹窗里注明
- **操作记录页已移除（v0.6.11）**：登录相关事件在账号管理页「登录历史」面板展示（读 activity.jsonl）；底层记录仍保留（最近 500 条自动截断，activity:clear 接口已随页面一并移除）
- 「昨日消耗」需要历史覆盖昨日（历史约 48 小时 + 应用需在运行轮询），刚装前两天数据不全属正常
- one_time 额度若当日中途续期，续期前的消耗计入当日（used 随续期清零后只统计续期后的）——与用户观察口径一致
- **剩余额度/已用比例 ≠ 100% − 今日消耗比例**：账号可能同时持有每日额度（每日清零）与一次性包（不清零），两套口径合算是服务器实时值，不互为补数属正常
- 快照含明文凭证且与机器绑定（enc:v1），跨机器需走「导出/导入备份」
- 浅色主题下模型进度条曾因 Chromium button 子元素不拉伸塌陷——现已用显式宽度修复，改动相关布局时注意
- 账号顺序 = 名称中数字升序（01→02→03），全局快捷键 Ctrl+Alt+N 与此对应

## 七、Roadmap（未实现）

- ~~热切换~~（v0.6.0 实验版 → v0.6.2 逆向确认后默认开启）
- ~~自动更新~~（v0.6.0 已实现 electron-updater；后续可做：全量静默更新设置项、便携版引导下载直链）
- ~~浏览器 OAuth 直接添加新账号~~（v0.6.2 已实现：复用官方 CLI login，见 core/autologin.js；后续可加：登录进度 UI 优化、失败重试入口）
- ~~跨账号会话迁移~~（**查证后不需要**：会话存于本地 `~/.zcode/cli/db/db.sqlite`，session/message 等全部表无任何账号绑定字段，切账号历史自动跟随；2026-10-04 用 node:sqlite 检查 schema 证实）
- macOS / Linux 支持
- 界面 i18n（当前全中文硬编码）

## 八、发布操作手册（下次发版照做）

1. 确认 `CHANGELOG.md` 已更新、`npm run build:renderer` + `npm run build` 通过
2. 本地验收：`release\win-unpacked\ZCode Buddy.exe` 启动正常、额度数字正确
3. 提交并推送：`git push origin master:main`（网络抖动多重试；需用户确认实验批可发布）
4. `git tag v0.x.x && git push --tags` → CI 自动构建。⚠ **一次推送超过 3 个 tag 时 GitHub 不触发任何工作流**（官方限制）：批量发版需每批 ≤3 个分次推，或事后逐个手动派发 `gh workflow run release.yml --ref v0.x.x`（workflow_dispatch 支持 tag 作为 ref，产物照样挂到对应 Release）；CI 生成的 Release 说明只有 compare 链接，用 `gh release edit vX --title "ZCode Buddy vX" --notes ...` 补标题与说明。**推荐直接用发版脚本**：`npm run release <版本>`（tag 单推 + 自动盯 CI）
5. **latest.yml 命名坑**：electron-updater 用的 latest.yml 里 `path/url` 必须与 Release 附件实际名一致——GitHub 附件是「空格→点号」安全名（`ZCode.Buddy.Setup.0.6.0.exe`），CI 生成步骤已复刻该转换；若手写 latest.yml 记得同步，且 `sha512`（base64）必须是对应 Setup exe 的哈希（v0.6.0 首发曾因带空格名导致更新 404，已修）
5. 本地发布：`gh release create v0.x.x "release/ZCode Buddy Setup 0.x.x.exe" "release/ZCode Buddy-x.x.x-portable.exe" "release/zcode-buddy-x.x.x-source.zip" --repo xuanc1995-blip/zcode-buddy --title "..." --notes-file ...`
6. 清理 release/ 旧版本附件

# ⚡ ZCode Buddy

<div align="center">

**ZCode（智谱 GLM Coding / Start Plan 客户端）多账号快捷切换与额度管理桌面工具**

热切换秒换号 · 浏览器登录加号 · 额度实时看板 · 可撑天数预测 · 自动更新

`Windows` `Electron` `MIT License`

</div>

---

## 功能

### 账号管理
- **热切换（默认开启）**：切换账号只重启 ZCode 的会话进程、不关主窗口，新消息立即由新账号驱动；也可在切换弹窗按次选择「完整重启」（界面身份立即刷新），失败自动回退
- **浏览器登录添加**：一键拉起 ZCode 官方登录流程，浏览器完成授权后新账号自动入库，无需手动登出再登录
- **历史登录态自动捕捉**：检测到登录态变化（手动登录、切换、回滚）自动存为快照，登录过的每个状态都可一键恢复；账号卡片显示「≈可撑 X 天」预测（近 7 天日均消耗口径）
- **快速切回**：`Ctrl+Alt+0` 或托盘一键切回上次账号，双账号来回切换零成本
- **安全机制**：切换前自动备份（.last），一键回滚；快照原子写入；账号加密备份 .zbak（AES-256-GCM）含 120 天每日消耗历史，跨机器迁移不丢数据

### 额度看板
- **实时查询**：直连 ZCode billing 接口获取套餐等级、到期时间、分模型发放/已用量（自动复刻客户端完整身份头）
- **仪表盘**：当前账号环形额度表、分模型额度卡、全部账号汇总（今日已用 / 全部剩余 / 低额度账号数 / 本地累计已用）
- **用量统计**：全部合并与单账号双视图；当日 / 昨日 / 近 7 天合计概览；各账号用量表格
- **低额度提醒**：按可配置间隔自动轮询（默认 5 分钟），剩余低于阈值时 Windows 通知（同账号每小时最多一次），点击直接切换

### 自动更新
- 启动与每 12 小时静默检查 GitHub Releases（可关），发现新版本弹通知
- 关于页可手动检查 / 下载 / 一键重启安装；可选「自动下载 + 退出时自动安装」

### 其他
- 无边框现代化窗口（自定义标题栏、位置记忆）、深色 / 浅色双主题、窗口透明度调节
- 切换策略：额度不足自动切换（可选）；全局快捷键 `Ctrl+Alt+1~9` 切号、`Ctrl+Alt+0` 切回（可选）
- 开机自启、系统托盘常驻（含各账号剩余百分比）
- 零依赖 Node 核心，可独立 CLI 使用；core 模块 50+ 单元测试

## 安装

从 [Releases](../../releases) 下载：

- **安装版** `ZCode Buddy Setup x.x.x.exe`：常规安装，支持应用内自动更新（推荐）
- **便携版** `ZCode Buddy-x.x.x-portable.exe`：免安装，双击即用（不支持自动更新）

两者的账号数据都存在 `%APPDATA%\zcode-buddy\accounts`，可以混用互换。

要求：本机已安装并登录 [ZCode 客户端](https://zcode.z.ai)（Windows）。

## 使用

1. 在 ZCode 里登录账号 A → 打开本工具 → 账号会**自动入库**（也可手动「保存当前账号」）
2. 点「浏览器登录添加」在浏览器里登录账号 B → 自动入库
3. 此后在卡片 / 托盘 / `Ctrl+Alt+1~9` 随意切换；`Ctrl+Alt+0` 切回上次账号；仪表盘实时查看各账号额度与「可撑天数」

> 切换有后悔药：任何一次切换后都可以「回滚」到切换前的登录态；登录历史面板完整记录每次变化。

### CLI

```bash
node core/cli.js status              # 当前账号与 ZCode 状态
node core/cli.js list                # 账号快照列表
node core/cli.js capture [名称]       # 保存当前登录态
node core/cli.js use <id|名称>        # 切换（默认完整重启，--no-restart 跳过重启）
node core/cli.js quota [current|all|<id>]  # 查询额度
node core/cli.js rollback            # 回滚到上次切换前
```

## 原理

ZCode 客户端的登录态由两个文件承载（Windows）：

```
%USERPROFILE%\.zcode\v2\credentials.json   # OAuth token（enc:v1 加密）、zcodejwttoken 等
%USERPROFILE%\.zcode\v2\config.json        # 各 provider 的 apiKey（JWT，明文）
```

**完整切换** = 关闭 ZCode → 备份当前两份文件 → 原子替换为目标账号快照 → 重启 ZCode（运行中修改会被客户端退出时回写覆盖，工具自动处理）。

**热切换** = 杀掉 ZCode 的 agent 会话进程（启动时读取登录态）→ 原子替换两份文件 → 客户端按需重新拉起会话进程即载入新账号（主窗口不关闭；已逆向客户端进程模型确认可行性）。

**额度查询**：用 `zcodejwttoken` 请求 `https://zcode.z.ai/api/v1/zcode-plan/billing/current` 与 `/billing/balance`。注意 balance 接口校验完整客户端身份头（`User-Agent: ZCode/<版本>`、`X-ZCode-App-Version`、`X-Platform`、**`X-Device-Mid`**（取自 `~/.zcode/v2/telemetry-state.json`）等），缺头会返回 400 `parameter error`——本工具在 `core/quota.js` 中复刻了该头集合。`enc:v1` 字段为 aes-256-gcm，密钥由本机用户信息派生，快照因此**仅限本机使用**。

## 开发

```bash
npm install
npm test                 # core 单元测试（node:test）
npm run build:renderer   # 构建前端
npm run dev:electron     # 启动桌面应用（开发）
npm run build            # 打包 NSIS 安装包到 release/
npm run release 0.7.1    # 发版一条龙（版本号→提交→tag→推送→盯 CI）
node scripts/gen-icon.js # 重新生成应用图标
```

技术栈：Electron + React + Vite；核心逻辑零依赖（Node ≥ 18 内置模块），与界面解耦，测试覆盖（node:test）。

## 开源说明

- **许可证**：MIT
- **致谢**：设计思路参考了 [WorkDaddy](https://github.com/babygoton/WorkDaddy)、[zcode-account-switcher](https://github.com/smartlizi/zcode-account-switcher)、[ZCodex-Manager](https://github.com/LuckerYan/ZCodex-Manager)、[workbuddy-switch](https://github.com/changexbc/workbuddy-switch) 等优秀项目，感谢社区分享
- **免责声明**：本项目与 ZCode / 智谱官方无任何隶属关系，仅供个人学习与效率工具使用，请遵守对应服务条款；使用本项目产生的任何后果由使用者自行承担
- **隐私**：所有数据（账号快照、设置、历史）仅保存在本机，不上传任何服务器；`accounts/` 已被 `.gitignore` 排除，请勿将快照文件提交或分享给他人

## Roadmap

- [x] 热切换（不关闭 ZCode 主窗口）
- [x] 浏览器 OAuth 直接添加新账号
- [x] 应用内自动更新
- [ ] macOS / Linux 支持
- [ ] 快照静态加密（主密码）

## Star History

如果这个工具对你有帮助，欢迎点个 Star ⭐

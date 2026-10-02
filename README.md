# ⚡ ZCode Buddy

<div align="center">

**ZCode（智谱 GLM Coding / Start Plan 客户端）多账号快捷切换与额度管理桌面工具**

切换免扫码 · 额度实时看板 · 低额度自动提醒 · 账号加密备份

`Windows` `Electron` `MIT License`

</div>

---

## 功能

### 账号管理
- **一键切换**：保存 ZCode 登录态快照后随时切换账号，自动完成「关闭 ZCode → 备份当前登录态 → 原子替换 → 重启 ZCode」，全程免扫码重新登录
- **安全机制**：切换前自动备份（`.last/`），一键回滚；写入失败自动恢复；原子写入防止登录态损坏
- **账号健康**：Token 有效/过期徽标，过期账号集中提示
- **加密备份**：一键导出/导入 `.zbak` 备份文件（AES-256-GCM + PBKDF2），支持跨机器迁移

### 额度看板
- **实时查询**：直连 ZCode billing 接口获取套餐等级、到期时间、每模型发放量与已用量（自动复刻客户端完整身份头）
- **仪表盘**：当前账号环形额度表、今日消耗、分模型额度条、全部账号汇总统计
- **趋势图**：每次查询自动记录历史，账号卡片内嵌剩余量 sparkline
- **低额度提醒**：按可配置间隔自动轮询（默认 5 分钟），剩余低于阈值时 Windows 通知，点击通知直接切换到额度最多的账号；托盘菜单实时显示各账号剩余百分比

### 其他
- 深色 / 浅色双主题
- 开机自启动
- 系统托盘常驻（关闭窗口 = 最小化到托盘）
- 零依赖 Node 核心，可独立 CLI 使用

## 安装

从 [Releases](../../releases) 下载 `ZCode Buddy Setup x.x.x.exe` 安装，或使用绿色版。

要求：本机已安装并登录 [ZCode 客户端](https://zcode.z.ai)（Windows）。

## 使用

1. 在 ZCode 里登录账号 A → 打开本工具 → **账号管理 → 保存当前账号**
2. 在 ZCode 里切换/登录账号 B → 再点 **保存当前账号**
3. 完成后即可在卡片或托盘菜单**一键切换**，仪表盘实时查看各账号额度

> 切换有后悔药：任何一次切换后都可以「回滚」到切换前的登录态。

### CLI

```bash
node core/cli.js status              # 当前账号与 ZCode 状态
node core/cli.js list                # 账号快照列表
node core/cli.js capture [名称]       # 保存当前登录态
node core/cli.js use <id|名称>        # 切换（自动关闭并重启 ZCode）
node core/cli.js quota [current|all|<id>]  # 查询额度
node core/cli.js rollback            # 回滚到上次切换前
```

## 原理

ZCode 客户端的登录态由两个文件承载（Windows）：

```
%USERPROFILE%\.zcode\v2\credentials.json   # OAuth token（enc:v1 加密）、zcodejwttoken 等
%USERPROFILE%\.zcode\v2\config.json        # 各 provider 的 apiKey（JWT，明文）
```

**切换 = 关闭 ZCode → 备份当前两份文件 → 原子替换为目标账号快照 → 重启 ZCode。**
ZCode 运行中修改这两份文件会被客户端退出时回写覆盖，因此切换前必须先关闭它（工具自动处理）。

**额度查询**：用 `zcodejwttoken` 请求 `https://zcode.z.ai/api/v1/zcode-plan/billing/current` 与 `/billing/balance`。注意 balance 接口校验完整客户端身份头（`User-Agent: ZCode/<版本>`、`X-ZCode-App-Version`、`X-Platform`、**`X-Device-Mid`**（取自 `~/.zcode/v2/telemetry-state.json`）等），缺头会返回 400 `parameter error`——本工具在 `core/quota.js` 中复刻了该头集合。`enc:v1` 字段为 aes-256-gcm，密钥由本机用户信息派生，快照因此**仅限本机使用**。

## 开发

```bash
npm install
npm run build:renderer   # 构建前端
npm run dev:electron     # 启动桌面应用（开发）
npm run build            # 打包 NSIS 安装包到 release/
node scripts/gen-icon.js # 重新生成应用图标
```

技术栈：Electron + React + Vite；核心逻辑零依赖（Node ≥ 18 内置模块），与界面解耦。

## 开源说明

- **许可证**：MIT
- **致谢**：设计思路参考了 [WorkDaddy](https://github.com/babygoton/WorkDaddy)、[zcode-account-switcher](https://github.com/smartlizi/zcode-account-switcher)、[ZCodex-Manager](https://github.com/LuckerYan/ZCodex-Manager)、[workbuddy-switch](https://github.com/changexbc/workbuddy-switch) 等优秀项目，感谢社区分享
- **免责声明**：本项目与 ZCode / 智谱官方无任何隶属关系，仅供个人学习与效率工具使用，请遵守对应服务条款；使用本项目产生的任何后果由使用者自行承担
- **隐私**：所有数据（账号快照、设置、历史）仅保存在本机，不上传任何服务器；`accounts/` 已被 `.gitignore` 排除，请勿将快照文件提交或分享给他人

## Roadmap

- [ ] 浏览器 OAuth 直接添加新账号（免手动切换登录）
- [ ] 热切换（不关闭 ZCode 主窗口，仅重启 agent 子进程）
- [ ] 跨账号会话迁移
- [ ] macOS / Linux 支持

## Star History

如果这个工具对你有帮助，欢迎点个 Star ⭐

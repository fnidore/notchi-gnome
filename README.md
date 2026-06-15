# Notchi 顶栏宠物（GNOME 42）

在 GNOME 顶栏养一只**像素小宠物**，实时反应 **Claude Code** 的干活状态。
灵感来自 macOS 的 [notchi](https://github.com/sk-ruban/notchi)（刘海宠物），移植到无刘海的 Ubuntu 顶栏。

## 效果

顶栏出现一只像素角色，随 Claude Code 事件切换状态：

| Claude Code Hook | 状态 | 含义 |
|---|---|---|
| `UserPromptSubmit` | thinking 🤔 | 思考中（接到活） |
| `PreToolUse` / `PostToolUse` / `SubagentStop` | working 💪 | 干活中（忙碌时有脉冲呼吸动画） |
| `Notification` | attention ❓ | 求关注（要权限 / idle） |
| `Stop` | done 🎉 → idle | 完成（3 秒后回待机） |
| `PreCompact` | thinking 🤔 | 压缩上下文 |
| 空闲 | idle 😴 | 待机 |

点击宠物展开面板：**会话区**（每个会话的角色 / 状态 / 时长 / 最近事件）+ **用量区**（live 5h/7d 配额）+ 立即刷新 / 重置 / 设置。

## 像素角色（claude.ai/design 出品）

内置 **5 个原创像素角色**，每个 6 个状态 + 一个扩展 Logo，全部 `viewBox 0 0 128 128`、`crispEdges` 像素渲染、带描边（深/浅顶栏都清晰）：

| id | 名字 | 风格 |
|---|---|---|
| `slime` | 💧 史莱姆 | 果冻高光大眼（Logo 主视觉） |
| `linedog` | 🐶 豆豆 | 极简黑线白身、豆豆眼、招牌微笑 |
| `shoujo` | 👧 可可 | 暖棕发 + 红蝴蝶结 |
| `loli` | 🎀 桃桃 | 粉色双马尾、超大眼 |
| `shiro` | ❄️ 小雪 | 银白长发、冷蓝眼 |

设置里「外观 → 角色」可选：**随机**（默认，每个会话分到不同角色，多会话最热闹）/ 固定某角色。
下拉每个选项直接显示该角色的像素头像 + 名字。
图标位于 `src/icons/mascots/<角色>/<状态>.svg`，design 出新图按此结构覆盖即可。

> 备注：仍内置纯 emoji 兜底——任一角色图标文件缺失时自动降级显示 emoji，保证不空窗。

## 架构

```
Claude Code 事件 → hooks(settings.json) → notchi-send.py → unix socket → GNOME 扩展(Gio.SocketService) → 顶栏宠物
```

- socket 默认在 `~/.cache/notchi/notchi.sock`（家目录共享挂载，宿主 + Docker 二号账号两个 Claude Code 都能推事件）。
- 可用环境变量 `NOTCHI_SOCK` 覆盖（扩展与发送器需一致）。
- 发送器**绝不阻塞 Claude Code**：socket 不在就静默退出 0。

## 安装

所有操作走 `make`（`make help` 看全部目标）。**注意：扩展运行在宿主机，不能在容器里启用。**

### 推荐：一条龙（含 Claude hooks 自动配置）

```bash
make install          # 装扩展+发送器+图标，并安全合并 hooks 进 ~/.claude/settings.json（带备份、幂等）
# 重载 GNOME Shell：Xorg 按 Alt+F2 → r → 回车；Wayland 注销重登
make enable           # 启用扩展
make prefs            # （可选）打开设置界面选角色 / 配音效
```

新开一个 Claude Code 会话发条消息，顶栏宠物就会动起来。

### 标准打包：官方 `.shell-extension.zip`

适合分发或提交 [extensions.gnome.org](https://extensions.gnome.org)：

```bash
make pack             # 用 gnome-extensions pack 生成 notchi@fnidore.top.shell-extension.zip
make install-zip      # = pack + gnome-extensions install --force（注意：不会自动配置 hooks）
```

> 官方 zip 路径只装扩展本体，**不合并 Claude hooks**；要事件驱动仍需 `make install` 或手动加 hooks。

### 校验 / 卸载

```bash
make lint             # JS 语法 + gschema 编译校验（容器内即可跑，无需 GNOME）
make uninstall        # 删扩展 + 从 settings.json 摘掉 notchi hooks（带备份）
make clean            # 清理构建产物
```

## 功能（已对齐 notchi）

- [x] 事件驱动宠物状态（思考 / 干活 / 求关注 / 完成 / 待机）
- [x] **像素角色美术**：5 个原创角色 × 6 状态 + Logo（claude.ai/design），设置可切换或回退 emoji
- [x] **真·脉冲动画**（Clutter，忙碌时缩放呼吸）
- [x] **情绪分析**（`notchi-send.py` 本地关键词，emoji 模式下思考态变脸 😊/😰/😕/🤔，prompt 不外发）
- [x] **多会话多宠物**（按 `session_id` 分配角色，顶栏显示 `角色 +N`）
- [x] **展开面板**：会话区（角色/状态/时长/最近事件）+ 用量区（**live 5h/7d 配额**）
- [x] **账号自动发现**：扫描 `~/.claude`、`~/.claude-*`，自动列出账号并读 `displayName` 当名字；设置里可逐个勾选显示/隐藏、改显示名
- [x] **可自定义音效**（设置面板：关 / 总是 / 终端聚焦时静音）
- [x] **设置界面**（GTK4/Adw，`make prefs`）

### 用量配额怎么来的
`notchi-usage.py` 自动发现账号目录，读各 `.credentials.json` 里的 OAuth token，调
`GET https://api.anthropic.com/api/oauth/usage` 实时拉取（token 仅本地用、不外传第三方），
账号名取配置 `oauthAccount.displayName`。token 过期/401 时降级读 `abtop-rate-limits.json`（标 `(旧)`）。
`--list` 模式仅列账号不调 API，供设置界面用。

## 文件

| 路径 | 作用 |
|---|---|
| `src/metadata.json` | 扩展元数据（GNOME 42） |
| `src/extension.js` | 主逻辑：socket 服务 + 顶栏宠物状态机 + 角色图标渲染 |
| `src/prefs.js` | 设置界面（GTK4/Adw） |
| `src/schemas/*.gschema.xml` | 设置项定义（角色 / 音效 / 用量 等） |
| `src/icons/` | Logo + 5 角色 × 6 状态像素 SVG + 账号头像/待机图 |
| `src/stylesheet.css` | 样式 |
| `bin/notchi-send.py` | hook → socket 发送器（含本地情绪分析） |
| `bin/notchi-usage.py` | live 用量拉取（独立进程） |
| `Makefile` | 标准构建/安装/打包入口 |
| `install.sh` / `uninstall.sh` | 安装 / 卸载底层脚本（含 settings.json 安全合并） |
| `docs/DESIGN_SPEC.md` | 给设计师的美术交付规格（一轮基础） |
| `docs/DESIGN_SPEC_V2.md` | 美术二轮需求（状态区分度重做 / 像素账号头像 / 可优化点清单） |

## 后续（留待以后）

- [x] **状态区分度重做**（二轮）：6 状态叠加 姿态 + 状态色光晕 + 大点缀，小尺寸一眼可辨
- [x] **像素账号头像** `src/icons/account.svg`（+ `account-stale.svg` 过期态）替换用量区 emoji `👤`
- [x] **无会话待机** `src/icons/idle-empty.svg`（像素睡月）替换顶栏 emoji `😴`
- [x] thinking 情绪变体精灵（`thinking-happy/anxious/confused.svg`，5×3=15 个）：思考态按 prompt 情绪自动切换，缺则降级回 `thinking.svg`
- [ ] 提交 extensions.gnome.org
- [ ] Codex 支持
- [ ] 端点 401 时的完整 OAuth 刷新流程

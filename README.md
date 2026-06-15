# Notchi 顶栏宠物（GNOME 42）

在 GNOME 顶栏养一只 emoji 小宠物，实时反应 **Claude Code** 的干活状态。
灵感来自 macOS 的 [notchi](https://github.com/sk-ruban/notchi)（刘海宠物），移植到无刘海的 Ubuntu 顶栏。

## 效果

顶栏出现一只 emoji，随 Claude Code 事件切换：

| Claude Code Hook | 宠物 | 含义 |
|---|---|---|
| `UserPromptSubmit` | 🤔 | 思考中（接到活） |
| `PreToolUse` / `PostToolUse` / `SubagentStop` | 💪 | 干活中 |
| `Notification` | ❓ | 求关注（要权限 / idle） |
| `Stop` | 🎉 → 😴 | 完成（3 秒后回待机） |
| `PreCompact` | 🤔 | 压缩上下文 |
| 空闲 | 😴 | 待机 |

点击宠物可看「当前状态 / 最近事件」，并有「重置为待机」菜单。

## 架构

```
Claude Code 事件 → hooks(settings.json) → notchi-send.py → unix socket → GNOME 扩展(Gio.SocketService) → 顶栏宠物
```

- socket 默认在 `~/.cache/notchi/notchi.sock`（家目录共享挂载，宿主 + Docker 二号账号两个 Claude Code 都能推事件）。
- 可用环境变量 `NOTCHI_SOCK` 覆盖（扩展与发送器需一致）。
- 发送器**绝不阻塞 Claude Code**：socket 不在就静默退出 0。

## 安装

```bash
bash install.sh        # 装扩展 + 发送器，并安全合并 hooks 进 ~/.claude/settings.json（带备份、幂等）
```

然后在**宿主机**上：

```bash
# 重载 GNOME Shell：Xorg 按 Alt+F2 → r → 回车；Wayland 注销重登
gnome-extensions enable notchi@fnidore.top
```

新开一个 Claude Code 会话发条消息，顶栏宠物就会动起来。

## 卸载

```bash
bash uninstall.sh      # 删扩展 + 从 settings.json 摘掉 notchi hooks（带备份）
```

## 文件

| 文件 | 作用 |
|---|---|
| `src/metadata.json` | 扩展元数据（GNOME 42） |
| `src/extension.js` | 主逻辑：socket 服务 + 顶栏宠物状态机 |
| `src/stylesheet.css` | 样式 |
| `bin/notchi-send.py` | hook → socket 发送器 |
| `install.sh` / `uninstall.sh` | 安装 / 卸载（含 settings.json 安全合并） |

## 功能（已对齐 notchi）

- [x] 事件驱动宠物状态（思考/干活/求关注/完成/待机）
- [x] **真·脉冲动画**（Clutter，忙碌时缩放呼吸）
- [x] **情绪分析**（`notchi-send.py` 本地关键词，思考态变脸 😊/😰/😕/🤔，prompt 不外发）
- [x] **多会话多宠物**（按 `session_id` 分配 🐱🐶🦊…，顶栏显示 `宠物+状态 +N`）
- [x] **展开面板**：会话区（宠物/状态/时长/最近事件）+ 用量区（**live 5h/7d 配额**）
- [x] **账号自动发现**：扫描 `~/.claude`、`~/.claude-*`，自动列出账号并读 `displayName` 当名字；
      设置里可逐个勾选显示/隐藏、可改显示名
- [x] **可自定义音效**（设置面板：关 / 总是 / 终端聚焦时静音）
- [x] **设置界面**（GTK4/Adw，`gnome-extensions prefs notchi@fnidore.top`）

### 用量配额怎么来的
`notchi-usage.py` 自动发现账号目录，读各 `.credentials.json` 里的 OAuth token，调
`GET https://api.anthropic.com/api/oauth/usage` 实时拉取（token 仅本地用、不外传第三方），
账号名取配置 `oauthAccount.displayName`。token 过期/401 时降级读 `abtop-rate-limits.json`（标 `(旧)`）。
`--list` 模式仅列账号不调 API，供设置界面用。

## 后续（留待以后）

- [ ] 像素精灵美术替代 emoji（图标用 claude design 单独设计）
- [ ] Codex 支持
- [ ] 端点 401 时的完整 OAuth 刷新流程

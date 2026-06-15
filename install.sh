#!/usr/bin/env bash
# Notchi 顶栏宠物 安装脚本
#   1) 把扩展装到 ~/.local/share/gnome-shell/extensions/notchi@fnidore.top
#   2) 把 hook 发送器一并放进扩展目录
#   3) 安全合并 Claude Code hooks 进 ~/.claude/settings.json（先备份、幂等）
set -euo pipefail

UUID="notchi@fnidore.top"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SETTINGS="${HOME}/.claude/settings.json"

echo "==> 安装扩展到 ${EXT_DIR}"
mkdir -p "${EXT_DIR}/schemas"
cp -f "${HERE}/src/metadata.json"   "${EXT_DIR}/"
cp -f "${HERE}/src/extension.js"    "${EXT_DIR}/"
cp -f "${HERE}/src/prefs.js"        "${EXT_DIR}/"
cp -f "${HERE}/src/stylesheet.css"  "${EXT_DIR}/"
cp -f "${HERE}/src/schemas/"*.gschema.xml "${EXT_DIR}/schemas/"
cp -f "${HERE}/bin/notchi-send.py"  "${EXT_DIR}/"
cp -f "${HERE}/bin/notchi-usage.py" "${EXT_DIR}/"
chmod +x "${EXT_DIR}/notchi-send.py" "${EXT_DIR}/notchi-usage.py"

echo "==> 编译 gsettings schema"
if command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas "${EXT_DIR}/schemas"
else
    echo "    !! 未找到 glib-compile-schemas，设置界面可能打不开（请装 glib2.0-dev / glib2-devel）"
fi

SENDER="${EXT_DIR}/notchi-send.py"
echo "==> hook 发送器：${SENDER}"

echo "==> 合并 Claude Code hooks 进 ${SETTINGS}（自动备份）"
SENDER="${SENDER}" SETTINGS="${SETTINGS}" python3 - <<'PY'
import json, os, shutil, time, sys

settings = os.environ["SETTINGS"]
sender   = os.environ["SENDER"]
cmd = f'python3 "{sender}"'

os.makedirs(os.path.dirname(settings), exist_ok=True)
data = {}
if os.path.exists(settings):
    with open(settings, "r", encoding="utf-8") as f:
        txt = f.read().strip()
    if txt:
        data = json.loads(txt)
    bak = f"{settings}.bak.{int(time.time())}"
    shutil.copy2(settings, bak)
    print(f"    备份 -> {bak}")

hooks = data.setdefault("hooks", {})

# 需要 matcher 的事件（工具相关），matcher="" 匹配全部
WITH_MATCHER  = ["PreToolUse", "PostToolUse"]
# 无需 matcher 的事件
NO_MATCHER    = ["UserPromptSubmit", "Notification", "Stop", "SubagentStop", "PreCompact"]

def already_has(entries):
    for e in entries:
        for h in e.get("hooks", []):
            if "notchi-send" in h.get("command", ""):
                return True
    return False

added = []
for evt in WITH_MATCHER:
    entries = hooks.setdefault(evt, [])
    if already_has(entries):
        continue
    entries.append({"matcher": "", "hooks": [{"type": "command", "command": cmd}]})
    added.append(evt)

for evt in NO_MATCHER:
    entries = hooks.setdefault(evt, [])
    if already_has(entries):
        continue
    entries.append({"hooks": [{"type": "command", "command": cmd}]})
    added.append(evt)

with open(settings, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")

if added:
    print(f"    已添加 hooks：{', '.join(added)}")
else:
    print("    hooks 已存在，跳过（幂等）")
PY

echo ""
echo "==> 完成！接下来在【宿主机】上手动操作（容器里没有 gnome-shell）："
echo "    1) 重载 GNOME Shell："
echo "       - Xorg 会话：按 Alt+F2，输入 r，回车"
echo "       - Wayland 会话：注销再登录"
echo "    2) 启用扩展："
echo "       gnome-extensions enable ${UUID}"
echo "    3) 新开一个 Claude Code 会话，发条消息，看顶栏宠物动起来 🐱"
echo ""
echo "    卸载：bash ${HERE}/uninstall.sh"

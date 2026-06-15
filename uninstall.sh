#!/usr/bin/env bash
# Notchi 顶栏宠物 卸载脚本：删扩展 + 摘掉 settings.json 里的 notchi hooks（带备份）
set -euo pipefail

UUID="notchi@fnidore.top"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SETTINGS="${HOME}/.claude/settings.json"

echo "==> 移除扩展目录 ${EXT_DIR}"
rm -rf "${EXT_DIR}"

if [ -f "${SETTINGS}" ]; then
    echo "==> 从 ${SETTINGS} 摘除 notchi hooks（自动备份）"
    SETTINGS="${SETTINGS}" python3 - <<'PY'
import json, os, shutil, time

settings = os.environ["SETTINGS"]
with open(settings, "r", encoding="utf-8") as f:
    txt = f.read().strip()
data = json.loads(txt) if txt else {}

bak = f"{settings}.bak.{int(time.time())}"
shutil.copy2(settings, bak)
print(f"    备份 -> {bak}")

hooks = data.get("hooks", {})
for evt in list(hooks.keys()):
    kept = []
    for e in hooks[evt]:
        e["hooks"] = [h for h in e.get("hooks", []) if "notchi-send" not in h.get("command", "")]
        if e["hooks"]:
            kept.append(e)
    if kept:
        hooks[evt] = kept
    else:
        del hooks[evt]
if not hooks:
    data.pop("hooks", None)

with open(settings, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("    已摘除 notchi hooks")
PY
fi

echo "==> 完成。重载 GNOME Shell（Alt+F2 → r，或注销重登）使扩展彻底消失。"

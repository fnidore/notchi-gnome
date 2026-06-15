#!/usr/bin/env bash
# 生成 README 用的像素拼图 PNG（深色圆角卡片底）。
# 依赖 ImageMagick（convert / montage）。输出到 assets/。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONS="$HERE/src/icons"
OUT="$HERE/assets"
BG="#1b1c25"        # 深色卡片底
TILE=120           # 单格渲染像素
GAP=18             # 格间距 / 外边距
R=22               # 圆角半径
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# SVG -> 透明 PNG（按 TILE 尺寸）
render() { convert -background none "$1" -resize "${TILE}x${TILE}" "$TMP/$2"; }

# 给拼图加圆角（四角透明，露出页面底色 = 浮起卡片感）
round() {
  convert "$1" \
    \( +clone -alpha extract \
       -draw "fill black polygon 0,0 0,$R $R,0 fill white circle $R,$R $R,0" \
       \( +clone -flip \) -compose Multiply -composite \
       \( +clone -flop \) -compose Multiply -composite \
    \) -alpha off -compose CopyOpacity -composite "$2"
}

# 拼一行：$1=输出名  其余=PNG 列表
strip() {
  local out="$1"; shift
  montage "$@" -tile "${#}x1" -geometry "+${GAP}+${GAP}" -background "$BG" "$TMP/_m.png"
  round "$TMP/_m.png" "$OUT/$out"
  echo "  -> assets/$out"
}

echo "==> 角色一览（done 态）"
for c in slime linedog shoujo loli shiro; do render "$ICONS/mascots/$c/done.svg" "ch_$c.png"; done
strip characters.png "$TMP/ch_slime.png" "$TMP/ch_linedog.png" "$TMP/ch_shoujo.png" "$TMP/ch_loli.png" "$TMP/ch_shiro.png"

echo "==> 6 状态（史莱姆）"
for s in idle thinking working attention done error; do render "$ICONS/mascots/slime/$s.svg" "st_$s.png"; done
strip states.png "$TMP/st_idle.png" "$TMP/st_thinking.png" "$TMP/st_working.png" "$TMP/st_attention.png" "$TMP/st_done.png" "$TMP/st_error.png"

echo "==> thinking 情绪变体（史莱姆）"
for v in happy anxious confused; do render "$ICONS/mascots/slime/thinking-$v.svg" "tk_$v.png"; done
strip thinking.png "$TMP/tk_happy.png" "$TMP/tk_anxious.png" "$TMP/tk_confused.png"

echo "==> 其它图标"
render "$ICONS/notchi-logo.svg"   ic_logo.png
render "$ICONS/idle-empty.svg"    ic_idle.png
render "$ICONS/account.svg"       ic_acct.png
render "$ICONS/account-stale.svg" ic_accts.png
strip icons.png "$TMP/ic_logo.png" "$TMP/ic_idle.png" "$TMP/ic_acct.png" "$TMP/ic_accts.png"

echo "==> 顶部 hero logo（桃桃 done 态，透明底）"
convert -background none "$ICONS/mascots/loli/done.svg" -resize 128x128 "$OUT/logo.png"
echo "  -> assets/logo.png"

echo "✅ 完成 -> $OUT"

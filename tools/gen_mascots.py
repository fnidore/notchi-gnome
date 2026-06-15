#!/usr/bin/env python3
"""Notchi 吉祥物 SVG 生成器。

参数化拼装：每个家族 = 身体(body) + 调色板 + 各状态表情(face)。
生成 src/icons/mascots/<family>/<state>.svg，状态：
  idle 待机 / thinking 思考 / working 干活 / attention 求关注 / done 完成 / error 出错
"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "icons", "mascots")
STATES = ["idle", "thinking", "working", "attention", "done", "error"]
W = H = 128

# ---------- 通用表情零件（返回 svg 片段，坐标基于脸中心 cx,cy）----------
def eyes_open(cx_l, cx_r, cy, dark, r=8):
    return (f'<circle cx="{cx_l}" cy="{cy}" r="{r}" fill="{dark}"/>'
            f'<circle cx="{cx_r}" cy="{cy}" r="{r}" fill="{dark}"/>'
            # 高光
            f'<circle cx="{cx_l-2}" cy="{cy-2}" r="2.4" fill="#fff"/>'
            f'<circle cx="{cx_r-2}" cy="{cy-2}" r="2.4" fill="#fff"/>')

def eyes_closed_happy(cx_l, cx_r, cy, dark):
    # ^ ^ 形（开心眯眼）
    return (f'<path d="M{cx_l-8} {cy+2} Q{cx_l} {cy-7} {cx_l+8} {cy+2}" stroke="{dark}" stroke-width="4" fill="none" stroke-linecap="round"/>'
            f'<path d="M{cx_r-8} {cy+2} Q{cx_r} {cy-7} {cx_r+8} {cy+2}" stroke="{dark}" stroke-width="4" fill="none" stroke-linecap="round"/>')

def eyes_sleepy(cx_l, cx_r, cy, dark):
    # 闭眼横线
    return (f'<path d="M{cx_l-8} {cy} h16" stroke="{dark}" stroke-width="4" fill="none" stroke-linecap="round"/>'
            f'<path d="M{cx_r-8} {cy} h16" stroke="{dark}" stroke-width="4" fill="none" stroke-linecap="round"/>')

def eyes_x(cx_l, cx_r, cy, dark):
    # x x 晕
    def x(cx):
        return (f'<path d="M{cx-6} {cy-6} l12 12 M{cx+6} {cy-6} l-12 12" '
                f'stroke="{dark}" stroke-width="4" stroke-linecap="round"/>')
    return x(cx_l) + x(cx_r)

def eyes_up(cx_l, cx_r, cy, dark, r=8):
    # 眼珠朝上看（思考）
    return (f'<circle cx="{cx_l}" cy="{cy}" r="{r}" fill="#fff" stroke="{dark}" stroke-width="2"/>'
            f'<circle cx="{cx_r}" cy="{cy}" r="{r}" fill="#fff" stroke="{dark}" stroke-width="2"/>'
            f'<circle cx="{cx_l}" cy="{cy-3}" r="3.5" fill="{dark}"/>'
            f'<circle cx="{cx_r}" cy="{cy-3}" r="3.5" fill="{dark}"/>')

def mouth_smile(cx, cy, dark, w=16):
    return f'<path d="M{cx-w} {cy} Q{cx} {cy+w} {cx+w} {cy}" stroke="{dark}" stroke-width="4" fill="none" stroke-linecap="round"/>'

def mouth_small(cx, cy, dark):
    return f'<path d="M{cx-5} {cy} h10" stroke="{dark}" stroke-width="4" fill="none" stroke-linecap="round"/>'

def mouth_open(cx, cy, dark):
    return f'<ellipse cx="{cx}" cy="{cy+2}" rx="7" ry="9" fill="{dark}"/>'

def mouth_wavy(cx, cy, dark):
    return f'<path d="M{cx-12} {cy} q4 -6 8 0 t8 0 t8 0" stroke="{dark}" stroke-width="3.5" fill="none" stroke-linecap="round"/>'

# 装饰全用路径图形（不用 <text>，避免字体依赖、IM 也能渲染）
_ZB = "#3f72c4"   # 蓝

def _z(x, y, s, c):
    # 一个「Z」字形：上横、对角、下横
    return (f'<path d="M{x-s} {y-s} h{2*s} l{-2*s} {2*s} h{2*s}" '
            f'stroke="{c}" stroke-width="{max(2,s*0.6):.1f}" fill="none" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')

def deco_zzz(x, y, c=_ZB):
    # 两个大小不一的 Z 向右上飘
    return _z(x, y, 5, c) + _z(x + 12, y - 13, 3.5, c)

def deco_dots(x, y, c="#2a9d8f"):
    # 思考气泡的三个小圆点（越往右上越大）
    return (f'<circle cx="{x}" cy="{y}" r="2.4" fill="{c}"/>'
            f'<circle cx="{x+7}" cy="{y-6}" r="3.2" fill="{c}"/>'
            f'<circle cx="{x+16}" cy="{y-13}" r="4.2" fill="{c}"/>')

def deco_bang(x, y, c="#e8533f"):
    # 感叹号：圆角竖条 + 圆点
    return (f'<rect x="{x-2.5}" y="{y-20}" width="5" height="14" rx="2.5" fill="{c}"/>'
            f'<circle cx="{x}" cy="{y-1}" r="3" fill="{c}"/>')

def deco_spark(x, y, c):
    return (f'<path d="M{x} {y-7} l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" fill="{c}"/>')

def deco_sweat(x, y, c="#4aa3df"):
    return f'<path d="M{x} {y} q-4 7 0 10 q4 -3 0 -10 z" fill="{c}"/>'


# ---------- 家族定义 ----------
def family_blob(palette):
    body = palette["body"]
    edge = palette["edge"]
    # 圆滚滚团子身体
    return (f'<path d="M64 20 C94 20 110 42 110 70 C110 100 89 114 64 114 '
            f'C39 114 18 100 18 70 C18 42 34 20 64 20 Z" fill="{body}" stroke="{edge}" stroke-width="3"/>'
            # 腮红
            f'<ellipse cx="40" cy="80" rx="7" ry="4.5" fill="{palette["blush"]}" opacity="0.7"/>'
            f'<ellipse cx="88" cy="80" rx="7" ry="4.5" fill="{palette["blush"]}" opacity="0.7"/>')


FAMILIES = {
    "blob": {
        "body": family_blob,
        "palette": {"body": "#f2b65a", "edge": "#d98a2b", "blush": "#f08a6e", "dark": "#3a2a14"},
        "face": (48, 80, 64),  # 左眼x, 右眼x, 眼y
        "mouth_y": 88,
    },
}


def build_face(fam, state):
    cl, cr, cy = fam["face"]
    dark = fam["palette"]["dark"]
    my = fam["mouth_y"]
    mx = 64
    p = ""
    if state == "idle":
        p += eyes_sleepy(cl, cr, cy, dark) + mouth_small(mx, my, dark) + deco_zzz(95, 40)
    elif state == "thinking":
        p += eyes_up(cl, cr, cy, dark) + mouth_small(mx, my, dark) + deco_dots(96, 50)
    elif state == "working":
        p += eyes_open(cl, cr, cy, dark) + mouth_smile(mx, my, dark, 12) + deco_spark(102, 36, "#ffd23f")
    elif state == "attention":
        p += eyes_open(cl, cr, cy, dark, 9) + mouth_open(mx, my, dark) + deco_bang(97, 48)
    elif state == "done":
        p += eyes_closed_happy(cl, cr, cy, dark) + mouth_smile(mx, my, dark, 18)
        p += deco_spark(28, 34, "#ffd23f") + deco_spark(100, 32, "#4aa3df") + deco_spark(104, 70, "#7ed957")
    elif state == "error":
        p += eyes_x(cl, cr, cy, dark) + mouth_wavy(mx, my+2, dark) + deco_sweat(96, 50)
    return p


def svg_doc(inner):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'{inner}</svg>\n')


def main():
    for fname, fam in FAMILIES.items():
        d = os.path.join(OUT, fname)
        os.makedirs(d, exist_ok=True)
        body = fam["body"](fam["palette"])
        for st in STATES:
            inner = body + build_face(fam, st)
            with open(os.path.join(d, f"{st}.svg"), "w", encoding="utf-8") as f:
                f.write(svg_doc(inner))
        print(f"  {fname}: 生成 {len(STATES)} 个状态 -> {d}")


if __name__ == "__main__":
    main()

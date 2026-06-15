#!/usr/bin/env python3
"""Notchi hook 发送器。

Claude Code 触发 hook 时，把事件 JSON 从 stdin 喂给本脚本；本脚本压成一行
转发到 notchi 的 unix socket。设计原则：无论如何都快速 exit 0，绝不阻塞 Claude Code
（socket 不存在 / notchi 没开 → 静默忽略）。

附加：UserPromptSubmit 时本地（关键词）分析 prompt 情绪，加 notchi_mood 字段，
让宠物喜怒哀乐。纯本地判断，prompt 不外发。
"""
import json
import os
import socket
import sys

# 关键词 → 情绪。命中优先级：anxious > happy > confused > neutral
_ANXIOUS = ("报错", "错误", "失败", "崩", "卡死", "死机", "不行", "无效", "异常", "坏了",
            "error", "fail", "bug", "broken", "crash", "exception", "wrong", "stuck")
_HAPPY = ("谢谢", "感谢", "赞", "完美", "牛", "厉害", "太好了", "可以", "成功", "搞定",
          "thanks", "thank you", "nice", "great", "perfect", "awesome", "cool", "works")
_CONFUSED = ("怎么", "为什么", "为啥", "啥意思", "不懂", "不明白", "如何",
             "how", "why", "what", "which", "confus")


def classify_mood(prompt):
    if not prompt:
        return "neutral"
    p = prompt.lower()
    if any(k in p for k in _ANXIOUS):
        return "anxious"
    if any(k in p for k in _HAPPY):
        return "happy"
    # 多个问号或疑问词 → 困惑
    if p.count("?") + p.count("？") >= 2 or any(k in p for k in _CONFUSED):
        return "confused"
    return "neutral"


def sock_path():
    p = os.environ.get("NOTCHI_SOCK")
    if p:
        return p
    home = os.path.expanduser("~")
    return os.path.join(home, ".cache", "notchi", "notchi.sock")


def main():
    raw = sys.stdin.buffer.read()
    # 压成单行 JSON（扩展端按行读取），并在 UserPromptSubmit 上附加 mood
    try:
        obj = json.loads(raw.decode("utf-8", "replace"))
        if obj.get("hook_event_name") == "UserPromptSubmit":
            obj["notchi_mood"] = classify_mood(obj.get("prompt", ""))
        line = json.dumps(obj, ensure_ascii=False)
    except Exception:
        line = raw.decode("utf-8", "replace").replace("\n", " ").strip()

    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.3)
        s.connect(sock_path())
        s.sendall((line + "\n").encode("utf-8"))
        s.close()
    except Exception:
        pass  # notchi 没开 / socket 不在 → 不影响 Claude Code

    sys.exit(0)


if __name__ == "__main__":
    main()

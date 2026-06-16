#!/usr/bin/env python3
"""Notchi 用量拉取器（独立进程，供扩展/设置界面调用）。

自动发现 Claude Code 账号：扫描 ~/.claude 及 ~/.claude-* 目录中含 .credentials.json 的，
按 inode 去重（软链共享只算一次）。每个账号的显示名取配置里的 oauthAccount.displayName。

用法：
  notchi-usage.py --list            仅列出账号 [{id,name}]，不调 API（给设置界面用，快）
  notchi-usage.py [id ...]          拉用量；额外的 id 参数表示「隐藏」这些账号（跳过不拉）

为每个账号读 OAuth token 调 Anthropic 用量端点拿实时配额；token 过期/401/出错则降级读
同目录 abtop-rate-limits.json（标 stale）。强超时、任何异常都输出 {"accounts":[]}，绝不卡死。
token 只在本进程内存里用于请求头，不打印、不落盘。

stdout: {"accounts":[{"id","name","five_hour_pct","seven_day_pct","resets_at","stale"}, ...]}
"""
import datetime
import glob
import json
import os
import ssl
import sys
import time
import urllib.request

USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
TIMEOUT = 8
HOME = os.path.expanduser("~")


def _round(v):
    try:
        return round(float(v))
    except Exception:
        return None


def _unix_to_iso(ts):
    """abtop 降级文件里的 resets_at 是 unix 秒整数，归一化成带时区(UTC) ISO 字符串，
    与 live API 返回格式一致，扩展端 fmtRemaining 才能解析。"""
    if not ts:
        return None
    try:
        return datetime.datetime.fromtimestamp(
            int(ts), tz=datetime.timezone.utc).isoformat()
    except Exception:
        return None


def resolve_name(config_dir):
    """从账号配置读人类可读名字：oauthAccount.displayName / emailAddress，取不到用目录名。"""
    candidates = [os.path.join(config_dir, ".claude.json")]
    # 默认账号（~/.claude）的配置在家目录的 ~/.claude.json
    if os.path.abspath(config_dir) == os.path.join(HOME, ".claude"):
        candidates.append(os.path.join(HOME, ".claude.json"))
    for c in candidates:
        try:
            with open(c, "r", encoding="utf-8") as f:
                oa = (json.load(f).get("oauthAccount") or {})
            nm = oa.get("displayName") or oa.get("emailAddress")
            if nm:
                return nm
        except Exception:
            pass
    base = os.path.basename(config_dir.rstrip("/")) or config_dir
    return base


def discover_accounts():
    """返回 [{'id','dir','name'}]，按 inode 去重。id 用目录绝对路径（稳定）。"""
    cands = [os.path.join(HOME, ".claude")]
    for d in sorted(glob.glob(os.path.join(HOME, ".claude-*"))):
        cands.append(d)
    seen = set()
    out = []
    for d in cands:
        if not os.path.isdir(d):
            continue
        cred = os.path.join(d, ".credentials.json")
        if not os.path.isfile(cred):
            continue
        try:
            st = os.stat(cred)
            key = (st.st_dev, st.st_ino)
            if key in seen:
                continue
            seen.add(key)
        except OSError:
            pass
        ad = os.path.abspath(d)
        out.append({"id": ad, "dir": ad, "name": resolve_name(ad)})
    return out


def fetch_live(token):
    req = urllib.request.Request(USAGE_URL, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "notchi-gnome/0.3",
    })
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
        data = json.load(r)
    fh = data.get("five_hour") or {}
    sd = data.get("seven_day") or {}
    return (_round(fh.get("utilization")), _round(sd.get("utilization")),
            fh.get("resets_at"), sd.get("resets_at"))


def fallback_abtop(config_dir):
    p = os.path.join(config_dir, "abtop-rate-limits.json")
    with open(p, "r", encoding="utf-8") as f:
        d = json.load(f)
    fh = d.get("five_hour") or {}
    sd = d.get("seven_day") or {}
    return (_round(fh.get("used_percentage")),
            _round(sd.get("used_percentage")),
            _unix_to_iso(fh.get("resets_at")), _unix_to_iso(sd.get("resets_at")),
            d.get("updated_at"))


def read_token(config_dir):
    p = os.path.join(config_dir, ".credentials.json")
    with open(p, "r", encoding="utf-8") as f:
        oauth = (json.load(f).get("claudeAiOauth") or {})
    token = oauth.get("accessToken")
    expires = oauth.get("expiresAt")
    expired = bool(expires) and (expires / 1000.0) <= time.time()
    return token, expired


def account_quota(acct):
    five = seven = five_reset = seven_reset = updated_at = None
    stale = False
    try:
        token, expired = read_token(acct["dir"])
        if token and not expired:
            five, seven, five_reset, seven_reset = fetch_live(token)
        else:
            raise RuntimeError("no/expired token")
    except Exception:
        try:
            five, seven, five_reset, seven_reset, updated_at = fallback_abtop(acct["dir"])
            stale = True
        except Exception:
            return None
    if five is None and seven is None:
        return None
    return {
        "id": acct["id"], "name": acct["name"],
        "five_hour_pct": five, "seven_day_pct": seven,
        "five_hour_reset": five_reset, "seven_day_reset": seven_reset,
        "stale": stale, "updated_at": updated_at,
    }


def main():
    args = sys.argv[1:]
    if args and args[0] == "--list":
        accounts = [{"id": a["id"], "name": a["name"]} for a in discover_accounts()]
        json.dump({"accounts": accounts}, sys.stdout, ensure_ascii=False)
        return

    hidden = set(args)  # 要跳过（隐藏）的账号 id
    out = []
    for a in discover_accounts():
        if a["id"] in hidden:
            continue
        q = account_quota(a)
        if q:
            out.append(q)
    json.dump({"accounts": out}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stdout.write('{"accounts": []}')
    sys.exit(0)

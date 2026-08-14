"""studentbuddy 联网强化 Python 服务 — 常驻进程入口。

协议：stdio 逐行 JSON（每行一个请求/响应，UTF-8）。
请求：  {"id": 1, "method": "search", "params": {"query": "...", "engines": ["bing"]}}
        {"id": 2, "method": "fetch",  "params": {"url": "...", "use_js": true}}
        {"id": 3, "method": "ping"}
响应：  {"id": 1, "result": {...}}  或  {"id": 1, "error": "..."}

Node 侧由 src/core/search/python-bridge.ts 拉起并管理生命周期。
"""
from __future__ import annotations

import json
import sys
import traceback

from engines import search_all
from fetcher import fetch
from ssrf import check_url_safe


def _out(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _dispatch(req: dict) -> dict:
    method = req.get("method")
    params = req.get("params") or {}
    if method == "ping":
        return {"pong": True}
    if method == "search":
        query = (params.get("query") or "").strip()
        if not query:
            raise ValueError("query 不能为空")
        engines = params.get("engines") or None
        return search_all(query, engines)
    if method == "fetch":
        url = (params.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            raise ValueError(f"非法 URL: {url!r}")
        check_url_safe(url)  # SSRF 防护:拒绝内网/环回/保留地址
        return fetch(url, use_js=bool(params.get("use_js", True)))
    raise ValueError(f"未知方法: {method}")


def main() -> None:
    # Windows 下强制 UTF-8，避免 GBK 编码中文报错
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            rid = req.get("id")
            result = _dispatch(req)
            _out({"id": rid, "result": result})
        except Exception as e:  # noqa: BLE001
            _out({"id": req.get("id") if "req" in dir() else None, "error": f"{type(e).__name__}: {e}"})
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()

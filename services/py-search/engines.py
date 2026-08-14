"""多引擎网页搜索：Bing / DuckDuckGo Lite / 百度。

设计目标（强化联网稳定性）：
- 三引擎并发请求，谁先成功用谁，其余结果合并去重（按 URL）；
- 单个引擎失败不拖垮整体，全部失败才抛错；
- 支持代理（requests 自动读 http_proxy/https_proxy 环境变量）；
- 每个请求带超时 + 重试一次。

返回统一结构：{"results": [{"title","url","snippet"}], "source": "bing|duckduckgo|baidu"}
"""
from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

TIMEOUT = 8.0  # 单引擎请求超时（秒）
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 studentbuddy/0.1.0")

_lock = threading.Lock()


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
    return s


def _get(url: str, timeout: float = TIMEOUT) -> requests.Response:
    """GET 并带一次重试（网络瞬时错误自动重试）。"""
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            resp = _session().get(url, timeout=timeout)
            if resp.status_code == 200:
                return resp
            last_err = RuntimeError(f"HTTP {resp.status_code}")
        except Exception as e:  # noqa: BLE001 — 统一降级
            last_err = e
    raise last_err or RuntimeError("request failed")


def _dedupe(results: List[dict]) -> List[dict]:
    seen, out = set(), []
    for r in results:
        u = r.get("url", "")
        if u and u in seen:
            continue
        if u:
            seen.add(u)
        out.append(r)
    return out


def bing(query: str) -> dict:
    url = f"https://www.bing.com/search?q={requests.utils.quote(query)}&count=10&setlang=zh-hans"
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "html.parser")
    results: List[dict] = []
    for li in soup.select("li.b_algo"):
        a = li.select_one("h2 a")
        if not a:
            continue
        title = a.get_text(" ", strip=True)
        href = a.get("href", "")
        snip_el = li.select_one(".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4")
        snippet = snip_el.get_text(" ", strip=True) if snip_el else ""
        if title and href:
            results.append({"title": title, "url": href, "snippet": snippet})
    if not results:
        raise RuntimeError("Bing: no results parsed")
    return {"results": _dedupe(results)[:8], "source": "bing"}


def duckduckgo_lite(query: str) -> dict:
    url = f"https://lite.duckduckgo.com/lite/?q={requests.utils.quote(query)}"
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "html.parser")
    results: List[dict] = []
    for tr in soup.select("tr.result"):
        a = tr.select_one("a.result-link")
        if not a:
            continue
        title = a.get_text(" ", strip=True)
        href = a.get("href", "")
        snip_el = tr.select_one("td.result-snippet")
        snippet = snip_el.get_text(" ", strip=True) if snip_el else ""
        if title and href:
            results.append({"title": title, "url": href, "snippet": snippet})
    if not results:
        # 兜底：抓所有外链
        for a in soup.select("a[href^='http']")[:5]:
            href = a.get("href", "")
            if href and href not in [r["url"] for r in results]:
                results.append({"title": a.get_text(" ", strip=True) or href, "url": href, "snippet": ""})
    if not results:
        raise RuntimeError("DuckDuckGo Lite: no results parsed")
    return {"results": _dedupe(results)[:8], "source": "duckduckgo"}


def baidu(query: str) -> dict:
    url = f"https://www.baidu.com/s?wd={requests.utils.quote(query)}&rn=10"
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "html.parser")
    results: List[dict] = []
    for item in soup.select("div.result, div.c-container"):
        a = item.select_one("h3 a, h3.t a")
        if not a:
            continue
        title = a.get_text(" ", strip=True)
        href = a.get("href", "")
        snip_el = item.select_one(".c-abstract, .content-right_8Zs40, span.content-right_8Zs40")
        snippet = snip_el.get_text(" ", strip=True) if snip_el else ""
        if title and href:
            results.append({"title": title, "url": href, "snippet": snippet})
    if not results:
        raise RuntimeError("Baidu: no results parsed")
    return {"results": _dedupe(results)[:8], "source": "baidu"}


def _run_engine(fn, query: str) -> dict:
    try:
        return fn(query)
    except Exception as e:  # noqa: BLE001
        return {"error": f"{fn.__name__}: {e}"}


def search_all(query: str, engines: Optional[List[str]] = None) -> dict:
    """三引擎并发搜索，合并成功者结果（按出现顺序优先 bing > baidu > ddg）。"""
    registry = {
        "bing": bing,
        "baidu": baidu,
        "duckduckgo": duckduckgo_lite,
    }
    chosen = engines or ["bing", "baidu", "duckduckgo"]
    fns = [(name, registry[name]) for name in chosen if name in registry]
    merged: List[dict] = []
    source_used: List[str] = []
    with ThreadPoolExecutor(max_workers=len(fns)) as pool:
        futures = {pool.submit(_run_engine, fn, query): name for name, fn in fns}
        try:
            completed = as_completed(futures, timeout=TIMEOUT + 3)
            for fut in completed:
                name = futures[fut]
                try:
                    out = fut.result()
                except Exception:  # noqa: BLE001
                    continue
                if isinstance(out, dict) and "error" in out:
                    continue
                if isinstance(out, dict) and out.get("results"):
                    merged.extend(out["results"])
                    source_used.append(out.get("source", name))
        except TimeoutError:
            # 超时:已完成的引擎结果仍然有效,不整体丢弃;未完成的由 ThreadPoolExecutor
            # 在退出上下文时等待(单引擎自身有 8s 超时,最坏再多等几秒)
            for fut in futures:
                if fut.done():
                    name = futures[fut]
                    try:
                        out = fut.result()
                    except Exception:  # noqa: BLE001
                        continue
                    if isinstance(out, dict) and "error" in out:
                        continue
                    if isinstance(out, dict) and out.get("results"):
                        merged.extend(out["results"])
                        source_used.append(out.get("source", name))
    merged = _dedupe(merged)
    if not merged:
        raise RuntimeError("All search engines failed")
    return {"results": merged[:8], "source": "+".join(source_used) or "merged"}

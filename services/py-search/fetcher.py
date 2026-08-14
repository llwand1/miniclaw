"""网页抓取与正文提取。

强化点 vs 原 Node 实现：
- trafilatura 高质量正文提取（可用时），否则 BeautifulSoup 兜底；
- playwright 可选 JS 渲染（SPA 页面/反爬站点），未安装自动降级静态抓取；
- 代理支持（requests 自动读环境变量）；
- 超时 + 重试。
"""
from __future__ import annotations

import re
from typing import Optional

import requests
from bs4 import BeautifulSoup

from ssrf import check_url_safe

TIMEOUT = 10.0
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 studentbuddy/0.1.0")

try:  # 可选依赖：高质量正文提取
    import trafilatura  # type: ignore
    HAS_TRAFILATURA = True
except Exception:  # noqa: BLE001
    HAS_TRAFILATURA = False

try:  # 可选依赖：JS 渲染（需 python -m playwright install chromium）
    from playwright.sync_api import sync_playwright  # type: ignore
    HAS_PLAYWRIGHT = True
except Exception:  # noqa: BLE001
    HAS_PLAYWRIGHT = False

MAX_TEXT = 12000  # 提取正文上限（字符）


def _strip_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "noscript", "iframe"]):
        tag.decompose()
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()


def _extract(html: str, url: str) -> str:
    if HAS_TRAFILATURA:
        try:
            txt = trafilatura.extract(html, url=url, include_comments=False, include_tables=False)
            if txt and len(txt.strip()) > 50:
                return txt.strip()
        except Exception:  # noqa: BLE001
            pass
    return _strip_html(html)


def _static_fetch(url: str) -> tuple[str, str, str]:
    """静态抓取，返回 (html, title, text)。"""
    resp = requests.get(
        url,
        headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    html = resp.text
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.I)
    title = re.sub(r"\s+", " ", m.group(1)).strip() if m else url
    return html, title, _extract(html, url)


def _js_fetch(url: str) -> tuple[str, str, str]:
    """playwright 渲染抓取（SPA/反爬）。未安装时抛错由调用方降级。"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = None
        try:
            page = browser.new_page(user_agent=UA)
            page.goto(url, timeout=TIMEOUT * 1000, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)  # 等 SPA 首屏渲染
            html = page.content()
            title = page.title() or url
            return html, title.strip(), _extract(html, url)
        finally:
            # page 与 browser 都显式关闭,避免渲染进程/连接泄漏
            if page is not None:
                try:
                    page.close()
                except Exception:  # noqa: BLE001
                    pass
            browser.close()


def fetch(url: str, use_js: bool = True) -> dict:
    """抓取网页，返回 {"url","title","text"}。JS 渲染可用且启用时优先尝试，失败自动降级静态。"""
    check_url_safe(url)  # SSRF 防护:纵深防御,即使绕过 main 直接调用也被拦截
    last_err: Optional[Exception] = None
    if use_js and HAS_PLAYWRIGHT:
        try:
            html, title, text = _js_fetch(url)
            if text:
                return {"url": url, "title": title, "text": text[:MAX_TEXT]}
        except Exception as e:  # noqa: BLE001
            last_err = e
    try:
        html, title, text = _static_fetch(url)
        return {"url": url, "title": title, "text": text[:MAX_TEXT]}
    except Exception as e:  # noqa: BLE001
        if last_err:
            raise RuntimeError(f"fetch failed (js={last_err}, static={e})") from e
        raise

"""SSRF 防护：URL 目标地址黑名单检查。

防止 fetch 被引导去请求内网 / 环回 / 链路本地地址（含云元数据 169.254.169.254）。
检查两层：
1. hostname 字面量：localhost 及变体、裸 IP 是否落在私网/保留地址段；
2. DNS 解析：域名解析出的所有 IP 若命中内网段也拒绝（防 DNS 重绑定简化版）。

用法：入口处调用 `check_url_safe(url)`，不安全时抛 ValueError。
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

# 显式保留段兜底（ipaddress 内置属性之外再覆盖一次，含 CGNAT / benchmark）
_EXTRA_NETS = [
    ipaddress.ip_network("0.0.0.0/8"),      # "this" network
    ipaddress.ip_network("100.64.0.0/10"),  # CGNAT
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),  # benchmark
    ipaddress.ip_network("224.0.0.0/4"),    # multicast
    ipaddress.ip_network("240.0.0.0/4"),    # reserved
]

_LOCALHOST_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost"}


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if (addr.is_loopback or addr.is_link_local or addr.is_private
            or addr.is_multicast or addr.is_reserved or addr.is_unspecified):
        return True
    return any(addr in net for net in _EXTRA_NETS)


def check_url_safe(url: str) -> None:
    """校验 URL 目标不是内网/环回地址。不安全时抛 ValueError。"""
    parsed = urlparse(url)
    host = (parsed.hostname or "").strip("[]").lower()
    if not host:
        raise ValueError(f"URL 缺少主机名: {url!r}")

    # 1) hostname 字面量检查
    if host in _LOCALHOST_NAMES or host.endswith(".localhost"):
        raise ValueError(f"SSRF 拦截:禁止访问本机地址 {host!r}")
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        addr = None
    if addr is not None and _is_private_ip(host):
        raise ValueError(f"SSRF 拦截:禁止访问内网/保留地址 {host!r}")

    # 2) DNS 解析检查（域名解析到内网也拒绝）
    if addr is None:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            return  # 解析失败交给后续请求处理（可能是临时 DNS 故障）
        for info in infos:
            ip = info[4][0]
            if _is_private_ip(ip):
                raise ValueError(f"SSRF 拦截:{host!r} 解析到内网地址 {ip}")

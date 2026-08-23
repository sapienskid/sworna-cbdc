"""Resolve a bank's owner-node REST base URL.

Convention: bank index k -> node `owner{k}` at
`http://owner{k}.sworna.example.com:{9200 + 100*(k-1)}/api/v1`.
The hostname is resolved on the CB host via /etc/hosts (or a DNS entry) mapping
`owner{k}.sworna.example.com` to that bank's VM IP; the owner REST service runs
on that port on the bank's VM.

Override per node with `SWORNA_OWNER_<NODE>_URL` (e.g. SWORNA_OWNER_OWNER3_URL).
"""
from __future__ import annotations

import os
import re


def owner_base_url(owner_node: str) -> str:
    override = os.getenv(f"SWORNA_OWNER_{owner_node.upper()}_URL")
    if override:
        return override
    port = 9200
    m = re.fullmatch(r"owner(\d+)", owner_node)
    if m:
        k = int(m.group(1))
        port = 9200 + 100 * (k - 1)
    return f"http://{owner_node}.sworna.example.com:{port}/api/v1"
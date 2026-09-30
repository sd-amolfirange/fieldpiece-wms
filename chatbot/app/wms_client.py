"""Read-only calls to the WMS API for warranty look-ups.

The assistant has no credentials of its own: it forwards the signed-in user's access token, so the WMS applies the
same scoping as the portal (a customer sees their own products, a dealer the ones it sold) and answers 404 for
anything else. Anonymous visitors can't look anything up.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

SERIAL_RE = re.compile(r"\b(?:([A-Z][A-Z0-9]{1,7})-)?(\d{9})\b", re.I)


def find_serial(text: str) -> str | None:
    """"sc680-251406233" -> "SC680-251406233"; a bare 9-digit label number is returned as is."""
    m = SERIAL_RE.search(text or "")
    if not m:
        return None
    return f"{m.group(1).upper()}-{m.group(2)}" if m.group(1) else m.group(2)


@dataclass
class LookupResult:
    status: str  # found | not_found | unauthenticated | ambiguous | error
    unit: dict | None = None
    matches: list[str] | None = None


class WmsClient:
    def __init__(self, base_url: str, timeout: float = 8.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def lookup(self, serial: str, token: str | None) -> LookupResult:
        if not token:
            return LookupResult("unauthenticated")
        headers = {"Authorization": f"Bearer {token}"}
        try:
            with httpx.Client(base_url=self.base_url, timeout=self.timeout, headers=headers) as http:
                if "-" not in serial:
                    # A bare label number: find which of the user's products carries it.
                    res = http.get("/units", params={"q": serial, "pageSize": 5})
                    if res.status_code == 401:
                        return LookupResult("unauthenticated")
                    items = [u for u in res.json().get("items", []) if u["serial"].endswith(f"-{serial}")]
                    if not items:
                        return LookupResult("not_found")
                    if len(items) > 1:
                        return LookupResult("ambiguous", matches=[u["serial"] for u in items])
                    return LookupResult("found", items[0])
                res = http.get(f"/units/{serial}")
                if res.status_code == 401:
                    return LookupResult("unauthenticated")
                if res.status_code == 404:
                    return LookupResult("not_found")
                res.raise_for_status()
                return LookupResult("found", res.json())
        except (httpx.HTTPError, ValueError, KeyError):
            return LookupResult("error")

    def models(self) -> list[dict]:
        """The public catalog (no sign-in), used by `python -m app.ingest --from-wms`."""
        with httpx.Client(base_url=self.base_url, timeout=self.timeout) as http:
            res = http.get("/public/models")
            res.raise_for_status()
            return [
                {
                    "code": m["code"],
                    "category": m.get("categoryName", ""),
                    "name": m["name"],
                    "description": m.get("description", ""),
                    "warrantyMonths": m.get("warrantyMonths", 12),
                }
                for m in res.json()
                if m.get("active", True)
            ]

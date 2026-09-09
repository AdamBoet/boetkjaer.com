"""
Shared Supabase REST (PostgREST + Storage) helpers for the Bøtkjær.com
mandarin-pipeline scripts. Originally create_card.py, a standalone CLI for
manually authoring hanzi cards from cards/*.json files — that manual
workflow (and the files/docs it depended on) is retired now that card
creation is fully automated by daily_refresh.py, but this module's
low-level Supabase helpers are still imported from there, so it stays.

Requires: a .env file in this folder with NEXT_PUBLIC_SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY (same values as the Botkjaer.com repo's
.env.local — same Supabase project).
"""

import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = None  # falls back to the system default verify context

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
BUCKET = "mandarin-media"

# --- .env loading -----------------------------------------------------------

def load_env(path: str) -> dict:
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


ENV = load_env(ENV_PATH)
SUPABASE_URL = ENV.get("NEXT_PUBLIC_SUPABASE_URL")
SERVICE_KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_KEY:
    print(f"ERROR: missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in {ENV_PATH}")
    sys.exit(1)


# --- Supabase REST (PostgREST + Storage) ------------------------------------

def sb_request(method: str, path: str, body=None, extra_headers=None, raw_body=False):
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }
    headers.update(extra_headers or {})
    data = None
    if body is not None:
        if raw_body:
            data = body
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    # daily_refresh.py runs unattended for hours; a single transient network
    # blip (observed overnight: "Remote end closed connection without
    # response", likely from a brief maintenance-sleep dark-wake cycle) used
    # to kill the entire multi-hour run via sys.exit(1), which is a
    # BaseException and slips straight past with_retries()'s `except
    # Exception` in daily_refresh.py. Retry a few times here, and raise a
    # plain RuntimeError (not SystemExit) on exhaustion so with_retries can
    # catch it, retry/skip just that one card, and move on — same resilience
    # pattern already used for LLM/audio generation failures.
    attempts = 3
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(req, timeout=20, context=_SSL_CTX) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            raise RuntimeError(f"Supabase {method} {path} -> {e.code}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt < attempts:
                print(f"WARNING: Supabase {method} {path} unreachable ({e}), retrying...")
                time.sleep(5)
                continue
            raise RuntimeError(f"Cannot reach Supabase ({e}). Check NEXT_PUBLIC_SUPABASE_URL in .env.") from e


def sb_select(table: str, query: str):
    return sb_request("GET", f"/rest/v1/{table}?{query}")


def sb_insert(table: str, row: dict):
    return sb_request("POST", f"/rest/v1/{table}", body=row, extra_headers={"Prefer": "return=representation"})


_next_negative_id = None


def next_negative_note_id() -> int:
    """Assigns descending negative IDs for site-native cards, starting one
    below whatever the most-negative existing note_id already is (or -1)."""
    global _next_negative_id
    if _next_negative_id is None:
        existing = sb_select("hanzi_cards", "select=note_id&note_id=lt.0&order=note_id.asc&limit=1")
        _next_negative_id = (existing[0]["note_id"] - 1) if existing else -1
    note_id = _next_negative_id
    _next_negative_id -= 1
    return note_id


def upload_media(data: bytes, content_type: str, path: str) -> str:
    sb_request(
        "POST",
        f"/storage/v1/object/{BUCKET}/{path}",
        body=data,
        raw_body=True,
        extra_headers={"Content-Type": content_type, "x-upsert": "true"},
    )
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"


_CJK_RE = re.compile(r"[一-鿿㐀-䶿]+")

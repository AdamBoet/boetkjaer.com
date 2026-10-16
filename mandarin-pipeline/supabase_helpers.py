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

import calendar
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


# Folders only ever written by daily_refresh.py's TTS. Pictures, screenshots
# and edits/ (uploaded from the site) are deliberately never swept.
AUDIO_PREFIXES = ("hanzi-words", "hsk3-sentence-audio", "wordphrase-sentence-audio", "sentences")
# Every table that can hold a mandarin-media URL, with its primary key for
# stable paging. Whole rows are scanned, not named columns, so a URL in a
# newly added column can't be mistaken for an orphan.
_MEDIA_REF_TABLES = {"hanzi_cards": "note_id", "hsk3_words": "word", "words_phrases": "note_id", "screenshot_queue": "id"}
_MEDIA_PATH_RE = re.compile(r"/mandarin-media/([A-Za-z0-9_./%-]+)")


def _referenced_media_paths() -> set:
    refs = set()
    for table, pk in _MEDIA_REF_TABLES.items():
        offset = 0
        while True:
            rows = sb_select(table, f"select=*&order={pk}.asc&limit=1000&offset={offset}")
            for row in rows:
                refs.update(_MEDIA_PATH_RE.findall(json.dumps(row, ensure_ascii=False)))
            if len(rows) < 1000:
                break
            offset += 1000
    return refs


def sweep_orphaned_audio(min_age_hours: float = 1.0, dry_run: bool = False) -> tuple:
    """Deletes TTS audio no row points to any more. Every regeneration
    uploads under a fresh timestamped path and repoints the row, so the old
    clip is left behind (~180MB/week as WAV — enough to blow through the
    free-plan storage quota). Files younger than min_age_hours are kept in
    case an overlapping run uploaded them but hasn't written its row yet.
    Returns (files, bytes)."""
    refs = _referenced_media_paths()
    if not any(r.startswith(AUDIO_PREFIXES) for r in refs):
        # Zero referenced audio means the scan itself went wrong — never
        # treat that as "everything is an orphan".
        raise RuntimeError("found no referenced audio at all, refusing to sweep")
    cutoff = time.time() - min_age_hours * 3600
    orphans, orphan_bytes = [], 0
    for prefix in AUDIO_PREFIXES:
        offset = 0
        while True:
            items = sb_request("POST", f"/storage/v1/object/list/{BUCKET}", body={
                "prefix": prefix, "limit": 1000, "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            }) or []
            for item in items:
                if item.get("id") is None:  # a sub-folder placeholder, not a file
                    continue
                path = f"{prefix}/{item['name']}"
                try:
                    created = time.strptime(item["created_at"][:19], "%Y-%m-%dT%H:%M:%S")
                except (KeyError, TypeError, ValueError):
                    continue  # unknown age: keep the file
                if path not in refs and calendar.timegm(created) < cutoff:
                    orphans.append(path)
                    orphan_bytes += int((item.get("metadata") or {}).get("size") or 0)
            if len(items) < 1000:
                break
            offset += 1000
    if not dry_run:
        for i in range(0, len(orphans), 1000):
            sb_request("DELETE", f"/storage/v1/object/{BUCKET}", body={"prefixes": orphans[i:i + 1000]})
    print(f"  audio sweep: {'would delete' if dry_run else 'deleted'} {len(orphans)} orphaned files ({orphan_bytes / 1e6:.0f} MB)")
    return len(orphans), orphan_bytes


_CJK_RE = re.compile(r"[一-鿿㐀-䶿]+")

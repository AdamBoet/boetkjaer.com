"""
Anki 汉字 card generator — Supabase edition.

Reads card data from cards/*.json and pushes straight into the
`hanzi_cards` table that the Botkjaer.com /lab/hanzi web app reads from.
No Anki/AnkiConnect involved — this is the site-native replacement.

- Existing cards (identified by stored note_id) have their *content*
  fields updated in place; scheduling data (interval/reps/due/etc, i.e.
  your review progress) is never touched by this script.
- New cards get a synthetic negative note_id (site-native cards are always
  negative; real Anki-synced cards are always positive, so the two ranges
  can never collide) and are inserted with fresh-card scheduling defaults.

Usage:
    python3 create_card.py                        # process all cards/*.json
    python3 create_card.py cards/006_人.json       # process specific card(s)

Requires: a .env file in this folder with NEXT_PUBLIC_SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY (same values as the Botkjaer.com repo's
.env.local — same Supabase project).
"""

import glob
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = None  # falls back to the system default verify context

CARDS_DIR = os.path.join(os.path.dirname(__file__), "cards")
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
BUCKET = "mandarin-media"
DEFAULT_FACTOR = 2500

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
    # pattern already used for LLM/audio generation failures. A bare script
    # run (create_card.py from the terminal) still ends up terminating on an
    # uncaught RuntimeError, just with a normal traceback instead of a
    # silent exit.
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


def sb_update(table: str, note_id: int, patch: dict):
    return sb_request("PATCH", f"/rest/v1/{table}?note_id=eq.{note_id}", body=patch)


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


# --- Audio (macOS TTS) -------------------------------------------------------

_CJK_RE = re.compile(r"[一-鿿㐀-䶿]+")


def extract_example_words(examples: str) -> list[str]:
    """Return list of unique CJK word strings from the examples field."""
    seen = []
    for word in _CJK_RE.findall(examples):
        if word not in seen:
            seen.append(word)
    return seen


def generate_audio(text: str) -> bytes | None:
    """Use macOS `say` + `afconvert` to synthesise Mandarin audio.

    text may include embedded `say` commands like [[slnc N]] for silence.
    Returns M4A bytes, or None on failure.
    """
    aiff_tmp = tempfile.mktemp(suffix=".aiff")
    m4a_tmp = tempfile.mktemp(suffix=".m4a")
    try:
        result = subprocess.run(
            ["say", "-v", "Tingting", "-r", "150", "-o", aiff_tmp, text],
            capture_output=True,
        )
        if result.returncode != 0:
            print(f"  Warning: `say` failed: {result.stderr.decode()}")
            return None

        result = subprocess.run(
            ["afconvert", "-f", "mp4f", "-d", "aac", aiff_tmp, m4a_tmp],
            capture_output=True,
        )
        if result.returncode != 0:
            print(f"  Warning: `afconvert` failed: {result.stderr.decode()}")
            return None

        with open(m4a_tmp, "rb") as f:
            return f.read()
    except FileNotFoundError as e:
        print(f"  Warning: {e} (macOS only)")
        return None
    finally:
        for p in (aiff_tmp, m4a_tmp):
            if os.path.exists(p):
                os.unlink(p)


def build_audio_url(examples: str, character: str, note_id: int) -> str | None:
    """Generates one audio clip covering all example words (600ms pause
    between them), uploads it, and returns its public URL."""
    words = extract_example_words(examples)
    if not words:
        return None
    text = " [[slnc 600]] ".join(words)
    audio_data = generate_audio(text)
    if not audio_data:
        return None
    path = f"edits/hanzi-{note_id}-{int(time.time())}.m4a"
    return upload_media(audio_data, "audio/mp4", path)


# --- Initial daily words (for brand-new cards only) -------------------------
# The nightly launchd job (sentence_audio/daily_refresh.py) refreshes due
# cards' word lists going forward; this just gives a new card an initial one
# immediately instead of leaving it empty until it's first due. Shells out to
# this project's own venv since it needs kokoro, which this script's own
# environment intentionally doesn't install. No LLM involved either way.
_SENTENCE_AUDIO_DIR = os.path.dirname(__file__)
_SENTENCE_VENV_PYTHON = os.path.join(_SENTENCE_AUDIO_DIR, ".venv", "bin", "python3")


def generate_initial_daily_words(character: str, note_id: int, pronunciation: str = "") -> dict | None:
    if not os.path.exists(_SENTENCE_VENV_PYTHON):
        return None
    result = subprocess.run(
        [_SENTENCE_VENV_PYTHON, "generate_hanzi_words.py", character, str(note_id), pronunciation],
        cwd=_SENTENCE_AUDIO_DIR,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  Warning: daily-words generation failed: {result.stderr[-500:]}")
        return None
    return json.loads(result.stdout.strip().splitlines()[-1])


# --- Process a single card ---------------------------------------------------

def process(json_path: str):
    with open(json_path, encoding="utf-8") as f:
        card = json.load(f)

    char = card["character"]
    rank = card["rank"]
    note_id = card.get("note_id")

    if note_id:
        # Existing site-native card — regenerate audio, update content
        # fields only. Scheduling (interval/reps/due/...) is never touched
        # here, so review progress made in the web app is preserved.
        audio_url = build_audio_url(card.get("examples", ""), char, note_id)
        patch = {
            "character": char,
            "rank": rank,
            "pronunciation": card["pronunciation"],
            "front": card["front"],
            "components": card["components"],
            "examples": card["examples"],
        }
        if audio_url:
            patch["audio_url"] = audio_url
        sb_update("hanzi_cards", note_id, patch)
        print(f"  Updated hanzi_cards row for {char} (note_id {note_id})")
    else:
        # New card — assign a synthetic negative ID and insert with
        # fresh-card scheduling defaults (reps=0 is what makes the site
        # treat it as "new").
        note_id = next_negative_note_id()
        audio_url = build_audio_url(card.get("examples", ""), char, note_id)
        row = {
            "note_id": note_id,
            "character": char,
            "rank": rank,
            "pronunciation": card["pronunciation"],
            "front": card["front"],
            "components": card["components"],
            "examples": card["examples"],
            "audio_url": audio_url,
            "picture_url": None,
            "card_id": note_id,
            "interval": 0,
            "reps": 0,
            "lapses": 0,
            "factor": DEFAULT_FACTOR,
            "queue": 0,
            "due": 0,
            "type": 0,
            "mod": int(time.time()),
            "learning_step": None,
        }
        daily_words_data = generate_initial_daily_words(char, note_id, card["pronunciation"])
        if daily_words_data:
            row.update(daily_words_data)
            row["daily_words_generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        sb_insert("hanzi_cards", row)
        print(f"  Added new hanzi_cards row for {char} (note_id {note_id})")

        card["note_id"] = note_id
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(card, f, ensure_ascii=False, indent=2)

    print(f"Done: {char} (rank {rank})")


# --- Main ---------------------------------------------------------------

if __name__ == "__main__":
    targets = sys.argv[1:] or sorted(glob.glob(os.path.join(CARDS_DIR, "*.json")))
    if not targets:
        print("No .json card files found in cards/")
        sys.exit(1)
    for path in targets:
        print(f"\nProcessing {os.path.basename(path)} ...")
        process(path)

"""
Daily Kokoro-voiced refresh for cards due today, across:
  - hsk3_words (HSK 3.0 deck): fresh generative-AI sentence + translation
  - words_phrases, source in (random_words, idioms): same, fresh sentence
  - hanzi_cards: NO generative AI — 3 real example words picked from the
    same frequency-tiered `hanzi` npm data tools/hanzi_lookup.js already
    uses during card authoring, just narrated in the Kokoro voice.

Runs locally (via launchd, see com.adam.hanzi-sentence-refresh.plist) since
Kokoro/llama-cpp-python are too heavy to bundle into a Vercel serverless
function (~500MB limit) — see /Users/adam/.claude/plans/radiant-crunching-avalanche.md.

For hsk3_words/words_phrases, each due card whose sentence predates its last
review gets:
  1. One natural Mandarin sentence containing the word/idiom, from a local
     Qwen2.5-1.5B-Instruct GGUF model (llama-cpp-python) — no API key.
  2. An English translation (also via Qwen2.5).
  3. Word-grouped pinyin (jieba + pypinyin), matching the existing
     capitalized "Tā xǐhuan kànshū." style already used on these decks.
  4. Kokoro-voiced audio of the word, then the sentence.

For hanzi_cards, each due card whose word list predates its last review
gets 3 randomly-picked real example words (no LLM) narrated in sequence.

Usage:
    python3 daily_refresh.py            # process all due cards, all decks
    python3 daily_refresh.py --limit 5  # process at most 5 per deck (smoke test)
"""

import argparse
import glob
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from create_card import sb_select, sb_insert, sb_request, upload_media, ENV, _CJK_RE, _SSL_CTX, next_negative_note_id  # noqa: E402

from llama_cpp import Llama
from kokoro import KPipeline
from pypinyin import pinyin, Style
from pypinyin.contrib.tone_convert import to_tone
import jieba
import soundfile as sf
import Vision
import Quartz
from Foundation import NSURL

DEFAULT_FACTOR = 2500
MANDARIN_MEDIA_BUCKET = "mandarin-media"

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "qwen2.5-1.5b-instruct-q4_k_m.gguf")
ANKI_HANZI_ROOT = os.path.dirname(__file__)

# launchd jobs run with a minimal PATH (no /usr/local/bin), so a bare "node"
# fails with FileNotFoundError there even though it resolves fine in a shell —
# confirmed the cause of repeated screenshot-processing failures overnight.
NODE_BIN = "/usr/local/bin/node"

# Per-deck generation settings, editable from the deck menu's settings gear
# on the site (app/lab/hanzi/FlashcardTab.tsx's DeckSettingsPopover), stored
# in the hanzi_settings table. These are the fallbacks when a deck has no
# row/column value set yet.
DEFAULT_SETTINGS = {
    "word_count": 3,
    "sentence_max_chars": 12,
    "voice": "zm_yunxi",
}


def load_settings() -> dict:
    rows = sb_select("hanzi_settings", "select=deck,word_count,sentence_max_chars,voice,new_cards")
    return {r["deck"]: r for r in rows}


def get_setting(settings: dict, deck: str, field: str):
    value = (settings.get(deck) or {}).get(field)
    return value if value is not None else DEFAULT_SETTINGS[field]


def get_new_cards_target(settings: dict, deck: str) -> int:
    """Unlike word_count/sentence_max_chars/voice, an unset new_cards should
    mean "replenish nothing" (0), not fall back to a guessed default."""
    value = (settings.get(deck) or {}).get("new_cards")
    return value if value is not None else 0


_llm = None
_kokoro = None


def llm():
    global _llm
    if _llm is None:
        # generate_translation's multi-turn self-correction (see its own
        # comment) can grow a conversation across several retries — 512 was
        # too tight for that: once exceeded, llama.cpp's context-shift
        # recompute on every subsequent call in the process got so slow the
        # whole overnight run silently stalled for hours without ever
        # actually crashing (no error, just near-zero further progress).
        # 2048 comfortably covers the worst case with real headroom to spare.
        _llm = Llama(model_path=MODEL_PATH, n_ctx=2048, verbose=False)
    return _llm


def kokoro_pipeline():
    global _kokoro
    if _kokoro is None:
        _kokoro = KPipeline(lang_code="z")
    return _kokoro


def sb_update_by(table: str, column: str, value, patch: dict):
    sb_request("PATCH", f"/rest/v1/{table}?{column}=eq.{urllib.parse.quote(str(value))}", body=patch)


# --- Due-date logic (mirrors buildQueue in app/lab/hanzi/FlashcardTab.tsx) --

def due_diff(mod, interval):
    if not mod or not interval:
        return None
    r = datetime.fromtimestamp(mod)
    due_day = datetime(r.year, r.month, r.day) + timedelta(days=interval)
    today = datetime.now()
    today_day = datetime(today.year, today.month, today.day)
    return (due_day - today_day).days


def is_due_today(card: dict) -> bool:
    reps = card.get("reps") or 0
    typ = card.get("type")
    if reps > 0 and typ in (1, 3):
        return True  # learning/relearning — always in scope today
    if reps == 0:
        return False
    dd = due_diff(card.get("mod"), card.get("interval"))
    return dd is not None and dd <= 0


def needs_refresh(card: dict, generated_field: str) -> bool:
    """Only refresh once per actual review cycle — an overdue-but-unreviewed
    card already has a sentence waiting for it and shouldn't get a new one
    just because a day passed without it being reviewed."""
    ts = card.get(generated_field)
    mod = card.get("mod")
    if not ts or not mod:
        return True
    generated = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    last_reviewed = datetime.fromtimestamp(mod, tz=timezone.utc)
    return generated < last_reviewed


# --- Generation --------------------------------------------------------

SENTENCE_WORD_CHECK_ATTEMPTS = 5


def _word_present(word: str, sentence: str) -> bool:
    if word in sentence:
        return True
    if 2 <= len(word) <= 3:
        # Separable verb-object words (离合词) like 打喷嚏 (打+喷嚏), 打电话
        # (打+电话), 洗澡 (洗+澡), 睡觉 (睡+觉) naturally split with an
        # aspect/measure particle inserted between the verb and object in
        # real usage (e.g. 打了个喷嚏), so a strict contiguous-substring
        # check rejects genuinely correct sentences for this whole class of
        # words every time. Try every split point (verb may be 1 or 2
        # characters) with a short gap for the inserted particle.
        for i in range(1, len(word)):
            pattern = re.escape(word[:i]) + r".{1,3}" + re.escape(word[i:])
            if re.search(pattern, sentence):
                return True
    return False


_LATIN_RE = re.compile(r"[a-zA-Z]")


def _echoes_meaning(sentence: str) -> bool:
    """_word_present() only checks that the target word shows up — it can't
    tell a real sentence from the model gluing the word onto its own raw
    English meaning gloss instead of writing one (e.g. 输入's meaning
    "input; enter; import" reproduced verbatim as
    '输入"input"; enter; import。'), which trivially passes the word check
    while being nonsense. A real Chinese sentence is overwhelmingly CJK
    characters; a gloss dump is overwhelmingly Latin letters. A legitimate
    loanword (APP, GPS) only ever accounts for a small slice of a real
    sentence's length, so this only trips on a near-total echo."""
    letters = _LATIN_RE.findall(sentence)
    return len(letters) > 6 and len(letters) > len(sentence) * 0.3


def generate_sentence(word: str, meaning: str, max_chars: int = DEFAULT_SETTINGS["sentence_max_chars"]) -> str:
    prompt = (
        f"请用一个简短自然的中文句子造句，句子中必须逐字包含\"{word}\"这{len(word)}个字，"
        f"不能用意思相近的其他词代替。"
        f"它的意思是：{meaning}。句子要尽量简短，不超过{max_chars}个汉字（不算标点）。"
        f"只输出这句话，不要输出拼音、翻译或其他解释。"
    )
    # The prompt already says "must include {word}", but this small model
    # doesn't reliably follow that — it sometimes substitutes a related word
    # instead (e.g. 赞叹 for 赞美, 驼队 for 骆驼) or just writes an example OF
    # the meaning without ever using the target word itself (e.g. writing an
    # actual idiom for the word 成语, or naming a pet for the word 昵称,
    # instead of using the words "成语"/"昵称"). Some words are a genuine
    # sticky trap here too (赞美 substituting 赞叹) — same pattern as the
    # translation echo bug, where blind regeneration didn't help but
    # multi-turn correction (showing the model its own non-compliant output
    # as a real conversation turn) did, so use that here too. The correction
    # stays in Chinese (unlike an earlier English-language version of this
    # message) to match the rest of the conversation, and names the exact
    # substitution the model made rather than a generic "that's wrong".
    messages: list[dict] = [{"role": "user", "content": prompt}]
    sentence = ""
    for attempt in range(SENTENCE_WORD_CHECK_ATTEMPTS):
        out = llm().create_chat_completion(
            messages=messages,
            max_tokens=max(20, max_chars * 3),
            temperature=0.8,
            repeat_penalty=1.3,
        )
        sentence = out["choices"][0]["message"]["content"].strip()
        if _word_present(word, sentence) and not _echoes_meaning(sentence):
            return sentence
        messages.append({"role": "assistant", "content": sentence})
        if not _word_present(word, sentence):
            correction = (
                f"你写的是\"{sentence}\"——这句话里没有\"{word}\"这{len(word)}个字，你用了别的词代替。"
                f"请重新写一句话，句子中必须一字不差地包含\"{word}\"，不要用同义词或相近的词。"
            )
        else:
            correction = (
                f"你写的是\"{sentence}\"——你只是把这个词的英文意思抄了一遍，不是一句真正的中文句子。"
                f"请写一句自然的中文句子，句子中包含\"{word}\"，不要出现任何英文单词、引号或分号。"
            )
        messages.append({"role": "user", "content": correction})
    raise ValueError(f"sentence never included the word {word!r} after {SENTENCE_WORD_CHECK_ATTEMPTS} attempts: {sentence!r}")


TRANSLATION_REPAIR_ATTEMPTS = 5


def generate_translation(sentence: str, word: str | None = None, meaning: str | None = None) -> str:
    # A small model can drift on the one word that actually matters most —
    # e.g. translating 轻视 (contempt/to scorn) as "treats... lightly"
    # instead of anything conveying disdain. Anchoring the translation to
    # the word's already-known meaning keeps it from re-guessing that part.
    hint = f" The word \"{word}\" means \"{meaning}\" — make sure the translation reflects that." if word and meaning else ""
    prompt = f"Translate this Chinese sentence into natural, simple English.{hint} Output only the translation, nothing else.\n\n{sentence}"

    # Some sentences (often formulaic/idiom-shaped ones, e.g. "X是Y的必经之路")
    # send the small local model into a degenerate mode where it just echoes
    # the Chinese back instead of translating — and resending the identical
    # prompt reliably reproduces the identical failure (measured: 5/5
    # identical outputs at this temperature). Regenerating a whole new
    # sentence to dodge this throws away a perfectly good sentence and just
    # gambles on a different one. Pointing out the mistake in a follow-up
    # turn instead — showing the model its own bad output as a real
    # conversation turn — reliably breaks the loop within 1-2 extra turns
    # (measured: 0/15 failures on a known trap word, vs. 9/15 when the same
    # correction was embedded in a fresh single-turn prompt instead of an
    # actual multi-turn exchange — the model needs to see it "said" the bad
    # output, not just be told about it). This is why llm() needs generous
    # n_ctx: a real multi-turn conversation across several retries needs
    # the headroom, or it silently stalls the entire run (see n_ctx comment).
    messages: list[dict] = [{"role": "user", "content": prompt}]
    translation = ""
    for attempt in range(TRANSLATION_REPAIR_ATTEMPTS):
        out = llm().create_chat_completion(
            messages=messages,
            max_tokens=60,
            temperature=0.3,
            repeat_penalty=1.3,
        )
        translation = out["choices"][0]["message"]["content"].strip()
        if not _CJK_RE.search(translation):
            return translation
        messages.append({"role": "assistant", "content": translation})
        messages.append({
            "role": "user",
            "content": "That is wrong — you just repeated the original Chinese sentence instead of translating it. Write the English translation only, with no Chinese characters at all.",
        })
    raise ValueError(f"translation still contains Chinese after {TRANSLATION_REPAIR_ATTEMPTS} attempts: {translation!r}")


def _jieba_pinyin(text: str) -> str:
    words = jieba.lcut(text)
    parts = []
    for w in words:
        syllables = pinyin(w, style=Style.TONE)
        parts.append("".join(s[0] for s in syllables))
    return " ".join(parts)


def generate_pinyin(sentence: str) -> str:
    """Word-grouped, capitalized pinyin matching the existing convention on
    these decks (e.g. "Tā xǐhuan kànshū.") rather than per-syllable output."""
    text = _jieba_pinyin(sentence)
    return text[:1].upper() + text[1:] if text else text


def generate_word_pinyin(word: str) -> str:
    """Word-level pinyin: every syllable space-separated (prompt.md's own
    spec for this field, e.g. "jiāo huàn shēng"), unlike sentence-level
    generate_pinyin which groups syllables by jieba word boundaries (e.g.
    "xǐhuan" for 喜欢). Deliberately does NOT reuse _jieba_pinyin — jieba
    often treats a short word as a single token, which collapsed multi-
    syllable words into one unspaced blob (e.g. "bèngdí" for 蹦迪,
    "nàishuǐxìng" for 耐水性), contradicting the documented convention."""
    syllables = pinyin(word, style=Style.TONE)
    return " ".join(s[0] for s in syllables)


def synthesize(text: str, voice: str = DEFAULT_SETTINGS["voice"], speed: float = 1.0):
    for _gs, _ps, audio in kokoro_pipeline()(text, voice=voice, speed=speed):
        return audio
    raise RuntimeError(f"Kokoro produced no audio for: {text!r}")


def upload_wav(samples, path_prefix: str, key: str) -> str:
    # A shared fixed tmp path breaks if two runs overlap (e.g. a manual test
    # while the launchd job is also active) — each call gets its own file.
    tmp_wav = tempfile.mktemp(suffix=".wav")
    try:
        sf.write(tmp_wav, samples, 24000)
        with open(tmp_wav, "rb") as f:
            data = f.read()
    finally:
        if os.path.exists(tmp_wav):
            os.unlink(tmp_wav)
    # Supabase Storage keys must be ASCII — hash non-ASCII keys (e.g. a
    # Chinese word, for tables with no numeric id to key off of) rather
    # than relying on percent-encoding, which Storage still rejects.
    safe_key = key if key.isascii() else hashlib.md5(key.encode()).hexdigest()[:16]
    path = f"{path_prefix}/{safe_key}-{int(time.time())}.wav"
    return upload_media(data, "audio/wav", path)


def trim_silence(audio, threshold: float = 0.01):
    """Kokoro pads each clip with its own silence (~0.4s leading, ~1s
    trailing, observed) — trimming it lets us control the actual gap
    between clips ourselves instead of stacking on top of Kokoro's padding
    plus our own, which is how a 0.3s pause turned into ~2s in practice."""
    import numpy as np

    nonsilent = np.where(np.abs(audio) > threshold)[0]
    if len(nonsilent) == 0:
        return audio
    return audio[nonsilent[0] : nonsilent[-1] + 1]


def concat_with_pauses(texts: list[str], voice: str = DEFAULT_SETTINGS["voice"], speeds: list[float] | None = None):
    import numpy as np

    pause = np.zeros(int(24000 * 0.75), dtype=np.float32)
    parts = []
    for i, text in enumerate(texts):
        if i > 0:
            parts.append(pause)
        speed = speeds[i] if speeds else 1.0
        parts.append(trim_silence(synthesize(text, voice, speed)))
    return np.concatenate(parts)


def generate_audio_url(word: str, sentence: str, path_prefix: str, key: str, voice: str = DEFAULT_SETTINGS["voice"]) -> str:
    """One clip: the word on its own, a pause, then the full sentence —
    replaces reliance on the old (non-Kokoro) word-only pronunciation audio,
    so a single "play" gives a consistent voice for both. Kokoro rushes a
    word spoken in isolation compared to its natural pace inside a full
    sentence, so the standalone word is slowed down slightly to compensate.
    0.9 is a measured floor — anything below it (tested 0.8, 0.85) makes
    Kokoro stutter the first syllable of a short word (e.g. "zh-zhaopin")."""
    return upload_wav(concat_with_pauses([word, sentence], voice, speeds=[0.9, 1.0]), path_prefix, key)


def generate_word_list_audio(words: list[str], path_prefix: str, key: str, voice: str = DEFAULT_SETTINGS["voice"]) -> str:
    """One clip narrating each example word in sequence, pausing between."""
    return upload_wav(concat_with_pauses(words, voice), path_prefix, key)


MAX_ATTEMPTS = 5


def log_failure(table: str, key: str, error: Exception, attempts: int):
    try:
        sb_request("POST", "/rest/v1/generation_failures", body={
            "table_name": table,
            "item_key": key,
            "error": f"{type(error).__name__}: {error}",
            "attempts": attempts,
        })
    except Exception as e:
        print(f"  (failed to log failure record: {e})")


def with_retries(fn, label: str, table: str | None = None, key: str | None = None):
    """Retries a single card's generation in-place before giving up — most
    failures seen so far (e.g. a transient temp-file/network hiccup, or the
    small local model echoing Chinese back instead of translating on
    certain idiom-shaped sentences) succeed on a later try with a freshly
    generated sentence, so there's no reason to make the card wait for
    tomorrow's run if it would've worked a moment later."""
    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            fn()
            return True
        except Exception as e:
            last_error = e
            if attempt < MAX_ATTEMPTS:
                print(f"  {label}: attempt {attempt} failed ({type(e).__name__}: {e}), retrying...")
                time.sleep(2)
    print(f"  {label}: FAILED after {MAX_ATTEMPTS} attempts ({type(last_error).__name__}: {last_error})")
    if table and key:
        log_failure(table, key, last_error, MAX_ATTEMPTS)
    return False


# --- Per-deck refresh ----------------------------------------------------

def sb_select_all(table: str, query: str, page_size: int = 1000) -> list:
    """PostgREST caps a single select() at 1000 rows by default — hsk3_words
    has ~10,900, so a plain sb_select silently truncates and undercounts due
    cards. Page through with limit/offset, same fix as the Next.js side's
    fetchAllHsk3Words() in app/lab/hanzi/fetch-mandarin-data.ts."""
    rows = []
    offset = 0
    while True:
        page = sb_select(table, f"{query}&limit={page_size}&offset={offset}")
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def refresh_hsk3(limit=None, settings=None):
    settings = settings if settings is not None else load_settings()
    max_chars = get_setting(settings, "hsk3", "sentence_max_chars")
    voice = get_setting(settings, "hsk3", "voice")
    cards = sb_select_all(
        "hsk3_words",
        "select=word,meaning,mod,interval,reps,type,sentence_generated_at",
    )
    due_today_count = sum(1 for c in cards if is_due_today(c))
    due = [c for c in cards if is_due_today(c) and needs_refresh(c, "sentence_generated_at")]
    if limit is not None:
        due = due[:limit]
    print(f"hsk3_words: {due_today_count} due today, {len(due)} need a fresh sentence.")
    ok = failed = 0
    for card in due:
        word = card["word"]
        result = {}

        def do_it(word=word, card=card, result=result):
            sentence = generate_sentence(word, card.get("meaning") or "", max_chars)
            sb_update_by("hsk3_words", "word", word, {
                "sentence": sentence,
                "sentence_meaning": generate_translation(sentence, word, card.get("meaning")),
                "sentence_pinyin": generate_pinyin(sentence),
                "sentence_audio_url": generate_audio_url(word, sentence, "hsk3-sentence-audio", word, voice),
                "sentence_generated_at": datetime.now(timezone.utc).isoformat(),
            })
            result["sentence"] = sentence

        if with_retries(do_it, word, "hsk3_words", word):
            print(f"  {word}: {result['sentence']}")
            ok += 1
        else:
            failed += 1
    return ok, failed, due_today_count


def refresh_words_phrases(limit=None, settings=None):
    settings = settings if settings is not None else load_settings()
    cards = sb_select_all(
        "words_phrases",
        "select=note_id,word,meaning,source,mod,interval,reps,type,example_generated_at"
        "&source=in.(random_words,idioms)",
    )
    due_today_count = sum(1 for c in cards if is_due_today(c))
    due = [c for c in cards if is_due_today(c) and needs_refresh(c, "example_generated_at")]
    if limit is not None:
        due = due[:limit]
    print(f"words_phrases: {due_today_count} due today, {len(due)} need a fresh sentence.")
    ok = failed = 0
    for card in due:
        word = card["word"]
        note_id = card["note_id"]
        # random_words and idioms are two distinct decks in the settings UI
        # even though they share this one table — each keeps its own
        # sentence length/voice.
        deck = card["source"]
        max_chars = get_setting(settings, deck, "sentence_max_chars")
        voice = get_setting(settings, deck, "voice")
        result = {}

        def do_it(word=word, note_id=note_id, card=card, result=result, max_chars=max_chars, voice=voice):
            sentence = generate_sentence(word, card.get("meaning") or "", max_chars)
            sb_update_by("words_phrases", "note_id", note_id, {
                "example": sentence,
                "example_meaning": generate_translation(sentence, word, card.get("meaning")),
                "example_pinyin": generate_pinyin(sentence),
                "example_audio_url": generate_audio_url(word, sentence, "wordphrase-sentence-audio", str(note_id), voice),
                "example_generated_at": datetime.now(timezone.utc).isoformat(),
            })
            result["sentence"] = sentence

        if with_retries(do_it, word, "words_phrases", str(note_id)):
            print(f"  {word}: {result['sentence']}")
            ok += 1
        else:
            failed += 1
    return ok, failed, due_today_count


def parse_readings(pronunciation: str) -> list[str]:
    """The card's own `pronunciation` field (e.g. "dōu, dou1 / dū, du1") is
    the human-curated set of readings actually worth studying — already
    excluding rare senses like a surname reading, unlike the raw `hanzi` npm
    data's full pinyin list. Returns the tone-number form of each reading
    (e.g. ["dou1", "du1"]), in the field's own order."""
    return [g.split(",")[-1].strip().lower() for g in pronunciation.split(" / ") if g.strip()]


def pick_example_words(character: str, count: int = 3, pronunciation: str = "") -> list[list[tuple[str, str]]]:
    """No generative AI here — real, frequency-tiered example words (with
    their dictionary definitions) from the same `hanzi` npm data
    tools/hanzi_lookup.js already uses during card authoring, just randomly
    sampled fresh each refresh. Returns a list of (word, meaning) groups, one
    group per reading in `pronunciation`'s order (a single group if there's
    only one reading, or `pronunciation` wasn't given) — mirroring the same
    per-pronunciation grouping already required of the static `examples`
    field, so a multi-reading character's daily words don't silently mix
    e.g. 都市 (du1) in with 全都 (dou1) with nothing to tell them apart.

    CC-CEDICT capitalizes the first pinyin syllable of proper nouns (names,
    places, brands) — e.g. "Jia1 le4 bi3 Hai3" for 加勒比海 — and this data
    is frequency-within-this-character, not frequency overall, so even the
    "high" tier is often mostly proper nouns for a rarer character. Filter
    those out, then exhaust the higher tiers before falling back to lower
    ones, rather than sampling uniformly across all three."""
    result = subprocess.run(
        [NODE_BIN, "tools/hanzi_lookup.js", character],
        cwd=ANKI_HANZI_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)[character]

    # CC-CEDICT tags register/rarity directly in the definition text, the
    # same way it tags proper nouns via capitalized pinyin — e.g. 都督's
    # definition is "(army) commander-in-chief (archaic)/...". A lower tier
    # (used whenever a character's higher tiers don't yield enough non-proper
    # nouns) can otherwise mix genuinely common words with archaic/literary
    # ones indiscriminately, since both are just "not a proper noun."
    _RARITY_MARKERS = ("(archaic)", "(dialect)", "(literary)", "(old)", "old term for", "old name for")

    # daily_words displays each pair as "word (meaning)" — a definition that
    # already has its own parenthetical (e.g. 陪都's "provisional capital of
    # a country (e.g. in time of war)") would nest as "word (meaning (e.g.
    # ...))" otherwise.
    def strip_parens(meaning: str) -> str:
        return re.sub(r"\s*\([^)]*\)", "", meaning).strip()

    # Proper-noun definitions are often long descriptive glosses rather than
    # a plain word/phrase meaning — e.g. 成都's is "Chengdu subprovincial
    # city and capital of Sichuan province 四川 in southwest China". Cut at
    # the first comma/colon/semicolon (the common "Name, description" or
    # "name: description" pattern), else fall back to just the leading
    # capitalized-word run (the actual name). Unlike a comma, that cut point
    # can itself still be long (e.g. 唐僧's "Xuanzang, Tang dynasty Buddhist
    # monk and translator, who traveled..." is 7 words before the second
    # comma) — so the word-count cap below always applies, even after
    # cutting, not just on the uncut fallback path. Self-limiting: an
    # ordinary short lowercase-starting meaning passes through unchanged.
    # If nothing short survives, return None — the caller drops this word as
    # a candidate rather than show a run-on definition; a different (often
    # more common) example word will be picked instead.
    def clean_meaning(meaning: str) -> str | None:
        meaning = strip_parens(meaning)
        for sep in (",", ":", ";"):
            if sep in meaning:
                meaning = meaning.split(sep)[0].strip()
                break
        words = meaning.split()
        if len(words) <= 4:
            return meaning
        name_words: list[str] = []
        for w in words:
            if w[:1].isupper():
                name_words.append(w)
            else:
                break
        return " ".join(name_words) if name_words else None

    # A CC-CEDICT entry's first "/"-separated sense is sometimes the long
    # descriptive one while a later sense is short and plain (e.g. 眼神's
    # first sense is "expression or emotion showing in one's eyes" but its
    # second is just "meaningful glance"; 下酒's second sense "to down one's
    # drink" beats its first). Try senses in order and use the first one
    # clean_meaning can shorten, instead of giving up after the first.
    def first_clean_sense(definition: str) -> str | None:
        for sense in definition.split("/"):
            cleaned = clean_meaning(sense.strip())
            if cleaned is not None:
                return cleaned
        return None

    def tier_words(tier: str, allow_proper: bool = False) -> list[tuple[str, str, str]]:
        # Low tier for a common character is overwhelmingly place/name
        # entries (52 of 52 for 都, mostly obscure counties) — mixing those
        # in as a "why not, there's room" filler produces a different random
        # obscure place name each refresh. Proper nouns only compete for a
        # slot when they come from high/medium tier; low tier stays
        # non-proper-noun only regardless of allow_proper.
        proper_ok = allow_proper and tier != "low"
        result = []
        for item in data.get("examples", {}).get(tier, []):
            if item["simplified"] == character:
                continue
            if not (proper_ok or not item["pinyin"][:1].isupper()):
                continue
            if any(marker in item["definition"] for marker in _RARITY_MARKERS):
                continue
            meaning = first_clean_sense(item["definition"])
            if meaning is None:
                continue
            result.append((item["simplified"], meaning, item["pinyin"]))
        return result

    def char_reading(word: str, word_pinyin: str) -> str | None:
        idx = word.find(character)
        syllables = word_pinyin.split()
        return syllables[idx].lower() if 0 <= idx < len(syllables) else None

    def collect_flat() -> list[tuple[str, str]]:
        selected: list[tuple[str, str]] = []
        seen: set[str] = set()

        # Guarantee one non-proper-noun word first, if any exist at all —
        # otherwise a character whose entire vocabulary is proper nouns
        # (e.g. 俄, almost exclusively "Russia"/country names) would have
        # nothing to show, and one unlucky enough to have both common and
        # proper candidates could still end up all-proper by chance.
        for tier in ("high", "medium", "low"):
            candidates = [(w, m) for w, m, p in tier_words(tier, allow_proper=False) if w not in seen]
            if candidates:
                pick = random.choice(candidates)
                selected.append(pick)
                seen.add(pick[0])
                break

        # Fill remaining slots from the full tier-cascaded pool — proper
        # nouns compete normally here, same as any other candidate.
        for tier in ("high", "medium", "low"):
            if len(selected) >= count:
                break
            candidates = [(w, m) for w, m, _ in tier_words(tier, allow_proper=True) if w not in seen]
            random.shuffle(candidates)
            for pair in candidates:
                if len(selected) >= count:
                    break
                selected.append(pair)
                seen.add(pair[0])
        return selected

    readings = parse_readings(pronunciation) if pronunciation else []
    if len(readings) <= 1:
        return [collect_flat()]

    def pick_for_reading(reading: str, needed: int, seen: set[str], allow_proper: bool) -> list[tuple[str, str]]:
        picked: list[tuple[str, str]] = []
        for tier in ("high", "medium", "low"):
            if len(picked) >= needed:
                break
            candidates = [
                (w, m) for w, m, p in tier_words(tier, allow_proper)
                if w not in seen and char_reading(w, p) == reading
            ]
            random.shuffle(candidates)
            for pair in candidates:
                if len(picked) >= needed:
                    break
                picked.append(pair)
        return picked

    def collect_grouped() -> dict[str, list[tuple[str, str]]]:
        seen_words: set[str] = set()
        groups: dict[str, list[tuple[str, str]]] = {r: [] for r in readings}

        # Guarantee at least one non-proper-noun word per reading first
        # (matching the "examples must cover all pronunciations" rule) —
        # falling back to a proper noun only if that reading has nothing
        # else at all. Remaining slots then draw from the full mixed pool,
        # rotating through readings with unused candidates.
        for r in readings:
            picks = pick_for_reading(r, 1, seen_words, allow_proper=False) or pick_for_reading(
                r, 1, seen_words, allow_proper=True
            )
            groups[r].extend(picks)
            seen_words.update(w for w, _ in picks)

        active = list(readings)
        while active and sum(len(v) for v in groups.values()) < count:
            r = active.pop(0)
            picks = pick_for_reading(r, 1, seen_words, allow_proper=True)
            if picks:
                groups[r].extend(picks)
                seen_words.update(w for w, _ in picks)
                active.append(r)
        return groups

    groups = collect_grouped()
    return [groups[r] for r in readings if groups[r]]


def refresh_hanzi(limit=None, settings=None):
    settings = settings if settings is not None else load_settings()
    word_count = get_setting(settings, "hanzi", "word_count")
    voice = get_setting(settings, "hanzi", "voice")
    cards = sb_select_all(
        "hanzi_cards",
        "select=note_id,character,pronunciation,mod,interval,reps,type,daily_words_generated_at",
    )
    due_today_count = sum(1 for c in cards if is_due_today(c))
    due = [c for c in cards if is_due_today(c) and needs_refresh(c, "daily_words_generated_at")]
    if limit is not None:
        due = due[:limit]
    print(f"hanzi_cards: {due_today_count} due today, {len(due)} need fresh words.")
    ok = failed = 0
    for card in due:
        char = card["character"]
        note_id = card["note_id"]
        pronunciation = card.get("pronunciation") or ""
        result = {}

        def do_it(char=char, note_id=note_id, pronunciation=pronunciation, result=result):
            groups = pick_example_words(char, word_count, pronunciation)
            if not any(groups):
                raise RuntimeError("no example words available")
            # Mirrors the static `examples` field's own convention: "/" between
            # pronunciation groups, "; " between words within the same one.
            daily_words = " / ".join(
                "; ".join(f"{word} ({meaning})" for word, meaning in group) for group in groups
            )
            all_words = [w for group in groups for w, _ in group]
            sb_update_by("hanzi_cards", "note_id", note_id, {
                "daily_words": daily_words,
                "daily_words_audio_url": generate_word_list_audio(all_words, "hanzi-words", str(note_id), voice),
                "daily_words_generated_at": datetime.now(timezone.utc).isoformat(),
            })
            result["daily_words"] = daily_words

        if with_retries(do_it, char, "hanzi_cards", str(note_id)):
            print(f"  {char}: {result['daily_words']}")
            ok += 1
        else:
            failed += 1
    return ok, failed, due_today_count


# --- Auto-replenish new cards (hanzi & hsk3) -----------------------------
#
# The "new cards per day" setting only caps how many *existing* never-
# reviewed cards get shown each day — it never creates more when the pool
# runs low. These two functions top the pool back up to that same target
# during the nightly run: hanzi picks up the next character in frequency-
# rank order, hsk3 introduces the next word in lowest-to-highest level
# order. Per an explicit instruction, hanzi card authoring here is
# deliberately mechanical (no LLM "judgment calls" replicating the
# meaning-pruning/component-selection rules in docs/rules.md that a human
# normally applies) — lower fidelity than hand-curated cards, fixable later
# by hand-editing the local cards/*.json file this also writes.

def lookup_at_rank(rank: int) -> dict:
    result = subprocess.run(
        [NODE_BIN, "tools/hanzi_lookup.js", "--at", str(rank)],
        cwd=ANKI_HANZI_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def build_pronunciation_and_front(definitions: list[dict]) -> tuple[str, str]:
    """Mechanical construction, no merging/pruning judgment — see module
    comment above. A reading whose pinyin starts uppercase is a surname/
    proper-noun sense (same convention as pick_example_words) and is
    excluded by default — but a character in the frequency corpus that
    happens to have ONLY a surname reading (e.g. 宋 — rank 988, whose only
    CC-CEDICT entry is "Song4") still gets a card rather than being skipped
    entirely, falling back to including it. Never silently drop a character
    the corpus considered common enough to include at all."""
    def extract(only_non_proper: bool) -> tuple[list[str], list[str]]:
        pron_parts, front_parts = [], []
        for d in definitions:
            py = d["pinyin"]
            if only_non_proper and py[:1].isupper():
                continue
            senses = [s.strip() for s in d["definition"].split("/")]
            # A proper-noun reading's own definition often leads with the
            # surname sense (e.g. "surname Song/the Song dynasty...") —
            # prefer a non-surname sense as the card's actual meaning when
            # one exists, rather than surfacing just "surname X".
            gloss = next((s for s in senses if not s.lower().startswith("surname")), senses[0])
            pron_parts.append(f"{to_tone(py)}, {py}")
            front_parts.append(f"{py.rstrip('0123456789')} ({gloss})")
        return pron_parts, front_parts

    pron_parts, front_parts = extract(only_non_proper=True)
    if not pron_parts:
        pron_parts, front_parts = extract(only_non_proper=False)
    return " / ".join(pron_parts), " / ".join(front_parts)


_UNUSABLE_COMPONENT_MEANINGS = {"n/a", "no glyph available"}


def build_components(components: dict, char: str, front: str) -> str:
    """Never skip a character for lacking usable components — a basic/
    atomic character (matching the existing convention seen in cards like
    一/002_一.json) is its own component when the tool's once/radical
    decomposition is entirely N/A."""
    def usable(entries):
        return [(e["component"], e["meaning"]) for e in entries if e["meaning"].strip().lower() not in _UNUSABLE_COMPONENT_MEANINGS]

    picked = usable(components.get("once", [])) or usable(components.get("radical", []))
    if not picked:
        # front may join multiple readings with " / " — take just the first
        # reading's gloss (first "(" to the next ")"), not everything up to
        # the last closing paren across all readings.
        own_gloss = front.split("(", 1)[1].split(")", 1)[0] if "(" in front else front
        picked = [(char, own_gloss)]
    return ", ".join(f"{c} ({m})" for c, m in picked)


def write_local_card_json(rank: int, char: str, pronunciation: str, front: str, components: str, note_id: int):
    # The only existing way to hand-fix a card's front/pronunciation/
    # components is edit this file, then rerun create_card.py on it — so an
    # auto-created card needs one too, or it has no path to ever being
    # hand-corrected.
    path = os.path.join(ANKI_HANZI_ROOT, "cards", f"{rank:03d}_{char}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "rank": rank,
            "front": front,
            "character": char,
            "pronunciation": pronunciation,
            "components": components,
            "examples": "",
            "note_id": note_id,
        }, f, ensure_ascii=False, indent=2)


def replenish_hanzi_new_cards(limit=None, settings=None):
    settings = settings if settings is not None else load_settings()
    target = get_new_cards_target(settings, "hanzi")
    word_count = get_setting(settings, "hanzi", "word_count")
    voice = get_setting(settings, "hanzi", "voice")

    current_new = len(sb_select_all("hanzi_cards", "select=note_id&or=(reps.eq.0,reps.is.null)"))
    shortfall = max(0, target - current_new)
    if limit is not None:
        shortfall = min(shortfall, limit)
    print(f"hanzi_cards: {current_new} new cards, target {target}, shortfall {shortfall}.")
    if shortfall == 0:
        return 0, 0, shortfall

    # A rank prefix can carry a letter suffix for a variant sharing another
    # card's rank (e.g. 041b_著.json alongside 041_着.json) — take only the
    # leading digits rather than assuming the whole prefix parses as int.
    local_ranks = [
        int(re.match(r"\d+", os.path.basename(p)).group())
        for p in glob.glob(os.path.join(ANKI_HANZI_ROOT, "cards", "*.json"))
    ]
    db_ranks = [r["rank"] for r in sb_select_all("hanzi_cards", "select=rank")]
    rank = max([*local_ranks, *db_ranks, 0]) + 1
    existing_chars = {r["character"] for r in sb_select_all("hanzi_cards", "select=character")}

    created = failed = 0
    scanned = 0
    attempts_budget = shortfall + 50  # safety valve against a systemic failure looping forever
    while created < shortfall and scanned < attempts_budget:
        result = {}

        def do_it(rank=rank, result=result):
            data = lookup_at_rank(rank)
            char = data.get("character")
            if not char or not _CJK_RE.fullmatch(char) or char in existing_chars:
                result["skip"] = True
                return
            # Never fail out on a character the corpus considered common
            # enough to include at all (e.g. rank 988, 宋 — every one of its
            # readings was a surname sense) — build_pronunciation_and_front
            # already falls back to the surname reading itself. As a final
            # backstop for the (unobserved so far) case of a fully-empty
            # definitions list, fall back further to the corpus's own raw
            # pinyin list, which is always present for any character it
            # returns at all.
            pronunciation, front = build_pronunciation_and_front(data["definitions"])
            if not pronunciation:
                pron_parts = [f"{to_tone(py)}, {py}" for py in data.get("pinyin", [])]
                pronunciation = " / ".join(pron_parts)
                front = " / ".join(f"{py.rstrip('0123456789')} (no definition available)" for py in data.get("pinyin", []))
            components = build_components(data["components"], char, front)

            note_id = next_negative_note_id()
            row = {
                "note_id": note_id, "character": char, "rank": rank,
                "pronunciation": pronunciation, "front": front, "components": components,
                "examples": "",  # never rendered for hanzi cards — daily_words is, instead
                "picture_url": None, "card_id": note_id,
                "interval": 0, "reps": 0, "lapses": 0, "factor": DEFAULT_FACTOR,
                "queue": 0, "due": 0, "type": 0, "mod": int(time.time()), "learning_step": None,
            }
            groups = pick_example_words(char, word_count, pronunciation)
            if any(groups):
                all_words = [w for g in groups for w, _ in g]
                row["daily_words"] = " / ".join("; ".join(f"{w} ({m})" for w, m in g) for g in groups)
                row["daily_words_audio_url"] = generate_word_list_audio(all_words, "hanzi-words", str(note_id), voice)
                row["daily_words_generated_at"] = datetime.now(timezone.utc).isoformat()
            row["audio_url"] = upload_wav(concat_with_pauses([char], voice), "hanzi-audio", char)

            sb_request("POST", "/rest/v1/hanzi_cards", body=row)
            write_local_card_json(rank, char, pronunciation, front, components, note_id)
            existing_chars.add(char)
            result.update(char=char, note_id=note_id)

        if with_retries(do_it, f"rank {rank}", "hanzi_cards", str(rank)):
            if result.get("skip"):
                print(f"  rank {rank}: skipped (non-CJK entry or duplicate character)")
            else:
                print(f"  rank {rank}: created {result['char']!r} (note_id {result['note_id']})")
                created += 1
        else:
            failed += 1
        rank += 1
        scanned += 1
    return created, failed, shortfall


HSK_LEVEL_ORDER = ["hsk1", "hsk2", "hsk3", "hsk4", "hsk5", "hsk6", "hsk7-9"]


def replenish_hsk3_new_cards(limit=None, settings=None):
    settings = settings if settings is not None else load_settings()
    target = get_new_cards_target(settings, "hsk3")
    max_chars = get_setting(settings, "hsk3", "sentence_max_chars")
    voice = get_setting(settings, "hsk3", "voice")

    current_new = len(sb_select_all("hsk3_words", "select=word&known=eq.true&or=(reps.eq.0,reps.is.null)"))
    shortfall = max(0, target - current_new)
    if limit is not None:
        shortfall = min(shortfall, limit)
    print(f"hsk3_words: {current_new} new cards, target {target}, shortfall {shortfall}.")
    if shortfall == 0:
        return 0, 0, shortfall

    created = failed = 0
    for level in HSK_LEVEL_ORDER:
        if created >= shortfall:
            break
        remaining = shortfall - created
        # Over-fetch for retry headroom without extra round trips per failure.
        # No ordinal column reflects true intra-level frequency order for an
        # unrevealed row (note_id is null until known) — word ASC just gives
        # a stable, deterministic "next," not a curriculum-accurate one.
        candidates = sb_select(
            "hsk3_words",
            f"select=word,meaning&level=eq.{level}&known=eq.false&order=word.asc&limit={remaining * 3}",
        )
        for row in candidates:
            if created >= shortfall:
                break
            word, meaning = row["word"], row.get("meaning")

            def do_it(word=word, meaning=meaning):
                sentence = generate_sentence(word, meaning or "", max_chars)
                sb_update_by("hsk3_words", "word", word, {
                    "known": True,
                    "interval": 0, "reps": 0, "lapses": 0, "factor": DEFAULT_FACTOR,
                    "queue": 0, "due": 0, "type": 0, "mod": int(time.time()),
                    "sentence": sentence,
                    "sentence_meaning": generate_translation(sentence, word, meaning),
                    "sentence_pinyin": generate_pinyin(sentence),
                    "sentence_audio_url": generate_audio_url(word, sentence, "hsk3-sentence-audio", word, voice),
                    "sentence_generated_at": datetime.now(timezone.utc).isoformat(),
                })

            if with_retries(do_it, word, "hsk3_words", word):
                print(f"  {word} ({level}): now known, initial sentence generated")
                created += 1
            else:
                failed += 1
    return created, failed, shortfall


# --- Screenshot-to-flashcard pipeline (random_words / idioms) -----------
#
# Uploaded from a phone via the upload icon on Bøtkjær.com's random_words or
# idioms deck-overview screen (a dictionary-app lookup popup: word + pinyin +
# definition) into the screenshot_queue table + mandarin-media/screenshots/
# storage prefix, tagged with which of the two decks it's destined for
# (target_source). Each pending row gets
# OCR'd locally (macOS Vision framework — no network call, no API key,
# consistent with the rest of this pipeline being fully local), the target
# word extracted by the local LLM, its meaning looked up (CC-CEDICT first,
# LLM fallback for slang CC-CEDICT doesn't have — verified during design:
# 成语/骆驼/昵称/赞美 all have entries, 内卷/摆烂 don't), and a new
# words_phrases row created — with its initial sentence/translation/audio
# generated immediately, since a reps=0 card is invisible to
# refresh_words_phrases()'s due-cycle scan (is_due_today() returns False
# for reps==0) until it's actually reviewed once.

_next_negative_wp_note_id = None


def next_negative_wp_note_id() -> int:
    """Same convention as the two create_card.py scripts' own
    next_negative_note_id(), but scoped to words_phrases specifically —
    daily_refresh.py only ever imports the Anki 汉字/create_card.py sibling
    (which scopes its version to hanzi_cards), not the separate "Anki
    random words" one, so this can't just be reused via that import."""
    global _next_negative_wp_note_id
    if _next_negative_wp_note_id is None:
        existing = sb_select("words_phrases", "select=note_id&note_id=lt.0&order=note_id.asc&limit=1")
        _next_negative_wp_note_id = (existing[0]["note_id"] - 1) if existing else -1
    note_id = _next_negative_wp_note_id
    _next_negative_wp_note_id -= 1
    return note_id


def ocr_image(image_path: str) -> str:
    """Local OCR via macOS Vision framework — no network call, no API key.
    Returns raw recognized text, one block per line, in Vision's default
    top-to-bottom ordering. Callers must not assume any particular field
    order (a dictionary popup's OCR dump mixes the word/pinyin/definition
    with UI chrome in whatever order Vision detects text blocks) — the LLM
    extraction step handles that."""
    url = NSURL.fileURLWithPath_(image_path)
    source = Quartz.CGImageSourceCreateWithURL(url, None)
    cg_image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)

    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLanguages_(["zh-Hans", "zh-Hant", "en-US"])
    # A dictionary popup is an isolated word, not prose — language
    # correction is more likely to "fix" a rare-but-correct character into
    # a common one than to help. Revisit after seeing real screenshots.
    request.setUsesLanguageCorrection_(False)

    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg_image, {})
    success, error = handler.performRequests_error_([request], None)
    if not success:
        raise RuntimeError(f"Vision OCR failed: {error}")

    lines = []
    for result in request.results():
        candidate = result.topCandidates_(1)[0]
        lines.append(candidate.string())
    return "\n".join(lines)


# A Pleco-style dictionary card's headword line OCRs as the CJK word
# immediately followed by its own pinyin with no space (e.g. "交易jiaoyi")
# — measured directly: the small local LLM asked to pick the queried word
# out of a noisy OCR dump reliably grabs the surrounding example sentence
# instead (感觉短线交易 for a screenshot that only ever queried 交易), even
# with an explicit instruction and worked structural description of where
# the real headword sits. This is a plain regex + a pinyin cross-check
# instead of asking the LLM to do spatial reasoning it can't reliably do.
_WORD_PINYIN_LINE_RE = re.compile(r"^([一-鿿]{1,6})([a-zA-Zàáǎāèéěēìíǐīòóǒōùúǔūüǖǘǚǜ]+)$")


def _extract_word_from_pinyin_line(raw_text: str) -> str | None:
    for line in raw_text.splitlines():
        m = _WORD_PINYIN_LINE_RE.fullmatch(line.strip())
        if not m:
            continue
        candidate, ocr_pinyin = m.group(1), m.group(2)
        expected = "".join(s[0] for s in pinyin(candidate, style=Style.NORMAL)).lower()
        if expected == ocr_pinyin.lower():
            return candidate
    return None


def extract_word_and_meaning_from_ocr(raw_text: str) -> tuple[str | None, str | None]:
    """Raw OCR text from a dictionary-popup screenshot includes UI chrome
    (button labels, app name, status bar text) alongside the actual
    word/pinyin/definition. First tries the deterministic headword+pinyin
    line match above; only asks the LLM to pick out the target Chinese word
    (the one being looked up, not any word incidentally appearing inside
    the definition) when that fails (e.g. a dictionary app whose popup
    doesn't put word and pinyin on one unspaced line). Also asks the LLM
    for the definition shown, if present — a real dictionary popup usually
    shows one, and it's more authoritative than re-deriving one afterward
    (CC-CEDICT's generic first sense, or the LLM's own guess), since it's
    literally what the app said for that specific word/sense. Returns
    (None, None) for a word it can't identify, or (word, None) when no
    usable definition is visible in the OCR text — callers fall through to
    lookup_word_meaning()/generate_meaning() then."""
    # A non-dictionary-popup screenshot (a random photo, a blank/noise
    # image) often OCRs to nothing at all — measured: the LLM hallucinated
    # a plausible-looking word ("查询", "query/search") rather than
    # admitting it found nothing, when asked to extract a word from empty
    # input. Short-circuit before the LLM ever sees an empty prompt.
    if not raw_text.strip():
        return None, None

    deterministic_word = _extract_word_from_pinyin_line(raw_text)
    prompt = (
        f"下面是一张词典查询截图经过OCR识别出的文字，混有界面按钮文字、应用名称、"
        f"以及一整句被查询词语所在的原文/例句等无关内容。这类截图通常同时包含："
        f"(a) 一整句原文或例句，其中被查询的词会被高亮标出，字体可能很大；"
        f"(b) 词典释义卡片，卡片开头是被查询的确切词语（通常只有1到4个字），"
        f"紧跟着这个词的拼音注音，然后是词性（VERB/NOUN等）和英文释义。\n\n"
        f"请完成两件事：\n"
        f"1. 找出词典释义卡片里作为词条标题的那个确切词语——就是紧跟在拼音注音"
        f"前面的那几个字。不要输出它所在的那一整句原文或例句，也不要输出比"
        f"这个词条标题更长的短语，即使那句话里的字体更大更醒目。\n"
        f"2. 把词典释义卡片里这个词的释义整理成简短的英文释义；"
        f"如果截图里根本没有释义卡片，就写\"无\"。\n\n"
        f"严格按照这个格式输出，不要输出其他任何文字：\n"
        f"词语：<词语>\n"
        f"释义：<英文释义或\"无\">\n\n"
        f"OCR识别文字：\n{raw_text}"
    )
    out = llm().create_chat_completion(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=80,
        temperature=0.0,
    )
    text = out["choices"][0]["message"]["content"].strip()

    word_match = re.search(r"词语[：:]\s*(\S+)", text)
    word = word_match.group(1).strip() if word_match else None
    if word and not _CJK_RE.fullmatch(word):
        word = None
    # The deterministic headword+pinyin match is more trustworthy than the
    # LLM's own answer whenever it fired — override rather than only using
    # it as a fallback, since the LLM picks the wrong span even when it
    # technically "succeeds" (returns something that passes the CJK check).
    if deterministic_word:
        word = deterministic_word

    meaning_match = re.search(r"释义[：:]\s*(.+)", text)
    meaning = meaning_match.group(1).strip() if meaning_match else None
    if meaning in (None, "无", ""):
        meaning = None
    elif _CJK_RE.search(meaning):
        # Ignored the "English" instruction — safer to discard than store a
        # non-English value in an English-only field; the fallback chain
        # supplies one instead.
        meaning = None

    return word, meaning


def clean_idiom_meaning(meaning: str) -> str:
    """CC-CEDICT tags most chengyu entries with a trailing "(idiom)" or
    "(proverb)" (e.g. "dripping water penetrates the stone (idiom);
    constant perseverance yields success", "love at first sight (idiom)")
    — redundant on this deck, which already shows a 成语/谚语 badge on the
    card itself. Converts "literal (idiom); figurative" to the deck's own
    "literal (figurative)" convention, or just drops a trailing tag with
    nothing after it."""
    m = re.match(r"^(.*?)\s*\((?:idiom|proverb)\)\s*;\s*(.+)$", meaning, re.IGNORECASE)
    if m:
        return f"{m.group(1).strip()} ({m.group(2).strip()})"
    return re.sub(r"\s*\((?:idiom|proverb)\)\s*", " ", meaning, flags=re.IGNORECASE).strip()


def lookup_word_meaning(word: str) -> str | None:
    """CC-CEDICT lookup via tools/word_lookup.js — the dictionary-first half
    of a dictionary-first/LLM-fallback meaning lookup. Returns None on a
    miss (e.g. newer slang CC-CEDICT doesn't have) rather than raising, so
    the caller can fall back to generate_meaning()."""
    result = subprocess.run(
        [NODE_BIN, "tools/word_lookup.js", word],
        cwd=ANKI_HANZI_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout.strip().splitlines()[-1])
    return data.get("meaning")


def generate_meaning(word: str, idiom_style: bool = False) -> str:
    """LLM fallback for a word CC-CEDICT has no entry for. Same CJK-leak
    problem as generate_translation — asking for "English only" isn't
    reliably followed by this small model (measured: it answered entirely
    in Chinese for 内卷, ignoring the instruction) — so this needs the same
    detect-and-retry-with-multi-turn-correction fix, not just a bigger
    "please" in the prompt.

    idiom_style asks for "literal translation (figurative meaning)" —
    matching CC-CEDICT's own convention for chengyu it does have an entry
    for (e.g. "dripping water penetrates the stone (idiom); constant
    perseverance yields success") — needed specifically for the idioms
    deck's longer 谚语/sayings CC-CEDICT usually has no entry for at all, so
    this LLM fallback is their only source; a bare figurative gloss alone
    (e.g. just "to achieve great success" for 鲤鱼跃龙门) drops the literal
    image that's half the point of learning the saying."""
    if idiom_style:
        prompt = (
            f"用简短的英文解释中文成语/谚语\"{word}\"的意思，格式必须是："
            f"先给出直译，再在括号里给出它的比喻/实际含义。例如\"水滴石穿\"的"
            f"释义要写成\"dripping water wears through a stone (constant "
            f"perseverance yields success)\"这样的格式。只输出这一行英文释"
            f"义，不要输出拼音、例句或中文。"
        )
    else:
        prompt = f"用简短的英文解释中文词语\"{word}\"的意思，就像词典释义一样简洁。只输出英文释义，不要输出拼音或例句。"
    messages: list[dict] = [{"role": "user", "content": prompt}]
    meaning = ""
    for attempt in range(TRANSLATION_REPAIR_ATTEMPTS):
        out = llm().create_chat_completion(
            messages=messages,
            max_tokens=70,
            temperature=0.3,
        )
        meaning = out["choices"][0]["message"]["content"].strip()
        # Naturally quoting the word itself (e.g. '"内卷" refers to...') is
        # normal for a definition, not a leak — check for CJK outside that.
        if not _CJK_RE.search(meaning.replace(word, "")):
            return meaning
        messages.append({"role": "assistant", "content": meaning})
        messages.append({
            "role": "user",
            "content": "That is wrong — you answered in Chinese instead of English. Write the English definition only, with no Chinese characters at all.",
        })
    raise ValueError(f"meaning still contains Chinese after {TRANSLATION_REPAIR_ATTEMPTS} attempts: {meaning!r}")


def download_image(url: str) -> str:
    """Plain HTTP GET (not sb_request, which always json.loads()s the body
    and would break on binary) to a temp file for Vision to read."""
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
        with open(path, "wb") as f:
            f.write(resp.read())
    return path


def process_screenshot_queue(limit=None, settings=None):
    settings = settings if settings is not None else load_settings()

    pending = sb_select_all(
        "screenshot_queue",
        "select=id,storage_path,image_url,attempts,target_source&status=eq.pending",
    )
    if limit is not None:
        pending = pending[:limit]
    print(f"screenshot_queue: {len(pending)} pending.")

    existing_words = {row["word"] for row in sb_select_all("words_phrases", "select=word")}

    ok = failed = 0
    for item in pending:
        qid = item["id"]
        # Defensive default — pre-migration rows and anything else
        # unexpected fall back to random_words, the only deck this ever
        # targeted before the idioms upload button existed.
        target_source = item.get("target_source") or "random_words"
        voice = get_setting(settings, target_source, "voice")
        max_chars = get_setting(settings, target_source, "sentence_max_chars")
        result = {}

        def do_it(item=item, qid=qid, result=result, target_source=target_source, voice=voice, max_chars=max_chars):
            image_path = download_image(item["image_url"])
            try:
                raw_text = ocr_image(image_path)
            finally:
                os.remove(image_path)

            word, screenshot_meaning = extract_word_and_meaning_from_ocr(raw_text)
            if not word:
                raise ValueError(f"could not extract a word from OCR text: {raw_text[:200]!r}")

            if word in existing_words:
                # Not a failure — a legitimate skip, checked across all
                # words_phrases sources (not just random_words), since a
                # word already in e.g. idioms would still look like a
                # duplicate card in the deck browser either way.
                sb_update_by("screenshot_queue", "id", qid, {
                    "status": "done",
                    "extracted_word": word,
                    "error": "duplicate — word already exists in words_phrases",
                    "processed_at": datetime.now(timezone.utc).isoformat(),
                })
                sb_request("DELETE", f"/storage/v1/object/{MANDARIN_MEDIA_BUCKET}/{item['storage_path']}")
                result["skipped"] = word
                return

            # Priority: the screenshot's own definition (most authoritative
            # — literally what the dictionary app said for this word/sense)
            # > CC-CEDICT's generic first sense > LLM guess as a last resort.
            meaning = screenshot_meaning or lookup_word_meaning(word) or generate_meaning(word, idiom_style=(target_source == "idioms"))
            if target_source == "idioms":
                meaning = clean_idiom_meaning(meaning)
            note_id = next_negative_wp_note_id()
            # category only applies to the idioms deck, distinguishing a
            # fixed four-character 成语 ("idiom") from any other length
            # 谚语/saying — verified against every existing idioms-deck card
            # (all 4-character words are "idiom", everything else "saying",
            # no exceptions) rather than assumed.
            category = ("idiom" if len(word) == 4 else "saying") if target_source == "idioms" else None
            row = {
                "note_id": note_id,
                "source": target_source,
                "word": word,
                "pinyin": generate_word_pinyin(word),
                "meaning": meaning,
                "category": category,
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
            sb_request("POST", "/rest/v1/words_phrases", body=row)

            # Generate the initial sentence/translation/audio immediately —
            # a fresh reps=0 card is invisible to refresh_words_phrases()'s
            # due-cycle scan indefinitely (is_due_today() returns False for
            # reps==0), same shape as today's hanzi_cards daily_words bug.
            sentence = generate_sentence(word, meaning, max_chars)
            sb_update_by("words_phrases", "note_id", note_id, {
                "example": sentence,
                "example_meaning": generate_translation(sentence, word, meaning),
                "example_pinyin": generate_pinyin(sentence),
                "example_audio_url": generate_audio_url(word, sentence, "wordphrase-sentence-audio", str(note_id), voice),
                "example_generated_at": datetime.now(timezone.utc).isoformat(),
            })

            sb_update_by("screenshot_queue", "id", qid, {
                "status": "done",
                "extracted_word": word,
                "note_id": note_id,
                "processed_at": datetime.now(timezone.utc).isoformat(),
            })
            existing_words.add(word)
            result["word"] = word
            result["note_id"] = note_id

            # Clean up the uploaded screenshot now that it's a real card —
            # screenshot_queue keeps extracted_word/note_id/created_at as
            # the audit trail even after the image itself is gone.
            sb_request("DELETE", f"/storage/v1/object/{MANDARIN_MEDIA_BUCKET}/{item['storage_path']}")

        label = item["image_url"].rsplit("/", 1)[-1]
        if with_retries(do_it, label, "screenshot_queue", str(qid)):
            if "skipped" in result:
                print(f"  {label}: skipped (duplicate word {result['skipped']!r})")
            else:
                print(f"  {label}: created {result['word']!r} (note_id {result['note_id']})")
            ok += 1
        else:
            sb_update_by("screenshot_queue", "id", qid, {
                "status": "failed",
                "attempts": (item.get("attempts") or 0) + MAX_ATTEMPTS,
                "processed_at": datetime.now(timezone.utc).isoformat(),
            })
            failed += 1
    return ok, failed, len(pending)


# --- Push notification (Web Push, for the iOS PWA) -------------------

def send_notification(title: str, body: str):
    from pywebpush import webpush, WebPushException

    vapid_private = ENV.get("VAPID_PRIVATE_KEY")
    vapid_subject = ENV.get("VAPID_SUBJECT")
    if not vapid_private or not vapid_subject:
        print("  (skipping notification — VAPID keys not set in .env)")
        return

    subs = sb_select("push_subscriptions", "select=endpoint,p256dh,auth")
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=json.dumps({"title": title, "body": body}),
                vapid_private_key=vapid_private,
                vapid_claims={"sub": vapid_subject},
            )
        except WebPushException as e:
            # 404/410 means the subscription is stale (uninstalled, expired) — drop it.
            if e.response is not None and e.response.status_code in (404, 410):
                sb_request("DELETE", f"/rest/v1/push_subscriptions?endpoint=eq.{urllib.parse.quote(sub['endpoint'], safe='')}")
            else:
                print(f"  Notification failed: {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--notify", action="store_true", help="send a push notification with the results")
    args = parser.parse_args()

    # Each step used to run unguarded in one big try/except BaseException —
    # a step-level crash (e.g. sb_request exhausting its retries) aborted
    # every later step AND threw away the ok/failed counts already earned by
    # completed steps, leaving the night's notification as a bare "ran into
    # an error" even after several genuine successes. Now each step is
    # isolated: a crash skips just that one step (logged below) and every
    # other step still runs, so the final notification always reflects real
    # totals instead of an all-or-nothing pass/fail.
    steps_crashed = []
    run_started = datetime.now(timezone.utc)

    def run_step(name, fn, default):
        try:
            return fn(args.limit, settings)
        except Exception as e:
            print(f"ERROR: {name} step crashed ({type(e).__name__}: {e}), skipping to the next step.")
            steps_crashed.append(name)
            return default

    # A heartbeat row, independent of --notify — a Vercel cron watchdog
    # (/api/pipeline-watchdog) checks this table to catch the case this
    # script can never report on its own: it never even started (Mac
    # asleep/off/dead battery, launchd never fired, a broken venv). Best
    # effort on both ends — a Supabase hiccup here must never abort the
    # actual refresh work.
    run_id = None
    try:
        run_id = sb_insert("pipeline_runs", {})[0]["id"]
    except Exception as e:
        print(f"  (failed to record run start: {e})")

    def update_run(status: str, summary: str | None = None):
        if run_id is None:
            return
        try:
            patch = {"status": status}
            if summary is not None:
                patch["summary"] = summary
            if status != "running":
                patch["completed_at"] = datetime.now(timezone.utc).isoformat()
            sb_request("PATCH", f"/rest/v1/pipeline_runs?id=eq.{run_id}", body=patch)
        except Exception as e:
            print(f"  (failed to update run heartbeat: {e})")

    try:
        settings = load_settings()
    except BaseException:
        update_run("crashed", "Couldn't even load settings.")
        if args.notify:
            try:
                send_notification("Card update failed", "The daily card update couldn't even load settings.")
            except Exception as e:
                print(f"  Failure notification itself failed: {e}")
        raise

    screenshot_ok, screenshot_failed, screenshot_count = run_step("screenshots", process_screenshot_queue, (0, 0, 0))
    hsk3_ok, hsk3_failed, hsk3_due = run_step("hsk3 refresh", refresh_hsk3, (0, 0, 0))
    hsk3_added, hsk3_add_failed, hsk3_shortfall = run_step("hsk3 replenish", replenish_hsk3_new_cards, (0, 0, 0))
    wp_ok, wp_failed, wp_due = run_step("words_phrases refresh", refresh_words_phrases, (0, 0, 0))
    hanzi_ok, hanzi_failed, hanzi_due = run_step("hanzi refresh", refresh_hanzi, (0, 0, 0))
    hanzi_added, hanzi_add_failed, hanzi_shortfall = run_step("hanzi replenish", replenish_hanzi_new_cards, (0, 0, 0))

    total_due = hsk3_due + wp_due + hanzi_due
    total_ok = screenshot_ok + hsk3_ok + wp_ok + hanzi_ok + hsk3_added + hanzi_added
    total_failed = (
        hsk3_failed + wp_failed + hanzi_failed + screenshot_failed
        + hsk3_add_failed + hanzi_add_failed
    )
    added_bits = []
    if hanzi_added:
        added_bits.append(f"+{hanzi_added} hanzi")
    if hsk3_added:
        added_bits.append(f"+{hsk3_added} hsk3")
    parts = []
    if added_bits:
        parts.append("added " + ", ".join(added_bits))
    parts.append(f"{total_ok} updated")
    parts.append(f"{total_due} due")
    if total_failed:
        parts.append(f"{total_failed} failed")
    if steps_crashed:
        parts.append(f"crashed: {', '.join(steps_crashed)}")
    elapsed_min = round((datetime.now(timezone.utc) - run_started).total_seconds() / 60)
    parts.append(f"took {elapsed_min}m" if elapsed_min >= 1 else "took <1m")
    summary = " · ".join(parts)
    update_run("issues" if (total_failed or steps_crashed) else "ok", summary)

    if args.notify:
        title = "Daily card update" if not total_failed and not steps_crashed else "Daily card update (with issues)"
        send_notification(title, summary)


if __name__ == "__main__":
    main()

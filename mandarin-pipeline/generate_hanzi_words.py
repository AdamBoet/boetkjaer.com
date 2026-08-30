"""CLI wrapper so create_card.py (plain env, no Kokoro) can get an initial
daily_words/daily_words_audio_url for one brand-new hanzi card by shelling
out to this venv. Prints a single JSON line to stdout; non-zero exit on
failure.

Usage: python3 generate_hanzi_words.py <character> <note_id> [pronunciation]
"""
import json
import sys

from daily_refresh import pick_example_words, generate_word_list_audio

if __name__ == "__main__":
    character, note_id = sys.argv[1], sys.argv[2]
    pronunciation = sys.argv[3] if len(sys.argv) > 3 else ""
    groups = pick_example_words(character, pronunciation=pronunciation)
    daily_words = " / ".join(
        "; ".join(f"{word} ({meaning})" for word, meaning in group) for group in groups
    )
    all_words = [w for group in groups for w, _ in group]
    print(json.dumps({
        "daily_words": daily_words,
        "daily_words_audio_url": generate_word_list_audio(all_words, "hanzi-words", note_id),
    }, ensure_ascii=False))

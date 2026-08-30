# Anki 汉字 — Reference

Directory layout, JSON schema, the lookup tool's CLI, card layout, and worked examples. Read this before running the lookup tool or creating a card file for the first time in a session.

---

## Directory Structure

```
mandarin-pipeline/
├── prompt.md              workflow entry point
├── docs/
│   ├── rules.md           formatting rules, separators, edge cases
│   └── reference.md       this file
├── create_card.py         pushes cards/*.json straight to Supabase (hanzi_cards table) — stays at root, run constantly
├── daily_refresh.py       nightly automated pipeline (sentence/audio refresh, new-card replenishment, screenshot capture)
├── generate_hanzi_words.py  CLI shim create_card.py shells out to for a new card's initial daily_words
├── cards/                 one JSON file per character: [rank:03d]_[character].json
├── models/                local LLM (gguf) used by daily_refresh.py
└── tools/
    ├── package.json       single dependency: `hanzi` (npm)
    └── hanzi_lookup.js    local lookup CLI — see "Lookup Tool" below
```

Card audio (macOS `say` + `afconvert`) uploads straight to the `mandarin-media` Supabase Storage bucket — no AnkiConnect, no stroke-order GIF; those were retired when this deck moved off Anki.

---

## Lookup Tool (`tools/hanzi_lookup.js`)

Wraps the `hanzi` npm package (same author/dataset as hanzicraft.com) for fast, offline, reliable lookups. It supplies **raw candidate data only** — it does not apply the simplicity rule, does not pick which example illustrates which reading, and does not substitute non-renderable components. Those stay manual judgment calls (see `rules.md`).

| Mode | Command | Returns |
|---|---|---|
| Batch research | `node tools/hanzi_lookup.js 差 修 射` | One JSON object per character: `frequencyRank`, `pinyin`, `definitions` (raw, per reading), `components.once` / `components.radical` (each with resolved `meaning`), `examples.high` / `.medium` / `.low` |
| Resolve by rank | `node tools/hanzi_lookup.js --at 756` | The character occupying that frequency position, plus its full lookup data |
| Rank audit | `node tools/hanzi_lookup.js --verify-ranks` | `{ totalCards, mismatches: [...] }` — read-only scan of all `cards/*.json` against the offline corpus |

Notes on interpreting the output:
- **`definitions`** are grouped by pinyin reading but **not pre-collapsed** — apply the simplicity rule yourself.
- **`components.once`** is the first-level decomposition to prefer. A component/meaning of `"No glyph available"` / `"N/A"` means this dataset (same as hanzicraft.com) has a gap — fall back to `components.radical`, then to Wiktionary.
- **`examples`** tiers are ranked by corpus frequency but not split by which reading of a polyphonic character they illustrate — pick per-reading examples yourself from the candidates.

---

## JSON Card Format

File: `cards/[rank:03d]_[character].json`

```json
{
  "rank": 6,
  "front": "ren (person; people)",
  "character": "人",
  "pronunciation": "rén, ren2",
  "components": "人 (basic character)",
  "examples": "人们 (people); 大人 (adult); 人口 (population)"
}
```

`note_id` is added automatically by `create_card.py` after the first push — never set it manually.

---

## Card Layout

**Front:**
```
[romanization1] / [romanization2] / ... ([meaning1] / [meaning2] / ...)
```
No tone marks on romanization.

**Back:**
```
[character]
Pronunciation: [pinyin-tone], [pinyin-number] / [pinyin-tone2], [pinyin-number2] / ...
Components: [component字 (meaning)], [component字 (meaning)], ...
Examples: [example字 (meaning1; meaning2)]; [example字 (meaning)]; ...
```
(Rendered stroke-order/writer animation is drawn client-side by the site itself, not fetched or stored per card.)

---

## Example Cards

**Single pronunciation, basic-character component:**

Front: `ni (you)`
Back:
```
你
Pronunciation: nǐ, ni3
Components: 亻(person), 尔 (you — classical)
Examples: 你好 (hello); 你们 (you all; you guys)
[stroke order animation]
```

**Same-romanization collision (two readings share toneless spelling):**

Front: `hao (good; okay / to like)`
Back:
```
好
Pronunciation: hǎo, hao3 / hào, hao4
Components: 女 (woman), 子 (child)
Examples: 好人 (good person); 好吗 (okay?) / 爱好 (hobby); 好奇 (curious)
[stroke order animation]
```

**Character is itself a Kangxi radical:**

Front: `jiao (angle; horn) / jue (role)`
Back:
```
角
Pronunciation: jiǎo, jiao3 / jué, jue2
Components: 角 (basic character — horn radical)
Examples: 角度 (angle) / 主角 (leading role)
[stroke order animation]
```

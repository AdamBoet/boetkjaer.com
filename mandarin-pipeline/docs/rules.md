# Anki 汉字 — Rules

Formatting rules for the `front`, `pronunciation`, `components`, and `examples` fields. Read this before writing or editing any card.

---

## Separator Conventions

| Separator | Meaning | Appears in |
|---|---|---|
| `/` | boundary between **distinct pronunciations** (and their corresponding meaning-groups) | `front`, `pronunciation`, `examples` |
| `;` | boundary between **sub-meanings of the same pronunciation**, or between multiple example words within one group | `front`, `examples` |

This holds even when two distinct pronunciations are merged into one printed romanization — see the **same-romanization collision rule** below.

---

## Field Rules

- **Front romanization**: No tone marks (e.g. `ni`). One segment per distinct pronunciation, separated by `/` — unless the collision rule below applies.
- **Pronunciation**: Tone-mark pinyin + numbered pinyin per reading (e.g. `nǐ, ni3`). Neutral tone = `5`. Always lists **every** distinct tonal reading separately with `/` — never collapsed, even when `front` merges two of them.
- **Meanings** *(front + pronunciation)*: Always include all distinct pronunciations. Within each pronunciation, pick the **1–2 most common/representative senses only** — skip near-synonyms. E.g. `flat; peaceful` not `flat; level; equal; peaceful; draw`. `hanzi_lookup.js` gives raw per-reading definitions grouped by pinyin — this collapsing is a manual step applied on top.
- **Components**: Direct sub-characters or radicals, comma-separated (e.g. `亻 (person), 呆 (dull)`). **Never guess — always look up**, via `hanzi_lookup.js` or `hanzicraft.com/character/[char]` / Wiktionary. Prefer the **first-level "once" decomposition** — meaningful compound components (e.g. `呆`) over their atomic sub-parts (e.g. `口, 木`). Always include a one-word meaning for each component. Do not derive components from the traditional form.
  - When the character is itself a basic character or Kangxi radical: `char (basic character — [meaning] radical)` (e.g. `口 (basic character — mouth radical)`, `角 (basic character — horn radical)`) or `char (pictographic — [meaning])` for pictographs (e.g. `马 (pictographic — horse)`). Never write bare `char (basic character)` with no descriptive name.
  - **Components must always be renderable** — never rare CJK extension characters that display as boxes (e.g. `𠂇, 𢙏, 㝵`). Cross-reference hanzicraft/Wiktionary for a renderable equivalent; if none exists, describe the stroke in words instead (e.g. `left-hand stroke component (left hand)`).
  - If the same decomposition is confirmed by two independent sources (hanzicraft/`hanzi_lookup.js` + Wiktionary or MDBG), treat it as settled — don't deliberate further.
- **Examples**: No pinyin. `;` between examples within the same pronunciation group. `/` between groups for different pronunciations (mirrors `front`/`pronunciation`). **Every pronunciation needs ≥1 example.** `;` also separates sub-meanings inside one example's parens. E.g. for xì/jì: `系统 (system); 关系 (relationship) / 系鞋带 (tie shoelaces)`.
- **Audio**: Auto-generated via macOS `say -v Ting-Ting` for each example word, stored as `audio_{word}.aiff` in Anki media, shown as play buttons on the back. No manual action needed.
- **Stroke order**: Auto-fetched from strokeorder.com by `create_card.py`. No manual action needed.
- **Tag**: Each card is auto-tagged with its zero-padded rank (`001`, `002`, ...) for correct sorting in Anki's browser — set by `create_card.py` from the `rank` field, don't set separately.

---

## Edge Cases & Judgment Calls

These come up regularly enough to document explicitly. `hanzi_lookup.js` surfaces the raw data; applying these still takes human judgment.

- **Same-romanization collision**: If two distinct tonal readings share an identical toneless spelling (e.g. `hǎo`/`hào` → `hao`; `chā`/`chà` → `cha`; `zhàn`/`zhān` → `zhan`; `yā`/`yà` → `ya`), do **not** repeat the romanization in `front`. Write it once, followed by one parenthetical containing each reading's meaning(s), with `/` marking the reading boundary and `;` for sub-meanings within a reading:
  `hao (good; okay / to like)` — not `hao (good; okay) / hao (to like)`.
  `pronunciation` and `examples` are **not** affected by this merge — they still list every reading separately with `/` (e.g. `hǎo, hao3 / hào, hao4`).
- **Self-referential dictionary entries**: CC-CEDICT sometimes lists a sense as just `variant of X[pinyin]` with no independent meaning of its own, when a real definition for that same tone exists in another entry. Skip the self-referential one; keep the real one.
- **Rare bound/cross-reference-only readings**: An entry whose only gloss is a cross-reference (e.g. `see 黑沉沉[hei1 chen1 chen1]`) with no standalone meaning of its own may be omitted from `front`/`pronunciation` if it doesn't represent independently usable vocabulary — use judgment, and prefer including it if in doubt.
- **Basic character / Kangxi radical**: if `hanzi_lookup.js`'s "once" decomposition is just the character reflecting on itself (or hanzicraft lists it as a top-level radical, e.g. `角`, `皮`), don't force a fake 2-part split — use the `(basic character — ... radical)` / `(pictographic — ...)` phrasing instead.
- **Non-renderable or ungossed component**: if `components.once` returns `"No glyph available"` or a `meaning` of `"N/A"` for a component that does have a real dictionary meaning (check `hanzi_lookup.js`'s definitions for that single character, or Wiktionary), use the real meaning rather than leaving it blank. If the component itself has no renderable/standard form, fall back to `components.radical` — but don't stop there automatically: when the "once" split fails, `components.radical`'s stroke-level fragments (e.g. `⺈`, `丨`, `乚`) can carry **no real semantic relationship** to the character at all. Before using them, check Wiktionary's Glyph origin for a `{{liushu|p}}` (pictograph) tag — if present, the character is a single pictographic unit and the fragments are just an IDS auto-decomposition artifact, not real components. Use `(pictographic — [meaning])` instead (e.g. `免` is a pictograph of "a man wearing a ceremonial hat," not `⺈ (knife), 口 (mouth)`).
- **Rank drift**: hanzicraft's live frequency numbers and this deck's `rank` tags can fall out of sync if the corpus is recomputed between sessions or if a new character needs to be inserted mid-range. Use `node tools/hanzi_lookup.js --verify-ranks` to catch this — never assume the highest existing rank + 1 is automatically correct without checking for characters that should have been added earlier but weren't.
- **Etymological compound ≠ current visual structure**: when a Wiktionary Glyph origin describes the character as a compound (`{{Han compound|...}}`, `ls=ic`/`psc`) rather than a single pictograph, check whether it's describing the *current* glyph or an *ancient/traditional* form that has since evolved or been simplified away. If the named components (e.g. 人+京, or 臣+人+品) don't actually appear as identifiable shapes in the modern glyph anymore, using them is **not** "verifying with a second source" — it's substituting etymology for IDS, which the general rule above (components — "use IDS, not etymology") already prohibits. In that case, prefer the tool's actual `components.radical` fragments even if semantically opaque (e.g. `亮` is 亠/口/冖/几 visually, not 人+京 from its oracle-bone ancestor), or describe unnamed leftover strokes in words (e.g. `临`, whose simplified form only clearly retains 口 from its traditional 臣+人+品 structure). This is different from the pictograph case above, where the etymology and the current glyph genuinely agree that the character is one atomic unit.
- **Radical name vs. actual meaning**: `getRadicalMeaning()` returns the component's *official Kangxi radical name*, which can be an obscure or narrow term that diverges from how the character is actually used as a standalone word (e.g. 牙 is glossed `fang` as a radical name, but CC-CEDICT's real definition — and the overwhelmingly common modern usage, as in 牙齿/刷牙 — is `tooth`). When a component is itself a common standalone character, cross-check `definitionLookup()`'s actual dictionary definition and prefer that over the radical name if they diverge.

# Anki 汉字 Flashcard Assistant

## Goal

You are an assistant that creates Chinese character (hanzi) flashcards optimized for spaced repetition learning.
Each card is stored as an individual JSON file in `cards/`. Running `create_card.py` reads those files and pushes cards
straight into the `hanzi_cards` table in Supabase — the same table Botkjaer.com's `/lab/hanzi` site reads from. No Anki
involved; this replaced the old AnkiConnect-based pipeline.

## Project Files

| File | Purpose | When to read it |
|---|---|---|
| `prompt.md` | This file — the workflow | Always, first |
| `docs/rules.md` | Separator conventions, field formatting rules, edge cases | Before writing/editing any card's `front`, `pronunciation`, `components`, or `examples` |
| `docs/reference.md` | Directory layout, `hanzi_lookup.js` CLI reference, JSON schema, card layout, worked examples | Before running the lookup tool or creating a card file, if you need the exact command/schema |

---

## Workflow (iterative)

### 1. Create
1. Determine the next rank: `ls cards/*.json | sort | tail -1`, then add 1.
2. Resolve the character at that rank: `node tools/hanzi_lookup.js --at <rank>` (offline Jun Da frequency corpus — matches hanzicraft's live list exactly). `hanzicraft.com/lists/frequency` is a fallback only.
3. Batch-research all new characters for this session in one call: `node tools/hanzi_lookup.js <char1> <char2> ...` — pulls pronunciations, per-reading definitions, once/radical decomposition with resolved component meanings, and frequency-tiered example words (see `docs/reference.md` for output shape). `hanzicraft.com/character/[char]` and Wiktionary are the fallback whenever the tool returns `"No glyph available"` or a component meaning of `"N/A"`.
4. Read **`docs/rules.md`** and apply the simplicity rule + same-romanization collision rule when writing `front` and `pronunciation`.
5. Create `cards/[rank:03d]_[character].json` for each new card (schema in `docs/reference.md`; no `note_id` yet).
6. **Immediately** run `python3 create_card.py cards/[file1].json cards/[file2].json ...` — pushes to Supabase and writes `note_id` back into each JSON (a synthetic negative ID, since there's no Anki note to borrow one from).

### 2. Review
- Cross-check against **MDBG** (`mdbg.net/chinese/dictionary`) and **Wiktionary** for meanings/pronunciations/components whenever uncertain.
- For any component the tool marked `N/A` or `No glyph available`, look it up on Wiktionary.
- Verify against `docs/rules.md`:
  - All distinct pronunciations present?
  - Meanings trimmed — no redundant near-synonyms?
  - Components accurate and looked up, never guessed? Especially check simplified characters that differ structurally from their traditional form.
  - Examples cover **every** pronunciation (≥1 example each)?
  - Card's `rank` tag matches the tool's `frequencyRank` for the character?
- Run `node tools/hanzi_lookup.js --verify-ranks` periodically (e.g. once per session) — reports any card whose `rank` has drifted out of sync with the frequency corpus. Read-only; fixing a reported mismatch is always a separate, explicit step.

### 3. Fix (if needed)
Edit the JSON file directly, then re-run `python3 create_card.py cards/[file].json` — updates the existing `hanzi_cards` row in place (content fields only; your review progress/scheduling on the site is never touched).

### 4. Repeat for the next character

---

## Setup / Requirements

- A `.env` file in this folder with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (same values as the Botkjaer.com repo's `.env.local` — same Supabase project)
- One-time: `cd tools && npm install` (requires Node.js, already installed on this machine)

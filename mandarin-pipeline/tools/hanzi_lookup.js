#!/usr/bin/env node
/**
 * Local research helper for the 汉字 Anki deck. Wraps the `hanzi` npm package
 * (same author/dataset as hanzicraft.com) to pull raw candidate data for a
 * card's front/pronunciation/components/examples fields.
 *
 * This does NOT apply the simplicity rule, pick per-reading examples, or
 * resolve "No glyph available"/"N/A" edge cases — those stay human judgment
 * calls per prompt.md. hanzicraft.com/MDBG/Wiktionary remain the fallback
 * whenever this tool surfaces a gap.
 *
 * Usage:
 *   node hanzi_lookup.js <char1> [char2 ...]   Batch character research
 *   node hanzi_lookup.js --at <rank>           Character at frequency rank N
 *   node hanzi_lookup.js --verify-ranks        Audit cards/*.json rank tags
 *                                               against the offline corpus
 */

const fs = require('fs');
const path = require('path');

// hanzi.start() logs progress to console.log; silence it so stdout carries
// only the final JSON.
function withSilencedLog(fn) {
  const realLog = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

const hanzi = require('hanzi');
withSilencedLog(() => hanzi.start());

// getRadicalMeaning() only covers a curated list of canonical radicals — for a
// component that's itself an ordinary character (e.g. 乃, 攸) it returns 'N/A'
// even though the character has a real CC-CEDICT definition. Fall back to
// definitionLookup() (first sense) before giving up. Characters with no entry
// in either (e.g. 畐) correctly stay 'N/A' — that's a genuine gap requiring a
// Wiktionary fallback per prompt.md, not a bug.
function resolveMeaning(component) {
  if (component === 'No glyph available') return 'No glyph available';

  const radicalMeaning = hanzi.getRadicalMeaning(component);
  if (radicalMeaning !== 'N/A') return radicalMeaning;

  const defs = hanzi.definitionLookup(component);
  if (defs && defs.length > 0) {
    return defs[0].definition.split('/')[0];
  }

  return 'N/A';
}

function resolveComponents(componentChars) {
  return componentChars.map((c) => ({
    component: c,
    meaning: resolveMeaning(c),
  }));
}

function lookupCharacter(char) {
  if (!hanzi.ifComponentExists(char) && hanzi.getPinyin(char).length === 0) {
    return { character: char, error: 'not found' };
  }

  const pinyin = hanzi.getPinyin(char) || [];
  const definitions = (hanzi.definitionLookup(char) || []).map((d) => ({
    pinyin: d.pinyin,
    definition: d.definition,
  }));

  const once = hanzi.decompose(char, 1);
  const radical = hanzi.decompose(char, 2);

  const examplesRaw = hanzi.getExamples(char) || [[], [], []];
  const shapeExamples = (tier) =>
    (tier || []).map((w) => ({
      simplified: w.simplified,
      traditional: w.traditional,
      pinyin: w.pinyin,
      definition: w.definition,
    }));

  const freq = hanzi.getCharacterFrequency(char);

  return {
    character: char,
    frequencyRank: freq ? parseInt(freq.number, 10) : null,
    pinyin,
    definitions,
    components: {
      once: resolveComponents(once.components),
      radical: resolveComponents(radical.components),
    },
    examples: {
      high: shapeExamples(examplesRaw[0]),
      medium: shapeExamples(examplesRaw[1]),
      low: shapeExamples(examplesRaw[2]),
    },
  };
}

function modeBatch(chars) {
  const result = {};
  for (const char of chars) {
    result[char] = lookupCharacter(char);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function modeAt(position) {
  const entry = hanzi.getCharacterInFrequencyListByPosition(String(position));
  if (!entry || !entry.character) {
    process.stdout.write(JSON.stringify({ position, error: 'not found' }, null, 2) + '\n');
    return;
  }
  const full = lookupCharacter(entry.character);
  process.stdout.write(JSON.stringify({ position: parseInt(position, 10), ...full }, null, 2) + '\n');
}

function modeVerifyRanks() {
  const cardsDir = path.join(__dirname, '..', 'cards');
  const files = fs.readdirSync(cardsDir).filter((f) => /^\d+_.+\.json$/.test(f));

  const mismatches = [];
  for (const file of files) {
    const full = path.join(cardsDir, file);
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const char = data.character;
    const cardRank = data.rank;
    const freq = hanzi.getCharacterFrequency(char);
    const corpusRank = freq ? parseInt(freq.number, 10) : null;
    if (corpusRank !== null && corpusRank !== cardRank) {
      mismatches.push({ file, character: char, cardRank, corpusRank });
    }
  }

  process.stdout.write(JSON.stringify({ totalCards: files.length, mismatches }, null, 2) + '\n');
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node hanzi_lookup.js <char1> [char2 ...] | --at <rank> | --verify-ranks');
    process.exit(1);
  }

  if (args[0] === '--verify-ranks') {
    modeVerifyRanks();
    return;
  }

  if (args[0] === '--at') {
    const position = args[1];
    if (!position || isNaN(parseInt(position, 10))) {
      console.error('Usage: node hanzi_lookup.js --at <rank>');
      process.exit(1);
    }
    modeAt(position);
    return;
  }

  modeBatch(args);
}

main();

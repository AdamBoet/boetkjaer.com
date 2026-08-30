#!/usr/bin/env node
/**
 * CC-CEDICT word-level definition lookup for the screenshot-to-flashcard
 * pipeline (sentence_audio/daily_refresh.py's process_screenshot_queue).
 * Unlike hanzi_lookup.js (per-character card research), this just answers
 * "does this exact word/phrase have a dictionary entry, and if so what's
 * its first-sense definition" — used as the dictionary-first half of a
 * dictionary-first/LLM-fallback meaning lookup, since CC-CEDICT covers
 * ordinary words well but misses newer slang (verified: 内卷/摆烂 have no
 * entry, while 成语/骆驼/昵称/赞美 all do).
 *
 * Usage: node word_lookup.js <word>
 * Prints {"meaning": "..."} on a hit, {"meaning": null} on a miss.
 */

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

const word = process.argv[2];
if (!word) {
  console.error('Usage: node word_lookup.js <word>');
  process.exit(1);
}

const defs = hanzi.definitionLookup(word);
const meaning = defs && defs.length > 0 ? defs[0].definition.split('/')[0].trim() : null;
process.stdout.write(JSON.stringify({ meaning }) + '\n');

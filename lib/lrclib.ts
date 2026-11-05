import * as OpenCC from "opencc-js";

const API = "https://lrclib.net/api";
const HEADERS = { "User-Agent": "botkjaer-hanzi-lab/1.0" };
const MAX_RESULTS = 10;
const MAX_SUGGESTIONS = 8;
const SAME_SONG_SIMILARITY = 0.6;
const SAME_LENGTH_SECONDS = 5;
const NOT_CHINESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const HAN = /\p{Script=Han}/u;
const TIMESTAMP = /\[\d+:\d+(?:[.:]\d+)?\]/g;
const LRC_METADATA = /^\[[a-z]+:.*\]$/i;
// Matched after conversion to Simplified, so only Simplified spellings are listed.
const CREDIT_LINE =
  /^(作词|作曲|词|曲|编曲|制作人?|监制|混音|母带|和声|合声|吉他|贝斯|鼓|键盘|弦乐|录音|出品|发行|OP|SP|lyrics?|lyricist|composer|arranger|producer)\s*[:：]/i;

const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

type LrclibTrack = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export type Song = {
  lrclibId: number;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  lyrics: string; // Simplified, one lyric line per "\n"
  syncedLyrics: string | null; // Simplified, with timestamps
};

export type SongSuggestion = {
  title: string;
  artist: string;
  durationSeconds: number | null;
};

// One line per lyric line: no timestamps, blanks, LRC metadata, or credits.
export function cleanLyrics(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !LRC_METADATA.test(line))
    .map((line) => line.replace(TIMESTAMP, "").trim())
    .filter((line) => line && !CREDIT_LINE.test(line))
    .join("\n");
}

// Null when the track has no Chinese lyrics to read (instrumentals and
// romanized uploads both show up in search results).
function toSong(track: LrclibTrack): Song | null {
  const raw = track.plainLyrics || track.syncedLyrics;
  if (!raw) return null;
  const title = toSimplified(track.trackName);
  const artist = toSimplified(track.artistName);
  const lines = cleanLyrics(toSimplified(raw)).split("\n");
  // A first line naming both title and artist ("七里香 - 周杰伦") is a heading,
  // not something sung.
  if (lines[0].includes(title) && lines[0].includes(artist)) lines.shift();
  const lyrics = lines.join("\n");
  if (!HAN.test(lyrics)) return null;
  return {
    lrclibId: track.id,
    title,
    artist,
    album: track.albumName ? toSimplified(track.albumName) : null,
    durationSeconds: track.duration == null ? null : Math.round(track.duration),
    lyrics,
    syncedLyrics: track.syncedLyrics ? toSimplified(track.syncedLyrics) : null,
  };
}

async function fetchSearch(query: string): Promise<LrclibTrack[]> {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(query)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`LRCLIB search failed (${res.status})`);
  return res.json();
}

// LRCLIB matches the script literally: 告五人 爱人错过 finds nothing while
// 告五人 愛人錯過 does, so every search runs in both scripts. Only fails if
// both requests do.
export async function searchSongs(query: string): Promise<Song[]> {
  const simplified = toSimplified(query);
  const variants = [...new Set([query, simplified, toTraditional(query)])];
  const settled = await Promise.allSettled(variants.map(fetchSearch));
  const fulfilled = settled.filter((r) => r.status === "fulfilled");
  if (fulfilled.length === 0) throw new Error("Could not reach LRCLIB");

  const tracks = new Map<number, LrclibTrack>();
  for (const result of fulfilled) for (const t of result.value) tracks.set(t.id, t);

  const terms = simplified.toLowerCase().split(/\s+/).filter(Boolean);
  const matchedTerms = (song: Song) => {
    const haystack = `${song.title} ${song.artist}`.toLowerCase();
    return terms.filter((term) => haystack.includes(term)).length;
  };

  const songs = [...tracks.values()].map(toSong).filter((song): song is Song => song !== null);

  // LRCLIB also matches on album, so searching 夜曲 returns the album's other
  // tracks. Keep only the closest title/artist matches.
  const bestMatch = Math.max(0, ...songs.map(matchedTerms));
  const ranked = songs
    .filter((song) => matchedTerms(song) === bestMatch)
    .sort(
      (a, b) =>
        Number(HAN.test(b.artist)) - Number(HAN.test(a.artist)) || // 周杰伦 over "Chou, Jay"
        Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) ||
        a.title.length - b.title.length || // 江南 over "139.林俊杰 - 江南"
        Number(startsWithTitle(a)) - Number(startsWithTitle(b)) ||
        lineCount(b) - lineCount(a), // lines left split are easier to read
    );

  // One row per song: the first (best) version of each is kept. Uploads differ
  // in timing, line breaks and labelling (even title and artist swapped), so
  // versions are matched on the lyrics alone.
  const unique: { song: Song; bigrams: Set<string> }[] = [];
  for (const song of ranked) {
    const bigrams = hanBigrams(song.lyrics);
    if (!unique.some((kept) => similarity(kept.bigrams, bigrams) >= SAME_SONG_SIMILARITY)) {
      unique.push({ song, bigrams });
    }
  }
  return unique.slice(0, MAX_RESULTS).map(({ song }) => song);
}

function lineCount(song: Song) {
  return song.lyrics.split("\n").length;
}

// Some uploads open with the song's name as a heading rather than a lyric.
function startsWithTitle(song: Song) {
  return song.lyrics.split("\n")[0] === song.title;
}

function hanBigrams(text: string) {
  const chars = Array.from(text).filter((ch) => HAN.test(ch));
  return new Set(chars.slice(1).map((ch, i) => chars[i] + ch));
}

// Share of two-character pairs in common (0 to 1). Sets ignore how often a
// chorus repeats, so a shortened upload still matches the full version.
function similarity(a: Set<string>, b: Set<string>) {
  const shared = [...a].filter((pair) => b.has(pair)).length;
  return shared / (a.size + b.size - shared || 1);
}

// Search-as-you-type suggestions. LRCLIB only matches whole words (最长 doesn't
// find 最长的电影), so these come from the iTunes catalog instead. Its Taiwan
// store has the best Mandarin coverage, and accepts Simplified input.
export async function suggestSongs(query: string): Promise<SongSuggestion[]> {
  const url =
    `https://itunes.apple.com/search?media=music&entity=song&country=tw&limit=25` +
    `&term=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`iTunes search failed (${res.status})`);
  const { results } = (await res.json()) as {
    results: { trackName: string; artistName: string; trackTimeMillis?: number }[];
  };

  const seen = new Set<string>();
  const suggestions: SongSuggestion[] = [];
  for (const track of results) {
    const title = baseTitle(toSimplified(track.trackName));
    const artist = toSimplified(track.artistName);
    const key = `${title}|${artist}`;
    if (!HAN.test(title) || NOT_CHINESE.test(title) || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      title,
      artist,
      durationSeconds: track.trackTimeMillis ? Math.round(track.trackTimeMillis / 1000) : null,
    });
  }
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

// Lyrics for a picked suggestion, or null if LRCLIB doesn't have that song.
// The two catalogs spell artists differently (G.E.M.邓紫棋 vs 邓紫棋), hence
// the title-only retry; that retry can return other songs with the same name,
// so a match also needs the artist or the song's length to agree.
export async function findSong(suggestion: SongSuggestion): Promise<Song | null> {
  const { title, artist, durationSeconds } = suggestion;
  const isMatch = (song: Song) => {
    const sameTitle = baseTitle(song.title) === title;
    const sameArtist = song.artist.includes(artist) || artist.includes(song.artist);
    const sameLength =
      durationSeconds != null &&
      song.durationSeconds != null &&
      Math.abs(durationSeconds - song.durationSeconds) <= SAME_LENGTH_SECONDS;
    return sameTitle && (sameArtist || sameLength);
  };
  return (
    (await searchSongs(`${artist} ${title}`)).find(isMatch) ??
    (await searchSongs(title)).find(isMatch) ??
    null
  );
}

// 七里香 (Live) and 好不容易 (《华灯初上》片尾曲) are 七里香 and 好不容易.
function baseTitle(title: string) {
  return title.replace(/\s*[(（\[【].*$/, "").replace(/\s+-\s+.*$/, "").trim();
}

export async function getSong(lrclibId: number): Promise<Song | null> {
  const res = await fetch(`${API}/get/${lrclibId}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB lookup failed (${res.status})`);
  return toSong(await res.json());
}

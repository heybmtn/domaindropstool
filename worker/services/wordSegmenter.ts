import english10 from "wordlist-english/english-words-10.json";
import english20 from "wordlist-english/english-words-20.json";
import english35 from "wordlist-english/english-words-35.json";
import english40 from "wordlist-english/english-words-40.json";
import english50 from "wordlist-english/english-words-50.json";
import british10 from "wordlist-english/british-words-10.json";
import british20 from "wordlist-english/british-words-20.json";
import british35 from "wordlist-english/british-words-35.json";
import british40 from "wordlist-english/british-words-40.json";
import british50 from "wordlist-english/british-words-50.json";

/**
 * Heuristic word counting for domain labels, used by the 1/2/3-word filters.
 *
 * A label is split on hyphens and digits, then each letter run is split into
 * the fewest dictionary words that cover it completely. If any run cannot be
 * fully covered the count is unknown (null) rather than guessed.
 *
 * Dictionary: SCOWL common tiers (10–50) via `wordlist-english` (MIT), plus UK
 * places and common domain terms. Worker-only so the browser bundle stays small.
 */

const EXTRA_WORDS = [
  "uk", "app", "apps", "web", "online", "hq", "tv", "pc", "ai", "diy", "eco", "pro", "max", "ltd", "bnb", "hub",
  "blog", "vlog", "email", "wifi", "tech", "fintech", "crypto", "vape", "vegan", "yoga", "pilates", "barber",
  "london", "manchester", "birmingham", "leeds", "glasgow", "liverpool", "bristol", "edinburgh", "cardiff", "belfast",
  "sheffield", "newcastle", "nottingham", "leicester", "brighton", "oxford", "cambridge", "york", "kent", "essex",
  "surrey", "sussex", "yorkshire", "devon", "cornwall", "wales", "scotland", "england", "britain", "british",
  "cheshire", "lancashire", "norfolk", "suffolk", "dorset", "somerset", "hampshire", "berkshire", "midlands",
];

/** Two-letter words are only counted from this common set (the full list has many obscure ones). */
const TWO_LETTER_WORDS = new Set([
  "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if", "in", "is", "it", "me", "my", "no", "of",
  "oh", "ok", "on", "or", "so", "to", "up", "us", "we", "uk", "tv", "pc", "ai", "hq",
]);

const MAX_WORD_LENGTH = 24;

let dictionary: Set<string> | null = null;

function getDictionary(): Set<string> {
  if (dictionary) return dictionary;
  const words = new Set<string>();
  const lists: string[][] = [
    english10, english20, english35, english40, english50,
    british10, british20, british35, british40, british50, EXTRA_WORDS,
  ];
  for (const list of lists) {
    for (const word of list) {
      if (/^[a-z]+$/.test(word) && word.length <= MAX_WORD_LENGTH) words.add(word);
    }
  }
  dictionary = words;
  return words;
}

function isWord(candidate: string, words: Set<string>): boolean {
  if (candidate.length === 1) return candidate === "a" || candidate === "i";
  if (candidate.length === 2) return TWO_LETTER_WORDS.has(candidate);
  return words.has(candidate);
}

/** Fewest dictionary words covering `run` completely, or null if impossible. */
function segmentRun(run: string, words: Set<string>): string[] | null {
  const n = run.length;
  // best[i] = fewest words covering run[0..i); from[i] = start index of the last word.
  const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const from = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let end = 1; end <= n; end += 1) {
    for (let start = Math.max(0, end - MAX_WORD_LENGTH); start < end; start += 1) {
      if (best[start]! + 1 >= best[end]!) continue;
      if (isWord(run.slice(start, end), words)) {
        best[end] = best[start]! + 1;
        from[end] = start;
      }
    }
  }
  if (!Number.isFinite(best[n]!)) return null;
  const result: string[] = [];
  for (let end = n; end > 0; end = from[end]!) result.unshift(run.slice(from[end]!, end));
  return result;
}

/** Splits a domain label into words, or returns null when it cannot be fully explained. */
export function segmentLabel(label: string): string[] | null {
  const words = getDictionary();
  const runs = label.toLowerCase().split(/[-0-9]+/).filter(Boolean);
  if (runs.length === 0) return null;
  const result: string[] = [];
  for (const run of runs) {
    const segmented = segmentRun(run, words);
    if (!segmented) return null;
    result.push(...segmented);
  }
  return result;
}

/** Number of words in a label, or null when unknown. */
export function countWords(label: string): number | null {
  return segmentLabel(label)?.length ?? null;
}

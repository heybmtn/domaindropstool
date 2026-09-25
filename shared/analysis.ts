import { lexicalFeatures } from "./domain";
import { COMMON_WORDS } from "./wordlist";

/**
 * Local, zero-cost heuristics about a domain label. These are rough signals
 * to help prioritise research. They are not market valuations.
 */
export interface LocalAnalysis {
  length: number;
  hyphens: number;
  digits: number;
  /** Words found by the heuristic segmenter (dictionary + hyphen/number splits). */
  words: string[];
  wordCount: number;
  /** Share of characters that are digits (0–1). */
  numberRatio: number;
  /** Share of letters that are vowels (0–1). */
  vowelRatio: number;
  /** Share of characters covered by common dictionary words (0–1). */
  dictionaryCoverage: number;
}

const DICTIONARY = new Set(COMMON_WORDS);
const MAX_WORD_LENGTH = COMMON_WORDS.reduce((max, word) => Math.max(max, word.length), 0);
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Segments a letters-only run into dictionary words, maximising the number of
 * covered characters and then preferring fewer words (dynamic programming).
 */
function segmentLetters(text: string): { words: string[]; covered: number } {
  const n = text.length;
  // best[i] = best segmentation of text[0..i)
  const best: { covered: number; count: number; words: string[] }[] = [{ covered: 0, count: 0, words: [] }];
  for (let i = 1; i <= n; i += 1) {
    const previous = best[i - 1]!;
    // Treat an unknown character as uncovered.
    let candidate = { covered: previous.covered, count: previous.count, words: previous.words };
    for (let length = 2; length <= Math.min(MAX_WORD_LENGTH, i); length += 1) {
      const word = text.slice(i - length, i);
      if (!DICTIONARY.has(word)) continue;
      const base = best[i - length]!;
      const covered = base.covered + length;
      const words = base.count + 1;
      if (covered > candidate.covered || (covered === candidate.covered && words < candidate.count)) {
        candidate = { covered, count: words, words: [...base.words, word] };
      }
    }
    best.push(candidate);
  }
  const result = best[n]!;
  return { words: result.words, covered: result.covered };
}

export function analyseLabel(sld: string): LocalAnalysis {
  const { length, hyphens, digits } = lexicalFeatures(sld);
  const letters = sld.replace(/[^a-z]/g, "");
  const vowels = [...letters].filter((ch) => VOWELS.has(ch)).length;

  const words: string[] = [];
  let covered = 0;
  for (const part of sld.split(/[-0-9]+/).filter(Boolean)) {
    const segmented = segmentLetters(part);
    words.push(...segmented.words);
    covered += segmented.covered;
  }
  // A hyphen-separated or single part with no dictionary match still counts as one word.
  const wordCount = Math.max(words.length, sld.split(/[-0-9]+/).filter(Boolean).length > 0 ? 1 : 0);

  return {
    length,
    hyphens,
    digits,
    words,
    wordCount,
    numberRatio: length === 0 ? 0 : round(digits / length),
    vowelRatio: letters.length === 0 ? 0 : round(vowels / letters.length),
    dictionaryCoverage: letters.length === 0 ? 0 : round(covered / letters.length),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

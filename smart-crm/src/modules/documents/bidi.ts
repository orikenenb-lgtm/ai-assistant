/**
 * Bidirectional text layout for PDF rendering (Unicode Bidi Algorithm via
 * bidi-js). pdf-lib draws glyphs in the order it receives them, except that
 * fontkit reverses a whole string when its first strong letter is RTL
 * (Hebrew/Arabic) — and does so without bidi rules or bracket mirroring. So we
 * reorder lines ourselves, split them into same-level runs, and hand each run to
 * pdf-lib in the order that yields the correct visual result.
 */
import bidiFactory from "bidi-js";

const bidi = bidiFactory();

export type Direction = "rtl" | "ltr";

export type VisualRun = {
  /** Characters in left-to-right visual order (brackets already mirrored). */
  visual: string;
  /** What to pass to pdf-lib/fontkit so it renders `visual`. */
  drawText: string;
  rtl: boolean;
};

const RTL_SCRIPT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u;
const STRONG_LETTER = /\p{L}/u;
// Bidi formatting characters have no glyphs in most fonts.
const FORMATTING = /[‎‏‪-‮⁦-⁩]/g;

/** Mirrors fontkit's script detection: is the first letter in an RTL script? */
export function fontkitReverses(text: string): boolean {
  for (const ch of text) {
    if (STRONG_LETTER.test(ch)) return RTL_SCRIPT.test(ch);
  }
  return false;
}

export function stripBidiControls(text: string): string {
  return text.replace(FORMATTING, "");
}

type Paragraph = { text: string; levels: ReturnType<typeof bidi.getEmbeddingLevels> };

/** `auto` picks each paragraph's direction from its first strong character (like dir="auto"). */
export function analyze(text: string, dir: Direction | "auto"): Paragraph {
  const clean = stripBidiControls(text);
  return { text: clean, levels: bidi.getEmbeddingLevels(clean, dir) };
}

/** Visual runs (left → right) for characters [start, end] of an analyzed paragraph. */
export function visualRunsFor(p: Paragraph, start = 0, end = p.text.length - 1): VisualRun[] {
  if (end < start) return [];
  const indices = bidi.getReorderedIndices(p.text, p.levels, start, end).slice(start, end + 1);
  const mirrors = bidi.getMirroredCharactersMap(p.text, p.levels.levels, start, end);
  const runs: VisualRun[] = [];
  let current: { chars: string[]; level: number } | null = null;
  for (const idx of indices) {
    const level = p.levels.levels[idx];
    const ch = mirrors.get(idx) ?? p.text[idx];
    if (!current || current.level !== level) {
      if (current) runs.push(finishRun(current));
      current = { chars: [], level };
    }
    current.chars.push(ch);
  }
  if (current) runs.push(finishRun(current));
  return runs;
}

function finishRun(r: { chars: string[]; level: number }): VisualRun {
  const visual = r.chars.join("");
  return { visual, drawText: fontkitReverses(visual) ? [...visual].reverse().join("") : visual, rtl: (r.level & 1) === 1 };
}

/** Convenience: the whole line in visual order (used by tests and plain-text callers). */
export function visualLine(text: string, dir: Direction | "auto"): string {
  return visualRunsFor(analyze(text, dir))
    .map((r) => r.visual)
    .join("");
}

/**
 * Greedy word wrap in logical order. Returns inclusive [start, end] ranges into
 * `text`; newlines always break (an empty line yields [i, i-1]). Words wider
 * than the line are hard-broken by character.
 */
export function wrapRanges(text: string, maxWidth: number, measure: (s: string) => number): [number, number][] {
  const ranges: [number, number][] = [];
  let offset = 0;
  for (const para of text.split("\n")) {
    const words = [...para.matchAll(/\S+/g)].map((m) => ({ start: offset + m.index!, end: offset + m.index! + m[0].length - 1 }));
    if (!words.length) ranges.push([offset, offset - 1]);
    let cur: [number, number] | null = null;
    for (const w of words) {
      if (cur && measure(text.slice(cur[0], w.end + 1)) <= maxWidth) {
        cur[1] = w.end;
        continue;
      }
      if (cur) ranges.push(cur);
      cur = null;
      if (measure(text.slice(w.start, w.end + 1)) <= maxWidth) {
        cur = [w.start, w.end];
        continue;
      }
      let s = w.start;
      while (s <= w.end) {
        let e = s;
        while (e + 1 <= w.end && measure(text.slice(s, e + 2)) <= maxWidth) e++;
        if (e === w.end) {
          cur = [s, e];
          break;
        }
        ranges.push([s, e]);
        s = e + 1;
      }
    }
    if (cur) ranges.push(cur);
    offset += para.length + 1;
  }
  return ranges;
}

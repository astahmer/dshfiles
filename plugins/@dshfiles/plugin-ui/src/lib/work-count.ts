/**
 * The one count formula for summarising a thread's children (council round 22, item 3): every surface that summarises
 * subagents reads `6 working · 2 failed`. A zero part is omitted; finished and stopped children are named only by a
 * caller that passes their words (where finished ones matter); a total appears only on a surface that lists every
 * call, and it counts calls: `8 calls · 6 working · 2 failed`.
 *
 * Order: the total, then work in progress, then the problems (Needs you, Failed), then settled parts. A problem never
 * sits behind a routine clause, so a narrow row that truncates its end keeps the failure.
 *
 * Words are the caller's, already localised and pluralised: this module holds no copy.
 */

/** How many children are in each state. Missing fields count as zero. */
export interface WorkCounts {
  /** Every call the surface lists; shown only when `words.calls` is given. */
  readonly calls?: number;
  readonly working?: number;
  readonly needsYou?: number;
  readonly failed?: number;
  readonly stopped?: number;
  readonly done?: number;
}

/** One localised phrase per state, count included ("6 working", "2 failed", "8 calls"). */
export interface WorkCountWords {
  readonly working: (count: number) => string;
  readonly failed: (count: number) => string;
  /** Pass only on a surface that lists every call. */
  readonly calls?: (count: number) => string;
  readonly needsYou?: (count: number) => string;
  /** Pass only where stopped children matter. */
  readonly stopped?: (count: number) => string;
  /** Pass only where finished children matter. */
  readonly done?: (count: number) => string;
}

/** A clause of the summary; `tone` colours only the two problem states (DESIGN.md: colour for Needs you and Failed). */
export interface WorkCountPart {
  readonly key:
    "calls" | "working" | "needsYou" | "failed" | "stopped" | "done";
  readonly count: number;
  readonly text: string;
  readonly tone: "plain" | "needs-you" | "failed";
}

/** The separator every surface joins the parts with. */
export const WORK_COUNT_SEPARATOR = " · ";

const ORDER = [
  "calls",
  "working",
  "needsYou",
  "failed",
  "stopped",
  "done",
] as const satisfies readonly WorkCountPart["key"][];

const toneOf = (key: WorkCountPart["key"]): WorkCountPart["tone"] =>
  key === "failed" ? "failed" : key === "needsYou" ? "needs-you" : "plain";

/**
 * The summary's clauses in their fixed order, zero parts and parts without words left out.
 * @param counts - children per state, and the call total for a surface that lists every call.
 * @param words - the caller's localised phrases; a state without a phrase is not shown.
 * @returns the non-empty clauses; empty when nothing is worth saying.
 */
export const workCountParts = (
  counts: WorkCounts,
  words: WorkCountWords,
): readonly WorkCountPart[] =>
  ORDER.flatMap((key) => {
    const count = counts[key] ?? 0;
    const phrase = words[key];
    return count > 0 && phrase !== undefined
      ? [{ key, count, text: phrase(count), tone: toneOf(key) }]
      : [];
  });

/**
 * The summary as one string: `6 working · 2 failed`.
 * @returns the joined clauses, or an empty string when there are none.
 */
export const workCountLabel = (
  counts: WorkCounts,
  words: WorkCountWords,
): string =>
  workCountParts(counts, words)
    .map((part) => part.text)
    .join(WORK_COUNT_SEPARATOR);

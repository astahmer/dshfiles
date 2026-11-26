import { describe, expect, it } from "vitest";
import {
  workCountLabel,
  workCountParts,
  type WorkCountWords,
} from "./work-count.js";

const phrase = (word: string) => (count: number) => `${String(count)} ${word}`;
const words: WorkCountWords = {
  working: phrase("working"),
  failed: phrase("failed"),
};

describe("work count", () => {
  it("reads working, then failed", () => {
    expect(workCountLabel({ working: 6, failed: 2 }, words)).toBe(
      "6 working · 2 failed",
    );
  });

  it("omits a zero part", () => {
    expect(workCountLabel({ working: 6, failed: 0 }, words)).toBe("6 working");
    expect(workCountLabel({ working: 0, failed: 2 }, words)).toBe("2 failed");
    expect(workCountLabel({}, words)).toBe("");
  });

  it("shows a total only for a caller that lists every call, and calls it calls", () => {
    expect(workCountLabel({ calls: 8, working: 6, failed: 2 }, words)).toBe(
      "6 working · 2 failed",
    );
    expect(
      workCountLabel(
        { calls: 8, working: 6, failed: 2 },
        { ...words, calls: phrase("calls") },
      ),
    ).toBe("8 calls · 6 working · 2 failed");
  });

  it("names finished and stopped children only where the caller says they matter", () => {
    const counts = { working: 1, failed: 1, stopped: 1, done: 3 };
    expect(workCountLabel(counts, words)).toBe("1 working · 1 failed");
    expect(
      workCountLabel(counts, {
        ...words,
        stopped: phrase("stopped"),
        done: phrase("done"),
      }),
    ).toBe("1 working · 1 failed · 1 stopped · 3 done");
  });

  it("keeps problems ahead of settled parts and tones only the problems", () => {
    const parts = workCountParts(
      { calls: 5, working: 1, needsYou: 1, failed: 2, done: 1 },
      {
        ...words,
        calls: phrase("calls"),
        needsYou: phrase("need you"),
        done: phrase("done"),
      },
    );
    expect(parts.map((part) => [part.key, part.text, part.tone])).toEqual([
      ["calls", "5 calls", "plain"],
      ["working", "1 working", "plain"],
      ["needsYou", "1 need you", "needs-you"],
      ["failed", "2 failed", "failed"],
      ["done", "1 done", "plain"],
    ]);
  });
});

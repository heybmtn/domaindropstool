import { describe, expect, it } from "vitest";
import { countWords, segmentLabel } from "../../worker/services/wordSegmenter";

describe("word segmenter (heuristic)", () => {
  it.each([
    ["shop", 1],
    ["garden", 1],
    ["gardenlondon", 2],
    ["bestcarhire", 3],
    ["best-car-hire", 3],
    ["carhire4u", null],
    ["london4u", null],
    ["xqzt", null],
    ["nicebuns", 2],
    ["myhomeuk", 3],
  ])("%s → %s", (label, expected) => {
    expect(countWords(label)).toBe(expected);
  });

  it("returns the words it found", () => {
    expect(segmentLabel("gardenlondon")).toEqual(["garden", "london"]);
  });
});

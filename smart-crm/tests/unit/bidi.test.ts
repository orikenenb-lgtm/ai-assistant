import { describe, expect, it } from "vitest";
import { analyze, fontkitReverses, visualLine, visualRunsFor, wrapRanges } from "@/modules/documents/bidi";

describe("bidi layout for PDF", () => {
  it("reverses pure Hebrew into visual order", () => {
    expect(visualLine("שלום", "rtl")).toBe("םולש");
  });

  it("keeps numbers and Latin words left-to-right inside Hebrew", () => {
    expect(visualLine("מחיר 120 ש״ח", "rtl")).toBe("ח״ש 120 ריחמ");
    expect(visualLine("קטלוג Lego 2026", "rtl")).toBe("Lego 2026 גולטק");
    expect(visualLine("הצעה מספר 12", "rtl")).toBe("12 רפסמ העצה");
  });

  it("mirrors brackets in right-to-left runs", () => {
    expect(visualLine("שלום (טוב)", "rtl")).toBe("(בוט) םולש");
  });

  it("leaves English paragraphs untouched and reverses embedded Hebrew", () => {
    expect(visualLine("Quote for Kerem Toys", "ltr")).toBe("Quote for Kerem Toys");
    expect(visualLine("Client: כרם טויס", "ltr")).toBe("Client: סיוט םרכ");
  });

  it("produces draw strings that compensate for fontkit's naive RTL reversal", () => {
    const runs = visualRunsFor(analyze("שלום 123 abc", "rtl"));
    expect(runs.map((r) => r.visual).join("")).toBe("abc 123 םולש");
    for (const r of runs) {
      // What fontkit will display = drawText, reversed if fontkit detects RTL script.
      const displayed = fontkitReverses(r.drawText) ? [...r.drawText].reverse().join("") : r.drawText;
      expect(displayed).toBe(r.visual);
    }
  });

  it("detects fontkit's script direction from the first letter", () => {
    expect(fontkitReverses("שלום")).toBe(true);
    expect(fontkitReverses("123 ₪")).toBe(false);
    expect(fontkitReverses("abc שלום")).toBe(false);
  });

  it("wraps on words, honors newlines and hard-breaks long words", () => {
    const measure = (s: string) => s.length;
    const text = "אחת שתיים שלוש\nארבע";
    const ranges = wrapRanges(text, 9, measure);
    expect(ranges.map(([s, e]) => text.slice(s, e + 1))).toEqual(["אחת שתיים", "שלוש", "ארבע"]);
    const long = "abcdefghij";
    expect(wrapRanges(long, 4, measure).map(([s, e]) => long.slice(s, e + 1))).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapRanges("a\n\nb", 10, measure).map(([s, e]) => "a\n\nb".slice(s, e + 1))).toEqual(["a", "", "b"]);
  });
});

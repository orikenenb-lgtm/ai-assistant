import { describe, expect, it } from "vitest";
import { extractPhone, parsePhone, spokenDigitsToNumbers } from "@/lib/phone";

describe("parsePhone", () => {
  it.each([
    ["050-123-4567", "+972501234567", "050-123-4567"],
    ["0501234567", "+972501234567", "050-123-4567"],
    ["+972 50 123 4567", "+972501234567", "050-123-4567"],
    ["00972501234567", "+972501234567", "050-123-4567"],
    ["972-50-1234567", "+972501234567", "050-123-4567"],
    ["03-1234567", "+97231234567", "03-123-4567"],
    ["077-1234567", "+972771234567", "077-123-4567"],
    ["(052) 987 6543", "+972529876543", "052-987-6543"],
  ])("parses %s", (input, e164, display) => {
    expect(parsePhone(input)).toEqual({ e164, display });
  });

  it.each(["", "abc", "12345", "050-123", "0601234567", "05012345678", "1-800-123"])("rejects %s", (input) => {
    expect(parsePhone(input)).toBeNull();
  });

  it("accepts international numbers with a plus", () => {
    expect(parsePhone("+1 415 555 0100")).toEqual({ e164: "+14155550100", display: "+14155550100" });
  });
});

describe("spoken digits", () => {
  it("turns Hebrew digit words into digits", () => {
    expect(spokenDigitsToNumbers("אפס חמש אפס אחת שתיים שלוש").replace(/\s/g, "")).toBe("050123");
  });

  it("extracts a phone number from speech-recognition output", () => {
    expect(extractPhone("המספר שלי הוא אפס חמש שתיים שבע שבע שש חמש ארבע שלוש שתיים")?.e164).toBe("+972527765432");
    expect(extractPhone("תתקשרו ל 054 765 4321 בבקשה")?.display).toBe("054-765-4321");
  });

  it("does not invent a number from unrelated digits", () => {
    expect(extractPhone("יש לנו 2 סניפים ו-15 עובדים")).toBeNull();
  });
});

describe("spoken numbers, grouped", () => {
  it("understands tens the way Israelis read numbers aloud", () => {
    expect(extractPhone("אפס חמש ארבע, שבע שש חמש, ארבעים ושלוש עשרים ואחת")?.e164).toBe("+972547654321");
    expect(spokenDigitsToNumbers("עשרים").trim()).toBe("20");
  });

  it("accepts digits separated by dashes", () => {
    expect(extractPhone("אפס - חמש - אפס - אחת - שתיים - שלוש - ארבע - חמש - שש - שבע")?.e164).toBe("+972501234567");
  });
});

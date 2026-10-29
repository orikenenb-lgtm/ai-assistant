import { describe, expect, it } from "vitest";
import { answers } from "@/lib/agent/knowledge";
import { extractName, isGoodbye, normalize, respond } from "@/lib/agent/rules";
import { MAX_USER_TURNS, initialDemoState, type ChatMessage, type DemoState } from "@/lib/agent/types";

const user = (content: string): ChatMessage => ({ role: "user", content });

/** Drive a whole conversation through the engine, like the browser does. */
function converse(lines: string[]) {
  const messages: ChatMessage[] = [{ role: "assistant", content: answers.greeting }];
  let state: DemoState = initialDemoState;
  let last = respond(messages, state);
  for (const line of lines) {
    messages.push(user(line));
    last = respond(messages, state);
    messages.push({ role: "assistant", content: last.reply });
    state = last.state;
  }
  return last;
}

describe("normalize", () => {
  it("strips niqqud, geresh and punctuation", () => {
    expect(normalize("נדל״ן!  מָה? ")).toBe("נדלן מה?");
  });
});

describe("intents", () => {
  it.each([
    ["כמה זה עולה?", answers.price],
    ["מה המחיר", answers.price],
    ["יש דמי הקמה?", answers.price],
    ["כמה זמן לוקח להקים?", answers.setup],
    ["זה עובד גם בוואטסאפ?", answers.whatsapp],
    ["מתחבר ליומן גוגל?", answers.integrations],
    ["את רובוט?", answers.robot],
    ["איך זה עובד", answers.howItWorks],
    ["אפשר לבטל מתי שרוצים?", answers.cancel],
    ["את מדברת אנגלית?", answers.languages],
    ["איפה נשמר המידע", answers.privacy],
    ["שלום", answers.greeting],
  ])("%s", (text, expected) => {
    expect(respond([user(text)]).reply).toBe(expected);
  });

  it("answers about an industry", () => {
    expect(respond([user("יש לי מוסך")]).reply).toContain("למוסכים");
  });

  it("falls back gracefully on unknown input", () => {
    expect(answers.fallback).toContain(respond([user("פלאפל עם חריף")]).reply);
  });

  it("recognizes goodbye (Hebrew has no \\b word boundaries)", () => {
    expect(isGoodbye("ביי")).toBe(true);
    expect(isGoodbye("טוב להתראות")).toBe(true);
    expect(isGoodbye("ביינתיים לא")).toBe(false);
    expect(respond([user("זהו תודה")]).end).toBe(true);
  });
});

describe("lead capture flow", () => {
  it("collects name, business and phone, then asks to save", () => {
    const r = converse(["אני רוצה סוכן לעסק", "קוראים לי דני כהן", "יש לי מוסך בחולון", "050-123-4567", "כן"]);
    expect(r.saveLead).toEqual({ name: "דני כהן", business: "מוסך בחולון", phone: "+972501234567" });
    expect(r.state.leadSaved).toBe(true);
    expect(r.state.stage).toBe("chat");
  });

  it("accepts a spoken phone number and lets the visitor fix it before confirming", () => {
    const r1 = converse(["מעוניין", "מיכל", "מרפאת שיניים", "אפס חמש ארבע שבע שש חמש ארבע שלוש שתיים אחת"]);
    expect(r1.state.stage).toBe("confirm");
    expect(r1.state.phone).toBe("+972547654321");
    expect(r1.reply).toContain("054-765-4321");

    const r2 = converse(["מעוניין", "מיכל", "מרפאת שיניים", "0547654321", "לא, המספר לא נכון", "0521112233", "כן"]);
    expect(r2.saveLead?.phone).toBe("+972521112233");
  });

  it("re-asks after an unreadable phone number and suggests the form after three misses", () => {
    const r = converse(["אני רוצה להתחיל", "יוסי", "נדלן", "לא יודע", "בלה בלה", "אממ"]);
    expect(r.state.stage).toBe("ask_phone");
    expect(r.reply).toContain("טופס");
    expect(r.saveLead).toBeUndefined();
  });

  it("answers a question in the middle of the flow and re-asks the slot", () => {
    const r = converse(["רוצה סוכן", "כמה זה עולה?"]);
    expect(r.reply.startsWith(answers.price)).toBe(true);
    expect(r.reply).toContain("איך קוראים לך");
    expect(r.state.stage).toBe("ask_name");
  });

  it("can be cancelled", () => {
    const r = converse(["רוצה סוכן", "לא משנה"]);
    expect(r.state.stage).toBe("chat");
  });

  it("captures business and phone given together", () => {
    const r = converse(["מעוניינת", "רונית", "סטודיו לפילאטיס 052-555-1234"]);
    expect(r.state.stage).toBe("confirm");
    expect(r.state.business).toBe("סטודיו לפילאטיס");
    expect(r.state.phone).toBe("+972525551234");
  });

  it("doesn't capture the same lead twice", () => {
    const messages: ChatMessage[] = [user("רוצה סוכן")];
    const r = respond(messages, { ...initialDemoState, leadSaved: true, name: "דני" });
    expect(r.state.stage).toBe("chat");
    expect(r.reply).toContain("כבר רשמתי");
  });
});

describe("extractName", () => {
  it.each([
    ["קוראים לי דני", "דני"],
    ["שמי רונית לוי", "רונית לוי"],
    ["אני מיכל", "מיכל"],
    ["dana", "Dana"],
  ])("%s → %s", (input, expected) => {
    expect(extractName(input)).toBe(expected);
  });

  it("rejects digits", () => {
    expect(extractName("0501234567")).toBeUndefined();
  });
});

describe("limits", () => {
  it("wraps up after too many turns", () => {
    const messages = Array.from({ length: MAX_USER_TURNS + 1 }, () => user("שלום"));
    const r = respond(messages);
    expect(r.end).toBe(true);
    expect(r.reply).toBe(answers.turnLimit);
  });
});

describe("review regressions", () => {
  it("treats 'זהו' as goodbye only when it is the whole message", () => {
    expect(isGoodbye("זהו")).toBe(true);
    expect(isGoodbye("זהו מוסך ברמת גן")).toBe(false);
    expect(isGoodbye("זהו?")).toBe(false);
    expect(respond([user("זהו, כמה זה עולה?")]).end).toBeUndefined();
  });

  it("matches whole words, not substrings", () => {
    expect(respond([user("מעולה, וזה עובד גם בוואטסאפ?")]).reply).toBe(answers.whatsapp);
    expect(respond([user("יש לי בוטיק בגדים")]).reply).not.toBe(answers.robot);
    expect(respond([user("קליניקה להורדה במשקל")]).reply).not.toBe(answers.price);
    expect(respond([user("וכמה זה עולה?")]).reply).toBe(answers.price);
    expect(respond([user("צריך טיפול לרכב")]).reply).toContain("למוסכים");
  });

  it("does not save when 'yes' comes with a correction", () => {
    const r = converse(["רוצה סוכן", "דני", "מוסך", "0501234567", "כן אבל השם לא נכון"]);
    expect(r.saveLead).toBeUndefined();
    expect(r.state.stage).toBe("ask_name");
  });

  it("strips lead-in words from names and rejects non-names", () => {
    expect(extractName("כן, קוראים לי דני")).toBe("דני");
    expect(extractName("היי, אני דני")).toBe("דני");
    expect(extractName("לא")).toBeUndefined();
    expect(extractName("נעים מאוד, שמי רונית")).toBe("רונית");
  });

  it("keeps spoken phone digits out of the business name", () => {
    const r = converse(["מעוניין", "אבי", "מוסך אפס חמש אפס אחת שתיים שלוש ארבע חמש שש שבע"]);
    expect(r.state.business).toBe("מוסך");
    expect(r.state.phone).toBe("+972501234567");
  });

  it("restarts the flow when the confirm state is incomplete (forged client state)", () => {
    const r = respond([user("כן")], { ...initialDemoState, stage: "confirm", phone: "+972501234567" });
    expect(r.saveLead).toBeUndefined();
    expect(r.state.stage).toBe("ask_name");
  });
});

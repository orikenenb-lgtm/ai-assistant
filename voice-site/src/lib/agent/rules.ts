import { contact } from "@/config/site";
import { answers, industryAnswer } from "@/lib/agent/knowledge";
import {
  MAX_USER_TURNS,
  initialDemoState,
  type ChatMessage,
  type DemoState,
  type EngineResult,
} from "@/lib/agent/types";
import { extractPhone, spokenDigitsToNumbers } from "@/lib/phone";

/**
 * Rule-based demo agent: Hebrew intent matching plus a small slot-filling flow
 * that collects name → business → phone → confirmation and then asks the
 * server to save the lead. Pure and deterministic, so it runs on the server and,
 * as an offline fallback, in the browser.
 */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // niqqud and cantillation
    .replace(/[״"׳'`]/g, "")
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, patterns: RegExp[]) => patterns.some((p) => p.test(t));

/** End of a Hebrew word. (JS `\b` only understands ASCII letters.) */
const END = String.raw`(?=\s|\?|$)`;
const START = String.raw`(?:^|\s)`;
/**
 * Hebrew glues one or two letters to the front of a word (ו, ה, ב, ל, ש, כ:
 * "וכמה", "בוואטסאפ", "שעולה"). מ is left out on purpose: "מעולה" (great) is
 * not "עולה" (costs).
 */
const PREFIX = "(?:[וש]?[הבלכ]|[ושהבלכ])?";
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words or phrases, with an optional Hebrew prefix. */
const kw = (...words: string[]) => new RegExp(`${START}${PREFIX}(?:${words.map(escape).join("|")})${END}`);
/** Word stems: like kw, but any ending is allowed ("מרפא" → מרפאה, מרפאת שיניים). */
const stem = (...stems: string[]) => new RegExp(`${START}${PREFIX}(?:${stems.map(escape).join("|")})\\S*`);
/** The whole message must be one of these. */
const only = (...phrases: string[]) => new RegExp(`^(?:${phrases.map(escape).join("|")})$`);
/** The message starts with one of these words. */
const leading = (...words: string[]) => new RegExp(`^(?:${words.map(escape).join("|")})${END}`);

const P = {
  bye: [
    only("זהו", "זהו תודה", "זהו זה", "סיימנו", "שלום שלום"),
    leading("ביי", "להתראות", "יאללה ביי", "bye"),
    /(^|\s)(ביי|להתראות|לילה טוב)$/,
  ],
  thanks: [only("תודה", "תודה רבה", "תודה לך", "מעולה תודה", "סבבה תודה", "thanks", "thank you")],
  stop: [kw("לא משנה", "עזבי", "עזוב", "בטלי", "תבטלי", "לא רוצה", "לא עכשיו", "לא תודה")],
  lead: [
    /(רוצה|רוצים|מעוניין|מעוניינת|מעוניינים|אשמח|בא לי) (ב)?(סוכן|נציג|נציגה|סוכנת|להתחיל|להצטרף|לנסות|להירשם|הדגמה|פגישה|שיחה)/,
    /(מעוניין|מעוניינת|מעוניינים)$/,
    /(תחזרו|תחזרי|שיחזרו|שתחזרו|לחזור) (אליי|אלי|אלינו)/,
    /(לקבוע|לתאם) (שיחה|פגישה|הדגמה|שיחת היכרות)/,
    /(תבני|תבנו|לבנות) (לי|לנו)/,
    /(איך|מאיפה) (מתחילים|נרשמים|מצטרפים)/,
    /(בואו|בואי|בוא) נתחיל/,
    /^(כן )?(אני )?(רוצה|מעוניין|מעוניינת)$/,
    /(השאיר|להשאיר|תרשמי|לרשום) (פרטים|אותי)/,
  ],
  setupFee: [kw("דמי הקמה", "עלות הקמה", "תשלום חד פעמי")],
  setup: [kw("כמה זמן", "תוך כמה", "הקמה", "להקים", "מתי אפשר", "לאוויר")],
  price: [
    kw("מחיר", "מחירים", "עולה", "עולים", "עלות", "עלויות", "תמחור", "כמה זה", "כמה כסף", "חבילה", "חבילות", "מנוי"),
    kw("תשלום", "לשלם", "משלמים", "שקל", "שקלים", "price", "cost"),
  ],
  trial: [kw("ניסיון", "לנסות", "חינם", "בחינם", "בלי לשלם", "טסט", "trial")],
  whatsapp: [kw("וואטסאפ", "ווטסאפ", "ווצאפ", "וואצאפ", "ואטסאפ", "whatsapp")],
  integrations: [
    kw("יומן", "גוגל", "google", "crm", "סי אר אם", "מייל", "אימייל", "חיבור", "חיבורים", "מתחבר", "מתחברת", "לחבר", "api"),
    kw("webhook", "webhooks", "מערכת", "מערכות", "זימון תורים", "פריוריטי", "מאנדיי", "monday", "hubspot"),
    stem("אינטגרצי"),
  ],
  phoneNumber: [kw("מספר טלפון", "מספר ישראלי", "מספר ייעודי", "קו טלפון", "מספר קיים", "המספר הקיים", "להעביר את המספר", "הפניית שיחות")],
  languages: [kw("עברית", "אנגלית", "ערבית", "רוסית", "שפה", "שפות", "מבטא", "קול", "קולות", "language")],
  privacy: [kw("פרטיות", "אבטחה", "מאובטח", "מאובטחת", "שרתים", "שרת", "נשמר", "נשמרים", "נשמרת", "מידע", "הקלטה", "הקלטות", "gdpr", "מוצפן")],
  handoff: [kw("נציג אנושי", "בן אדם", "בנאדם", "אדם אמיתי", "להעביר אלי", "להעביר אליי", "להעביר אלינו", "העברה לנציג", "לא יודע לענות", "לא יודעת לענות")],
  robot: [kw("רובוט", "רובוטית", "בוט", "את אמיתית", "אתה אמיתי", "את בן אדם", "את בינה מלאכותית", "את ai", "את מחשב")],
  cancel: [kw("לבטל", "ביטול", "התחייבות", "מתחייבים", "חוזה")],
  hours: [kw("24 7", "שעות פעילות", "בלילה", "בשבת", "בחגים", "סופש", "סוף שבוע", "במקביל", "עומס")],
  outbound: [kw("מתקשר החוצה", "מתקשרת החוצה", "שיחות יוצאות", "יוצאות", "להתקשר ללקוחות", "חוזר ללידים", "חוזרת ללידים", "תזכורת", "תזכורות")],
  howItWorks: [kw("איך זה עובד", "איך את עובדת", "איך עובד", "מה את עושה", "מה זה", "מה אתם עושים", "מה הסוכן עושה", "מה את יודעת", "ספרי לי", "תסבירי", "הסבר")],
  greeting: [/^(היי|הי|שלום|אהלן|הלו|בוקר טוב|ערב טוב|צהריים טובים|מה נשמע|מה קורה|hello|hi|hey)( .*)?$/],
  yes: [leading("כן", "נכון", "בדיוק", "מאשר", "מאשרת", "מאושר", "סבבה", "אוקיי", "אוקי", "ok", "okay", "בטח", "יאללה", "יפה", "מעולה", "קדימה")],
  /** Anything that sounds like "that's not right" during confirmation. */
  correction: [leading("לא", "ממש לא", "טעות", "רגע"), kw("לא", "אבל", "טעות", "תתקני", "תקני", "לתקן", "שגוי", "לא נכון")],
  slotWords: { name: kw("שם", "השם"), business: kw("עסק", "העסק", "תחום"), phone: kw("מספר", "המספר", "טלפון", "הטלפון") },
  question: [/\?$/, leading("כמה", "מה", "איך", "למה", "מתי", "איפה", "האם")],
};

const INDUSTRY_PATTERNS: [string, RegExp][] = [
  ["garages", stem("מוסך", "רכב", "מכונא", "פנצ", "צמיג")],
  ["clinics", stem("מרפא", "קליניק", "רופא", "שיניים", "פיזיותרפ", "קוסמטיק", "רפואי", "דיאטנ", "פסיכולוג")],
  ["law", stem("עורך דין", "עורכי דין", "עורכת דין", "משפט", "רואה חשבון", "רואי חשבון")],
  ["realestate", stem("נדלן", "נדל ן", "תיווך", "מתווך", "דירות", "דירה", "נכסים")],
  ["restaurants", stem("מסעד", "בית קפה", "קייטרינג", "שולחן")],
  ["services", stem("מזגנ", "מזגן", "אינסטלט", "חשמלאי", "טכנאי", "שיפוצ", "הובלות", "ניקיון", "הדברה", "מנעולן")],
];

function detectIndustry(t: string): string | undefined {
  return INDUSTRY_PATTERNS.find(([, re]) => re.test(t))?.[0];
}

/** Answer a knowledge question, or undefined if the message isn't one. */
function knowledgeAnswer(t: string, { industries = true } = {}): string | undefined {
  if (has(t, P.setupFee)) return answers.price;
  if (has(t, P.setup)) return answers.setup;
  if (has(t, P.price)) return answers.price;
  if (has(t, P.trial)) return answers.trial;
  if (has(t, P.whatsapp)) return answers.whatsapp;
  if (has(t, P.phoneNumber)) return answers.phoneNumber;
  if (has(t, P.outbound)) return answers.outbound;
  if (has(t, P.integrations)) return answers.integrations;
  if (has(t, P.languages)) return answers.languages;
  if (has(t, P.privacy)) return answers.privacy;
  if (has(t, P.handoff)) return answers.handoff;
  if (has(t, P.robot)) return answers.robot;
  if (has(t, P.cancel)) return answers.cancel;
  if (has(t, P.hours)) return answers.hours;
  if (has(t, P.howItWorks)) return answers.howItWorks;
  if (!industries) return undefined;
  const industry = detectIndustry(t);
  if (industry) return industryAnswer(industry);
  return undefined;
}

const LEAD_IN = /^(כן|לא|היי|הי|שלום|אהלן|אוקיי|אוקי|טוב|בסדר|יאללה|נעים מאוד|נעים|סבבה|אז)\s+/;
const NAME_MARKER = /(?:^|\s)(?:שמי|השם שלי|קוראים לי|שם שלי)\s+(.+)$/;
const NAME_PREFIX = /^(אני|זה|זאת|מדבר|מדברת|כאן)\s+/;
const NOT_A_NAME = new Set(["לא", "כן", "אין", "רגע", "מה", "למה", "איך", "אוקיי", "אוקי", "טוב", "בסדר", "תודה", "שלום", "היי", "הי"]);

export function extractName(raw: string): string | undefined {
  let t = normalize(raw).replace(/\?/g, "").trim();
  for (let i = 0; i < 3 && LEAD_IN.test(t); i++) t = t.replace(LEAD_IN, "");
  const marked = NAME_MARKER.exec(t);
  if (marked) t = marked[1];
  for (let i = 0; i < 2; i++) t = t.replace(NAME_PREFIX, "");
  t = t.replace(/^(ה|ו)?שם\s+/, "");
  const words = t.split(" ").filter(Boolean).slice(0, 3);
  if (words.length === 0) return undefined;
  if (!words.every((w) => /^\p{L}+$/u.test(w))) return undefined;
  if (NOT_A_NAME.has(words[0])) return undefined;
  const name = words.join(" ");
  if (name.length < 2 || name.length > 40) return undefined;
  return name.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

function cleanBusiness(raw: string): string | undefined {
  let t = raw.trim().replace(/[.!?]+$/, "");
  t = t.replace(/^(יש לי|יש לנו|אני בעל|אני בעלת|אני מנהל|אני מנהלת|אנחנו|זה|העסק שלי הוא|העסק שלי|עסק של)\s+/, "");
  t = t.slice(0, 80).trim();
  return t.length >= 2 ? t : undefined;
}

function confirmText(s: DemoState): string {
  return `רק לוודא: ${s.name}, ${s.business}, ובמספר ${s.phoneDisplay}. נכון?`;
}

function askFor(stage: DemoState["stage"], s: DemoState): string {
  switch (stage) {
    case "ask_name":
      return "איך קוראים לך?";
    case "ask_business":
      return `נעים מאוד${s.name ? `, ${s.name}` : ""}! איזה עסק יש לך?`;
    case "ask_phone":
      return "ולאיזה מספר נחזור אלייך?";
    case "confirm":
      return confirmText(s);
    default:
      return "";
  }
}

export function leadSavedReply(name: string): string {
  return `מעולה ${name}, רשמתי! הצוות שלנו יחזור אלייך ${contact.responseTime}. יש עוד שאלה בינתיים?`;
}

export const leadFailedReply =
  "אוי, לא הצלחתי לשמור את הפרטים כרגע. אפשר להשאיר אותם בטופס בתחתית העמוד, וזה יגיע אלינו מיד.";

function startLeadFlow(state: DemoState): EngineResult {
  if (state.leadSaved) {
    return { reply: `כבר רשמתי אותך${state.name ? `, ${state.name}` : ""}. נחזור אלייך ${contact.responseTime}.`, state };
  }
  const next: DemoState = { ...state, stage: "ask_name" };
  return { reply: `בשמחה! אאסוף כמה פרטים קצרים והצוות יחזור אלייך. ${askFor("ask_name", next)}`, state: next };
}

function handleSlot(text: string, t: string, state: DemoState): EngineResult {
  if (has(t, P.stop)) {
    return { reply: "אין בעיה, עצרתי. אפשר להמשיך לשאול אותי מה שבא לך.", state: { ...initialDemoState, leadSaved: state.leadSaved } };
  }

  // A question in the middle of the flow: answer it, then ask for the slot again.
  const looksLikeQuestion = has(t, P.question) && state.stage !== "confirm";
  if (looksLikeQuestion) {
    const answer = knowledgeAnswer(t, { industries: false });
    if (answer) return { reply: `${answer} ${askFor(state.stage, state)}`, state };
  }

  switch (state.stage) {
    case "ask_name": {
      const name = extractName(text);
      if (!name) return { reply: "לא קלטתי את השם. איך קוראים לך?", state };
      const next: DemoState = { ...state, name, stage: state.business ? (state.phone ? "confirm" : "ask_phone") : "ask_business" };
      return { reply: next.stage === "confirm" ? confirmText(next) : askFor(next.stage, next), state: next };
    }
    case "ask_business": {
      const phoneInText = extractPhone(text);
      // Strip the number (typed or spoken) out of "מוסך אפס חמש אפס…" before keeping the rest as the business.
      const business = cleanBusiness(phoneInText ? spokenDigitsToNumbers(text).replace(/[\d\s\-+().]{7,}/g, " ") : text);
      if (!business) return { reply: "איזה סוג עסק? למשל מרפאה, מוסך או משרד.", state };
      const next: DemoState = phoneInText
        ? { ...state, business, phone: phoneInText.e164, phoneDisplay: phoneInText.display, stage: "confirm" }
        : { ...state, business, stage: state.phone ? "confirm" : "ask_phone" };
      return { reply: next.stage === "confirm" ? confirmText(next) : askFor(next.stage, next), state: next };
    }
    case "ask_phone": {
      const phone = extractPhone(text);
      if (!phone) {
        const misses = state.phoneMisses + 1;
        const next = { ...state, phoneMisses: misses };
        return misses >= 3
          ? { reply: "המספר לא נקלט לי טוב. אפשר להשאיר אותו בטופס בתחתית העמוד, או לכתוב אותו כאן בספרות.", state: next }
          : { reply: "לא הצלחתי לקלוט את המספר. אפשר להגיד אותו שוב, ספרה אחרי ספרה?", state: next };
      }
      const next: DemoState = { ...state, phone: phone.e164, phoneDisplay: phone.display, stage: "confirm" };
      return { reply: confirmText(next), state: next };
    }
    case "confirm": {
      if (!state.name || !state.business || !state.phone) {
        return { reply: `חסר לי פרט. ${askFor("ask_name", state)}`, state: { ...state, stage: "ask_name" } };
      }
      const phone = extractPhone(text);
      if (phone && phone.e164 !== state.phone) {
        const next: DemoState = { ...state, phone: phone.e164, phoneDisplay: phone.display };
        return { reply: `עדכנתי. ${confirmText(next)}`, state: next };
      }
      // Corrections win over "yes": "כן, אבל השם לא נכון" must not save the wrong name.
      const mentions = {
        name: has(t, [P.slotWords.name]),
        business: has(t, [P.slotWords.business]),
        phone: has(t, [P.slotWords.phone]),
      };
      if (has(t, P.correction) || mentions.name || mentions.business || mentions.phone) {
        if (mentions.name) return { reply: "אין בעיה. איך קוראים לך?", state: { ...state, stage: "ask_name" } };
        if (mentions.business) return { reply: "אוקיי, איזה עסק?", state: { ...state, stage: "ask_business" } };
        if (mentions.phone) return { reply: "אוקיי, מה המספר הנכון?", state: { ...state, stage: "ask_phone" } };
        return { reply: "מה לתקן? השם, העסק או המספר?", state };
      }
      if (has(t, P.yes)) {
        const lead = { name: state.name, business: state.business, phone: state.phone };
        return { reply: leadSavedReply(lead.name), state: { ...initialDemoState, name: state.name, leadSaved: true }, saveLead: lead };
      }
      return { reply: `סליחה, לא הבנתי. ${confirmText(state)}`, state };
    }
    default:
      return { reply: answers.fallback[0], state };
  }
}

export function isGoodbye(text: string): boolean {
  return has(normalize(text), P.bye);
}

export function respond(messages: ChatMessage[], rawState?: DemoState): EngineResult {
  const state: DemoState = { ...initialDemoState, ...rawState };
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return { reply: answers.greeting, state };

  const userTurns = messages.filter((m) => m.role === "user").length;
  if (userTurns > MAX_USER_TURNS) return { reply: answers.turnLimit, state, end: true };

  const text = last.content;
  const t = normalize(text);

  if (state.stage !== "chat") return handleSlot(text, t, state);

  if (has(t, P.bye)) return { reply: answers.bye, state, end: true };
  if (has(t, P.thanks)) return { reply: answers.thanks, state };
  if (has(t, P.lead)) return startLeadFlow(state);

  const answer = knowledgeAnswer(t);
  if (answer) return { reply: answer, state };

  if (has(t, P.greeting)) return { reply: answers.greeting, state };
  if (has(t, P.yes)) return startLeadFlow(state);

  const fallbackIndex = userTurns % answers.fallback.length;
  return { reply: answers.fallback[fallbackIndex], state };
}

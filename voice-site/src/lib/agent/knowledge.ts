import { brand, contact, plans, pricing, trust } from "@/config/site";
import { faqs } from "@/content/faq";
import { industries } from "@/content/industries";

/** Prices written the way they sound when spoken: "490 שקל". */
function shekels(n: number): string {
  return `${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })} שקל`;
}

export const spoken = {
  plans: plans
    .map((p) => `${p.name} ב-${shekels(p.price)} לחודש עם ${p.minutes} דקות${p.whatsapp ? " וסוכן וואטסאפ" : ""}`)
    .join(", "),
  cheapest: shekels(Math.min(...plans.map((p) => p.price))),
  extraMinute: shekels(pricing.extraMinutePrice),
  whatsappAddon: shekels(pricing.whatsappAddon),
};

/** Canned answers for the rule-based demo engine. Short and speakable. */
export const answers = {
  greeting: `היי! אני ${brand.agentName}, הסוכנת הדיגיטלית של ${brand.name}. אפשר לשאול אותי על מחירים, על איך זה עובד, או לבקש שנבנה סוכן כזה לעסק שלך.`,
  howItWorks: `אני סוכנת AI שעונה לטלפון בשם העסק, בעברית טבעית. אני עונה על שאלות, קובעת תורים ביומן, שולחת אישור בוואטסאפ ומעדכנת את ה-CRM. כל שיחה נשמרת עם תמלול וסיכום. רוצה לשמוע איך זה ייראה אצלכם?`,
  price: `יש שלוש חבילות: ${spoken.plans}. דקה נוספת עולה ${spoken.extraMinute}, אין דמי הקמה ואין התחייבות. המחירים לפני מע״מ.`,
  trial: `כן, בונים ומנסים את הסוכן בחינם, עם ${pricing.trialMinutes} דקות שיחה. משלמים רק כשמחליטים לעלות לאוויר.`,
  setup: `בדרך כלל עולים לאוויר תוך ${trust.goLiveDays}. שיחת היכרות, אנחנו בונים את הסוכן והחיבורים, עושים איתך שיחות בדיקה, ומשם הוא עונה ללקוחות אמיתיים.`,
  integrations: "אני מתחברת ליומן Google, לוואטסאפ, למייל, ל-CRM ולמערכות זימון תורים. כל מערכת אחרת מתחברת דרך API או Webhooks, ואת החיבורים אנחנו מקימים.",
  whatsapp: `כן, אותו סוכן עונה גם בוואטסאפ, עם אותו ידע ואותו זיכרון על כל לקוח. בחבילות Growth ו-Pro זה כלול, וב-Start זו תוספת של ${spoken.whatsappAddon} לחודש.`,
  phoneNumber: "כל סוכן מקבל מספר טלפון ישראלי ייעודי, לשיחות נכנסות ויוצאות. אפשר גם להפנות אליו את המספר הקיים של העסק כשאתם לא זמינים.",
  languages: `אני מדברת ${trust.languages.join(", ")}, ועוברת שפה לפי הלקוח. אפשר גם לבחור קול ואופי שמתאימים לעסק.`,
  privacy: `השרתים נמצאים ב${trust.dataRegion}, התקשורת מוצפנת, ואפשר למחוק הקלטות ותמלולים בכל רגע. המידע לא משמש לאימון מודלים.`,
  handoff: "אתם קובעים מתי להעביר אליכם. למשל בבקשה מפורשת, בלקוח כועס או בנושא רגיש. אני מעבירה את השיחה בזמן אמת, או מבטיחה שיחזרו ושולחת לכם סיכום מיידי.",
  robot: `אני סוכנת AI, ואני תמיד אומרת את זה כשמישהו שואל. ככה גם הסוכן שלכם יתנהג. רוצה לשמוע מה אני יכולה לעשות לעסק שלך?`,
  cancel: "אין התחייבות. המנוי חודשי ואפשר לבטל בכל רגע, והביטול נכנס לתוקף בסוף החודש ששולם.",
  hours: "אני זמינה 24 שעות ביממה, שבעה ימים בשבוע, כולל לילות, שבתות וחגים. עשרה לקוחות מתקשרים באותו רגע? כולם מקבלים מענה.",
  outbound: "כן, אני גם מתקשרת החוצה. למשל חוזרת לליד מהאתר תוך דקה, מזכירה תור יום לפני, או עושה סקר שביעות רצון אחרי שירות.",
  fallback: [
    "שאלה טובה. את הפרט הזה עדיף לבדוק עם הצוות שלנו בשיחת היכרות. בינתיים אפשר לשאול אותי על מחירים, על חיבורים, או לבקש שנחזור אלייך.",
    "לא בטוחה שהבנתי עד הסוף. אפשר לשאול על המחיר, על הקמה, על וואטסאפ, או להגיד ״אני רוצה סוכן״ ואני ארשום את הפרטים.",
    "כאן אני רק דוגמה קטנה, אבל הסוכן שלכם יכיר את העסק לעומק. רוצה שאתאם לך שיחה עם הצוות?",
  ],
  bye: "תודה שדיברת איתי! יום מעולה.",
  thanks: "בשמחה! יש עוד משהו שאפשר לעזור בו?",
  turnLimit: "נהניתי לדבר! כדי להמשיך, השאירו פרטים בטופס למטה ונחזור אליכם.",
};

export function industryAnswer(id: string): string | undefined {
  const ind = industries.find((i) => i.id === id);
  if (!ind) return undefined;
  const does = ind.does.slice(0, 3).join(", ");
  return `ל${ind.label} זה מתאים מצוין. למשל: ${does}. רוצה שנבנה סוכן כזה בשבילכם?`;
}

/** Facts block for the LLM system prompt. Built from the same config as the page. */
export function knowledgeText(): string {
  const planLines = plans
    .map(
      (p) =>
        `- ${p.name}: ${p.price} ILS/month, ${p.minutes} talk minutes, ${p.agents} agent(s), WhatsApp ${p.whatsapp ? "included" : `add-on ${pricing.whatsappAddon} ILS/month`}. ${p.features.join("; ")}`,
    )
    .join("\n");
  const faqLines = faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");
  const industryLines = industries.map((i) => `- ${i.label}: ${i.does.join("; ")}`).join("\n");
  return [
    `Company: ${brand.name}. Product: ${brand.description}`,
    `Plans (prices before VAT, no setup fee, no commitment, cancel monthly):\n${planLines}`,
    `Extra minute: ${pricing.extraMinutePrice} ILS. Free trial: ${pricing.trialMinutes} talk minutes to build and try the agent.`,
    `Go-live: ${trust.goLiveDays}. Data region: ${trust.dataRegion}. Languages: ${trust.languages.join(", ")}.`,
    `The team gets back to new leads ${contact.responseTime}.`,
    `Industries and what the agent does there:\n${industryLines}`,
    `FAQ:\n${faqLines}`,
  ].join("\n\n");
}

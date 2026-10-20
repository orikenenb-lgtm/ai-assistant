import type { WorkflowDefinition } from "./definition";

/** Starter workflows offered in the "new workflow" gallery. */
export type WorkflowTemplate = { key: string; name: { he: string; en: string }; description: { he: string; en: string }; definition: WorkflowDefinition };

const p = (x: number, y: number) => ({ x, y });

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "blank",
    name: { he: "תהליך ריק", en: "Blank workflow" },
    description: { he: "מתחילים מאפס עם טריגר של איש קשר חדש", en: "Start from scratch with a new-contact trigger" },
    definition: {
      nodes: [{ id: "trigger", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: p(0, 0) }],
      edges: [],
    },
  },
  {
    key: "new_lead_round_robin",
    name: { he: "שיוך לידים חדשים בסבב", en: "Round-robin new leads" },
    description: { he: "כל ליד חדש משויך לנציג הפנוי ביותר ומקבל משימת מעקב", en: "Assign each new lead to the least busy rep and create a follow-up" },
    definition: {
      nodes: [
        { id: "trigger", type: "trigger", config: { kind: "event", event: "lead.created", filters: [] }, position: p(0, 0) },
        { id: "assign", type: "action", config: { action: "assign_owner", params: { strategy: "round_robin" } }, position: p(0, 140) },
        { id: "notify", type: "action", config: { action: "notify_user", params: { target: "owner", title: "ליד חדש שויך אליך", body: "צרו קשר תוך שעה" } }, position: p(0, 280) },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "assign" },
        { id: "e2", source: "assign", target: "notify" },
      ],
    },
  },
  {
    key: "deal_won_followup",
    name: { he: "עסקה נסגרה → הערה ותזכורת", en: "Deal won → note and reminder" },
    description: { he: "מתעד את הזכייה ומזכיר לבעל העסקה לבדוק שביעות רצון אחרי 7 ימים", en: "Log the win and remind the owner to check satisfaction after 7 days" },
    definition: {
      nodes: [
        { id: "trigger", type: "trigger", config: { kind: "event", event: "deal.won", filters: [] }, position: p(0, 0) },
        { id: "note", type: "action", config: { action: "add_note", params: { body: "🎉 העסקה {{deal.title}} נסגרה בהצלחה" } }, position: p(0, 140) },
        { id: "wait", type: "delay", config: { amount: 7, unit: "days" }, position: p(0, 280) },
        { id: "notify", type: "action", config: { action: "notify_user", params: { target: "owner", title: "בדיקת שביעות רצון: {{deal.title}}", body: "עברו 7 ימים מהסגירה" } }, position: p(0, 420) },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "note" },
        { id: "e2", source: "note", target: "wait" },
        { id: "e3", source: "wait", target: "notify" },
      ],
    },
  },
  {
    key: "vip_tag_alert",
    name: { he: "התראה על לקוח VIP", en: "VIP customer alert" },
    description: { he: "כשמתווספת תגית, בודק אם הלקוח הפך ללקוח ומעדכן את האחראי", en: "When a tag is added, check the stage and alert the owner" },
    definition: {
      nodes: [
        { id: "trigger", type: "trigger", config: { kind: "event", event: "contact.tag_added", filters: [] }, position: p(0, 0) },
        { id: "check", type: "condition", config: { match: "all", rules: [{ field: "contact.lifecycleStage", op: "eq", value: "customer" }] }, position: p(0, 140) },
        { id: "notify", type: "action", config: { action: "notify_user", params: { target: "owner", title: "{{contact.firstName}} קיבל/ה תגית חדשה", body: "" } }, position: p(-160, 300) },
        { id: "stage", type: "action", config: { action: "update_contact_stage", params: { stage: "opportunity" } }, position: p(160, 300) },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "check" },
        { id: "e2", source: "check", target: "notify", branch: "true" },
        { id: "e3", source: "check", target: "stage", branch: "false" },
      ],
    },
  },
  {
    key: "weekly_inactive",
    name: { he: "לקוחות לא פעילים — סקירה שבועית", en: "Weekly inactive customers review" },
    description: { he: "כל יום ראשון ב-9:00 מתזכר את האחראי על לקוחות בשלב 'לקוח'", en: "Every Sunday 09:00 remind owners about customers" },
    definition: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          config: { kind: "schedule", frequency: "weekly", hour: 9, weekday: 0, segment: [{ field: "contact.lifecycleStage", op: "eq", value: "customer" }] },
          position: p(0, 0),
        },
        { id: "notify", type: "action", config: { action: "notify_user", params: { target: "owner", title: "כדאי לבדוק מה שלום {{contact.firstName}} {{contact.lastName}}", body: "" } }, position: p(0, 140) },
      ],
      edges: [{ id: "e1", source: "trigger", target: "notify" }],
    },
  },
];

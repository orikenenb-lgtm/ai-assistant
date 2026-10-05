/**
 * סנכרון ענן — V2 בלבד. לא מחובר ב-V1 ולא נקרא מאף מקום.
 *
 * התכנון: מתאם Supabase שמעלה ומוריד שינויים בטבלאות tasks ו-reminders לפי updated_at
 * (last-write-wins), כשמחיקה היא tombstone (deleted=1) ולא מחיקה פיזית — לכן כל
 * המאגרים ב-V1 כבר מעדכנים updated_at בכל שינוי ומסננים deleted=0 בקריאה.
 * היסטוריית שיחה, יומן פעולות ושימוש נשארים מקומיים בלבד (פרטיות).
 */

export interface SyncAdapter {
  /** מעלה את כל השורות ש-updated_at שלהן >= since (ISO UTC). */
  pushChanges(since: string): Promise<void>;
  /** מוריד שינויים מהענן וממזג אותם לפי last-write-wins. */
  pullChanges(): Promise<void>;
}

/** מימוש ריק: V1 עובד מקומית בלבד. */
export class NoopSyncAdapter implements SyncAdapter {
  async pushChanges(_since: string): Promise<void> {
    // V1: אין סנכרון ענן
  }

  async pullChanges(): Promise<void> {
    // V1: אין סנכרון ענן
  }
}

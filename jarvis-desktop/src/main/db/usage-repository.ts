import type { DatabaseSync } from 'node:sqlite';
import type { Clock, UsageRepository } from '../core/contracts';
import type { UsageSummaryRow } from '../../shared/types';
import { localDayRangeUtc, localMonthRangeUtc } from '../time/time';
import { normalizeIso, num, str, type Row } from './sql';

/**
 * מעקב שימוש בספקי ענן (טוקנים, שניות אודיו, תווים) — בלי מחירים.
 * הסיכום מחושב לפי היום והחודש המקומיים בישראל:
 *   period = 'today' — היום הנוכחי ב-Asia/Jerusalem
 *   period = 'month' — החודש הנוכחי ב-Asia/Jerusalem (YYYY-MM של now)
 */

const KINDS: ReadonlyArray<UsageSummaryRow['kind']> = ['llm', 'vision', 'stt', 'tts'];

/** מספר אי-שלילי וסופי, אחרת 0 (ספק שהחזיר ערך משונה לא ישבור את הסיכום). */
function safeCount(v: number | undefined, integer: boolean): number {
  if (v === undefined || !Number.isFinite(v) || v < 0) return 0;
  return integer ? Math.round(v) : v;
}

export function createUsageRepository(db: DatabaseSync, deps: { clock: Clock }): UsageRepository {
  const insertStmt = db.prepare(
    `INSERT INTO usage (provider, kind, model, input_tokens, output_tokens, audio_seconds, characters, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const summaryStmt = db.prepare(
    `SELECT provider, kind, model,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(audio_seconds), 0) AS audio_seconds,
            COALESCE(SUM(characters), 0) AS characters
     FROM usage
     WHERE created_at >= ? AND created_at < ?
     GROUP BY provider, kind, model
     ORDER BY provider, kind, model`,
  );
  const clearStmt = db.prepare('DELETE FROM usage');

  const summarize = (period: string, range: { startIso: string; endIso: string }): UsageSummaryRow[] =>
    (summaryStmt.all(range.startIso, range.endIso) as Row[]).map((r) => {
      const kind = str(r, 'kind') as UsageSummaryRow['kind'];
      return {
        provider: str(r, 'provider'),
        kind: KINDS.includes(kind) ? kind : 'llm',
        model: str(r, 'model'),
        period,
        requests: num(r, 'requests'),
        inputTokens: num(r, 'input_tokens'),
        outputTokens: num(r, 'output_tokens'),
        audioSeconds: Math.round(num(r, 'audio_seconds') * 10) / 10,
        characters: num(r, 'characters'),
      };
    });

  return {
    record(entry) {
      if (!KINDS.includes(entry.kind)) return;
      insertStmt.run(
        entry.provider || 'unknown',
        entry.kind,
        entry.model || 'unknown',
        safeCount(entry.inputTokens, true),
        safeCount(entry.outputTokens, true),
        safeCount(entry.audioSeconds, false),
        safeCount(entry.characters, true),
        normalizeIso(entry.createdAt, deps.clock.now()),
      );
    },

    summary(now) {
      return [...summarize('today', localDayRangeUtc(now)), ...summarize('month', localMonthRangeUtc(now))];
    },

    clear() {
      clearStmt.run();
    },
  };
}

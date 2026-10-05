/**
 * מקטעים קטנים: "מסך", "פרטיות ושימוש" ו"אודות".
 */
import { useState } from 'react';
import type { UsageSummaryRow } from '../../shared/types';
import { useAsyncData } from '../hooks/useAsyncData';
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { formatNumber, formatSeconds } from '../state/format';
import { ConfirmButton, Field, TextInput, Toggle, type SectionProps } from './fields';
import { parseIntInRange, rangeError } from './helpers';

/* ---------------- מסך ---------------- */

export function ScreenSection({ settings, saver }: SectionProps) {
  const t = he.settings.screen;
  const { screen } = settings;
  return (
    <div className="section">
      <Toggle
        label={t.requireConfirmation}
        checked={screen.requireConfirmation}
        hint={t.requireConfirmationHint}
        onChange={(v) => void saver.save('requireConfirmation', { screen: { requireConfirmation: v } })}
        status={saver.status.requireConfirmation}
      />
      <TextInput
        key={`edge-${screen.maxLongEdgePx}`}
        label={t.maxLongEdge}
        value={String(screen.maxLongEdgePx)}
        ltr
        inputMode="numeric"
        maxLength={4}
        validate={(v) => (parseIntInRange(v, 640, 2576) === null ? rangeError(640, 2576) : null)}
        onCommit={(v) => void saver.save('maxLongEdge', { screen: { maxLongEdgePx: parseIntInRange(v, 640, 2576) ?? screen.maxLongEdgePx } })}
        status={saver.status.maxLongEdge}
      />
    </div>
  );
}

/* ---------------- פרטיות ושימוש ---------------- */

const DASHBOARDS: ReadonlyArray<{ name: string; url: string | null; text?: string }> = [
  { name: 'Anthropic', url: 'https://console.anthropic.com/settings/usage' },
  { name: 'OpenAI', url: 'https://platform.openai.com/usage' },
  { name: 'Azure', url: null, text: he.settings.privacy.azureDashboard },
];

function UsageTable() {
  const controller = useController();
  const version = useUiState((s) => s.dataVersion.usage + s.dataVersion.history);
  const usage = useAsyncData<UsageSummaryRow[]>(`usage:${version}`, () => controller.api.data.usageSummary());
  const t = he.settings.privacy;

  if (usage.data === null) {
    return <p className={usage.failed ? 'field-error' : 'field-hint'}>{usage.failed ? t.usageFailed : he.today.loading}</p>;
  }
  if (usage.data.length === 0) return <p className="field-hint">{t.usageEmpty}</p>;

  return (
    <div className="table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col">{t.cols.period}</th>
            <th scope="col">{t.cols.provider}</th>
            <th scope="col">{t.cols.kind}</th>
            <th scope="col">{t.cols.model}</th>
            <th scope="col">{t.cols.requests}</th>
            <th scope="col">{t.cols.tokens}</th>
            <th scope="col">{t.cols.audio}</th>
            <th scope="col">{t.cols.chars}</th>
          </tr>
        </thead>
        <tbody>
          {usage.data.map((row) => (
            <tr key={`${row.period}|${row.provider}|${row.kind}|${row.model}`}>
              <td>{t.periods[row.period] ?? <span dir="ltr">{row.period}</span>}</td>
              <td dir="ltr">{row.provider}</td>
              <td>{t.kinds[row.kind] ?? row.kind}</td>
              <td className="mono" dir="ltr">
                {row.model}
              </td>
              <td className="num">{formatNumber(row.requests)}</td>
              <td className="num" dir="ltr">
                {formatNumber(row.inputTokens)} / {formatNumber(row.outputTokens)}
              </td>
              <td className="num">{formatSeconds(row.audioSeconds)}</td>
              <td className="num">{formatNumber(row.characters)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PrivacySection({ settings, saver }: SectionProps) {
  const controller = useController();
  const t = he.settings.privacy;
  const { privacy } = settings;
  const [clearResult, setClearResult] = useState<{ ok: boolean; text: string } | null>(null);

  const clear = async (scope: 'conversation' | 'all') => {
    setClearResult(null);
    try {
      await controller.api.data.clearHistory(scope);
      setClearResult({ ok: true, text: t.cleared });
    } catch {
      setClearResult({ ok: false, text: t.clearFailed });
    }
  };

  return (
    <div className="section">
      <Toggle
        label={t.saveHistory}
        checked={privacy.saveConversationHistory}
        onChange={(v) => void saver.save('saveHistory', { privacy: { saveConversationHistory: v } })}
        status={saver.status.saveHistory}
      />
      <TextInput
        key={`ret-${privacy.historyRetentionDays}`}
        label={t.retention}
        value={String(privacy.historyRetentionDays)}
        ltr
        inputMode="numeric"
        maxLength={3}
        validate={(v) => (parseIntInRange(v, 1, 365) === null ? rangeError(1, 365) : null)}
        onCommit={(v) =>
          void saver.save('retention', { privacy: { historyRetentionDays: parseIntInRange(v, 1, 365) ?? privacy.historyRetentionDays } })
        }
        status={saver.status.retention}
      />
      <Toggle
        label={t.verboseLogs}
        checked={privacy.verboseLogs}
        onChange={(v) => void saver.save('verboseLogs', { privacy: { verboseLogs: v } })}
        status={saver.status.verboseLogs}
      />
      <div className="entry-actions">
        <ConfirmButton label={t.clearConversation} confirmText={t.clearConversationConfirm} onConfirm={() => clear('conversation')} />
        <ConfirmButton label={t.clearAll} confirmText={t.clearAllConfirm} onConfirm={() => clear('all')} />
      </div>
      {clearResult && (
        <p className={clearResult.ok ? 'save-status' : 'field-error'} data-tone={clearResult.ok ? 'green' : 'red'} role="status">
          {clearResult.text}
        </p>
      )}

      <h3 className="section-head">{t.usageTitle}</h3>
      <p className="field-hint">{t.usageNote}</p>
      <UsageTable />

      <Field label={t.dashboards}>
        <ul className="dashboards">
          {DASHBOARDS.map((d) => (
            <li key={d.name}>
              <span className="dash-name" dir="ltr">
                {d.name}
              </span>
              {d.url ? (
                // טקסט רגיל לבחירה והעתקה — ניווט מהחלון חסום מטעמי אבטחה
                <span className="dash-url mono" dir="ltr">
                  {d.url}
                </span>
              ) : (
                <span className="dash-url">{d.text}</span>
              )}
            </li>
          ))}
        </ul>
      </Field>
    </div>
  );
}

/* ---------------- אודות ---------------- */

export function AboutSection() {
  const controller = useController();
  const t = he.settings.about;
  return (
    <div className="section about">
      <dl className="about-grid">
        <dt>{t.version}</dt>
        <dd className="hud-num" dir="ltr">
          {controller.api.version}
        </dd>
        <dt>{t.platform}</dt>
        <dd dir="ltr">{controller.api.platform}</dd>
      </dl>
      <h3 className="section-head">{t.remindersTitle}</h3>
      <p>{t.remindersLimitation}</p>
      <h3 className="section-head">{t.privacyTitle}</h3>
      <p>{t.privacyText}</p>
      <h3 className="section-head">{t.shortcutsTitle}</h3>
      <dl className="shortcuts">
        {t.shortcuts.map(([key, desc]) => (
          <div key={key} className="shortcut-row">
            <dt>
              <kbd dir="ltr">{key}</kbd>
            </dt>
            <dd>{desc}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

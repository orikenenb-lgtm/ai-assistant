/**
 * מקטע "מילת הפעלה": הפעלה, מנוע (עם העובדות על רישיון ומפתח), רגישות, מפתח Picovoice ומצב חי.
 */
import type { SecretsStatus } from '../../shared/settings-schema';
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { Field, RadioGroup, Slider, Toggle, type SectionProps } from './fields';
import { SecretField } from './SecretField';

const t = he.settings.wake;

export function WakeWordSection({
  settings,
  saver,
  secrets,
  onSecrets,
}: SectionProps & { secrets: SecretsStatus | null; onSecrets: (s: SecretsStatus) => void }) {
  const controller = useController();
  const wake = useUiState((s) => s.wake);
  const { wakeWord } = settings;

  return (
    <div className="section">
      <p className="privacy-note" role="note">
        {t.localStatement}
      </p>
      <Toggle
        label={t.enable}
        checked={wakeWord.enabled}
        onChange={(v) => void saver.save('wakeEnabled', { wakeWord: { enabled: v } })}
        status={saver.status.wakeEnabled}
      />
      <RadioGroup
        label={t.engine}
        value={wakeWord.engine}
        options={[
          { value: 'openwakeword', label: t.engineOpen, hint: t.engineOpenFacts },
          { value: 'porcupine', label: t.enginePorcupine, hint: t.enginePorcupineFacts },
        ]}
        onChange={(v) => void saver.save('wakeEngine', { wakeWord: { engine: v } })}
        status={saver.status.wakeEngine}
      />
      <Slider
        key={`sens-${wakeWord.sensitivity}`}
        label={t.sensitivity}
        value={wakeWord.sensitivity}
        min={0.1}
        max={0.95}
        step={0.05}
        format={(v) => v.toFixed(2)}
        hint={t.sensitivityHint}
        onCommit={(v) => void saver.save('sensitivity', { wakeWord: { sensitivity: Math.round(v * 100) / 100 } })}
        status={saver.status.sensitivity}
      />
      {wakeWord.engine === 'porcupine' && (
        <SecretField name="picovoiceAccessKey" label={t.picovoiceKey} status={secrets} onStatus={onSecrets} />
      )}
      <Field label={t.liveStatus}>
        <div className="wake-status" data-status={wake.status} role="status" aria-live="polite">
          <span className="chip-dot" aria-hidden="true" />
          <span>{t.states[wake.status]}</span>
        </div>
        {wake.error && (
          <p className="field-error" role="alert">
            {wake.error}
          </p>
        )}
        {wake.detail && (
          <p className="field-hint">
            {he.wake.technicalDetail}{' '}
            <span className="mono" dir="ltr">
              {wake.detail}
            </span>
          </p>
        )}
        {wakeWord.enabled && (
          <button type="button" className="btn" onClick={() => controller.restartWakeWord()}>
            {t.restart}
          </button>
        )}
      </Field>
    </div>
  );
}

/**
 * מקטע "מוח": מפתח Claude, מודל, עומק חשיבה, זמן המתנה, מצב מוח ובדיקת חיבור.
 */
import { useState } from 'react';
import type { SecretsStatus } from '../../shared/settings-schema';
import type { ServiceStatus } from '../../shared/types';
import { he } from '../i18n/he';
import { useController } from '../state/controller';
import { ActionButton, Field, RadioGroup, Select, TextInput, type SectionProps } from './fields';
import { CLAUDE_MODELS, MODEL_ID_RE, isKnownModel, parseIntInRange, rangeError } from './helpers';
import { SecretField } from './SecretField';

const CUSTOM = '__custom__';

export function ServiceTestResult({ result }: { result: ServiceStatus | { error: string } | null }) {
  if (!result) return null;
  if ('error' in result) {
    return (
      <p className="field-error" role="alert">
        {result.error}
      </p>
    );
  }
  const ok = result.state === 'ok' || result.state === 'local';
  return (
    <p className={ok ? 'save-status' : 'field-error'} data-tone={ok ? 'green' : 'red'} role={ok ? 'status' : 'alert'}>
      {ok ? he.settings.brain.testOk : he.settings.brain.testFailed(result.lastError_he ?? he.system.serviceStates[result.state])}
    </p>
  );
}

export function BrainSection({
  settings,
  saver,
  secrets,
  onSecrets,
}: SectionProps & { secrets: SecretsStatus | null; onSecrets: (s: SecretsStatus) => void }) {
  const controller = useController();
  const t = he.settings.brain;
  const { ai } = settings;
  const known = isKnownModel(ai.model);
  const [customOpen, setCustomOpen] = useState(!known);
  const [test, setTest] = useState<ServiceStatus | { error: string } | null>(null);
  const selectValue = customOpen || !known ? CUSTOM : ai.model;

  const modelOptions = [
    ...CLAUDE_MODELS.map((m) => ({ value: m.id, label: m.isDefault ? `${m.id} (${t.modelDefault})` : m.id })),
    { value: CUSTOM, label: t.modelCustom },
  ];

  return (
    <div className="section">
      <SecretField name="anthropicApiKey" label={t.claudeKey} status={secrets} onStatus={onSecrets} />

      <Select
        label={t.model}
        value={selectValue}
        options={modelOptions}
        status={saver.status.model}
        onChange={(v) => {
          if (v === CUSTOM) {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          void saver.save('model', { ai: { model: v } });
        }}
      />
      {selectValue === CUSTOM && (
        <TextInput
          key={ai.model}
          label={t.customModel}
          value={known ? '' : ai.model}
          ltr
          maxLength={67}
          placeholder="claude-…"
          validate={(v) => (MODEL_ID_RE.test(v.trim()) ? null : t.customModelInvalid)}
          onCommit={(v) => void saver.save('model', { ai: { model: v.trim() } })}
          status={saver.status.model}
        />
      )}

      <Select
        label={t.effort}
        value={ai.effort}
        options={[
          { value: 'low', label: t.effortLow },
          { value: 'medium', label: t.effortMedium },
          { value: 'high', label: t.effortHigh },
        ]}
        onChange={(v) => void saver.save('effort', { ai: { effort: v } })}
        status={saver.status.effort}
      />

      <TextInput
        key={`timeout-${ai.requestTimeoutSec}`}
        label={t.timeout}
        value={String(ai.requestTimeoutSec)}
        ltr
        inputMode="numeric"
        maxLength={3}
        validate={(v) => (parseIntInRange(v, 10, 180) === null ? rangeError(10, 180) : null)}
        onCommit={(v) => void saver.save('timeout', { ai: { requestTimeoutSec: parseIntInRange(v, 10, 180) ?? ai.requestTimeoutSec } })}
        status={saver.status.timeout}
      />

      <RadioGroup
        label={t.brainMode}
        value={ai.brainMode}
        options={[
          { value: 'auto', label: t.brainAuto },
          { value: 'local-only', label: t.brainLocal },
        ]}
        onChange={(v) => void saver.save('brainMode', { ai: { brainMode: v } })}
        status={saver.status.brainMode}
      />

      <Field label={t.testConnection}>
        <ActionButton
          label={t.testConnection}
          onRun={async () => {
            setTest(null);
            try {
              const res = await controller.api.system.testService('llm');
              setTest(res);
              void controller.refreshServices();
            } catch {
              setTest({ error: he.errors.ipc('testService') });
            }
          }}
        />
        <ServiceTestResult result={test} />
      </Field>
    </div>
  );
}

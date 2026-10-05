/**
 * מקטע "קול": ספק תמלול, ספק הקראה וקולות, מיקרופון ושיחה, ובדיקות (מד עוצמה, דוגמה, תמלול).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SecretsStatus, Settings } from '../../shared/settings-schema';
import type { ServiceStatus } from '../../shared/types';
import type { SystemVoiceInfo } from '../audio';
import { useAsyncData } from '../hooks/useAsyncData';
import { he } from '../i18n/he';
import { useController, useUiState, type VoiceTestResult } from '../state/controller';
import { ServiceTestResult } from './BrainSection';
import { ActionButton, Field, Select, Slider, TextInput, Toggle, type SectionProps } from './fields';
import {
  AZURE_HE_VOICES,
  AZURE_REGION_RE,
  OPENAI_TTS_VOICES,
  STT_OPENAI_MODELS,
  parseIntInRange,
  partitionVoices,
  rangeError,
} from './helpers';
import { SecretField } from './SecretField';

const t = he.settings.voice;

/* ---------------- רשימת מיקרופונים ---------------- */

interface MicDevice {
  deviceId: string;
  label: string;
}

// מונה שינויים ברשימת ההתקנים (חיבור/ניתוק מיקרופון) — מאזין יחיד ל-devicechange
const deviceListeners = new Set<() => void>();
let deviceVersion = 0;

function onDeviceChange(): void {
  deviceVersion++;
  for (const l of [...deviceListeners]) l();
}

function subscribeDevices(listener: () => void): () => void {
  const md = navigator.mediaDevices;
  if (!md) return () => undefined;
  if (deviceListeners.size === 0) md.addEventListener('devicechange', onDeviceChange);
  deviceListeners.add(listener);
  return () => {
    deviceListeners.delete(listener);
    if (deviceListeners.size === 0) md.removeEventListener('devicechange', onDeviceChange);
  };
}

function useDeviceVersion(): number {
  return useSyncExternalStore(subscribeDevices, () => deviceVersion);
}

async function listMicDevices(): Promise<MicDevice[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) throw new Error('no mediaDevices');
  const all = await md.enumerateDevices();
  let n = 0;
  return all
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || t.micUnnamed(++n) }));
}

/* ---------------- מד עוצמת מיקרופון ---------------- */

function MicMeter() {
  const controller = useController();
  const micTest = useUiState((s) => s.micTest);
  const barRef = useRef<HTMLSpanElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = micTest === 'meter';

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!active) {
      bar.style.inlineSize = '0%';
      return;
    }
    let raf = 0;
    const frame = () => {
      // עוצמה אמיתית מהמיקרופון — אין כאן ערך מדומה
      bar.style.inlineSize = `${Math.round(controller.getMicMeterLevel() * 100)}%`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, controller]);

  // סגירת מסך ההגדרות/המקטע עוצרת את המד — לא משאירים מיקרופון פתוח
  useEffect(() => () => void controller.stopMicMeter(), [controller]);

  return (
    <Field label={t.micMeter} hint={he.settings.voice.micMeterHint}>
      <div className="meter-row">
        <button
          type="button"
          className="btn"
          aria-pressed={active}
          onClick={async () => {
            setError(null);
            if (active) await controller.stopMicMeter();
            else setError(await controller.startMicMeter());
          }}
        >
          {active ? t.micMeterStop : t.micMeterStart}
        </button>
        <div className="bar level-bar" role="img" aria-label={t.micMeterLabel} data-tone={active ? 'cyan' : 'dim'}>
          <span ref={barRef} />
        </div>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Field>
  );
}

/* ---------------- בדיקת תמלול ודוגמת הקראה ---------------- */

function VoiceTests({ settings }: { settings: Settings }) {
  const controller = useController();
  const micTest = useUiState((s) => s.micTest);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceTestResult | null>(null);

  const stage = micTest === 'recording' ? t.transcribeRecording : micTest === 'transcribing' ? t.transcribeSending : null;

  return (
    <>
      <MicMeter />
      <div className="field">
        <ActionButton
          label={t.sampleButton}
          disabled={settings.tts.provider === 'none'}
          onRun={async () => {
            setSampleError(await controller.playSample());
          }}
        />
        {sampleError && (
          <p className="field-error" role="alert">
            {sampleError}
          </p>
        )}
      </div>
      <Field label={t.transcribeTest} hint={t.transcribeTestHint}>
        <ActionButton
          label={t.transcribeTest}
          disabled={settings.stt.provider === 'none'}
          onRun={async () => {
            setResult(null);
            setResult(await controller.runTranscriptionTest());
          }}
        />
        {stage && (
          <p className="save-status" role="status">
            {stage}
          </p>
        )}
        {result &&
          (result.ok ? (
            <p className="test-transcript" role="status">
              <span className="field-label">{t.transcribeResult}</span> <span dir="auto">{result.text}</span>
            </p>
          ) : (
            <p className="field-error" role="alert">
              {result.message}
            </p>
          ))}
      </Field>
    </>
  );
}

/* ---------------- קולות מערכת ---------------- */

function SystemVoiceSelect({ settings, saver }: SectionProps) {
  const controller = useController();
  const voices = useAsyncData<SystemVoiceInfo[]>('system-voices', () => controller.listSystemVoices());
  const id = 'system-voice-select';

  if (voices.data === null) {
    return (
      <Field label={t.systemVoice}>
        <p className={voices.failed ? 'field-error' : 'field-hint'}>{voices.failed ? t.systemVoicesFailed : t.systemVoicesLoading}</p>
      </Field>
    );
  }
  const { hebrew, other } = partitionVoices(voices.data);
  const current = settings.tts.systemVoiceName;
  const missing = current && !voices.data.some((v) => v.name === current);

  return (
    <Field label={t.systemVoice} htmlFor={id} status={saver.status.systemVoice} hint={hebrew.length === 0 ? t.noHebrewVoice : undefined}>
      <select
        id={id}
        className="input"
        value={current}
        onChange={(e) => void saver.save('systemVoice', { tts: { systemVoiceName: e.target.value } })}
      >
        <option value="">{t.systemVoiceAuto}</option>
        {missing && <option value={current}>{current}</option>}
        {hebrew.length > 0 && (
          <optgroup label={`★ ${t.systemVoiceHebrew}`}>
            {hebrew.map((v) => (
              <option key={v.name} value={v.name}>
                ★ {v.name} ({v.lang})
              </option>
            ))}
          </optgroup>
        )}
        {other.length > 0 && (
          <optgroup label={t.systemVoiceOther}>
            {other.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </Field>
  );
}

/* ---------------- המקטע ---------------- */

export function VoiceSection({
  settings,
  saver,
  secrets,
  onSecrets,
}: SectionProps & { secrets: SecretsStatus | null; onSecrets: (s: SecretsStatus) => void }) {
  const controller = useController();
  const { stt, tts, voice, azure } = settings;
  const [sttTest, setSttTest] = useState<ServiceStatus | { error: string } | null>(null);
  const [ttsTest, setTtsTest] = useState<ServiceStatus | { error: string } | null>(null);
  const devicesVersion = useDeviceVersion();
  const devices = useAsyncData(`mic-devices:${devicesVersion}`, listMicDevices);

  const usesOpenAi = stt.provider === 'openai' || tts.provider === 'openai';
  const usesAzure = stt.provider === 'azure' || tts.provider === 'azure';

  const runTest = async (service: 'stt' | 'tts', set: (r: ServiceStatus | { error: string }) => void) => {
    try {
      set(await controller.api.system.testService(service));
      void controller.refreshServices();
    } catch {
      set({ error: he.errors.ipc });
    }
  };

  // תווית שמתחילה בעברית — כדי שהטקסט ב-select יוצג מימין לשמאל
  const sttModelOptions = STT_OPENAI_MODELS.map((m) => ({ value: m.id, label: `${m.note} — ${m.id}` }));
  if (!STT_OPENAI_MODELS.some((m) => m.id === stt.openaiModel)) sttModelOptions.push({ value: stt.openaiModel, label: stt.openaiModel });

  const openAiVoiceOptions = OPENAI_TTS_VOICES.map((v) => ({ value: v as string, label: v as string }));
  if (!openAiVoiceOptions.some((o) => o.value === tts.openaiVoice)) openAiVoiceOptions.push({ value: tts.openaiVoice, label: tts.openaiVoice });

  const azureVoiceOptions = AZURE_HE_VOICES.map((v) => ({ value: v as string, label: `${t.azureVoices[v] ?? v} — ${v}` }));
  if (!azureVoiceOptions.some((o) => o.value === tts.azureVoice)) azureVoiceOptions.push({ value: tts.azureVoice, label: tts.azureVoice });

  const deviceOptions = [{ value: '', label: t.micDefault }, ...(devices.data ?? []).map((d) => ({ value: d.deviceId, label: d.label }))];
  if (voice.micDeviceId && !deviceOptions.some((o) => o.value === voice.micDeviceId)) {
    deviceOptions.push({ value: voice.micDeviceId, label: t.micUnnamed(deviceOptions.length) });
  }

  return (
    <div className="section">
      {/* ---------- תמלול ---------- */}
      <h3 className="section-head">{t.sttTitle}</h3>
      <Select
        label={t.sttProvider}
        value={stt.provider}
        options={(['openai', 'azure', 'local-openai-compatible', 'none'] as const).map((p) => ({ value: p, label: t.sttProviders[p] }))}
        onChange={(v) => void saver.save('sttProvider', { stt: { provider: v } })}
        status={saver.status.sttProvider}
      />
      {stt.provider === 'openai' && (
        <Select
          label={t.sttModel}
          value={stt.openaiModel}
          options={sttModelOptions}
          onChange={(v) => void saver.save('sttModel', { stt: { openaiModel: v } })}
          status={saver.status.sttModel}
        />
      )}
      {stt.provider === 'local-openai-compatible' && (
        <>
          <TextInput
            key={`base-${stt.localBaseUrl}`}
            label={t.localBaseUrl}
            value={stt.localBaseUrl}
            ltr
            inputMode="url"
            maxLength={200}
            onCommit={(v) => void saver.save('localBaseUrl', { stt: { localBaseUrl: v.trim() } })}
            status={saver.status.localBaseUrl}
          />
          <TextInput
            key={`lm-${stt.localModel}`}
            label={t.localModel}
            value={stt.localModel}
            ltr
            maxLength={120}
            onCommit={(v) => void saver.save('localModel', { stt: { localModel: v.trim() } })}
            status={saver.status.localModel}
          />
        </>
      )}
      {stt.provider !== 'none' && (
        <div className="field">
          <ActionButton label={t.testStt} onRun={() => runTest('stt', setSttTest)} />
          <ServiceTestResult result={sttTest} />
        </div>
      )}

      {/* ---------- מפתחות משותפים ---------- */}
      {usesOpenAi && (
        <SecretField name="openaiApiKey" label={`${t.openaiKey} — ${t.openaiKeyShared}`} status={secrets} onStatus={onSecrets} />
      )}
      {usesAzure && (
        <>
          <SecretField name="azureSpeechKey" label={t.azureKey} status={secrets} onStatus={onSecrets} />
          <TextInput
            key={`region-${azure.region}`}
            label={t.azureRegion}
            value={azure.region}
            ltr
            maxLength={40}
            validate={(v) => (AZURE_REGION_RE.test(v.trim()) ? null : t.azureRegionInvalid)}
            onCommit={(v) => void saver.save('azureRegion', { azure: { region: v.trim() } })}
            status={saver.status.azureRegion}
          />
        </>
      )}

      {/* ---------- הקראה ---------- */}
      <h3 className="section-head">{t.ttsTitle}</h3>
      <Select
        label={t.ttsProvider}
        value={tts.provider}
        options={(['azure', 'openai', 'system', 'none'] as const).map((p) => ({ value: p, label: t.ttsProviders[p] }))}
        hint={t.ttsRecommend}
        onChange={(v) => void saver.save('ttsProvider', { tts: { provider: v } })}
        status={saver.status.ttsProvider}
      />
      {tts.provider === 'azure' && (
        <Select
          label={t.azureVoice}
          value={tts.azureVoice}
          options={azureVoiceOptions}
          onChange={(v) => void saver.save('azureVoice', { tts: { azureVoice: v } })}
          status={saver.status.azureVoice}
        />
      )}
      {tts.provider === 'openai' && (
        <>
          <Select
            label={t.openaiVoice}
            value={tts.openaiVoice}
            options={openAiVoiceOptions}
            hint={t.openaiVoiceNote}
            onChange={(v) => void saver.save('openaiVoice', { tts: { openaiVoice: v } })}
            status={saver.status.openaiVoice}
          />
          <TextInput
            key={`ttsm-${tts.openaiModel}`}
            label={t.openaiTtsModel}
            value={tts.openaiModel}
            ltr
            maxLength={64}
            validate={(v) => (v.trim() ? null : he.settings.saveFailed)}
            onCommit={(v) => void saver.save('openaiTtsModel', { tts: { openaiModel: v.trim() } })}
            status={saver.status.openaiTtsModel}
          />
        </>
      )}
      {tts.provider === 'system' && <SystemVoiceSelect settings={settings} saver={saver} />}
      {tts.provider !== 'none' && (
        <>
          <Slider
            key={`rate-${tts.rate}`}
            label={t.rate}
            value={tts.rate}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `×${v.toFixed(2)}`}
            onCommit={(v) => void saver.save('rate', { tts: { rate: Math.round(v * 100) / 100 } })}
            status={saver.status.rate}
          />
          <Toggle
            label={t.autoSpeak}
            checked={tts.autoSpeak}
            onChange={(v) => void saver.save('autoSpeak', { tts: { autoSpeak: v } })}
            status={saver.status.autoSpeak}
          />
          {tts.provider !== 'system' && (
            <div className="field">
              <ActionButton label={t.testTts} onRun={() => runTest('tts', setTtsTest)} />
              <ServiceTestResult result={ttsTest} />
            </div>
          )}
        </>
      )}

      {/* ---------- מיקרופון ושיחה ---------- */}
      <h3 className="section-head">{t.micTitle}</h3>
      <Select
        label={t.micDevice}
        value={voice.micDeviceId}
        options={deviceOptions}
        hint={devices.failed ? t.micDevicesFailed : undefined}
        onChange={(v) => void saver.save('micDevice', { voice: { micDeviceId: v } })}
        status={saver.status.micDevice}
      />
      <TextInput
        key={`sil-${voice.silenceTimeoutMs}`}
        label={t.silenceTimeout}
        value={String(voice.silenceTimeoutMs)}
        ltr
        inputMode="numeric"
        maxLength={4}
        validate={(v) => (parseIntInRange(v, 500, 4000) === null ? rangeError(500, 4000) : null)}
        onCommit={(v) => void saver.save('silence', { voice: { silenceTimeoutMs: parseIntInRange(v, 500, 4000) ?? voice.silenceTimeoutMs } })}
        status={saver.status.silence}
      />
      <TextInput
        key={`max-${voice.maxUtteranceSec}`}
        label={t.maxUtterance}
        value={String(voice.maxUtteranceSec)}
        ltr
        inputMode="numeric"
        maxLength={2}
        validate={(v) => (parseIntInRange(v, 3, 60) === null ? rangeError(3, 60) : null)}
        onCommit={(v) => void saver.save('maxUtterance', { voice: { maxUtteranceSec: parseIntInRange(v, 3, 60) ?? voice.maxUtteranceSec } })}
        status={saver.status.maxUtterance}
      />
      <Toggle
        label={t.followUp}
        checked={voice.followUpListening}
        onChange={(v) => void saver.save('followUp', { voice: { followUpListening: v } })}
        status={saver.status.followUp}
      />
      <TextInput
        key={`hk-${voice.pushToTalkHotkey}`}
        label={t.hotkey}
        value={voice.pushToTalkHotkey}
        ltr
        maxLength={60}
        hint={t.hotkeyHint}
        onCommit={(v) => void saver.save('hotkey', { voice: { pushToTalkHotkey: v.trim() } })}
        status={saver.status.hotkey}
      />

      {/* ---------- בדיקות ---------- */}
      <h3 className="section-head">{t.testsTitle}</h3>
      <VoiceTests settings={settings} />
    </div>
  );
}

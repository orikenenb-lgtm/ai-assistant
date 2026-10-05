/**
 * מסך ההגדרות: שכבת-על עם לשוניות מקטעים. כל שינוי נשלח ל-main לאימות,
 * ושגיאות מוצגות ליד השדה. Esc סוגר (בתנאי שאין טיוטה פתוחה בשדה טקסט — שם Esc מבטל את הטיוטה).
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { SecretsStatus } from '../../shared/settings-schema';
import { Tabs, type TabItem } from '../components/Tabs';
import { IconClose } from '../components/Icons';
import { useAsyncData } from '../hooks/useAsyncData';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { he } from '../i18n/he';
import { useController, useUiState, type SettingsSectionId } from '../state/controller';
import { BrainSection } from './BrainSection';
import { useSaver } from './fields';
import { GeneralSection } from './GeneralSection';
import { LauncherSection } from './LauncherSection';
import { AboutSection, PrivacySection, ScreenSection } from './OtherSections';
import { VoiceSection } from './VoiceSection';
import { WakeWordSection } from './WakeWordSection';

const SECTIONS: ReadonlyArray<TabItem<SettingsSectionId>> = (
  ['general', 'brain', 'voice', 'wake', 'launcher', 'screen', 'privacy', 'about'] as const
).map((id) => ({ id, label: he.settings.sections[id] }));

export function SettingsView({ inert }: { inert: boolean }) {
  const controller = useController();
  const settings = useUiState((s) => s.settings);
  const section = useUiState((s) => s.settingsSection);
  const secretsVersion = useUiState((s) => s.dataVersion.secrets);
  const saver = useSaver();
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useFocusTrap(ref);

  const loadedSecrets = useAsyncData<SecretsStatus>(`secrets:${secretsVersion}`, () => controller.api.secrets.status());
  // אחרי שמירה/מחיקה main מחזיר סטטוס עדכני — מעדיפים אותו עד הטעינה הבאה
  const [override, setOverride] = useState<{ version: number; status: SecretsStatus } | null>(null);
  const secrets = override && override.version === secretsVersion ? override.status : loadedSecrets.data;
  const onSecrets = (status: SecretsStatus) => {
    setOverride({ version: secretsVersion, status });
    void controller.refreshServices();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      controller.closeSettings();
    }
  };

  const secretProps = { secrets, onSecrets };

  return (
    <div className="settings-overlay" inert={inert || undefined}>
      <div className="settings frame" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="settings-head">
          <h2 id={titleId}>{he.settings.title}</h2>
          <button type="button" className="icon-btn" aria-label={he.settings.close} title={he.settings.close} onClick={() => controller.closeSettings()}>
            <IconClose size={18} />
          </button>
        </header>
        <div className="settings-body">
          <Tabs
            items={SECTIONS}
            selected={section}
            onSelect={(id) => controller.setSettingsSection(id)}
            idPrefix="settings"
            label={he.settings.sectionsLabel}
            orientation="vertical"
            className="settings-nav"
          />
          <div
            className="settings-panel"
            role="tabpanel"
            id={`settings-panel-${section}`}
            aria-labelledby={`settings-tab-${section}`}
            tabIndex={0}
          >
            {!settings ? (
              <p className="field-hint">{he.toasts.settingsLoading}</p>
            ) : (
              <>
                <h3 className="panel-title">{he.settings.sections[section]}</h3>
                {section === 'general' && <GeneralSection settings={settings} saver={saver} />}
                {section === 'brain' && <BrainSection settings={settings} saver={saver} {...secretProps} />}
                {section === 'voice' && <VoiceSection settings={settings} saver={saver} {...secretProps} />}
                {section === 'wake' && <WakeWordSection settings={settings} saver={saver} {...secretProps} />}
                {section === 'launcher' && <LauncherSection settings={settings} saver={saver} />}
                {section === 'screen' && <ScreenSection settings={settings} saver={saver} />}
                {section === 'privacy' && <PrivacySection settings={settings} saver={saver} />}
                {section === 'about' && <AboutSection />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

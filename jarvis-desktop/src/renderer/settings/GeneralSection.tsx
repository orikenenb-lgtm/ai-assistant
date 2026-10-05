/**
 * מקטע "כללי": שם, תצוגה, תמיד מעל, סגירה למגש, הפעלה מוסתרת והפחתת תנועה.
 */
import { he } from '../i18n/he';
import { useController } from '../state/controller';
import { RadioGroup, Select, TextInput, Toggle, type SectionProps } from './fields';

export function GeneralSection({ settings, saver }: SectionProps) {
  const controller = useController();
  const t = he.settings.general;
  const { ui, profile } = settings;

  return (
    <div className="section">
      <TextInput
        key={profile.userName}
        label={t.userName}
        value={profile.userName}
        maxLength={40}
        validate={(v) => (v.trim().length === 0 ? he.settings.saveFailed : null)}
        onCommit={(v) => void saver.save('userName', { profile: { userName: v.trim() } })}
        status={saver.status.userName}
      />
      <Select
        label={t.mode}
        value={ui.mode}
        options={[
          { value: 'full', label: t.modeFull },
          { value: 'compact', label: t.modeCompact },
        ]}
        // מעבר לקומפקטי סוגר את ההגדרות ומקטין את החלון; הבקר שומר את הבחירה
        onChange={(mode) => void controller.setViewMode(mode)}
      />
      <Toggle
        label={t.alwaysOnTop}
        checked={ui.alwaysOnTop}
        onChange={async (v) => {
          const res = await controller.setAlwaysOnTop(v);
          saver.setError('alwaysOnTop', res.ok ? null : res.message_he);
        }}
        status={saver.status.alwaysOnTop}
      />
      <Toggle
        label={t.closeToTray}
        checked={ui.closeToTray}
        hint={t.closeToTrayHint}
        onChange={(v) => void saver.save('closeToTray', { ui: { closeToTray: v } })}
        status={saver.status.closeToTray}
      />
      <Toggle
        label={t.startHidden}
        checked={ui.startHidden}
        onChange={(v) => void saver.save('startHidden', { ui: { startHidden: v } })}
        status={saver.status.startHidden}
      />
      <RadioGroup
        label={t.reducedMotion}
        value={ui.reducedMotion}
        options={[
          { value: 'system', label: t.motionSystem },
          { value: 'on', label: t.motionOn },
          { value: 'off', label: t.motionOff },
        ]}
        onChange={(v) => void saver.save('reducedMotion', { ui: { reducedMotion: v } })}
        status={saver.status.reducedMotion}
      />
    </div>
  );
}

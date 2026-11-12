import { Banknote, Database, Map as MapIcon, Radar, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Callout, ConfirmDialog, Dialog, Field, Input, NativeSelect, Switch, useToast } from '@/components/ui';
import { CURRENCIES } from '@/features/trips/labels';
import { errorMessage } from '@/lib/api';
import type { RetentionRun, Settings } from '@/lib/schemas/settings';
import { useRunRetention, useSaveSetting } from '../hooks';
import { SettingsSection } from './SettingsSection';

const OWNER_ONLY = 'בעל החשבון בלבד';

export function DisplaySection({ settings, editable }: { settings: Settings; editable: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSaveSetting();
  const { toast } = useToast();
  const value = draft ?? settings.display.currency;
  const options = CURRENCIES.includes(value as (typeof CURRENCIES)[number]) ? [...CURRENCIES] : [value, ...CURRENCIES];
  return (
    <SettingsSection
      id="display"
      title="מטבע תצוגה"
      description="המטבע שבו מוצגים סכומים כשיש המרה. המחירים עצמם נשמרים תמיד במטבע המקור, והמרה היא הערכה בלבד."
      icon={<Banknote />}
      readOnlyReason={editable ? undefined : 'צפייה בלבד'}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="מטבע" className="w-48">
          <NativeSelect value={value} disabled={!editable} onChange={(e) => setDraft(e.target.value)}>
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {editable && (
          <Button
            loading={save.isPending}
            disabled={value === settings.display.currency}
            onClick={() =>
              save.mutate(
                { path: 'display', body: { currency: value } },
                { onSuccess: () => { setDraft(null); toast({ title: 'מטבע התצוגה עודכן', tone: 'success' }); } },
              )
            }
          >
            שמירה
          </Button>
        )}
      </div>
      {save.isError && (
        <Callout tone="danger" role="alert" className="mt-3">
          {errorMessage(save.error)}
        </Callout>
      )}
    </SettingsSection>
  );
}

export function MapSection({ settings, owner }: { settings: Settings; owner: boolean }) {
  const save = useSaveSetting();
  const { toast } = useToast();
  return (
    <SettingsSection id="map" title="מפות" description="מפת הטיול משתמשת באריחי OpenStreetMap." icon={<MapIcon />} readOnlyReason={owner ? undefined : OWNER_ONLY}>
      <Switch
        label="הצגת מפה בעמוד הטיול"
        description="כשהמפה פעילה, הדפדפן של כל מי שפותח טיול שולח בקשות לשרתי OpenStreetMap (כתובת ה-IP שלו ואזור המפה הנצפה נחשפים להם). כבויה כברירת מחדל מטעמי פרטיות."
        checked={settings.map.enabled}
        disabled={!owner || save.isPending}
        onCheckedChange={(enabled) =>
          save.mutate({ path: 'map', body: { enabled } }, { onSuccess: () => toast({ title: enabled ? 'המפה הופעלה' : 'המפה כובתה', tone: 'success' }) })
        }
      />
      {save.isError && (
        <Callout tone="danger" role="alert" className="mt-3">
          {errorMessage(save.error)}
        </Callout>
      )}
    </SettingsSection>
  );
}

export function SchedulerSection({ settings, owner }: { settings: Settings; owner: boolean }) {
  const save = useSaveSetting();
  const { toast } = useToast();
  const { enabled, allowed_by_server } = settings.scheduler;
  return (
    <SettingsSection id="scheduler" title="בדיקות מחיר אוטומטיות" description="בדיקה תקופתית ברקע של התראות מחיר פעילות." icon={<Radar />} readOnlyReason={owner ? undefined : OWNER_ONLY}>
      <div className="flex flex-col gap-3">
        <Switch
          label="הפעלת בדיקות ברקע"
          description="התראות פעילות ייבדקו לפי התדירות שלהן (לפחות כל 6 שעות). בלי זה אפשר עדיין לבדוק ידנית."
          checked={enabled && allowed_by_server}
          disabled={!owner || !allowed_by_server || save.isPending}
          onCheckedChange={(v) =>
            save.mutate({ path: 'scheduler', body: { enabled: v } }, { onSuccess: () => toast({ title: v ? 'הבדיקות האוטומטיות הופעלו' : 'הבדיקות האוטומטיות כובו', tone: 'success' }) })
          }
        />
        {!allowed_by_server && (
          <Callout tone="warn" title="חסום בשרת">
            הרצת משימות רקע כבויה בהגדרות השרת (למשל ORI_SCHEDULER_ENABLED), ולכן אי אפשר להפעיל כאן בדיקות אוטומטיות. אפשר לבדוק התראות ידנית בעמוד "התראות מחיר".
          </Callout>
        )}
        {save.isError && (
          <Callout tone="danger" role="alert">
            {errorMessage(save.error)}
          </Callout>
        )}
      </div>
    </SettingsSection>
  );
}

function RetentionResult({ result, onClose }: { result: RetentionRun | null; onClose: () => void }) {
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()} size="sm" title="הניקוי הושלם" footer={<Button onClick={onClose}>סגירה</Button>}>
      {result && (
        <dl className="flex flex-col gap-2 text-sm" data-testid="retention-result">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">חיפושים שנמחקו</dt>
            <dd className="font-semibold tabular-nums">{result.search_requests_deleted}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">הצעות שנמחקו</dt>
            <dd className="font-semibold tabular-nums">{result.offers_deleted}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">אירועי ביקורת שנמחקו</dt>
            <dd className="font-semibold tabular-nums">{result.audit_events_deleted}</dd>
          </div>
        </dl>
      )}
    </Dialog>
  );
}

export function RetentionSection({ settings, owner }: { settings: Settings; owner: boolean }) {
  const [search, setSearch] = useState<string | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RetentionRun | null>(null);
  const save = useSaveSetting();
  const run = useRunRetention();
  const { toast } = useToast();
  const searchValue = search ?? String(settings.retention.search_days);
  const auditValue = audit ?? String(settings.retention.audit_days);
  const s = Number.parseInt(searchValue, 10);
  const a = Number.parseInt(auditValue, 10);
  const searchErr = !(s >= 7 && s <= 365) ? 'בין 7 ל-365 ימים' : undefined;
  const auditErr = !(a >= 30 && a <= 1825) ? 'בין 30 ל-1825 ימים' : undefined;
  const dirty = s !== settings.retention.search_days || a !== settings.retention.audit_days;
  return (
    <SettingsSection
      id="retention"
      title="שמירת נתונים"
      description="חיפושים והצעות ישנים נמחקים אוטומטית. טיולים, הצעות שמורות ופרופילי נוסעים אינם נמחקים בניקוי."
      icon={<Database />}
      readOnlyReason={owner ? undefined : OWNER_ONLY}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="שמירת היסטוריית חיפושים (ימים)" error={owner ? searchErr : undefined}>
            <Input type="number" min={7} max={365} value={searchValue} disabled={!owner} onChange={(e) => setSearch(e.target.value)} dir="ltr" className="text-start" />
          </Field>
          <Field label="שמירת יומן ביקורת (ימים)" error={owner ? auditErr : undefined}>
            <Input type="number" min={30} max={1825} value={auditValue} disabled={!owner} onChange={(e) => setAudit(e.target.value)} dir="ltr" className="text-start" />
          </Field>
        </div>
        {save.isError && (
          <Callout tone="danger" role="alert">
            {errorMessage(save.error)}
          </Callout>
        )}
        {owner && (
          <div className="flex flex-wrap gap-2">
            <Button
              loading={save.isPending}
              disabled={!dirty || !!searchErr || !!auditErr}
              onClick={() =>
                save.mutate(
                  { path: 'retention', body: { search_days: s, audit_days: a } },
                  { onSuccess: () => { setSearch(null); setAudit(null); toast({ title: 'הגדרות השמירה נשמרו', tone: 'success' }); } },
                )
              }
            >
              שמירה
            </Button>
            <Button variant="secondary" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setConfirming(true)}>
              הרצת ניקוי עכשיו
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="הרצת ניקוי נתונים"
        description={`יימחקו חיפושים והצעות ישנים מ-${settings.retention.search_days} ימים ואירועי ביקורת ישנים מ-${settings.retention.audit_days} ימים (לפי ההגדרות השמורות). אי אפשר לבטל.`}
        confirmLabel="הרצת ניקוי"
        tone="danger"
        onConfirm={async () => {
          const r = await run.mutateAsync();
          setResult(r);
        }}
      />
      <RetentionResult result={result} onClose={() => setResult(null)} />
    </SettingsSection>
  );
}


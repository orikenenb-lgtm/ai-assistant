import { useState, type FormEvent } from 'react';
import { Button, Callout, Dialog, Field, Input, NativeSelect } from '@/components/ui';
import { serverFieldErrors, submitErrorMessage } from '@/features/trips/formUtils';
import { AGE_GROUPS, type Member } from '@/lib/schemas/family';
import { AGE_GROUP_LABELS } from '../labels';
import { useCreateMember, useUpdateMember } from '../hooks';

export interface MemberFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: Member;
}

export function MemberFormDialog({ open, onOpenChange, member }: MemberFormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={member ? 'עריכת בן/בת משפחה' : 'הוספת בן/בת משפחה'}
      description="השם והקשר מוצגים בטיולים. פרטי זיהוי רגישים (דרכון, תאריך לידה) נשמרים בנפרד בפרופיל הנוסע."
    >
      {open && <MemberForm member={member} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function MemberForm({ member, onDone }: { member?: Member; onDone: () => void }) {
  const [name, setName] = useState(member?.display_name ?? '');
  const [relation, setRelation] = useState(member?.relation ?? '');
  const [ageGroup, setAgeGroup] = useState(member?.age_group ?? 'adult');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateMember();
  const update = useUpdateMember();
  const mutation = member ? update : create;
  const serverErrors = serverFieldErrors(mutation.error);

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.display_name = 'יש להזין שם';
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = { display_name: name.trim(), relation: relation.trim() || null, age_group: ageGroup, is_minor: ageGroup !== 'adult' };
    if (member) update.mutate({ id: member.id, body }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  }

  const general = submitErrorMessage(mutation.error);
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="שם" required error={errors.display_name ?? serverErrors.display_name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
      </Field>
      <Field label="קשר משפחתי" optional hint="למשל: אמא, בן, סבתא" error={serverErrors.relation}>
        <Input value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={60} />
      </Field>
      <Field label="קבוצת גיל" hint="משפיעה על חיפושים ועל מחירי ילדים ותינוקות.">
        <NativeSelect
          value={ageGroup}
          onChange={(e) => setAgeGroup(e.target.value)}
        >
          {AGE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {AGE_GROUP_LABELS[g]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <p className="text-sm text-fg-muted">{ageGroup === 'adult' ? 'מבוגר/ת — לא קטין/ה.' : 'ילדים ותינוקות מסומנים אוטומטית כקטינים.'}</p>
      {general && (
        <Callout tone="danger" role="alert">
          {general}
        </Callout>
      )}
      <div className="flex flex-wrap-reverse justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onDone}>
          ביטול
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {member ? 'שמירה' : 'הוספה'}
        </Button>
      </div>
    </form>
  );
}

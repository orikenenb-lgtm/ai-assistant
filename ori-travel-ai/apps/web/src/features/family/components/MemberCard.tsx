import { IdCard, Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, Card, IconButton } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/labels';
import type { Role } from '@/lib/schemas/auth';
import type { Member } from '@/lib/schemas/family';
import { AGE_GROUP_LABELS } from '../labels';

export interface MemberCardProps {
  member: Member;
  canEdit: boolean;
  canDelete: boolean;
  onProfile: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MemberCard({ member, canEdit, canDelete, onProfile, onEdit, onDelete }: MemberCardProps) {
  return (
    <Card as="article" padding="sm" data-testid="member-card" aria-label={member.display_name} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sea-50 text-base font-semibold text-sea-700" aria-hidden="true">
          {member.display_name.trim().charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-fg">{member.display_name}</h3>
          <p className="text-sm text-fg-muted">{member.relation ?? 'ללא קשר משפחתי'}</p>
        </div>
        {(canEdit || canDelete) && (
          <div className="flex shrink-0">
            {canEdit && <IconButton size="sm" label={`עריכת ${member.display_name}`} icon={<Pencil />} onClick={onEdit} />}
            {canDelete && <IconButton size="sm" label={`מחיקת ${member.display_name}`} icon={<Trash2 />} onClick={onDelete} />}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="neutral">{AGE_GROUP_LABELS[member.age_group] ?? member.age_group}</Badge>
        {member.is_minor && <Badge tone="info">קטין/ה</Badge>}
        {member.user ? (
          <Badge tone={member.user.is_active ? 'accent' : 'muted'}>
            משתמש/ת · {ROLE_LABELS[member.user.role as Role] ?? member.user.role}
            {!member.user.is_active && ' (מושבת)'}
          </Badge>
        ) : (
          <Badge tone="muted">ללא חשבון</Badge>
        )}
        <Badge tone={member.has_traveler_profile ? 'success' : 'muted'}>{member.has_traveler_profile ? 'יש פרופיל נוסע' : 'אין פרופיל נוסע'}</Badge>
      </div>
      <Button size="sm" variant="secondary" leadingIcon={<IdCard aria-hidden="true" />} onClick={onProfile} className="self-start">
        {member.has_traveler_profile ? 'פרופיל נוסע' : canEdit ? 'יצירת פרופיל נוסע' : 'פרופיל נוסע'}
      </Button>
    </Card>
  );
}

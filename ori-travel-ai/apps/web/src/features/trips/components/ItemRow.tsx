import { ArrowDown, ArrowUp, MapPin, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { Badge, DateText, IconButton, ModeBadge, MoneyText } from '@/components/ui';
import type { ItemKind, TripDetail, TripItem } from '@/lib/schemas/trips';
import { COST_STATUS_LABELS, ITEM_KIND_ICONS, kindLabel } from '../labels';
import { Circle } from 'lucide-react';

const COST_TONE = { known: 'success', estimate: 'warn', excluded: 'muted' } as const;

export interface ItemRowProps {
  item: TripItem;
  trip: TripDetail;
  editable: boolean;
  /** null = the move is not available; string = why it is disabled. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  moveHint?: string;
  busy?: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function KindIcon({ kind }: { kind: string }) {
  const Icon = ITEM_KIND_ICONS[kind as ItemKind] ?? Circle;
  return <Icon className="size-[1.125rem]" />;
}

export function ItemRow({ item, trip, editable, canMoveUp, canMoveDown, moveHint, busy, onMove, onEdit, onDelete }: ItemRowProps) {
  const zone = item.timezone ?? trip.timezone ?? 'UTC';
  const showEnd = item.end_at && item.start_at;
  const costStatus = (item.cost_status in COST_TONE ? item.cost_status : 'estimate') as keyof typeof COST_TONE;
  return (
    <li
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 sm:flex-row sm:items-start sm:gap-4"
      data-testid="trip-item"
      data-item-id={item.id}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-sea-50 text-sea-700" aria-hidden="true">
          <KindIcon kind={item.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-semibold text-fg">{item.title}</h4>
            <Badge tone="neutral" size="sm">
              {kindLabel(item.kind)}
            </Badge>
            {item.data_mode && <ModeBadge mode={item.data_mode} size="sm" />}
            {item.overlaps.length > 0 && (
              <Badge tone="danger" size="sm" data-testid="overlap-badge">
                <TriangleAlert aria-hidden="true" />
                חפיפה בזמנים
              </Badge>
            )}
            {item.offer_expired && (
              <Badge tone="warn" size="sm">
                <TriangleAlert aria-hidden="true" />
                המחיר ישן — ההצעה פגה
              </Badge>
            )}
          </div>
          {item.start_at && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
              {/* Isolate the LTR time range and the IANA zone so bidi never glues them together */}
              <bdi dir="ltr">
                <DateText value={item.start_at} preset="time" timeZone={zone} />
                {showEnd && (
                  <>
                    {' – '}
                    <DateText value={item.end_at} preset="time" timeZone={zone} />
                  </>
                )}
              </bdi>
              <span aria-hidden="true" className="text-fg-subtle">
                ·
              </span>
              <bdi dir="ltr" className="text-xs text-fg-subtle">
                {zone}
              </bdi>
            </p>
          )}
          {item.location && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-fg-muted">
              <MapPin className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="min-w-0 break-words">{item.location}</span>
            </p>
          )}
          {item.overlaps.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5" aria-label="חפיפות" data-testid="overlap-messages">
              {item.overlaps.map((o) => (
                <li key={`${o.item_id}-${o.other_item_id}`} className="text-sm text-coral-700">
                  {o.message}
                </li>
              ))}
            </ul>
          )}
          {item.notes && <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{item.notes}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 ps-12 sm:ps-0 sm:flex-col sm:items-end">
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {item.cost ? (
            <MoneyText value={item.cost} estimated={costStatus === 'estimate'} className="text-sm font-semibold text-fg" />
          ) : (
            <span className="text-sm text-fg-subtle">ללא עלות</span>
          )}
          <Badge tone={COST_TONE[costStatus]} size="sm">
            {COST_STATUS_LABELS[costStatus]}
          </Badge>
        </div>
        {editable && (
          <div className="flex items-center" role="group" aria-label={`פעולות עבור ${item.title}`}>
            <IconButton
              size="sm"
              label={canMoveUp || !moveHint ? 'הזזה למעלה' : `הזזה למעלה — ${moveHint}`}
              icon={<ArrowUp />}
              disabled={!canMoveUp || busy}
              onClick={() => onMove(-1)}
            />
            <IconButton
              size="sm"
              label={canMoveDown || !moveHint ? 'הזזה למטה' : `הזזה למטה — ${moveHint}`}
              icon={<ArrowDown />}
              disabled={!canMoveDown || busy}
              onClick={() => onMove(1)}
            />
            <IconButton size="sm" label="עריכה" icon={<Pencil />} onClick={onEdit} />
            <IconButton size="sm" label="מחיקה" icon={<Trash2 />} onClick={onDelete} />
          </div>
        )}
      </div>
    </li>
  );
}

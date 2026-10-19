"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Avatar, TagPill } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { moveDealAction } from "../deal-actions";
import type { DealCard } from "../deals";
import { LostDealDialog, type LostReasonOption } from "./deal-actions-ui";

type Stage = { id: string; name: string; kind: "open" | "won" | "lost"; color: string; probability: number };

const noopSubscribe = () => () => {};

/**
 * Left/right jumps to the neighbouring column (works in RTL and LTR since it uses on-screen
 * geometry); up/down falls back to dnd-kit's sortable getter for reordering within a column.
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return sortableKeyboardCoordinates(event, args);
  event.preventDefault();
  const { droppableContainers, droppableRects, collisionRect } = args.context;
  if (!collisionRect) return undefined;
  const center = collisionRect.left + collisionRect.width / 2;
  let best: { rect: ClientRect; distance: number } | null = null;
  for (const container of droppableContainers.getEnabled()) {
    if (container.data.current?.type !== "column") continue;
    const rect = droppableRects.get(container.id);
    if (!rect || (rect.left <= center && center <= rect.right)) continue; // missing or the current column
    const columnCenter = rect.left + rect.width / 2;
    if (event.code === "ArrowLeft" ? columnCenter >= center : columnCenter <= center) continue;
    const distance = Math.abs(columnCenter - center);
    if (!best || distance < best.distance) best = { rect, distance };
  }
  if (!best) return undefined;
  return { x: best.rect.left + (best.rect.width - collisionRect.width) / 2, y: best.rect.top + 4 };
};
type Columns = Record<string, string[]>;

function buildColumns(stages: Stage[], deals: DealCard[]): Columns {
  const cols: Columns = Object.fromEntries(stages.map((s) => [s.id, [] as string[]]));
  for (const d of [...deals].sort((a, b) => a.position - b.position)) cols[d.stageId]?.push(d.id);
  return cols;
}

export function KanbanBoard({
  stages,
  deals,
  currency,
  canEdit,
  lostReasons,
  today,
}: {
  stages: Stage[];
  deals: DealCard[];
  currency: string;
  canEdit: boolean;
  lostReasons: LostReasonOption[];
  /** yyyy-mm-dd in the tenant time zone (for overdue highlighting). */
  today: string;
}) {
  const t = useTranslations("deals");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [cards, setCards] = useState<Record<string, DealCard>>(() => Object.fromEntries(deals.map((d) => [d.id, d])));
  const [columns, setColumns] = useState<Columns>(() => buildColumns(stages, deals));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<string | null>(null);
  const snapshot = useRef<Columns | null>(null);
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  // true once hydrated: drag handles only work after hydration (exposed for tests / styling).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  const containerOf = (id: UniqueIdentifier | undefined): string | undefined => {
    if (id === undefined) return undefined;
    const key = String(id);
    if (key in columns) return key;
    return Object.keys(columns).find((c) => columns[c].includes(key));
  };

  const titleOf = (id: UniqueIdentifier) => cards[String(id)]?.title ?? "";
  const stageNameOf = (id: UniqueIdentifier | undefined) => {
    const c = containerOf(id);
    return c ? (stageById.get(c)?.name ?? "") : "";
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.pickedUp", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => (over ? t("dnd.over", { title: titleOf(active.id), stage: stageNameOf(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t("dnd.dropped", { title: titleOf(active.id), stage: stageNameOf(over.id) }) : undefined),
    onDragCancel: ({ active }) => t("dnd.canceled", { title: titleOf(active.id) }),
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    snapshot.current = columns;
    setActiveId(String(active.id));
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const from = containerOf(active.id);
    const to = containerOf(over?.id);
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const fromItems = prev[from].filter((x) => x !== String(active.id));
      const toItems = [...prev[to]];
      const overIndex = over && String(over.id) !== to ? toItems.indexOf(String(over.id)) : -1;
      toItems.splice(overIndex >= 0 ? overIndex : toItems.length, 0, String(active.id));
      return { ...prev, [from]: fromItems, [to]: toItems };
    });
  };

  const revert = () => {
    if (snapshot.current) setColumns(snapshot.current);
    snapshot.current = null;
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const id = String(active.id);
    const container = containerOf(active.id);
    if (!over || !container) return revert();
    let next = columns;
    const overContainer = containerOf(over.id);
    if (overContainer === container && String(over.id) !== container) {
      const oldIndex = columns[container].indexOf(id);
      const newIndex = columns[container].indexOf(String(over.id));
      if (oldIndex !== newIndex) next = { ...columns, [container]: arrayMove(columns[container], oldIndex, newIndex) };
    }
    const before = snapshot.current;
    snapshot.current = null;
    const card = cards[id];
    const stage = stageById.get(container);
    if (!card || !stage) return;
    const unchanged = before && before[container]?.indexOf(id) === next[container].indexOf(id) && card.stageId === container;
    if (unchanged) return;
    if (stage.kind === "lost" && card.status !== "lost") {
      if (before) setColumns(before);
      setLostFor(id);
      return;
    }
    setColumns(next);
    const idx = next[container].indexOf(id);
    const res = await moveDealAction({ id, stageId: container, beforeId: next[container][idx - 1] ?? null, afterId: next[container][idx + 1] ?? null });
    if (!res.ok) {
      if (before) setColumns(before);
      toast.error(res.error.message);
      return;
    }
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], stageId: res.data.stageId, status: res.data.status as DealCard["status"], position: res.data.position } }));
    if (card.stageId !== container) {
      if (res.data.status === "won" && card.status !== "won") toast.success(t("wonToast"));
      else toast.success(t("movedToast", { stage: stage.name }));
    }
    // Status changes (won / reopened) affect the forecast KPIs rendered by the server.
    if (res.data.status !== card.status) router.refresh();
  };

  const active = activeId ? cards[activeId] : null;

  return (
    <>
      <DndContext
        sensors={canEdit ? sensors : []}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          revert();
        }}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("dnd.instructions") } }}
      >
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" data-testid="kanban" data-hydrated={hydrated}>
          {stages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              ids={columns[stage.id] ?? []}
              cards={cards}
              currency={currency}
              locale={locale}
              canEdit={canEdit}
              today={today}
            />
          ))}
        </div>
        <DragOverlay>{active ? <DealCardView card={active} currency={currency} locale={locale} today={today} overlay /> : null}</DragOverlay>
      </DndContext>
      <LostDealDialog
        dealId={lostFor}
        open={lostFor !== null}
        onOpenChange={(o) => !o && setLostFor(null)}
        reasons={lostReasons}
        onDone={() => router.refresh()}
      />
    </>
  );
}

function KanbanColumn({
  stage,
  ids,
  cards,
  currency,
  locale,
  canEdit,
  today,
}: {
  stage: Stage;
  ids: string[];
  cards: Record<string, DealCard>;
  currency: string;
  locale: "he" | "en";
  canEdit: boolean;
  today: string;
}) {
  const t = useTranslations("deals");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { type: "column" } });
  const total = ids.reduce((sum, id) => sum + (cards[id]?.currency === currency ? cards[id].valueCents : 0), 0);
  return (
    <section
      aria-label={stage.name}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border border-border bg-muted/40 transition-colors",
        isOver && "border-primary/50 bg-primary-soft/30",
      )}
      data-testid={`kanban-column-${stage.name}`}
    >
      <header className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
            <span className="truncate">{stage.name}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("columnCount", { count: ids.length })}
            {stage.kind !== "open" && ` · ${t("closedColumnHint")}`}
          </p>
        </div>
        {/* Compact currency can differ between server and browser ICU data; the client value wins. */}
        <span className="tabular shrink-0 text-xs font-medium text-muted-foreground" data-testid="column-total" suppressHydrationWarning>
          {/* `total` is in cents: switch to compact notation from 1M major units. */}
          {formatMoney(total, currency, locale, { compact: total >= 100_000_000 })}
        </span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-3">
          {ids.map((id) => (cards[id] ? <SortableDealCard key={id} card={cards[id]} currency={currency} locale={locale} canEdit={canEdit} today={today} /> : null))}
          {ids.length === 0 && <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{t("emptyColumn")}</li>}
        </ol>
      </SortableContext>
    </section>
  );
}

function SortableDealCard({ card, currency, locale, canEdit, today }: { card: DealCard; currency: string; locale: "he" | "en"; canEdit: boolean; today: string }) {
  const t = useTranslations("deals");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !canEdit });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-40")} data-testid="deal-card">
      <DealCardView
        card={card}
        currency={currency}
        locale={locale}
        today={today}
        handle={
          canEdit ? (
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              {...attributes}
              aria-label={t("dragHandle", { title: card.title })}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
          ) : null
        }
      />
    </li>
  );
}

function DealCardView({
  card,
  currency,
  locale,
  today,
  handle,
  overlay,
}: {
  card: DealCard;
  currency: string;
  locale: "he" | "en";
  today: string;
  handle?: React.ReactNode;
  overlay?: boolean;
}) {
  const overdue = card.status === "open" && card.expectedCloseDate !== null && card.expectedCloseDate < today;
  const who = card.companyName ?? card.contactName;
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-3 shadow-xs", overlay && "rotate-1 shadow-lg")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={`/deals/${card.id}`} className="line-clamp-2 text-sm font-medium hover:underline" dir="auto">
            {card.title}
          </Link>
          {who && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
              {who}
            </p>
          )}
        </div>
        {handle}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="tabular text-sm font-semibold">{formatMoney(card.valueCents, card.currency || currency, locale)}</span>
        <span className="flex items-center gap-1.5">
          {card.expectedCloseDate && (
            <span className={cn("flex items-center gap-1 text-[11px]", overdue ? "font-medium text-danger-foreground" : "text-muted-foreground")}>
              <CalendarClock className="size-3" />
              {formatDate(card.expectedCloseDate, locale)}
            </span>
          )}
          {card.ownerName && <Avatar name={card.ownerName} size="xs" />}
        </span>
      </div>
      {card.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.slice(0, 2).map((tg) => (
            <TagPill key={tg.id} name={tg.name} color={tg.color} className="px-1.5 text-[10px]" />
          ))}
        </div>
      )}
    </div>
  );
}

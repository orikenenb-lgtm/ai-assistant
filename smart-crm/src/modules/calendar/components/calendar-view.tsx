"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { addDays, addMonths, dateKey, startOfDay, timeKey, toLocalInput, weekdayOf } from "../tz";
import { daysCovered, isAllDayLike, layoutDay } from "../layout";
import type { CalendarView as View } from "../schemas";
import type { LinkValue } from "@/modules/tasks/components/link-picker";
import { EventFormDialog, type EventFormValues } from "./event-form-dialog";

export type CalEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  ownerId: string | null;
  ownerName: string | null;
  link: LinkValue;
  external: string | null;
  canEdit: boolean;
};
export type CalTask = { id: string; title: string; due: string; status: string; priority: string; assigneeName: string | null };

type Props = {
  view: View;
  anchor: string;
  rangeStart: string;
  days: number;
  today: string;
  timezone: string;
  events: CalEvent[];
  tasks: CalTask[];
  members: { userId: string; fullName: string }[];
  currentUserId: string;
  canManage: boolean;
  canChooseOwner: boolean;
  mine: boolean;
};

const HOUR_PX = 48;
const intlLocale = (l: string) => (l === "he" ? "he-IL" : "en-US");

type Parsed = CalEvent & { s: Date; e: Date };

export function CalendarView(props: Props) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const { timezone: tz } = props;
  const [dialog, setDialog] = useState<EventFormValues | null>(null);
  // Captured once per mount so render stays pure (overdue highlighting).
  const [now] = useState(() => Date.now());

  const events: Parsed[] = useMemo(() => props.events.map((e) => ({ ...e, s: new Date(e.start), e: new Date(e.end) })), [props.events]);
  const tasks = useMemo(() => props.tasks.map((x) => ({ ...x, d: new Date(x.due) })), [props.tasks]);

  const byDay = useMemo(() => {
    const map = new Map<string, { events: Parsed[]; tasks: typeof tasks }>();
    const bucket = (k: string) => {
      let b = map.get(k);
      if (!b) map.set(k, (b = { events: [], tasks: [] }));
      return b;
    };
    for (const e of events) for (const k of daysCovered({ start: e.s, end: e.e, allDay: e.allDay }, tz)) bucket(k).events.push(e);
    for (const x of tasks) bucket(dateKey(x.d, tz)).tasks.push(x);
    return map;
  }, [events, tasks, tz]);

  const fmt = (opts: Intl.DateTimeFormatOptions, key: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), { ...opts, timeZone: tz }).format(startOfDay(key, tz));

  const title =
    props.view === "month"
      ? fmt({ month: "long", year: "numeric" }, props.anchor)
      : props.view === "day"
        ? fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, props.anchor)
        : `${fmt({ day: "numeric", month: "short" }, props.rangeStart)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }, addDays(props.rangeStart, props.days - 1))}`;

  const step = (dir: 1 | -1) => {
    const a = props.anchor;
    const next = props.view === "month" ? addMonths(a, dir) : props.view === "week" ? addDays(a, 7 * dir) : props.view === "day" ? addDays(a, dir) : addDays(a, 30 * dir);
    return href({ date: next });
  };
  const href = (over: { view?: View; date?: string; mine?: boolean }) => {
    const p = new URLSearchParams();
    p.set("view", over.view ?? props.view);
    p.set("date", over.date ?? props.anchor);
    if (over.mine ?? props.mine) p.set("mine", "1");
    return `/calendar?${p}`;
  };

  const openNew = (day: string, hour?: number) => {
    if (!props.canManage) return;
    const h = hour ?? 9;
    const pad = (n: number) => String(n).padStart(2, "0");
    setDialog({
      title: "",
      description: null,
      location: null,
      allDay: false,
      start: `${day}T${pad(h)}:00`,
      end: h === 23 ? `${day}T23:59` : `${day}T${pad(h + 1)}:00`,
      ownerId: props.currentUserId,
      link: null,
      canEdit: true,
    });
  };
  const openEvent = (e: Parsed) =>
    setDialog({
      id: e.id,
      title: e.title,
      description: e.description,
      location: e.location,
      allDay: e.allDay,
      start: e.allDay ? dateKey(e.s, tz) : toLocalInput(e.s, tz),
      end: e.allDay ? dateKey(new Date(e.e.getTime() - 1), tz) : toLocalInput(e.e, tz),
      ownerId: e.ownerId,
      link: e.link,
      canEdit: e.canEdit,
      external: e.external,
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="icon-sm" aria-label={t("previous")}>
            <Link href={step(-1)}>
              <ChevronRight className="ltr:rotate-180" />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={href({ date: props.today })}>{t("today")}</Link>
          </Button>
          <Button asChild variant="secondary" size="icon-sm" aria-label={t("next")}>
            <Link href={step(1)}>
              <ChevronLeft className="ltr:rotate-180" />
            </Link>
          </Button>
          <h2 className="ms-2 text-lg font-semibold" aria-live="polite" data-testid="calendar-title">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label={t("title")}>
            {(["month", "week", "day", "agenda"] as const).map((v) => (
              <Link
                key={v}
                href={href({ view: v })}
                aria-current={props.view === v ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  props.view === v ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`views.${v}`)}
              </Link>
            ))}
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={href({ mine: !props.mine })}>{props.mine ? t("everyone") : t("mine")}</Link>
          </Button>
          {props.canManage && (
            <Button size="sm" onClick={() => openNew(props.view === "month" ? props.today : props.anchor)}>
              <Plus /> {t("newEvent")}
            </Button>
          )}
        </div>
      </div>

      {props.view === "month" && (
        <MonthGrid {...props} now={now} byDay={byDay} onNew={openNew} onOpen={openEvent} hrefForDay={(d) => href({ view: "day", date: d })} />
      )}
      {(props.view === "week" || props.view === "day") && <TimeGrid {...props} now={now} parsedEvents={events} parsedTasks={tasks} onNew={openNew} onOpen={openEvent} />}
      {props.view === "agenda" && <Agenda {...props} now={now} byDay={byDay} onOpen={openEvent} />}

      <p className="text-xs text-muted-foreground">{t("timezoneNote", { tz })}</p>

      {dialog && (
        <EventFormDialog
          key={dialog.id ?? `${dialog.start}`}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={dialog}
          members={props.members}
          currentUserId={props.currentUserId}
          canChooseOwner={props.canChooseOwner}
        />
      )}
    </div>
  );
}

type Bucket = Map<string, { events: Parsed[]; tasks: (CalTask & { d: Date })[] }>;

/** `compact` drops the time (all-day row); `dense` hides it only on narrow screens (month cells). */
function EventChip({ e, tz, onOpen, compact, dense }: { e: Parsed; tz: string; onOpen: (e: Parsed) => void; compact?: boolean; dense?: boolean }) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(e);
      }}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded-md py-0.5 text-start text-xs font-medium",
        dense ? "px-1 sm:px-1.5" : "px-1.5",
        e.external ? "bg-info-soft text-info-foreground" : "bg-primary-soft text-primary-soft-foreground",
        e.allDay && !e.external && "bg-primary text-primary-foreground",
      )}
      data-testid="calendar-event"
    >
      {!e.allDay && !compact && <span className={cn("tabular shrink-0 opacity-80", dense && "hidden sm:inline")}>{timeKey(e.s, tz)}</span>}
      <span className="truncate" dir="auto">
        {e.title}
      </span>
    </button>
  );
}

function TaskChip({ x, tz, now, dense }: { x: CalTask & { d: Date }; tz: string; now: number; dense?: boolean }) {
  const t = useTranslations("calendar");
  const done = x.status === "done";
  const overdue = !done && x.d.getTime() < now;
  return (
    <Link
      href={`/tasks?tab=team&task=${x.id}`}
      onClick={(ev) => ev.stopPropagation()}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded-md border border-dashed py-0.5 text-xs",
        dense ? "px-1 sm:px-1.5" : "px-1.5",
        done ? "border-border text-muted-foreground line-through" : overdue ? "border-danger/50 bg-danger-soft text-danger-foreground" : "border-warning/60 bg-warning-soft text-warning-foreground",
      )}
      title={`${t("task")}: ${x.title}`}
      data-testid="calendar-task"
    >
      <CalendarCheck className={cn("size-3 shrink-0", dense && "hidden sm:block")} />
      <span className={cn("tabular shrink-0 opacity-80", dense && "hidden sm:inline")}>{timeKey(x.d, tz)}</span>
      <span className="truncate" dir="auto">
        {x.title}
      </span>
    </Link>
  );
}

function weekdayHeaders(locale: string, start: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const key = addDays(start, i);
    const [y, m, d] = key.split("-").map(Number);
    return {
      key,
      short: new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))),
      day: d,
    };
  });
}

function MonthGrid(props: Props & { now: number; byDay: Bucket; onNew: (day: string) => void; onOpen: (e: Parsed) => void; hrefForDay: (d: string) => string }) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const cells = Array.from({ length: props.days }, (_, i) => addDays(props.rangeStart, i));
  const headers = weekdayHeaders(locale, props.rangeStart, 7);
  const month = props.anchor.slice(0, 7);
  const fallback = cells.includes(props.today) ? props.today : `${month}-01`;
  const [focusState, setFocus] = useState(fallback);
  // After navigating to another month the remembered cell may be off-grid.
  const focus = cells.includes(focusState) ? focusState : fallback;
  const refs = useRef(new Map<string, HTMLDivElement>());

  const move = (delta: number) => {
    const next = addDays(focus, delta);
    if (!cells.includes(next)) return;
    setFocus(next);
    refs.current.get(next)?.focus();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface" role="grid" aria-label={t("views.month")}>
      <div className="grid grid-cols-7 border-b border-border bg-muted/60" role="row">
        {headers.map((h) => (
          <div key={h.key} role="columnheader" className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
            {h.short}
          </div>
        ))}
      </div>
      {Array.from({ length: props.days / 7 }, (_, w) => (
        <div key={w} className="grid grid-cols-7" role="row">
          {cells.slice(w * 7, w * 7 + 7).map((day) => {
            const b = props.byDay.get(day);
            const items = [...(b?.events ?? []).map((e) => ({ kind: "e" as const, e })), ...(b?.tasks ?? []).map((x) => ({ kind: "t" as const, x }))];
            const visible = items.slice(0, 3);
            const inMonth = day.startsWith(month);
            const isToday = day === props.today;
            const weekend = weekdayOf(day) === 6;
            return (
              <div
                key={day}
                ref={(el) => {
                  if (el) refs.current.set(day, el);
                }}
                role="gridcell"
                tabIndex={day === focus ? 0 : -1}
                aria-label={t("newAt", { date: day })}
                aria-selected={isToday}
                onFocus={() => setFocus(day)}
                onClick={() => props.onNew(day)}
                onKeyDown={(e) => {
                  const rtl = document.documentElement.dir === "rtl";
                  if (e.key === "ArrowRight") move(rtl ? -1 : 1);
                  else if (e.key === "ArrowLeft") move(rtl ? 1 : -1);
                  else if (e.key === "ArrowDown") move(7);
                  else if (e.key === "ArrowUp") move(-7);
                  else if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onNew(day);
                  } else return;
                  e.preventDefault();
                }}
                className={cn(
                  "min-h-28 cursor-pointer border-b border-e border-border p-1.5 outline-none transition-colors last:border-e-0 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  !inMonth && "bg-muted/30 text-muted-foreground",
                  weekend && inMonth && "bg-muted/20",
                )}
                data-day={day}
              >
                <div className="mb-1 flex items-center justify-between">
                  <Link
                    href={props.hrefForDay(day)}
                    onClick={(e) => e.stopPropagation()}
                    tabIndex={-1}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs font-medium hover:bg-accent",
                      isToday && "bg-primary text-primary-foreground hover:bg-primary",
                    )}
                    aria-label={t("goToDay", { date: day })}
                  >
                    {Number(day.slice(8))}
                  </Link>
                </div>
                <div className="space-y-0.5">
                  {visible.map((it) =>
                    it.kind === "e" ? (
                      <EventChip key={`e${it.e.id}`} e={it.e} tz={props.timezone} onOpen={props.onOpen} dense />
                    ) : (
                      <TaskChip key={`t${it.x.id}`} x={it.x} tz={props.timezone} now={props.now} dense />
                    ),
                  )}
                  {items.length > visible.length && (
                    <Link href={props.hrefForDay(day)} onClick={(e) => e.stopPropagation()} className="block px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                      {t("more", { count: items.length - visible.length })}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TimeGrid(
  props: Props & { now: number; parsedEvents: Parsed[]; parsedTasks: (CalTask & { d: Date })[]; onNew: (day: string, hour?: number) => void; onOpen: (e: Parsed) => void },
) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const tz = props.timezone;
  const days = Array.from({ length: props.days }, (_, i) => addDays(props.rangeStart, i));
  const headers = weekdayHeaders(locale, props.rangeStart, props.days);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Start the visible window at 07:00 (a little above, so the 07:00 label isn't clipped).
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX - 8;
  }, []);

  const allDayItems = props.parsedEvents.filter((e) => isAllDayLike({ start: e.s, end: e.e, allDay: e.allDay }));
  const timed = props.parsedEvents.filter((e) => !isAllDayLike({ start: e.s, end: e.e, allDay: e.allDay }));
  const cols = `3.5rem repeat(${props.days}, minmax(0, 1fr))`;

  return (
    // The week scrolls sideways on phones instead of squeezing seven columns into ~45px each.
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div className={cn(props.days > 1 && "min-w-[42rem]")}>
        <div className="grid border-b border-border bg-muted/60" style={{ gridTemplateColumns: cols }}>
          <div />
          {headers.map((h) => (
            <div key={h.key} className="px-2 py-2 text-center">
              <p className="text-xs text-muted-foreground">{h.short}</p>
              <p
                className={cn(
                  "mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                  h.key === props.today && "bg-primary text-primary-foreground",
                )}
              >
                {h.day}
              </p>
            </div>
          ))}
        </div>
        <div className="grid border-b border-border" style={{ gridTemplateColumns: cols }}>
          <div className="px-1 py-1.5 text-[10px] text-muted-foreground">{t("allDay")}</div>
          {days.map((day) => (
            <div key={day} className="min-h-8 space-y-0.5 border-s border-border p-1">
              {allDayItems
                .filter((e) => daysCovered({ start: e.s, end: e.e, allDay: e.allDay }, tz).includes(day))
                .map((e) => (
                  <EventChip key={e.id} e={e} tz={tz} onOpen={props.onOpen} compact />
                ))}
            </div>
          ))}
        </div>
        <div ref={scroller} className="relative max-h-[640px] overflow-y-auto">
          <div className="grid" style={{ gridTemplateColumns: cols }}>
            <div>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="relative text-[10px] text-muted-foreground" style={{ height: HOUR_PX }}>
                  <span className="absolute -top-1.5 end-1 tabular">{h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</span>
                </div>
              ))}
            </div>
            {days.map((day) => {
              const positioned = layoutDay(
                timed.map((e) => ({ start: e.s, end: e.e, allDay: e.allDay, ev: e })),
                day,
                tz,
              );
              const dayTasks = props.parsedTasks.filter((x) => dateKey(x.d, tz) === day);
              return (
                <div key={day} className="relative border-s border-border" data-day={day}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <button
                      key={h}
                      type="button"
                      tabIndex={props.canManage ? 0 : -1}
                      disabled={!props.canManage}
                      onClick={() => props.onNew(day, h)}
                      aria-label={t("newAt", { date: `${day} ${String(h).padStart(2, "0")}:00` })}
                      className="block w-full border-b border-border/60 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                      style={{ height: HOUR_PX }}
                    />
                  ))}
                  {positioned.map((p) => (
                    <button
                      key={p.item.ev.id}
                      type="button"
                      onClick={() => props.onOpen(p.item.ev)}
                      className={cn(
                        "absolute flex flex-col justify-start overflow-hidden rounded-md border-s-4 px-1.5 py-0.5 text-start text-xs shadow-xs",
                        p.item.ev.external ? "border-info bg-info-soft text-info-foreground" : "border-primary bg-primary-soft text-primary-soft-foreground",
                      )}
                      style={{
                        top: (p.top / 60) * HOUR_PX,
                        height: Math.max(18, (p.height / 60) * HOUR_PX - 2),
                        insetInlineStart: `calc(${(p.column / p.columns) * 100}% + 2px)`,
                        width: `calc(${100 / p.columns}% - 4px)`,
                      }}
                      data-testid="calendar-event"
                    >
                      <span className="block truncate font-medium" dir="auto">
                        {p.item.ev.title}
                      </span>
                      <span className="block truncate tabular opacity-80">
                        {timeKey(p.item.start, tz)}–{timeKey(p.item.end, tz)}
                      </span>
                    </button>
                  ))}
                  {dayTasks.map((x) => (
                    <div key={x.id} className="absolute inset-x-1" style={{ top: ((x.d.getTime() - startOfDay(day, tz).getTime()) / 3_600_000) * HOUR_PX }}>
                      <TaskChip x={x} tz={tz} now={props.now} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Agenda(props: Props & { now: number; byDay: Bucket; onOpen: (e: Parsed) => void }) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const tz = props.timezone;
  const days = Array.from({ length: props.days }, (_, i) => addDays(props.rangeStart, i)).filter((d) => {
    const b = props.byDay.get(d);
    return b && (b.events.length || b.tasks.length);
  });
  if (!days.length) return <EmptyState icon={<CalendarCheck />} title={t("noItems")} />;
  return (
    <ol className="space-y-4">
      {days.map((day) => {
        const b = props.byDay.get(day)!;
        const label = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(startOfDay(day, tz));
        return (
          <li key={day} className="rounded-xl border border-border bg-surface">
            <h3 className={cn("border-b border-border px-4 py-2 text-sm font-semibold", day === props.today && "text-primary")}>{label}</h3>
            <ul className="divide-y divide-border">
              {b.events.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => props.onOpen(e)} className="flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent/40" data-testid="calendar-event">
                    <span className="tabular w-24 shrink-0 text-xs text-muted-foreground">{e.allDay ? t("allDay") : `${timeKey(e.s, tz)}–${timeKey(e.e, tz)}`}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium" dir="auto">
                        {e.title}
                      </span>
                      {e.location && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground" dir="auto">
                          <MapPin className="size-3" /> {e.location}
                        </span>
                      )}
                    </span>
                    {e.external && <Badge tone="info">{e.external}</Badge>}
                  </button>
                </li>
              ))}
              {b.tasks.map((x) => (
                <li key={x.id} className="px-4 py-2">
                  <TaskChip x={x} tz={tz} now={props.now} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

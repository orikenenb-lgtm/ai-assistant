"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Beaker, ExternalLink, Inbox, MessageCirclePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Avatar, Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/menu";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { useRemoteData } from "@/hooks/use-remote-data";
import { formatPhone } from "@/lib/phone";
import { dayKey, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchContactsAction } from "@/modules/crm/lookup-actions";
import { simulateStatusAction } from "@/modules/whatsapp/actions";
import {
  assignConversationAction,
  getThreadAction,
  listConversationsAction,
  openConversationAction,
  setConversationStatusAction,
  setHandoffAction,
} from "../actions";
import type { ConversationListItem, ThreadMessage, ThreadNote } from "../service";
import { Composer } from "./composer";
import { ConversationAiPanel } from "@/modules/ai/components/conversation-ai-panel";
import { DaySeparator, MessageBubble, NoteBubble } from "./message-bubble";
import type { TemplateOption } from "./template-dialog";
import { useInboxLive } from "./use-inbox-live";

export type InboxBootstrap = {
  tenantId: string;
  currentUserId: string;
  isManager: boolean;
  canReply: boolean;
  canAssign: boolean;
  realtimeUrl: string | null;
  realtimeKey: string | null;
  members: { userId: string; fullName: string }[];
  templates: (TemplateOption & { accountId: string })[];
  initialConversationId: string | null;
  devSimulator: boolean;
  /** AI Copilot available to this user (permission + plan); `aiMock` labels the demo provider. */
  ai: { enabled: boolean; mock: boolean };
};

type Filters = { assignee: "all" | "mine" | "unassigned"; status: "open" | "pending" | "closed" | "all"; attention: boolean; q: string };
type Thread = Awaited<ReturnType<typeof getThreadAction>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never;

function ConversationRow({ c, active, onSelect }: { c: ConversationListItem; active: boolean; onSelect: () => void }) {
  const locale = useLocale() as "he" | "en";
  const t = useTranslations("inbox");
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn("flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-accent", active && "bg-sidebar-active")}
        data-testid="conversation-row"
      >
        <span className="relative">
          <Avatar name={c.contactName} size="md" />
          {c.needsAttention && <span className="absolute -end-0.5 -top-0.5 size-3 rounded-full border-2 border-surface bg-danger" aria-label={t("needsAttention")} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", c.unreadCount > 0 ? "font-semibold" : "font-medium")} dir="auto">
              {c.contactName}
            </span>
            {c.lastMessageAt && <time className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(c.lastMessageAt, locale)}</time>}
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground" dir="auto">
              {c.lastMessagePreview ?? ""}
            </span>
            {c.unreadCount > 0 && (
              <span className="flex min-w-5 items-center justify-center rounded-full bg-success px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={t("unread", { count: c.unreadCount })}>
                {c.unreadCount}
              </span>
            )}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {c.status !== "open" && <Badge tone={c.status === "closed" ? "neutral" : "warning"}>{t(`status.${c.status}`)}</Badge>}
            {c.assigneeName ? <span className="truncate">{c.assigneeName}</span> : <span>{t("unassigned")}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function NewConversationDialog({ onOpened }: { onOpened: (id: string) => void }) {
  const t = useTranslations("inbox");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<ComboOption | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("newConversation")}>
          <MessageCirclePlus />
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("newConversation")}</DialogTitle>
        </DialogHeader>
        <AsyncCombobox value={contact} onChange={setContact} search={searchContactsAction} placeholder={t("selectContact")} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={!contact}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = await openConversationAction({ contactId: contact!.id });
              setBusy(false);
              if (!res.ok) return void toast.error(res.error.message);
              setOpen(false);
              onOpened(res.data.id);
            }}
          >
            {t("start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InboxApp(props: InboxBootstrap) {
  const t = useTranslations("inbox");
  const tc = useTranslations("common");
  const tContacts = useTranslations("contacts");
  const [filters, setFilters] = useState<Filters>({ assignee: "all", status: "open", attention: false, q: "" });
  const [searchText, setSearchText] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(props.initialConversationId);
  const [older, setOlder] = useState<{ id: string; messages: ThreadMessage[]; hasMore: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const listKey = JSON.stringify(filters);
  const { data: list, reload: reloadList } = useRemoteData(async () => {
    const res = await listConversationsAction({ assignee: filters.assignee, status: filters.status, attention: filters.attention, q: filters.q || undefined });
    return res.ok ? res.data : null;
  }, listKey);

  const { data: thread, reload: reloadThread } = useRemoteData<Thread>(async () => {
    if (!selectedId) return null;
    const res = await getThreadAction({ conversationId: selectedId, markRead: true });
    if (!res.ok) {
      toast.error(res.error.message);
      return null;
    }
    return res.data;
  }, selectedId ?? "none");

  useInboxLive({ realtimeUrl: props.realtimeUrl, realtimeKey: props.realtimeKey, tenantId: props.tenantId, pollMs: 15_000, onChange: reloadList });
  useInboxLive({ realtimeUrl: null, realtimeKey: null, tenantId: props.tenantId, pollMs: 5_000, onChange: () => selectedId && reloadThread() });

  const select = (id: string | null) => {
    setSelectedId(id);
    window.history.replaceState(null, "", id ? `/inbox?c=${id}` : "/inbox");
  };

  const earlier = older?.id === selectedId ? older : null;
  const items = useMemo(() => {
    if (!thread) return [];
    const msgs: (ThreadMessage & { kind: "m" })[] = [...(earlier?.messages ?? []), ...thread.messages].map((m) => ({ ...m, kind: "m" as const }));
    const notes: (ThreadNote & { kind: "n" })[] = thread.notes.map((n) => ({ ...n, kind: "n" as const }));
    return [...msgs, ...notes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [thread, earlier]);

  const lastItemId = items.at(-1)?.id;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lastItemId, selectedId]);

  const refreshAll = () => {
    reloadThread();
    reloadList();
  };

  const run = async (p: Promise<{ ok: boolean; error?: { message: string } }>) => {
    const res = await p;
    if (!res.ok) toast.error(res.error?.message ?? "");
    refreshAll();
  };

  const templates = thread ? props.templates.filter((x) => x.accountId === thread.account.id) : [];

  return (
    <div className="grid h-[calc(100dvh-8.5rem)] min-h-[520px] overflow-hidden rounded-xl border border-border bg-surface shadow-xs lg:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_290px]">
      {/* ------------------------------------------------ conversation list */}
      <aside className={cn("flex min-h-0 flex-col border-e border-border", selectedId && "hidden lg:flex")} aria-label={t("title")}>
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold">{t("title")}</h1>
            <NewConversationDialog onOpened={(id) => (select(id), reloadList())} />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchText}
              onChange={(e) => {
                const v = e.target.value;
                setSearchText(v);
                if (searchTimer.current) clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(() => setFilters((f) => ({ ...f, q: v.trim() })), 300);
              }}
              placeholder={t("filters.search")}
              aria-label={t("filters.search")}
              className="h-8 ps-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label={t("assignee")}>
              {(["all", "mine", "unassigned"] as const).map((a) => (
                <button
                  key={a}
                  aria-pressed={filters.assignee === a}
                  onClick={() => setFilters((f) => ({ ...f, assignee: a }))}
                  className={cn("rounded-md px-2 py-1 font-medium", filters.assignee === a ? "bg-surface shadow-xs" : "text-muted-foreground")}
                >
                  {t(`filters.${a}`)}
                </button>
              ))}
            </div>
            <NativeSelect
              aria-label={tc("status")}
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as Filters["status"] }))}
              className="h-7 flex-1 py-0 text-xs"
            >
              <option value="open">{t("filters.open")}</option>
              <option value="pending">{t("filters.pending")}</option>
              <option value="closed">{t("filters.closed")}</option>
              <option value="all">{t("filters.allStatuses")}</option>
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={filters.attention} onCheckedChange={(v) => setFilters((f) => ({ ...f, attention: v }))} aria-label={t("filters.attention")} />
            {t("filters.attention")}
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list === null ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : list.items.length === 0 ? (
            <EmptyState icon={<Inbox />} title={t("empty.listTitle")} description={t("empty.listBody")} className="m-4 border-0" />
          ) : (
            <ul className="divide-y divide-border">
              {list.items.map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === selectedId} onSelect={() => select(c.id)} />
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ------------------------------------------------------- thread */}
      <section className={cn("flex min-h-0 min-w-0 flex-col", !selectedId && "hidden lg:flex")} aria-label={thread?.contact.name ?? t("empty.threadTitle")}>
        {!selectedId ? (
          <EmptyState icon={<Inbox />} title={t("empty.threadTitle")} description={t("empty.threadBody")} className="m-6 flex-1 border-0" />
        ) : !thread ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-16 w-2/3" />
            <Skeleton className="ms-auto h-16 w-2/3" />
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
              <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => select(null)} aria-label={t("back")}>
                <ArrowRight className="ltr:rotate-180" />
              </Button>
              <Avatar name={thread.contact.name} size="sm" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold" dir="auto">
                  {thread.contact.name}
                </h2>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">
                  {formatPhone(thread.contact.phone)}
                </p>
              </div>
              {thread.conversation.needsAttention && (
                <Badge tone="danger">
                  <AlertTriangle /> {t("needsAttention")}
                </Badge>
              )}
              <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label={tc("status")}>
                {(["open", "pending", "closed"] as const).map((s) => (
                  <button
                    key={s}
                    aria-pressed={thread.conversation.status === s}
                    disabled={!props.canReply}
                    onClick={() => run(setConversationStatusAction({ conversationId: thread.conversation.id, status: s }))}
                    className={cn("rounded-md px-2 py-1 font-medium disabled:opacity-60", thread.conversation.status === s ? "bg-surface shadow-xs" : "text-muted-foreground")}
                  >
                    {t(`status.${s}`)}
                  </button>
                ))}
              </div>
              {props.canAssign &&
                (props.isManager ? (
                  <NativeSelect
                    aria-label={t("assignee")}
                    value={thread.conversation.assigneeId ?? ""}
                    onChange={(e) => run(assignConversationAction({ conversationId: thread.conversation.id, assigneeId: e.target.value || null }))}
                    className="h-8 w-auto max-w-40 py-0 text-xs"
                  >
                    <option value="">{t("unassigned")}</option>
                    {props.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.fullName}
                      </option>
                    ))}
                  </NativeSelect>
                ) : thread.conversation.assigneeId === props.currentUserId ? (
                  <Button size="sm" variant="ghost" onClick={() => run(assignConversationAction({ conversationId: thread.conversation.id, assigneeId: null }))}>
                    {t("unassign")}
                  </Button>
                ) : !thread.conversation.assigneeId ? (
                  <Button size="sm" variant="soft" onClick={() => run(assignConversationAction({ conversationId: thread.conversation.id, assigneeId: props.currentUserId }))}>
                    {t("assignToMe")}
                  </Button>
                ) : null)}
              {props.devSimulator && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t("simulator.title")}>
                      <Beaker />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>{t("simulator.title")}</DropdownMenuLabel>
                    {(["delivered", "read", "failed"] as const).map((s) => (
                      <DropdownMenuItem key={s} onSelect={() => run(simulateStatusAction({ conversationId: thread.conversation.id, status: s }))}>
                        {t(`simulator.${s}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-muted/30 px-3 py-4 sm:px-6" aria-live="polite">
              {(earlier ? earlier.hasMore : thread.hasMore) && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={loadingOlder}
                    onClick={async () => {
                      const first = items.find((i) => i.kind === "m");
                      if (!first) return;
                      setLoadingOlder(true);
                      const res = await getThreadAction({ conversationId: thread.conversation.id, before: first.createdAt });
                      setLoadingOlder(false);
                      if (res.ok) setOlder({ id: thread.conversation.id, messages: [...res.data.messages, ...(earlier?.messages ?? [])], hasMore: res.data.hasMore });
                    }}
                  >
                    {t("loadOlder")}
                  </Button>
                </div>
              )}
              {items.map((it, i) => (
                <Fragment key={it.id}>
                  {(i === 0 || dayKey(items[i - 1].createdAt) !== dayKey(it.createdAt)) && <DaySeparator date={it.createdAt} />}
                  {it.kind === "m" ? <MessageBubble m={it} /> : <NoteBubble n={it} />}
                </Fragment>
              ))}
            </div>

            <Composer
              conversationId={thread.conversation.id}
              window={{ open: thread.window.open, msLeft: thread.window.msLeft }}
              consent={thread.contact.consent}
              accountActive={thread.account.status === "active"}
              canReply={props.canReply}
              templates={templates}
              onSent={refreshAll}
              aiDraft={props.ai.enabled}
            />
          </>
        )}
      </section>

      {/* -------------------------------------------------- contact panel */}
      <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto border-s border-border p-4 xl:flex" aria-label={t("contact.title")}>
        {thread ? (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <Avatar name={thread.contact.name} size="lg" />
              <p className="font-semibold" dir="auto">
                {thread.contact.name}
              </p>
              <p className="text-sm text-muted-foreground" dir="ltr">
                {formatPhone(thread.contact.phone)}
              </p>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/contacts/${thread.contact.id}`}>
                  <ExternalLink /> {t("contact.open")}
                </Link>
              </Button>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("contact.consent")}</dt>
                <dd>
                  <Badge tone={thread.contact.consent === "opted_in" ? "success" : thread.contact.consent === "opted_out" ? "danger" : "neutral"}>
                    {tContacts(`consentStatus.${thread.contact.consent}`)}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("contact.stage")}</dt>
                <dd>{tContacts(`stages.${thread.contact.lifecycleStage}` as "stages.lead")}</dd>
              </div>
              {thread.contact.email && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{tc("email")}</dt>
                  <dd className="truncate" dir="ltr">
                    {thread.contact.email}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("contact.account")}</dt>
                <dd className="text-end">
                  {thread.account.displayName}
                  {thread.account.provider === "mock" && <Badge tone="warning" className="ms-1">{tc("mockBadge")}</Badge>}
                </dd>
              </div>
            </dl>
            {props.ai.enabled && <ConversationAiPanel conversationId={thread.conversation.id} mock={props.ai.mock} />}
            {props.canReply && (
              <label className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <span>{thread.conversation.handoffState === "human" ? t("handoff") : t("handoffBot")}</span>
                <Switch
                  checked={thread.conversation.handoffState === "human"}
                  onCheckedChange={(v) => run(setHandoffAction({ conversationId: thread.conversation.id, state: v ? "human" : "bot" }))}
                  aria-label={t("handoff")}
                />
              </label>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("empty.threadBody")}</p>
        )}
      </aside>
    </div>
  );
}

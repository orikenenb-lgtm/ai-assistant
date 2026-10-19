import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Lock, MessageCircle, Sparkles } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { isAppError } from "@/server/errors";
import { getEntitlements } from "@/modules/billing/entitlements";
import { listAssignableMembers } from "@/modules/org/members";
import { listAccounts, listTemplates, mockAllowed } from "@/modules/whatsapp/accounts";
import { openConversationForContact } from "@/modules/inbox/service";
import { InboxApp } from "@/modules/inbox/components/inbox-app";
import { isMockAi } from "@/modules/ai/runtime";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("inbox") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const tc = await requireTenant();
  const { ctx } = tc;
  const t = await getTranslations("inbox");
  const tErrors = await getTranslations();

  if (!ctx.can("inbox.view")) {
    return <EmptyState icon={<Lock />} title={tErrors("errors.forbidden")} />;
  }

  const ent = await getEntitlements(db(), ctx.tenantId);
  if (!ent.features.has("whatsapp")) {
    return (
      <EmptyState
        icon={<Sparkles />}
        title={t("empty.planTitle")}
        description={t("empty.planBody")}
        action={
          ctx.can("billing.view") ? (
            <Button asChild>
              <Link href="/settings/billing">{t("empty.upgrade")}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const accounts = await listAccounts(ctx);
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<MessageCircle />}
        title={t("empty.noAccountTitle")}
        description={t("empty.noAccountBody")}
        action={
          ctx.can("integrations.manage") ? (
            <Button asChild>
              <Link href="/settings/whatsapp">{t("empty.connect")}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // /inbox?contact=<id> opens (or creates) that contact's conversation.
  const contactId = one(sp.contact);
  let notice: string | null = null;
  if (contactId && UUID.test(contactId)) {
    let openedId: string | null = null;
    try {
      openedId = await openConversationForContact(ctx, contactId);
    } catch (e) {
      if (!isAppError(e)) throw e;
      notice = tErrors(e.message as "errors.notFound");
    }
    if (openedId) redirect(`/inbox?c=${openedId}`);
  }
  const conversationParam = one(sp.c);

  const [members, templates] = await Promise.all([listAssignableMembers(ctx), listTemplates(ctx)]);
  const e = env();
  const realtime = e.AUTH_PROVIDER === "supabase" && e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return (
    <>
      {notice && (
        <Alert tone="warning" className="mb-3">
          {notice}
        </Alert>
      )}
      <InboxApp
        tenantId={ctx.tenantId}
        currentUserId={tc.user.userId}
        isManager={tc.role === "owner" || tc.role === "manager"}
        canReply={ctx.can("inbox.reply") && !ctx.readOnly}
        canAssign={ctx.can("inbox.assign") && !ctx.readOnly}
        realtimeUrl={realtime ? e.NEXT_PUBLIC_SUPABASE_URL! : null}
        realtimeKey={realtime ? e.NEXT_PUBLIC_SUPABASE_ANON_KEY! : null}
        members={members.map((m) => ({ userId: m.userId, fullName: m.fullName }))}
        templates={templates
          .filter((x) => x.status === "APPROVED")
          .map((x) => ({ id: x.id, accountId: x.accountId, name: x.name, language: x.language, category: x.category, components: x.components }))}
        initialConversationId={conversationParam && UUID.test(conversationParam) ? conversationParam : null}
        devSimulator={mockAllowed() && ctx.can("inbox.reply") && !ctx.readOnly && accounts.some((a) => a.provider === "mock")}
        ai={{ enabled: ctx.can("ai.use") && !ctx.readOnly && ent.features.has("ai"), mock: isMockAi() }}
      />
    </>
  );
}

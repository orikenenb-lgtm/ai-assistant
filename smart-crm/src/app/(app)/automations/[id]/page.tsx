import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { AppError } from "@/server/errors";
import { builderLookups, getWorkflow } from "@/modules/automation/service";
import { WorkflowBuilder } from "@/modules/automation/components/workflow-builder";

export async function generateMetadata() {
  return { title: (await getTranslations("automation"))("title") };
}

export default async function WorkflowPage({ params }: PageProps<"/automations/[id]">) {
  const { id } = await params;
  const { ctx } = await requireTenant();
  if (!ctx.can("automation.view")) redirect("/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("automation");
  const wf = await getWorkflow(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const lookups = await builderLookups(ctx);
  return (
    <>
      <Link href="/automations" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden /> {t("title")}
      </Link>
      <WorkflowBuilder
        workflow={{
          id: wf.id,
          name: wf.name,
          status: wf.status,
          publishedVersion: wf.publishedVersion,
          maxRunsPerEntityPerDay: wf.maxRunsPerEntityPerDay,
          hasWebhookToken: Boolean(wf.webhookTokenHash),
          definition: wf.definition,
        }}
        availableActions={wf.availableActions}
        lookups={lookups}
        canManage={ctx.can("automation.manage") && !ctx.readOnly}
      />
    </>
  );
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import {
  cancelRun,
  createWorkflow,
  getRunSteps,
  previewSegment,
  publishWorkflow,
  retryFailedRun,
  rotateWebhookToken,
  runManually,
  saveDraft,
  setWorkflowStatus,
} from "./service";

const id = z.object({ id: z.uuid() });
const manage = { permission: "automation.manage" as const };

export async function createWorkflowAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: z.object({ name: z.string().trim().min(1).max(120), templateKey: z.string().max(40).optional() }), ...manage }, async (d, { ctx }) => {
    const wf = await createWorkflow(ctx, d);
    revalidatePath("/automations");
    return { id: wf.id };
  });
}

export async function saveDraftAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    {
      schema: z.object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        definition: z.unknown(),
        maxRunsPerEntityPerDay: z.number().int().min(1).max(1000).optional(),
      }),
      ...manage,
    },
    async ({ id, ...rest }, { ctx }) => {
      await saveDraft(ctx, id, rest);
      return null;
    },
  );
}

export async function publishWorkflowAction(input: unknown): Promise<ActionResult<{ version: number; webhookToken: string | null }>> {
  return tenantAction(input, { schema: id, ...manage }, async ({ id }, { ctx }) => {
    const r = await publishWorkflow(ctx, id);
    revalidatePath(`/automations/${id}`);
    return r;
  });
}

export async function setWorkflowStatusAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id.extend({ status: z.enum(["paused", "active", "archived"]) }), ...manage }, async ({ id, status }, { ctx }) => {
    await setWorkflowStatus(ctx, id, status);
    revalidatePath("/automations");
    return null;
  });
}

export async function rotateWebhookTokenAction(input: unknown): Promise<ActionResult<{ token: string }>> {
  return tenantAction(input, { schema: id, ...manage }, async ({ id }, { ctx }) => ({ token: await rotateWebhookToken(ctx, id) }));
}

export async function runManuallyAction(input: unknown): Promise<ActionResult<{ runId: string | null }>> {
  return tenantAction(input, { schema: id.extend({ contactId: z.uuid() }), ...manage }, async ({ id, contactId }, { ctx }) => ({
    runId: await runManually(ctx, id, contactId),
  }));
}

export async function previewSegmentAction(input: unknown): Promise<ActionResult<{ matches: number; scanned: number }>> {
  return tenantAction(input, { schema: z.object({ rules: z.unknown() }), permission: "automation.view", write: false }, ({ rules }, { ctx }) => previewSegment(ctx, rules));
}

export async function runStepsAction(input: unknown) {
  return tenantAction(input, { schema: id, permission: "automation.view", write: false }, ({ id }, { ctx }) => getRunSteps(ctx, id));
}

export async function retryRunAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, ...manage }, async ({ id }, { ctx }) => {
    await retryFailedRun(ctx, id);
    return null;
  });
}

export async function cancelRunAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, ...manage }, async ({ id }, { ctx }) => {
    await cancelRun(ctx, id);
    return null;
  });
}

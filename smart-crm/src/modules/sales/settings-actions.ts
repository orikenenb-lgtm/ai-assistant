"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { archiveCustomField, createCustomField, customFieldDefSchema, reorderCustomFields, updateCustomField } from "@/modules/crm/custom-fields";
import { createTag, deleteTag, tagInputSchema, updateTag } from "@/modules/crm/tags";
import { lostReasonInputSchema, pipelineInputSchema, stageInputSchema } from "./schemas";
import {
  addStage,
  archivePipeline,
  createLostReason,
  createPipeline,
  deleteLostReason,
  deleteStage,
  renamePipeline,
  reorderStages,
  setDefaultPipeline,
  updateLostReason,
  updateStage,
} from "./pipelines";

const id = z.object({ id: z.uuid() });

function done(path: string) {
  revalidatePath(path);
  return null;
}

/* ------------------------------------------------------------ pipelines */

export async function createPipelineAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(
    input,
    { schema: pipelineInputSchema.extend({ locale: z.enum(["he", "en"]).default("he") }), permission: "pipelines.manage" },
    async (data, { ctx }) => {
      const p = await createPipeline(ctx, data);
      revalidatePath("/settings/pipelines");
      return { id: p.id };
    },
  );
}

export async function renamePipelineAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id.extend(pipelineInputSchema.shape), permission: "pipelines.manage" }, async ({ id, name }, { ctx }) => {
    await renamePipeline(ctx, id, name);
    return done("/settings/pipelines");
  });
}

export async function setDefaultPipelineAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "pipelines.manage" }, async ({ id }, { ctx }) => {
    await setDefaultPipeline(ctx, id);
    return done("/settings/pipelines");
  });
}

export async function archivePipelineAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "pipelines.manage" }, async ({ id }, { ctx }) => {
    await archivePipeline(ctx, id);
    return done("/settings/pipelines");
  });
}

export async function addStageAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ pipelineId: z.uuid() }).extend(stageInputSchema.shape), permission: "pipelines.manage" },
    async ({ pipelineId, ...data }, { ctx }) => {
      await addStage(ctx, pipelineId, data);
      return done("/settings/pipelines");
    },
  );
}

export async function updateStageAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id.extend(stageInputSchema.shape), permission: "pipelines.manage" }, async ({ id, ...data }, { ctx }) => {
    await updateStage(ctx, id, data);
    return done("/settings/pipelines");
  });
}

export async function reorderStagesAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ pipelineId: z.uuid(), orderedIds: z.array(z.uuid()).min(1).max(30) }), permission: "pipelines.manage" },
    async ({ pipelineId, orderedIds }, { ctx }) => {
      await reorderStages(ctx, pipelineId, orderedIds);
      return done("/settings/pipelines");
    },
  );
}

export async function deleteStageAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: id.extend({ moveToStageId: z.uuid().nullable().optional() }), permission: "pipelines.manage" },
    async ({ id, moveToStageId }, { ctx }) => {
      await deleteStage(ctx, id, moveToStageId ?? null);
      return done("/settings/pipelines");
    },
  );
}

export async function createLostReasonAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: lostReasonInputSchema.pick({ label: true }), permission: "pipelines.manage" }, async ({ label }, { ctx }) => {
    await createLostReason(ctx, label);
    return done("/settings/pipelines");
  });
}

export async function updateLostReasonAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id.extend(lostReasonInputSchema.shape), permission: "pipelines.manage" }, async ({ id, ...data }, { ctx }) => {
    await updateLostReason(ctx, id, data);
    return done("/settings/pipelines");
  });
}

export async function deleteLostReasonAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "pipelines.manage" }, async ({ id }, { ctx }) => {
    await deleteLostReason(ctx, id);
    return done("/settings/pipelines");
  });
}

/* --------------------------------------------------------- custom fields */

export async function createCustomFieldAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: customFieldDefSchema, permission: "settings.manage" }, async (data, { ctx }) => {
    await createCustomField(ctx, data);
    return done("/settings/custom-fields");
  });
}

export async function updateCustomFieldAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    {
      schema: id.extend({
        label: z.string().trim().min(1).max(80).optional(),
        options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
        required: z.boolean().optional(),
        position: z.number().int().min(0).max(1000).optional(),
      }),
      permission: "settings.manage",
    },
    async ({ id, ...data }, { ctx }) => {
      await updateCustomField(ctx, id, data);
      return done("/settings/custom-fields");
    },
  );
}

export async function reorderCustomFieldsAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ entityType: z.enum(["contact", "company", "deal", "lead"]), orderedIds: z.array(z.uuid()).min(1).max(100) }), permission: "settings.manage" },
    async ({ entityType, orderedIds }, { ctx }) => {
      await reorderCustomFields(ctx, entityType, orderedIds);
      return done("/settings/custom-fields");
    },
  );
}

export async function archiveCustomFieldAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "settings.manage" }, async ({ id }, { ctx }) => {
    await archiveCustomField(ctx, id);
    return done("/settings/custom-fields");
  });
}

/* ------------------------------------------------------------------ tags */

export async function createTagSettingsAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: tagInputSchema, permission: "settings.manage" }, async (data, { ctx }) => {
    await createTag(ctx, data);
    return done("/settings/tags");
  });
}

export async function updateTagAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id.extend(tagInputSchema.shape), permission: "settings.manage" }, async ({ id, ...data }, { ctx }) => {
    await updateTag(ctx, id, data);
    return done("/settings/tags");
  });
}

export async function deleteTagAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "settings.manage" }, async ({ id }, { ctx }) => {
    await deleteTag(ctx, id);
    return done("/settings/tags");
  });
}

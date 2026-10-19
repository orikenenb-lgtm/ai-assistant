"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { TASK_STATUSES, taskInputSchema } from "./schemas";
import { createTask, deleteTask, setTaskStatus, updateTask } from "./service";

export async function createTaskAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: taskInputSchema, permission: "tasks.create" }, async (data, { ctx }) => {
    const task = await createTask(ctx, data);
    revalidatePath("/tasks");
    return { id: task.id };
  });
}

export async function updateTaskAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: z.object({ id: z.uuid(), data: taskInputSchema }), permission: "tasks.update" }, async ({ id, data }, { ctx }) => {
    await updateTask(ctx, id, data);
    revalidatePath("/tasks");
    return { id };
  });
}

export async function setTaskStatusAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  return tenantAction(
    input,
    { schema: z.object({ id: z.uuid(), status: z.enum(TASK_STATUSES) }), permission: "tasks.update" },
    async ({ id, status }, { ctx }) => {
      const task = await setTaskStatus(ctx, id, status);
      revalidatePath("/tasks");
      return { status: task.status };
    },
  );
}

export async function deleteTaskAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "tasks.delete" }, async ({ id }, { ctx }) => {
    await deleteTask(ctx, id);
    revalidatePath("/tasks");
    return null;
  });
}

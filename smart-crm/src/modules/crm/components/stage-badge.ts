export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "ai";

export function stageTone(stage: string): Tone {
  return ({ subscriber: "info", lead: "primary", opportunity: "warning", customer: "success", churned: "danger", other: "neutral" } as Record<string, Tone>)[stage] ?? "neutral";
}

import type { Tone } from "@/modules/crm/components/stage-badge";

export function leadStatusTone(status: string): Tone {
  return ({ new: "info", contacted: "primary", qualified: "success", unqualified: "neutral", converted: "ai" } as Record<string, Tone>)[status] ?? "neutral";
}

export function aiTone(classification: string | null): Tone {
  return ({ hot: "danger", warm: "warning", cold: "info", spam: "neutral" } as Record<string, Tone>)[classification ?? ""] ?? "neutral";
}

export function dealStatusTone(status: string): Tone {
  return status === "won" ? "success" : status === "lost" ? "danger" : "primary";
}

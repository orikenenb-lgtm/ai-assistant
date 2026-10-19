import { describe, expect, it } from "vitest";
import { QUOTE_STATUSES, canTransition, isAwaitingDecision, isEditable, isTerminal } from "@/modules/documents/status";

describe("quote status machine", () => {
  it("allows the documented happy paths", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "viewed")).toBe(true);
    expect(canTransition("viewed", "accepted")).toBe(true);
    expect(canTransition("viewed", "rejected")).toBe(true);
    expect(canTransition("sent", "expired")).toBe(true);
    expect(canTransition("viewed", "expired")).toBe(true);
    expect(canTransition("draft", "canceled")).toBe(true);
    expect(canTransition("sent", "canceled")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(canTransition("draft", "viewed")).toBe(false);
    expect(canTransition("draft", "expired")).toBe(false);
    expect(canTransition("viewed", "sent")).toBe(false);
    expect(canTransition("accepted", "rejected")).toBe(false);
    expect(canTransition("expired", "accepted")).toBe(false);
    expect(canTransition("canceled", "draft")).toBe(false);
  });

  it("marks terminal, editable and awaiting states", () => {
    expect(QUOTE_STATUSES.filter(isTerminal)).toEqual(["accepted", "rejected", "expired", "canceled"]);
    expect(QUOTE_STATUSES.filter(isEditable)).toEqual(["draft"]);
    expect(QUOTE_STATUSES.filter(isAwaitingDecision)).toEqual(["sent", "viewed"]);
  });
});

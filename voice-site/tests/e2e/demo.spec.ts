import { expect, test } from "@playwright/test";
import { receivedLeads } from "./helpers";

test("live demo: text chat answers and books an intro call", async ({ page }) => {
  await page.goto("/");
  const demo = page.locator("#demo");
  await demo.getByRole("button", { name: "או כתבו לה" }).click();
  await expect(demo.getByText("צ׳אט חי")).toBeVisible();

  const input = demo.getByLabel("הודעה לסוכנת");
  await expect(input).toBeFocused();
  const log = demo.getByRole("log", { name: "תמלול השיחה" });

  const say = async (text: string, expectReply: RegExp | string) => {
    await input.fill(text);
    await input.press("Enter");
    await expect(log.locator("p").last()).toContainText(expectReply);
  };

  await say("כמה זה עולה?", "שלוש חבילות");
  // Letters only (a name with digits is rejected); unique per run so the webhook lookup is exact.
  const letters = "אבגדהוזחטיכלמנסעפצקרשת";
  const name = `טל${Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join("")}`;
  await say("אני רוצה סוכן לעסק", "איך קוראים לך");
  await say(`קוראים לי ${name}`, "איזה עסק");
  await say("מספרה בתל אביב", "לאיזה מספר");
  await say("050 765 4321", "050-765-4321");
  await say("כן", "רשמתי");
  await expect(demo.getByText("הפרטים נשמרו")).toBeVisible();

  await expect
    .poll(async () => (await receivedLeads()).find((l) => l.body.lead.name === name)?.body.lead)
    .toMatchObject({ phone: "+972507654321", business: "מספרה בתל אביב", source: "demo-agent" });

  await demo.getByRole("button", { name: "סיום" }).click();
  await expect(demo.getByText("השיחה הסתיימה")).toBeVisible();
});

test("live demo: a suggestion chip starts a chat", async ({ page }) => {
  await page.goto("/");
  const demo = page.locator("#demo");
  await demo.getByRole("button", { name: "איך זה עובד?" }).click();
  await expect(demo.getByRole("log")).toContainText("קובעת תורים ביומן");
});

test("live demo: browsers without speech recognition fall back to text", async ({ page }) => {
  await page.addInitScript(() => {
    // Simulate a browser with no Web Speech recognition (e.g. Firefox).
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  });
  await page.goto("/");
  const demo = page.locator("#demo");
  await demo.getByRole("button", { name: "התחילו שיחה" }).click();
  await expect(demo.getByText("זיהוי דיבור לא נתמך")).toBeVisible();
  await expect(demo.getByLabel("הודעה לסוכנת")).toBeFocused();
});

test("conversation player reveals the transcript and the system steps", async ({ page }) => {
  await page.goto("/#how");
  const section = page.locator("#how");
  await expect(section.getByText("טופל")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await section.getByRole("button", { name: /האזינו לשיחה/ }).click();
  await expect(section.getByText("בטיפול")).toBeVisible();
  await expect(section.getByText("טופל")).toBeVisible({ timeout: 20_000 });
  await expect(section.getByText("נשלח אישור בוואטסאפ עם כתובת והנחיות")).toBeVisible();
});

test("live demo: voice loop listens once at a time, answers, and pauses after silence", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __queue: string[]; __active: number; __maxActive: number };
    w.__queue = ["כמה זה עולה"];
    w.__active = 0;
    w.__maxActive = 0;
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private timer: ReturnType<typeof setTimeout> | undefined;
      private done = false;
      start() {
        w.__active += 1;
        w.__maxActive = Math.max(w.__maxActive, w.__active);
        this.timer = setTimeout(() => {
          const text = w.__queue.shift();
          if (text) this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
          else this.onerror?.({ error: "no-speech" });
          this.finish();
        }, 250);
      }
      private finish() {
        if (this.done) return;
        this.done = true;
        w.__active -= 1;
        this.onend?.();
      }
      stop() {
        this.finish();
      }
      abort() {
        clearTimeout(this.timer);
        this.onerror?.({ error: "aborted" });
        this.finish();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: FakeRecognition, configurable: true });
  });
  await page.goto("/");
  const demo = page.locator("#demo");
  await demo.getByRole("button", { name: "התחילו שיחה" }).click();

  await expect(demo.getByRole("log")).toContainText("שלוש חבילות", { timeout: 15_000 });
  await expect(demo.getByText("לא שמעתי כלום")).toBeVisible({ timeout: 15_000 });
  await expect(demo.getByRole("button", { name: "המיקרופון כבוי" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __maxActive: number }).__maxActive)).toBe(1);

  // End and start again: the new call starts clean, with no recognizer left running.
  await demo.getByRole("button", { name: "סיום" }).click();
  expect(await page.evaluate(() => (window as unknown as { __active: number }).__active)).toBe(0);
  await demo.getByRole("button", { name: "שיחה חדשה" }).click();
  await expect(demo.getByRole("log").locator("p")).toHaveCount(1);
  await demo.getByRole("button", { name: "סיום" }).click();
  expect(await page.evaluate(() => (window as unknown as { __active: number }).__active)).toBe(0);
});

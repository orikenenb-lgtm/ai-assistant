/**
 * External calendar sync — ARCHITECTURE, NOT LIVE.
 *
 * GoogleCalendarProvider talks to the real Google OAuth 2.0 and Calendar v3
 * REST endpoints, but nothing calls it until (1) GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET are configured for an approved Google Cloud OAuth app
 * and (2) the `calendar.sync` feature flag is enabled. MockCalendarProvider is
 * an in-memory stand-in for tests and local development.
 */

export type CalendarTokens = { accessToken: string; refreshToken: string | null; expiresAt: number; scope: string; accountEmail: string | null };

export type ExternalEvent = {
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  cancelled: boolean;
};

export interface CalendarProvider {
  readonly kind: "google" | "microsoft" | "mock";
  authUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<CalendarTokens>;
  /** Returns a usable access token, refreshing when expired (may return new tokens). */
  ensureFresh(tokens: CalendarTokens): Promise<CalendarTokens>;
  listEvents(tokens: CalendarTokens, range: { from: Date; to: Date }): Promise<ExternalEvent[]>;
  upsertEvent(tokens: CalendarTokens, event: Omit<ExternalEvent, "externalId" | "cancelled"> & { externalId?: string | null }): Promise<string>;
  deleteEvent(tokens: CalendarTokens, externalId: string): Promise<void>;
}

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events openid email";

type FetchLike = typeof fetch;

export class GoogleCalendarProvider implements CalendarProvider {
  readonly kind = "google" as const;
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly http: FetchLike = fetch,
  ) {}

  authUrl(state: string, redirectUri: string) {
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  private async token(body: Record<string, string>) {
    const res = await this.http("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string };
    if (!res.ok || !data.access_token) throw new Error(`google token error: ${data.error ?? res.status}`);
    let email: string | null = null;
    if (data.id_token) {
      try {
        email = (JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64url").toString("utf8")) as { email?: string }).email ?? null;
      } catch {
        email = null;
      }
    }
    return { data, email };
  }

  async exchangeCode(code: string, redirectUri: string): Promise<CalendarTokens> {
    const { data, email } = await this.token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
    return {
      accessToken: data.access_token!,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      scope: data.scope ?? GOOGLE_SCOPE,
      accountEmail: email,
    };
  }

  async ensureFresh(tokens: CalendarTokens): Promise<CalendarTokens> {
    if (tokens.expiresAt - 60_000 > Date.now()) return tokens;
    if (!tokens.refreshToken) throw new Error("google token expired and no refresh token");
    const { data } = await this.token({ refresh_token: tokens.refreshToken, grant_type: "refresh_token" });
    return { ...tokens, accessToken: data.access_token!, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  }

  private async api<T>(tokens: CalendarTokens, path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.http(`https://www.googleapis.com/calendar/v3${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`google calendar error ${res.status}: ${data.error?.message ?? ""}`);
    return data;
  }

  async listEvents(tokens: CalendarTokens, range: { from: Date; to: Date }): Promise<ExternalEvent[]> {
    type GEvent = {
      id: string;
      status?: string;
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    };
    const out: ExternalEvent[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({ timeMin: range.from.toISOString(), timeMax: range.to.toISOString(), singleEvents: "true", maxResults: "250", showDeleted: "true" });
      if (pageToken) p.set("pageToken", pageToken);
      const data = await this.api<{ items?: GEvent[]; nextPageToken?: string }>(tokens, `/calendars/primary/events?${p}`);
      for (const e of data.items ?? []) {
        const allDay = Boolean(e.start?.date);
        const start = e.start?.dateTime ?? e.start?.date;
        const end = e.end?.dateTime ?? e.end?.date;
        if (!start || !end) continue;
        out.push({
          externalId: e.id,
          title: (e.summary ?? "(no title)").slice(0, 300),
          description: e.description?.slice(0, 5000) ?? null,
          location: e.location?.slice(0, 300) ?? null,
          startsAt: new Date(start),
          endsAt: new Date(end),
          allDay,
          cancelled: e.status === "cancelled",
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  async upsertEvent(tokens: CalendarTokens, event: Omit<ExternalEvent, "externalId" | "cancelled"> & { externalId?: string | null }) {
    const body = {
      summary: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start: event.allDay ? { date: event.startsAt.toISOString().slice(0, 10) } : { dateTime: event.startsAt.toISOString() },
      end: event.allDay ? { date: event.endsAt.toISOString().slice(0, 10) } : { dateTime: event.endsAt.toISOString() },
    };
    const res = event.externalId
      ? await this.api<{ id: string }>(tokens, `/calendars/primary/events/${encodeURIComponent(event.externalId)}`, { method: "PUT", body: JSON.stringify(body) })
      : await this.api<{ id: string }>(tokens, `/calendars/primary/events`, { method: "POST", body: JSON.stringify(body) });
    return res.id;
  }

  async deleteEvent(tokens: CalendarTokens, externalId: string) {
    await this.api(tokens, `/calendars/primary/events/${encodeURIComponent(externalId)}`, { method: "DELETE" });
  }
}

/** In-memory provider for tests and local development. Never contacts a network. */
export class MockCalendarProvider implements CalendarProvider {
  readonly kind = "mock" as const;
  readonly events = new Map<string, ExternalEvent>();
  private seq = 0;

  authUrl(state: string, redirectUri: string) {
    return `${redirectUri}?code=mock-code&state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string): Promise<CalendarTokens> {
    if (code !== "mock-code") throw new Error("invalid mock code");
    return { accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 3600_000, scope: "mock", accountEmail: "calendar@example.test" };
  }
  async ensureFresh(tokens: CalendarTokens) {
    return tokens.expiresAt > Date.now() ? tokens : { ...tokens, expiresAt: Date.now() + 3600_000 };
  }
  async listEvents(_tokens: CalendarTokens, range: { from: Date; to: Date }) {
    return [...this.events.values()].filter((e) => e.startsAt < range.to && e.endsAt > range.from);
  }
  async upsertEvent(_tokens: CalendarTokens, event: Omit<ExternalEvent, "externalId" | "cancelled"> & { externalId?: string | null }) {
    const id = event.externalId ?? `mock-${++this.seq}`;
    this.events.set(id, { ...event, externalId: id, cancelled: false });
    return id;
  }
  async deleteEvent(_tokens: CalendarTokens, externalId: string) {
    const e = this.events.get(externalId);
    if (e) this.events.set(externalId, { ...e, cancelled: true });
  }
}

export type ProviderStatus = { provider: "google" | "microsoft"; configured: boolean };

/** Google is available only with OAuth credentials; Microsoft is planned. */
export function calendarProviderStatus(): ProviderStatus[] {
  return [
    { provider: "google", configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
    { provider: "microsoft", configured: false },
  ];
}

export function googleProvider(): GoogleCalendarProvider | null {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return id && secret ? new GoogleCalendarProvider(id, secret) : null;
}

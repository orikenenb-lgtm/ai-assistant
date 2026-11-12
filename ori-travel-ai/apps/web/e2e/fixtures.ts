/* eslint-disable no-empty-pattern -- Playwright fixtures must destructure their first argument */
import { test as base, expect, request as pwRequest, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api } from './api';
import { BASE_URL, OWNER_EMAIL, OWNER_PASSWORD } from './env';

export { expect };

const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth');
const OWNER_STATE = path.join(AUTH_DIR, 'owner.json');

/**
 * Logs the owner in once per worker (through the API, not the UI) and saves the session as a storage state.
 * The login endpoint is rate limited (20/5min per IP), so a valid saved session is reused across runs.
 */
async function ensureOwnerState(): Promise<string> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (fs.existsSync(OWNER_STATE)) {
    const probe = await pwRequest.newContext({ baseURL: BASE_URL, storageState: OWNER_STATE });
    const me = await probe.get('/api/auth/me');
    await probe.dispose();
    if (me.ok()) return OWNER_STATE;
  }
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('/api/auth/login', { data: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  if (!res.ok()) {
    throw new Error(`E2E owner login failed (${res.status()}): ${await res.text()} -- check E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD`);
  }
  await ctx.storageState({ path: OWNER_STATE });
  await ctx.dispose();
  return OWNER_STATE;
}

/**
 * The fare-calendar endpoint is limited to 10 requests / 10 minutes per user, and every flight-results page asks for it.
 * Specs that do not care about the calendar get a 404 stub (the UI then shows its "not available" notice); specs that
 * do (`calendar: 'real'`) hit the real DEMO endpoint, with identical bodies answered from a per-worker cache so a
 * reload or a re-render never spends another request.
 */
export type CalendarMode = 'stub' | 'real';
const calendarCache = new Map<string, string>();

type Fixtures = { api: Api; calendar: CalendarMode; calendarRoute: void };
type WorkerFixtures = { ownerState: string };

/** Test with the owner already signed in (storage state) and an `api` client. */
export const test = base.extend<Fixtures, WorkerFixtures>({
  ownerState: [
    async ({}, run) => {
      await run(await ensureOwnerState());
    },
    { scope: 'worker' },
  ],
  storageState: async ({ ownerState }, run) => {
    await run(ownerState);
  },
  api: async ({ request }, run) => {
    await run(new Api(request));
  },
  calendar: ['stub', { option: true }],
  calendarRoute: [
    async ({ context, calendar }, run) => {
      await context.route('**/api/search/flight/calendar', async (route) => {
        if (calendar === 'stub') {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'stub', details: null, request_id: null } }),
          });
          return;
        }
        const key = route.request().postData() ?? '';
        const hit = calendarCache.get(key);
        if (hit) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: hit });
          return;
        }
        const res = await route.fetch();
        const body = await res.text();
        if (res.status() === 200) calendarCache.set(key, body);
        await route.fulfill({ response: res, body });
      });
      await run();
      await context.unrouteAll({ behavior: 'ignoreErrors' });
    },
    { auto: true },
  ],
});

/** Test with no session at all (login page, redirects, public surface). */
export const anon = base;

/**
 * A second, independent owner session (fresh login, so no "recent re-authentication" yet).
 * Costs one login against the rate limit (10/5min per email) -- use sparingly.
 */
export async function freshOwnerContext(browser: Browser, baseURL: string, viewport: { width: number; height: number }) {
  const api = await pwRequest.newContext({ baseURL });
  const res = await api.post('/api/auth/login', { data: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  if (!res.ok()) throw new Error(`fresh owner login failed (${res.status()}): ${await res.text()}`);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL, locale: 'he-IL', viewport, storageState: state });
}

/** Waits for the SPA shell to have rendered (nav present) and returns. */
export async function appReady(page: Page) {
  await page.waitForSelector('h1', { state: 'attached' });
}

/** True on the mobile (390px) project. */
export const isMobile = (name: string) => name === 'mobile';

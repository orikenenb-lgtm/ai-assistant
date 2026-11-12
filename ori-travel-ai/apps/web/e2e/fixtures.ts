import { test as base, expect, request as pwRequest, type Page } from '@playwright/test';
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

type Fixtures = { api: Api };
type WorkerFixtures = { ownerState: string };

/** Test with the owner already signed in (storage state) and an `api` client. */
export const test = base.extend<Fixtures, WorkerFixtures>({
  ownerState: [
    async ({}, use) => {
      await use(await ensureOwnerState());
    },
    { scope: 'worker' },
  ],
  storageState: async ({ ownerState }, use) => {
    await use(ownerState);
  },
  api: async ({ request }, use) => {
    await use(new Api(request));
  },
});

/** Test with no session at all (login page, redirects, public surface). */
export const anon = base;

/** Waits for the SPA shell to have rendered (nav present) and returns. */
export async function appReady(page: Page) {
  await page.waitForSelector('h1', { state: 'attached' });
}

/** True on the mobile (390px) project. */
export const isMobile = (name: string) => name === 'mobile';

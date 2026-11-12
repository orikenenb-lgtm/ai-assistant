import { request as pwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api } from './api';
import { BASE_URL } from './env';
import { test as ownerTest, expect } from './fixtures';

export { expect };

const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth');
const ADULT_STATE = path.join(AUTH_DIR, 'adult.json');
export const ADULT_EMAIL = 'adult.v6@e2e.local';
export const ADULT_PASSWORD = 'Adult-V6-Pass-12345!x';

/**
 * Searches are limited to 30 / 10 min per USER. The V6 scenarios run with a second signed-in adult (created once
 * through the owner's invitation API, exactly like a family member would be) so they never eat the owner's quota
 * that the older specs rely on. Provider configuration and bookings are family-wide, so both users see the same data.
 */
async function ensureAdultState(ownerState: string): Promise<string> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (fs.existsSync(ADULT_STATE)) {
    const probe = await pwRequest.newContext({ baseURL: BASE_URL, storageState: ADULT_STATE });
    const me = await probe.get('/api/auth/me');
    await probe.dispose();
    if (me.ok()) return ADULT_STATE;
  }
  const owner = await pwRequest.newContext({ baseURL: BASE_URL, storageState: ownerState });
  const csrf = (await owner.storageState()).cookies.find((c) => c.name === 'ori_csrf')?.value ?? '';
  const inv = await owner.post('/api/family/invitations', {
    data: { email: ADULT_EMAIL, display_name: 'מבוגר בדיקות V6', role: 'adult', legal_adult_attested: true },
    headers: { 'X-CSRF-Token': csrf },
  });
  if (!inv.ok()) {
    await owner.dispose();
    throw new Error(`adult invitation failed (${inv.status()}): ${await inv.text()}`);
  }
  const token = ((await inv.json()).invite_path as string).split(/[/#]/).pop()!;
  await owner.dispose();
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  const acc = await ctx.post('/api/auth/invitations/accept', { data: { token, password: ADULT_PASSWORD } });
  if (!acc.ok()) throw new Error(`adult accept failed (${acc.status()}): ${await acc.text()}`);
  await ctx.storageState({ path: ADULT_STATE });
  await ctx.dispose();
  return ADULT_STATE;
}

type Fixtures = { ownerApi: Api };
type WorkerFixtures = { adultState: string };

/** Signed in as the second adult; `ownerApi` is an API client for the owner (providers, family admin). */
export const test = ownerTest.extend<Fixtures, WorkerFixtures>({
  adultState: [
    async ({ ownerState }, run) => {
      await run(await ensureAdultState(ownerState));
    },
    { scope: 'worker' },
  ],
  storageState: async ({ adultState }, run) => {
    await run(adultState);
  },
  ownerApi: async ({ ownerState }, run) => {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL, storageState: ownerState });
    await run(new Api(ctx));
    await ctx.dispose();
  },
});

import { request } from '@playwright/test';
const c = await request.newContext({ baseURL: 'http://127.0.0.1:8061' });
const r = await c.post('/api/auth/login', { data: { email: 'owner@e2e.local', password: 'E2E-Owner-Pass-123' } });
console.log(r.status());
await c.storageState({ path: 'e2e/.auth/owner.json' });

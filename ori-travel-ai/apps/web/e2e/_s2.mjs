import { chromium } from '@playwright/test';
import fs from 'fs';
const b = await chromium.launch();
const ctx = await b.newContext({ baseURL: 'http://127.0.0.1:8061', locale: 'he-IL', viewport:{width:1440,height:900} });
const p = await ctx.newPage();
await p.goto('/login');
await p.getByLabel('אימייל').fill('owner@e2e.local');
await p.getByLabel('סיסמה').first().fill('E2E-Owner-Pass-123');
await p.getByRole('button',{name:'כניסה'}).click();
await p.waitForURL('**/');
const code = fs.readFileSync(process.argv[2],'utf8');
const fn = new (Object.getPrototypeOf(async function(){}).constructor)('p','ctx', code);
try { await fn(p, ctx); } catch(e){ console.log('ERR', e.message.slice(0,500)); }
await b.close();

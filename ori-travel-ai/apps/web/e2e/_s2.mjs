import { chromium } from '@playwright/test';
import fs from 'fs';
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: 'e2e/.auth/owner.json', baseURL: 'http://127.0.0.1:8061', locale: 'he-IL', viewport:{width:1440,height:900} });
const p = await ctx.newPage();
const code = fs.readFileSync(process.argv[2],'utf8');
const fn = new (Object.getPrototypeOf(async function(){}).constructor)('p','ctx', code);
try { await fn(p, ctx); } catch(e){ console.log('ERR', e.message.slice(0,500)); }
await b.close();

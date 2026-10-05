import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LauncherService, ToolDefinition } from '../../../src/main/core/contracts';
import { createLauncherService } from '../../../src/main/launcher/launcher';
import { createLauncherTools } from '../../../src/main/tools/launcher-tools';
import type { ToolResult } from '../../../src/shared/types';
import {
  EPLAN_EXE,
  FINAL_ELK,
  configuredSettings,
  mockAdapter,
  mockLogger,
  mockStat,
  mockToolContext,
  settingsWith,
} from './local-tools.mock';

const OK: ToolResult = { ok: true, status: 'success', summary_he: 'MOCK' };

function mockLauncher(): LauncherService & {
  openApplication: ReturnType<typeof vi.fn>;
  openProject: ReturnType<typeof vi.fn>;
} {
  return {
    openApplication: vi.fn(async () => OK),
    openProject: vi.fn(async () => OK),
    validatePath: vi.fn(),
    detectApps: vi.fn(async () => []),
  } as unknown as LauncherService & { openApplication: ReturnType<typeof vi.fn>; openProject: ReturnType<typeof vi.fn> };
}

function tools(launcher: LauncherService, settings = configuredSettings()) {
  const [openApp, openProject] = createLauncherTools(launcher, () => settings) as [ToolDefinition<unknown>, ToolDefinition<unknown>];
  return { openApp: openApp!, openProject: openProject!, settings };
}

describe('launcher tools: definitions', () => {
  it('declares names, risk, side effects and the 15s dedupe window', () => {
    const { openApp, openProject } = tools(mockLauncher());
    expect(openApp.name).toBe('open_application');
    expect(openProject.name).toBe('open_project');
    for (const t of [openApp, openProject]) {
      expect(t.risk).toBe('low');
      expect(t.sideEffect).toBe(true);
      expect(t.dedupeWindowMs).toBe(15_000);
      expect(t.description).toMatch(/[\u05d0-\u05ea]/); // דוגמאות בעברית
    }
  });

  it('input schemas are strict: no paths, args or extra fields can be smuggled in', () => {
    const { openApp, openProject } = tools(mockLauncher());
    expect(openApp.inputSchema.safeParse({ app_id: 'eplan' }).success).toBe(true);
    expect(openApp.inputSchema.safeParse({}).success).toBe(true); // נאכף בתוך execute
    expect(openApp.inputSchema.safeParse({ app_id: 'eplan', args: ['/x'] }).success).toBe(false);
    expect(openApp.inputSchema.safeParse({ app_id: 'eplan', path: 'C:\\x.exe' }).success).toBe(false);
    expect(openApp.inputSchema.safeParse({ app_id: 'x'.repeat(41) }).success).toBe(false);
    expect(openApp.inputSchema.safeParse({ app_name: 'x'.repeat(81) }).success).toBe(false);
    expect(openProject.inputSchema.safeParse({}).success).toBe(true);
    expect(openProject.inputSchema.safeParse({ project_id: 'final-project', file: 'x' }).success).toBe(false);
    const json = z.toJSONSchema(openApp.inputSchema, { io: 'input' }) as { additionalProperties?: unknown };
    expect(json.additionalProperties).toBe(false);
  });

  it('Hebrew titles and approval texts are built from settings, not from model text', () => {
    const { openApp, openProject, settings } = tools(mockLauncher());
    expect(openApp.title({ app_id: 'eplan' }, settings)).toBe('פתיחת תוכנה: EPLAN');
    expect(openApp.title({ app_name: 'אי פלאן' }, settings)).toBe('פתיחת תוכנה: EPLAN');
    expect(openProject.title({}, settings)).toBe('פתיחת פרויקט: פרויקט הגמר');
    expect(openProject.title({ project_name: 'פרויקט הגמר' }, settings)).toBe('פתיחת פרויקט: פרויקט הגמר');

    const appApproval = openApp.describeForApproval({ app_id: 'eplan' }, settings);
    expect(appApproval.action_he).toBe('פתיחת התוכנה EPLAN');
    expect(appApproval.target_he).toBe(EPLAN_EXE);
    const projectApproval = openProject.describeForApproval({}, settings);
    expect(projectApproval.action_he).toBe('פתיחת הפרויקט פרויקט הגמר');
    expect(projectApproval.target_he).toBe(FINAL_ELK);
    expect(projectApproval.impact_he).toContain('לא כותב');

    const unknown = openApp.describeForApproval({ app_name: 'cmd.exe /c del \u202e' }, settings);
    expect(unknown.target_he).toContain('לא נמצאה ברשימת התוכנות המאושרות');
    expect(unknown.target_he).not.toContain('\u202e'); // תווי כיווניות מוסרים מתצוגה
  });
});

describe('launcher tools: execute', () => {
  it('open_application without app_id and app_name → INVALID_PARAMS, launcher not called (mock)', async () => {
    const launcher = mockLauncher();
    const { openApp } = tools(launcher);
    for (const input of [{}, { app_id: '  ' }, { app_name: '' }]) {
      const res = await openApp.execute(input, mockToolContext());
      expect(res.error_code).toBe('INVALID_PARAMS');
      expect(res.summary_he).toMatch(/[\u05d0-\u05ea]/);
    }
    expect(launcher.openApplication).not.toHaveBeenCalled();
  });

  it('forwards only trimmed app_id/app_name and the settings snapshot shown at approval time (ctx.settings) (mock)', async () => {
    const launcher = mockLauncher();
    const { openApp, settings } = tools(launcher);
    await openApp.execute({ app_id: ' eplan ' }, mockToolContext({ settings }));
    expect(launcher.openApplication).toHaveBeenCalledWith({ app_id: 'eplan' }, settings);
  });

  it('open_project with no arguments asks the service for the default project (mock)', async () => {
    const launcher = mockLauncher();
    const { openProject, settings } = tools(launcher);
    await openProject.execute({}, mockToolContext({ settings }));
    expect(launcher.openProject).toHaveBeenCalledWith({}, settings);
  });

  it('a cancelled turn does nothing (mock)', async () => {
    const launcher = mockLauncher();
    const { openApp, openProject } = tools(launcher);
    const ac = new AbortController();
    ac.abort();
    expect((await openApp.execute({ app_id: 'eplan' }, mockToolContext({ signal: ac.signal }))).status).toBe('cancelled');
    expect((await openProject.execute({}, mockToolContext({ signal: ac.signal }))).status).toBe('cancelled');
    expect(launcher.openApplication).not.toHaveBeenCalled();
    expect(launcher.openProject).not.toHaveBeenCalled();
  });

  it('end-to-end with the real service and a MOCK adapter: EPLAN is spawned, the project is opened via openPath (mock)', async () => {
    const adapter = mockAdapter();
    const launcher = createLauncherService({
      adapter,
      stat: mockStat({ [EPLAN_EXE]: 'file', [FINAL_ELK]: 'file' }),
      realpath: async (p) => p,
      logger: mockLogger(),
    });
    const { openApp, openProject, settings } = tools(launcher);
    const a = await openApp.execute({ app_name: 'איפלאן' }, mockToolContext({ settings }));
    expect(a.ok).toBe(true);
    const p = await openProject.execute({ project_name: 'הפרויקט שלי' }, mockToolContext({ settings }));
    expect(p.ok).toBe(true);
    expect(adapter.calls.spawn.map((c) => c.file)).toEqual([EPLAN_EXE]);
    expect(adapter.calls.openPath).toEqual([FINAL_ELK]);
  });

  it('end-to-end: an unconfigured EPLAN yields the NOT_CONFIGURED guidance (mock)', async () => {
    const adapter = mockAdapter();
    const launcher = createLauncherService({ adapter, stat: mockStat({}), logger: mockLogger() });
    const { openApp, settings } = tools(launcher, settingsWith());
    const res = await openApp.execute({ app_id: 'eplan' }, mockToolContext({ settings }));
    expect(res.error_code).toBe('NOT_CONFIGURED');
    expect(adapter.totalCalls()).toBe(0);
  });
});

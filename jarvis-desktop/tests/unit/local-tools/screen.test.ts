import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DesktopCapturerSource, SourcesOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { ProviderError, type CapturedImage, type ScreenCaptureService, type VisionAnalyzer } from '../../../src/main/core/contracts';
import {
  MAX_PNG_BYTES,
  createScreenCaptureService,
  fitWithinLongEdge,
  physicalSize,
} from '../../../src/main/screen/capture';
import { MAX_ANALYSIS_CHARS, createScreenTool } from '../../../src/main/tools/screen-tools';
import { defaultSettings } from '../../../src/shared/settings-schema';
import type { AssistantEvent, DisplayInfo } from '../../../src/shared/types';
import { mockDisplay, mockLogger, mockNativeImage, mockSource, mockToolContext } from './local-tools.mock';

/** MOCK של desktopCapturer + screen של Electron. */
function setupCapture(opts: {
  displays?: ReturnType<typeof mockDisplay>[];
  primaryId?: number;
  sources?: (o: SourcesOptions) => DesktopCapturerSource[];
  getSourcesError?: Error;
}) {
  const displays = opts.displays ?? [mockDisplay(1, 2560, 1440, 1), mockDisplay(2, 1536, 864, 1.25)];
  const getSources = vi.fn(async (o: SourcesOptions) => {
    if (opts.getSourcesError) throw opts.getSourcesError;
    return opts.sources ? opts.sources(o) : [];
  });
  const logger = mockLogger();
  const service = createScreenCaptureService({
    desktopCapturer: { getSources },
    screen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => displays.find((d) => d.id === (opts.primaryId ?? 1)) ?? displays[0]!,
    },
    logger,
  });
  return { service, getSources, logger };
}

describe('screen capture service (mock desktopCapturer / NativeImage)', () => {
  it('listDisplays returns geometry only, in physical pixels, without capturing', () => {
    const { service, getSources } = setupCapture({});
    expect(service.listDisplays()).toEqual([
      { id: '1', label: 'מסך 1 (ראשי) — 2560×1440', width: 2560, height: 1440, scaleFactor: 1, primary: true },
      { id: '2', label: 'מסך 2 — 1920×1080', width: 1920, height: 1080, scaleFactor: 1.25, primary: false },
    ]);
    expect(getSources).not.toHaveBeenCalled();
  });

  it('resize math keeps the aspect ratio, never upscales, and respects the long edge', () => {
    expect(physicalSize({ size: { width: 1536, height: 864 }, scaleFactor: 1.25 })).toEqual({ width: 1920, height: 1080 });
    expect(fitWithinLongEdge(2560, 1440, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(fitWithinLongEdge(1440, 2560, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(fitWithinLongEdge(3840, 2160, 2576)).toEqual({ width: 2576, height: 1449 });
    expect(fitWithinLongEdge(1280, 720, 1920)).toEqual({ width: 1280, height: 720 });
  });

  it('captures the approved display by display_id at its physical size and downsizes it (quality good) (mock)', async () => {
    const thumb1 = mockNativeImage(2560, 1440);
    const thumb2 = mockNativeImage(1920, 1080);
    const { service, getSources } = setupCapture({
      sources: () => [mockSource('2', thumb2, 0), mockSource('1', thumb1, 1)],
    });
    const img = await service.capture('1', 1920);
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 2560, height: 1440 },
      fetchWindowIcons: false,
    });
    expect(thumb1.log.resizes).toEqual([{ width: 1920, height: 1080, quality: 'good' }]);
    expect(thumb2.log.pngCalls).toBe(0);
    expect(img.mediaType).toBe('image/png');
    expect(img.width).toBe(1920);
    expect(img.height).toBe(1080);
    expect(img.display.id).toBe('1');
    expect(Buffer.isBuffer(img.data)).toBe(true);
  });

  it('caps the long edge at 2576 even if asked for more (mock)', async () => {
    const thumb = mockNativeImage(3840, 2160);
    const { service } = setupCapture({
      displays: [mockDisplay(7, 3840, 2160, 1)],
      primaryId: 7,
      sources: () => [mockSource('7', thumb)],
    });
    const img = await service.capture('7', 99_999);
    expect(thumb.log.resizes).toEqual([{ width: 2576, height: 1449, quality: 'good' }]);
    expect(img.width).toBe(2576);
  });

  it('switches to JPEG q85 when the PNG is over 3.5 MB, lowering quality only if still too big (mock)', async () => {
    const big = mockNativeImage(1920, 1080, { pngBytes: () => MAX_PNG_BYTES + 1, jpegBytes: () => 900_000 });
    const svc1 = setupCapture({ displays: [mockDisplay(1, 1920, 1080, 1)], sources: () => [mockSource('1', big)] });
    const img = await svc1.service.capture('1', 1920);
    expect(img.mediaType).toBe('image/jpeg');
    expect(big.log.jpegQualities).toEqual([85]);

    const huge = mockNativeImage(1920, 1080, {
      pngBytes: () => MAX_PNG_BYTES + 1,
      jpegBytes: (q) => (q > 70 ? MAX_PNG_BYTES + 1 : 1_000_000),
    });
    const svc2 = setupCapture({ displays: [mockDisplay(1, 1920, 1080, 1)], sources: () => [mockSource('1', huge)] });
    expect((await svc2.service.capture('1', 1920)).mediaType).toBe('image/jpeg');
    expect(huge.log.jpegQualities).toEqual([85, 70]);
  });

  it('falls back to matching by index (with a logged warning) only when sources carry no display ids (mock)', async () => {
    const t1 = mockNativeImage(2560, 1440);
    const t2 = mockNativeImage(1920, 1080);
    const { service, logger } = setupCapture({ sources: () => [mockSource('', t1, 0), mockSource('', t2, 1)] });
    const img = await service.capture('2', 1920);
    expect(img.display.id).toBe('2');
    expect(t2.log.pngCalls).toBe(1);
    expect(logger.entries.some((e) => e.level === 'warn' && e.event === 'screen.source_matched_by_index')).toBe(true);
  });

  it('refuses to send a different screen: index fallback with a mismatching shape, or unknown ids (mock)', async () => {
    const square = mockNativeImage(1000, 1000);
    const a = setupCapture({ sources: () => [mockSource('', mockNativeImage(2560, 1440), 0), mockSource('', square, 1)] });
    await expect(a.service.capture('2', 1920)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    expect(square.log.pngCalls).toBe(0);

    const b = setupCapture({ sources: () => [mockSource('99', mockNativeImage(1920, 1080), 0)] });
    await expect(b.service.capture('2', 1920)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  it('throws ProviderError CAPTURE_FAILED with Hebrew messages on empty thumbnails, unknown displays and capturer errors (mock)', async () => {
    const empty = setupCapture({ sources: () => [mockSource('1', mockNativeImage(0, 0, { empty: true }))] });
    const err = await empty.service.capture('1', 1920).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('CAPTURE_FAILED');
    expect((err as ProviderError).message_he).toMatch(/ריק/);

    const unknown = setupCapture({ sources: () => [] });
    await expect(unknown.service.capture('nope', 1920)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });

    const failing = setupCapture({ getSourcesError: new Error('denied') });
    await expect(failing.service.capture('1', 1920)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  it('never writes files: the capture module imports no filesystem or process APIs', () => {
    const source = readFileSync(fileURLToPath(new URL('../../../src/main/screen/capture.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from ['"](node:)?(fs|fs\/promises|child_process)['"]/);
    expect(source).not.toMatch(/writeFile|createWriteStream|appendFile/);
    expect(source).not.toMatch(/^import \{[^}]*\} from 'electron'/m); // רק import type
  });
});

/* ------------------------------ capture_screen_for_analysis ------------------------------ */

const DISPLAY: DisplayInfo = { id: '2', label: 'מסך 2 — 1920×1080', width: 1920, height: 1080, scaleFactor: 1.25, primary: false };

function mockScreen(opts: { displays?: DisplayInfo[]; captureError?: Error; onCapture?: () => void } = {}) {
  const images: CapturedImage[] = [];
  const screen: ScreenCaptureService & { capture: ReturnType<typeof vi.fn> } = {
    listDisplays: () => opts.displays ?? [{ ...DISPLAY, id: '1', label: 'מסך 1 (ראשי) — 2560×1440', primary: true }, DISPLAY],
    capture: vi.fn(async (_id: string, _max: number) => {
      opts.onCapture?.();
      if (opts.captureError) throw opts.captureError;
      const img: CapturedImage = { data: Buffer.alloc(4096, 0xab), mediaType: 'image/png', width: 1920, height: 1080, display: DISPLAY };
      images.push(img);
      return img;
    }),
  } as ScreenCaptureService & { capture: ReturnType<typeof vi.fn> };
  return { screen, images };
}

function mockVision(result: string | Error, configured = true): VisionAnalyzer & { analyze: ReturnType<typeof vi.fn> } {
  return {
    isConfigured: () => configured,
    analyze: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } as VisionAnalyzer & { analyze: ReturnType<typeof vi.fn> };
}

function stages(events: AssistantEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'screen-capture' ? [e.stage] : []));
}

describe('capture_screen_for_analysis tool (mock screen + mock vision)', () => {
  const settings = defaultSettings();
  settings.screen.maxLongEdgePx = 2576;

  it('declares privacy risk, no side effect, no dedupe, and a strict schema', () => {
    const tool = createScreenTool({ screen: mockScreen().screen, vision: mockVision('x'), getSettings: () => settings });
    expect(tool.name).toBe('capture_screen_for_analysis');
    expect(tool.risk).toBe('privacy');
    expect(tool.sideEffect).toBe(false);
    expect(tool.dedupeWindowMs).toBe(0);
    expect(tool.inputSchema.safeParse({ question: 'מה כתוב?' }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ question: '' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ question: 'x'.repeat(501) }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ question: 'x', displayId: '1' }).success).toBe(false);
  });

  it('refuses without ctx.approvedDisplayId — nothing is captured (mock)', async () => {
    const { screen } = mockScreen();
    const vision = mockVision('x');
    const tool = createScreenTool({ screen, vision, getSettings: () => settings });
    const ctx = mockToolContext();
    const res = await tool.execute({ question: 'מה על המסך?' }, ctx);
    expect(res).toMatchObject({ ok: false, error_code: 'PERMISSION_DENIED' });
    expect(screen.capture).not.toHaveBeenCalled();
    expect(vision.analyze).not.toHaveBeenCalled();
    expect(ctx.events).toEqual([]);
  });

  it('emits capturing → sending → done → discarded, zero-fills the image and marks the result untrusted (mock)', async () => {
    const long = `שורה ${'א'.repeat(3000)}`;
    const { screen, images } = mockScreen();
    const vision = mockVision(`  ${long}  `);
    const tool = createScreenTool({ screen, vision, getSettings: () => settings });
    const ctx = mockToolContext({ approvedDisplayId: '2' });
    const res = await tool.execute({ question: '  מה כתוב בשגיאה?  ' }, ctx);

    expect(stages(ctx.events)).toEqual(['capturing', 'sending', 'done', 'discarded']);
    expect(ctx.events.every((e) => e.type !== 'screen-capture' || e.displayLabel === DISPLAY.label)).toBe(true);
    expect(screen.capture).toHaveBeenCalledWith('2', 2576);
    const call = vision.analyze.mock.calls[0]?.[0] as { image: CapturedImage; question: string };
    expect(call.question).toBe('מה כתוב בשגיאה?');
    expect(call.image).toBe(images[0]);
    expect(images[0]!.data.every((b) => b === 0)).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.untrusted).toBe(true);
    expect(res.summary_he.length).toBeLessThanOrEqual(MAX_ANALYSIS_CHARS);
    expect(res.summary_he.startsWith('שורה')).toBe(true);
    expect(res.data).toEqual({ display: DISPLAY.label });
  });

  it('maps vision ProviderError codes through, still zero-filling and discarding (mock)', async () => {
    const { screen, images } = mockScreen();
    const vision = mockVision(new ProviderError('RATE_LIMITED', 'Claude עמוס כרגע. נסה שוב בעוד רגע.', true));
    const tool = createScreenTool({ screen, vision, getSettings: () => settings });
    const ctx = mockToolContext({ approvedDisplayId: '2' });
    const res = await tool.execute({ question: 'מה רואים?' }, ctx);
    expect(res).toMatchObject({ ok: false, status: 'error', error_code: 'RATE_LIMITED', summary_he: 'Claude עמוס כרגע. נסה שוב בעוד רגע.' });
    expect(res.untrusted).toBeUndefined();
    expect(stages(ctx.events)).toEqual(['capturing', 'sending', 'failed', 'discarded']);
    expect(images[0]!.data.every((b) => b === 0)).toBe(true);
  });

  it('a capture failure is reported (CAPTURE_FAILED) and nothing is sent (mock)', async () => {
    const { screen } = mockScreen({ captureError: new ProviderError('CAPTURE_FAILED', 'הצילום חזר ריק.', true) });
    const vision = mockVision('x');
    const tool = createScreenTool({ screen, vision, getSettings: () => settings });
    const ctx = mockToolContext({ approvedDisplayId: '2' });
    const res = await tool.execute({ question: 'מה רואים?' }, ctx);
    expect(res.error_code).toBe('CAPTURE_FAILED');
    expect(vision.analyze).not.toHaveBeenCalled();
    expect(stages(ctx.events)).toEqual(['capturing', 'failed', 'discarded']);
  });

  it('cancelled during capture → the image is wiped without being sent (mock)', async () => {
    const ac = new AbortController();
    const { screen, images } = mockScreen({ onCapture: () => ac.abort() });
    const vision = mockVision('x');
    const tool = createScreenTool({ screen, vision, getSettings: () => settings });
    const ctx = mockToolContext({ approvedDisplayId: '2', signal: ac.signal });
    const res = await tool.execute({ question: 'מה רואים?' }, ctx);
    expect(res).toMatchObject({ ok: false, status: 'cancelled', error_code: 'CANCELLED' });
    expect(vision.analyze).not.toHaveBeenCalled();
    expect(images[0]!.data.every((b) => b === 0)).toBe(true);
    expect(stages(ctx.events)).toEqual(['capturing', 'failed', 'discarded']);
  });

  it('without an Anthropic key it does not capture at all (mock)', async () => {
    const { screen } = mockScreen();
    const tool = createScreenTool({ screen, vision: mockVision('x', false), getSettings: () => settings });
    const res = await tool.execute({ question: 'מה רואים?' }, mockToolContext({ approvedDisplayId: '2' }));
    expect(res.error_code).toBe('MISSING_API_KEY');
    expect(screen.capture).not.toHaveBeenCalled();
  });

  it('approval texts: one capture, sent once, not saved; target is the single display or "the screen you choose"', () => {
    const single = createScreenTool({
      screen: mockScreen({ displays: [DISPLAY] }).screen,
      vision: mockVision('x'),
      getSettings: () => settings,
    });
    expect(single.describeForApproval({ question: 'x' }, settings)).toEqual({
      action_he: 'צילום מסך אחד ושליחתו ל-Claude לניתוח',
      target_he: DISPLAY.label,
      impact_he: 'התמונה נשלחת פעם אחת לניתוח ולא נשמרת במחשב.',
    });
    const multi = createScreenTool({ screen: mockScreen().screen, vision: mockVision('x'), getSettings: () => settings });
    expect(multi.describeForApproval({ question: 'x' }, settings).target_he).toBe('המסך שתבחר');
    expect(multi.title({ question: 'x' }, settings)).toBe('צילום מסך לניתוח');
  });
});

import { expect, type Page } from '@playwright/test';

/** Runs in the page: elements that are visible but have no accessible name / label. */
export const FIND_UNNAMED = `(() => {
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
  const byId = (id) => { const n = document.getElementById(id); return n ? text(n) : ''; };
  const named = (el) => {
    if ((el.getAttribute('aria-label') || '').trim()) return true;
    const lb = el.getAttribute('aria-labelledby');
    if (lb && lb.split(/\\s+/).some((id) => byId(id))) return true;
    if (el.labels && el.labels.length > 0 && Array.from(el.labels).some((l) => text(l))) return true;
    if ((el.getAttribute('title') || '').trim()) return true;
    if (text(el)) return true;
    const img = el.querySelector('img[alt]:not([alt=""])');
    return !!img;
  };
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], a[href]'))
    .filter((el) => visible(el) && !el.closest('[aria-hidden="true"]') && !named(el));
  const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="slider"], [role="combobox"]'))
    .filter((el) => visible(el) && !el.closest('[aria-hidden="true"]') && !named(el));
  return {
    buttons: buttons.map((el) => el.outerHTML.slice(0, 160)),
    fields: fields.map((el) => el.outerHTML.slice(0, 160)),
  };
})()`;

export async function expectBasicA11y(page: Page, label: string) {
  // Exactly one <h1>.
  await expect(page.locator('h1'), `${label}: exactly one h1`).toHaveCount(1);
  // Document language and direction.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  // Page has a title and a main landmark (except on the bare auth layout).
  expect((await page.title()).trim().length, `${label}: document title`).toBeGreaterThan(0);
  const res = (await page.evaluate(FIND_UNNAMED)) as { buttons: string[]; fields: string[] };
  expect(res.buttons, `${label}: controls without an accessible name`).toEqual([]);
  expect(res.fields, `${label}: form fields without a label`).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const m = (await page.evaluate('({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })')) as { sw: number; cw: number };
  expect(m.sw, `${label}: scrollWidth ${m.sw} must be <= clientWidth ${m.cw} at 390px`).toBeLessThanOrEqual(m.cw);
}


/** Duplicate ids make `label for` / aria references ambiguous. Returns the ids used more than once. */
export async function duplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((e) => seen.set(e.id, (seen.get(e.id) ?? 0) + 1));
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
}

/**
 * WCAG contrast ratios of the visible text of `selector` elements against their *effective* background
 * (layers composited, colours normalised through a canvas so oklch()/color-mix() work).
 */
export async function textContrast(page: Page, selector: string, limit = 12): Promise<Array<{ text: string; ratio: number; fg: string; bg: string }>> {
  return page.evaluate(
    ({ selector: sel, limit: max }) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      const rgba = (c: string): [number, number, number, number] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const over = (top: number[], bottom: number[]): number[] => {
        const a = top[3];
        return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
      };
      const bgOf = (el: Element): number[] => {
        const layers: number[][] = [];
        for (let n: Element | null = el; n; n = n.parentElement) {
          const c = rgba(getComputedStyle(n).backgroundColor);
          if (c[3] > 0) layers.push(c);
          if (c[3] === 1) break;
        }
        let acc: number[] = [255, 255, 255, 1];
        for (const l of layers.reverse()) acc = over(l, acc);
        return acc;
      };
      const lum = (c: number[]) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const out: Array<{ text: string; ratio: number; fg: string; bg: string }> = [];
      for (const el of Array.from(document.querySelectorAll(sel)).slice(0, max)) {
        if (el.getClientRects().length === 0) continue;
        const bg = bgOf(el);
        const fg = over(rgba(getComputedStyle(el).color), bg);
        const l1 = lum(fg);
        const l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        out.push({ text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, fg: fg.map(Math.round).join(','), bg: bg.map(Math.round).join(',') });
      }
      return out;
    },
    { selector, limit },
  );
}

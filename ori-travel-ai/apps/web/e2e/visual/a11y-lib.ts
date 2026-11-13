/**
 * In-page audit functions (plain strings evaluated in the browser) used by the a11y.*.spec.ts files.
 * No axe available: everything is computed from the DOM + computed styles.
 */

/** Visible text nodes -> WCAG contrast ratio (fg composited over the effective background). Returns all samples sorted worst first. */
export const CONTRAST_JS = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (css) => { cx.clearRect(0,0,1,1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return d[3] === 0 && !/transparent|rgba\\(0, 0, 0, 0\\)/.test(css) ? [d[0],d[1],d[2],d[3]/255] : [d[0],d[1],d[2],d[3]/255]; };
  const lin = (c) => { c/=255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  const lum = (r,g,b) => 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  const over = (top, bot) => { const a = top[3]; return [top[0]*a+bot[0]*(1-a), top[1]*a+bot[1]*(1-a), top[2]*a+bot[2]*(1-a), 1]; };
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || +s.opacity === 0) return false; if (e.getAttribute('aria-hidden') === 'true' && !e.closest('svg')) return false; } return true; };
  const offscreen = (el) => { const r = el.getBoundingClientRect(); return r.right < 0 || r.bottom < 0 || r.left > innerWidth + 1 || (r.top > 100000); };
  const sel = (el) => { const parts = []; for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) { let s = e.tagName.toLowerCase(); const t = e.getAttribute('data-testid'); if (t) { s += '[data-testid=' + t + ']'; parts.unshift(s); break; } if (e.id) { s += '#' + e.id; parts.unshift(s); break; } const c = (e.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0,2).join('.'); if (c) s += '.' + c; parts.unshift(s); } return parts.join(' > '); };
  const effBg = (el) => {
    const stack = []; let img = false;
    for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); stack.push(parse(s.backgroundColor)); if (s.backgroundImage && s.backgroundImage !== 'none') img = true; if (parse(s.backgroundColor)[3] >= 1) break; }
    let bg = parse(getComputedStyle(document.body).backgroundColor); if (bg[3] < 1) bg = over(bg, [255,255,255,1]);
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return { bg, img };
  };
  const effOpacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set(); let n;
  while ((n = walker.nextNode())) {
    const text = (n.textContent || '').replace(/\\s+/g, ' ').trim(); if (!text) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue;
    if (['SCRIPT','STYLE','NOSCRIPT','OPTION'].includes(el.tagName) || el.closest('svg')) continue;
    if (!visible(el) || offscreen(el)) continue;
    if (el.closest('[disabled],[aria-disabled="true"]')) continue; // disabled controls are exempt (WCAG 1.4.3)
    seen.add(el);
    const s = getComputedStyle(el);
    const { bg, img } = effBg(el);
    let fg = parse(s.color); const op = effOpacity(el); fg = [fg[0],fg[1],fg[2],fg[3]*op];
    const fgc = over(fg, bg);
    const L1 = lum(fgc[0],fgc[1],fgc[2]), L2 = lum(bg[0],bg[1],bg[2]);
    const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight,10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const hex = (c) => '#' + c.slice(0,3).map((v) => Math.round(v).toString(16).padStart(2,'0')).join('');
    out.push({ ratio: Math.round(ratio*100)/100, required: large ? 3 : 4.5, text: text.slice(0,50), selector: sel(el), fg: hex(fgc), bg: hex(bg), size, bold, bgImage: img });
  }
  out.sort((a,b) => (a.ratio - a.required) - (b.ratio - b.required));
  return out;
})()`;

export interface ContrastSample {
  ratio: number; required: number; text: string; selector: string; fg: string; bg: string; size: number; bold: boolean; bgImage: boolean;
}

/** Interactive elements smaller than 44x44 CSS px (excluding inline text links, per WCAG 2.5.8 inline exception). */
export const TOUCH_JS = `(() => {
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=combobox], [role=slider]';
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  const name = (el) => { const parts = []; for (let e = el; e && e.nodeType === 1 && parts.length < 3; e = e.parentElement) { let s = e.tagName.toLowerCase(); const t = e.getAttribute('data-testid'); if (t) { parts.unshift(s + '[data-testid=' + t + ']'); break; } const c = (e.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0,2).join('.'); parts.unshift(s + (c ? '.' + c : '')); } return parts.join(' > '); };
  const inlineLink = (el) => { if (el.tagName !== 'A') return false; const p = el.parentElement; if (!p) return false; const own = Array.from(p.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim().length > 2); return own.length > 0 && getComputedStyle(el).display === 'inline'; };
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.matches(':disabled')) continue;
    let r = el.getBoundingClientRect();
    // sr-only native inputs (checkbox/radio/switch) are operated through their visible label/wrapper
    if ((el.type === 'checkbox' || el.type === 'radio') && (el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')))) { const lab = el.closest('label') || document.querySelector('label[for="' + el.id + '"]'); const lr = lab.getBoundingClientRect(); if (lr.width * lr.height > r.width * r.height) r = lr; }
    if (r.width <= 2 || r.height <= 2) { const lab = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')); if (lab) r = lab.getBoundingClientRect(); }
    // .touch-target grows the hit area with an ::after pseudo-element on (pointer: coarse) -- count it.
    let ew = r.width, eh = r.height;
    const ps = getComputedStyle(el, '::after');
    if (ps.content !== 'none' && ps.position === 'absolute') { ew = Math.max(ew, parseFloat(ps.width) || 0); eh = Math.max(eh, parseFloat(ps.height) || 0); }
    if (r.right < -1 || r.left > innerWidth + 1) continue; // inside a horizontally scrolled strip, off the visible area
    if (inlineLink(el)) continue;
    if (el.matches('a.sr-only, a[href^="#"]') && r.top < 0) continue; // skip link
    if (ew + 0.5 < 44 || eh + 0.5 < 44) out.push({ selector: name(el), w: Math.round(ew*10)/10, h: Math.round(eh*10)/10, text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').replace(/\\s+/g,' ').trim().slice(0,40) });
  }
  return out;
})()`;

export interface TouchViolation { selector: string; w: number; h: number; text: string }

/** Landmarks, headings, names, labels. */
export const STRUCTURE_JS = `(() => {
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
  const byId = (id) => { const n = document.getElementById(id); return n ? text(n) : ''; };
  const named = (el) => {
    if ((el.getAttribute('aria-label') || '').trim()) return true;
    const lb = el.getAttribute('aria-labelledby'); if (lb && lb.split(/\\s+/).some((id) => byId(id))) return true;
    if (el.labels && el.labels.length && Array.from(el.labels).some((l) => text(l))) return true;
    if ((el.getAttribute('title') || '').trim()) return true;
    if (text(el)) return true;
    if (el.querySelector('img[alt]:not([alt=""])')) return true;
    return false;
  };
  const d = (el) => el.outerHTML.slice(0, 140);
  const interactive = Array.from(document.querySelectorAll('button, [role=button], [role=switch], [role=tab], [role=radio], [role=menuitem], a[href], summary')).filter((el) => visible(el) && !el.closest('[aria-hidden="true"]'));
  const fields = Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea, [role=slider], [role=combobox]')).filter((el) => visible(el) && !el.closest('[aria-hidden="true"]'));
  const lm = (r) => Array.from(document.querySelectorAll(r)).filter(visible).length;
  const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible).map((h) => +h.tagName[1]);
  let skips = 0; for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i-1] > 1) skips++;
  const imgs = Array.from(document.querySelectorAll('img')).filter((i) => visible(i) && !i.hasAttribute('alt')).map(d);
  const dupIds = (() => { const m = {}; document.querySelectorAll('[id]').forEach((e) => { m[e.id] = (m[e.id] || 0) + 1; }); return Object.keys(m).filter((k) => m[k] > 1); })();
  return {
    h1: Array.from(document.querySelectorAll('h1')).filter(visible).length,
    main: lm('main, [role=main]'), nav: lm('nav, [role=navigation]'), header: lm('header, [role=banner]'),
    html: { dir: document.documentElement.dir, lang: document.documentElement.lang },
    title: document.title,
    unnamedInteractive: interactive.filter((e) => !named(e)).map(d),
    unlabelledFields: fields.filter((e) => !named(e)).map(d),
    headingSkips: skips, imgsWithoutAlt: imgs, duplicateIds: dupIds,
    overflow: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
  };
})()`;

export interface Structure {
  h1: number; main: number; nav: number; header: number;
  html: { dir: string; lang: string }; title: string;
  unnamedInteractive: string[]; unlabelledFields: string[];
  headingSkips: number; imgsWithoutAlt: string[]; duplicateIds: string[];
  overflow: { sw: number; cw: number };
}

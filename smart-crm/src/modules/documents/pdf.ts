/**
 * Quote PDF rendering (A4) with correct Hebrew right-to-left layout.
 * pdf-lib + fontkit embed the Alef font (SIL OFL, fonts/OFL.txt); bidi.ts turns
 * every line into visual runs. Quotes are commercial offers, not tax invoices —
 * the footer of every page says so.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { analyze, stripBidiControls, visualRunsFor, wrapRanges, type Direction } from "./bidi";

export type QuotePdfItem = { description: string; quantityMilli: number; unitPriceCents: number; discountBp: number; totalCents: number };

export type QuotePdfData = {
  language: "he" | "en";
  number: number;
  title: string;
  issueDate: string;
  validUntil: string | null;
  currency: string;
  org: { name: string; email: string | null; phone: string | null; address: string | null; website: string | null; taxId: string | null };
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  accentColor: string;
  headerText: string | null;
  footerText: string | null;
  customer: { name: string | null; company: string | null; email: string | null; phone: string | null };
  items: QuotePdfItem[];
  totals: { subtotalCents: number; discountCents: number; discountBp: number; taxableCents: number; taxRateBp: number; taxCents: number; totalCents: number };
  notes: string | null;
  terms: string | null;
};

const LABELS = {
  he: {
    quote: "הצעת מחיר",
    number: "מס׳",
    date: "תאריך",
    validUntil: "בתוקף עד",
    to: "לכבוד",
    taxId: "ח.פ./ע.מ.",
    cols: ["#", "תיאור", "כמות", "מחיר יחידה", "הנחה", "סה״כ"],
    subtotal: "סכום ביניים",
    discount: "הנחה",
    beforeVat: "סה״כ לפני מע״מ",
    vat: "מע״מ",
    total: "סה״כ לתשלום",
    notes: "הערות",
    terms: "תנאים",
    disclaimer: "הצעת מחיר — אינה מהווה חשבונית מס",
    page: "עמוד",
    of: "מתוך",
  },
  en: {
    quote: "Quote",
    number: "No.",
    date: "Date",
    validUntil: "Valid until",
    to: "Prepared for",
    taxId: "Tax ID",
    cols: ["#", "Description", "Qty", "Unit price", "Discount", "Total"],
    subtotal: "Subtotal",
    discount: "Discount",
    beforeVat: "Total before VAT",
    vat: "VAT",
    total: "Total due",
    notes: "Notes",
    terms: "Terms",
    disclaimer: "Quote — this document is not a tax invoice",
    page: "Page",
    of: "of",
  },
} as const;

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 40;
const FOOTER_SPACE = 46;
const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.86, 0.88, 0.91);

type Fonts = { regular: PDFFont; bold: PDFFont };
type Align = "start" | "end" | "center";

let fontBytes: Promise<{ regular: Uint8Array; bold: Uint8Array }> | undefined;

async function readFont(file: string): Promise<Uint8Array> {
  const candidates = [
    (() => {
      try {
        return fileURLToPath(new URL(`./fonts/${file}`, import.meta.url));
      } catch {
        return null;
      }
    })(),
    path.join(process.cwd(), "src", "modules", "documents", "fonts", file),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    try {
      return new Uint8Array(await readFile(p));
    } catch {
      // try next location
    }
  }
  throw new Error(`PDF font not found: ${file}`);
}

function loadFonts() {
  fontBytes ??= Promise.all([readFont("Alef-Regular.ttf"), readFont("Alef-Bold.ttf")]).then(([regular, bold]) => ({ regular, bold }));
  return fontBytes;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0x4f46e5;
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/** Money for print: locale grouping + currency symbol, bidi controls/NBSP removed. */
export function formatPdfMoney(cents: number, currency: string, language: "he" | "en"): string {
  const s = new Intl.NumberFormat(language === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return stripBidiControls(s).replace(/ | /g, " ");
}

function formatQty(milli: number, language: "he" | "en") {
  return new Intl.NumberFormat(language === "he" ? "he-IL" : "en-US", { maximumFractionDigits: 3 }).format(milli / 1000);
}

function formatDateText(iso: string | null, language: "he" | "en") {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return language === "he" ? `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}` : `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Page writer: cursor-based layout with bidi-aware text and automatic page breaks. */
class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly dir: Direction,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.y = A4.h - MARGIN;
  }

  get contentLeft() {
    return MARGIN;
  }
  get contentWidth() {
    return A4.w - MARGIN * 2;
  }

  ensure(height: number): boolean {
    if (this.y - height < MARGIN + FOOTER_SPACE) {
      this.newPage();
      return true;
    }
    return false;
  }

  width(text: string, size: number, bold = false) {
    const clean = stripBidiControls(text);
    return clean ? (bold ? this.fonts.bold : this.fonts.regular).widthOfTextAtSize(clean, size) : 0;
  }

  /** Absolute x for a box [x, x+w] given logical alignment in the document direction. */
  private anchor(x: number, w: number, contentW: number, align: Align) {
    if (align === "center") return x + (w - contentW) / 2;
    const atLeft = (align === "start") === (this.dir === "ltr");
    return atLeft ? x : x + w - contentW;
  }

  /** Draws one already-wrapped line [start, end] of an analyzed paragraph. */
  private drawRange(p: ReturnType<typeof analyze>, start: number, end: number, opts: { x: number; w: number; y: number; size: number; bold?: boolean; color?: RGB; align?: Align }) {
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const runs = visualRunsFor(p, start, end);
    const total = runs.reduce((s, r) => s + font.widthOfTextAtSize(r.visual, opts.size), 0);
    let x = this.anchor(opts.x, opts.w, total, opts.align ?? "start");
    for (const r of runs) {
      if (r.visual.trim()) this.page.drawText(r.drawText, { x, y: opts.y, size: opts.size, font, color: opts.color ?? INK });
      x += font.widthOfTextAtSize(r.visual, opts.size);
    }
  }

  /** Wrapped text at the cursor; returns height used. Breaks pages between lines. */
  paragraph(text: string, opts: { x?: number; w?: number; size: number; bold?: boolean; color?: RGB; align?: Align; lineHeight?: number; base?: Direction | "auto" }) {
    const clean = stripBidiControls(text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, " ");
    if (!clean.trim()) return 0;
    const x = opts.x ?? this.contentLeft;
    const w = opts.w ?? this.contentWidth;
    const lh = opts.lineHeight ?? opts.size * 1.45;
    const p = analyze(clean, opts.base ?? this.dir);
    const ranges = wrapRanges(p.text, w, (s) => this.width(s, opts.size, opts.bold));
    let used = 0;
    for (const [s, e] of ranges) {
      this.ensure(lh);
      this.y -= lh;
      used += lh;
      if (e >= s) this.drawRange(p, s, e, { ...opts, x, w, y: this.y + (lh - opts.size) / 2 });
    }
    return used;
  }

  /** Lines for a fixed box (table cells) without moving the cursor. */
  layoutLines(text: string, w: number, size: number, bold = false, base: Direction | "auto" = this.dir) {
    const clean = stripBidiControls(text ?? "").replace(/\r\n?/g, "\n");
    const p = analyze(clean, base);
    return { p, ranges: clean.trim() ? wrapRanges(p.text, w, (s) => this.width(s, size, bold)) : [] };
  }

  drawLines(layout: ReturnType<Writer["layoutLines"]>, opts: { x: number; w: number; top: number; size: number; bold?: boolean; color?: RGB; align?: Align; lineHeight: number }) {
    let y = opts.top;
    for (const [s, e] of layout.ranges) {
      y -= opts.lineHeight;
      if (e >= s) this.drawRange(layout.p, s, e, { ...opts, y: y + (opts.lineHeight - opts.size) / 2 });
    }
  }

  rule(color: RGB = LINE, thickness = 0.8) {
    this.page.drawLine({ start: { x: this.contentLeft, y: this.y }, end: { x: this.contentLeft + this.contentWidth, y: this.y }, thickness, color });
  }

  /** Mirrors a logical column layout (start → end) into absolute x positions. */
  columns(widths: number[]): { x: number; w: number }[] {
    const out: { x: number; w: number }[] = [];
    let offset = 0;
    for (const w of widths) {
      const x = this.dir === "ltr" ? this.contentLeft + offset : this.contentLeft + this.contentWidth - offset - w;
      out.push({ x, w });
      offset += w;
    }
    return out;
  }
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const L = LABELS[data.language];
  const dir: Direction = data.language === "he" ? "rtl" : "ltr";
  const accent = hexToRgb(data.accentColor);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await loadFonts();
  const fonts: Fonts = {
    regular: await doc.embedFont(bytes.regular, { subset: true }),
    bold: await doc.embedFont(bytes.bold, { subset: true }),
  };
  doc.setTitle(`${L.quote} ${data.number} — ${data.title}`);
  doc.setAuthor(data.org.name);
  doc.setCreator("SMART CRM AI");
  doc.setLanguage(data.language === "he" ? "he-IL" : "en-US");

  const wr = new Writer(doc, fonts, dir);
  const money = (c: number) => formatPdfMoney(c, data.currency, data.language);

  // ------------------------------------------------------------------ header
  let logo: PDFImage | null = null;
  if (data.logo) {
    try {
      logo = data.logo.type === "png" ? await doc.embedPng(data.logo.bytes) : await doc.embedJpg(data.logo.bytes);
    } catch {
      logo = null; // a broken logo must never block the document
    }
  }
  const headerTop = wr.y;
  const [textCol, logoCol] = logo ? wr.columns([wr.contentWidth - 150, 150]) : [{ x: wr.contentLeft, w: wr.contentWidth }, null];
  wr.paragraph(data.org.name, { x: textCol.x, w: textCol.w, size: 18, bold: true, color: accent, base: "auto" });
  const orgLines = [
    data.org.address,
    [data.org.phone, data.org.email].filter(Boolean).join("  ·  "),
    data.org.website,
    data.org.taxId ? `${L.taxId} ${data.org.taxId}` : null,
  ].filter((s): s is string => Boolean(s && s.trim()));
  for (const line of orgLines) wr.paragraph(line, { x: textCol.x, w: textCol.w, size: 9, color: MUTED, base: "auto" });
  if (logo && logoCol) {
    const scale = Math.min(130 / logo.width, 56 / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    // The logo sits at the end side (left in Hebrew, right in English).
    const x = dir === "rtl" ? logoCol.x : logoCol.x + logoCol.w - w;
    wr.page.drawImage(logo, { x, y: headerTop - h, width: w, height: h });
    wr.y = Math.min(wr.y, headerTop - h);
  }
  wr.y -= 12;
  wr.rule(accent, 1.5);
  wr.y -= 6;

  // ----------------------------------------------------------- title & meta
  wr.paragraph(`${L.quote} ${L.number} ${data.number}`, { size: 16, bold: true });
  wr.paragraph(data.title, { size: 12, color: INK, base: "auto" });
  wr.y -= 6;
  const half = (wr.contentWidth - 20) / 2;
  // Recipient on the start side (right in Hebrew), dates on the end side.
  const [toCol, metaCol] = wr.columns([half, 20, half]).filter((_, i) => i !== 1);
  const blockTop = wr.y;
  const meta = [`${L.date}: ${formatDateText(data.issueDate, data.language)}`, data.validUntil ? `${L.validUntil}: ${formatDateText(data.validUntil, data.language)}` : null].filter(
    (s): s is string => Boolean(s),
  );
  for (const m of meta) wr.paragraph(m, { x: metaCol.x, w: metaCol.w, size: 10 });
  const metaBottom = wr.y;
  wr.y = blockTop;
  const customer = [data.customer.name, data.customer.company, data.customer.phone, data.customer.email].filter((s): s is string => Boolean(s && s.trim()));
  if (customer.length) {
    wr.paragraph(L.to, { x: toCol.x, w: toCol.w, size: 9, color: MUTED });
    customer.forEach((c, i) => wr.paragraph(c, { x: toCol.x, w: toCol.w, size: 10, bold: i === 0, base: "auto" }));
  }
  wr.y = Math.min(wr.y, metaBottom) - 10;
  if (data.headerText?.trim()) {
    wr.paragraph(data.headerText, { size: 10, color: INK, base: "auto" });
    wr.y -= 6;
  }

  // ---------------------------------------------------------------- items
  const size = 9.5;
  const lh = size * 1.45;
  const pad = 5;
  const widths = [22, 0, 52, 78, 52, 84];
  widths[1] = wr.contentWidth - widths.reduce((a, b) => a + b, 0);
  const cols = wr.columns(widths);
  const numericAlign: Align = "end";

  const drawHeader = () => {
    const h = lh + pad * 2;
    wr.ensure(h);
    wr.page.drawRectangle({ x: wr.contentLeft, y: wr.y - h, width: wr.contentWidth, height: h, color: accent, opacity: 0.1 });
    L.cols.forEach((label, i) => {
      const layout = wr.layoutLines(label, cols[i].w - pad * 2, size, true);
      wr.drawLines(layout, { x: cols[i].x + pad, w: cols[i].w - pad * 2, top: wr.y - pad, size, bold: true, lineHeight: lh, align: i <= 1 ? "start" : numericAlign });
    });
    wr.y -= h;
  };

  drawHeader();
  data.items.forEach((item, idx) => {
    const cells = [
      String(idx + 1),
      item.description,
      formatQty(item.quantityMilli, data.language),
      money(item.unitPriceCents),
      item.discountBp ? `${item.discountBp / 100}%` : "—",
      money(item.totalCents),
    ];
    const layouts = cells.map((c, i) => wr.layoutLines(c, cols[i].w - pad * 2, size, false, i === 1 ? "auto" : dir));
    const lines = Math.max(1, ...layouts.map((l) => l.ranges.length));
    const h = lines * lh + pad * 2;
    if (wr.ensure(h)) drawHeader();
    layouts.forEach((layout, i) =>
      wr.drawLines(layout, { x: cols[i].x + pad, w: cols[i].w - pad * 2, top: wr.y - pad, size, lineHeight: lh, align: i <= 1 ? "start" : numericAlign }),
    );
    wr.y -= h;
    wr.rule();
  });

  // --------------------------------------------------------------- totals
  wr.y -= 8;
  const totalsW = 250;
  const box = wr.columns([wr.contentWidth - totalsW, totalsW])[1];
  const [labelCol, valueCol] = [
    { x: dir === "rtl" ? box.x + 110 : box.x, w: totalsW - 110 },
    { x: dir === "rtl" ? box.x : box.x + totalsW - 110, w: 110 },
  ];
  const rows: [string, string, boolean][] = [[L.subtotal, money(data.totals.subtotalCents), false]];
  if (data.totals.discountCents > 0) rows.push([`${L.discount} (${data.totals.discountBp / 100}%)`, `-${money(data.totals.discountCents)}`, false]);
  rows.push([L.beforeVat, money(data.totals.taxableCents), false]);
  rows.push([`${L.vat} (${data.totals.taxRateBp / 100}%)`, money(data.totals.taxCents), false]);
  rows.push([L.total, money(data.totals.totalCents), true]);
  for (const [label, value, strong] of rows) {
    const rowH = (strong ? 12 : 10) * 1.6;
    wr.ensure(rowH + (strong ? 8 : 0));
    if (strong) {
      wr.y -= 4;
      wr.page.drawRectangle({ x: box.x, y: wr.y - rowH - 2, width: totalsW, height: rowH + 4, color: accent, opacity: 0.12 });
    }
    const top = wr.y;
    const s = strong ? 12 : 10;
    wr.drawLines(wr.layoutLines(label, labelCol.w - 8, s, strong), { x: labelCol.x + 4, w: labelCol.w - 8, top, size: s, bold: strong, lineHeight: rowH, align: "start" });
    wr.drawLines(wr.layoutLines(value, valueCol.w - 8, s, strong), { x: valueCol.x + 4, w: valueCol.w - 8, top, size: s, bold: strong, lineHeight: rowH, align: "end" });
    wr.y -= rowH;
  }

  // ---------------------------------------------------------- notes/terms
  for (const [heading, body] of [
    [L.notes, data.notes],
    [L.terms, data.terms],
  ] as const) {
    if (!body?.trim()) continue;
    wr.y -= 14;
    wr.paragraph(heading, { size: 11, bold: true, color: accent });
    wr.paragraph(body, { size: 9.5, color: INK, base: "auto" });
  }
  if (data.footerText?.trim()) {
    wr.y -= 12;
    wr.paragraph(data.footerText, { size: 9, color: MUTED, base: "auto" });
  }

  // --------------------------------------------- footer on every page
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const fw = new FooterWriter(page, fonts, dir);
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 26 }, end: { x: A4.w - MARGIN, y: MARGIN + 26 }, thickness: 0.6, color: LINE });
    fw.line(L.disclaimer, MARGIN + 12, "start", 8.5, true);
    fw.line(`${L.page} ${i + 1} ${L.of} ${pages.length}`, MARGIN + 12, "end", 8.5, false);
  });

  return doc.save();
}

/** Minimal single-line writer for page footers (pages already exist). */
class FooterWriter {
  constructor(
    private readonly page: PDFPage,
    private readonly fonts: Fonts,
    private readonly dir: Direction,
  ) {}
  line(text: string, y: number, align: Align, size: number, bold: boolean) {
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const runs = visualRunsFor(analyze(text, this.dir));
    const total = runs.reduce((s, r) => s + font.widthOfTextAtSize(r.visual, size), 0);
    const atLeft = (align === "start") === (this.dir === "ltr");
    let x = atLeft ? MARGIN : A4.w - MARGIN - total;
    for (const r of runs) {
      if (r.visual.trim()) this.page.drawText(r.drawText, { x, y, size, font, color: MUTED });
      x += font.widthOfTextAtSize(r.visual, size);
    }
  }
}

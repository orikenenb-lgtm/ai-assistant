#!/usr/bin/env python3
"""Generate reference SVG drawings for the EduVolt smart three-phase panel.

DESIGN ONLY - NOT FOR CONSTRUCTION.  Educational student project.

Reads (never edits) the project CSVs:
  10_Documentation/CONNECTIONS.csv, 10_Documentation/BOM.csv,
  06_PLC_Logic/IO_MAP.csv, 05_Panel_Layout/LAYOUT.csv
and writes SVG pages into 04_Schematics/ and 05_Panel_Layout/.

Python 3 standard library only.  Output is deterministic (fixed date,
no randomness, stable ordering).  Run:  python3 tools/generate_drawings.py
"""
import csv
import math
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent

W, H = 1587, 1123
FONT = "Arial, 'Noto Sans Hebrew', sans-serif"
DATE = "2026-10-15"
VERSION = "v0.1"
TOTAL_PAGES = 20
PROJECT_EN = "SMART THREE-PHASE ELECTRICAL PANEL"
PROJECT_HE = "לוח חשמל חכם תלת־פאזי"
PROJECT_SUB_EN = "Monitoring, protection and alarm system"
PROJECT_SUB_HE = "מערכת ניטור, הגנה והתראה"
NOTE_EN = "DESIGN ONLY — NOT FOR CONSTRUCTION"
NOTE_HE = "לתכנון ולימוד בלבד — טעון בדיקת מורה וחשמלאי מוסמך"
WIRE_NOTE = "Wire colours illustrative — see WIRE_COLORS.md"

# line styles for BOM status
DASH_ADD = "9 5"      # ADD_RECOMMENDED
DASH_COND = "2 4"     # CONDITIONAL
DASH_TBD = "6 4"      # wiring decision TBD
DASH_MECH = "5 4"     # mechanical linkage

# illustrative conductor colours (see WIRE_COLORS.md; colours are NOT a spec)
C_L1, C_L2, C_L3 = "#8B4513", "#000000", "#7a7a7a"
C_N = "#2f8fdf"
C_PE_G, C_PE_Y = "#1f8f3a", "#e3c800"
PHASE_COL = [C_L1, C_L2, C_L3]

HEB = re.compile("[֐-׿]")

# Tags that legitimately appear on drawings but are not BOM items
EXTERNAL_TAGS = {"SUPPLY"}


# --------------------------------------------------------------------------
# data loading
# --------------------------------------------------------------------------
def read_csv(rel):
    with open(ROOT / rel, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def expand_tag(tag):
    """'F5-F8' -> [F5..F8]; 'B1-B4' -> [B1..B4]; other tags unchanged."""
    m = re.match(r"^([A-Z]+)(\d+)-([A-Z]+)(\d+)$", tag)
    if m and m.group(1) == m.group(3):
        a, b = int(m.group(2)), int(m.group(4))
        if a < b:
            return [f"{m.group(1)}{i}" for i in range(a, b + 1)]
    return [tag]


class Data:
    def __init__(self):
        self.conn_rows = read_csv("10_Documentation/CONNECTIONS.csv")
        self.conns = {r["wire_id"]: r for r in self.conn_rows}
        self.io_rows = read_csv("06_PLC_Logic/IO_MAP.csv")
        self.io = {r["address"]: r for r in self.io_rows}
        self.bom_rows = read_csv("10_Documentation/BOM.csv")
        self.layout = read_csv("05_Panel_Layout/LAYOUT.csv")
        self.status = {}
        for r in self.bom_rows:
            for t in expand_tag(r["tag"]):
                self.status[t] = r["status"]

    def c(self, wid):
        if wid not in self.conns:
            raise KeyError(f"wire {wid} not in CONNECTIONS.csv")
        return self.conns[wid]

    def term(self, wid, end, idx=None, n=3):
        """Exact terminal string of a wire end ('from' or 'to').
        idx selects one pole of a multi-pole string such as '1/L1-3/L2-5/L3'."""
        s = self.c(wid)[end + "_terminal"]
        if idx is None:
            return s
        return split_poles(s, n)[idx]


def split_poles(s, n=3):
    if s.count("-") == n - 1 and all(p for p in s.split("-")) and "/" in s:
        parts = s.split("-")
    elif s.count("/") == n - 1:
        parts = s.split("/")
    else:
        raise ValueError(f"cannot split terminal string {s!r} into {n} poles")
    return parts


def expand_range(s):
    """'L.F6-L.F9' -> ['L.F6', 'L.F7', 'L.F8', 'L.F9']"""
    m = re.match(r"^(.*?)(\d+)-(.*?)(\d+)$", s)
    if not m or m.group(1) != m.group(3):
        raise ValueError(f"not a range: {s!r}")
    return [f"{m.group(1)}{i}" for i in range(int(m.group(2)), int(m.group(4)) + 1)]


# --------------------------------------------------------------------------
# SVG primitives
# --------------------------------------------------------------------------
def fmt(v):
    if isinstance(v, float):
        s = f"{v:.2f}".rstrip("0").rstrip(".")
        return "0" if s in ("-0", "") else s
    return str(v)


def is_he(s):
    return bool(HEB.search(s))


class Svg:
    def __init__(self, data, num, fname, out_dir, title_en, title_he, desc):
        self.d = data
        self.num = num
        self.fname = fname
        self.out_dir = out_dir
        self.title_en = title_en
        self.title_he = title_he
        self.desc = desc
        self.el = []
        self.tags = set()
        self.wires = set()

    # registry ------------------------------------------------------------
    def tag(self, t):
        for x in expand_tag(t):
            if x not in self.d.status and x not in EXTERNAL_TAGS:
                raise KeyError(f"page {self.num}: device tag {x} not in BOM.csv")
            self.tags.add(x)
        return t

    def wire(self, wid):
        self.d.c(wid)
        self.wires.add(wid)
        return wid

    # raw elements --------------------------------------------------------
    @staticmethod
    def _style(stroke="#000", sw=1.4, dash=None, fill="none", cap=None):
        a = f' stroke="{stroke}" stroke-width="{fmt(sw)}" fill="{fill}"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if cap:
            a += f' stroke-linecap="{cap}"'
        return a

    def line(self, x1, y1, x2, y2, stroke="#000", sw=1.4, dash=None):
        self.el.append(f'<line x1="{fmt(x1)}" y1="{fmt(y1)}" x2="{fmt(x2)}" y2="{fmt(y2)}"'
                       f'{self._style(stroke, sw, dash)}/>')

    def pl(self, pts, stroke="#000", sw=1.4, dash=None, fill="none"):
        p = " ".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)
        self.el.append(f'<polyline points="{p}"{self._style(stroke, sw, dash, fill)}/>')

    def polygon(self, pts, stroke="#000", sw=1.0, fill="#000"):
        p = " ".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)
        self.el.append(f'<polygon points="{p}"{self._style(stroke, sw, None, fill)}/>')

    def rect(self, x, y, w, h, stroke="#000", sw=1.4, dash=None, fill="none", rx=0):
        r = f' rx="{fmt(rx)}"' if rx else ""
        self.el.append(f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}"{r}'
                       f'{self._style(stroke, sw, dash, fill)}/>')

    def circle(self, cx, cy, r, stroke="#000", sw=1.4, fill="none", dash=None):
        self.el.append(f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}"'
                       f'{self._style(stroke, sw, dash, fill)}/>')

    def path(self, d, stroke="#000", sw=1.4, fill="none", dash=None):
        self.el.append(f'<path d="{d}"{self._style(stroke, sw, dash, fill)}/>')

    def text(self, x, y, s, size=12, align="left", bold=False, color="#000", italic=False):
        """align is VISUAL: left edge / center / right edge at x.
        Strings containing Hebrew are emitted as their own RTL <text>."""
        s = str(s)
        rtl = is_he(s)
        if align == "center":
            anchor = "middle"
        elif rtl:
            anchor = "end" if align == "left" else "start"
        else:
            anchor = "start" if align == "left" else "end"
        a = f'x="{fmt(x)}" y="{fmt(y)}" font-size="{fmt(size)}" text-anchor="{anchor}"'
        if rtl:
            a += ' direction="rtl" unicode-bidi="embed"'
        if bold:
            a += ' font-weight="bold"'
        if italic:
            a += ' font-style="italic"'
        if color != "#000":
            a += f' fill="{color}"'
        self.el.append(f"<text {a}>{escape(s)}</text>")

    def raw(self, s):
        self.el.append(s)

    # composite helpers -----------------------------------------------------
    def dot(self, x, y, r=3.2, color="#000"):
        self.circle(x, y, r, stroke=color, sw=1, fill=color)

    def term(self, x, y, r=3.4):
        self.circle(x, y, r, sw=1.2, fill="#fff")

    def arrow(self, x1, y1, x2, y2, sw=1.4, dash=None, stroke="#000", head=8):
        L = math.hypot(x2 - x1, y2 - y1)
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        bx, by = x2 - ux * head, y2 - uy * head
        self.line(x1, y1, bx, by, stroke=stroke, sw=sw, dash=dash)
        px, py = -uy * head * 0.45, ux * head * 0.45
        self.polygon([(x2, y2), (bx + px, by + py), (bx - px, by - py)], stroke=stroke, fill=stroke)

    def wlabel(self, x, y, wid, align="left", size=11):
        """Wire-id label (traceable to CONNECTIONS.csv)."""
        self.wire(wid)
        self.text(x, y, wid, size=size, align=align, color="#555", italic=True)

    def pe_line(self, x1, y1, x2, y2, sw=2.2):
        self.line(x1, y1, x2, y2, stroke=C_PE_G, sw=sw)
        self.line(x1, y1, x2, y2, stroke=C_PE_Y, sw=sw * 0.55, dash="7 7")

    def pe_pl(self, pts, sw=2.2):
        for (a, b), (c, d) in zip(pts, pts[1:]):
            self.pe_line(a, b, c, d, sw)

    def box(self, x, y, w, h, lines, status=None, sizes=None, bold_first=True, fill="none", line_gap=None):
        """Rectangle with centred text lines; outline style follows BOM status."""
        dash = {"ADD_RECOMMENDED": DASH_ADD, "CONDITIONAL": DASH_COND}.get(status)
        self.rect(x, y, w, h, dash=dash, fill=fill)
        n = len(lines)
        sizes = sizes or [13 if (i == 0 and bold_first) else 11 for i in range(n)]
        gap = line_gap or 15
        total = gap * (n - 1)
        y0 = y + h / 2 - total / 2 + 4
        for i, s in enumerate(lines):
            self.text(x + w / 2, y0 + i * gap, s, size=sizes[i], align="center",
                      bold=(i == 0 and bold_first))

    # page frame ------------------------------------------------------------
    def frame(self, notes):
        self.rect(10, 10, W - 20, H - 20, sw=1.6)
        # header
        self.text(24, 36, f"{self.num} — {self.title_en}", size=16, bold=True)
        self.text(W - 24, 36, self.title_he, size=16, bold=True, align="right")
        self.text(W / 2 - 8, 58, NOTE_EN, size=12, bold=True, align="right", color="#b00000")
        self.text(W / 2 + 8, 58, NOTE_HE, size=12, bold=True, align="left", color="#b00000")
        self.line(10, 68, W - 10, 68, sw=1.2)
        # notes box (bottom-left)
        nx, ny, nw, nh = 10, self.TB_Y0, 1057, H - 10 - self.TB_Y0
        self.rect(nx, ny, nw, nh, sw=1.2)
        self.text(nx + 12, ny + 18, "NOTES", size=12, bold=True)
        self.text(nx + nw - 12, ny + 18, "הערות", size=12, bold=True, align="right")
        all_notes = list(notes) + [(WIRE_NOTE, "צבעי המוליכים להמחשה בלבד — ראו WIRE_COLORS.md")]
        if len(all_notes) > 7:
            raise ValueError(f"page {self.num}: too many notes ({len(all_notes)})")
        for i, n in enumerate(all_notes):
            yy = ny + 40 + i * 20
            if isinstance(n, tuple):
                en, he = n
                if en:
                    self.text(nx + 12, yy, en, size=11.5)
                if he:
                    self.text(nx + nw - 12, yy, he, size=11.5, align="right")
            elif is_he(n):
                self.text(nx + nw - 12, yy, n, size=11.5, align="right")
            else:
                self.text(nx + 12, yy, n, size=11.5)
        self.title_block()

    TB_ROWS = [24, 22, 22, 22, 22, 22, 22, 22]
    TB_Y0 = H - 10 - sum(TB_ROWS)          # 935

    def title_block(self):
        x0, y0, w = 1067, self.TB_Y0, 510
        rows = self.TB_ROWS
        ys = [y0]
        for r in rows:
            ys.append(ys[-1] + r)
        self.rect(x0, y0, w, sum(rows), sw=1.6)
        for yy in ys[1:-1]:
            self.line(x0, yy, x0 + w, yy, sw=0.8)
        L, R = x0 + 8, x0 + w - 8
        self.text(L, ys[0] + 17, PROJECT_EN, size=12, bold=True)
        self.text(R, ys[0] + 17, PROJECT_HE, size=12, bold=True, align="right")
        self.text(L, ys[1] + 16, PROJECT_SUB_EN, size=11)
        self.text(R, ys[1] + 16, PROJECT_SUB_HE, size=11, align="right")
        self.text(L, ys[2] + 16, "Drawing:", size=11)
        self.text(L + 56, ys[2] + 16, self.title_en, size=12, bold=True)
        self.text(R, ys[3] + 16, self.title_he, size=12, bold=True, align="right")
        self.text(L, ys[3] + 16, "Title (HE):", size=11)
        cells = [(0, f"Page {self.num} / {TOTAL_PAGES}"), (118, f"Date {DATE}"),
                 (248, f"Version {VERSION}"), (348, f"{self.fname}")]
        for dx, s in cells:
            if dx:
                self.line(x0 + dx, ys[4], x0 + dx, ys[5], sw=0.8)
            self.text(x0 + dx + 7, ys[4] + 16, s, size=11, bold=(dx == 0))
        self.text(L, ys[5] + 16, self.desc, size=11)
        self.text(L, ys[6] + 16, NOTE_EN, size=12, bold=True, color="#b00000")
        self.text(R, ys[7] + 16, NOTE_HE, size=12, bold=True, color="#b00000", align="right")

    def save(self):
        head = (f'<?xml version="1.0" encoding="UTF-8"?>\n'
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
                f'width="{W}" height="{H}" font-family="{FONT}">\n'
                f'<title>{escape(self.num + " " + self.title_en)}</title>\n'
                f'<desc>{escape(self.desc + " | " + NOTE_EN + " | " + NOTE_HE)}</desc>\n'
                f'<rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff"/>\n'
                f'<g stroke-linecap="round" stroke-linejoin="round">\n')
        body = "\n".join(self.el)
        out = self.out_dir / self.fname
        out.write_text(head + body + "\n</g>\n</svg>\n", encoding="utf-8")
        return out


# --------------------------------------------------------------------------
# IEC-style symbols drawn along an axis (horizontal or vertical)
# --------------------------------------------------------------------------
class Ax:
    """Local frame: u along p1->p2, v perpendicular (side=+1: up for a
    left-to-right axis, right for a top-to-bottom axis)."""

    def __init__(self, x1, y1, x2, y2, side=1):
        self.x1, self.y1 = x1, y1
        self.L = math.hypot(x2 - x1, y2 - y1)
        self.ux, self.uy = (x2 - x1) / self.L, (y2 - y1) / self.L
        self.vx, self.vy = self.uy * side, -self.ux * side
        if abs(self.ux) < 1e-9:      # vertical axis: +v to the right for side=1
            self.vx, self.vy = side * 1.0, 0.0

    def p(self, u, v=0.0):
        return (self.x1 + self.ux * u + self.vx * v, self.y1 + self.uy * u + self.vy * v)

    def bbox(self, u0, v0, u1, v1):
        a, b = self.p(u0, v0), self.p(u1, v1)
        return min(a[0], b[0]), min(a[1], b[1]), abs(a[0] - b[0]), abs(a[1] - b[1])


def contact(s, x1, y1, x2, y2, kind="NO", mark=None, side=1, stroke="#000", sw=1.4,
            dash=None, gap=24, qmark=False):
    """NO / NC contact between two points.  mark: 'x' breaker, 'iso'
    disconnector, 'arc' contactor.  Returns the blade midpoint."""
    a = Ax(x1, y1, x2, y2, side)
    ua, ub = a.L / 2 - gap / 2, a.L / 2 + gap / 2
    s.line(*a.p(0), *a.p(ua), stroke=stroke, sw=sw, dash=dash)
    s.line(*a.p(ub), *a.p(a.L), stroke=stroke, sw=sw, dash=dash)
    if kind == "NO":
        s.line(*a.p(ub), *a.p(ua - 3, 11), stroke=stroke, sw=sw, dash=dash)
        mid = a.p((ua + ub) / 2, 6)
    else:
        s.line(*a.p(ua), *a.p(ua, -10), stroke=stroke, sw=sw, dash=dash)
        s.line(*a.p(ub), *a.p(ua - 3, -10), stroke=stroke, sw=sw, dash=dash)
        mid = a.p((ua + ub) / 2, -5)
    if mark == "x":
        s.line(*a.p(ua - 4, -4), *a.p(ua + 4, 4), stroke=stroke, sw=sw)
        s.line(*a.p(ua - 4, 4), *a.p(ua + 4, -4), stroke=stroke, sw=sw)
    elif mark == "iso":
        s.line(*a.p(ua, -5), *a.p(ua, 5), stroke=stroke, sw=sw)
    elif mark == "arc":
        c = a.p(ua - 4.5, 0)
        pts = []
        for i in range(9):
            t = math.radians(-90 + 22.5 * i)
            pts.append((c[0] + 4.5 * (math.cos(t) * a.ux + math.sin(t) * a.vx),
                        c[1] + 4.5 * (math.cos(t) * a.uy + math.sin(t) * a.vy)))
        s.pl(pts, stroke=stroke, sw=sw)
    if qmark:
        q = a.p((ua + ub) / 2, -9)
        s.text(q[0], q[1] + 4, "?", size=12, bold=True, align="center")
    return mid


def fuse(s, x1, y1, x2, y2, side=1, sw=1.4, dash=None):
    a = Ax(x1, y1, x2, y2, side)
    c = a.L / 2
    s.line(*a.p(0), *a.p(a.L), sw=sw, dash=dash)
    s.rect(*a.bbox(c - 15, -6, c + 15, 6), sw=sw, fill="#fff", dash=dash)
    s.line(*a.p(c - 15), *a.p(c + 15), sw=sw)


def coil(s, x1, y1, x2, y2, along=20, across=40, dash=None, sw=1.4):
    a = Ax(x1, y1, x2, y2)
    c = a.L / 2
    s.line(*a.p(0), *a.p(c - along / 2), sw=sw, dash=dash)
    s.line(*a.p(c + along / 2), *a.p(a.L), sw=sw, dash=dash)
    s.rect(*a.bbox(c - along / 2, -across / 2, c + along / 2, across / 2), sw=sw, dash=dash, fill="#fff")
    return a.p(c)


def lamp(s, x1, y1, x2, y2, r=12, fill="none", dash=None):
    a = Ax(x1, y1, x2, y2)
    c = a.L / 2
    s.line(*a.p(0), *a.p(c - r), dash=dash)
    s.line(*a.p(c + r), *a.p(a.L), dash=dash)
    cx, cy = a.p(c)
    s.circle(cx, cy, r, fill=fill)
    k = r * 0.7071
    s.line(cx - k, cy - k, cx + k, cy + k)
    s.line(cx - k, cy + k, cx + k, cy - k)
    return cx, cy


def buzzer(s, x1, y1, x2, y2, r=13, side=1):
    a = Ax(x1, y1, x2, y2, side)
    c = a.L / 2
    s.line(*a.p(0), *a.p(c - r))
    s.line(*a.p(c + r), *a.p(a.L))
    pts = []
    for i in range(13):
        t = math.radians(180 - 15 * i)
        pts.append(a.p(c + r * math.cos(t), r * math.sin(t)))
    s.pl(pts + [pts[0]], sw=1.4)
    return a.p(c, r / 2)


def thermal(s, x1, y1, x2, y2, side=1):
    """Thermal overload element (step symbol)."""
    a = Ax(x1, y1, x2, y2, side)
    c = a.L / 2
    s.line(*a.p(0), *a.p(c - 13))
    s.line(*a.p(c + 13), *a.p(a.L))
    s.rect(*a.bbox(c - 13, -8, c + 13, 8), fill="#fff")
    s.pl([a.p(c - 13), a.p(c - 5), a.p(c - 5, 5), a.p(c + 5, 5), a.p(c + 5), a.p(c + 13)])


def motor(s, cx, cy, r=40):
    s.circle(cx, cy, r, sw=1.8, fill="#fff")
    s.text(cx, cy - 2, "M", size=18, bold=True, align="center")
    s.text(cx, cy + 17, "3~", size=13, align="center")


# --------------------------------------------------------------------------
# shared drawing helpers
# --------------------------------------------------------------------------
def vterm_labels(s, xs, y, labels, dx=-7, size=11, dy=4):
    """Terminal circles at (x, y) with labels left (dx<0) or right of each."""
    for x, lab in zip(xs, labels):
        s.term(x, y)
        s.text(x + dx, y + dy, lab, size=size, align="right" if dx < 0 else "left")


def dev_label(s, x, y, lines, align="left", gap=14, size=11):
    for i, ln in enumerate(lines):
        s.text(x, y + i * gap, ln, size=13 if i == 0 else size, bold=(i == 0), align=align)


def multipole(s, xs, y1, y2, kind="NO", mark=None, cols=None, link=True, side=1):
    mids = []
    for i, x in enumerate(xs):
        col = cols[i] if cols else "#000"
        mids.append(contact(s, x, y1, x, y2, kind=kind, mark=mark, stroke=col, side=side))
    if link and len(mids) > 1:
        s.line(mids[0][0], mids[0][1], mids[-1][0] + 8, mids[-1][1], sw=1, dash=DASH_MECH)
    return mids


def phase_lines(s, xs, y1, y2, cols=PHASE_COL, sw=1.6):
    for x, c in zip(xs, cols):
        s.line(x, y1, x, y2, stroke=c, sw=sw)


def symbol_legend(s, x, y, items, w=550):
    """Small symbol legend box; items chosen from the keys below."""
    lab = {
        "iso": "disconnector / main switch (isolator mark)",
        "x": "circuit breaker MCB (x mark)",
        "arc": "contactor main contact (arc mark)",
        "rcd": "residual current device (RCCB) sensor",
        "mech": "mechanical link (dashed)",
        "tbd": "connection / allocation TBD (dashed)",
        "cond": "CONDITIONAL item (dotted)",
        "add": "ADD_RECOMMENDED item (dashed outline)",
        "term": "terminal",
        "dot": "connection point (tap)",
        "no": "NO contact",
        "nc": "NC contact",
        "coil": "coil (contactor / relay)",
        "lamp": "indicator lamp",
        "buzz": "buzzer",
        "fuse": "fuse",
    }
    rows = (len(items) + 1) // 2
    h = 30 + rows * 34
    s.rect(x, y, w, h, sw=1)
    s.text(x + 10, y + 18, "SYMBOLS", size=12, bold=True)
    s.text(x + w - 10, y + 18, "מקרא סמלים", size=12, bold=True, align="right")
    for i, k in enumerate(items):
        cx = x + 14 + (i % 2) * (w / 2)
        cy = y + 44 + (i // 2) * 34
        if k in ("iso", "x", "arc", "no"):
            contact(s, cx, cy, cx + 50, cy, mark=None if k == "no" else k)
        elif k == "nc":
            contact(s, cx, cy, cx + 50, cy, kind="NC")
        elif k == "rcd":
            s.rect(cx + 5, cy - 9, 40, 18, sw=1.2)
            s.text(cx + 25, cy + 4, "IΔn", size=11, align="center")
        elif k == "mech":
            s.line(cx, cy, cx + 50, cy, sw=1, dash=DASH_MECH)
        elif k == "tbd":
            s.line(cx, cy, cx + 50, cy, stroke=C_L1, sw=1.6, dash=DASH_TBD)
        elif k == "cond":
            s.line(cx, cy, cx + 50, cy, sw=1.4, dash=DASH_COND)
        elif k == "add":
            s.rect(cx + 5, cy - 9, 40, 18, sw=1.4, dash=DASH_ADD)
        elif k == "term":
            s.line(cx, cy, cx + 25, cy)
            s.term(cx + 25, cy)
        elif k == "dot":
            s.line(cx, cy, cx + 50, cy)
            s.line(cx + 25, cy, cx + 25, cy + 12)
            s.dot(cx + 25, cy)
        elif k == "coil":
            coil(s, cx, cy, cx + 50, cy, along=16, across=24)
        elif k == "lamp":
            lamp(s, cx, cy, cx + 50, cy, r=10)
        elif k == "buzz":
            buzzer(s, cx, cy, cx + 50, cy, r=10)
        elif k == "fuse":
            fuse(s, cx, cy, cx + 50, cy)
        s.text(cx + 62, cy + 4, lab[k], size=11)


# --------------------------------------------------------------------------
# I/O helpers (data driven from CONNECTIONS.csv + IO_MAP.csv)
# --------------------------------------------------------------------------
def input_wires(d, addr):
    """Return (in_row, out_row) for a K1 input, or None for a spare."""
    outs = [r for r in d.conn_rows if r["to_device"] == "K1" and r["to_terminal"] == addr]
    if not outs:
        return None
    assert len(outs) == 1, addr
    out = outs[0]
    dev = out["from_device"]
    ins = [r for r in d.conn_rows if r["from_device"] == "X2" and r["from_terminal"] == "+24V_IN"
           and r["to_device"] == dev]
    assert len(ins) == 1, (addr, ins)
    return ins[0], out


def output_wires(d, addr):
    outs = [r for r in d.conn_rows if r["from_device"] == "K1" and r["from_terminal"] == addr]
    if not outs:
        return None
    assert len(outs) == 1, addr
    out = outs[0]
    load = out["to_device"]
    rets = [r for r in d.conn_rows if r["from_device"] == load and r["to_device"] == "X2"
            and r["to_terminal"] == "0V"]
    return out, (rets[0] if rets else None)


IN_EN = {
    "I1": "S1 START pushbutton (NO)",
    "I2": "S2 STOP pushbutton (NC) — recommended purchase",
    "I3": "S3 RESET pushbutton (NO)",
    "I4": "S0 E-stop, 2nd NC block NC-2 — recommended",
    "I5": "F4 overload relay, auxiliary NO 97-98",
    "I6": "KM1 auxiliary NO 13-14 (feedback)",
    "I7": "B1 XH-W3001 relay — Zone A warning",
    "I8": "B2 XH-W3001 relay — Zone A alarm",
    "I9": "B3 XH-W3001 relay — Zone B warning",
    "IA": "B4 XH-W3001 relay — Zone B alarm",
    "IB": "B5 smoke detector alarm relay",
    "IC": "KA2 5V relay module (from MQ-2 DO)",
}


# --------------------------------------------------------------------------
# 02 block diagram
# --------------------------------------------------------------------------
def page_02(d, out):
    s = Svg(d, "02", "02_block_diagram.svg", out, "SYSTEM BLOCK DIAGRAM",
            "תרשים מלבנים של המערכת",
            "Power path, 24V/5V control supply, PLC K1 inputs and outputs, sensors and door devices")

    def st(tag):
        return d.status.get(expand_tag(tag)[0])

    def B(x, y, w, h, tag, lines, status=None, tags=None):
        for t in (tags or [tag]):
            s.tag(t)
        s.box(x, y, w, h, [tag] + lines, status=status if status is not None else st(tag),
              sizes=[12.5] + [11] * len(lines), line_gap=14)
        return (x, y, w, h)

    def R(b):
        return b[0] + b[2], b[1] + b[3] / 2

    def Lft(b):
        return b[0], b[1] + b[3] / 2

    # ---------------- power section
    s.text(24, 92, "POWER — 400/230V AC", size=13, bold=True)
    s.text(1560, 92, "חלק הכוח", size=13, bold=True, align="right")
    sup = B(30, 205, 125, 60, "SUPPLY", ["3~ + N + PE", "400/230V AC"])
    q0 = B(190, 210, 125, 50, "Q0", ["main switch 4P"])
    f1 = B(350, 210, 125, 50, "F1", ["RCCB 4P 30 mA"])
    s.arrow(*R(sup), *Lft(q0))
    s.arrow(*R(q0), *Lft(f1))
    s.tag("BUS-L123")
    s.rect(510, 105, 34, 320, sw=1.4, fill="#e6e6e6")
    s.text(527, 434 + 6, "BUS-L123", size=11.5, bold=True, align="center")
    s.arrow(*R(f1), 510, 235)
    nb = B(350, 330, 135, 50, "N-BAR", ["→ G1 N, X1 N.F6–N.F9"])
    s.arrow(412, 260, 412, 330)
    pb = B(30, 330, 135, 50, "PE-BAR", ["→ ENCL, X1 PE (M1)"])
    s.arrow(92, 265, 92, 330)
    rows = [128, 213, 298, 383]
    bw, bh = 130, 46

    def row_block(x, r, tag, lines, tags=None, status=None):
        return B(x, r - bh / 2, bw, bh, tag, lines, tags=tags, status=status)
    # row 1: F2 -> KM2 -> X1 general
    f2 = row_block(590, rows[0], "F2", ["MCB 3P C"])
    km2 = row_block(760, rows[0], "KM2", ["contactor (Q2)"])
    x1a = row_block(930, rows[0], "X1", ["L1.2 / L2.2 / L3.2"])
    s.text(1072, rows[0] - 2, "→ general 3~", size=11)
    s.text(1072, rows[0] + 13, "outgoing (role TBD)", size=11)
    # row 2: F3 -> KM1 -> F4 -> X1 -> M1
    f3 = row_block(590, rows[1], "F3", ["MCB 3P D"])
    km1 = row_block(760, rows[1], "KM1", ["motor contactor"])
    f4 = row_block(930, rows[1], "F4", ["overload LRD"])
    x1b = row_block(1100, rows[1], "X1", ["U1 / V1 / W1"])
    m1 = row_block(1270, rows[1], "M1", ["3~ motor (data TBD)"])
    # row 3: F6-F9 -> X1
    f69 = row_block(590, rows[2], "F6–F9", ["MCB 1P (phase TBD)"], tags=["F6", "F7", "F8", "F9"],
                    status="OWNED")
    x1c = row_block(760, rows[2], "X1", ["L.F6 – L.F9"])
    s.text(902, rows[2] - 2, "→ single-phase outgoing", size=11)
    s.text(902, rows[2] + 13, "circuits (roles TBD)", size=11)
    # row 4: F5 -> G1
    f5 = row_block(590, rows[3], "F5", ["MCB 1P 10A"])
    g1 = row_block(760, rows[3], "G1", ["HDR-60-24  24V DC"])
    for b in (f2, f3, f69, f5):
        s.arrow(544, b[1] + bh / 2, b[0], b[1] + bh / 2)
    for a, b in ((f2, km2), (km2, x1a), (f3, km1), (km1, f4), (f4, x1b), (x1b, m1), (f69, x1c), (f5, g1)):
        s.arrow(*R(a), *Lft(b))
    # legend (outline styles)
    lx, ly = 1250, 285
    s.rect(lx, ly, 305, 140, sw=1)
    s.text(lx + 10, ly + 18, "Outline = BOM status", size=12, bold=True)
    leg = [(None, "PLANNED / OWNED"), (DASH_ADD, "ADD_RECOMMENDED"), (DASH_COND, "CONDITIONAL"),
           ("12 4 3 4", "door-mounted group")]
    for i, (dash, lab) in enumerate(leg):
        yy = ly + 34 + i * 26
        s.rect(lx + 12, yy, 46, 18, sw=1.4, dash=dash)
        s.text(lx + 70, yy + 14, lab, size=11.5)

    # ---------------- control section
    s.line(20, 462, 1567, 462, sw=1, dash="4 4")
    s.text(24, 482, "CONTROL — 24V DC (G1) and 5V DC (G2)", size=13, bold=True)
    s.text(1560, 482, "חלק הפיקוד", size=13, bold=True, align="right")
    gx = g1[0] + bw / 2
    s.line(gx, g1[1] + bh, gx, 497)
    s.line(110, 497, 1170, 497, sw=1.8)
    s.dot(gx, 497)
    s.text(gx + 8, 491, "+24V (G1 +V)", size=11)
    fh, fw = 36, 120
    f11 = B(60, 512, fw, fh, "F11", ["+24V_IN"])
    f10 = B(410, 512, fw, fh, "F10", ["K1 supply"])
    f12 = B(600, 512, fw, fh, "F12", ["output COM"])
    f13 = B(1050, 512, fw, fh, "F13", ["+24V_SENS"])
    for b in (f11, f10, f12, f13):
        s.line(b[0] + fw / 2, 497, b[0] + fw / 2, b[1])
        s.dot(b[0] + fw / 2, 497)
    # inputs column
    ins = [("S1", ["START (NO)"], "I1"), ("S2", ["STOP (NC)"], "I2"), ("S3", ["RESET (NO)"], "I3"),
           ("S0 NC-2", ["E-stop monitor"], "I4"), ("F4 97-98", ["overload trip"], "I5"),
           ("KM1 13-14", ["contactor feedback"], "I6"), ("B1–B4", ["temp. relays"], "I7–IA"),
           ("B5", ["smoke alarm relay"], "IB"), ("KA2 COM-NO", ["gas (MQ-2)"], "IC")]
    iy0, ip, ih, ix, iw = 588, 36, 28, 60, 205
    kb = (390, 580, 170, 320)
    s.rect(*kb, sw=2)
    s.text(475, 700, "K1", size=16, bold=True, align="center")
    s.text(475, 718, "Zelio", size=12, align="center")
    s.text(475, 733, "SR3B261BD", size=12, align="center")
    s.text(475, 752, "16 DI / 10 relay", size=11, align="center")
    s.text(475, 768, "outputs", size=11, align="center")
    s.line(40, f11[1] + fh / 2, f11[0], f11[1] + fh / 2)
    s.line(40, f11[1] + fh / 2, 40, iy0 + 8 * ip + ih / 2)
    for i, (tag, lines, addr) in enumerate(ins):
        y = iy0 + i * ip
        tags = {"S0 NC-2": ["S0", "S0-NC2"], "F4 97-98": ["F4"], "KM1 13-14": ["KM1"],
                "B1–B4": ["B1", "B2", "B3", "B4"], "KA2 COM-NO": ["KA2"]}.get(tag, [tag])
        status = {"S0 NC-2": "ADD_RECOMMENDED", "F4 97-98": "PLANNED", "KM1 13-14": "PLANNED",
                  "B1–B4": "PLANNED", "KA2 COM-NO": "PLANNED"}.get(tag)
        for t in tags:
            s.tag(t)
        s.rect(ix, y, iw, ih, dash={"ADD_RECOMMENDED": DASH_ADD}.get(status or st(tag)))
        s.text(ix + 8, y + 19, tag, size=12, bold=True)
        s.text(ix + iw - 8, y + 19, lines[0], size=11, align="right")
        s.arrow(40, y + ih / 2, ix, y + ih / 2, head=6)
        s.arrow(ix + iw, y + ih / 2, kb[0], y + ih / 2)
        s.text(kb[0] - 6, y + ih / 2 - 4, addr, size=11, bold=True, align="right")
    s.rect(52, iy0 - 8, iw + 16, 4 * ip + 4, sw=1.2, dash="12 4 3 4", stroke="#555")
    s.text(ix + iw / 2, iy0 - 13, "DOOR: S0–S3", size=11, bold=True, align="center")
    s.text(48, 575, "+24V_IN", size=11, align="left")
    # F10 -> K1 supply, F12 -> COM
    s.arrow(470, f10[1] + fh, 470, kb[1])
    s.text(478, 572, "+ / −", size=11)
    s.pl([(660, f12[1] + fh), (660, 596), (kb[0] + kb[2] + 8, 596)])
    s.arrow(kb[0] + kb[2] + 8, 596, kb[0] + kb[2], 596, head=7)
    s.text(668, 584, "COM (grouping TBD)", size=11, color="#b00000")
    # outputs
    outs = [("Q1", "S0 NC-1", "door, hardwired", None), ("Q2", "KM2", "coil", None),
            ("Q3", "H1", "GREEN lamp", None), ("Q4", "H2", "WHITE lamp", None),
            ("Q5", "H3", "YELLOW lamp", None), ("Q6", "H4", "AMBER lamp", None),
            ("Q7", "H5", "RED lamp", None), ("Q8", "HA1", "buzzer", None),
            ("Q9", "KA1", "coil (cond.)", "CONDITIONAL")]
    oy0, op, oh, ox, ow = 612, 32, 25, 640, 150
    for i, (addr, tag, lab, stt) in enumerate(outs):
        y = oy0 + i * op
        s.tag(tag.split()[0])
        dash = DASH_COND if stt == "CONDITIONAL" else None
        s.arrow(kb[0] + kb[2], y + oh / 2, ox, y + oh / 2, dash=dash)
        s.text(kb[0] + kb[2] + 8, y + oh / 2 - 4, addr, size=11, bold=True)
        s.rect(ox, y, ow, oh, dash=dash)
        s.text(ox + 8, y + 17, tag, size=12, bold=True)
        s.text(ox + ow - 8, y + 17, lab, size=11, align="right")
    s.text(kb[0] + kb[2] + 8, oy0 + 9 * op + 12, "QA spare", size=11, color="#555")
    q1y = oy0 + oh / 2
    c1 = (ox + ow + 25, oy0, 100, oh)
    c2 = (c1[0] + 125, oy0, 115, oh)
    s.tag("F4"); s.tag("KM1")
    for b, a, lab in ((c1, "F4", "95-96"), (c2, "KM1", "coil A1-A2")):
        s.rect(*b)
        s.text(b[0] + 8, oy0 + 17, a, size=12, bold=True)
        s.text(b[0] + b[2] - 8, oy0 + 17, lab, size=11, align="right")
    s.arrow(ox + ow, q1y, c1[0], q1y)
    s.arrow(c1[0] + c1[2], q1y, c2[0], q1y)
    s.text(c1[0], oy0 + 44, "E-stop and overload cut the KM1 coil", size=11, color="#b00000")
    s.text(c1[0], oy0 + 59, "even if the PLC fails (sheet 05)", size=11, color="#b00000")
    s.rect(ox - 8, oy0 + 2 * op - 6, ow + 16, 6 * op + 6, sw=1.2, dash="12 4 3 4", stroke="#555")
    s.text(ox + ow + 18, oy0 + 2 * op + 14, "DOOR: H1–H5, HA1", size=11, bold=True)
    s.text(ox + ow + 18, oy0 + 2 * op + 29, "(and S0 NC-1)", size=11)
    # sensor supply chain
    sx = 1110
    s.line(f13[0] + fw / 2, f13[1] + fh, f13[0] + fw / 2, 590)
    s.line(1070, 590, 1070, 815)
    s.line(1070, 590, f13[0] + fw / 2, 590)
    sb1 = B(sx, 600, 170, 40, "B1–B4", ["XH-W3001 supply"], tags=["B1", "B2", "B3", "B4"])
    ka1 = B(sx, 662, 120, 40, "KA1", ["NC 11-12"])
    b5 = B(sx + 160, 662, 140, 40, "B5", ["smoke detector"])
    g2 = B(sx, 724, 120, 40, "G2", ["LM2596 → 5V"])
    x3 = B(sx + 160, 724, 120, 40, "X3", ["+5V / 0V5"])
    b6 = B(sx + 160, 800, 120, 40, "B6", ["MQ-2 (DO)"])
    ka2 = B(sx + 320, 800, 120, 40, "KA2", ["5V relay IN"])
    for b in (sb1, ka1, g2):
        s.arrow(1070, b[1] + 20, b[0], b[1] + 20)
    s.arrow(*R(ka1), *Lft(b5), dash=DASH_COND)
    s.arrow(*R(g2), *Lft(x3))
    s.arrow(x3[0] + 60, x3[1] + 40, x3[0] + 60, b6[1])
    s.pl([(x3[0] + x3[2], 744), (ka2[0] + 60, 744)])
    s.arrow(ka2[0] + 60, 744, ka2[0] + 60, ka2[1])
    s.arrow(*R(b6), *Lft(ka2))
    s.text(b6[0] + b6[2] + 6, 795, "DO", size=11)
    s.text(sb1[0] + 180, 616, "contacts → I7–IA", size=11)
    s.text(sb1[0] + 180, 631, "(fed from +24V_IN)", size=11)
    s.text(b5[0] + 150, 678, "alarm relay", size=11)
    s.text(b5[0] + 150, 693, "→ IB", size=11)
    s.text(ka2[0], 858, "COM-NO → IC", size=11)
    s.text(1102, 578, "+24V_SENS", size=11, align="right")
    s.text(sx, 868, "LM2596 is NOT isolated — 0V shared", size=11, bold=True, color="#b00000")
    s.text(sx, 884, "MQ-2 AO not connected (future: IG)", size=11, color="#555")
    s.frame([
        ("Block diagram only — wire-level detail and exact terminals on sheets 03–12.",
         "תרשים מלבנים — פרטי חיווט בגיליונות 03–12"),
        ("Outline style shows BOM status: dashed = ADD_RECOMMENDED, dotted = CONDITIONAL.", ""),
        ("Roles of KM2, F6–F9 and the X1 outgoing circuits are TBD; motor M1 data is TBD.", ""),
        ("All 24V field contacts are fed from X2 +24V_IN (F11); sensors are powered from +24V_SENS (F13).", ""),
    ])
    return s


# --------------------------------------------------------------------------
# 03 power distribution (multi-line)
# --------------------------------------------------------------------------
def hcontact_group(s, ys, x1, x2, kind="NO", mark=None, cols=None):
    mids = []
    for i, y in enumerate(ys):
        mids.append(contact(s, x1, y, x2, y, kind=kind, mark=mark, stroke=cols[i] if cols else "#000"))
    s.line(mids[0][0], mids[0][1] - 6, mids[-1][0], mids[-1][1] + 4, sw=1, dash=DASH_MECH)
    return mids


def page_03(d, out):
    s = Svg(d, "03", "03_power_distribution.svg", out, "POWER DISTRIBUTION — MULTI-LINE",
            "חלוקת כוח — תרשים רב־קווי",
            "SUPPLY → Q0 → F1 → BUS-L123 → F2/KM2, F3, F5 → G1, F6–F9 ; N-BAR ; PE-BAR")
    for t in ("SUPPLY", "Q0", "F1", "BUS-L123", "N-BAR", "PE-BAR", "F2", "KM2", "X1", "F3", "KM1",
              "F5", "G1", "F6", "F7", "F8", "F9"):
        s.tag(t)
    ys = [170, 200, 230, 260]          # L1 L2 L3 N
    pey = 290
    cols4 = PHASE_COL + [C_N]
    names = ["L1", "L2", "L3", "N"]
    sup_w = ["P001", "P002", "P003", "P004"]
    q0_out = ["P010", "P011", "P012", "P013"]
    s.text(30, 128, "SUPPLY", size=13, bold=True)
    s.text(30, 143, "400/230V AC", size=11)
    for i, y in enumerate(ys):
        s.term(70, y)
        s.text(62, y + 4, d.term(sup_w[i], "from"), size=12, bold=True, align="right")
        s.line(70, y, 190, y, stroke=cols4[i], sw=1.6)
        s.wlabel(84, y + 15, sup_w[i])
    # PE from supply
    s.term(70, pey)
    s.text(62, pey + 4, d.term("PE001", "from"), size=12, bold=True, align="right")
    s.pe_pl([(70, pey), (130, pey), (130, 800)])
    s.wlabel(138, 540, "PE001")
    # Q0 disconnector
    hcontact_group(s, ys, 190, 250, mark="iso", cols=cols4)
    for i, y in enumerate(ys):
        s.text(186, y - 5, d.term(sup_w[i], "to"), size=11, align="right")
        s.text(254, y - 5, d.term(q0_out[i], "from"), size=11)
        s.line(250, y, 340, y, stroke=cols4[i], sw=1.6)
        s.wlabel(262, y + 15, q0_out[i])
    dev_label(s, 190, 104, ["Q0", "main switch 4P", "[ADD_RECOMMENDED]"], gap=14)
    # F1 RCCB
    hcontact_group(s, ys, 340, 400, cols=cols4)
    f1_out = split_poles(d.term("P020", "from")) + [d.term("P021", "from")]
    for i, y in enumerate(ys):
        s.text(336, y - 5, d.term(q0_out[i], "to"), size=11, align="right")
        s.text(404, y - 5, f1_out[i], size=11)
    s.rect(330, 276, 80, 26, sw=1.2, fill="#fff")
    s.text(370, 294, "IΔn 30 mA", size=11, align="center")
    s.line(368, 268, 368, 276, sw=1, dash=DASH_MECH)
    dev_label(s, 340, 104, ["F1", "RCCB 4P 30 mA", "type / In TBD"], gap=14)
    # bus
    for i, y in enumerate(ys[:3]):
        s.line(400, y, 1450, y, stroke=PHASE_COL[i], sw=1.6 if False else 2.6)
    s.wlabel(420, ys[2] + 15, "P020")
    s.text(1555, 160, "BUS-L123", size=13, bold=True, align="right")
    s.text(1555, 176, "(L1 / L2 / L3)", size=11, align="right")
    # N to N-BAR
    s.pl([(400, 260), (450, 260), (450, 700)], stroke=C_N, sw=1.6)
    s.wlabel(458, 480, "P021")
    s.line(450, 700, 1460, 700, stroke=C_N, sw=4)
    s.text(458, 690, "N-BAR", size=12, bold=True)
    # PE-BAR
    s.line(110, 800, 520, 800, stroke=C_PE_G, sw=5)
    s.text(150, 790, "PE-BAR", size=12, bold=True)
    s.text(530, 795, "→ PE010/PE012/PE013 X1, PE020 ENCL, C011 0V–PE (TBD): see sheet 04", size=11)

    # ---- F2 + KM2 branch
    fx = [560, 604, 648]
    for i, x in enumerate(fx):
        s.dot(x, ys[i], color=PHASE_COL[i])
        s.line(x, ys[i], x, 330, stroke=PHASE_COL[i], sw=1.6)
    s.wlabel(656, 316, "P030")
    multipole(s, fx, 330, 390, mark="x", cols=PHASE_COL)
    vterm_labels(s, fx, 330, split_poles(d.term("P030", "to")))
    vterm_labels(s, fx, 390, split_poles(d.term("P031", "from")))
    dev_label(s, 668, 352, ["F2", "MCB 3P C", "In TBD"], gap=14)
    phase_lines(s, fx, 390, 450)
    s.wlabel(656, 424, "P031")
    multipole(s, fx, 450, 510, mark="arc", cols=PHASE_COL)
    vterm_labels(s, fx, 450, split_poles(d.term("P031", "to")))
    vterm_labels(s, fx, 510, split_poles(d.term("P032", "from")))
    dev_label(s, 668, 472, ["KM2", "LC1D09BD", "coil: sheet 08"], gap=14)
    phase_lines(s, fx, 510, 570)
    s.wlabel(656, 544, "P032")
    vterm_labels(s, fx, 570, split_poles(d.term("P032", "to")))
    s.text(520, 600, "X1 → general 3~ outgoing circuit", size=11)
    s.text(520, 615, "(role TBD)", size=11)

    # ---- F3 branch (continues on sheet 05)
    gx = [770, 814, 858]
    for i, x in enumerate(gx):
        s.dot(x, ys[i], color=PHASE_COL[i])
        s.line(x, ys[i], x, 330, stroke=PHASE_COL[i], sw=1.6)
    s.wlabel(866, 316, "P040")
    multipole(s, gx, 330, 390, mark="x", cols=PHASE_COL)
    vterm_labels(s, gx, 330, split_poles(d.term("P040", "to")))
    vterm_labels(s, gx, 390, split_poles(d.term("P041", "from")))
    dev_label(s, 878, 352, ["F3", "MCB 3P D", "In TBD"], gap=14)
    phase_lines(s, gx, 390, 450)
    s.wlabel(866, 424, "P041")
    vterm_labels(s, gx, 450, split_poles(d.term("P041", "to")))
    s.text(740, 480, "KM1 → F4 → X1 → M1", size=11, bold=True)
    s.text(740, 495, "continues on sheet 05", size=11)

    # ---- F5 -> G1
    x5 = 980
    s.dot(x5, ys[0], color=C_L1)
    s.line(x5, ys[0], x5, 330, stroke=C_L1, sw=1.6)
    s.wlabel(988, 316, "P050")
    contact(s, x5, 330, x5, 390, mark="x", stroke=C_L1)
    vterm_labels(s, [x5], 330, [d.term("P050", "to")])
    vterm_labels(s, [x5], 390, [d.term("P051", "from")])
    dev_label(s, 1000, 352, ["F5", "MCB 1P 10A", "phase TBD"], gap=14)
    s.line(x5, 390, x5, 480, stroke=C_L1, sw=1.6)
    s.wlabel(988, 440, "P051")
    s.rect(960, 480, 140, 90, fill="#fff")
    s.term(x5, 480)
    s.text(x5 + 8, 496, d.term("P051", "to"), size=11, bold=True)
    s.text(1030, 516, "G1", size=13, bold=True, align="center")
    s.text(1030, 531, "HDR-60-24", size=11, align="center")
    s.text(1030, 546, "24V DC: sheet 06", size=11, align="center")
    gn = 1080
    s.term(gn, 570)
    s.text(gn - 8, 565, d.term("P052", "to"), size=11, bold=True, align="right")
    s.line(gn, 570, gn, 700, stroke=C_N, sw=1.6)
    s.dot(gn, 700, color=C_N)
    s.wlabel(gn + 8, 640, "P052")

    # ---- F6..F9 single-phase circuits
    hx = [1170, 1250, 1330, 1410]
    tags = expand_range(d.term("P061", "to"))       # L.F6..L.F9
    ntags = expand_range(d.term("P062", "to"))      # N.F6..N.F9
    for i, x in enumerate(hx):
        s.term(x, 246)
        s.line(x, 250, x, 330, stroke=C_L1, sw=1.6, dash=DASH_TBD)
        contact(s, x, 330, x, 390, mark="x", stroke=C_L1)
        vterm_labels(s, [x], 330, [d.term("P060", "to")])
        vterm_labels(s, [x], 390, [d.term("P061", "from")])
        s.text(x + 16, 366, f"F{6 + i}", size=12, bold=True)
        s.line(x, 390, x, 570, stroke=C_L1, sw=1.6)
        vterm_labels(s, [x], 570, [tags[i]])
        nx = x + 30
        s.term(nx, 610)
        s.text(nx + 7, 614, ntags[i], size=11)
        s.line(nx, 614, nx, 700, stroke=C_N, sw=1.6)
        s.dot(nx, 700, color=C_N)
    s.text(1162, 262, "?", size=12, bold=True, align="right")
    s.wlabel(1178, 300, "P060")
    s.wlabel(1178, 470, "P061")
    s.wlabel(1208, 660, "P062")
    s.text(1440, 262, "phase allocation", size=11)
    s.text(1440, 277, "L1 / L2 / L3 TBD", size=11)
    s.text(1440, 292, "(P060)", size=11)
    s.text(1440, 412, "F6–F8: 1P 10A", size=11)
    s.text(1440, 427, "F9: 1P 16A", size=11)
    s.text(1440, 442, "curve TBD", size=11)
    symbol_legend(s, 1000, 760, ["iso", "x", "arc", "rcd", "mech", "tbd", "term", "dot"])
    s.text(1440, 520, "X1 → 1-phase", size=11)
    s.text(1440, 535, "outgoing circuits", size=11)
    s.text(1440, 550, "(roles TBD)", size=11)
    s.frame([
        ("Terminal designations exactly as in CONNECTIONS.csv; 'TBD' items must be decided before build.",
         "סימוני הדקים לפי CONNECTIONS.csv"),
        "Dashed brown = phase allocation of F6–F9 (and F5, P050 note) still TBD — balance the load.",
        "F9 16A: must NOT be assigned to 1.5 mm² wire automatically — requires calculation (BOM).",
        "F1 RCCB (30 mA) protects persons; it is NOT overload / short-circuit protection.",
        "PE for the outgoing circuits: PE012 (X1 PE.2) and PE013 (X1 PE.F6-PE.F9) — see sheet 04.",
        "BUS-L123 = distribution busbar / comb (BOM, ADD_RECOMMENDED) — rating TBD.",
    ])
    return s


# --------------------------------------------------------------------------
# 04 feed and protection
# --------------------------------------------------------------------------
def wire_table(s, x, y, wids, title, row_h=21):
    """Table of wires straight from CONNECTIONS.csv (device / terminal / source)."""
    cols = [0, 50, 104, 158, 226, 300]
    w = 412
    s.text(x, y, title, size=12, bold=True)
    y += 10
    n = len(wids)
    s.rect(x, y, w, (n + 1) * row_h, sw=1)
    hdr = ["Wire", "From", "", "To", "", "Terminal source"]
    for c, hname in zip(cols, hdr):
        if hname:
            s.text(x + 6 + c, y + 15, hname, size=11, bold=True)
    s.line(x, y + row_h, x + w, y + row_h, sw=1)
    for i, wid in enumerate(wids):
        r = s.d.c(wid)
        s.wire(wid)
        yy = y + (i + 1) * row_h + 15
        vals = [wid, r["from_device"], r["from_terminal"], r["to_device"], r["to_terminal"], r["terminal_source"]]
        for j, (c, v) in enumerate(zip(cols, vals)):
            s.text(x + 6 + c, yy, v, size=11, bold=(j in (1, 3)),
                   color="#b00000" if (j == 5 and v == "TBD") else "#000")
    return y + (n + 1) * row_h


def page_04(d, out):
    s = Svg(d, "04", "04_feed_and_protection.svg", out, "FEED, PROTECTION AND EARTHING",
            "הזנה, הגנה והארקה",
            "Q0 main switch, F1 RCCB, N-BAR, PE-BAR and protective-earth connections")
    for t in ("SUPPLY", "Q0", "F1", "BUS-L123", "N-BAR", "PE-BAR", "G1", "X1", "ENCL", "X2"):
        s.tag(t)
    xs = [190, 260, 330, 400]
    cols4 = PHASE_COL + [C_N]
    sup_w = ["P001", "P002", "P003", "P004"]
    q0_out = ["P010", "P011", "P012", "P013"]
    pex = 640
    s.text(30, 92, "SUPPLY 3~ + N + PE, 400/230V AC (from building distribution — TBD)", size=11, italic=True)
    for i, x in enumerate(xs):
        s.term(x, 120)
        s.text(x, 112 - 0, d.term(sup_w[i], "from"), size=12, bold=True, align="center")
        s.line(x, 124, x, 190, stroke=cols4[i], sw=1.8)
        s.wlabel(x + 8, 160, sup_w[i])
    s.term(pex, 120)
    s.text(pex, 112, d.term("PE001", "from"), size=12, bold=True, align="center")
    # Q0
    multipole(s, xs, 190, 270, mark="iso", cols=cols4)
    for i, x in enumerate(xs):
        vterm_labels(s, [x], 190, [d.term(sup_w[i], "to")])
        vterm_labels(s, [x], 270, [d.term(q0_out[i], "from")])
        s.line(x, 274, x, 350, stroke=cols4[i], sw=1.8)
        s.wlabel(x + 8, 316, q0_out[i])
    dev_label(s, 30, 212, ["Q0", "main switch 4P", "In TBD", "[ADD_RECOMMENDED]"], gap=14)
    # F1
    multipole(s, xs, 350, 430, cols=cols4)
    f1_out = split_poles(d.term("P020", "from")) + [d.term("P021", "from")]
    for i, x in enumerate(xs):
        vterm_labels(s, [x], 350, [d.term(q0_out[i], "to")])
        vterm_labels(s, [x], 430, [f1_out[i]])
    s.rect(180, 448, 240, 26, sw=1.2, fill="#fff")
    s.text(300, 466, "IΔn = 30 mA — type AC/A/F TBD", size=11, align="center")
    s.line(418, 390, 440, 390, sw=1, dash=DASH_MECH)
    s.line(440, 390, 440, 461, sw=1, dash=DASH_MECH)
    s.line(440, 461, 420, 461, sw=1, dash=DASH_MECH)
    dev_label(s, 30, 372, ["F1", "RCCB 4P 30 mA", "In TBD"], gap=14)
    # outputs
    for i, x in enumerate(xs[:3]):
        s.line(x, 434, x, 448, stroke=PHASE_COL[i], sw=1.8)
        s.line(x, 474, x, 520, stroke=PHASE_COL[i], sw=1.8)
        s.arrow(x, 520, x, 548, stroke=PHASE_COL[i], sw=1.8)
    s.wlabel(338, 506, "P020")
    s.text(260, 566, "→ BUS-L123 (sheet 03)", size=12, bold=True, align="center")
    s.line(400, 434, 400, 448, stroke=C_N, sw=1.8)
    s.line(400, 474, 400, 610, stroke=C_N, sw=1.8)
    s.wlabel(408, 540, "P021")
    s.line(330, 610, 560, 610, stroke=C_N, sw=5)
    s.text(330, 600, "N-BAR", size=12, bold=True)
    s.dot(400, 610, color=C_N)
    for nx, wid in ((450, "P052"), (530, "P062")):
        s.arrow(nx, 610, nx, 660, stroke=C_N, sw=1.6)
    s.wlabel(442, 682, "P052", align="right")
    s.text(442, 698, "→ G1 : " + d.term("P052", "to"), size=11, align="right")
    s.wlabel(538, 682, "P062")
    s.text(538, 698, "→ X1 : " + d.term("P062", "to"), size=11)
    # PE bar and PE connections
    s.pe_pl([(pex, 124), (pex, 760)])
    s.wlabel(pex + 8, 300, "PE001")
    s.line(600, 760, 1150, 760, stroke=C_PE_G, sw=6)
    s.text(590, 765, "PE-BAR", size=13, bold=True, align="right")
    s.dot(pex, 760, color=C_PE_G)
    drops = [(650, "PE010"), (770, "PE012"), (890, "PE013"), (1010, "PE020"), (1130, "C011")]
    for x, wid in drops:
        if wid == "C011":
            s.line(x, 760, x, 830, stroke=C_PE_G, sw=1.8, dash=DASH_TBD)
            s.dot(x, 760, color=C_PE_G)
        else:
            s.pe_pl([(x, 760), (x, 830)])
            s.dot(x, 760, color=C_PE_G)
        s.term(x, 834)
        s.wlabel(x + 8, 800, wid)
    s.text(650, 856, "X1", size=12, bold=True, align="center")
    s.text(650, 872, d.term("PE010", "to"), size=11, align="center")
    s.text(650, 888, "motor (sheet 05)", size=11, align="center")
    s.text(770, 856, "X1", size=12, bold=True, align="center")
    s.text(770, 872, d.term("PE012", "to"), size=11, align="center")
    s.text(770, 888, "3~ outgoing", size=11, align="center")
    s.text(890, 856, "X1", size=12, bold=True, align="center")
    s.text(890, 872, d.term("PE013", "to"), size=11, align="center")
    s.text(890, 888, "1~ outgoing", size=11, align="center")
    s.text(1010, 856, "ENCL", size=12, bold=True, align="center")
    s.text(1010, 872, "enclosure + door", size=11, align="center")
    s.text(1010, 888, "(flexible bridge)", size=11, align="center")
    s.text(1130, 856, "X2 : " + d.term("C011", "from"), size=12, bold=True, align="center")
    s.text(1130, 872, "0V–PE (PELV)", size=11, align="center", color="#b00000")
    s.text(1130, 888, "decision TBD", size=11, align="center", color="#b00000")
    # table + info
    yb = wire_table(s, 1138, 92, ["P001", "P002", "P003", "P004", "PE001", "P010", "P011", "P012", "P013",
                                  "P020", "P021", "P052", "P062", "PE010", "PE012", "PE013", "PE020", "C011"],
                    "Feed and earthing wires (CONNECTIONS.csv)")
    bx, by = 1138, yb + 24
    s.rect(bx, by, 412, 200, sw=1.2)
    info = [("Protection notes (BOM)", True),
            ("F1 RCCB protects persons (30 mA). It is NOT overload", False),
            ("or short-circuit protection — MCBs F2–F9 do that.", False),
            ("Type A RCCB preferred for electronic loads —", False),
            ("teacher / electrician decision.", False),
            ("Q0: RCCB and MCBs are no substitute for a", False),
            ("dedicated main isolator (recommended purchase).", False)]
    for i, (ln, b) in enumerate(info):
        s.text(bx + 12, by + 22 + i * 17, ln, size=12 if b else 11.5, bold=b)
    he = ["ממסר הפחת אינו מגן מפני עומס יתר או קצר",
          "סוג A מועדף — להחלטת מורה/חשמלאי",
          "חובה פס הארקה בכל לוח"]
    for i, ln in enumerate(he):
        s.text(bx + 398, by + 146 + i * 18, ln, size=11.5, align="right")
    s.frame([
        ("PE conductors are green-yellow; PE-BAR must be bonded to the enclosure and door (PE020).",
         "גשר הארקה גמיש לדלת"),
        "C011 (0V–PE bridge, PELV) is a design decision still TBD — drawn dashed, not to be assumed.",
        "Q0 / F1 N terminals: in and out are both marked 'N' in CONNECTIONS.csv — verify on device.",
        "Supply rating, cable cross-sections and Q0 / F1 rated currents are TBD.",
        "Outgoing-circuit PE: PE012 → X1 PE.2 (3~ via KM2), PE013 → X1 PE.F6-PE.F9 (1~ circuits).",
    ])
    return s


# --------------------------------------------------------------------------
# 05 motor circuit
# --------------------------------------------------------------------------
def page_05(d, out):
    s = Svg(d, "05", "05_motor_circuit.svg", out, "MOTOR CIRCUIT — POWER + HARDWIRED COIL CHAIN",
            "מעגל מנוע — כוח ושרשרת סליל קשיחה",
            "F3 → KM1 → F4 → X1 → M1 (400V) and Q1 → S0 NC-1 → F4 95-96 → KM1 A1-A2 (24V DC)")
    for t in ("BUS-L123", "F3", "KM1", "F4", "X1", "M1", "PE-BAR", "K1", "S0", "X2", "F12"):
        s.tag(t)
    xs = [170, 230, 290]
    Y = dict(bus=(110, 130, 150), f3=(205, 275), km=(345, 415), f4=(480, 540), x1=(610,), m1=(690,))
    # ---- busbar
    s.text(30, 92, "BUS-L123 (from F1, sheet 03)", size=11, italic=True)
    for i, (y, c) in enumerate(zip(Y["bus"], PHASE_COL)):
        s.line(110, y, 340, y, stroke=c, sw=2.4)
        s.text(102, y + 4, f"L{i + 1}", size=11, align="right", bold=True)
        s.dot(xs[i], y, color=c)
    for i, x in enumerate(xs):
        s.line(x, Y["bus"][i], x, Y["f3"][0], stroke=PHASE_COL[i], sw=1.6)
    # ---- F3
    a, b = Y["f3"]
    s.wlabel(298, 188, "P040")
    multipole(s, xs, a, b, mark="x", cols=PHASE_COL)
    vterm_labels(s, xs, a, split_poles(d.term("P040", "to")))
    vterm_labels(s, xs, b, split_poles(d.term("P041", "from")))
    dev_label(s, 30, a + 20, ["F3", "MCB 3P curve D", "In: TBD"], gap=14)
    # ---- KM1 main contacts
    a2, b2 = Y["km"]
    phase_lines(s, xs, b, a2)
    s.wlabel(298, (b + a2) / 2 + 4, "P041")
    multipole(s, xs, a2, b2, mark="arc", cols=PHASE_COL)
    vterm_labels(s, xs, a2, split_poles(d.term("P041", "to")))
    vterm_labels(s, xs, b2, split_poles(d.term("P042", "from")))
    dev_label(s, 30, a2 + 20, ["KM1", "LC1D09BD", "main contacts"], gap=14)
    # ---- F4 thermal overload (direct mount under KM1)
    a3, b3 = Y["f4"]
    phase_lines(s, xs, b2, a3)
    s.wlabel(298, b2 + 22, "P042")
    s.text(336, b2 + 22, "KM1 → F4 (direct mount):", size=11)
    s.text(336, b2 + 38, d.term("P042", "to"), size=11, align="left")
    for x in xs:
        thermal(s, x, a3, x, b3)
    s.rect(150, a3 + 8, 160, b3 - a3 - 16, sw=1, dash=DASH_MECH)
    vterm_labels(s, xs, b3, split_poles(d.term("P043", "from")))
    dev_label(s, 30, a3 + 14, ["F4", "overload LRD", "range TBD"], gap=14)
    # ---- X1 motor terminals
    x1y = Y["x1"][0]
    phase_lines(s, xs, b3, x1y)
    s.wlabel(298, (b3 + x1y) / 2 + 4, "P043")
    vterm_labels(s, xs, x1y, split_poles(d.term("P043", "to")))
    dev_label(s, 30, x1y - 4, ["X1", "terminals", "[ADD_RECOMMENDED]"], gap=14)
    # ---- motor cable to M1
    m1y = Y["m1"][0]
    phase_lines(s, xs, x1y, m1y)
    s.wlabel(298, (x1y + m1y) / 2 + 4, "P044")
    s.text(336, (x1y + m1y) / 2 + 4, "motor cable (cross-section TBD)", size=11)
    vterm_labels(s, xs, m1y, split_poles(d.term("P044", "to")))
    mcx, mcy, mr = 230, 790, 44
    for i, x in enumerate(xs):
        ang = math.radians([-130, -90, -50][i])
        ex, ey = mcx + mr * math.cos(ang), mcy + mr * math.sin(ang)
        s.pl([(x, m1y), (x, m1y + 14), (ex, ey)], stroke=PHASE_COL[i], sw=1.6)
    motor(s, mcx, mcy, mr)
    dev_label(s, 30, 780, ["M1", "3~ motor", "data TBD"], gap=14)
    # ---- PE
    px = 560
    s.line(520, 560, 640, 560, sw=4)
    s.text(580, 550, "PE-BAR", size=11, bold=True, align="center")
    s.pe_pl([(px, 560), (px, x1y)])
    s.term(px, x1y)
    s.wlabel(px + 8, (560 + x1y) / 2 + 4, "PE010")
    s.text(px + 8, x1y + 4, d.term("PE010", "to"), size=11, align="left")
    s.pe_pl([(px, x1y + 4), (px, mcy), (mcx + mr, mcy)])
    s.wlabel(px + 8, 736, "PE011")
    s.text(px + 8, 751, "→ M1 : " + d.term("PE011", "to") + "  (PE core of motor cable)", size=11)

    # ---- control chain (24V DC)
    cx = 900
    s.text(cx - 8, 98, "+24V via F12 out", size=11, align="right")
    s.wlabel(cx + 8, 98, "C008")
    s.text(cx + 52, 98, "(COM grouping TBD)", size=11)
    s.line(cx, 104, cx, 124)
    s.term(cx, 124)
    s.text(cx - 8, 128, d.term("C008", "to"), size=11, align="right")
    s.rect(cx - 30, 136, 210, 92, sw=1.2, dash="10 3 2 3")
    contact(s, cx, 124, cx, 240, kind="NO", gap=26)
    dev_label(s, cx + 30, 165, ["K1", "Zelio SR3B261BD", "relay output Q1"], gap=15)
    s.term(cx, 240)
    s.text(cx - 8, 244, d.term("O001", "from"), size=12, bold=True, align="right")
    # O001 -> S0 NC-1
    s.wlabel(cx + 8, 290, "O001")
    s.term(cx, 335)
    s.text(cx - 8, 339, d.term("O001", "to"), size=11, align="right")
    contact(s, cx, 335, cx, 405, kind="NC")
    s.term(cx, 405)
    s.text(cx - 8, 409, d.term("O002", "from"), size=11, align="right")
    dev_label(s, cx + 30, 356, ["S0  EMERGENCY STOP", "NC-1 block — hardwired", "in series with KM1 coil"], gap=14)
    # O002 -> F4 95-96
    s.wlabel(cx + 8, 445, "O002")
    s.term(cx, 475)
    s.text(cx - 8, 479, d.term("O002", "to"), size=12, align="right")
    contact(s, cx, 475, cx, 545, kind="NC")
    s.term(cx, 545)
    s.text(cx - 8, 549, d.term("O003", "from"), size=12, align="right")
    dev_label(s, cx + 30, 496, ["F4  overload relay", "auxiliary NC 95-96", "opens on overload"], gap=14)
    s.line(310, 510, 868, 510, sw=1, dash=DASH_MECH)
    s.text(590, 502, "F4 thermal trip operates 95-96 (mechanical link)", size=11, align="center", italic=True)
    # O003 -> KM1 coil
    s.wlabel(cx + 8, 590, "O003")
    s.term(cx, 625)
    s.text(cx - 8, 629, d.term("O003", "to"), size=12, bold=True, align="right")
    coil(s, cx, 625, cx, 705)
    s.term(cx, 705)
    s.text(cx - 8, 709, d.term("O004", "from"), size=12, bold=True, align="right")
    dev_label(s, cx + 30, 652, ["KM1  coil 24V DC", "operates main contacts", "1/L1-2/T1, 3/L2-4/T2, 5/L3-6/T3"], gap=14)
    # O004 -> X2 0V
    s.wlabel(cx + 8, 745, "O004")
    s.term(cx, 785)
    s.text(cx - 8, 789, "X2", size=12, bold=True, align="right")
    s.text(cx + 8, 789, d.term("O004", "to"), size=12, bold=True)
    s.line(cx, 789, cx, 800)
    s.line(cx - 40, 800, cx + 40, 800, sw=2.4)
    s.text(cx, 818, "0V (G1 −V)", size=11, align="center")

    # ---- safety emphasis box
    bx, by, bw, bh = 1130, 96, 425, 250
    s.rect(bx, by, bw, bh, stroke="#b00000", sw=2.4)
    L = bx + 14
    s.text(L, by + 24, "HARDWIRED SAFETY CHAIN", size=14, bold=True, color="#b00000")
    en = ["E-stop S0 (NC-1) and overload F4 (95-96) are wired",
          "in SERIES with the KM1 coil, after PLC output Q1.",
          "They cut the coil even if the PLC fails or its",
          "Q1 relay contact welds closed. The PLC only",
          "monitors: S0 NC-2 → I4, F4 97-98 → I5, KM1 13-14 → I6."]
    for i, ln in enumerate(en):
        s.text(L, by + 48 + i * 17, ln, size=12)
    he = ["שרשרת בטיחות בחיווט קשיח",
          "מפסק החירום וממסר עומס היתר בטור לסליל KM1",
          "עצירת חירום ועומס יתר מנתקים את הסליל גם אם ה-PLC תקול",
          "ה-PLC רק מנטר (ראו גיליון 07)"]
    R = bx + bw - 14
    for i, ln in enumerate(he):
        s.text(R, by + 150 + i * 22, ln, size=12.5 if i else 13, bold=(i == 0), align="right")

    # ---- monitoring cross-reference
    tx, ty = 1130, 385
    s.text(tx, ty, "Monitoring contacts (drawn on sheet 07):", size=12, bold=True)
    rows = [("S0 NC-2", "→ I4  ESTOP_OK", "I007 / I008"),
            ("F4 97-98", "→ I5  OL_TRIPPED", "I009 / I010"),
            ("KM1 13-14", "→ I6  KM1_FB", "I011 / I012")]
    for i, (a, b, c) in enumerate(rows):
        yy = ty + 24 + i * 20
        s.text(tx + 6, yy, a, size=12, bold=True)
        s.text(tx + 95, yy, b, size=12)
        s.text(tx + 255, yy, c, size=11, italic=True, color="#555")

    # ---- what-if table
    ty = 515
    s.text(tx, ty, "What happens if ... (design intent)", size=12, bold=True)
    s.text(tx + 425, ty, "מה קורה אם...", size=12, bold=True, align="right")
    cases = [("E-stop pressed", "NC-1 opens → KM1 drops (no PLC needed)",
              "NC-2 opens → I4 = 0 → PLC latches fault"),
             ("Motor overload", "95-96 opens → KM1 drops",
              "97-98 closes → I5 = 1 → PLC latches fault"),
             ("PLC fault / Q1 welded", "S0 and F4 still open the coil chain",
              "KM1 13-14 → I6 detects contactor state"),
             ("Q1 = 1 but KM1 not closed", "I6 stays 0 → feedback fault",
              "see IO_MAP I6 notes (T2 / T3)")]
    for i, (a, b, c) in enumerate(cases):
        yy = ty + 26 + i * 56
        s.text(tx + 6, yy, a, size=12, bold=True)
        s.text(tx + 18, yy + 17, b, size=11.5)
        s.text(tx + 18, yy + 33, c, size=11.5)
    s.frame([
        ("Motor data (power, In, star/delta) is TBD → F3 rating, F4 range and cable size are TBD.",
         "נתוני המנוע חסרים — חסם תכנוני"),
        "Markings 95-96 / 97-98 / 13-14 / A1-A2 are standard LRD / LC1D markings — verify on the real device.",
        "SUP-KM (CONDITIONAL) coil suppressor only if KM1 has no built-in suppressor — not drawn (no wire row).",
        "KM1 coil chain per IO_MAP Q1: Q1 → S0 (NC-1) → F4 (95-96) → KM1 A1 ; KM1 A2 → 0V.",
        "Motor PE: PE-BAR → X1 PE.M (PE010) → M1 PE (PE011, PE core of the motor cable).",
        "עצירת חירום ועומס יתר מנתקים את הסליל גם אם ה-PLC תקול (IO_MAP Q1)",
    ])
    return s


# --------------------------------------------------------------------------
# 06 24V power supply
# --------------------------------------------------------------------------
def page_06(d, out):
    s = Svg(d, "06", "06_power_supply_24v.svg", out, "24V DC AND 5V CONTROL SUPPLY",
            "ספק פיקוד 24V DC ו-5V",
            "G1 → F10–F13 → K1 supply, +24V_IN, output COM, +24V_SENS ; G2 LM2596 → X3 5V")
    for t in ("F5", "N-BAR", "G1", "F10", "F11", "F12", "F13", "K1", "X2", "G2", "X3", "B6", "KA2",
              "B1", "B2", "B3", "B4", "KA1", "B5", "PE-BAR"):
        s.tag(t)
    # ---- G1
    gx0, gx1, gy0, gy1 = 200, 360, 150, 330
    s.rect(gx0, gy0, gx1 - gx0, gy1 - gy0, sw=1.6, fill="#fff")
    for i, ln in enumerate(["G1", "Mean Well HDR-60-24", "24V DC 2.5A 60W", "input 85-264VAC"]):
        s.text(280, 222 + i * 17, ln, size=13 if i == 0 else 11, bold=(i == 0), align="center")
    s.text(208, 204, d.term("P051", "to"), size=12, bold=True)
    s.text(208, 284, d.term("P052", "to"), size=12, bold=True)
    s.text(352, 204, d.term("C001", "from"), size=12, bold=True, align="right")
    s.text(352, 284, d.term("C003", "from"), size=12, bold=True, align="right")
    s.text(40, 196, "F5 : " + d.term("P051", "from"), size=12, bold=True)
    s.line(100, 200, gx0, 200, stroke=C_L1, sw=1.6)
    s.term(gx0, 200)
    s.wlabel(112, 215, "P051")
    s.text(40, 276, "N-BAR", size=12, bold=True)
    s.line(100, 280, gx0, 280, stroke=C_N, sw=1.6)
    s.term(gx0, 280)
    s.wlabel(112, 295, "P052")
    s.text(40, 320, "230V AC from sheet 03", size=11, italic=True)
    # ---- +V bus and fuses
    bus = 440
    s.term(gx1, 200)
    s.line(gx1, 200, bus, 200, sw=1.8)
    s.dot(bus, 200)
    rows = [(130, "F10", "C001", "C002"), (230, "F11", "C005", "C006"),
            (330, "F12", "C007", "C008"), (430, "F13", "C009", "C010")]
    s.line(bus, 130, bus, 430, sw=2.2)
    s.text(bus - 8, 118, "+24V (G1 +V)", size=11, bold=True, align="right")
    for y, tag, win, wout in rows:
        s.dot(bus, y)
        s.line(bus, y, 520, y)
        s.wlabel(450, y + 16, win)
        fuse(s, 520, y, 600, y)
        s.term(520, y)
        s.term(600, y)
        s.text(520, y - 9, d.term(win, "to"), size=11, align="center")
        s.text(600, y - 9, d.term(wout, "from"), size=11, align="center")
        s.text(560, y + 26, tag, size=12.5, bold=True, align="center")
        s.text(560, y + 41, "rating TBD", size=11, align="center", color="#555")
        s.wlabel(612, y + 16, wout)
    # F10 -> K1 supply
    kx0, kx1 = 1290, 1500
    s.line(600, 130, kx0, 130)
    s.rect(kx0, 104, kx1 - kx0, 66, sw=1.6)
    s.term(kx0, 130)
    s.text(kx0 + 8, 134, d.term("C002", "to"), size=12)
    s.term(kx1, 155)
    s.text(kx1 - 8, 159, d.term("C004", "to"), size=12, align="right")
    s.text((kx0 + kx1) / 2 + 24, 96, "K1  Zelio SR3B261BD — supply", size=12, bold=True, align="center")
    s.text(kx0 - 8, 122, "PLC supply", size=11, align="right")
    # F11 -> X2 +24V_IN
    s.line(600, 230, 700, 230)
    s.term(700, 230)
    s.text(712, 226, "X2 : " + d.term("C006", "to"), size=12, bold=True)
    s.text(712, 244, "→ dry-contact inputs S0–S3, F4 97, KM1 13, B1–B5, KA2 (sheet 07)", size=11)
    # F12 -> K1 output COM
    s.line(600, 330, 700, 330)
    s.term(700, 330)
    s.text(712, 334, "K1", size=12, bold=True)
    s.text(736, 334, d.term("C008", "to"), size=12, align="left")
    s.text(712, 352, "output COM — grouping TBD, verify on device (sheet 08)", size=11, color="#b00000")
    # F13 -> X2 +24V_SENS -> sensors
    s.line(600, 430, 700, 430)
    s.term(700, 430)
    s.text(712, 426, "X2 : " + d.term("C010", "to"), size=12, bold=True)
    s.line(704, 430, 760, 430)
    s.line(760, 430, 760, 540)
    taps = [(470, "S001"), (505, "S003"), (540, "S006")]
    for y, wid in taps:
        s.dot(760, y) if y != 540 else None
    s.arrow(760, 470, 800, 470)
    s.wlabel(808, 474, "S001")
    s.text(850, 474, "→ B1–B4", size=11, bold=True)
    s.text(912, 474, d.term("S001", "to"), size=11, align="left")
    s.text(1010, 474, "(sheet 09)", size=11)
    s.arrow(760, 505, 800, 505, dash=DASH_COND)
    s.wlabel(808, 509, "S003")
    s.text(850, 509, "→ KA1", size=11, bold=True)
    s.text(900, 509, d.term("S003", "to"), size=11)
    s.text(950, 509, "→ B5 (CONDITIONAL, sheet 10)", size=11)
    # ---- G2 LM2596
    g2x0, g2x1, g2y0, g2y1 = 1000, 1130, 525, 640
    s.line(760, 540, 760, 560)
    s.line(760, 560, g2x0, 560)
    s.wlabel(808, 576, "S006")
    s.rect(g2x0, g2y0, g2x1 - g2x0, g2y1 - g2y0, sw=1.6, fill="#fff")
    s.term(g2x0, 560)
    s.term(g2x0, 615)
    s.term(g2x1, 560)
    s.term(g2x1, 615)
    s.text(g2x0 + 7, 564, d.term("S006", "to"), size=11, bold=True)
    s.text(g2x0 + 7, 619, d.term("S007", "from"), size=11, bold=True)
    s.text(g2x1 - 7, 564, d.term("E001", "from"), size=11, bold=True, align="right")
    s.text(g2x1 - 7, 619, d.term("E002", "from"), size=11, bold=True, align="right")
    s.text((g2x0 + g2x1) / 2, 586, "G2  LM2596", size=12, bold=True, align="center")
    s.text((g2x0 + g2x1) / 2, 600, "step-down → 5V", size=11, align="center")
    # IN- to 0V bus
    zb = 700
    s.pl([(g2x0, 615), (970, 615), (970, zb)])
    s.dot(970, zb)
    s.wlabel(962, 660, "S007", align="right")
    # 5V rails
    r5, r0 = 505, 665
    s.pl([(g2x1, 560), (1170, 560), (1170, r5), (1200, r5)])
    s.pl([(g2x1, 615), (1170, 615), (1170, r0), (1200, r0)])
    s.wlabel(1178, 545, "E001")
    s.wlabel(1178, 640, "E002")
    s.term(1200, r5)
    s.term(1200, r0)
    s.text(1200, r5 - 9, "X3 : " + d.term("E001", "to"), size=12, bold=True, align="center")
    s.text(1200, r0 + 20, "X3 : " + d.term("E002", "to"), size=12, bold=True, align="center")
    s.line(1204, r5, 1540, r5, sw=1.8)
    s.line(1204, r0, 1540, r0, sw=1.8)
    devs = [(1260, 1370, "B6", "MQ-2 module", ("E003", "E004")), (1410, 1530, "KA2", "5V relay module", ("E005", "E006"))]
    for x0, x1, tag, name, (wp, wn) in devs:
        s.rect(x0, 545, x1 - x0, 80, sw=1.4, fill="#fff")
        vx = x0 + 20
        s.dot(vx, r5)
        s.line(vx, r5, vx, 545)
        s.dot(vx, r0)
        s.line(vx, 625, vx, r0)
        s.text(vx + 6, 560, d.term(wp, "to"), size=11, bold=True)
        s.text(vx + 6, 619, d.term(wn, "to"), size=11, bold=True)
        s.text((x0 + x1) / 2 + 10, 584, tag, size=12.5, bold=True, align="center")
        s.text((x0 + x1) / 2 + 10, 599, name, size=11, align="center")
        s.wlabel(vx + 6, 530, wp)
        s.wlabel(vx + 6, 650, wn)
    s.text(1300, 495 - 6, "+5V rail → B6 / KA2 (sheet 10)", size=11)
    # ---- 0V bus
    s.term(gx1, 280)
    s.pl([(gx1, 280), (400, 280), (400, zb)], sw=1.8)
    s.line(400, zb, 1540, zb, sw=2.6)
    s.wlabel(408, 500, "C003")
    s.term(480, zb)
    s.text(480, zb - 9, "X2 : " + d.term("C003", "to"), size=12, bold=True, align="center")
    s.pl([(kx1, 155), (1540, 155), (1540, zb)], sw=1.4)
    s.dot(1540, zb)
    s.wlabel(1532, 300, "C004", align="right")
    s.text(420, 806, "0V returns: K1 −, KM1/KM2 A2, H1–H5 X2, HA1 −, KA1 A2,", size=11)
    s.text(420, 822, "B1–B5 −, G2 IN− (sheets 05, 07–10)", size=11)
    # C011
    s.line(440, zb, 440, 760, stroke=C_PE_G, sw=1.6, dash=DASH_TBD)
    s.dot(440, zb)
    s.term(440, 764)
    s.wlabel(448, 745, "C011")
    s.text(452, 768, "→ PE-BAR : 0V–PE bridge (PELV) — decision TBD", size=11, color="#b00000")
    # ---- isolation warning
    wx, wy = 1000, 735
    s.rect(wx, wy, 545, 92, stroke="#b00000", sw=2)
    s.text(wx + 12, wy + 22, "LM2596 is NOT isolated — 0V shared", size=13, bold=True, color="#b00000")
    s.text(wx + 12, wy + 40, "X3 0V5 = X2 0V through G2 (IN− / OUT− common). Adjust G2 to 5V", size=11)
    s.text(wx + 12, wy + 55, "and MEASURE before connecting B6 / KA2 (E001 note).", size=11)
    s.text(wx + 533, wy + 80, "הממיר LM2596 אינו מבודד — ה-0V משותף ל-24V", size=12, bold=True,
           align="right", color="#b00000")
    s.frame([
        ("Fuse terminals F10–F13 (ADD_RECOMMENDED) give selectivity: a sensor short does not drop the PLC.",
         ""),
        ("HDR-60 has overload protection but no separation between branches (BOM). Fuse values TBD.", ""),
        ("Use dark blue for +24V and dark blue/white for 0V (CSV suggestion) — never light blue (= N).",
         "ספק 24V — נתונים ממפיצים, לאמת בדף נתונים"),
        ("C011 0V–PE (PELV) bridge: decision TBD — drawn dashed. G1 / K1 data from distributors — verify.",
         ""),
        ("5V circuit is SELV only; keep exposed PCB modules (G2, B6, KA2) on carriers, insulated.", ""),
    ])
    return s


# --------------------------------------------------------------------------
# 07 PLC inputs
# --------------------------------------------------------------------------
def page_07(d, out):
    s = Svg(d, "07", "07_plc_inputs.svg", out, "PLC INPUTS I1 – IG (ZELIO K1)",
            "כניסות הבקר I1 – IG (Zelio K1)",
            "Dry contacts fed from X2 +24V_IN (fuse F11) to K1 inputs; ID–IG spare")
    for t in ("K1", "X2", "F11"):
        s.tag(t)
    rail = 130
    y0, pitch = 128, 50
    kx, kw = 890, 175
    inputs = [r for r in d.io_rows if r["direction"] == "IN"]
    # header
    s.text(rail - 6, 92, "F11 out", size=11, align="right")
    s.wlabel(rail + 8, 92, "C006")
    s.line(rail, 96, rail, 106)
    s.term(rail, 109)
    s.text(rail + 8, 113, "X2 : " + d.term("C006", "to"), size=12, bold=True)
    s.text(390, 100, "field contact", size=11, align="center", italic=True)
    s.text(kx + kw / 2, 88, "K1  Zelio SR3B261BD", size=13, bold=True, align="center")
    s.text(1555, 92, "1 = / כשל-בטוח (IO_MAP)", size=11, align="right", italic=True)
    s.rect(kx, 98, kw, len(inputs) * pitch + 8, sw=1.6)
    last_wired = y0
    for i, io in enumerate(inputs):
        addr = io["address"]
        y = y0 + i * pitch
        s.term(kx, y)
        s.text(kx + 10, y + 5, addr, size=13, bold=True)
        s.text(kx + 42, y + 5, io["signal"], size=11.5)
        wires = input_wires(d, addr)
        if wires is None:
            s.text(kx - 12, y + 4, "SPARE", size=12, bold=True, align="right", color="#555")
            s.text(kx - 70, y + 4, io["description_he"] if addr != "IG" else "רזרבה",
                   size=11.5, align="right", color="#555")
            if io["notes_he"]:
                s.text(1555, y + 4, io["notes_he"], size=11, align="right", color="#555")
            continue
        win, wout = wires
        dev = wout["from_device"]
        s.tag(dev)
        if dev == "S0":
            s.tag("S0-NC2")
        last_wired = y
        kind = "NC" if io["contact_or_terminal"].startswith("NC") else "NO"
        qm = "סוג מגע TBD" in io["contact_or_terminal"]
        s.dot(rail, y)
        s.line(rail, y, 360, y)
        s.wlabel(rail + 10, y + 15, win["wire_id"])
        contact(s, 360, y, 420, y, kind=kind, qmark=qm, gap=26)
        s.text(354, y - 6, win["to_terminal"], size=11, align="right")
        s.text(426, y - 6, wout["from_terminal"], size=11, align="left")
        s.text(390, y + 25, dev, size=12, bold=True, align="center")
        s.line(420, y, kx, y)
        s.wlabel(440, y + 15, wout["wire_id"])
        s.text(580, y - 6, IN_EN[addr], size=11.5)
        if io["status"] == "ADD_RECOMMENDED":
            s.text(498, y + 15, "[ADD_RECOMMENDED]", size=11, color="#b00000")
        s.text(kx - 8, y + 15, io["description_he"], size=11.5, align="right")
        s.text(1555, y - 4, "1 = " + io["logic_1_means_he"], size=11, align="right")
        if io["fail_safe_he"] not in ("—", ""):
            s.text(1555, y + 13, "כשל-בטוח: " + io["fail_safe_he"], size=11, align="right", color="#444")
    s.line(rail, 109, rail, last_wired)
    s.frame([
        ("K1 supply: '+' from F10 out (C002), '-' from X2 0V (C004) — see sheet 06.", "הזנת K1 — ראו גיליון 06"),
        ("Inputs IB–IG are analog-capable (0-10V); IB and IC are used here as digital inputs.", ""),
        ("Contact terminal markings to be verified on each device; '?' = contact type TBD (XH-W3001).",
         "הדקי XH-W3001 — לקרוא מהלוח"),
        ("I2 (S2) and I4 (S0 NC-2) are fail-safe NC circuits: a broken wire reads as STOP / E-STOP.", ""),
        ("Temperature modules read 'OK' on loss of supply (not fail-safe) — see IO_MAP I7–IA.", ""),
        ("Spare inputs ID, IE, IF, IG are not wired. IG: future MQ-2 AO only after checking range.", ""),
    ])
    return s


# --------------------------------------------------------------------------
# 08 PLC outputs
# --------------------------------------------------------------------------
OUT_EN = {
    "Q1": "KM1 coil via hardwired chain (motor contactor)",
    "Q2": "KM2 coil — general 3~ circuit contactor (role TBD)",
    "Q3": "H1 lamp GREEN — motor running (feedback confirmed)",
    "Q4": "H2 lamp WHITE — READY / healthy (blinks in warm-up)",
    "Q5": "H3 lamp YELLOW — temperature warning",
    "Q6": "H4 lamp AMBER — fault latched / reset required",
    "Q7": "H5 lamp RED — hazard active or E-stop pressed",
    "Q8": "HA1 buzzer — new unacknowledged fault",
    "Q9": "KA1 interface relay — smoke detector reset pulse",
}
LAMP_FILL = {"H1": "#bfeebf", "H2": "#ffffff", "H3": "#fff29a", "H4": "#ffc77a", "H5": "#ffaaaa"}


def page_08(d, out):
    s = Svg(d, "08", "08_plc_outputs.svg", out, "PLC OUTPUTS Q1 – QA (ZELIO K1)",
            "יציאות הבקר Q1 – QA (Zelio K1)",
            "K1 relay outputs to KM1 (hardwired chain), KM2, H1–H5, HA1, KA1 (conditional); QA spare")
    for t in ("K1", "X2", "F12"):
        s.tag(t)
    outputs = [r for r in d.io_rows if r["direction"] == "OUT"]
    y0, pitch = 168, 72
    bx0, bx1 = 110, 330
    com = 160
    bus0v = 1440
    n = len(outputs)
    # F12 feed and COM
    s.text(com - 8, 88, "F12 out", size=11, align="right")
    s.wlabel(com + 8, 88, "C008")
    s.line(com, 94, com, 108)
    s.term(com, 108)
    s.rect(bx0, 116, bx1 - bx0, n * pitch + 44, sw=1.6)
    s.text(com + 8, 112, d.term("C008", "to"), size=12, bold=True)
    s.text(com + 10, 136, "COM (grouping TBD —", size=11, color="#b00000")
    s.text(com + 10, 150, "verify on device)", size=11, color="#b00000")
    s.line(com, 108, com, y0 + (n - 1) * pitch)
    s.text((bx0 + bx1) / 2, 116 + n * pitch + 26, "K1  Zelio SR3B261BD", size=13, bold=True, align="center")
    # 0V bus
    s.text(bus0v, 120, "X2 : 0V", size=12, bold=True, align="center")
    s.text(bus0v, 136, "(G1 −V, C003)", size=11, align="center")
    last = y0
    for i, io in enumerate(outputs):
        addr = io["address"]
        y = y0 + i * pitch
        s.dot(com, y)
        contact(s, com, y, bx1, y, kind="NO", gap=26)
        s.term(bx1, y)
        s.text(bx1 - 8, y - 7, addr, size=13, bold=True, align="right")
        w = output_wires(d, addr)
        if w is None:
            s.text(bx1 + 14, y + 4, "SPARE", size=12, bold=True, color="#555")
            s.text(bx1 + 70, y + 4, io["description_he"], size=11.5, color="#555")
            continue
        wo, wr = w
        load = wo["to_device"]
        s.tag(load)
        cond = io["status"] == "CONDITIONAL"
        dash = DASH_COND if cond else None
        last = y
        lx0, lx1 = 860, 940   # load symbol span
        if addr == "Q1":
            s.tag("S0"); s.tag("F4")
            chain = [d.c("O001"), d.c("O002"), d.c("O003"), d.c("O004")]
            s.line(bx1, y, 470, y)
            s.wlabel(bx1 + 14, y + 16, "O001")
            contact(s, 470, y, 530, y, kind="NC", gap=26)
            s.text(464, y - 6, chain[0]["to_terminal"], size=11, align="right")
            s.text(536, y - 6, chain[1]["from_terminal"], size=11)
            s.text(500, y + 25, "S0", size=12, bold=True, align="center")
            s.line(530, y, 680, y)
            s.wlabel(560, y + 16, "O002")
            contact(s, 680, y, 740, y, kind="NC", gap=26)
            s.text(674, y - 6, chain[1]["to_terminal"], size=12, align="right")
            s.text(746, y - 6, chain[2]["from_terminal"], size=12)
            s.text(710, y + 25, "F4", size=12, bold=True, align="center")
            s.line(740, y, lx0, y)
            s.wlabel(770, y + 16, "O003")
            load = chain[2]["to_device"]
            s.tag(load)
            t_in, wr = chain[2]["to_terminal"], chain[3]
        else:
            s.line(bx1, y, lx0, y, dash=dash)
            s.wlabel(bx1 + 14, y + 16, wo["wire_id"])
            t_in = wo["to_terminal"]
        # load symbol
        if load == "HA1":
            buzzer(s, lx0, y, lx1, y)
            ex = 13
        elif load.startswith("H"):
            lamp(s, lx0, y, lx1, y, r=13, fill=LAMP_FILL.get(load, "none"))
            ex = 13
        else:
            coil(s, lx0, y, lx1, y, dash=dash)
            ex = 10
        cxm = (lx0 + lx1) / 2
        s.text(cxm - ex - 22, y - 8, t_in, size=12, align="right")
        s.text(cxm + ex + 22, y - 8, wr["from_terminal"], size=12)
        s.text(cxm, y + 36, load, size=12.5, bold=True, align="center")
        # return to 0V
        s.line(lx1, y, bus0v, y, dash=dash)
        s.dot(bus0v, y)
        s.wlabel(lx1 + 12, y + 16, wr["wire_id"])
        s.text(985, y - 8, OUT_EN[addr], size=11.5)
        s.text(bus0v - 10, y + 16, io["description_he"], size=11.5, align="right")
        if cond:
            s.text(985, y + 34, "[CONDITIONAL] only if B5 latches; without KA1 Q9 is not connected",
                   size=11, color="#b00000")
    s.line(bus0v, 142, bus0v, last, sw=2.2)
    s.frame([
        ("Zelio SR3B261BD outputs are relay contacts; COM grouping is UNKNOWN — one COM drawn (C008 TBD).",
         ""),
        ("Q1 → S0 NC-1 → F4 95-96 → KM1 A1: E-stop and overload cut KM1 even if the PLC fails (sheet 05).",
         ""),
        ("Q2 / KM2 drop-out on hazard is a functional PLC action, NOT a safety function (IO_MAP Q2).", ""),
        ("Lamp / buzzer polarity X1/X2 and +/− to be verified on the devices. Lamp tint = lamp colour.", ""),
        ("Dotted = CONDITIONAL (KA1 / Q9). SUP-KM coil suppressors (CONDITIONAL) not drawn.",
         "מנורות 24V DC — קוטביות לאימות"),
    ])
    return s


# --------------------------------------------------------------------------
# 09 temperature sensors
# --------------------------------------------------------------------------
def page_09(d, out):
    s = Svg(d, "09", "09_temperature_sensors.svg", out, "TEMPERATURE MONITORING B1 – B4",
            "ניטור טמפרטורה B1 – B4",
            "4 × XH-W3001 (24V): supply from +24V_SENS / 0V, relay contacts from +24V_IN to K1 I7–IA")
    for t in ("X2", "K1", "B1", "B2", "B3", "B4", "F11", "F13"):
        s.tag(t)
    ysens, y0v, yin = 120, 150, 600
    s.text(22, ysens + 4, "X2 : " + d.term("S001", "from"), size=12, bold=True)
    s.text(22, y0v + 4, "X2 : " + d.term("S002", "to"), size=12, bold=True)
    s.text(22, yin + 4, "X2 : " + d.term("I013", "from"), size=12, bold=True)
    s.text(22, ysens - 12, "(F13)", size=11, color="#555")
    s.text(22, yin - 12, "(F11)", size=11, color="#555")
    for y in (ysens, y0v, yin):
        s.line(130, y, 1400, y, sw=2)
    zones = [(125, 715, "ZONE A — power section (Rail 1)", "אזור A — חלק הכוח"),
             (805, 1395, "ZONE B — control section (Rail 2)", "אזור B — חלק הפיקוד")]
    for zx0, zx1, en, he in zones:
        s.rect(zx0, 82, zx1 - zx0, 480, sw=1.2, dash="12 4 3 4", stroke="#555")
        s.text(zx0 + 10, 100, en, size=12, bold=True)
        s.text(zx1 - 10, 100, he, size=12, bold=True, align="right")
    mods = [("B1", 150, "I7", "WARNING"), ("B2", 440, "I8", "ALARM"),
            ("B3", 830, "I9", "WARNING"), ("B4", 1120, "IA", "ALARM")]
    kx0, kx1, ky0, ky1 = 125, 1395, 680, 760
    s.rect(kx0, ky0, kx1 - kx0, ky1 - ky0, sw=1.6)
    s.text(kx0 + 10, ky1 - 12, "K1  Zelio SR3B261BD (inputs)", size=12, bold=True)
    for tag, x0, addr, level in mods:
        zone = "A" if tag in ("B1", "B2") else "B"
        win, wout = input_wires(d, addr)
        assert wout["from_device"] == tag
        io = d.io[addr]
        # supply
        xp, xm = x0 + 60, x0 + 200
        s.dot(xp, ysens)
        s.line(xp, ysens, xp, 230)
        s.term(xp, 230)
        s.dot(xm, y0v)
        s.line(xm, y0v, xm, 230)
        s.term(xm, 230)
        s.wlabel(xp + 6, 195, "S001")
        s.wlabel(xm + 6, 195, "S002")
        s.rect(x0, 234, 260, 206, sw=1.6)
        s.text(x0 + 10, 252, d.term("S001", "to"), size=11, align="left")
        s.text(x0 + 250, 252, d.term("S002", "from"), size=11, align="right")
        cx = x0 + 130
        lines = [tag, "XH-W3001 (24V version)", f"ZONE {zone} — {level}", "setpoint: TBD",
                 "terminals: TBD — read from board"]
        for i, ln in enumerate(lines):
            s.text(cx, 285 + i * 16, ln, size=14 if i == 0 else 11, bold=(i in (0, 2)), align="center")
        # relay contact inside module (U shape)
        xi, xo, yc = x0 + 110, x0 + 170, 408
        s.line(xi, 440, xi, yc)
        s.line(xo, yc, xo, 440)
        contact(s, xi, yc, xo, yc, kind="NO", qmark=True, gap=24)
        s.text(cx, 382, "relay contact (type TBD)", size=11, align="center", italic=True)
        s.term(xi, 440)
        s.term(xo, 440)
        s.text(xi - 6, 462, win["to_terminal"], size=11, align="right")
        s.text(xo + 6, 462, wout["from_terminal"], size=11, align="left")
        # probe
        px = x0 + 12
        s.line(px, 440, px, 492)
        s.rect(px - 7, 492, 14, 30, sw=1.4, fill="#fff")
        s.line(px - 10, 526, px + 10, 488, sw=1)
        s.text(px + 14, 508, "NTC probe", size=11)
        s.text(px + 14, 523, f"in zone {zone}", size=11)
        # contact wiring
        s.line(xi, 444, xi, yin)
        s.dot(xi, yin)
        s.line(xo, 444, xo, ky0)
        s.wlabel(xi + 6, 545, win["wire_id"])
        s.wlabel(xo + 6, 545, wout["wire_id"])
        s.term(xo, ky0)
        s.text(xo, ky0 + 20, addr, size=13, bold=True, align="center")
        s.text(xo, ky0 + 36, io["signal"], size=11, align="center")
    # side table
    tx = 1412
    s.text(tx, 230, "Input map", size=12, bold=True)
    for i, (tag, _, addr, level) in enumerate(mods):
        zone = "A" if tag in ("B1", "B2") else "B"
        s.text(tx, 252 + i * 18, f"{addr}  {tag}  zone {zone}", size=11)
        s.text(1560, 252 + i * 18, level.lower(), size=11, align="right")
    s.text(tx, 340, "Setpoints: TBD", size=11, bold=True, color="#b00000")
    s.text(tx, 356, "(not set here)", size=11)
    s.text(1560, 390, "ספי הטמפרטורה TBD", size=11.5, align="right")
    s.text(1560, 408, "הדקים — לקרוא מהלוח", size=11.5, align="right")
    s.frame([
        ("XH-W3001 has no official manufacturer datasheet: terminals and contact type TBD — check the board.",
         ""),
        ("Mode C (cooling) is stated for B1 in IO_MAP (I7); assume the same for B2–B4 only after checking.", ""),
        ("Not fail-safe: loss of module supply reads as 'temperature OK' (IO_MAP I7–IA).",
         "אובדן מתח למודול נקרא כ'תקין'"),
        ("Supply S001 / S002 is one CSV row each for B1-B4 (parallel). Contacts are fed from +24V_IN (F11).",
         ""),
        ("Modules are bare PCBs: mount on DIN carriers (CARRIER), probes routed to their zones.", ""),
    ])
    return s


# --------------------------------------------------------------------------
# 10 smoke and gas
# --------------------------------------------------------------------------
def page_10(d, out):
    s = Svg(d, "10", "10_smoke_gas.svg", out, "SMOKE DETECTOR B5 AND GAS SENSOR B6",
            "גלאי עשן B5 וחיישן גז B6",
            "B5 supply via KA1 NC (conditional), alarm → IB ; MQ-2 B6 DO → KA2 IN, KA2 COM-NO → IC")
    for t in ("X2", "X3", "K1", "B5", "KA1", "B6", "KA2", "G2"):
        s.tag(t)
    yin, ysens = 120, 150
    s.text(22, yin + 4, "X2 : +24V_IN", size=12, bold=True)
    s.text(22, ysens + 4, "X2 : +24V_SENS", size=12, bold=True)
    s.line(140, yin, 1400, yin, sw=2)
    s.line(140, ysens, 200, ysens, sw=2)
    # ---- KA1 NC (conditional) in B5 supply
    kx = 200
    s.dot(kx, ysens)
    s.line(kx, ysens, kx, 200, dash=DASH_COND)
    s.wlabel(kx + 8, 182, "S003")
    s.term(kx, 200)
    s.text(kx - 8, 204, d.term("S003", "to"), size=11, align="right")
    contact(s, kx, 200, kx, 260, kind="NC", dash=DASH_COND)
    s.term(kx, 260)
    s.text(kx - 8, 264, d.term("S004", "from"), size=11, align="right")
    s.text(kx + 18, 228, "KA1", size=12, bold=True)
    s.text(kx + 18, 243, "[CONDITIONAL]", size=11, color="#b00000")
    s.line(kx, 264, kx, 340, dash=DASH_COND)
    s.wlabel(kx + 8, 305, "S004")
    # ---- B5 box
    bx0, bx1, by0, by1 = 150, 470, 340, 480
    s.rect(bx0, by0, bx1 - bx0, by1 - by0, sw=1.6)
    s.term(kx, by0)
    s.text(kx - 8, by0 - 6, d.term("S004", "to"), size=11, align="right")
    cx = 400
    s.dot(cx, yin)
    s.line(cx, yin, cx, by0)
    s.wlabel(cx + 8, 240, "I021")
    s.term(cx, by0)
    s.text(cx + 8, by0 - 6, d.term("I021", "to"), size=11, align="left")
    contact(s, cx, by0 + 4, cx, by1 - 4, kind="NO", gap=30)
    s.term(cx, by1)
    s.text(cx + 8, by1 + 18, d.term("I022", "from"), size=11, align="left")
    s.term(kx, by1)
    s.text(kx - 8, by1 + 18, d.term("S005", "from"), size=11, align="right")
    for i, ln in enumerate(["B5", "smoke detector 4-wire", "12-24V (verify)", "enclosure ceiling"]):
        s.text(285, 384 + i * 17, ln, size=14 if i == 0 else 11, bold=(i == 0), align="center")
    # B5 - to 0V, NO to IB
    s.line(kx, by1 + 4, kx, 640)
    s.wlabel(kx + 8, 560, "S005")
    s.term(kx, 640)
    s.text(kx, 660, "X2 : " + d.term("S005", "to"), size=12, bold=True, align="center")
    s.line(cx, by1 + 4, cx, 580)
    s.wlabel(cx + 8, 530, "I022")
    s.rect(330, 580, 260, 60, sw=1.6)
    s.term(cx, 580)
    s.text(cx, 600, d.term("I022", "to"), size=13, bold=True, align="center")
    s.text(cx, 616, d.io["IB"]["signal"], size=11, align="center")
    s.text(500, 616, "K1 (input)", size=12, bold=True, align="center")
    # ---- KA1 coil (conditional)
    qx = 640
    s.text(qx, 192, "K1 : " + d.term("O019", "from"), size=12, bold=True, align="center")
    s.term(qx, 200)
    s.line(qx, 204, qx, 240, dash=DASH_COND)
    s.wlabel(qx + 8, 226, "O019")
    s.term(qx, 240)
    s.text(qx - 8, 244, d.term("O019", "to"), size=12, align="right")
    coil(s, qx, 240, qx, 300, dash=DASH_COND)
    s.term(qx, 300)
    s.text(qx - 8, 304, d.term("O020", "from"), size=12, align="right")
    s.text(qx + 28, 266, "KA1 coil", size=12, bold=True)
    s.text(qx + 28, 281, "24V DC", size=11)
    s.line(qx, 304, qx, 340, dash=DASH_COND)
    s.wlabel(qx + 8, 326, "O020")
    s.term(qx, 340)
    s.text(qx, 360, "X2 : " + d.term("O020", "to"), size=12, bold=True, align="center")
    s.text(qx - 100, 392, "KA1 coil opens its NC 11-12 →", size=11, italic=True)
    s.text(qx - 100, 407, "B5 power cut = detector reset", size=11, italic=True)
    s.text(qx - 100, 422, "(Q9 pulse, sheet 08)", size=11, italic=True)
    # ---- no-KA1 alternative box
    ax, ay = 30, 690
    s.rect(ax, ay, 730, 100, stroke="#b00000", sw=1.6)
    s.text(ax + 12, ay + 22, "Alternative without KA1 (if B5 does NOT latch until power-off):", size=12, bold=True,
           color="#b00000")
    s.text(ax + 12, ay + 41, "X2 +24V_SENS connects directly to B5 '+' (S003 note); KA1 not fitted; Q9 / O019 / O020", size=11)
    s.text(ax + 12, ay + 57, "not connected. Dotted items on this sheet exist ONLY if KA1 is fitted.", size=11)
    s.text(ax + 718, ay + 85, "בלי KA1 — גלאי העשן מוזן ישירות, והיציאה Q9 לא מחוברת", size=12,
           align="right")

    # ---- MQ-2 / KA2 (5V)
    r5, r0 = 200, 520
    s.text(822, r5 + 4, "X3 : " + d.term("E003", "from"), size=12, bold=True, align="right")
    s.text(822, r0 + 4, "X3 : " + d.term("E004", "from"), size=12, bold=True, align="right")
    s.text(822, r5 + 20, "(G2, sheet 06)", size=11, align="right", color="#555")
    s.line(830, r5, 1290, r5, sw=2)
    s.line(830, r0, 1290, r0, sw=2)
    # B6
    b0, b1 = 860, 1040
    s.rect(b0, 260, b1 - b0, 180, sw=1.6)
    vx = 900
    s.dot(vx, r5)
    s.line(vx, r5, vx, 260)
    s.term(vx, 260)
    s.wlabel(vx + 8, 232, "E003")
    s.text(vx, 278, d.term("E003", "to"), size=11, bold=True, align="center")
    s.dot(vx, r0)
    s.line(vx, 440, vx, r0)
    s.term(vx, 440)
    s.wlabel(vx + 8, 482, "E004")
    s.text(vx, 432, d.term("E004", "to"), size=11, bold=True, align="center")
    for i, ln in enumerate(["B6", "MQ-2 module", "warm-up required", "not an approved", "gas detector"]):
        s.text(955, 322 + i * 15, ln, size=14 if i == 0 else 11, bold=(i == 0), align="center")
    s.term(b1, 300)
    s.text(b1 - 7, 304, d.term("E007", "from"), size=11, bold=True, align="right")
    s.term(b1, 410)
    s.text(b1 - 7, 425, "AO", size=11, bold=True, align="right")
    s.line(b1 + 4, 410, b1 + 26, 410, stroke="#888")
    s.line(b1 + 22, 404, b1 + 32, 416, stroke="#888")
    s.line(b1 + 22, 416, b1 + 32, 404, stroke="#888")
    s.text(b1 + 40, 404, "AO — not connected", size=11, bold=True, color="#555")
    s.text(b1 + 40, 419, "future: IG (analog)", size=11, color="#555")
    s.text(b1 + 40, 434, "only after check", size=11, color="#555")
    # DO -> KA2 IN
    k0, k1 = 1230, 1440
    s.line(b1 + 4, 300, k0, 300)
    s.wlabel((b1 + k0) / 2, 292, "E007", align="center")
    s.text((b1 + k0) / 2, 318, "active level TBD", size=11, color="#b00000", align="center")
    s.rect(k0, 260, k1 - k0, 180, sw=1.6)
    s.term(k0, 300)
    s.text(k0 + 7, 304, d.term("E007", "to"), size=11, bold=True)
    kv = 1270
    s.dot(kv, r5)
    s.line(kv, r5, kv, 260)
    s.term(kv, 260)
    s.wlabel(kv + 8, 232, "E005")
    s.text(kv - 8, 254, d.term("E005", "to"), size=11, bold=True, align="right")
    s.dot(kv, r0)
    s.line(kv, 440, kv, r0)
    s.term(kv, 440)
    s.wlabel(kv + 8, 482, "E006")
    s.text(kv - 8, 458, d.term("E006", "to"), size=11, bold=True, align="right")
    for i, ln in enumerate(["KA2", "5V relay module", "coil 5V", "COM / NO / NC"]):
        s.text(1320, 340 + i * 15, ln, size=14 if i == 0 else 11, bold=(i == 0), align="center")
    cx2 = 1400
    s.dot(cx2, yin)
    s.line(cx2, yin, cx2, 260)
    s.wlabel(cx2 + 8, 190, "I023")
    s.term(cx2, 260)
    s.text(cx2 + 10, 254, d.term("I023", "to"), size=11, bold=True)
    contact(s, cx2, 264, cx2, 436, kind="NO", gap=30)
    s.term(cx2, 440)
    s.text(cx2 + 10, 458, d.term("I024", "from"), size=11, bold=True)
    s.line(cx2, 444, cx2, 580)
    s.wlabel(cx2 + 8, 540, "I024")
    s.rect(1300, 580, 250, 60, sw=1.6)
    s.term(cx2, 580)
    s.text(cx2, 600, d.term("I024", "to"), size=13, bold=True, align="center")
    s.text(cx2, 616, d.io["IC"]["signal"], size=11, align="center")
    s.text(1490, 616, "K1 (input)", size=12, bold=True, align="center")
    # info
    ix, iy = 830, 690
    s.rect(ix, iy, 725, 100, sw=1.2)
    s.text(ix + 12, iy + 22, "Gas channel notes", size=12, bold=True)
    s.text(ix + 12, iy + 41, "MQ-2 is an educational sensor, NOT an approved gas detector. GAS is masked during", size=11)
    s.text(ix + 12, iy + 57, "warm-up (T1). Threshold = potentiometer on the module. Sensor body gets hot.", size=11)
    s.text(ix + 713, iy + 85, "רמת ההפעלה של מודול הממסר (Active LOW/HIGH) — TBD", size=12, align="right")
    s.frame([
        ("B5: check 24V operation, current draw and whether it latches until power-off (BOM).",
         "לבדוק אם הגלאי ננעל"),
        ("IB and IC are analog-capable inputs used here as digital inputs (IO_MAP).", ""),
        ("G2 / X3 5V is NOT isolated: X3 0V5 is common with X2 0V (sheet 06).", "הממיר לא מבודד"),
        ("B5 and KA2 contact terminal names are TBD / to verify on the real devices.", ""),
        ("Dotted = CONDITIONAL (KA1). Final location of B6 depends on gas type (TBD).", ""),
    ])
    return s


# --------------------------------------------------------------------------
# 11 alarm system
# --------------------------------------------------------------------------
ALARM_EN = {
    "H2": ("WHITE", "READY / healthy (blinks during warm-up)"),
    "H1": ("GREEN", "Motor running (feedback confirmed)"),
    "H3": ("YELLOW", "Temperature warning"),
    "H4": ("AMBER", "Fault latched / reset required"),
    "H5": ("RED", "Hazard active or E-stop pressed"),
    "HA1": ("BUZZER", "New unacknowledged fault"),
}


def page_11(d, out):
    s = Svg(d, "11", "11_alarm_system.svg", out, "ALARM SYSTEM — LAMPS AND BUZZER",
            "מערכת התראה — נורות וזמזם",
            "K1 outputs Q3–Q8 → H1–H5 indicator lamps and HA1 buzzer, with meaning table")
    for t in ("K1", "X2", "F12"):
        s.tag(t)
    door = [r["tag"] for r in d.layout if r["zone"] == "DOOR" and r["tag"] in ALARM_EN]
    out_of = {}
    for r in d.io_rows:
        if r["direction"] == "OUT":
            out_of[r["tag"]] = r
    xs = [270 + i * 158 for i in range(len(door))]
    # K1 box with COM bus
    s.rect(120, 92, xs[-1] + 90 - 120, 118, sw=1.6)
    s.text(128, 86, "K1  Zelio SR3B261BD — relay outputs", size=12, bold=True)
    s.text(70, 112, "F12", size=11, align="right")
    s.wlabel(70, 128, "C008", align="right")
    s.line(76, 110, 120, 110)
    s.text(130, 132, d.term("C008", "to"), size=11, align="left")
    s.text(130, 147, "(grouping TBD)", size=11, color="#b00000")
    s.line(120, 110, xs[-1], 110, sw=1.6)
    for x, tag in zip(xs, door):
        io = out_of[tag]
        addr = io["address"]
        wo, wr = output_wires(d, addr)
        s.tag(tag)
        s.dot(x, 110)
        contact(s, x, 110, x, 210, kind="NO", gap=26)
        s.term(x, 210)
        s.text(x - 10, 165, addr, size=13, bold=True, align="right")
        s.line(x, 214, x, 300)
        s.wlabel(x + 8, 258, wo["wire_id"])
        s.term(x, 300)
        s.text(x - 8, 304, wo["to_terminal"], size=12, align="right")
        if tag == "HA1":
            buzzer(s, x, 300, x, 380, r=16, side=-1)
        else:
            lamp(s, x, 300, x, 380, r=16, fill=LAMP_FILL[tag])
        s.term(x, 380)
        s.text(x - 8, 384, wr["from_terminal"], size=12, align="right")
        s.text(x + 26, 336, tag, size=13, bold=True)
        s.text(x + 26, 352, ALARM_EN[tag][0], size=11)
        s.line(x, 384, x, 450)
        s.wlabel(x + 8, 422, wr["wire_id"])
        s.dot(x, 450)
    s.line(120, 450, xs[-1] + 40, 450, sw=2.2)
    s.text(112, 454, "X2 : 0V", size=12, bold=True, align="right")
    # behaviour box
    bx, by = 1180, 92
    s.rect(bx, by, 375, 358, sw=1.2)
    s.text(bx + 12, by + 22, "Behaviour (design intent, IO_MAP)", size=12, bold=True)
    lines = ["• Lamps are 24V DC, door-mounted (22 mm).",
             "• H2 blinks only during sensor warm-up",
             "  — limits wear of the output relay.",
             "• H1 lights only when KM1 feedback (I6)",
             "  confirms the contactor is closed.",
             "• RESET (S3) while a fault is still active",
             "  = acknowledge: silences HA1 only.",
             "• RESET is never a START command.",
             "• Lamp and buzzer polarity (X1/X2, +/−)",
             "  to be verified on the devices."]
    for i, ln in enumerate(lines):
        s.text(bx + 12, by + 46 + i * 18, ln, size=11.5)
    s.text(bx + 363, by + 245 + 85, "איפוס כשהתקלה פעילה = אישור (השתקת זמזם)", size=11.5, align="right")
    # meaning table
    tx, ty, rh = 30, 500, 44
    colx = [0, 90, 225, 395, 820]
    tw = 1525
    s.text(tx, ty - 12, "Signal meaning table", size=13, bold=True)
    s.text(tx + tw, ty - 12, "טבלת משמעות האותות", size=13, bold=True, align="right")
    s.rect(tx, ty, tw, rh * (len(door) + 1), sw=1.4)
    hdr = ["Device", "Colour", "K1 output", "Meaning", ""]
    for c, h in zip(colx, hdr):
        if h:
            s.text(tx + c + 10, ty + 27, h, size=12, bold=True)
    s.text(tx + tw - 10, ty + 27, "משמעות", size=12, bold=True, align="right")
    for c in colx[1:]:
        s.line(tx + c, ty, tx + c, ty + rh * (len(door) + 1), sw=0.8)
    for i, tag in enumerate(door):
        yy = ty + rh * (i + 1)
        s.line(tx, yy, tx + tw, yy, sw=0.8)
        io = out_of[tag]
        col, mean = ALARM_EN[tag]
        s.text(tx + 10, yy + 28, tag, size=13, bold=True)
        if tag == "HA1":
            buzzer(s, tx + 104, yy + 26, tx + 134, yy + 26, r=9, side=1)
        else:
            s.circle(tx + 118, yy + 22, 10, fill=LAMP_FILL[tag])
        s.text(tx + 140, yy + 27, col, size=12)
        s.text(tx + colx[2] + 10, yy + 27, io["address"] + "  " + io["signal"], size=12)
        s.text(tx + colx[3] + 10, yy + 27, mean, size=12.5)
        s.text(tx + tw - 10, yy + 27, io["description_he"], size=12.5, align="right")
    s.frame([
        ("Lamp colours follow IO_MAP / LAYOUT: H1 green, H2 white, H3 yellow, H4 amber, H5 red.",
         "צבעי הנורות לפי IO_MAP"),
        ("Order left-to-right follows the DOOR rows of LAYOUT.csv (H2, H1, H3, H4, H5, HA1).", ""),
        ("Output COM grouping of the Zelio is TBD (C008) — one COM drawn.", ""),
        ("Fault latching, reset and buzzer logic live in the PLC program (06_PLC_Logic).", ""),
    ])
    return s


# --------------------------------------------------------------------------
# 12 buttons and E-stop
# --------------------------------------------------------------------------
def push_actuator(s, mid, mush=False, dx=36):
    x, y = mid
    ax = x + dx
    s.line(x, y, ax, y, sw=1, dash=DASH_MECH)
    if mush:
        pts = [(ax + 14 * math.sin(math.radians(a)) * 0 + 0, 0) for a in range(1)]
        dome = []
        for i in range(13):
            a = math.radians(-90 + 15 * i)
            dome.append((ax + 15 * math.cos(a), y + 15 * math.sin(a)))
        s.pl(dome + [dome[0]], sw=1.6)
    else:
        s.pl([(ax + 6, y - 10), (ax, y - 10), (ax, y + 10), (ax + 6, y + 10)], sw=1.6)
    return ax


def page_12(d, out):
    s = Svg(d, "12", "12_buttons_estop.svg", out, "PUSHBUTTONS AND EMERGENCY STOP",
            "לחצנים ועצירת חירום",
            "S1 START (NO), S2 STOP (NC), S3 RESET (NO), S0 E-stop with NC-1 (hardwired) and NC-2 (→ I4)")
    for t in ("X2", "K1", "S1", "S2", "S3", "S0", "S0-NC2", "F4", "F11"):
        s.tag(t)
    bus = 130
    s.text(22, bus + 4, "X2 : +24V_IN", size=12, bold=True)
    s.text(22, bus - 12, "(F11)", size=11, color="#555")
    s.line(130, bus, 900, bus, sw=2)
    cols = [(220, "I1", "S1", "START", "NO"), (420, "I2", "S2", "STOP", "NC"),
            (620, "I3", "S3", "RESET", "NO"), (820, "I4", "S0", "E-STOP NC-2", "NC")]
    ky0 = 470
    s.rect(150, ky0, 750, 70, sw=1.6)
    s.text(160, ky0 + 60, "K1  Zelio SR3B261BD (inputs)", size=12, bold=True)
    mids = {}
    for x, addr, tag, fn, kind in cols:
        win, wout = input_wires(d, addr)
        assert wout["from_device"] == tag
        io = d.io[addr]
        s.dot(x, bus)
        s.line(x, bus, x, 250)
        s.wlabel(x + 8, 175, win["wire_id"])
        s.text(x + 10, 214, f"{tag}  {fn}", size=12.5, bold=True)
        s.text(x + 10, 230, f"{kind} contact", size=11)
        s.term(x, 250)
        s.text(x - 8, 254, win["to_terminal"], size=11, align="right")
        m = contact(s, x, 250, x, 340, kind=kind, gap=30)
        mids[addr] = m
        s.term(x, 340)
        s.text(x - 8, 344, wout["from_terminal"], size=11, align="right")
        if tag != "S0":
            push_actuator(s, m)
        if io["status"] == "ADD_RECOMMENDED":
            s.text(x + 10, 372, "[ADD_RECOMMENDED]", size=11, color="#b00000")
            s.text(x + 10, 387, "recommended purchase", size=11, color="#b00000")
        s.line(x, 344, x, ky0)
        s.wlabel(x + 8, 430, wout["wire_id"])
        s.term(x, ky0)
        s.text(x, ky0 + 20, addr, size=13, bold=True, align="center")
        s.text(x, ky0 + 36, io["signal"], size=11, align="center")
    # S0 NC-1 hardwired
    x1 = 1000
    s.term(x1, 190)
    s.text(x1, 182, "K1 : " + d.term("O001", "from"), size=12, bold=True, align="center")
    s.line(x1, 194, x1, 250)
    s.wlabel(x1 + 8, 225, "O001")
    s.text(x1 + 12, 244, "S0  E-STOP NC-1", size=12.5, bold=True)
    s.term(x1, 250)
    s.text(x1 - 8, 254, d.term("O001", "to"), size=11, align="right")
    m1 = contact(s, x1, 250, x1, 340, kind="NC", gap=30)
    s.term(x1, 340)
    s.text(x1 - 8, 344, d.term("O002", "from"), size=11, align="right")
    s.line(x1, 344, x1, ky0)
    s.wlabel(x1 + 8, 430, "O002")
    s.term(x1, ky0)
    s.text(x1, ky0 + 20, "F4 : " + d.term("O002", "to"), size=12.5, bold=True, align="center")
    s.text(x1, ky0 + 36, "→ 96 → KM1 A1 (sheet 05)", size=11, align="center")
    # mechanical link of both S0 blocks to mushroom head
    m2 = mids["I4"]
    s.line(m2[0], m2[1], m1[0], m1[1], sw=1, dash=DASH_MECH)
    ax = push_actuator(s, m1, mush=True, dx=40)
    s.text(ax + 22, m1[1] - 4, "mushroom head,", size=11)
    s.text(ax + 22, m1[1] + 11, "latching", size=11)
    s.text(830, 405, "S0-NC2 = 2nd NC block", size=11, bold=True)
    # info box
    bx, by = 1180, 92
    s.rect(bx, by, 375, 230, sw=1.2, stroke="#b00000")
    s.text(bx + 12, by + 22, "E-stop S0 — two NC blocks", size=12.5, bold=True, color="#b00000")
    info = ["NC-1: hardwired in series with the KM1 coil",
            "(Q1 → S0 NC-1 → F4 95-96 → KM1 A1).",
            "NC-2: monitored by the PLC on I4 (ESTOP_OK).",
            "The 2nd NC block (S0-NC2) is a recommended",
            "purchase; if the head cannot take a 2nd block,",
            "see the alternative in the check document.",
            "The PLC never replaces the hardwired NC-1."]
    for i, ln in enumerate(info):
        s.text(bx + 12, by + 44 + i * 18, ln, size=11.5)
    s.text(bx + 363, by + 185, "בלוק NC ראשון — חיווט קשיח לסליל KM1", size=11.5, align="right")
    s.text(bx + 363, by + 205, "בלוק NC שני — ניטור בכניסה I4", size=11.5, align="right")
    # table
    tx, ty, rh = 30, 600, 34
    colx = [0, 110, 250, 390, 560, 760, 960]
    tw = 1525
    rows = []
    lay = {r["tag"]: r for r in d.layout if r["zone"] == "DOOR"}
    colour = {"S1": "green (LAYOUT)", "S2": "TBD", "S3": "TBD", "S0": "red mushroom / yellow"}
    for x, addr, tag, fn, kind in cols:
        io = d.io[addr]
        rows.append((tag if tag != "S0" else "S0 NC-2", fn, kind, f"{addr} {io['signal']}",
                     colour[tag], io["status"], io["fail_safe_he"]))
    rows.insert(3, ("S0 NC-1", "E-STOP", "NC", "KM1 coil chain", colour["S0"], "PLANNED", "מנתק את KM1 בחיווט קשיח"))
    hdr = ["Device", "Function", "Contact", "Input / circuit", "Colour", "Status (IO_MAP/BOM)", "כשל-בטוח"]
    s.rect(tx, ty, tw, rh * (len(rows) + 1), sw=1.4)
    for c in colx[1:]:
        s.line(tx + c, ty, tx + c, ty + rh * (len(rows) + 1), sw=0.8)
    for c, h in zip(colx, hdr):
        if is_he(h):
            s.text(tx + tw - 10, ty + 22, h, size=12, bold=True, align="right")
        else:
            s.text(tx + c + 10, ty + 22, h, size=12, bold=True)
    for i, r in enumerate(rows):
        yy = ty + rh * (i + 1)
        s.line(tx, yy, tx + tw, yy, sw=0.8)
        for j, (c, v) in enumerate(zip(colx, r)):
            if j == 6:
                s.text(tx + tw - 10, yy + 22, v, size=12, align="right")
            else:
                s.text(tx + c + 10, yy + 22, v, size=12, bold=(j == 0),
                       color="#b00000" if v == "ADD_RECOMMENDED" else "#000")
    s.frame([
        ("S2 STOP NC is a recommended purchase. If it stays NO: logic inversion and loss of",
         "S2 — מומלץ לרכישה"),
        ("  broken-wire detection (IO_MAP I2; alternative B in PLC_IO_CHECK.md).", ""),
        ("START acts only on a rising edge and only in READY state; RESET is never a start command.", ""),
        ("Contact block terminal markings (NO / NC) to be verified on each block.", ""),
    ])
    return s


# --------------------------------------------------------------------------
# 14 panel layout
# --------------------------------------------------------------------------
LAYOUT_EN = {
    "Q0": "main switch", "F1": "RCCB 30mA", "F2": "MCB 3P C", "F3": "MCB 3P D", "KM1": "contactor",
    "KM2": "contactor", "X1": "power terminals", "G1": "HDR-60-24", "K1": "Zelio SR3B261BD",
    "F10-F13": "fuse terms", "G2": "LM2596", "X2": "control terminals 24V", "B1": "zone A warn",
    "B2": "zone A alarm", "B3": "zone B warn", "B4": "zone B alarm", "KA2": "5V relay", "B6": "MQ-2",
    "X3": "5V terms",
}
RAIL_NAMES = {
    "RAIL1_TOP": ("Rail 1 — power", "פס 1 — כוח"),
    "RAIL2_MID": ("Rail 2 — control 24V", "פס 2 — פיקוד 24V"),
    "RAIL3_BOT": ("Rail 3 — sensors (SELV only)", "פס 3 — חיישנים (SELV בלבד)"),
}
DOOR_EN = {"H1": "GREEN", "H2": "WHITE", "H3": "YELLOW", "H4": "AMBER", "H5": "RED", "HA1": "buzzer",
           "S1": "START", "S2": "STOP NC", "S3": "RESET", "S0": "E-STOP"}
DOOR_FILL = dict(LAMP_FILL, HA1="#dddddd", S1="#bfeebf", S2="#ffffff", S3="#ffffff")


def page_14(d, out):
    s = Svg(d, "14", "14_panel_layout.svg", out, "PANEL LAYOUT — FRONT VIEW",
            "סידור רכיבים בלוח — מבט חזית",
            "3 DIN rails × 700 mm at 1.6 px/mm with LAYOUT.csv widths; door view; ceiling B5")
    k = 1.6
    rail_len = 700
    ex0, ey0, ex1, ey1 = 30, 90, 1216, 905
    s.tag("ENCL")
    s.rect(ex0, ey0, ex1 - ex0, ey1 - ey0, sw=1.6, dash="14 4 3 4")
    s.text(ex0 + 10, ey0 + 18, "ENCL — enclosure interior (size TBD_SPEC, internal width > 700 mm)", size=11.5,
           bold=True)
    s.tag("DIN1"); s.tag("DIN2"); s.tag("DIN3")
    rx0 = 72
    rails = [("RAIL1_TOP", 270), ("RAIL2_MID", 515), ("RAIL3_BOT", 760)]
    dh = 110

    def style(tag):
        st = d.status.get(expand_tag(tag)[0])
        return {"ADD_RECOMMENDED": DASH_ADD, "CONDITIONAL": DASH_COND}.get(st)

    for zone, yc in rails:
        items = sorted([r for r in d.layout if r["zone"] == zone], key=lambda r: int(r["order"]))
        en, he = RAIL_NAMES[zone]
        s.text(rx0, yc - dh / 2 - 12, en, size=13, bold=True)
        s.text(rx0 + rail_len * k, yc - dh / 2 - 12, he, size=13, bold=True, align="right")
        s.rect(rx0 - 10, yc - 28, rail_len * k + 20, 56, sw=1, fill="#d9d9d9", stroke="#888")
        x = rx0
        used = gaps = 0
        for r in items:
            w = float(r["width_mm"]) * k
            tag = r["tag"]
            used += float(r["width_mm"])
            if tag == "GAP":
                gaps += float(r["width_mm"])
                s.rect(x, yc - dh / 2, w, dh, sw=0.8, stroke="#999", fill="#f2f2f2", dash="2 2")
                s.text(x + w / 2, yc + 4, "gap", size=11, align="center", color="#777")
                s.text(x + w / 2, yc + 40, fmt(float(r["width_mm"])), size=11, align="center", color="#777")
                x += w
                continue
            parts = tag.split("+")
            for p_ in parts:
                s.tag(p_)
            main = parts[0]
            s.rect(x, yc - dh / 2, w, dh, sw=1.5, fill="#ffffff", dash=style(main))
            small = w < 40
            s.text(x + w / 2, yc - 16, main if len(parts) == 1 else parts[0], size=11 if small else 12.5,
                   bold=not small, align="center")
            name = LAYOUT_EN.get(tag)
            if name and not small:
                words = name.split(" ")
                if len(name) * 6.2 > w - 6 and len(words) > 1:
                    half = (len(words) + 1) // 2
                    s.text(x + w / 2, yc + 2, " ".join(words[:half]), size=11, align="center")
                    s.text(x + w / 2, yc + 16, " ".join(words[half:]), size=11, align="center")
                else:
                    s.text(x + w / 2, yc + 2, name, size=11, align="center")
            s.text(x + w / 2, yc + 40, fmt(float(r["width_mm"])) + ("" if small else " mm"), size=11,
                   align="center")
            if len(parts) > 1:      # KM1+F4: overload relay hangs below the contactor
                s.rect(x + 4, yc + dh / 2 + 2, w - 8, 34, sw=1.4, fill="#ffffff", dash=style(parts[1]))
                s.text(x + w / 2, yc + dh / 2 + 24, parts[1], size=12, bold=True, align="center")
            x += w
        free = rail_len - used
        s.text(rx0 + rail_len * k, yc + dh / 2 + 18,
               f"used {fmt(used)} mm (incl. gaps {fmt(gaps)} mm) / {rail_len} mm — free {fmt(free)} mm",
               size=11.5, bold=True, align="right")
    # ceiling B5
    for r in d.layout:
        if r["zone"] == "CEILING":
            w = float(r["width_mm"]) * k
            cx = (ex0 + ex1) / 2
            s.tag(r["tag"])
            s.rect(cx - w / 2, ey0 + 34, w, 40, sw=1.5, dash=style(r["tag"]))
            s.text(cx, ey0 + 52, r["tag"] + "  smoke detector", size=12, bold=True, align="center")
            s.text(cx, ey0 + 67, "enclosure ceiling, " + fmt(float(r["width_mm"])) + " mm", size=11,
                   align="center")
    # scale bar
    sx, sy = rx0, 870
    s.line(sx, sy, sx + 100 * k, sy, sw=2)
    for i in range(0, 101, 25):
        s.line(sx + i * k, sy - 5, sx + i * k, sy + 5, sw=1)
    s.text(sx + 100 * k + 10, sy + 4, "100 mm  (scale 1.6 px / mm — widths only, heights not to scale)",
           size=11)
    # ---- door view
    dx0, dy0, dx1, dy1 = 1230, 90, 1555, 600
    s.rect(dx0, dy0, dx1 - dx0, dy1 - dy0, sw=1.6)
    s.text(dx0 + 10, dy0 + 20, "DOOR — front view", size=13, bold=True)
    s.text(dx1 - 10, dy0 + 20, "דלת הלוח", size=13, bold=True, align="right")
    door = sorted([r for r in d.layout if r["zone"] == "DOOR"], key=lambda r: int(r["order"]))
    pos = {}
    lamps = [r for r in door if r["tag"].startswith("H") and r["tag"] != "HA1"]
    rest = [r for r in door if r not in lamps and r["tag"] != "S0"]
    for i, r in enumerate(lamps):
        pos[r["tag"]] = (dx0 + 42 + i * 60, 170)
    for i, r in enumerate(rest):
        pos[r["tag"]] = (dx0 + 42 + i * 80, 310)
    for r in door:
        tag = r["tag"]
        s.tag(tag)
        rr = float(r["width_mm"]) * k / 2
        if tag == "S0":
            cx, cy = (dx0 + dx1) / 2, 450
            s.circle(cx, cy, rr + 12, fill="#fff176")
            s.circle(cx, cy, rr, fill="#ff6b6b", sw=1.8)
            s.text(cx, cy + 5, "S0", size=13, bold=True, align="center")
            s.text(cx, cy + rr + 32, "S0  E-STOP — red mushroom on yellow", size=11.5, bold=True, align="center")
            s.text(cx, cy + rr + 48, "Ø40 mm (verify); 2nd NC block S0-NC2", size=11, align="center")
            s.text(cx, cy + rr + 63, "[ADD_RECOMMENDED] behind the head", size=11, align="center",
                   color="#b00000")
            s.tag("S0-NC2")
            continue
        cx, cy = pos[tag]
        s.circle(cx, cy, rr, fill=DOOR_FILL.get(tag, "#fff"), dash=style(tag), sw=1.6)
        if tag.startswith("H") and tag != "HA1":
            k7 = rr * 0.7071
            s.line(cx - k7, cy - k7, cx + k7, cy + k7, sw=1)
            s.line(cx - k7, cy + k7, cx + k7, cy - k7, sw=1)
        s.text(cx, cy + rr + 18, tag, size=12.5, bold=True, align="center")
        s.text(cx, cy + rr + 33, DOOR_EN[tag], size=11, align="center")
    s.text((dx0 + dx1) / 2, 585, "lamps / buttons: Ø22 mm holes (typical)", size=11, align="center")
    # legend
    lx, ly = 1230, 625
    s.rect(lx, ly, 325, 280, sw=1.2)
    s.text(lx + 12, ly + 20, "LEGEND", size=12.5, bold=True)
    s.text(lx + 313, ly + 20, "מקרא", size=12.5, bold=True, align="right")
    leg = [(None, "#ffffff", "OWNED / PLANNED (BOM)"), (DASH_ADD, "#ffffff", "ADD_RECOMMENDED"),
           (DASH_COND, "#ffffff", "CONDITIONAL"), ("14 4 3 4", "#ffffff", "TBD_SPEC (enclosure)"),
           ("2 2", "#f2f2f2", "gap / ventilation (LAYOUT)"), (None, "#d9d9d9", "DIN rail TS35 (verify)")]
    for i, (dash, fill, lab) in enumerate(leg):
        yy = ly + 36 + i * 28
        s.rect(lx + 14, yy, 50, 18, sw=1.4, dash=dash, fill=fill)
        s.text(lx + 76, yy + 14, lab, size=11.5)
    s.text(lx + 12, ly + 222, "Widths are estimates — verify", size=12, bold=True, color="#b00000")
    s.text(lx + 12, ly + 238, "against real devices.", size=12, bold=True, color="#b00000")
    s.text(lx + 313, ly + 262, "הרוחבים הם הערכה — לאמת מול הרכיבים", size=11.5, align="right")
    s.frame([
        ("Widths from LAYOUT.csv (width_source: ESTIMATE / TYPICAL_VERIFY / HOLE_22MM_TYPICAL).",
         "מידות לפי LAYOUT.csv"),
        ("F4 hangs below KM1 and adds height — check rail-to-rail spacing (LAYOUT note).", ""),
        ("PE-BAR (bottom of enclosure) and N-BAR (near F1) are in BOM but not in LAYOUT.csv — position TBD.",
         ""),
        ("Keep access to K1 USB port (SR2USB01) and display; ventilation space above / below G1.", ""),
        ("Rail 3 is SELV only; bare PCB modules (B1–B4, KA2, B6, G2) sit on DIN carriers (CARRIER).", ""),
    ])
    return s


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    d = Data()
    sch = ROOT / "04_Schematics"
    lay = ROOT / "05_Panel_Layout"
    sch.mkdir(exist_ok=True)
    lay.mkdir(exist_ok=True)
    summary = []
    for fn, target in PAGES:
        s = fn(d, lay if target == "layout" else sch)
        summary.append((s.save(), s))
    all_tags, all_wires = set(), set()
    for path, s in summary:
        all_tags |= s.tags
        all_wires |= s.wires
        print(f"wrote {path.relative_to(ROOT)}  tags={len(s.tags)} wires={len(s.wires)}")
    # cross-check report (tags are validated against BOM.csv and wire ids against
    # CONNECTIONS.csv while drawing - an unknown one raises an error)
    ext = sorted(all_tags & EXTERNAL_TAGS)
    print(f"device tags drawn: {len(all_tags)} (not BOM items, by design: {', '.join(ext)})")
    missing = [w for w in d.conns if w not in all_wires]
    print(f"CONNECTIONS rows drawn: {len(all_wires)} / {len(d.conns)}"
          + (f"; not drawn: {', '.join(missing)}" if missing else ""))
    unused = sorted(t for t in d.status if t not in all_tags)
    print(f"BOM tags not drawn on any sheet: {', '.join(unused) or '-'}")
    return summary


PAGES = [
    (page_02, "sch"), (page_03, "sch"), (page_04, "sch"), (page_05, "sch"), (page_06, "sch"),
    (page_07, "sch"), (page_08, "sch"), (page_09, "sch"), (page_10, "sch"), (page_11, "sch"),
    (page_12, "sch"), (page_14, "layout"),
]

if __name__ == "__main__":
    main()

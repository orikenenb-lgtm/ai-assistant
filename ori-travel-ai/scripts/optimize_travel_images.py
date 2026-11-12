"""Optimize the owner-supplied travel images for the web app (originals are never modified).

Usage (Pillow is in the API venv):
    apps/api/.venv/bin/python -I scripts/optimize_travel_images.py <extracted-zip-images-dir>

For every image it detects real transparency, classifies it (isolated OBJECT vs full SCENE), and writes
WebP files into apps/web/src/assets/travel/:
  * objects: one size (longest side <= 900px), alpha preserved;
  * scenes:  two widths (800 / 1600px, never upscaled) for srcset.
It also writes apps/web/src/assets/travel/manifest.json (sizes, kind, transparency, near-duplicates).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "web" / "src" / "assets" / "travel"

# Descriptive names for the archive files that the app uses (visual review, 2026-11-12).
NAMES = {
    "travel_01": "greek-harbor",
    "travel_02": "alpine-chalet",
    "travel_03": "old-town-couple",
    "travel_04": "tropical-villa",
    "travel_05": "wing-sunset",
    "travel_06": "icon-collage",
    "travel_07": "headphones",
    "travel_08": "suitcase-cream-tall",
    "travel_09": "passport-boarding-pass",
    "travel_10": "poolside-relax",
    "travel_11": "passport-flatlay",
    "travel_12": "family-poolside",
    "travel_13": "pool-diorama",
    "travel_14": "mountain-lake",
    "travel_15": "suitcase-macro",
    "travel_16": "airplane",
    "travel_17": "airplane-clouds",
    "travel_18": "passport-wallet",
    "travel_19": "check-in-cutout",
    "travel_20": "airplane-cloud",
    "travel_21": "suitcase-cream",
    "travel_22": "camera",
    "travel_23": "suitcase-silver",
    "travel_24": "check-in-scene",
    "travel_25": "island-diorama",
    "travel_26": "spa",
    "travel_27": "pool-villa",
    "travel_28": "hat-sunglasses",
}
# Not shipped: collage of small icons (not a hero-quality image), headphones (not travel specific),
# exact duplicates of images already in the app (suitcase 08 = landing hero object, macro 15 = landing macro).
SKIP = {"travel_06", "travel_07", "travel_08", "travel_15"}
# Near-duplicates found by visual review (same scene / object, different framing): kept, but used in different places.
KNOWN_NEAR_DUPLICATES = {"travel_17": ["travel_20"], "travel_19": ["travel_24"], "travel_21": ["travel_08", "travel_23"]}
OBJECT_MAX = 900
SCENE_WIDTHS = (800, 1600)


def transparency(im: Image.Image) -> float:
    if im.mode not in ("RGBA", "LA"):
        return 0.0
    hist = im.getchannel("A").histogram()
    return sum(hist[:16]) / max(1, sum(hist))


def fingerprint(im: Image.Image) -> Image.Image:
    return im.convert("L").resize((16, 9))


def main(src: Path) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    prints: dict[str, Image.Image] = {}
    for path in sorted(src.glob("travel_*.webp")):
        stem = path.stem
        im = Image.open(path)
        im.load()
        alpha = transparency(im)
        kind = "object" if alpha >= 0.15 else "scene"
        entry = {"source": path.name, "name": NAMES.get(stem, stem), "width": im.width, "height": im.height,
                 "mode": im.mode, "transparent_share": round(alpha, 3), "kind": kind, "files": []}
        fp = fingerprint(im)
        for other, ofp in prints.items():
            hist = ImageChops.difference(fp, ofp).histogram()
            diff = sum(i * c for i, c in enumerate(hist)) / (16 * 9)
            if diff < 12:
                entry.setdefault("near_duplicates", []).append(other)
        prints[path.name] = fp
        for other in KNOWN_NEAR_DUPLICATES.get(stem, []):
            entry.setdefault("near_duplicates", []).append(f"{other}.webp")
        if stem in SKIP:
            entry["shipped"] = False
            manifest.append(entry)
            continue
        if kind == "object":
            out = im.convert("RGBA")
            out.thumbnail((OBJECT_MAX, OBJECT_MAX), Image.LANCZOS)
            name = f"{entry['name']}.webp"
            out.save(OUT / name, "WEBP", quality=82, method=6)
            entry["files"].append({"file": name, "width": out.width, "height": out.height})
        else:
            rgb = im.convert("RGB")
            for w in SCENE_WIDTHS:
                w = min(w, rgb.width)
                scaled = rgb.resize((w, round(rgb.height * w / rgb.width)), Image.LANCZOS)
                name = f"{entry['name']}-{w}.webp"
                scaled.save(OUT / name, "WEBP", quality=74, method=6)
                entry["files"].append({"file": name, "width": scaled.width, "height": scaled.height})
        entry["shipped"] = True
        manifest.append(entry)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shipped = [m for m in manifest if m.get("shipped")]
    total = sum((OUT / f["file"]).stat().st_size for m in shipped for f in m["files"])
    print(f"{len(shipped)} images shipped, {len(manifest) - len(shipped)} skipped, {total / 1024:.0f} KiB total")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(Path(sys.argv[1])))

import type { GalleryItem } from "@/types";

/**
 * Gallery items. Until real photos are added, each item renders a glossy
 * lacquer swatch in its `tone`. To add a photo, put it in /public/gallery and set
 * `image: { src: "/gallery/xyz.jpg", width: 1200, height: 1500 }` with a real `alt`.
 */
const pending = "תמונת עבודה תתווסף בקרוב";

export const galleryItems: GalleryItem[] = [
  { id: "g1", alt: "מקום לתמונת עבודה — לק אדום", category: "לק ג׳ל", swatchName: "Cherry Lacquer", description: pending, shape: "tall", tone: "cherry" },
  { id: "g2", alt: "מקום לתמונת עבודה — כרום", category: "כרום", swatchName: "Liquid Chrome", description: pending, shape: "square", tone: "chrome" },
  { id: "g3", alt: "מקום לתמונת עבודה — Nail Art", category: "Nail Art", swatchName: "Hot Fuchsia", description: pending, shape: "square", tone: "fuchsia" },
  { id: "g4", alt: "מקום לתמונת עבודה — בנייה", category: "בנייה", swatchName: "Midnight Noir", description: pending, shape: "tall", tone: "noir" },
  { id: "g5", alt: "מקום לתמונת עבודה — גוון ניוד", category: "ניוד", swatchName: "Bare Nude", description: pending, shape: "wide", tone: "nude" },
  { id: "g6", alt: "מקום לתמונת עבודה — זהב", category: "Nail Art", swatchName: "Gold Leaf", description: pending, shape: "square", tone: "gold" },
  { id: "g7", alt: "מקום לתמונת עבודה — שזיף", category: "לק ג׳ל", swatchName: "Deep Plum", description: pending, shape: "square", tone: "plum" },
  { id: "g8", alt: "מקום לתמונת עבודה — פרנץ׳", category: "פרנץ׳", swatchName: "Red French", description: pending, shape: "wide", tone: "cherry" },
];

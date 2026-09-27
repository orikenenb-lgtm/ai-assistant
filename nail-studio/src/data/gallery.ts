import type { GalleryItem } from "@/types";

/**
 * Gallery items. Until real photos are added, each item renders an iridescent
 * swatch in its `tone`. To add a photo, put it in /public/gallery and set
 * `image: { src: "/gallery/xyz.jpg", width: 1200, height: 1500 }` with a real `alt`.
 */
const pending = "תמונת עבודה תתווסף בקרוב";

export const galleryItems: GalleryItem[] = [
  { id: "g1", alt: "מקום לתמונת עבודה — כרום הולוגרפי", category: "כרום", swatchName: "Aura Chrome", description: pending, shape: "tall", tone: "aura" },
  { id: "g2", alt: "מקום לתמונת עבודה — לק ג׳ל סגול", category: "לק ג׳ל", swatchName: "Violet Glaze", description: pending, shape: "square", tone: "violet" },
  { id: "g3", alt: "מקום לתמונת עבודה — ורוד", category: "Nail Art", swatchName: "Orchid", description: pending, shape: "square", tone: "orchid" },
  { id: "g4", alt: "מקום לתמונת עבודה — בנייה", category: "בנייה", swatchName: "Noir", description: pending, shape: "tall", tone: "noir" },
  { id: "g5", alt: "מקום לתמונת עבודה — תכלת", category: "לק ג׳ל", swatchName: "Ice Blue", description: pending, shape: "wide", tone: "ice" },
  { id: "g6", alt: "מקום לתמונת עבודה — כרום כסוף", category: "כרום", swatchName: "Silver Chrome", description: pending, shape: "square", tone: "chrome" },
  { id: "g7", alt: "מקום לתמונת עבודה — Nail Art", category: "Nail Art", swatchName: "Dusk", description: pending, shape: "square", tone: "dusk" },
  { id: "g8", alt: "מקום לתמונת עבודה — פרנץ׳", category: "פרנץ׳", swatchName: "Aura French", description: pending, shape: "wide", tone: "aura" },
];

import type { GalleryItem } from "@/types";

/**
 * Gallery items. Until real photos are added, each item renders an abstract
 * placeholder in its `tone`. To add a photo, put it in /public/gallery and set
 * `image: { src: "/gallery/xyz.jpg", width: 1200, height: 1500 }` with a real `alt`.
 */
export const galleryItems: GalleryItem[] = [
  { id: "g1", alt: "מקום לתמונת עבודה — גוון ניוד", category: "ניוד", description: "תמונת עבודה תתווסף בקרוב", shape: "tall", tone: "nude" },
  { id: "g2", alt: "מקום לתמונת עבודה — פרנץ׳", category: "פרנץ׳", description: "תמונת עבודה תתווסף בקרוב", shape: "square", tone: "ivory" },
  { id: "g3", alt: "מקום לתמונת עבודה — Nail Art", category: "Nail Art", description: "תמונת עבודה תתווסף בקרוב", shape: "square", tone: "rose" },
  { id: "g4", alt: "מקום לתמונת עבודה — בנייה", category: "בנייה", description: "תמונת עבודה תתווסף בקרוב", shape: "tall", tone: "mocha" },
  { id: "g5", alt: "מקום לתמונת עבודה — לק ג׳ל", category: "לק ג׳ל", description: "תמונת עבודה תתווסף בקרוב", shape: "wide", tone: "blush" },
  { id: "g6", alt: "מקום לתמונת עבודה — מינימליסטי", category: "מינימליסטי", description: "תמונת עבודה תתווסף בקרוב", shape: "square", tone: "sand" },
  { id: "g7", alt: "מקום לתמונת עבודה — Nail Art", category: "Nail Art", description: "תמונת עבודה תתווסף בקרוב", shape: "square", tone: "nude" },
  { id: "g8", alt: "מקום לתמונת עבודה — כרום", category: "כרום", description: "תמונת עבודה תתווסף בקרוב", shape: "wide", tone: "ivory" },
];

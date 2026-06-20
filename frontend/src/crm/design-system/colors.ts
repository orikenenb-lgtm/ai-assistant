// עוזרי צבע ופלטה — קובץ ללא רכיבים (כדי לעמוד בכלל react-refresh).
export const CRM_PALETTE = ['#5b5bd6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b']

function parseHex(hex: string) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return { r: parseInt(full.slice(0, 2), 16) || 0, g: parseInt(full.slice(2, 4), 16) || 0, b: parseInt(full.slice(4, 6), 16) || 0 }
}
export function hexToSoft(hex: string): string {
  const { r, g, b } = parseHex(hex)
  return `rgba(${r},${g},${b},0.14)`
}
export function darken(hex: string): string {
  const { r, g, b } = parseHex(hex)
  return `rgb(${Math.round(r * 0.62)},${Math.round(g * 0.62)},${Math.round(b * 0.62)})`
}

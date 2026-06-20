// קריאות הקטלוג — דרך לקוח ה-API הקיים (מצמיד JWT אוטומטית).
import { api } from '../lib/api'

export interface CatalogProduct {
  id: string
  rivhit_item_id: string
  name: string
  price: number
  quantity: number
  image_url: string | null
  category: string | null
  last_synced_at: string
}

export async function fetchCatalog(): Promise<CatalogProduct[]> {
  return (await api.get<CatalogProduct[]>('/catalog/products')).data
}

export async function syncCatalog(): Promise<{ synced: number; last_synced_at: string }> {
  return (await api.post('/catalog/sync')).data
}

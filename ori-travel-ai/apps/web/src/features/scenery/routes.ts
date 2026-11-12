import type { ObjectKey, SceneKey } from '@/assets/travel';

export interface PageArt {
  scene: SceneKey;
  object: ObjectKey;
}

/** Which backdrop + floating object each area of the app shows (first matching prefix wins). */
const ROUTES: Array<[RegExp, PageArt]> = [
  [/^\/$/, { scene: 'greekHarbor', object: 'airplaneCloud' }],
  [/^\/assistant/, { scene: 'poolsideRelax', object: 'island' }],
  [/^\/search\/flights/, { scene: 'wing', object: 'airplane' }],
  [/^\/cheapest-year/, { scene: 'mountainLake', object: 'passport' }],
  [/^\/search\/hotels/, { scene: 'poolVilla', object: 'poolDiorama' }],
  [/^\/search\/cars/, { scene: 'alpine', object: 'suitcaseSilver' }],
  [/^\/search\/activities/, { scene: 'oldTown', object: 'camera' }],
  [/^\/compare/, { scene: 'passportFlatlay', object: 'passportWallet' }],
  [/^\/saved/, { scene: 'spa', object: 'hat' }],
  [/^\/trips/, { scene: 'tropical', object: 'suitcase' }],
  [/^\/alerts/, { scene: 'wing', object: 'airplaneClouds' }],
  [/^\/bookings/, { scene: 'checkIn', object: 'passport' }],
  [/^\/family/, { scene: 'poolVilla', object: 'family' }],
  [/^\/providers/, { scene: 'checkIn', object: 'checkIn' }],
  [/^\/settings/, { scene: 'mountainLake', object: 'suitcase' }],
  [/^\/help/, { scene: 'greekHarbor', object: 'hat' }],
];

const FALLBACK: PageArt = { scene: 'wing', object: 'airplaneCloud' };

export function artFor(pathname: string): PageArt {
  return ROUTES.find(([re]) => re.test(pathname))?.[1] ?? FALLBACK;
}

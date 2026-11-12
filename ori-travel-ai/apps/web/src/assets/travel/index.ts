/**
 * Travel imagery catalog (owner supplied, optimized by scripts/optimize_travel_images.py; see manifest.json).
 * OBJECTS are isolated renders with real alpha — safe to float. SCENES are full rectangular photos — used as
 * masked backdrops or framed images, never as floating objects. These are flat renders, not 3D models: depth comes
 * only from CSS/GSAP transforms.
 */
import airplaneCloud from './airplane-cloud.webp';
import airplaneClouds from './airplane-clouds.webp';
import airplane from './airplane.webp';
import alpine1600 from './alpine-chalet-1600.webp';
import alpine800 from './alpine-chalet-800.webp';
import camera from './camera.webp';
import checkInCutout from './check-in-cutout.webp';
import checkIn1536 from './check-in-scene-1536.webp';
import checkIn800 from './check-in-scene-800.webp';
import familyPoolside from './family-poolside.webp';
import greekHarbor1600 from './greek-harbor-1600.webp';
import greekHarbor800 from './greek-harbor-800.webp';
import hatSunglasses from './hat-sunglasses.webp';
import islandDiorama from './island-diorama.webp';
import mountainLake1600 from './mountain-lake-1600.webp';
import mountainLake800 from './mountain-lake-800.webp';
import oldTown1600 from './old-town-couple-1600.webp';
import oldTown800 from './old-town-couple-800.webp';
import passportBoardingPass from './passport-boarding-pass.webp';
import passportFlatlay1536 from './passport-flatlay-1536.webp';
import passportFlatlay800 from './passport-flatlay-800.webp';
import passportWallet from './passport-wallet.webp';
import poolDiorama from './pool-diorama.webp';
import poolVilla1600 from './pool-villa-1600.webp';
import poolVilla800 from './pool-villa-800.webp';
import poolsideRelax1600 from './poolside-relax-1600.webp';
import poolsideRelax800 from './poolside-relax-800.webp';
import spa1600 from './spa-1600.webp';
import spa800 from './spa-800.webp';
import suitcaseCream from './suitcase-cream.webp';
import suitcaseSilver from './suitcase-silver.webp';
import tropical1600 from './tropical-villa-1600.webp';
import tropical800 from './tropical-villa-800.webp';
import wing1600 from './wing-sunset-1600.webp';
import wing800 from './wing-sunset-800.webp';

export interface TravelObject {
  src: string;
  width: number;
  height: number;
  /** Decorative alt (most uses are aria-hidden); meaningful where the image carries content. */
  alt: string;
}

export interface TravelScene {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  alt: string;
}

const obj = (src: string, width: number, height: number, alt: string): TravelObject => ({ src, width, height, alt });
const scene = (small: string, large: string, largeW: number, height: number, alt: string): TravelScene => ({
  src: large,
  srcSet: `${small} 800w, ${large} ${largeW}w`,
  width: largeW,
  height,
  alt,
});

export const OBJECTS = {
  airplane: obj(airplane, 900, 600, 'מטוס נוסעים לבן בטיסה'),
  airplaneCloud: obj(airplaneCloud, 900, 507, 'מטוס מעל ענן'),
  airplaneClouds: obj(airplaneClouds, 900, 461, 'מטוס מעל העננים בשקיעה'),
  camera: obj(camera, 900, 600, 'מצלמה'),
  checkIn: obj(checkInCutout, 900, 600, 'נוסע בדלפק צ׳ק-אין בשדה התעופה'),
  family: obj(familyPoolside, 900, 600, 'משפחה עם מזוודות ליד בריכה'),
  hat: obj(hatSunglasses, 900, 600, 'כובע קש ומשקפי שמש'),
  island: obj(islandDiorama, 900, 600, 'אי טרופי מיניאטורי עם תיק גב וכובע'),
  passport: obj(passportBoardingPass, 900, 600, 'דרכון וכרטיס עלייה למטוס'),
  passportWallet: obj(passportWallet, 900, 600, 'נרתיק דרכון בצבע טורקיז'),
  poolDiorama: obj(poolDiorama, 900, 507, 'וילה מיניאטורית עם בריכה ודקלים'),
  suitcase: obj(suitcaseCream, 600, 900, 'מזוודה קשיחה בצבע שמנת'),
  suitcaseSilver: obj(suitcaseSilver, 675, 900, 'מזוודה קשיחה כסופה'),
} as const;

export const SCENES = {
  alpine: scene(alpine800, alpine1600, 1600, 900, 'בקתה בהרים מושלגים בשקיעה'),
  checkIn: scene(checkIn800, checkIn1536, 1536, 1024, 'צ׳ק-אין בשדה התעופה'),
  greekHarbor: scene(greekHarbor800, greekHarbor1600, 1600, 900, 'נמל יווני עם סירות ומים צלולים'),
  mountainLake: scene(mountainLake800, mountainLake1600, 1600, 900, 'אגם בין הרים'),
  oldTown: scene(oldTown800, oldTown1600, 1600, 900, 'זוג מטייל ברחוב אבן עתיק'),
  passportFlatlay: scene(passportFlatlay800, passportFlatlay1536, 1536, 1024, 'דרכון, כרטיס טיסה וגלובוס'),
  poolsideRelax: scene(poolsideRelax800, poolsideRelax1600, 1600, 900, 'מטייל נח ליד בריכה מול הים'),
  poolVilla: scene(poolVilla800, poolVilla1600, 1600, 900, 'בריכת אינסוף מול הים'),
  spa: scene(spa800, spa1600, 1600, 900, 'ספא עם נוף לים'),
  tropical: scene(tropical800, tropical1600, 1600, 900, 'וילה טרופית בשקיעה'),
  wing: scene(wing800, wing1600, 1600, 900, 'כנף מטוס מעל העננים בשקיעה'),
} as const;

export type ObjectKey = keyof typeof OBJECTS;
export type SceneKey = keyof typeof SCENES;

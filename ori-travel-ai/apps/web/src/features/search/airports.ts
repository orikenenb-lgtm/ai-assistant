/**
 * Small client-side airport/city list for the combobox (matches the places the
 * demo providers know about). Free text is still accepted: providers resolve any
 * valid IATA code and the server validates it.
 */
export interface Place {
  code: string;
  /** Hebrew city name. */
  city: string;
  /** Hebrew airport name (or "כל שדות התעופה" for metro codes). */
  name: string;
  english: string;
  country: string;
  /** City / metropolitan code that covers several airports. */
  metro?: boolean;
}

const A = (code: string, city: string, name: string, english: string, country: string, metro = false): Place => ({
  code,
  city,
  name,
  english,
  country,
  ...(metro ? { metro } : {}),
});

export const PLACES: Place[] = [
  A('TLV', 'תל אביב', 'נמל התעופה בן גוריון', 'Tel Aviv Ben Gurion', 'ישראל'),
  A('ETM', 'אילת', 'נמל התעופה רמון', 'Eilat Ramon', 'ישראל'),
  A('VDA', 'אילת', 'נמל התעופה עובדה', 'Eilat Ovda', 'ישראל'),
  A('LCA', 'לרנקה', 'נמל התעופה לרנקה', 'Larnaca', 'קפריסין'),
  A('PFO', 'פאפוס', 'נמל התעופה פאפוס', 'Paphos', 'קפריסין'),
  A('ATH', 'אתונה', 'נמל התעופה אלפתריוס וניזלוס', 'Athens', 'יוון'),
  A('SKG', 'סלוניקי', 'נמל התעופה מקדוניה', 'Thessaloniki', 'יוון'),
  A('HER', 'הרקליון (כרתים)', 'נמל התעופה ניקוס קזנצאקיס', 'Heraklion Crete', 'יוון'),
  A('RHO', 'רודוס', 'נמל התעופה דיאגוראס', 'Rhodes', 'יוון'),
  A('CFU', 'קורפו', 'נמל התעופה יואניס קפודיסטריאס', 'Corfu', 'יוון'),
  A('FCO', 'רומא', 'נמל התעופה פיומיצ׳ינו', 'Rome Fiumicino', 'איטליה'),
  A('ROM', 'רומא', 'כל שדות התעופה', 'Rome (all airports)', 'איטליה', true),
  A('MXP', 'מילאנו', 'נמל התעופה מלפנסה', 'Milan Malpensa', 'איטליה'),
  A('VCE', 'ונציה', 'נמל התעופה מרקו פולו', 'Venice Marco Polo', 'איטליה'),
  A('NAP', 'נאפולי', 'נמל התעופה נאפולי', 'Naples', 'איטליה'),
  A('CDG', 'פריז', 'נמל התעופה שארל דה גול', 'Paris Charles de Gaulle', 'צרפת'),
  A('ORY', 'פריז', 'נמל התעופה אורלי', 'Paris Orly', 'צרפת'),
  A('PAR', 'פריז', 'כל שדות התעופה', 'Paris (all airports)', 'צרפת', true),
  A('NCE', 'ניס', 'נמל התעופה ניס קוט ד׳אזור', 'Nice', 'צרפת'),
  A('BCN', 'ברצלונה', 'נמל התעופה אל פראט', 'Barcelona', 'ספרד'),
  A('MAD', 'מדריד', 'נמל התעופה ברחאס', 'Madrid', 'ספרד'),
  A('PMI', 'פלמה דה מיורקה', 'נמל התעופה פלמה דה מיורקה', 'Palma de Mallorca', 'ספרד'),
  A('LIS', 'ליסבון', 'נמל התעופה הומברטו דלגדו', 'Lisbon', 'פורטוגל'),
  A('LHR', 'לונדון', 'נמל התעופה הית׳רו', 'London Heathrow', 'בריטניה'),
  A('LTN', 'לונדון', 'נמל התעופה לוטון', 'London Luton', 'בריטניה'),
  A('LON', 'לונדון', 'כל שדות התעופה', 'London (all airports)', 'בריטניה', true),
  A('AMS', 'אמסטרדם', 'נמל התעופה סכיפהול', 'Amsterdam Schiphol', 'הולנד'),
  A('BER', 'ברלין', 'נמל התעופה ברלין ברנדנבורג', 'Berlin Brandenburg', 'גרמניה'),
  A('MUC', 'מינכן', 'נמל התעופה מינכן', 'Munich', 'גרמניה'),
  A('FRA', 'פרנקפורט', 'נמל התעופה פרנקפורט', 'Frankfurt', 'גרמניה'),
  A('ZRH', 'ציריך', 'נמל התעופה ציריך', 'Zurich', 'שוויץ'),
  A('VIE', 'וינה', 'נמל התעופה וינה', 'Vienna', 'אוסטריה'),
  A('PRG', 'פראג', 'נמל התעופה ואצלב האבל', 'Prague', 'צ׳כיה'),
  A('BUD', 'בודפשט', 'נמל התעופה פרנץ ליסט', 'Budapest', 'הונגריה'),
  A('WAW', 'ורשה', 'נמל התעופה שופן', 'Warsaw', 'פולין'),
  A('KRK', 'קרקוב', 'נמל התעופה יוחנן פאולוס השני', 'Krakow', 'פולין'),
  A('OTP', 'בוקרשט', 'נמל התעופה אנרי קואנדה', 'Bucharest', 'רומניה'),
  A('SOF', 'סופיה', 'נמל התעופה סופיה', 'Sofia', 'בולגריה'),
  A('BEG', 'בלגרד', 'נמל התעופה ניקולה טסלה', 'Belgrade', 'סרביה'),
  A('TBS', 'טביליסי', 'נמל התעופה טביליסי', 'Tbilisi', 'גאורגיה'),
  A('BUS', 'בטומי', 'נמל התעופה בטומי', 'Batumi', 'גאורגיה'),
  A('IST', 'איסטנבול', 'נמל התעופה של איסטנבול', 'Istanbul', 'טורקיה'),
  A('MLA', 'מלטה', 'נמל התעופה מלטה', 'Malta', 'מלטה'),
  A('DXB', 'דובאי', 'נמל התעופה דובאי', 'Dubai', 'איחוד האמירויות'),
  A('AUH', 'אבו דאבי', 'נמל התעופה זאיד', 'Abu Dhabi', 'איחוד האמירויות'),
  A('BKK', 'בנגקוק', 'נמל התעופה סוברנבומי', 'Bangkok', 'תאילנד'),
  A('HKT', 'פוקט', 'נמל התעופה פוקט', 'Phuket', 'תאילנד'),
  A('NRT', 'טוקיו', 'נמל התעופה נריטה', 'Tokyo Narita', 'יפן'),
  A('HND', 'טוקיו', 'נמל התעופה הנדה', 'Tokyo Haneda', 'יפן'),
  A('JFK', 'ניו יורק', 'נמל התעופה ג׳ון פ. קנדי', 'New York JFK', 'ארה״ב'),
  A('EWR', 'ניו יורק', 'נמל התעופה ניוארק', 'New York Newark', 'ארה״ב'),
  A('MIA', 'מיאמי', 'נמל התעופה מיאמי', 'Miami', 'ארה״ב'),
  A('LAX', 'לוס אנג׳לס', 'נמל התעופה לוס אנג׳לס', 'Los Angeles', 'ארה״ב'),
  A('YYZ', 'טורונטו', 'נמל התעופה פירסון', 'Toronto Pearson', 'קנדה'),
];

const BY_CODE = new Map(PLACES.map((p) => [p.code, p]));

export function findPlace(code: string): Place | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[׳'’"״]/g, '');
}

/** Case-insensitive search by code prefix, Hebrew city/airport/country or English name. Codes rank first. */
export function searchPlaces(query: string, limit = 8): Place[] {
  const q = norm(query.trim());
  if (!q) return PLACES.filter((p) => ['TLV', 'ATH', 'LCA', 'LHR', 'JFK', 'FCO', 'BCN', 'BKK'].includes(p.code)).slice(0, limit);
  const scored: Array<{ p: Place; s: number }> = [];
  for (const p of PLACES) {
    const code = p.code.toLowerCase();
    let s = 0;
    if (code === q) s = 100;
    else if (code.startsWith(q)) s = 80;
    else if (norm(p.city).startsWith(q)) s = 70;
    else if (norm(p.english).startsWith(q)) s = 65;
    else if (norm(p.city).includes(q) || norm(p.name).includes(q) || norm(p.english).includes(q)) s = 40;
    else if (norm(p.country).startsWith(q)) s = 30;
    if (s > 0) scored.push({ p, s: p.metro ? s - 1 : s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
}

/** Hebrew city names for hotel/activity destination suggestions (datalist). */
export const DESTINATION_CITIES: string[] = [...new Set(PLACES.map((p) => p.city))];

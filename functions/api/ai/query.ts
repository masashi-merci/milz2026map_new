export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

type Mode = 'recommend' | 'trend';
type Bucket = 'sightseeing' | 'food';

type RecommendationItem = {
  name_ja: string;
  name_en: string;
  reason_ja: string;
  reason_en: string;
  category: string;
  bucket: Bucket;
  lat: number;
  lng: number;
  address?: string;
  source?: 'osm' | 'admin';
  distanceKm?: number;
};

type TrendCategory = 'general' | 'food' | 'cafe' | 'restaurant' | 'sightseeing' | 'shopping' | 'event' | 'access';

type TrendItem = {
  topic_ja: string;
  topic_en: string;
  description_ja: string;
  description_en: string;
  category: string;
  popularity: number;
  source_url?: string;
};

type OSMElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type GeocodedLocation = {
  display: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  countryCode: string;
  locationKey: string;
  primaryLabel: string;
};

type AdminPlace = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  municipality?: string | null;
  prefecture?: string | null;
  country?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
};

const CACHE_VERSION = 'v61';
const RECOMMEND_TTL = 60 * 60 * 24 * 14;
const TREND_TTL = 60 * 60 * 24;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } });

const safeText = (value: unknown, fallback = '') => String(value || '').trim() || fallback;
const normalize = (value: string) => safeText(value).toLowerCase().replace(/\s+/g, ' ').trim();
const contains = (source: string, ...needles: string[]) => needles.some((needle) => source.includes(normalize(needle)));

const buildCacheKey = async (mode: Mode, locationKey: string) => {
  const source = `${CACHE_VERSION}|${mode}|${locationKey}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const timeoutFetch = async (input: RequestInfo | URL, init: RequestInit = {}, ms = 12000) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Upstream timeout')), ms);
  });
  try {
    return await Promise.race([fetch(input, init), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const guessCountryCode = (location: string) => {
  const normalized = normalize(location);
  if (contains(normalized, 'new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'usa', 'アメリカ', 'ニューヨーク')) return 'us';
  if (contains(normalized, 'seoul', 'jung-gu', 'myeongdong', 'korea', '韓国', 'ソウル', '明洞')) return 'kr';
  return 'jp';
};

const locationRadiusMeters = (location: string) => {
  const normalized = normalize(location);
  if (contains(normalized, '丁目', '番地', 'station', '駅', '寺', '神社', 'park', 'museum', 'tower', 'plaza')) return 1800;
  if (contains(normalized, '区', 'ward', '市', 'city', 'gu', 'ku', '立川', '杉並', '渋谷', '東山', 'jung-gu', 'manhattan')) return 3200;
  return 4500;
};

const getPrimaryLabel = (location: string) => {
  const parts = safeText(location)
    .split(/[\s,、　]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || safeText(location);
};

const geocodeLocation = async (location: string): Promise<GeocodedLocation> => {
  const q = safeText(location);
  const countryCode = guessCountryCode(q);
  const endpoint = new URL('https://nominatim.openstreetmap.org/search');
  endpoint.searchParams.set('q', q);
  endpoint.searchParams.set('format', 'jsonv2');
  endpoint.searchParams.set('limit', '1');
  endpoint.searchParams.set('accept-language', 'ja');
  endpoint.searchParams.set('countrycodes', countryCode);
  try {
    const response = await timeoutFetch(endpoint.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'milz-discovery/1.0' },
    }, 10000);
    const rows = await response.json() as Array<any>;
    const first = rows?.[0];
    if (first?.lat && first?.lon) {
      return {
        display: safeText(first.display_name, q),
        lat: Number(first.lat),
        lng: Number(first.lon),
        radiusMeters: locationRadiusMeters(q),
        countryCode,
        locationKey: `${countryCode}|${normalize(q).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 120)}`,
        primaryLabel: getPrimaryLabel(q),
      };
    }
  } catch {}

  const fallbackCenters: Record<string, [number, number]> = {
    jp: [35.6762, 139.6503],
    us: [40.7831, -73.9712],
    kr: [37.5665, 126.978],
  };
  const fallbackCenter = fallbackCenters[countryCode] || fallbackCenters.jp;
  return {
    display: q,
    lat: fallbackCenter[0],
    lng: fallbackCenter[1],
    radiusMeters: locationRadiusMeters(q),
    countryCode,
    locationKey: `${countryCode}|${normalize(q).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 120)}`,
    primaryLabel: getPrimaryLabel(q),
  };
};

const inferCategory = (el: OSMElement) => {
  const tags = el.tags || {};
  if (tags.amenity === 'cafe' || tags.amenity === 'coffee_shop') return 'CAFE';
  if (['restaurant', 'fast_food', 'food_court', 'bar', 'pub', 'ice_cream'].includes(tags.amenity || '')) return 'RESTAURANT';
  if (tags.shop) return 'SHOPPING';
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'nature_reserve') return 'PARK';
  if (tags.railway === 'station' || tags.public_transport === 'station' || tags.amenity === 'bus_station') return 'TRANSIT';
  if (tags.tourism === 'museum') return 'MUSEUM';
  if (tags.tourism === 'gallery' || tags.amenity === 'arts_centre') return 'GALLERY';
  if (tags.tourism === 'viewpoint') return 'VIEWPOINT';
  if (tags.tourism === 'artwork') return 'ART';
  if (['attraction', 'theme_park', 'zoo', 'aquarium', 'picnic_site'].includes(tags.tourism || '')) return 'LANDMARK';
  if (tags.amenity === 'place_of_worship') return 'WORSHIP';
  if (tags.historic) return 'HISTORIC';
  return 'PLACE';
};

const CHAIN_RESTAURANT_PATTERNS = [
  /スターバックス|starbucks/i,
  /ドトール|doutor/i,
  /タリーズ|tully'?s/i,
  /コメダ|komeda/i,
  /マクドナルド|mcdonald'?s/i,
  /モスバーガー|mos burger/i,
  /バーガーキング|burger king/i,
  /ケンタッキー|kfc/i,
  /サイゼリヤ|saizeriya/i,
  /ガスト|gusto/i,
  /ジョナサン|jonathan'?s/i,
  /デニーズ|denny'?s/i,
  /松屋|matsuya/i,
  /すき家|sukiya/i,
  /吉野家|yoshinoya/i,
  /丸亀製麺|marugame/i,
  /はなまるうどん|hanamaru/i,
  /王将|ohsho|gyoza no ohsho/i,
  /鳥貴族|torikizoku/i,
  /くら寿司|kura sushi/i,
  /スシロー|sushiro/i,
  /はま寿司|hama sushi/i,
  /subway|サブウェイ/i,
  /blue bottle/i,
  /pronto|プロント/i,
];

const WORSHIP_PATTERNS = /神社|寺|教会|寺院|大聖堂|shrine|temple|church|cathedral|mosque|synagogue/i;

const isChainRestaurant = (name: string) => CHAIN_RESTAURANT_PATTERNS.some((pattern) => pattern.test(name));
const isWorshipPlace = (name: string, category: string) => category === 'WORSHIP' || WORSHIP_PATTERNS.test(name);

const recommendationRootName = (item: RecommendationItem) =>
  normalize(item.name_en || item.name_ja)
    .replace(/\b(honten|branch|store)\b/giu, '')
    .replace(/(本店|支店|駅前店|店)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

const recommendationScore = (item: RecommendationItem) => {
  const distance = Number.isFinite(item.distanceKm) ? Number(item.distanceKm) : 99;
  let score = Math.max(0, 100 - Math.min(distance * 12, 48));
  if (item.source === 'admin') score += 18;
  if (item.address) score += 4;

  if (item.bucket === 'food') {
    if (item.category === 'RESTAURANT') score += 18;
    if (item.category === 'CAFE') score += 14;
    if (isChainRestaurant(item.name_ja || item.name_en)) score -= 42;
    if (/本店|honten/i.test(item.name_ja || item.name_en)) score += 6;
  } else {
    if (item.category === 'VIEWPOINT') score += 22;
    else if (item.category === 'MUSEUM' || item.category === 'GALLERY') score += 18;
    else if (item.category === 'PARK') score += 16;
    else if (item.category === 'LANDMARK') score += 12;
    else if (item.category === 'HISTORIC') score += 6;
    if (isWorshipPlace(item.name_ja || item.name_en, item.category)) score -= 26;
  }

  return score;
};

const selectRecommendationMix = (items: RecommendationItem[], bucket: Bucket, limit: number) => {
  const sorted = [...items].sort((a, b) => {
    const scoreDiff = recommendationScore(b) - recommendationScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.distanceKm || 99) - (b.distanceKm || 99);
  });

  const picked: RecommendationItem[] = [];
  const seenRoots = new Set<string>();
  const categoryCounts = new Map<string, number>();
  let chainCount = 0;
  let worshipCount = 0;

  for (const item of sorted) {
    if (picked.length >= limit) break;
    const root = recommendationRootName(item);
    if (root && seenRoots.has(root)) continue;

    const sameCategory = categoryCounts.get(item.category) || 0;
    const chain = isChainRestaurant(item.name_ja || item.name_en);
    const worship = isWorshipPlace(item.name_ja || item.name_en, item.category);

    if (bucket === 'food') {
      if (chain && chainCount >= 1) continue;
      if (sameCategory >= 3) continue;
    } else {
      if (worship && worshipCount >= 1) continue;
      if (sameCategory >= 2) continue;
    }

    picked.push(item);
    if (root) seenRoots.add(root);
    categoryCounts.set(item.category, sameCategory + 1);
    if (chain) chainCount += 1;
    if (worship) worshipCount += 1;
  }

  if (picked.length < limit) {
    for (const item of sorted) {
      if (picked.length >= limit) break;
      const key = `${normalize(item.name_en || item.name_ja)}:${Math.round(item.lat * 1000)}:${Math.round(item.lng * 1000)}`;
      const already = picked.some((current) => `${normalize(current.name_en || current.name_ja)}:${Math.round(current.lat * 1000)}:${Math.round(current.lng * 1000)}` === key);
      if (already) continue;
      picked.push(item);
    }
  }

  return picked.slice(0, limit);
};

const elementName = (el: OSMElement) => safeText(el.tags?.['name:ja'] || el.tags?.name || el.tags?.['name:en'] || el.tags?.official_name);
const elementAddress = (el: OSMElement) => safeText([el.tags?.['addr:city'], el.tags?.['addr:suburb'], el.tags?.['addr:street']].filter(Boolean).join(' '));

const recommendationReasonJa = (name: string, location: GeocodedLocation, distanceKm: number, bucket: Bucket, category: string) => {
  const distanceText = distanceKm < 1 ? '徒歩圏に近く' : `中心から約${distanceKm.toFixed(1)}kmで`;
  if (bucket === 'food') return `${location.primaryLabel} で食事先や休憩先を探す時に使いやすい実在店です。${distanceText}立ち寄りやすい候補として選びました。`;
  if (category === 'PARK') return `${name} は ${location.primaryLabel} 周辺で散歩や景色目的に組み込みやすい実在スポットです。${distanceText}回遊しやすい候補です。`;
  return `${name} は ${location.primaryLabel} 周辺で立ち寄りやすい実在スポットです。${distanceText}選択地点との相性が良い候補として返しています。`;
};

const recommendationReasonEn = (location: GeocodedLocation, distanceKm: number, bucket: Bucket) =>
  bucket === 'food'
    ? `A real nearby food stop around ${location.primaryLabel}, roughly ${distanceKm.toFixed(1)} km from the selected center.`
    : `A real nearby sightseeing stop around ${location.primaryLabel}, roughly ${distanceKm.toFixed(1)} km from the selected center.`;

const fetchAdminPlacesNear = async (location: GeocodedLocation, env: Env): Promise<RecommendationItem[]> => {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return [];
  try {
    const response = await timeoutFetch(`${env.SUPABASE_URL}/rest/v1/admin_places?select=id,name,description,category,municipality,prefecture,country,address,lat,lng`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    }, 10000);
    const rows = await response.json() as AdminPlace[];
    return rows
      .map((row) => ({ row, distanceKm: haversineKm(location.lat, location.lng, Number(row.lat), Number(row.lng)) }))
      .filter(({ row, distanceKm }) => {
        const name = safeText(row.name);
        if (!Number.isFinite(distanceKm) || distanceKm > Math.max(location.radiusMeters / 1000, 5)) return false;
        if (/営業センター|office|branch|agency/i.test(name)) return false;
        return true;
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 20)
      .map(({ row, distanceKm }) => {
        const category = normalize(safeText(row.category));
        const bucket: Bucket = contains(category, 'restaurant', 'food', 'cafe', 'coffee', 'bar', 'レストラン', 'カフェ', 'グルメ') ? 'food' : 'sightseeing';
        const displayCategory = bucket === 'food' ? 'RESTAURANT' : 'LANDMARK';
        return {
          name_ja: safeText(row.name),
          name_en: safeText(row.name),
          reason_ja: recommendationReasonJa(safeText(row.name), location, distanceKm, bucket, displayCategory),
          reason_en: recommendationReasonEn(location, distanceKm, bucket),
          category: displayCategory,
          bucket,
          lat: Number(row.lat),
          lng: Number(row.lng),
          address: safeText(row.address || row.municipality || row.prefecture || row.country),
          source: 'admin' as const,
          distanceKm,
        };
      });
  } catch {
    return [];
  }
};

const overpassClausesForBucket = (bucket: Bucket) => {
  if (bucket === 'food') {
    return [
      'node["amenity"~"restaurant|cafe|fast_food|bar|pub|ice_cream"]',
      'way["amenity"~"restaurant|cafe|fast_food|bar|pub|ice_cream"]',
      'relation["amenity"~"restaurant|cafe|fast_food|bar|pub|ice_cream"]',
    ];
  }
  return [
    'node["tourism"~"attraction|museum|gallery|viewpoint|artwork|theme_park|zoo|aquarium|picnic_site"]',
    'way["tourism"~"attraction|museum|gallery|viewpoint|artwork|theme_park|zoo|aquarium|picnic_site"]',
    'relation["tourism"~"attraction|museum|gallery|viewpoint|artwork|theme_park|zoo|aquarium|picnic_site"]',
    'node["historic"]','way["historic"]','relation["historic"]',
    'node["leisure"~"park|garden|nature_reserve"]','way["leisure"~"park|garden|nature_reserve"]','relation["leisure"~"park|garden|nature_reserve"]',
    'node["amenity"~"place_of_worship|arts_centre"]','way["amenity"~"place_of_worship|arts_centre"]','relation["amenity"~"place_of_worship|arts_centre"]',
  ];
};

const fetchOverpassRecommendations = async (location: GeocodedLocation, bucket: Bucket): Promise<RecommendationItem[]> => {
  const clauses = overpassClausesForBucket(bucket)
    .map((clause) => `${clause}(around:${location.radiusMeters},${location.lat},${location.lng});`)
    .join('');
  const body = `[out:json][timeout:20];(${clauses});out center tags 180;`;
  try {
    const response = await timeoutFetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
    }, 22000);
    const data = await response.json() as { elements?: OSMElement[] };
    const items = (data.elements || [])
      .map((el) => {
        const lat = Number(el.lat ?? el.center?.lat);
        const lng = Number(el.lon ?? el.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const name = elementName(el);
        if (!name) return null;
        const distanceKm = haversineKm(location.lat, location.lng, lat, lng);
        const category = inferCategory(el);
        return {
          key: `${normalize(name)}:${Math.round(lat * 1000)}:${Math.round(lng * 1000)}`,
          distanceKm,
          item: {
            name_ja: name,
            name_en: name,
            reason_ja: recommendationReasonJa(name, location, distanceKm, bucket, category),
            reason_en: recommendationReasonEn(location, distanceKm, bucket),
            category,
            bucket,
            lat,
            lng,
            address: elementAddress(el),
            source: 'osm' as const,
            distanceKm,
          },
        };
      })
      .filter(Boolean) as Array<{ key: string; distanceKm: number; item: RecommendationItem }>;

    const deduped = new Map<string, { distanceKm: number; item: RecommendationItem }>();
    for (const entry of items) {
      const existing = deduped.get(entry.key);
      if (!existing || entry.distanceKm < existing.distanceKm) deduped.set(entry.key, { distanceKm: entry.distanceKm, item: entry.item });
    }
    return Array.from(deduped.values())
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, bucket === 'food' ? 18 : 18)
      .map((entry) => entry.item);
  } catch {
    return [];
  }
};

const dedupeRecommendations = (items: RecommendationItem[]) => {
  const seen = new Set<string>();
  const out: RecommendationItem[] = [];
  for (const item of items) {
    const key = `${normalize(item.name_en || item.name_ja)}:${Math.round(item.lat * 1000)}:${Math.round(item.lng * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

const generateRecommendations = async (locationInput: string, env: Env): Promise<{ recommendations: RecommendationItem[]; geocoded: GeocodedLocation }> => {
  const geocoded = await geocodeLocation(locationInput);
  const [admin, sightseeing, food] = await Promise.all([
    fetchAdminPlacesNear(geocoded, env),
    fetchOverpassRecommendations(geocoded, 'sightseeing'),
    fetchOverpassRecommendations(geocoded, 'food'),
  ]);
  const sightseeingPool = dedupeRecommendations([...admin.filter((x) => x.bucket === 'sightseeing'), ...sightseeing]);
  const foodPool = dedupeRecommendations([...admin.filter((x) => x.bucket === 'food'), ...food]);
  const sightseeingTop = selectRecommendationMix(sightseeingPool, 'sightseeing', 5);
  const foodTop = selectRecommendationMix(foodPool, 'food', 5);
  return {
    recommendations: [...sightseeingTop, ...foodTop].map(({ distanceKm, ...item }) => item),
    geocoded,
  };
};

const normalizeLocationTokens = (value: string) =>
  safeText(value)
    .split(/[\s,、　・/()（）|-]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

const canonicalizeTrendCategory = (value: string): TrendCategory => {
  const normalized = normalize(value);
  if (contains(normalized, 'food', 'グルメ', 'ランチ', 'ディナー')) return 'food';
  if (contains(normalized, 'cafe', 'カフェ', 'coffee')) return 'cafe';
  if (contains(normalized, 'restaurant', 'レストラン', '居酒屋')) return 'restaurant';
  if (contains(normalized, 'shopping', '買い物', 'mall', 'shop')) return 'shopping';
  if (contains(normalized, 'event', 'イベント', '祭', 'ライブ', '展示')) return 'event';
  if (contains(normalized, 'access', 'アクセス', '交通', '駐車場', '駅')) return 'access';
  if (contains(normalized, 'sightseeing', '観光', '見どころ', '公園', '散策')) return 'sightseeing';
  return 'general';
};

const buildTrendQueries = (locationInput: string, geocoded: GeocodedLocation, categoryValue: string) => {
  const category = canonicalizeTrendCategory(categoryValue);
  const baseVariants = Array.from(new Set([
    geocoded.primaryLabel,
    safeText(locationInput),
    ...normalizeLocationTokens(locationInput),
    ...normalizeLocationTokens(geocoded.display),
  ].map((value) => safeText(value)).filter((value) => value.length >= 2))).slice(0, 3);

  const categorySeeds: Record<TrendCategory, string[]> = {
    general: ['人気', '観光', 'イベント', 'ランチ', 'カフェ', 'アクセス', 'ホテル'],
    food: ['ランチ', 'ディナー', 'グルメ', '食べ歩き', '居酒屋'],
    cafe: ['カフェ', 'コーヒー', 'スイーツ', 'モーニング'],
    restaurant: ['レストラン', 'ランチ', 'ディナー', '人気店'],
    sightseeing: ['観光', '見どころ', 'イベント', '公園', '美術館'],
    shopping: ['ショッピング', '買い物', '商店街', 'モール'],
    event: ['イベント', '祭り', 'ライブ', '展示', '期間限定'],
    access: ['アクセス', '駐車場', '駅', '行き方', 'バス'],
  };

  const seeds = categorySeeds[category];
  const queries = new Set<string>();
  for (const base of baseVariants) {
    queries.add(base);
    for (const seed of seeds) {
      queries.add(`${base} ${seed}`.trim());
    }
  }
  return Array.from(queries).slice(0, 15);
};

const stripLeadingLocation = (phrase: string, variants: string[]) => {
  let output = phrase;
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`^${escaped}[\\s　-]*`, 'iu'), '').trim();
  }
  return output;
};

const sanitizeTrendPhrase = (phrase: string, locationVariants: string[]) => {
  const normalizedPhrase = safeText(phrase).replace(/\s+/g, ' ').trim();
  if (!normalizedPhrase) return '';
  if (/�|Ã|â/.test(normalizedPhrase)) return '';
  if (/^[\W_]+$/u.test(normalizedPhrase)) return '';
  if (normalizedPhrase.length < 2) return '';

  const stripped = stripLeadingLocation(normalizedPhrase, locationVariants.filter(Boolean));
  const bareDeny = ['人気', '観光', 'おすすめ', 'ランチ', 'カフェ', '天気', 'イベント', 'ホテル', '居酒屋', '桜', 'アクセス', '駐車場'];
  if (bareDeny.includes(normalizedPhrase)) return '';
  if (bareDeny.includes(stripped) && normalize(stripped) === normalize(normalizedPhrase)) return '';
  return normalizedPhrase;
};

const fetchSuggestTerms = async (query: string, countryCode: string): Promise<string[]> => {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&gl=${countryCode.toUpperCase()}&q=${encodeURIComponent(query)}`;
    const response = await timeoutFetch(url, { headers: { Accept: 'application/json' } }, 10000);
    const data = await response.json() as [string, string[]];
    return Array.isArray(data?.[1]) ? data[1].map((item) => safeText(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const trendReason = (query: string, locationLabel: string) => {
  const q = normalize(query);
  if (contains(q, 'ランチ', 'ディナー', 'グルメ', 'レストラン', '食べ放題', '寿司', '焼肉', 'ラーメン', '居酒屋')) {
    return `${locationLabel} 周辺で食事先を決める直前ニーズが強く、この検索語が伸びていると考えられます。特に「今どこで食べるか」「比較して決めたい店はどこか」を知りたい人の検索意図が背景にあります。`;
  }
  if (contains(q, 'カフェ', 'coffee', '喫茶', 'スイーツ', 'dessert')) {
    return `${locationLabel} で休憩先や待ち合わせ先を探す場面が多く、この検索語が増えやすいです。雰囲気・入りやすさ・近さを事前に確認したい人の検索が背景にあります。`;
  }
  if (contains(q, 'ホテル', '宿', '宿泊')) {
    return `${locationLabel} を訪れる前後で宿泊先を比較したい人が多く、この検索語が上がりやすいです。立地、価格、移動しやすさを確認する需要が背景にあります。`;
  }
  if (contains(q, 'アクセス', '行き方', '駅', '駐車場', 'parking', 'バス', '電車')) {
    return `${locationLabel} に向かう直前に移動手段や最寄り動線を確認したい人が多く、この検索語が増えていると考えられます。`;
  }
  if (contains(q, 'イベント', '祭', 'ライブ', '展示', 'フェス', '期間限定')) {
    return `${locationLabel} 周辺の催事や期間限定情報を確かめたい動きがあり、この検索語が伸びています。開催日や混雑、内容確認の需要が背景です。`;
  }
  if (contains(q, '桜', '紅葉', '天気', '夜景', '見頃', '花見')) {
    return `${locationLabel} の季節要因や景観確認の需要から、この検索語が増えていると考えられます。行くタイミングや今の状態を判断したい検索意図が背景にあります。`;
  }
  if (contains(q, '観光', '見どころ', '散歩', '遊び', 'デート', '公園', '美術館', '神社', '寺')) {
    return `${locationLabel} でどこを回るか決める段階で、この検索語が使われやすいです。初めて行く人が見どころや順路を確認したい時の検索意図が背景にあります。`;
  }
  return `${locationLabel} について「何があるか」「今なぜ注目されているか」を確認する検索として、この語が使われていると考えられます。現地へ行く前の下調べや比較検討の需要が背景です。`;
};

const generateTrends = async (locationInput: string, categoryValue = 'general'): Promise<{ trends: TrendItem[]; geocoded: GeocodedLocation }> => {
  const geocoded = await geocodeLocation(locationInput);
  const queries = buildTrendQueries(locationInput, geocoded, categoryValue);
  const locationVariants = Array.from(new Set([
    geocoded.primaryLabel,
    geocoded.primaryLabel.replace(/市$/u, ''),
    geocoded.primaryLabel.replace(/区$/u, ''),
    geocoded.primaryLabel.replace(/駅$/u, ''),
    ...normalizeLocationTokens(locationInput),
  ].filter(Boolean)));

  const counts = new Map<string, { count: number; original: string; matchedBy: Set<string> }>();
  const results = await Promise.allSettled(queries.map((query) => fetchSuggestTerms(query, geocoded.countryCode)));

  for (let index = 0; index < results.length; index += 1) {
    const query = queries[index];
    const settled = results[index];
    const suggestions = settled.status === 'fulfilled' ? settled.value : [];
    for (const suggestion of suggestions) {
      const display = sanitizeTrendPhrase(suggestion, locationVariants);
      if (!display) continue;
      const key = normalize(display);
      const current = counts.get(key) || { count: 0, original: display, matchedBy: new Set<string>() };
      current.original = current.original.length <= display.length ? current.original : display;
      current.count += 1;
      current.matchedBy.add(query);
      counts.set(key, current);
    }
  }

  const ranked = Array.from(counts.values())
    .filter((entry) => entry.matchedBy.size >= 1)
    .sort((a, b) => b.count - a.count || b.matchedBy.size - a.matchedBy.size || a.original.length - b.original.length)
    .slice(0, 10);

  const maxScore = ranked[0]?.count || 1;
  const trends = ranked.map((entry, index) => {
    const fullQuery = entry.original.trim();
    return {
      topic_ja: fullQuery,
      topic_en: fullQuery,
      description_ja: trendReason(fullQuery, geocoded.primaryLabel),
      description_en: trendReason(fullQuery, geocoded.primaryLabel),
      category: canonicalizeTrendCategory(categoryValue) === 'general' ? '' : canonicalizeTrendCategory(categoryValue).toUpperCase(),
      popularity: Math.max(62, Math.min(99, Math.round(68 + (entry.count / maxScore) * 24 + entry.matchedBy.size * 2 - index))),
      source_url: `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}`,
    } satisfies TrendItem;
  });

  return { trends, geocoded };
};

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode: Mode = body?.mode === 'trend' ? 'trend' : 'recommend';
    const location = safeText(body?.location, '日本 東京都 渋谷').slice(0, 180);
    const category = safeText(body?.category, 'general').slice(0, 80);
    const cache = (caches as CacheStorage & { default: Cache }).default;

    const geocodedForKey = await geocodeLocation(location);
    const cacheKey = await buildCacheKey(mode, `${geocodedForKey.locationKey}|${mode === 'trend' ? normalize(category) : 'all'}`);
    const cacheUrl = `https://edge-cache.local/milz-ai-${cacheKey}`;
    const cached = await cache.match(cacheUrl);
    if (cached) {
      return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers.entries()), ...corsHeaders, 'X-AI-Cache': 'HIT' } });
    }

    if (mode === 'recommend') {
      const { recommendations, geocoded } = await generateRecommendations(location, env);
      const response = json({ mode, location, geocoded: { lat: geocoded.lat, lng: geocoded.lng, display: geocoded.display }, recommendations, generatedAt: new Date().toISOString() }, 200, { 'Cache-Control': `public, max-age=${RECOMMEND_TTL}`, 'X-AI-Cache': 'MISS' });
      await cache.put(cacheUrl, response.clone());
      return response;
    }

    const { trends, geocoded } = await generateTrends(location, category);
    const response = json({ mode, location, category, geocoded: { lat: geocoded.lat, lng: geocoded.lng, display: geocoded.display }, trends, generatedAt: new Date().toISOString() }, 200, { 'Cache-Control': `public, max-age=${TREND_TTL}`, 'X-AI-Cache': 'MISS' });
    await cache.put(cacheUrl, response.clone());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return json({ error: message }, 500);
  }
};

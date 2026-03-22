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
  source?: 'admin' | 'osm' | 'fallback';
};

type TrendItem = {
  topic_ja: string;
  topic_en: string;
  description_ja: string;
  description_en: string;
  category: string;
  popularity: number;
  keyword_ja?: string;
  keyword_en?: string;
  source_url?: string;
};

type RegionKey = 'ny' | 'tokyo' | 'kyoto' | 'korea';

type RegionConfig = {
  key: RegionKey;
  label: string;
  countryCode: string;
  aliases: string[];
  center: [number, number];
  fallbackSightseeing: RecommendationItem[];
};

type GeocodedLocation = {
  display: string;
  lat: number;
  lng: number;
  radius: number;
  region: RegionConfig;
  locationKey: string;
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

type OSMElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const CACHE_VERSION = 'v40';
const RECOMMEND_TTL = 60 * 60 * 24 * 14;
const TREND_TTL = 60 * 60 * 24;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const REGIONS: Record<RegionKey, RegionConfig> = {
  ny: {
    key: 'ny',
    label: 'New York',
    countryCode: 'US',
    aliases: ['new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'nyc', 'ニューヨーク', 'マンハッタン'],
    center: [40.7831, -73.9712],
    fallbackSightseeing: [
      { name_ja: 'セントラルパーク', name_en: 'Central Park', reason_ja: '', reason_en: '', category: 'PARK', bucket: 'sightseeing', lat: 40.7812, lng: -73.9665, source: 'fallback' },
      { name_ja: 'グランドセントラル駅', name_en: 'Grand Central Terminal', reason_ja: '', reason_en: '', category: 'TRANSIT', bucket: 'sightseeing', lat: 40.7527, lng: -73.9772, source: 'fallback' },
    ],
  },
  tokyo: {
    key: 'tokyo',
    label: 'Tokyo',
    countryCode: 'JP',
    aliases: ['tokyo', '東京', '渋谷', '杉並', '立川', '下北沢', '新宿', '上野', '八王子'],
    center: [35.6762, 139.6503],
    fallbackSightseeing: [
      { name_ja: '東京駅', name_en: 'Tokyo Station', reason_ja: '', reason_en: '', category: 'TRANSIT', bucket: 'sightseeing', lat: 35.6812, lng: 139.7671, source: 'fallback' },
      { name_ja: '代々木公園', name_en: 'Yoyogi Park', reason_ja: '', reason_en: '', category: 'PARK', bucket: 'sightseeing', lat: 35.6728, lng: 139.6949, source: 'fallback' },
    ],
  },
  kyoto: {
    key: 'kyoto',
    label: 'Kyoto',
    countryCode: 'JP',
    aliases: ['kyoto', '京都', '東山', '祇園', '河原町', '清水寺'],
    center: [35.0116, 135.7681],
    fallbackSightseeing: [
      { name_ja: '清水寺', name_en: 'Kiyomizu-dera', reason_ja: '', reason_en: '', category: 'LANDMARK', bucket: 'sightseeing', lat: 34.9948, lng: 135.785, source: 'fallback' },
      { name_ja: '八坂神社', name_en: 'Yasaka Shrine', reason_ja: '', reason_en: '', category: 'LANDMARK', bucket: 'sightseeing', lat: 35.0037, lng: 135.7788, source: 'fallback' },
    ],
  },
  korea: {
    key: 'korea',
    label: 'Seoul',
    countryCode: 'KR',
    aliases: ['seoul', 'ソウル', '韓国', '中区', 'jung-gu', '明洞'],
    center: [37.5665, 126.978],
    fallbackSightseeing: [
      { name_ja: '景福宮', name_en: 'Gyeongbokgung Palace', reason_ja: '', reason_en: '', category: 'LANDMARK', bucket: 'sightseeing', lat: 37.5796, lng: 126.977, source: 'fallback' },
      { name_ja: '明洞', name_en: 'Myeongdong', reason_ja: '', reason_en: '', category: 'SHOPPING', bucket: 'sightseeing', lat: 37.5636, lng: 126.985, source: 'fallback' },
    ],
  },
};

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } });

const normalize = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const safeText = (value: unknown, fallback = '') => String(value || '').trim() || fallback;
const contains = (source: string, ...needles: string[]) => needles.some((needle) => source.includes(normalize(needle)));

const buildCacheKey = async (mode: Mode, locationKey: string, category: string) => {
  const source = `${CACHE_VERSION}|${mode}|${locationKey}|${normalize(category)}`;
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
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

const toCacheResponse = async (cache: Cache, cacheUrl: string, payload: unknown, ttlSeconds: number) => {
  const response = json(payload, 200, {
    'Cache-Control': `public, max-age=${ttlSeconds}`,
    'X-AI-Cache': 'MISS',
  });
  await cache.put(cacheUrl, response.clone());
  return response;
};

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const pickRegion = (location: string, explicitRegion?: string) => {
  if (explicitRegion && explicitRegion in REGIONS) return REGIONS[explicitRegion as RegionKey];
  const normalized = normalize(location);
  return Object.values(REGIONS).find((region) => region.aliases.some((alias) => normalized.includes(normalize(alias)))) || REGIONS.tokyo;
};

const buildLocationKey = (location: string, region: RegionConfig) => `${region.key}|${normalize(location).replace(/[^\p{L}\p{N}|-]+/gu, '_').slice(0, 120)}`;

const locationRadius = (location: string) => {
  const normalized = normalize(location);
  if (contains(normalized, '丁目', '番地', 'station', '駅', 'hotel', '寺', '神社', 'タワー', 'park', 'museum')) return 1800;
  if (contains(normalized, 'ward', '区', '市', 'town', 'village', 'gu', 'ku', '中区', '杉並', '立川', '八王子', '下北沢', '東山', '渋谷', 'マンハッタン')) return 3500;
  return 5000;
};

const geocodeLocation = async (location: string, region: RegionConfig): Promise<GeocodedLocation> => {
  const query = location.trim();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(query)}`;
  try {
    const response = await timeoutFetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'milz-ai-discovery/1.0',
      },
    }, 10000);
    const rows = await response.json() as Array<any>;
    const first = rows?.[0];
    if (first?.lat && first?.lon) {
      return {
        display: safeText(first.display_name, query),
        lat: Number(first.lat),
        lng: Number(first.lon),
        radius: locationRadius(query),
        region,
        locationKey: buildLocationKey(query, region),
      };
    }
  } catch {}

  return {
    display: query,
    lat: region.center[0],
    lng: region.center[1],
    radius: locationRadius(query),
    region,
    locationKey: buildLocationKey(query, region),
  };
};

const locationTokens = (location: string) =>
  normalize(location)
    .split(/[\s,_|、　-]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

const isFoodCategory = (category: string) => contains(normalize(category), 'restaurant', 'food', 'cafe', 'coffee', 'bar', 'グルメ', 'レストラン', 'ランチ', 'ディナー', 'カフェ', '喫茶');
const recommendationBucket = (category: string): Bucket => isFoodCategory(category) ? 'food' : 'sightseeing';

const locationMatchesAdmin = (row: AdminPlace, location: GeocodedLocation) => {
  const haystack = normalize([row.country, row.prefecture, row.municipality, row.address, row.name, row.description].filter(Boolean).join(' '));
  const tokens = locationTokens(location.display);
  return tokens.some((token) => haystack.includes(token));
};

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
      .map((row) => ({ row, distance: haversineKm(location.lat, location.lng, Number(row.lat), Number(row.lng)) }))
      .filter(({ row, distance }) => Number.isFinite(distance) && distance <= Math.max(location.radius / 1000, 6) && locationMatchesAdmin(row, location))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20)
      .map(({ row, distance }) => ({
        name_ja: safeText(row.name),
        name_en: safeText(row.name),
        reason_ja: `${safeText(location.display)} から約${distance.toFixed(1)}km圏内にある管理登録スポットです。`,
        reason_en: `An admin-curated spot near ${safeText(location.display)} and within about ${distance.toFixed(1)} km of the selected area.`,
        category: safeText(row.category, 'PLACE').toUpperCase(),
        bucket: recommendationBucket(safeText(row.category)),
        lat: Number(row.lat),
        lng: Number(row.lng),
        address: safeText(row.address || row.municipality || row.prefecture || row.country),
        source: 'admin' as const,
      }));
  } catch {
    return [];
  }
};

const inferCategory = (el: OSMElement) => {
  const tags = el.tags || {};
  if (tags.amenity === 'cafe' || tags.amenity === 'coffee_shop') return 'CAFE';
  if (['restaurant', 'fast_food', 'food_court', 'bar', 'pub'].includes(tags.amenity || '')) return 'RESTAURANT';
  if (tags.shop) return 'SHOPPING';
  if (tags.leisure === 'park' || tags.leisure === 'garden') return 'PARK';
  if (tags.railway === 'station' || tags.public_transport === 'station' || tags.amenity === 'bus_station') return 'TRANSIT';
  if (['museum', 'gallery', 'attraction', 'viewpoint'].includes(tags.tourism || '')) return 'LANDMARK';
  if (tags.historic || tags.amenity === 'place_of_worship') return 'LANDMARK';
  return 'PLACE';
};

const elementNameJa = (el: OSMElement) => safeText(el.tags?.['name:ja'] || el.tags?.name || el.tags?.['official_name:ja']);
const elementNameEn = (el: OSMElement) => safeText(el.tags?.['name:en'] || el.tags?.name || el.tags?.official_name);
const elementAddress = (el: OSMElement) => safeText([el.tags?.['addr:city'], el.tags?.['addr:suburb'], el.tags?.['addr:street']].filter(Boolean).join(' '));

const recommendationReason = (locationLabel: string, distanceKm: number, bucket: Bucket, category: string) => {
  const distanceText = distanceKm < 1 ? '徒歩圏に近い' : `約${distanceKm.toFixed(1)}km圏内の`;
  if (bucket === 'food') return `${locationLabel} の中心から${distanceText}飲食候補です。現地で食事や休憩先を決めたい時に使いやすい実在店です。`;
  if (category === 'PARK') return `${locationLabel} の中心から${distanceText}観光候補です。散歩や景色目的で組み込みやすい実在スポットです。`;
  if (category === 'TRANSIT') return `${locationLabel} の中心から${distanceText}観光導線上の基点候補です。周辺回遊と合わせて使いやすいです。`;
  return `${locationLabel} の中心から${distanceText}観光候補です。このエリアで立ち寄りやすい実在スポットです。`;
};

const overpassClausesForBucket = (bucket: Bucket) => {
  if (bucket === 'food') {
    return [
      'node["amenity"~"restaurant|cafe|fast_food|bar|pub"]',
      'way["amenity"~"restaurant|cafe|fast_food|bar|pub"]',
      'relation["amenity"~"restaurant|cafe|fast_food|bar|pub"]',
    ];
  }
  return [
    'node["tourism"~"attraction|museum|gallery|viewpoint"]',
    'way["tourism"~"attraction|museum|gallery|viewpoint"]',
    'relation["tourism"~"attraction|museum|gallery|viewpoint"]',
    'node["historic"]','way["historic"]','relation["historic"]',
    'node["leisure"~"park|garden"]','way["leisure"~"park|garden"]','relation["leisure"~"park|garden"]',
    'node["amenity"="place_of_worship"]','way["amenity"="place_of_worship"]','relation["amenity"="place_of_worship"]',
  ];
};

const fetchOverpassRecommendations = async (location: GeocodedLocation, bucket: Bucket): Promise<RecommendationItem[]> => {
  const clauses = overpassClausesForBucket(bucket)
    .map((clause) => `${clause}(around:${location.radius},${location.lat},${location.lng});`)
    .join('');
  const body = `[out:json][timeout:18];(${clauses});out center tags 120;`;
  try {
    const response = await timeoutFetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
    }, 20000);
    const data = await response.json() as { elements?: OSMElement[] };
    const items = (data.elements || [])
      .map((el) => {
        const lat = Number(el.lat ?? el.center?.lat);
        const lng = Number(el.lon ?? el.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const nameJa = elementNameJa(el);
        const nameEn = elementNameEn(el);
        const name = nameJa || nameEn;
        if (!name) return null;
        const distanceKm = haversineKm(location.lat, location.lng, lat, lng);
        const category = inferCategory(el);
        return {
          key: `${normalize(name)}:${lat.toFixed(5)}:${lng.toFixed(5)}`,
          item: {
            name_ja: nameJa || name,
            name_en: nameEn || name,
            reason_ja: recommendationReason(safeText(location.display), distanceKm, bucket, category),
            reason_en: `A real nearby ${bucket} candidate around ${safeText(location.display)}, roughly ${distanceKm.toFixed(1)} km from the selected center.`,
            category,
            bucket,
            lat,
            lng,
            address: elementAddress(el),
            source: 'osm' as const,
          },
          distanceKm,
        };
      })
      .filter(Boolean) as Array<{ key: string; item: RecommendationItem; distanceKm: number }>;

    const deduped = new Map<string, { item: RecommendationItem; distanceKm: number }>();
    for (const entry of items) {
      const existing = deduped.get(entry.key);
      if (!existing || entry.distanceKm < existing.distanceKm) deduped.set(entry.key, { item: entry.item, distanceKm: entry.distanceKm });
    }

    return Array.from(deduped.values())
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, bucket === 'food' ? 12 : 16)
      .map((entry) => entry.item);
  } catch {
    return [];
  }
};

const regionFallbackNearest = (location: GeocodedLocation) => {
  const maxDistanceKm = Math.max(location.radius / 1000 * 1.8, 5);
  return [...location.region.fallbackSightseeing]
    .map((item) => ({ item, distanceKm: haversineKm(location.lat, location.lng, item.lat, item.lng) }))
    .filter(({ distanceKm }) => distanceKm <= maxDistanceKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ item, distanceKm }) => ({
      ...item,
      reason_ja: recommendationReason(safeText(location.display), distanceKm, 'sightseeing', item.category),
      reason_en: `A region fallback around ${safeText(location.display)}, roughly ${distanceKm.toFixed(1)} km from the selected center.`,
    }));
};

const buildRecommendationSet = (items: RecommendationItem[], limit: number) => {
  const seen = new Set<string>();
  const result: RecommendationItem[] = [];
  for (const item of items) {
    const key = `${normalize(item.name_en || item.name_ja)}:${item.lat.toFixed(4)}:${item.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
};

const generateRecommendations = async (locationInput: string, _category: string, region: RegionConfig, env: Env): Promise<RecommendationItem[]> => {
  const geocoded = await geocodeLocation(locationInput, region);
  const [admin, sightseeing, food] = await Promise.all([
    fetchAdminPlacesNear(geocoded, env),
    fetchOverpassRecommendations(geocoded, 'sightseeing'),
    fetchOverpassRecommendations(geocoded, 'food'),
  ]);

  const sightseeingPool = [...admin.filter((i) => i.bucket === 'sightseeing'), ...sightseeing, ...regionFallbackNearest(geocoded)];
  const foodPool = [...admin.filter((i) => i.bucket === 'food'), ...food];

  const sightseeingTop = buildRecommendationSet(sightseeingPool, 5);
  const foodTop = buildRecommendationSet(foodPool, 5);
  return [...sightseeingTop, ...foodTop];
};

const GOOGLE_QUERY_SUFFIXES = ['ランチ', 'カフェ', '観光', 'イベント', 'ホテル', 'アクセス', '駐車場', '天気', '桜', '居酒屋', '美術館', '公園'];

const fetchSuggestTerms = async (query: string, region: RegionConfig): Promise<string[]> => {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&gl=${region.countryCode}&q=${encodeURIComponent(query)}`;
    const response = await timeoutFetch(url, { headers: { Accept: 'application/json' } }, 10000);
    const data = await response.json() as [string, string[]];
    return Array.isArray(data?.[1]) ? data[1].map((item) => safeText(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const isBrokenText = (value: string) => /�|Ã|â/.test(value);
const isMeaningfulTrend = (value: string, location?: string) => {
  const text = safeText(value);
  if (!text || text.length < 2 || isBrokenText(text)) return false;
  if (/^[\W_]+$/u.test(text)) return false;
  if (location && normalize(text) === normalize(location)) return false;
  return true;
};

const trendReason = (keyword: string, location: string) => {
  const k = normalize(keyword);
  if (contains(k, 'ランチ', 'ディナー', 'グルメ', 'restaurant', 'food', '食べ歩き', '居酒屋', '寿司', '焼肉', 'ラーメン')) {
    return `${location} でこの語が検索されているのは、現地で食事先を決める直前ニーズが強いからだと考えられます。特に「いま行ける店」「比較したい店」を探す流れで検索が増えやすいです。`;
  }
  if (contains(k, 'カフェ', 'coffee', '喫茶', 'スイーツ', 'dessert')) {
    return `${location} では、散策や待ち合わせの途中で休憩先を探す動きが多く、この語が検索されやすいです。雰囲気や入りやすさを事前に見たい需要が背景にあります。`;
  }
  if (contains(k, 'ホテル', '宿', 'stay', '宿泊')) {
    return `${location} を訪れる前後で宿泊先を比較したい人が多く、この語の検索が伸びやすいです。立地や価格、移動しやすさを確認する意図が強いと考えられます。`;
  }
  if (contains(k, 'アクセス', '駅', '駐車場', 'parking', 'bus', 'taxi', '行き方')) {
    return `${location} へ向かう直前に、移動手段や駐車条件、最寄り動線を確かめたい人が多く、この語が検索されていると考えられます。`;
  }
  if (contains(k, 'イベント', '祭', 'フェス', 'ライブ', '展示', '期間限定')) {
    return `${location} 周辺で開催情報や期間限定の動きがあると、この語の確認検索が増えます。開催日・内容・混雑を知りたい需要が背景にあります。`;
  }
  if (contains(k, '桜', '紅葉', '天気', '夜景', '見頃', '花見')) {
    return `${location} の季節要因や景観確認の需要から、この語が検索されていると考えられます。行くタイミングや今の状態を判断したい時に伸びやすいです。`;
  }
  if (contains(k, '観光', '見どころ', '散歩', '遊び', 'デート', '美術館', '公園')) {
    return `${location} でどこを回るか決める段階で、この語が検索されやすいです。初回訪問でも動きやすい順番や立ち寄り先を知りたい人の検索意図が背景にあります。`;
  }
  return `${location} では、この語で「何があるか」「今なぜ見られているか」を確認する検索が増えていると考えられます。現地へ行く前の下調べや比較検討の需要が背景です。`;
};

const generateTrends = async (locationInput: string, region: RegionConfig): Promise<TrendItem[]> => {
  const locationLabel = safeText(locationInput);
  const queries = [locationLabel, ...GOOGLE_QUERY_SUFFIXES.map((suffix) => `${locationLabel} ${suffix}`)];
  const counts = new Map<string, number>();

  for (const query of queries) {
    const suggestions = await fetchSuggestTerms(query, region);
    for (const suggestion of suggestions) {
      const phrase = safeText(suggestion).replace(/\s+/g, ' ').trim();
      if (!isMeaningfulTrend(phrase, locationLabel)) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }

  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, 10);

  const maxScore = ranked[0]?.[1] || 1;
  return ranked.map(([keyword, score], index) => ({
    topic_ja: keyword,
    topic_en: keyword,
    keyword_ja: keyword,
    keyword_en: keyword,
    description_ja: trendReason(keyword, locationLabel),
    description_en: trendReason(keyword, locationLabel),
    category: '',
    popularity: Math.max(60, Math.min(99, Math.round(68 + (score / maxScore) * 24 - index))),
    source_url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}`,
  }));
};

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode: Mode = body?.mode === 'trend' ? 'trend' : 'recommend';
    const location = safeText(body?.location, '日本 東京都 渋谷').slice(0, 180);
    const category = safeText(body?.category, 'general').slice(0, 80);
    const region = pickRegion(location, safeText(body?.region).toLowerCase());

    const geocoded = await geocodeLocation(location, region);
    const cacheKey = await buildCacheKey(mode, geocoded.locationKey, category);
    const cacheUrl = `https://edge-cache.local/milz-ai-${cacheKey}`;
    const cache = caches.default;
    const cached = await cache.match(cacheUrl);
    if (cached) {
      return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers.entries()), ...corsHeaders, 'X-AI-Cache': 'HIT' } });
    }

    if (mode === 'recommend') {
      const recommendations = await generateRecommendations(location, category, region, env);
      return await toCacheResponse(cache, cacheUrl, {
        mode,
        location,
        category,
        region: region.key,
        geocoded: { lat: geocoded.lat, lng: geocoded.lng, display: geocoded.display },
        recommendations,
        generatedAt: new Date().toISOString(),
      }, RECOMMEND_TTL);
    }

    const trends = await generateTrends(location, region);
    return await toCacheResponse(cache, cacheUrl, {
      mode,
      location,
      category,
      region: region.key,
      geocoded: { lat: geocoded.lat, lng: geocoded.lng, display: geocoded.display },
      trends,
      generatedAt: new Date().toISOString(),
    }, TREND_TTL);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return json({ error: message }, 500);
  }
};

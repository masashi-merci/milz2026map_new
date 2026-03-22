export interface Env {
  GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

type Mode = 'recommend' | 'trend';

type RecommendationItem = {
  name_ja: string;
  name_en: string;
  reason_ja: string;
  reason_en: string;
  category: string;
  lat: number;
  lng: number;
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
  language: string;
  aliases: string[];
  center: [number, number];
  fallback: RecommendationItem[];
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

const CACHE_VERSION = 'v20';
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
    language: 'en',
    aliases: ['new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'nyc', 'ニューヨーク', 'マンハッタン'],
    center: [40.7831, -73.9712],
    fallback: [
      { name_ja: 'セントラルパーク', name_en: 'Central Park', reason_ja: '選択地点の近くで使いやすい定番スポットです。', reason_en: 'A reliable nearby pick for the selected area.', category: 'PARK', lat: 40.7812, lng: -73.9665, source: 'fallback' },
      { name_ja: 'グランドセントラル駅', name_en: 'Grand Central Terminal', reason_ja: '移動と建築の両面で立ち寄りやすい定番です。', reason_en: 'A dependable stop for transit and architecture.', category: 'TRANSIT', lat: 40.7527, lng: -73.9772, source: 'fallback' },
    ],
  },
  tokyo: {
    key: 'tokyo',
    label: 'Tokyo',
    countryCode: 'JP',
    language: 'ja',
    aliases: ['tokyo', '東京', '渋谷', '杉並', '立川', '下北沢', '新宿', '上野'],
    center: [35.6762, 139.6503],
    fallback: [
      { name_ja: '東京駅', name_en: 'Tokyo Station', reason_ja: '選択地点の近くの候補が不足したため、東京の代表的な基点を表示しています。', reason_en: 'Showing a reliable Tokyo anchor because nearby results were limited.', category: 'TRANSIT', lat: 35.6812, lng: 139.7671, source: 'fallback' },
      { name_ja: '代々木公園', name_en: 'Yoyogi Park', reason_ja: '東京で使いやすい公園系の定番候補です。', reason_en: 'A reliable Tokyo park fallback.', category: 'PARK', lat: 35.6728, lng: 139.6949, source: 'fallback' },
    ],
  },
  kyoto: {
    key: 'kyoto',
    label: 'Kyoto',
    countryCode: 'JP',
    language: 'ja',
    aliases: ['kyoto', '京都', '東山', '祇園', '河原町', '清水寺'],
    center: [35.0116, 135.7681],
    fallback: [
      { name_ja: '清水寺', name_en: 'Kiyomizu-dera', reason_ja: '京都の代表的な文化スポットです。', reason_en: 'A dependable Kyoto cultural anchor.', category: 'LANDMARK', lat: 34.9948, lng: 135.785, source: 'fallback' },
      { name_ja: '八坂神社', name_en: 'Yasaka Shrine', reason_ja: '東山・祇園側の導線に組み込みやすい定番です。', reason_en: 'A practical eastern Kyoto fallback.', category: 'LANDMARK', lat: 35.0037, lng: 135.7788, source: 'fallback' },
    ],
  },
  korea: {
    key: 'korea',
    label: 'Seoul',
    countryCode: 'KR',
    language: 'ko',
    aliases: ['seoul', 'ソウル', '韓国', '中区', 'jung-gu', '明洞'],
    center: [37.5665, 126.978],
    fallback: [
      { name_ja: '景福宮', name_en: 'Gyeongbokgung Palace', reason_ja: 'ソウルの代表的なランドマークです。', reason_en: 'A dependable Seoul landmark fallback.', category: 'LANDMARK', lat: 37.5796, lng: 126.977, source: 'fallback' },
      { name_ja: '明洞', name_en: 'Myeongdong', reason_ja: '買い物と食事をまとめやすい中心エリアです。', reason_en: 'A practical central Seoul shopping and food district.', category: 'SHOPPING', lat: 37.5636, lng: 126.985, source: 'fallback' },
    ],
  },
};

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } });

const normalize = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const safeText = (value: unknown, fallback = '') => String(value || '').trim() || fallback;
const contains = (source: string, ...needles: string[]) => needles.some((needle) => source.includes(normalize(needle)));

const categoryLabel = (category: string) => {
  const c = normalize(category || 'all');
  if (contains(c, 'cafe', 'coffee', 'カフェ', '喫茶')) return 'cafe';
  if (contains(c, 'restaurant', 'food', 'レストラン', '食事', 'グルメ', 'ランチ')) return 'food';
  if (contains(c, 'shopping', 'shop', 'ショッピング', '買い物', '商業')) return 'shopping';
  if (contains(c, 'park', 'nature', '公園', '自然', '庭園')) return 'park';
  if (contains(c, 'station', 'rail', 'transit', '駅', '交通')) return 'transit';
  if (contains(c, 'museum', 'gallery', '美術館', '博物館')) return 'museum';
  return 'all';
};

const buildCacheKey = async (mode: Mode, locationKey: string, category: string) => {
  const source = `${CACHE_VERSION}|${mode}|${locationKey}|${categoryLabel(category)}`;
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
  if (contains(normalized, '丁目', '番地', 'station', '駅', 'hotel', '寺', '神社', 'タワー', 'park', 'museum')) return 2200;
  if (contains(normalized, 'ward', '区', '市', 'town', 'village', 'gu', 'ku')) return 4500;
  if (contains(normalized, 'manhattan', 'brooklyn', '新宿', '渋谷', '杉並', '立川', '東山', '明洞')) return 5000;
  return 6500;
};

const geocodeLocation = async (location: string, region: RegionConfig): Promise<GeocodedLocation> => {
  const query = location.trim();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(query)}`;
  try {
    const response = await timeoutFetch(url, {
      headers: {
        'Accept': 'application/json',
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

const fetchAdminPlacesNear = async (location: GeocodedLocation, env: Env): Promise<RecommendationItem[]> => {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return [];
  try {
    const response = await timeoutFetch(`${env.SUPABASE_URL}/rest/v1/admin_places?select=id,name,description,category,municipality,prefecture,country,lat,lng`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    }, 10000);
    const rows = await response.json() as AdminPlace[];
    return rows
      .map((row) => ({ row, distance: haversineKm(location.lat, location.lng, Number(row.lat), Number(row.lng)) }))
      .filter(({ distance }) => distance <= Math.max(location.radius / 1000, 8))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20)
      .map(({ row, distance }) => ({
        name_ja: safeText(row.name),
        name_en: safeText(row.name),
        reason_ja: `${safeText(location.display)} の近くにある管理登録スポットで、現在地から約${distance.toFixed(1)}km圏内です。`,
        reason_en: `An admin-curated spot near ${safeText(location.display)} and within about ${distance.toFixed(1)} km of the selected area.`,
        category: safeText(row.category, 'PLACE').toUpperCase(),
        lat: Number(row.lat),
        lng: Number(row.lng),
        source: 'admin' as const,
      }));
  } catch {
    return [];
  }
};

const overpassClauses = (category: string) => {
  switch (categoryLabel(category)) {
    case 'cafe':
      return ['node["amenity"~"cafe|coffee_shop"]', 'way["amenity"~"cafe|coffee_shop"]', 'relation["amenity"~"cafe|coffee_shop"]'];
    case 'food':
      return ['node["amenity"~"restaurant|food_court|fast_food"]', 'way["amenity"~"restaurant|food_court|fast_food"]', 'relation["amenity"~"restaurant|food_court|fast_food"]'];
    case 'shopping':
      return ['node["shop"]', 'way["shop"]', 'relation["shop"]', 'node["tourism"="mall"]', 'way["tourism"="mall"]'];
    case 'park':
      return ['node["leisure"~"park|garden"]', 'way["leisure"~"park|garden"]', 'relation["leisure"~"park|garden"]'];
    case 'transit':
      return ['node["railway"="station"]', 'way["railway"="station"]', 'node["public_transport"="station"]', 'node["amenity"="bus_station"]'];
    case 'museum':
      return ['node["tourism"~"museum|gallery"]', 'way["tourism"~"museum|gallery"]', 'relation["tourism"~"museum|gallery"]'];
    default:
      return [
        'node["amenity"~"restaurant|cafe|fast_food"]', 'way["amenity"~"restaurant|cafe|fast_food"]',
        'node["tourism"~"attraction|museum|gallery"]', 'way["tourism"~"attraction|museum|gallery"]',
        'node["leisure"~"park|garden"]', 'way["leisure"~"park|garden"]',
        'node["shop"]', 'way["shop"]',
        'node["railway"="station"]', 'way["railway"="station"]',
      ];
  }
};

const elementNameJa = (el: OSMElement) => safeText(el.tags?.['name:ja'] || el.tags?.name || el.tags?.['official_name:ja']);
const elementNameEn = (el: OSMElement) => safeText(el.tags?.['name:en'] || el.tags?.name || el.tags?.['official_name']);

const inferCategory = (el: OSMElement) => {
  const tags = el.tags || {};
  if (tags.amenity === 'cafe' || tags.amenity === 'coffee_shop') return 'CAFE';
  if (['restaurant', 'fast_food', 'food_court'].includes(tags.amenity || '')) return 'RESTAURANT';
  if (tags.shop) return 'SHOPPING';
  if (tags.leisure === 'park' || tags.leisure === 'garden') return 'PARK';
  if (tags.railway === 'station' || tags.public_transport === 'station' || tags.amenity === 'bus_station') return 'TRANSIT';
  if (['museum', 'gallery', 'attraction'].includes(tags.tourism || '')) return 'LANDMARK';
  if (tags.historic || tags.tourism || tags.landuse === 'cemetery') return 'LANDMARK';
  return 'PLACE';
};

const recommendationReason = (name: string, category: string, locationLabel: string, distanceKm: number) => {
  const distanceText = distanceKm < 1 ? '徒歩圏に近い' : `約${distanceKm.toFixed(1)}km圏内の`;
  const base = `${locationLabel} の中心から${distanceText}候補です。`;
  if (category === 'CAFE') return `${base}休憩や待ち合わせを入れやすく、エリア滞在中に使い勝手が良いです。`;
  if (category === 'RESTAURANT') return `${base}食事目的で立ち寄りやすく、周辺回遊と合わせやすいです。`;
  if (category === 'SHOPPING') return `${base}買い物や周辺散策をまとめやすい候補です。`;
  if (category === 'PARK') return `${base}散歩や景色目的で組み込みやすい候補です。`;
  if (category === 'TRANSIT') return `${base}移動の基点としても見どころとしても使いやすい候補です。`;
  return `${base}このエリアで立ち寄り先にしやすい実在スポットです。`;
};

const fetchOverpassRecommendations = async (location: GeocodedLocation, category: string): Promise<RecommendationItem[]> => {
  const clauses = overpassClauses(category)
    .map((clause) => `${clause}(around:${location.radius},${location.lat},${location.lng});`)
    .join('');
  const body = `[out:json][timeout:18];(${clauses});out center tags 80;`;
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
        const categoryName = inferCategory(el);
        return {
          key: `${normalize(name)}:${lat.toFixed(5)}:${lng.toFixed(5)}`,
          item: {
            name_ja: nameJa || name,
            name_en: nameEn || name,
            reason_ja: recommendationReason(name, categoryName, safeText(location.display), distanceKm),
            reason_en: `A real nearby ${categoryName.toLowerCase()} candidate around ${safeText(location.display)}, roughly ${distanceKm.toFixed(1)} km from the selected center.`,
            category: categoryName,
            lat,
            lng,
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
      .slice(0, 30)
      .map((entry) => entry.item);
  } catch {
    return [];
  }
};

const regionFallbackNearest = (location: GeocodedLocation) => {
  const maxDistanceKm = Math.max(location.radius / 1000 * 2.2, 8);
  return [...location.region.fallback]
    .map((item) => ({ item, distanceKm: haversineKm(location.lat, location.lng, item.lat, item.lng) }))
    .filter(({ distanceKm }) => distanceKm <= maxDistanceKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ item, distanceKm }) => ({
      ...item,
      reason_ja: recommendationReason(item.name_ja || item.name_en, item.category, safeText(location.display), distanceKm),
      reason_en: `A region fallback around ${safeText(location.display)}, roughly ${distanceKm.toFixed(1)} km from the selected center.`,
    }));
};

const generateRecommendations = async (locationInput: string, category: string, region: RegionConfig, env: Env): Promise<RecommendationItem[]> => {
  const geocoded = await geocodeLocation(locationInput, region);
  const [admin, osm] = await Promise.all([
    fetchAdminPlacesNear(geocoded, env),
    fetchOverpassRecommendations(geocoded, category),
  ]);

  const buckets = [...admin, ...osm, ...regionFallbackNearest(geocoded)];
  const deduped = new Map<string, RecommendationItem>();
  for (const item of buckets) {
    const key = `${normalize(item.name_en || item.name_ja)}:${item.lat.toFixed(4)}:${item.lng.toFixed(4)}`;
    if (!deduped.has(key)) deduped.set(key, item);
    if (deduped.size >= 14) break;
  }

  return Array.from(deduped.values()).slice(0, 10);
};

const GOOGLE_QUERY_SUFFIXES = ['人気', 'ランチ', 'カフェ', '観光', 'イベント', 'ホテル', 'アクセス', '駐車場', '天気', '見どころ'];

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

const removeLocationPrefix = (value: string, location: string) => {
  let output = safeText(value);
  const variants = [location]
    .concat(location.split(/[\s,、　]+/g))
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`^${escaped}[\\s　・:/-]*`, 'iu'), '').trim();
  }
  return output.replace(/^[\s　・:/-]+|[\s　・:/-]+$/g, '').trim();
};

const isBrokenText = (value: string) => /�|Ã|â|�/.test(value);

const isMeaningfulTrend = (value: string) => {
  const text = safeText(value);
  if (!text || text.length < 2 || isBrokenText(text)) return false;
  if (/^[\W_]+$/u.test(text)) return false;
  const banned = ['人気', 'おすすめ', 'とは', '近く', '現在', '今日', '明日', '安い', '口コミ', 'ランキング', 'google'];
  const generic = ['観光', 'ランチ', 'カフェ', 'イベント', 'ホテル', 'アクセス', '駐車場', '天気', '見どころ'];
  if (banned.includes(text.toLowerCase())) return false;
  if (generic.includes(text) && text.length <= 4) return false;
  return true;
};

const trendReason = (keyword: string, location: string) => {
  const k = normalize(keyword);
  if (contains(k, 'ランチ', 'ディナー', 'グルメ', 'restaurant', 'food', '食べ歩き', '居酒屋')) {
    return {
      ja: `${location} では、現地で食事先を決めたい人が直前に比較しやすい語としてこのワードが伸びています。実際に行く前に「どこで食べるか」を決める用途の検索が集まりやすいです。`,
      en: `This keyword is likely rising because people around ${location} are comparing meal options right before visiting.`
    };
  }
  if (contains(k, 'カフェ', 'coffee', '喫茶', 'スイーツ', 'dessert')) {
    return {
      ja: `${location} では、休憩先や待ち合わせ先を探す流れでこのワードが検索されやすいです。散策中に「近くで入りやすい店はどこか」を確認する需要が背景にあります。`,
      en: `This keyword likely reflects people looking for café or dessert stops around ${location} during a walk or short break.`
    };
  }
  if (contains(k, 'ホテル', '宿', 'stay', '宿泊')) {
    return {
      ja: `${location} へ行く前後で宿泊候補を探す人が多く、このワードで比較検索されやすいです。滞在計画と移動動線を一緒に決めるときに検索が伸びます。`,
      en: `This keyword likely rises when people compare lodging options before or during a trip to ${location}.`
    };
  }
  if (contains(k, 'アクセス', '駅', '駐車場', 'parking', 'bus', 'taxi')) {
    return {
      ja: `${location} では、現地へ向かう直前に移動手段やアクセス条件を確認する検索が集まりやすく、このワードが伸びています。`,
      en: `This keyword is likely driven by last-minute access and transportation checks for ${location}.`
    };
  }
  if (contains(k, 'イベント', '祭', 'フェス', 'ライブ', '展示', '期間限定')) {
    return {
      ja: `${location} 周辺で開催情報や期間限定の動きが出ると、このワードの確認検索が増えます。開催日や内容、混雑を知りたい需要が背景にあります。`,
      en: `This keyword likely reflects searches for event timing, details, and crowd expectations around ${location}.`
    };
  }
  if (contains(k, '桜', '紅葉', '天気', '夜景', '見頃', '花見')) {
    return {
      ja: `${location} の季節要因や景観確認の需要から、このワードが検索されています。行くタイミングや見どころを判断したい時に伸びやすい語です。`,
      en: `This keyword likely rises when people check seasonality, weather, or scenic timing around ${location}.`
    };
  }
  if (contains(k, '観光', '見どころ', '散歩', '遊び', 'デート')) {
    return {
      ja: `${location} で何を優先して回るか決める段階で、このワードがよく検索されます。初回訪問や短時間滞在でも動きやすい導線を探す検索意図が背景にあります。`,
      en: `This keyword likely reflects planning searches for what to prioritize and how to move around ${location}.`
    };
  }
  return {
    ja: `${location} では、このワードで「何があるか」「今なぜ注目されているか」を確認する検索が集まっていると考えられます。現地行動の前に比較や下調べをしたい需要が背景にあります。`,
    en: `This keyword likely reflects pre-visit comparison and context checks for ${location}.`
  };
};

const generateTrends = async (locationInput: string, region: RegionConfig): Promise<TrendItem[]> => {
  const geocoded = await geocodeLocation(locationInput, region);
  const locationLabel = safeText(locationInput);
  const queries = [locationLabel, ...GOOGLE_QUERY_SUFFIXES.map((suffix) => `${locationLabel} ${suffix}`)];
  const counts = new Map<string, number>();

  for (const query of queries) {
    const suggestions = await fetchSuggestTerms(query, region);
    for (const suggestion of suggestions) {
      const keyword = removeLocationPrefix(suggestion, locationLabel);
      if (!isMeaningfulTrend(keyword)) continue;
      counts.set(keyword, (counts.get(keyword) || 0) + 1);
    }
  }

  if (counts.size === 0) {
    for (const suffix of GOOGLE_QUERY_SUFFIXES) counts.set(suffix, (counts.get(suffix) || 0) + 1);
  }

  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, 10);

  const maxScore = ranked[0]?.[1] || 1;
  return ranked.map(([keyword, score], index) => {
    const reason = trendReason(keyword, locationLabel);
    return {
      topic_ja: keyword,
      topic_en: keyword,
      keyword_ja: keyword,
      keyword_en: keyword,
      description_ja: reason.ja,
      description_en: reason.en,
      category: '',
      popularity: Math.max(60, Math.min(99, Math.round(65 + (score / maxScore) * 28 - index))),
      source_url: `https://www.google.com/search?q=${encodeURIComponent(`${locationLabel} ${keyword}`)}`,
    };
  });
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

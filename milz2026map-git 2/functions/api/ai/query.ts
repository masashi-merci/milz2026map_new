import { GoogleGenAI, Type } from '@google/genai';

export interface Env {
  GEMINI_API_KEY: string;
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

type RegionConfig = {
  key: 'ny' | 'tokyo' | 'kyoto' | 'korea';
  label: string;
  trendGeo: 'US' | 'JP' | 'KR';
  countryCode: string;
  searchArea: string;
  aliases: string[];
  fallbackRecommendations: RecommendationItem[];
};

type TrendFeedItem = {
  title: string;
  traffic: string;
  sourceUrl: string;
};

const CACHE_VERSION = 'v4';
const RECOMMEND_TTL = 60 * 60 * 24 * 14;
const TREND_TTL = 60 * 60 * 24;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
    },
  });

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const contains = (source: string, ...needles: string[]) => needles.some((needle) => source.includes(normalize(needle)));

const REGIONS: RegionConfig[] = [
  {
    key: 'ny',
    label: 'New York',
    trendGeo: 'US',
    countryCode: 'us',
    searchArea: 'Manhattan, New York, USA',
    aliases: ['new york', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx'],
    fallbackRecommendations: [
      { name_ja: 'セントラルパーク', name_en: 'Central Park', reason_ja: '街歩きと景色をまとめやすく、初回訪問でも外しにくいニューヨークの代表スポットです。', reason_en: 'A highly practical New York anchor for walking, scenery, and first-time visits.', category: 'PARK', lat: 40.7812, lng: -73.9665 },
      { name_ja: 'グランドセントラル駅', name_en: 'Grand Central Terminal', reason_ja: '建築と移動を一緒に楽しめる定番で、周辺ルートにもつなげやすいです。', reason_en: 'A classic architectural stop that also works as a practical routing anchor.', category: 'LANDMARK', lat: 40.7527, lng: -73.9772 },
      { name_ja: 'チェルシーマーケット', name_en: 'Chelsea Market', reason_ja: '食事と買い物を一度にまとめやすく、短時間でも満足度を作りやすいです。', reason_en: 'A reliable stop that combines food and browsing in a compact route.', category: 'RESTAURANT', lat: 40.7424, lng: -74.0060 },
      { name_ja: 'ハイライン', name_en: 'The High Line', reason_ja: 'チェルシーやハドソンヤーズとつなぎやすい散策スポットです。', reason_en: 'A flexible walking stop that pairs naturally with Chelsea and Hudson Yards.', category: 'PARK', lat: 40.7480, lng: -74.0048 },
      { name_ja: 'ソーホー', name_en: 'SoHo', reason_ja: '買い物と街歩きをまとめやすく、定番として非常に使いやすいです。', reason_en: 'A practical district for shopping and city walking.', category: 'SHOPPING', lat: 40.7233, lng: -74.0020 },
    ],
  },
  {
    key: 'tokyo',
    label: 'Tokyo',
    trendGeo: 'JP',
    countryCode: 'jp',
    searchArea: 'Tokyo, Japan',
    aliases: ['tokyo', '東京', 'shibuya', 'shinjuku', 'ginza', 'asakusa'],
    fallbackRecommendations: [
      { name_ja: '渋谷スクランブルスクエア', name_en: 'Shibuya Scramble Square', reason_ja: '渋谷の買い物・食事・展望をまとめやすい代表スポットです。', reason_en: 'A strong Shibuya anchor for shopping, dining, and city views.', category: 'SHOPPING', lat: 35.6580, lng: 139.7016 },
      { name_ja: '明治神宮', name_en: 'Meiji Jingu', reason_ja: '原宿や表参道の動線に組み込みやすい定番の文化スポットです。', reason_en: 'A reliable cultural stop that pairs naturally with Harajuku and Omotesando.', category: 'LANDMARK', lat: 35.6764, lng: 139.6993 },
      { name_ja: '浅草寺', name_en: 'Senso-ji', reason_ja: '東京らしさを感じやすく、周辺散策とも相性が良いです。', reason_en: 'A classic Tokyo landmark that works well with nearby walking routes.', category: 'LANDMARK', lat: 35.7148, lng: 139.7967 },
      { name_ja: '東京ミッドタウン', name_en: 'Tokyo Midtown', reason_ja: '六本木で食事や買い物をまとめやすい大型施設です。', reason_en: 'A flexible Roppongi stop for dining and shopping.', category: 'SHOPPING', lat: 35.6654, lng: 139.7310 },
      { name_ja: '中目黒', name_en: 'Nakameguro', reason_ja: 'カフェや散策目的で使いやすく、雰囲気の良さも分かりやすいエリアです。', reason_en: 'An easy district for café stops and relaxed city walking.', category: 'CAFE', lat: 35.6442, lng: 139.6987 },
    ],
  },
  {
    key: 'kyoto',
    label: 'Kyoto',
    trendGeo: 'JP',
    countryCode: 'jp',
    searchArea: 'Kyoto, Japan',
    aliases: ['kyoto', '京都', 'gion', 'arashiyama', 'kawaramachi', 'fushimi'],
    fallbackRecommendations: [
      { name_ja: '清水寺', name_en: 'Kiyomizu-dera', reason_ja: '京都らしい景観を感じやすく、東山散策の軸にしやすいです。', reason_en: 'A classic Kyoto anchor that works well for eastern Kyoto walking.', category: 'LANDMARK', lat: 34.9948, lng: 135.7850 },
      { name_ja: '伏見稲荷大社', name_en: 'Fushimi Inari Taisha', reason_ja: '初回訪問でも選びやすく、京都らしい体験として非常に分かりやすいです。', reason_en: 'A memorable Kyoto destination that is easy to justify on a first visit.', category: 'LANDMARK', lat: 34.9671, lng: 135.7727 },
      { name_ja: '錦市場', name_en: 'Nishiki Market', reason_ja: '食べ歩きと中心部散策をまとめやすいです。', reason_en: 'A practical central Kyoto stop for food and browsing.', category: 'RESTAURANT', lat: 35.0050, lng: 135.7641 },
      { name_ja: '嵐山竹林の小径', name_en: 'Arashiyama Bamboo Grove', reason_ja: '景観目的で非常に分かりやすく、嵐山観光の柱になります。', reason_en: 'A visually strong Kyoto highlight that anchors an Arashiyama route.', category: 'PARK', lat: 35.0170, lng: 135.6713 },
      { name_ja: '八坂神社', name_en: 'Yasaka Shrine', reason_ja: '祇園エリアの散策と合わせやすい定番スポットです。', reason_en: 'A practical stop that pairs naturally with Gion walking.', category: 'LANDMARK', lat: 35.0037, lng: 135.7788 },
    ],
  },
  {
    key: 'korea',
    label: 'Seoul',
    trendGeo: 'KR',
    countryCode: 'kr',
    searchArea: 'Seoul, South Korea',
    aliases: ['korea', 'seoul', '韓国', 'ソウル', 'myeongdong', 'hongdae', 'gangnam'],
    fallbackRecommendations: [
      { name_ja: '景福宮', name_en: 'Gyeongbokgung Palace', reason_ja: 'ソウル観光の定番で、韓国らしい体験として分かりやすいです。', reason_en: 'A core Seoul landmark that works very well for first-time visitors.', category: 'LANDMARK', lat: 37.5796, lng: 126.9770 },
      { name_ja: '明洞', name_en: 'Myeongdong', reason_ja: '買い物と食べ歩きを短時間でまとめやすい王道エリアです。', reason_en: 'A practical district for shopping and street-food in a compact route.', category: 'SHOPPING', lat: 37.5636, lng: 126.9850 },
      { name_ja: '弘大', name_en: 'Hongdae', reason_ja: 'カフェや若者向けショップが多く、街歩きしやすいです。', reason_en: 'A lively area for cafés, indie shops, and casual walking.', category: 'CAFE', lat: 37.5563, lng: 126.9236 },
      { name_ja: '広蔵市場', name_en: 'Gwangjang Market', reason_ja: '韓国らしいローカルフード体験として分かりやすいです。', reason_en: 'A clear local-food stop that works well in Seoul.', category: 'RESTAURANT', lat: 37.5704, lng: 126.9996 },
      { name_ja: 'Nソウルタワー', name_en: 'N Seoul Tower', reason_ja: '景色目的で選びやすい定番の眺望スポットです。', reason_en: 'A classic skyline stop that is easy to include in a Seoul route.', category: 'LANDMARK', lat: 37.5512, lng: 126.9882 },
    ],
  },
];

const categoryLabel = (category: string) => {
  const c = normalize(category || 'all');
  if (contains(c, 'cafe', 'coffee', 'カフェ', '喫茶')) return 'cafe';
  if (contains(c, 'restaurant', 'food', 'レストラン', 'グルメ', 'ランチ')) return 'restaurant';
  if (contains(c, 'shopping', 'shop', 'ショッピング', '買い物')) return 'shopping';
  if (contains(c, 'park', 'nature', '公園', '自然')) return 'park';
  if (contains(c, 'transit', 'station', 'rail', '交通', '駅')) return 'transit';
  return 'all';
};

const buildCacheKey = async (mode: Mode, location: string, category: string) => {
  const source = `${CACHE_VERSION}|${mode}|${normalize(location)}|${normalize(category || 'general')}`;
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('\n');
};

const timeoutFetch = async <T>(promiseFactory: () => Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Upstream timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const pickRegion = (location: string): RegionConfig => {
  const normalized = normalize(location || '');
  return REGIONS.find((region) => region.aliases.some((alias) => normalized.includes(normalize(alias)))) || REGIONS[0];
};

const toCacheResponse = async (cache: Cache, cacheUrl: string, payload: unknown, ttlSeconds: number) => {
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Cache-Control': `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${Math.max(3600, Math.floor(ttlSeconds / 4))}`,
      'X-AI-Cache': 'MISS',
    },
  });
  await cache.put(cacheUrl, response.clone());
  return response;
};

const parseXmlEntities = (value: string) => value
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

const parseGoogleTrendsRss = (xml: string): TrendFeedItem[] => {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g));
  return items.slice(0, 10).map((match) => {
    const chunk = match[1] || '';
    const title = parseXmlEntities((chunk.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
    const traffic = parseXmlEntities((chunk.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1] || '').trim());
    const sourceUrl = parseXmlEntities((chunk.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim());
    return { title, traffic, sourceUrl };
  }).filter((item) => item.title);
};

const fetchTrendFeed = async (region: RegionConfig): Promise<TrendFeedItem[]> => {
  const url = `https://trends.google.com/trending/rss?geo=${region.trendGeo}`;
  const res = await timeoutFetch(() => fetch(url, {
    headers: {
      'User-Agent': 'Milz/1.0 (+https://github.com/masashi-merci/milz2026map_new)',
      'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    },
  }), 9000);
  if (!res.ok) throw new Error(`Google Trends RSS failed: ${res.status}`);
  const xml = await res.text();
  return parseGoogleTrendsRss(xml);
};

const geocodePlace = async (name: string, region: RegionConfig) => {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${name}, ${region.searchArea}`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  const res = await timeoutFetch(() => fetch(url.toString(), {
    headers: {
      'User-Agent': 'Milz/1.0 (+https://github.com/masashi-merci/milz2026map_new)',
      'Accept': 'application/json',
    },
  }), 8000);
  if (!res.ok) return null;
  const json = await res.json() as any[];
  const row = Array.isArray(json) ? json[0] : null;
  if (!row?.lat || !row?.lon) return null;
  return { lat: Number(row.lat), lng: Number(row.lon) };
};

const buildTrendFallback = (region: RegionConfig, feed: TrendFeedItem[]): TrendItem[] => {
  return feed.slice(0, 5).map((item, index) => ({
    topic_ja: item.title,
    topic_en: item.title,
    keyword_ja: item.title,
    keyword_en: item.title,
    description_ja: `${region.label} で実際に検索上位へ出ている話題です。検索流入を見ながら関連スポットや企画に結び付けやすいテーマです。`,
    description_en: `This is a search-heavy topic currently surfacing in ${region.label}. It is suitable for tying into related places, content, or campaigns.`,
    category: 'TREND',
    popularity: Math.max(55, 95 - index * 7),
    source_url: item.sourceUrl,
  }));
};

const buildRecommendationFallback = (region: RegionConfig) => region.fallbackRecommendations.slice(0, 5);

const sanitizeRecommendationCategory = (value: string) => {
  const upper = String(value || 'PLACE').trim().toUpperCase();
  return upper || 'PLACE';
};

const generateRecommendations = async (ai: GoogleGenAI, location: string, category: string, region: RegionConfig): Promise<RecommendationItem[]> => {
  const prompt = [
    'You are a bilingual local discovery planner.',
    `Location: ${location}.`,
    `Category preference: ${category || 'general'}.`,
    'Return 8 existing places that a traveler or local can actually visit now.',
    'Do not output generic areas, vague districts, or placeholders.',
    'Every recommendation must be a real place, facility, temple, market, park, museum, station, shopping building, café, or restaurant.',
    'Use concise but meaningful reasons that explain why the place fits the route or intent.',
    'Return JSON only.',
  ].join('\n');

  const response = await timeoutFetch(() => ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name_ja: { type: Type.STRING },
                name_en: { type: Type.STRING },
                reason_ja: { type: Type.STRING },
                reason_en: { type: Type.STRING },
                category: { type: Type.STRING },
              },
              required: ['name_ja', 'name_en', 'reason_ja', 'reason_en', 'category'],
            },
          },
        },
        required: ['recommendations'],
      },
      maxOutputTokens: 900,
      temperature: 0.2,
    },
  }), 12000);

  const text = response.text;
  if (!text) throw new Error('Empty AI response');
  const parsed = JSON.parse(text) as { recommendations?: Array<Record<string, unknown>> };
  const raw = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const validated: RecommendationItem[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    const nameEn = String(row.name_en || row.name_ja || '').trim();
    const nameJa = String(row.name_ja || row.name_en || '').trim();
    const reasonJa = String(row.reason_ja || '').trim();
    const reasonEn = String(row.reason_en || '').trim();
    if (!nameEn || !nameJa || !reasonJa || !reasonEn) continue;
    const key = normalize(nameEn);
    if (seen.has(key)) continue;
    const geo = await geocodePlace(nameEn, region) || await geocodePlace(nameJa, region);
    if (!geo) continue;
    validated.push({
      name_ja: nameJa,
      name_en: nameEn,
      reason_ja: reasonJa,
      reason_en: reasonEn,
      category: sanitizeRecommendationCategory(String(row.category || 'PLACE')),
      lat: geo.lat,
      lng: geo.lng,
    });
    seen.add(key);
    if (validated.length >= 5) break;
  }

  if (validated.length >= 5) return validated;
  for (const item of buildRecommendationFallback(region)) {
    if (seen.has(normalize(item.name_en))) continue;
    validated.push(item);
    seen.add(normalize(item.name_en));
    if (validated.length >= 5) break;
  }
  return validated.slice(0, 5);
};

const summarizeTrends = async (ai: GoogleGenAI, region: RegionConfig, location: string, category: string, feed: TrendFeedItem[]): Promise<TrendItem[]> => {
  const sourceLines = feed.slice(0, 8).map((item, index) => `${index + 1}. ${item.title}${item.traffic ? ` | traffic: ${item.traffic}` : ''}`);
  const prompt = [
    'You are a bilingual trend editor for a travel and local discovery app.',
    `Target location: ${location}. Region baseline: ${region.label}. Category preference: ${category || 'general'}.`,
    'Below are actual trending search queries from Google Trends RSS. Keep the core search term recognizable.',
    'Return exactly 5 items in JSON. topic_ja/topic_en should stay close to the original search term, while description_ja/description_en explain why the term is hot and how it may connect to local discovery.',
    'Do not invent fake facilities. Do not convert search terms into placeholders.',
    sourceLines.join('\n'),
  ].join('\n');

  const response = await timeoutFetch(() => ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          trends: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic_ja: { type: Type.STRING },
                topic_en: { type: Type.STRING },
                description_ja: { type: Type.STRING },
                description_en: { type: Type.STRING },
                category: { type: Type.STRING },
                popularity: { type: Type.NUMBER },
                keyword_ja: { type: Type.STRING },
                keyword_en: { type: Type.STRING },
              },
              required: ['topic_ja', 'topic_en', 'description_ja', 'description_en', 'category', 'popularity'],
            },
          },
        },
        required: ['trends'],
      },
      maxOutputTokens: 900,
      temperature: 0.15,
    },
  }), 12000);

  const text = response.text;
  if (!text) throw new Error('Empty AI response');
  const parsed = JSON.parse(text) as { trends?: Array<Record<string, unknown>> };
  const raw = Array.isArray(parsed.trends) ? parsed.trends : [];
  const results: TrendItem[] = [];

  for (let index = 0; index < raw.length && results.length < 5; index += 1) {
    const row = raw[index];
    const source = feed[index] || feed[0];
    const topicJa = String(row.topic_ja || row.keyword_ja || source?.title || '').trim();
    const topicEn = String(row.topic_en || row.keyword_en || source?.title || '').trim();
    const descriptionJa = String(row.description_ja || '').trim();
    const descriptionEn = String(row.description_en || '').trim();
    if (!topicJa || !topicEn || !descriptionJa || !descriptionEn) continue;
    results.push({
      topic_ja: topicJa,
      topic_en: topicEn,
      keyword_ja: String(row.keyword_ja || source?.title || topicJa).trim(),
      keyword_en: String(row.keyword_en || source?.title || topicEn).trim(),
      description_ja: descriptionJa,
      description_en: descriptionEn,
      category: String(row.category || 'TREND').trim() || 'TREND',
      popularity: typeof row.popularity === 'number' ? Math.max(50, Math.min(100, row.popularity)) : Math.max(55, 95 - index * 7),
      source_url: source?.sourceUrl || '',
    });
  }

  if (results.length >= 5) return results.slice(0, 5);
  return buildTrendFallback(region, feed);
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not configured' }, 500);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode: Mode = body?.mode === 'trend' ? 'trend' : 'recommend';
    const location = String(body?.location || 'New York Manhattan').trim().slice(0, 160);
    const category = String(body?.category || 'general').trim().slice(0, 80);
    const bodyRefresh = Boolean(body?.refresh);

    const region = pickRegion(location);
    const cacheKey = await buildCacheKey(mode, `${region.key}:${location}`, category);
    const cacheUrl = `https://edge-cache.local/milz-ai-${cacheKey}`;
    const cache = caches.default;
    const cached = bodyRefresh ? null : await cache.match(cacheUrl);
    if (cached) {
      return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers.entries()), ...corsHeaders, 'X-AI-Cache': 'HIT' } });
    }

    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    if (mode === 'recommend') {
      const recommendations = await generateRecommendations(ai, location, category, region);
      return await toCacheResponse(cache, cacheUrl, {
        recommendations,
        generatedAt: new Date().toISOString(),
        mode,
        location,
        category,
        region: region.key,
      }, RECOMMEND_TTL);
    }

    const feed = await fetchTrendFeed(region);
    const trends = feed.length ? await summarizeTrends(ai, region, location, category, feed) : buildTrendFallback(region, []);
    return await toCacheResponse(cache, cacheUrl, {
      trends,
      generatedAt: new Date().toISOString(),
      mode,
      location,
      category,
      region: region.key,
    }, TREND_TTL);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return json({ error: message }, 500);
  }
};

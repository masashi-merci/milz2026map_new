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

const CACHE_VERSION = 'v5';
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
      { name_ja: 'ロックフェラー・センター', name_en: 'Rockefeller Center', reason_ja: '展望・買い物・季節イベントをまとめやすいミッドタウンの定番です。', reason_en: 'A reliable Midtown destination for views, shopping, and seasonal events.', category: 'LANDMARK', lat: 40.7587, lng: -73.9787 },
      { name_ja: 'メトロポリタン美術館', name_en: 'The Metropolitan Museum of Art', reason_ja: '文化体験を入れたいときに強く、セントラルパークと合わせやすいです。', reason_en: 'A strong cultural stop that pairs naturally with Central Park.', category: 'MUSEUM', lat: 40.7794, lng: -73.9632 },
      { name_ja: 'ブライアントパーク', name_en: 'Bryant Park', reason_ja: '休憩や街歩きに組み込みやすい、ミッドタウンの使い勝手の良い公園です。', reason_en: 'A convenient Midtown park for a short break and surrounding routes.', category: 'PARK', lat: 40.7536, lng: -73.9832 },
      { name_ja: 'ニューヨーク近代美術館', name_en: 'Museum of Modern Art', reason_ja: '短時間でも見どころを作りやすい代表的な美術館です。', reason_en: 'A practical museum stop with strong highlights even on a compact route.', category: 'MUSEUM', lat: 40.7614, lng: -73.9776 },
      { name_ja: 'ブルックリン・ブリッジ・パーク', name_en: 'Brooklyn Bridge Park', reason_ja: '景色と散策を楽しみやすく、写真映えも分かりやすいです。', reason_en: 'A visually strong waterfront stop for skyline views and walking.', category: 'PARK', lat: 40.7003, lng: -73.9967 },
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
      { name_ja: '東京タワー', name_en: 'Tokyo Tower', reason_ja: '景色目的で選びやすく、東京らしさを感じやすい定番ランドマークです。', reason_en: 'A classic skyline landmark that is easy to add to a Tokyo route.', category: 'LANDMARK', lat: 35.6586, lng: 139.7454 },
      { name_ja: '東京駅', name_en: 'Tokyo Station', reason_ja: '建築と移動の両面で使いやすく、周辺散策にもつなげやすいです。', reason_en: 'A practical transit and architecture stop that fits many Tokyo routes.', category: 'TRANSIT', lat: 35.6812, lng: 139.7671 },
      { name_ja: '上野公園', name_en: 'Ueno Park', reason_ja: '美術館や自然を一緒に楽しみやすい広域スポットです。', reason_en: 'A flexible park area that combines nature and nearby museums.', category: 'PARK', lat: 35.7156, lng: 139.7745 },
      { name_ja: 'GINZA SIX', name_en: 'GINZA SIX', reason_ja: '銀座で買い物と食事をまとめやすい大型商業施設です。', reason_en: 'A practical Ginza destination for shopping and dining.', category: 'SHOPPING', lat: 35.6698, lng: 139.7635 },
      { name_ja: 'teamLab Planets TOKYO DMM', name_en: 'teamLab Planets TOKYO DMM', reason_ja: '体験型スポットとして印象に残りやすく、旅行導線にも入れやすいです。', reason_en: 'A memorable immersive stop that fits well into a Tokyo visit.', category: 'MUSEUM', lat: 35.6490, lng: 139.7898 },
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
      { name_ja: '金閣寺', name_en: 'Kinkaku-ji', reason_ja: '京都らしい景観を感じやすく、初回訪問でも選びやすい名所です。', reason_en: 'A classic Kyoto sight with strong visual appeal for first-time visitors.', category: 'LANDMARK', lat: 35.0394, lng: 135.7292 },
      { name_ja: '祇園', name_en: 'Gion', reason_ja: '京都らしい街並みを歩きやすく、食事や散策にもつなげやすいです。', reason_en: 'A reliable Kyoto district for walking, dining, and traditional atmosphere.', category: 'DISTRICT', lat: 35.0036, lng: 135.7784 },
      { name_ja: '京都駅', name_en: 'Kyoto Station', reason_ja: '移動拠点としてだけでなく、建築や買い物面でも使いやすいです。', reason_en: 'A practical transit hub with architecture and shopping value.', category: 'TRANSIT', lat: 34.9858, lng: 135.7588 },
      { name_ja: '平安神宮', name_en: 'Heian Shrine', reason_ja: '岡崎エリア散策に組み込みやすく、文化寄りのルートに向いています。', reason_en: 'A strong cultural stop that fits an Okazaki walking route.', category: 'LANDMARK', lat: 35.0159, lng: 135.7823 },
      { name_ja: '哲学の道', name_en: "Philosopher's Path", reason_ja: '静かな散策導線を作りやすく、季節感も出しやすいです。', reason_en: 'A calm Kyoto walking route with clear seasonal appeal.', category: 'PARK', lat: 35.0269, lng: 135.7983 },
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
      { name_ja: '北村韓屋村', name_en: 'Bukchon Hanok Village', reason_ja: '韓国らしい街並みを歩ける定番エリアで、景福宮ともつなげやすいです。', reason_en: 'A classic walking district that pairs naturally with Gyeongbokgung.', category: 'DISTRICT', lat: 37.5826, lng: 126.9830 },
      { name_ja: '昌徳宮', name_en: 'Changdeokgung Palace', reason_ja: '歴史体験を追加しやすく、ソウル中心部の観光ルートに組み込みやすいです。', reason_en: 'A practical palace stop for a history-focused central Seoul route.', category: 'LANDMARK', lat: 37.5794, lng: 126.9910 },
      { name_ja: 'COEX', name_en: 'COEX', reason_ja: '江南エリアで買い物や屋内回遊をしやすい大型施設です。', reason_en: 'A useful Gangnam destination for shopping and indoor browsing.', category: 'SHOPPING', lat: 37.5126, lng: 127.0582 },
      { name_ja: 'ロッテワールドタワー', name_en: 'Lotte World Tower', reason_ja: '景色と大型商業施設を一緒に楽しみやすいです。', reason_en: 'A flexible skyline and shopping destination in Seoul.', category: 'LANDMARK', lat: 37.5131, lng: 127.1025 },
      { name_ja: 'ソウルの森', name_en: 'Seoul Forest', reason_ja: '散策や休憩を入れたいときに使いやすい都市公園です。', reason_en: 'A practical city park for walking, relaxing, and nearby cafés.', category: 'PARK', lat: 37.5444, lng: 127.0374 },
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

const buildCacheKey = async (mode: Mode, scopeKey: string, category: string) => {
  const source = `${CACHE_VERSION}|${mode}|${normalize(scopeKey)}|${normalize(category || 'general')}`;
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
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


const googleSuggestUrl = (query: string, region: RegionConfig) => {
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', region.countryCode === 'jp' ? 'ja' : region.countryCode === 'kr' ? 'ko' : 'en');
  url.searchParams.set('gl', region.countryCode.toUpperCase());
  return url.toString();
};

const fetchAutocompleteSuggestions = async (query: string, region: RegionConfig): Promise<string[]> => {
  const res = await timeoutFetch(() => fetch(googleSuggestUrl(query, region), {
    headers: {
      'User-Agent': 'Milz/1.0 (+https://github.com/masashi-merci/milz2026map_new)',
      'Accept': 'application/json, text/javascript, */*;q=0.5',
    },
  }), 7000);
  if (!res.ok) return [];
  const payload = await res.json().catch(() => null) as unknown;
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[1])) return [];
  return (payload[1] as unknown[])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
};

const buildTrendSearchQueries = (location: string, category: string) => {
  const base = location.trim();
  const c = categoryLabel(category);
  const categoryMap: Record<string, string[]> = {
    cafe: ['cafe', 'coffee', 'カフェ'],
    restaurant: ['lunch', 'dinner', 'グルメ'],
    shopping: ['shopping', '買い物', 'shop'],
    park: ['park', 'nature', '公園'],
    transit: ['station', 'access', '駅'],
    all: ['things to do', 'food', 'shopping'],
  };
  const extras = categoryMap[c] || categoryMap.all;
  return [base, ...extras.map((extra) => `${base} ${extra}`)];
};


const trendReasonFromKeyword = (title: string, location: string) => {
  const value = normalize(title);
  if (/桜|sakura|cherry blossom|紅葉|autumn leaves|christmas|イルミ|illumination|hanami/.test(value)) {
    return {
      ja: `${location} 周辺で季節イベントや見頃と結びついて検索されやすい話題です。時期性が強く、外出計画や撮影目的で一緒に調べられています。`,
      en: `This topic is likely being searched together with ${location} because of seasonal events or peak viewing periods.`
    };
  }
  if (/ランチ|cafe|カフェ|coffee|restaurant|グルメ|food|ramen|居酒屋/.test(value)) {
    return {
      ja: `${location} で食事先やカフェを探す文脈で検索が伸びている可能性が高い話題です。来訪前の比較検討や当日検索に近い温度感があります。`,
      en: `This appears to be rising because people searching around ${location} are actively comparing food and café options.`
    };
  }
  if (/hotel|宿|旅館|stay|airbnb|観光|itinerary|model course|アクセス|how to get|station|駅/.test(value)) {
    return {
      ja: `${location} への来訪計画や移動導線の確認と一緒に検索されやすい話題です。観光前後の実用検索に近いテーマです。`,
      en: `This likely trends with ${location} because people are planning visits, routes, or logistics around the area.`
    };
  }
  if (/open|opening|new|新店|popup|limited|限定|event|festival|live|展覧会|展示|コラボ/.test(value)) {
    return {
      ja: `${location} 周辺の新規オープン、期間限定企画、イベント文脈で検索されやすい話題です。今だけ性があるため短期的に注目されやすいです。`,
      en: `This likely picks up around ${location} because of openings, limited events, or time-sensitive activations.`
    };
  }
  return {
    ja: `${location} を調べる人が一緒に検索している関連ワードです。現地での行き先選び、比較検討、直前行動のどれかに近い実用検索として見られます。`,
    en: `This appears as a related search around ${location}, likely tied to planning, comparison, or near-term intent.`
  };
};

const parseModelJson = (raw: string) => {
  const text = raw.trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try { return JSON.parse(slice); } catch {}
  }
  throw new Error('Model returned non-JSON output');
};

const scoreSuggestion = (suggestion: string, location: string) => {
  const normalizedSuggestion = normalize(suggestion);
  const normalizedLocation = normalize(location);
  let score = 0;
  if (normalizedSuggestion.includes(normalizedLocation)) score += 6;
  const locationParts = normalizedLocation.split(' ').filter((part) => part.length >= 2);
  for (const part of locationParts) {
    if (normalizedSuggestion.includes(part)) score += 2;
  }
  if (/2026|2025|near me|近く|人気|おすすめ|ランチ|カフェ|restaurant|shopping|park|station/.test(normalizedSuggestion)) score += 1;
  return score;
};

const buildLocationAwareTrendItems = async (region: RegionConfig, location: string, category: string): Promise<TrendItem[]> => {
  const queries = buildTrendSearchQueries(location, category);
  const bag: string[] = [];
  for (const query of queries) {
    const suggestions = await fetchAutocompleteSuggestions(query, region);
    bag.push(...suggestions);
    if (bag.length >= 40) break;
  }

  const seen = new Set<string>();
  const deduped = bag
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = normalize(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const ranked = deduped
    .map((title) => ({ title, score: scoreSuggestion(title, location) }))
    .sort((a, b) => b.score - a.score || a.title.length - b.title.length)
    .slice(0, 10)
    .map((item, index) => ({
      topic_ja: item.title,
      topic_en: item.title,
      keyword_ja: item.title,
      keyword_en: item.title,
      description_ja: trendReasonFromKeyword(item.title, location).ja,
      description_en: trendReasonFromKeyword(item.title, location).en,
      category: categoryLabel(category).toUpperCase() === 'ALL' ? 'TREND' : categoryLabel(category).toUpperCase(),
      popularity: Math.max(58, 96 - index * 4),
      source_url: `https://www.google.com/search?q=${encodeURIComponent(item.title)}`,
    }));

  return ranked;
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
  return feed.slice(0, 10).map((item, index) => ({
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

const buildRecommendationFallback = (region: RegionConfig) => region.fallbackRecommendations.slice(0, 10);

const sanitizeRecommendationCategory = (value: string) => {
  const upper = String(value || 'PLACE').trim().toUpperCase();
  return upper || 'PLACE';
};

const generateRecommendations = async (ai: GoogleGenAI, location: string, category: string, region: RegionConfig): Promise<RecommendationItem[]> => {
  const prompt = [
    'You are a bilingual local discovery planner.',
    `Location: ${location}.`,
    `Category preference: ${category || 'general'}.`,
    'Return 10 existing places that a traveler or local can actually visit now.',
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
  const parsed = parseModelJson(text) as { recommendations?: Array<Record<string, unknown>> };
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
    if (validated.length >= 10) break;
  }

  if (validated.length >= 10) return validated;
  for (const item of buildRecommendationFallback(region)) {
    if (seen.has(normalize(item.name_en))) continue;
    validated.push(item);
    seen.add(normalize(item.name_en));
    if (validated.length >= 10) break;
  }
  return validated.slice(0, 10);
};

const summarizeTrends = async (_ai: GoogleGenAI, region: RegionConfig, location: string, category: string, feed: TrendFeedItem[]): Promise<TrendItem[]> => {
  const categoryName = categoryLabel(category).toUpperCase();
  const scope = location || region.label;
  const results: TrendItem[] = [];

  for (let index = 0; index < feed.length && results.length < 10; index += 1) {
    const item = feed[index];
    const title = item.title.trim();
    if (!title) continue;
    results.push({
      topic_ja: title,
      topic_en: title,
      keyword_ja: title,
      keyword_en: title,
      description_ja: trendReasonFromKeyword(title, scope).ja,
      description_en: trendReasonFromKeyword(title, scope).en,
      category: categoryName === 'ALL' ? 'TREND' : categoryName,
      popularity: Math.max(55, 97 - index * 5),
      source_url: item.sourceUrl,
    });
  }

  if (results.length >= 10) return results.slice(0, 10);
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

    const regionKey = String(body?.region || '').trim().toLowerCase();
    const region = REGIONS.find((item) => item.key === regionKey) || pickRegion(location);
    const locationScope = normalize(location);
    const cacheScope = mode === 'recommend'
      ? `${region.key}|${locationScope}|${categoryLabel(category)}`
      : `${region.key}|${locationScope}|${categoryLabel(category)}|trends`;
    const cacheKey = await buildCacheKey(mode, cacheScope, categoryLabel(category));
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

    const locationAwareTrends = await buildLocationAwareTrendItems(region, location, category);
    let resolvedTrends: TrendItem[];
    if (locationAwareTrends.length >= 10) {
      resolvedTrends = locationAwareTrends.slice(0, 10);
    } else {
      const feed = await fetchTrendFeed(region).catch(() => [] as TrendFeedItem[]);
      resolvedTrends = feed.length ? await summarizeTrends(ai, region, location, category, feed) : buildTrendFallback(region, []);
    }
    return await toCacheResponse(cache, cacheUrl, {
      trends: resolvedTrends,
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

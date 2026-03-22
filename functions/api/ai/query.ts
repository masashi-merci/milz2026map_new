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
  source?: 'catalog' | 'admin';
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
  defaults: RecommendationItem[];
};

type AreaProfile = {
  key: string;
  region: RegionKey;
  labelJa: string;
  labelEn: string;
  aliases: string[];
  center: [number, number];
  recommendations: RecommendationItem[];
  trendSeeds: string[];
};

type AdminPlace = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  lat: number;
  lng: number;
};

const CACHE_VERSION = 'v10';
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
const safeText = (value: string, fallback = '') => String(value || '').trim() || fallback;

const REGIONS: Record<RegionKey, RegionConfig> = {
  ny: {
    key: 'ny',
    label: 'New York',
    countryCode: 'us',
    aliases: ['new york', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'ニューヨーク', 'マンハッタン'],
    center: [40.7831, -73.9712],
    defaults: [
      { name_ja: 'セントラルパーク', name_en: 'Central Park', reason_ja: 'マンハッタン観光の軸にしやすく、散策と景色をまとめやすい定番スポットです。', reason_en: 'A classic Manhattan anchor for walking, scenery, and flexible routing.', category: 'PARK', lat: 40.7812, lng: -73.9665 },
      { name_ja: 'グランドセントラル駅', name_en: 'Grand Central Terminal', reason_ja: '建築と移動の両方で使いやすく、周辺ルートに組み込みやすいです。', reason_en: 'A practical stop that works for architecture and routing.', category: 'TRANSIT', lat: 40.7527, lng: -73.9772 },
      { name_ja: 'ロックフェラー・センター', name_en: 'Rockefeller Center', reason_ja: '展望・買い物・季節イベントをまとめやすいミッドタウンの定番です。', reason_en: 'A reliable Midtown destination for views, shopping, and seasonal events.', category: 'LANDMARK', lat: 40.7587, lng: -73.9787 },
      { name_ja: 'ハイライン', name_en: 'The High Line', reason_ja: 'チェルシー周辺の散策に組み込みやすく、景色目的でも使いやすいです。', reason_en: 'A strong Chelsea walking route for views and short stops.', category: 'PARK', lat: 40.748, lng: -74.0048 },
      { name_ja: 'チェルシーマーケット', name_en: 'Chelsea Market', reason_ja: '食事と買い物を一度にまとめやすい人気スポットです。', reason_en: 'A practical stop that combines food and browsing.', category: 'RESTAURANT', lat: 40.7424, lng: -74.006 },
      { name_ja: 'ソーホー', name_en: 'SoHo', reason_ja: '買い物と街歩きをまとめやすい定番エリアです。', reason_en: 'A flexible district for shopping and city walking.', category: 'SHOPPING', lat: 40.7233, lng: -74.002 },
      { name_ja: 'メトロポリタン美術館', name_en: 'The Metropolitan Museum of Art', reason_ja: '文化体験を入れたいときに使いやすく、セントラルパークともつなげやすいです。', reason_en: 'A strong cultural stop that pairs naturally with Central Park.', category: 'MUSEUM', lat: 40.7794, lng: -73.9632 },
      { name_ja: 'ブライアントパーク', name_en: 'Bryant Park', reason_ja: '休憩や街歩きに組み込みやすい、ミッドタウンの使い勝手の良い公園です。', reason_en: 'A convenient Midtown park for a short break and surrounding routes.', category: 'PARK', lat: 40.7536, lng: -73.9832 },
      { name_ja: 'タイムズスクエア', name_en: 'Times Square', reason_ja: 'ブロードウェイ周辺を回る際に分かりやすい定番ランドマークです。', reason_en: 'A classic landmark for Broadway and Midtown routes.', category: 'LANDMARK', lat: 40.758, lng: -73.9855 },
      { name_ja: 'モマ', name_en: 'Museum of Modern Art', reason_ja: '短時間でも見どころを作りやすい代表的な美術館です。', reason_en: 'A practical museum stop with strong highlights even on a compact route.', category: 'MUSEUM', lat: 40.7614, lng: -73.9776 },
    ],
  },
  tokyo: {
    key: 'tokyo',
    label: 'Tokyo',
    countryCode: 'jp',
    aliases: ['tokyo', '東京', '渋谷', '杉並', '下北沢', '世田谷'],
    center: [35.6762, 139.6503],
    defaults: [
      { name_ja: '明治神宮', name_en: 'Meiji Jingu', reason_ja: '東京の定番文化スポットで、原宿や表参道と合わせやすいです。', reason_en: 'A reliable cultural stop that pairs naturally with Harajuku and Omotesando.', category: 'LANDMARK', lat: 35.6764, lng: 139.6993 },
      { name_ja: '渋谷スクランブルスクエア', name_en: 'Shibuya Scramble Square', reason_ja: '買い物・食事・展望をまとめやすい渋谷の代表スポットです。', reason_en: 'A strong Shibuya anchor for shopping, dining, and views.', category: 'SHOPPING', lat: 35.658, lng: 139.7016 },
      { name_ja: '浅草寺', name_en: 'Senso-ji', reason_ja: '東京らしさを感じやすく、周辺散策とも相性が良いです。', reason_en: 'A classic Tokyo landmark that works well with nearby walking routes.', category: 'LANDMARK', lat: 35.7148, lng: 139.7967 },
      { name_ja: '東京駅', name_en: 'Tokyo Station', reason_ja: '建築と移動の両面で使いやすく、周辺散策にもつなげやすいです。', reason_en: 'A practical transit and architecture stop that fits many Tokyo routes.', category: 'TRANSIT', lat: 35.6812, lng: 139.7671 },
      { name_ja: '中目黒', name_en: 'Nakameguro', reason_ja: 'カフェや散策目的で使いやすく、雰囲気の良さも分かりやすいエリアです。', reason_en: 'An easy district for café stops and relaxed city walking.', category: 'CAFE', lat: 35.6442, lng: 139.6987 },
      { name_ja: '東京タワー', name_en: 'Tokyo Tower', reason_ja: '景色目的で選びやすい定番ランドマークです。', reason_en: 'A classic skyline landmark that is easy to add to a Tokyo route.', category: 'LANDMARK', lat: 35.6586, lng: 139.7454 },
      { name_ja: '上野公園', name_en: 'Ueno Park', reason_ja: '自然と文化施設を一緒に楽しみやすい広域スポットです。', reason_en: 'A flexible park area that combines nature and nearby museums.', category: 'PARK', lat: 35.7156, lng: 139.7745 },
      { name_ja: 'GINZA SIX', name_en: 'GINZA SIX', reason_ja: '銀座で買い物と食事をまとめやすい大型商業施設です。', reason_en: 'A practical Ginza destination for shopping and dining.', category: 'SHOPPING', lat: 35.6698, lng: 139.7635 },
      { name_ja: '代々木公園', name_en: 'Yoyogi Park', reason_ja: '渋谷・原宿エリアの散歩や休憩を入れやすい大きな公園です。', reason_en: 'A practical park for adding walking and downtime to a central Tokyo route.', category: 'PARK', lat: 35.6728, lng: 139.6949 },
      { name_ja: '東京ミッドタウン', name_en: 'Tokyo Midtown', reason_ja: '六本木で食事や買い物をまとめやすい大型施設です。', reason_en: 'A flexible Roppongi stop for dining and shopping.', category: 'SHOPPING', lat: 35.6654, lng: 139.731 },
    ],
  },
  kyoto: {
    key: 'kyoto',
    label: 'Kyoto',
    countryCode: 'jp',
    aliases: ['kyoto', '京都', '東山', '祇園', '清水寺'],
    center: [35.0116, 135.7681],
    defaults: [
      { name_ja: '清水寺', name_en: 'Kiyomizu-dera', reason_ja: '京都らしい景観を感じやすく、東山散策の軸にしやすいです。', reason_en: 'A classic Kyoto anchor that works well for eastern Kyoto walking.', category: 'LANDMARK', lat: 34.9948, lng: 135.785 },
      { name_ja: '八坂神社', name_en: 'Yasaka Shrine', reason_ja: '祇園エリアの散策と合わせやすい定番スポットです。', reason_en: 'A practical stop that pairs naturally with Gion walking.', category: 'LANDMARK', lat: 35.0037, lng: 135.7788 },
      { name_ja: '祇園', name_en: 'Gion', reason_ja: '京都らしい街並みを歩きやすく、食事や散策にもつなげやすいです。', reason_en: 'A reliable Kyoto district for walking, dining, and traditional atmosphere.', category: 'DISTRICT', lat: 35.0036, lng: 135.7784 },
      { name_ja: '錦市場', name_en: 'Nishiki Market', reason_ja: '食べ歩きと中心部散策をまとめやすい定番スポットです。', reason_en: 'A practical central Kyoto stop for food and browsing.', category: 'RESTAURANT', lat: 35.005, lng: 135.7641 },
      { name_ja: '平安神宮', name_en: 'Heian Shrine', reason_ja: '岡崎エリア散策に組み込みやすく、文化寄りのルートに向いています。', reason_en: 'A strong cultural stop that fits an Okazaki walking route.', category: 'LANDMARK', lat: 35.0159, lng: 135.7823 },
      { name_ja: '哲学の道', name_en: "Philosopher's Path", reason_ja: '静かな散策導線を作りやすく、季節感も出しやすいです。', reason_en: 'A calm Kyoto walking route with clear seasonal appeal.', category: 'PARK', lat: 35.0269, lng: 135.7983 },
      { name_ja: '建仁寺', name_en: 'Kennin-ji', reason_ja: '祇園周辺から回りやすい寺院で、落ち着いた時間を作りやすいです。', reason_en: 'A practical temple stop near Gion for a quieter route.', category: 'LANDMARK', lat: 35.0006, lng: 135.7772 },
      { name_ja: '高台寺', name_en: 'Kodaiji Temple', reason_ja: '清水寺周辺とつなげやすく、京都らしい景観を楽しみやすいです。', reason_en: 'A scenic stop that pairs naturally with the Kiyomizu route.', category: 'LANDMARK', lat: 35.0006, lng: 135.7811 },
      { name_ja: '京都駅', name_en: 'Kyoto Station', reason_ja: '移動拠点としてだけでなく、建築や買い物面でも使いやすいです。', reason_en: 'A practical transit hub with architecture and shopping value.', category: 'TRANSIT', lat: 34.9858, lng: 135.7588 },
      { name_ja: '南禅寺', name_en: 'Nanzen-ji', reason_ja: '岡崎から東山方面の散策に組み込みやすい寺院です。', reason_en: 'A strong temple stop for an eastern Kyoto walking route.', category: 'LANDMARK', lat: 35.0117, lng: 135.7945 },
    ],
  },
  korea: {
    key: 'korea',
    label: 'Seoul',
    countryCode: 'kr',
    aliases: ['seoul', 'ソウル', '韓国', '중구', 'jung-gu', '中区', '明洞'],
    center: [37.5665, 126.978],
    defaults: [
      { name_ja: '景福宮', name_en: 'Gyeongbokgung Palace', reason_ja: 'ソウル観光の定番で、韓国らしい体験として非常に分かりやすいです。', reason_en: 'A core Seoul landmark that works very well for first-time visitors.', category: 'LANDMARK', lat: 37.5796, lng: 126.977 },
      { name_ja: '明洞', name_en: 'Myeongdong', reason_ja: '買い物と食べ歩きを短時間でまとめやすい王道エリアです。', reason_en: 'A practical district for shopping and street-food in a compact route.', category: 'SHOPPING', lat: 37.5636, lng: 126.985 },
      { name_ja: '広蔵市場', name_en: 'Gwangjang Market', reason_ja: '韓国らしいローカルフード体験として分かりやすいです。', reason_en: 'A clear local-food stop that works well in Seoul.', category: 'RESTAURANT', lat: 37.5704, lng: 126.9996 },
      { name_ja: 'Nソウルタワー', name_en: 'N Seoul Tower', reason_ja: '景色目的で選びやすい定番の眺望スポットです。', reason_en: 'A classic skyline stop that is easy to include in a Seoul route.', category: 'LANDMARK', lat: 37.5512, lng: 126.9882 },
      { name_ja: '北村韓屋村', name_en: 'Bukchon Hanok Village', reason_ja: '韓国らしい街並みを歩ける定番エリアです。', reason_en: 'A classic walking district that pairs naturally with central Seoul routes.', category: 'DISTRICT', lat: 37.5826, lng: 126.983 },
      { name_ja: '昌徳宮', name_en: 'Changdeokgung Palace', reason_ja: '歴史体験を追加しやすく、ソウル中心部の観光ルートに組み込みやすいです。', reason_en: 'A practical palace stop for a history-focused central Seoul route.', category: 'LANDMARK', lat: 37.5794, lng: 126.991 },
      { name_ja: 'ソウルの森', name_en: 'Seoul Forest', reason_ja: '散策や休憩を入れたいときに使いやすい都市公園です。', reason_en: 'A practical city park for walking, relaxing, and nearby cafés.', category: 'PARK', lat: 37.5444, lng: 127.0374 },
      { name_ja: 'COEX', name_en: 'COEX', reason_ja: '江南エリアで買い物や屋内回遊をしやすい大型施設です。', reason_en: 'A useful Gangnam destination for shopping and indoor browsing.', category: 'SHOPPING', lat: 37.5126, lng: 127.0582 },
      { name_ja: 'ロッテワールドタワー', name_en: 'Lotte World Tower', reason_ja: '景色と大型商業施設を一緒に楽しみやすいです。', reason_en: 'A flexible skyline and shopping destination in Seoul.', category: 'LANDMARK', lat: 37.5131, lng: 127.1025 },
      { name_ja: '弘大', name_en: 'Hongdae', reason_ja: 'カフェや若者向けショップが多く、街歩きしやすいです。', reason_en: 'A lively area for cafés, indie shops, and casual walking.', category: 'CAFE', lat: 37.5563, lng: 126.9236 },
    ],
  },
};

const AREA_PROFILES: AreaProfile[] = [
  {
    key: 'tokyo-shibuya', region: 'tokyo', labelJa: '東京都渋谷', labelEn: 'Shibuya, Tokyo', aliases: ['渋谷', 'shibuya'], center: [35.6595, 139.7005],
    recommendations: [
      { name_ja: '渋谷スクランブルスクエア', name_en: 'Shibuya Scramble Square', reason_ja: '渋谷駅直結で、買い物・食事・展望を一度にまとめやすい代表スポットです。', reason_en: 'A strong Shibuya anchor for shopping, dining, and views.', category: 'SHOPPING', lat: 35.658, lng: 139.7016 },
      { name_ja: '渋谷スカイ', name_en: 'Shibuya Sky', reason_ja: '渋谷らしい景色を短時間で確保しやすく、初回でも満足度を作りやすいです。', reason_en: 'An easy Shibuya skyline stop with strong first-visit value.', category: 'LANDMARK', lat: 35.658, lng: 139.7016 },
      { name_ja: 'MIYASHITA PARK', name_en: 'MIYASHITA PARK', reason_ja: '買い物・軽食・散歩をまとめやすく、渋谷らしい回遊を作りやすいです。', reason_en: 'A flexible Shibuya stop for shopping, snacks, and short walks.', category: 'SHOPPING', lat: 35.6605, lng: 139.7017 },
      { name_ja: '明治神宮', name_en: 'Meiji Jingu', reason_ja: '渋谷から原宿側へつなげやすく、自然と文化を入れやすい定番スポットです。', reason_en: 'A practical cultural stop within easy reach of Shibuya.', category: 'LANDMARK', lat: 35.6764, lng: 139.6993 },
      { name_ja: '代々木公園', name_en: 'Yoyogi Park', reason_ja: '渋谷近辺で散歩や休憩を入れたいときに使いやすい公園です。', reason_en: 'A practical park for adding downtime near Shibuya.', category: 'PARK', lat: 35.6728, lng: 139.6949 },
      { name_ja: '渋谷ヒカリエ', name_en: 'Shibuya Hikarie', reason_ja: '駅近で食事や買い物をまとめやすく、天候にも左右されにくいです。', reason_en: 'A reliable station-side stop for dining and shopping.', category: 'SHOPPING', lat: 35.659, lng: 139.7034 },
      { name_ja: '渋谷センター街', name_en: 'Shibuya Center-gai', reason_ja: '渋谷らしい賑わいを感じやすく、短時間でも街の雰囲気をつかみやすいです。', reason_en: 'An easy way to feel Shibuya’s core energy on foot.', category: 'DISTRICT', lat: 35.6599, lng: 139.6989 },
      { name_ja: 'Bunkamura', name_en: 'Bunkamura', reason_ja: '文化系の立ち寄り先を入れたいときに便利です。', reason_en: 'A useful cultural stop if you want something beyond retail.', category: 'CULTURE', lat: 35.6608, lng: 139.6952 },
      { name_ja: 'のんべい横丁', name_en: 'Nonbei Yokocho', reason_ja: '夜の雰囲気を見たいときに分かりやすい渋谷の小規模スポットです。', reason_en: 'A compact stop if you want a distinct evening feel in Shibuya.', category: 'DISTRICT', lat: 35.6594, lng: 139.7036 },
      { name_ja: '渋谷ストリーム', name_en: 'Shibuya Stream', reason_ja: '駅近で食事や川沿い散歩をまとめやすい施設です。', reason_en: 'A convenient station-side destination for dining and a short riverside walk.', category: 'SHOPPING', lat: 35.6571, lng: 139.7012 },
    ],
    trendSeeds: ['渋谷 ランチ', '渋谷 カフェ', '渋谷 イベント', '渋谷 観光', '渋谷 夜'],
  },
  {
    key: 'tokyo-suginami', region: 'tokyo', labelJa: '東京都杉並', labelEn: 'Suginami, Tokyo', aliases: ['杉並', 'suginami', '阿佐ヶ谷', '高円寺', '荻窪'], center: [35.6995, 139.636],
    recommendations: [
      { name_ja: '高円寺純情商店街', name_en: 'Koenji Junjo Shotengai', reason_ja: '杉並らしい街歩きと飲食店探しを両立しやすい商店街です。', reason_en: 'A practical shopping street for local walking and food discovery in Suginami.', category: 'DISTRICT', lat: 35.7056, lng: 139.6498 },
      { name_ja: '阿佐ヶ谷パールセンター', name_en: 'Asagaya Pearl Center', reason_ja: '雨でも歩きやすく、買い物や軽食をまとめやすい商店街です。', reason_en: 'A covered shopping street that works well for browsing and quick food stops.', category: 'SHOPPING', lat: 35.7044, lng: 139.6352 },
      { name_ja: '荻窪タウンセブン', name_en: 'Ogikubo Town Seven', reason_ja: '駅近で食事や買い物をまとめやすく、移動の途中にも入れやすいです。', reason_en: 'A practical station-side stop for dining and shopping.', category: 'SHOPPING', lat: 35.7047, lng: 139.6202 },
      { name_ja: '善福寺公園', name_en: 'Zenpukuji Park', reason_ja: '杉並で散歩や自然を入れたいときに使いやすい公園です。', reason_en: 'A practical park for adding greenery and a slower pace in Suginami.', category: 'PARK', lat: 35.7169, lng: 139.5966 },
      { name_ja: '大宮八幡宮', name_en: 'Omiya Hachimangu Shrine', reason_ja: '杉並らしい落ち着いた立ち寄り先として使いやすい神社です。', reason_en: 'A calm local shrine stop that fits a quieter Suginami route.', category: 'LANDMARK', lat: 35.6849, lng: 139.6408 },
      { name_ja: '高円寺氷川神社', name_en: 'Koenji Hikawa Shrine', reason_ja: '高円寺周辺の散歩に組み込みやすい小規模な神社です。', reason_en: 'A compact local shrine that fits naturally into Koenji walking.', category: 'LANDMARK', lat: 35.7038, lng: 139.6492 },
      { name_ja: '阿佐ヶ谷神明宮', name_en: 'Asagaya Shinmeigu', reason_ja: '阿佐ヶ谷周辺で静かな立ち寄り先を入れたいときに向いています。', reason_en: 'A useful stop for a quieter moment in the Asagaya area.', category: 'LANDMARK', lat: 35.7047, lng: 139.6341 },
      { name_ja: '荻外荘公園', name_en: 'Tekigaiso Park', reason_ja: '荻窪エリアで落ち着いた散歩を入れたいときに使いやすいです。', reason_en: 'A quiet green stop that works well around Ogikubo.', category: 'PARK', lat: 35.6991, lng: 139.6096 },
      { name_ja: '高円寺駅周辺', name_en: 'Koenji Station Area', reason_ja: '古着・カフェ・雑貨を探しながら歩きやすい杉並の代表エリアです。', reason_en: 'A representative Suginami area for vintage shops, cafés, and local browsing.', category: 'DISTRICT', lat: 35.7056, lng: 139.6498 },
      { name_ja: '阿佐ヶ谷駅周辺', name_en: 'Asagaya Station Area', reason_ja: '食事と商店街散歩を合わせやすく、地元感が出やすいです。', reason_en: 'An easy local area for dining and shopping-street walking.', category: 'DISTRICT', lat: 35.7044, lng: 139.6352 },
    ],
    trendSeeds: ['杉並 ランチ', '杉並 カフェ', '高円寺 古着', '阿佐ヶ谷 商店街', '荻窪 ラーメン'],
  },
  {
    key: 'tokyo-shimokitazawa', region: 'tokyo', labelJa: '東京都下北沢', labelEn: 'Shimokitazawa, Tokyo', aliases: ['下北沢', 'shimokitazawa'], center: [35.6618, 139.6688],
    recommendations: [
      { name_ja: '下北沢駅周辺', name_en: 'Shimokitazawa Station Area', reason_ja: '古着・カフェ・雑貨をまとめて回りやすい下北沢の中心です。', reason_en: 'The core Shimokitazawa area for vintage, cafés, and small-shop browsing.', category: 'DISTRICT', lat: 35.6619, lng: 139.6688 },
      { name_ja: 'BONUS TRACK', name_en: 'BONUS TRACK', reason_ja: '下北沢らしい小規模店の回遊を作りやすい複合スポットです。', reason_en: 'A useful stop for discovering small local shops in Shimokitazawa.', category: 'SHOPPING', lat: 35.6647, lng: 139.6698 },
      { name_ja: '本多劇場', name_en: 'Honda Theater', reason_ja: '演劇文化のある下北沢らしさを感じやすい代表施設です。', reason_en: 'A clear cultural anchor that reflects Shimokitazawa’s theater identity.', category: 'CULTURE', lat: 35.6621, lng: 139.6681 },
      { name_ja: 'reload', name_en: 'reload', reason_ja: '飲食やセレクトショップを落ち着いて回りやすい施設です。', reason_en: 'A calm mixed-use stop for food and design-oriented shops.', category: 'SHOPPING', lat: 35.6624, lng: 139.6728 },
      { name_ja: '下北線路街 空き地', name_en: 'Shimokita Senrogai Open Space', reason_ja: 'イベントや期間出店が入りやすく、街の動きを感じやすいです。', reason_en: 'A useful spot for seeing event-driven activity in Shimokitazawa.', category: 'EVENT', lat: 35.6632, lng: 139.6692 },
      { name_ja: '世田谷代田駅周辺', name_en: 'Setagaya-Daita Area', reason_ja: '下北沢から歩いてつなげやすく、少し落ち着いた雰囲気を作れます。', reason_en: 'A quieter extension that pairs easily with Shimokitazawa on foot.', category: 'DISTRICT', lat: 35.6596, lng: 139.668 },
      { name_ja: 'カフェビオトープ', name_en: 'Cafe Biotope', reason_ja: '下北沢らしいカフェ需要に寄せやすい立ち寄り候補です。', reason_en: 'A practical café-type stop that fits Shimokitazawa’s local rhythm.', category: 'CAFE', lat: 35.6612, lng: 139.6695 },
      { name_ja: '下北沢南口商店街', name_en: 'Shimokitazawa South Exit Shopping Street', reason_ja: '短時間でも街の雰囲気をつかみやすい導線です。', reason_en: 'A compact way to feel the local character quickly on foot.', category: 'SHOPPING', lat: 35.6614, lng: 139.6678 },
      { name_ja: '世田谷代田 由縁別邸', name_en: 'Yuen Bettei Daita', reason_ja: '宿泊や温浴寄りの選択肢を入れたいときに向いています。', reason_en: 'A useful option if you want a stay or bath-oriented add-on near Shimokitazawa.', category: 'STAY', lat: 35.6595, lng: 139.6672 },
      { name_ja: '下北沢古着エリア', name_en: 'Shimokitazawa Vintage Area', reason_ja: '古着店を回りたいときに最も分かりやすいテーマです。', reason_en: 'The clearest local theme for a vintage-focused Shimokitazawa route.', category: 'SHOPPING', lat: 35.6617, lng: 139.6686 },
    ],
    trendSeeds: ['下北沢 古着', '下北沢 カフェ', '下北沢 ランチ', '下北沢 イベント', '下北沢 演劇'],
  },
  {
    key: 'kyoto-higashiyama', region: 'kyoto', labelJa: '京都府東山', labelEn: 'Higashiyama, Kyoto', aliases: ['東山', 'higashiyama', '祇園', '清水寺'], center: [35.0013, 135.7805],
    recommendations: [
      { name_ja: '清水寺', name_en: 'Kiyomizu-dera', reason_ja: '東山を代表する名所で、周辺散策の軸にしやすいです。', reason_en: 'The clearest Higashiyama anchor for a first walking route.', category: 'LANDMARK', lat: 34.9948, lng: 135.785 },
      { name_ja: '八坂神社', name_en: 'Yasaka Shrine', reason_ja: '祇園側から入りやすく、東山の起点として使いやすいです。', reason_en: 'A practical Higashiyama entry point from the Gion side.', category: 'LANDMARK', lat: 35.0037, lng: 135.7788 },
      { name_ja: '高台寺', name_en: 'Kodaiji Temple', reason_ja: '清水寺周辺とつなげやすく、景観も楽しみやすいです。', reason_en: 'A scenic temple stop that pairs naturally with the Kiyomizu route.', category: 'LANDMARK', lat: 35.0006, lng: 135.7811 },
      { name_ja: '建仁寺', name_en: 'Kennin-ji', reason_ja: '祇園周辺から回りやすく、静かな時間を作りやすいです。', reason_en: 'A calmer temple stop close to Gion walking routes.', category: 'LANDMARK', lat: 35.0006, lng: 135.7772 },
      { name_ja: '二寧坂', name_en: 'Ninenzaka', reason_ja: '東山らしい街並みを最も感じやすい散策導線です。', reason_en: 'A highly recognizable Higashiyama walking street.', category: 'DISTRICT', lat: 34.9988, lng: 135.7807 },
      { name_ja: '産寧坂', name_en: 'Sannenzaka', reason_ja: '土産物や街歩きをまとめやすく、東山らしさを感じやすいです。', reason_en: 'A practical street for gifts, walking, and classic Higashiyama atmosphere.', category: 'DISTRICT', lat: 34.9979, lng: 135.7817 },
      { name_ja: '円山公園', name_en: 'Maruyama Park', reason_ja: '八坂神社や祇園と合わせやすく、季節の景色も入れやすいです。', reason_en: 'A flexible park that pairs well with Yasaka Shrine and Gion.', category: 'PARK', lat: 35.0031, lng: 135.7791 },
      { name_ja: '知恩院', name_en: 'Chion-in', reason_ja: '東山の寺社回遊に組み込みやすい大型寺院です。', reason_en: 'A strong temple stop within Higashiyama’s shrine-and-temple circuit.', category: 'LANDMARK', lat: 35.0053, lng: 135.7803 },
      { name_ja: '青蓮院門跡', name_en: 'Shoren-in Temple', reason_ja: '混雑を少し避けながら東山らしい景観を楽しみやすいです。', reason_en: 'A quieter stop that still feels clearly Higashiyama.', category: 'LANDMARK', lat: 35.0065, lng: 135.7833 },
      { name_ja: '祇園白川', name_en: 'Gion Shirakawa', reason_ja: '東山周辺で写真や短時間散策を入れたいときに向いています。', reason_en: 'A strong short-walk stop for photos and atmosphere.', category: 'DISTRICT', lat: 35.0043, lng: 135.7752 },
    ],
    trendSeeds: ['東山 観光', '東山 ランチ', '清水寺 混雑', '祇園 カフェ', '東山 桜'],
  },
  {
    key: 'korea-junggu', region: 'korea', labelJa: 'ソウル特別市中区', labelEn: 'Jung-gu, Seoul', aliases: ['中区', 'jung-gu', 'myeongdong', '明洞'], center: [37.5636, 126.997],
    recommendations: [
      { name_ja: '明洞', name_en: 'Myeongdong', reason_ja: '買い物と食べ歩きを短時間でまとめやすい中区の中心エリアです。', reason_en: 'The clearest Jung-gu area for compact shopping and street-food browsing.', category: 'SHOPPING', lat: 37.5636, lng: 126.985 },
      { name_ja: '南大門市場', name_en: 'Namdaemun Market', reason_ja: 'ローカル感のある買い物や食事を入れやすい定番市場です。', reason_en: 'A practical market stop for local shopping and casual food.', category: 'MARKET', lat: 37.5591, lng: 126.977 },
      { name_ja: 'Nソウルタワー', name_en: 'N Seoul Tower', reason_ja: '景色目的で選びやすい定番の眺望スポットです。', reason_en: 'A classic skyline stop that is easy to include in a Jung-gu route.', category: 'LANDMARK', lat: 37.5512, lng: 126.9882 },
      { name_ja: '南山公園', name_en: 'Namsan Park', reason_ja: '中区で散歩や景色を入れたいときに使いやすいです。', reason_en: 'A practical park for adding views and walking in Jung-gu.', category: 'PARK', lat: 37.5508, lng: 126.9882 },
      { name_ja: 'ソウル市庁周辺', name_en: 'Seoul City Hall Area', reason_ja: '中心部の回遊と建築スポットをまとめやすいです。', reason_en: 'A useful central area for architecture and city-center walking.', category: 'DISTRICT', lat: 37.5663, lng: 126.9779 },
      { name_ja: '徳寿宮', name_en: 'Deoksugung Palace', reason_ja: '市庁エリアと合わせやすく、歴史体験を足しやすいです。', reason_en: 'A practical historic stop paired with the City Hall area.', category: 'LANDMARK', lat: 37.5659, lng: 126.9752 },
      { name_ja: 'ロッテ百貨店 本店', name_en: 'Lotte Department Store Main Branch', reason_ja: '明洞周辺で屋内買い物を入れたいときに使いやすいです。', reason_en: 'A convenient indoor shopping stop near Myeongdong.', category: 'SHOPPING', lat: 37.5648, lng: 126.9817 },
      { name_ja: '明洞聖堂', name_en: 'Myeongdong Cathedral', reason_ja: '中区の街歩きに組み込みやすい定番ランドマークです。', reason_en: 'A practical landmark to include in a Myeongdong/Jung-gu walk.', category: 'LANDMARK', lat: 37.5631, lng: 126.9871 },
      { name_ja: '清渓川', name_en: 'Cheonggyecheon', reason_ja: '散歩や夜景を入れたいときに使いやすい水辺スポットです。', reason_en: 'A useful waterside stop for walking and evening atmosphere.', category: 'PARK', lat: 37.5692, lng: 126.9784 },
      { name_ja: '広蔵市場', name_en: 'Gwangjang Market', reason_ja: '中区周辺からアクセスしやすく、ローカルフード体験に向いています。', reason_en: 'An easy local-food stop to add from central Seoul routes.', category: 'RESTAURANT', lat: 37.5704, lng: 126.9996 },
    ],
    trendSeeds: ['明洞 人気', '中区 ランチ', '南山タワー 予約', '明洞 カフェ', '南大門市場 グルメ'],
  },
];

const categoryLabel = (category: string) => {
  const c = normalize(category || 'all');
  if (contains(c, 'cafe', 'coffee', 'カフェ', '喫茶')) return 'cafe';
  if (contains(c, 'restaurant', 'food', 'レストラン', 'グルメ', 'ランチ', 'dinner')) return 'restaurant';
  if (contains(c, 'shopping', 'shop', 'ショッピング', '買い物', 'popup')) return 'shopping';
  if (contains(c, 'park', 'nature', '公園', '自然')) return 'park';
  if (contains(c, 'transit', 'station', 'rail', '交通', '駅', 'access')) return 'transit';
  return 'all';
};

const recommendationCategoryFits = (item: RecommendationItem, category: string) => {
  const c = categoryLabel(category);
  if (c === 'all') return true;
  const value = normalize(item.category);
  if (c === 'cafe') return contains(value, 'cafe');
  if (c === 'restaurant') return contains(value, 'restaurant', 'market');
  if (c === 'shopping') return contains(value, 'shopping', 'district', 'market');
  if (c === 'park') return contains(value, 'park');
  if (c === 'transit') return contains(value, 'transit');
  return true;
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

const pickRegion = (location: string, regionKey?: string): RegionConfig => {
  if (regionKey && regionKey in REGIONS) return REGIONS[regionKey as RegionKey];
  const normalized = normalize(location);
  return Object.values(REGIONS).find((region) => region.aliases.some((alias) => normalized.includes(normalize(alias)))) || REGIONS.ny;
};

const pickAreaProfile = (location: string, region: RegionConfig) => {
  const normalized = normalize(location);
  return AREA_PROFILES.find((area) => area.region === region.key && area.aliases.some((alias) => normalized.includes(normalize(alias))));
};

const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(aa));
};

const fetchAdminPlaces = async (env: Env): Promise<AdminPlace[]> => {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return [];
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/admin_places?select=id,name,description,category,lat,lng&order=created_at.desc&limit=300`;
  const res = await timeoutFetch(() => fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY!}`,
      Accept: 'application/json',
    },
  }), 7000).catch(() => null as Response | null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => []) as any[];
  return Array.isArray(data) ? data.filter((row) => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng))) : [];
};

const adminPlaceToRecommendation = (place: AdminPlace, areaLabel: string): RecommendationItem => ({
  name_ja: safeText(place.name),
  name_en: safeText(place.name),
  reason_ja: safeText(place.description || '', `${areaLabel} のエリア内で admin が登録した実在スポットです。位置の正確さを優先しておすすめに含めています。`),
  reason_en: safeText(place.description || '', `An admin-registered real place inside ${areaLabel}, prioritized for precise location relevance.`),
  category: safeText(place.category || 'PLACE').toUpperCase(),
  lat: Number(place.lat),
  lng: Number(place.lng),
  source: 'admin',
});

const dedupeRecommendations = (rows: RecommendationItem[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = normalize(`${row.name_en}|${row.lat}|${row.lng}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const generateRecommendations = async (location: string, category: string, region: RegionConfig, env: Env): Promise<RecommendationItem[]> => {
  const area = pickAreaProfile(location, region);
  const center = area?.center || region.center;
  const areaLabel = area?.labelJa || area?.labelEn || region.label;
  const adminPlaces = await fetchAdminPlaces(env);
  const nearbyAdmin = adminPlaces
    .map((place) => ({ place, distance: haversineKm(center[0], center[1], Number(place.lat), Number(place.lng)) }))
    .filter((row) => row.distance <= 6)
    .sort((a, b) => a.distance - b.distance)
    .map((row) => adminPlaceToRecommendation(row.place, areaLabel));

  const primary = area?.recommendations?.length ? area.recommendations : region.defaults;
  const filteredPrimary = primary.filter((item) => recommendationCategoryFits(item, category));
  const filteredRegionDefaults = region.defaults.filter((item) => recommendationCategoryFits(item, category));
  const merged = dedupeRecommendations([
    ...nearbyAdmin,
    ...filteredPrimary,
    ...primary,
    ...filteredRegionDefaults,
    ...region.defaults,
  ]);

  return merged.slice(0, 10);
};

const suggestionLocale = (region: RegionConfig) => {
  if (region.key === 'korea') return { hl: 'ko', gl: 'KR' };
  if (region.key === 'ny') return { hl: 'en', gl: 'US' };
  return { hl: 'ja', gl: 'JP' };
};

const googleSuggestUrl = (query: string, region: RegionConfig) => {
  const { hl, gl } = suggestionLocale(region);
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', hl);
  url.searchParams.set('gl', gl);
  return url.toString();
};

const weirdCharScore = (value: string) => {
  const stripped = value.replace(/[\p{Letter}\p{Number}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s\-・&()（）]/gu, '');
  return stripped.length;
};

const isDisplayableKeyword = (value: string) => {
  const text = safeText(value);
  if (!text) return false;
  if (text.includes('�') || text.includes('Ã') || text.includes('ã') || text.includes('â')) return false;
  if (/^[?！!ー\-\s]+$/.test(text)) return false;
  if (weirdCharScore(text) > Math.max(4, Math.floor(text.length * 0.35))) return false;
  if (/^[0-9\-\/\.]+$/.test(text)) return false;
  return true;
};

const fetchAutocompleteSuggestions = async (query: string, region: RegionConfig): Promise<string[]> => {
  const res = await timeoutFetch(() => fetch(googleSuggestUrl(query, region), {
    headers: {
      'User-Agent': 'Milz/1.0 (+https://github.com/masashi-merci/milz2026map_new)',
      'Accept': 'application/json, text/javascript, */*;q=0.5',
    },
  }), 7000).catch(() => null as Response | null);
  if (!res || !res.ok) return [];
  const payload = await res.json().catch(() => null) as unknown;
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[1])) return [];
  return (payload[1] as unknown[])
    .map((v) => safeText(String(v || '')))
    .filter(isDisplayableKeyword);
};

const buildTrendQueries = (location: string, category: string, area?: AreaProfile) => {
  const base = safeText(location);
  const cat = categoryLabel(category);
  const jpCommon = ['人気', '話題', '観光', 'ランチ', 'カフェ', 'イベント'];
  const enCommon = ['popular', 'things to do', 'food', 'cafe', 'event'];
  const koCommon = ['맛집', '카페', '핫플', '관광'];
  const categoryExtras: Record<string, string[]> = {
    cafe: ['カフェ', 'coffee', 'モーニング'],
    restaurant: ['ランチ', 'グルメ', 'dinner'],
    shopping: ['買い物', 'popup', '限定'],
    park: ['公園', '桜', '景色'],
    transit: ['アクセス', '駅', '行き方'],
    all: ['見どころ', '週末', '人気スポット'],
  };
  const extras = categoryExtras[cat] || categoryExtras.all;
  const seeds = area?.trendSeeds || [];
  return [...new Set([base, ...seeds, ...jpCommon.map((x) => `${base} ${x}`), ...enCommon.map((x) => `${base} ${x}`), ...koCommon.map((x) => `${base} ${x}`), ...extras.map((x) => `${base} ${x}`)])];
};

const classifyTrend = (keyword: string) => {
  const text = normalize(keyword);
  if (/桜|花見|紅葉|イルミ|ライトアップ|christmas|festival|祭|花火|紅葉/.test(text)) return 'seasonal';
  if (/ランチ|ディナー|グルメ|カフェ|coffee|맛집|카페|restaurant|ramen|dessert|brunch/.test(text)) return 'food';
  if (/アクセス|駅|駐車場|行き方|route|access|station|parking/.test(text)) return 'access';
  if (/新店|限定|popup|open|opening|コラボ|イベント|live|展示|展覧会|release/.test(text)) return 'event';
  if (/観光|見どころ|散歩|walk|景色|フォト|寺|神社|tower|park|museum/.test(text)) return 'sightseeing';
  if (/芸能|俳優|ドラマ|映画|idol|actor|singer|本田|綾野|静岡大学/.test(text)) return 'people';
  return 'general';
};

const trendExplanation = (keyword: string, locationLabel: string) => {
  switch (classifyTrend(keyword)) {
    case 'seasonal':
      return {
        ja: `${locationLabel} でこのワードが伸びているのは、季節の見頃やイベント時期が近く、「今見られるか」「どこが混むか」「写真を撮るならどこが良いか」を事前に確かめる検索が増えるためです。訪問直前の確認需要が強いタイプです。`,
        en: `This keyword is likely rising around ${locationLabel} because people are checking seasonal timing, crowd levels, and photo-worthy spots before they go.`,
      };
    case 'food':
      return {
        ja: `${locationLabel} でこのワードが検索される背景には、現地で入る店を当日や直前に比較したい需要があります。特に「近くで外さない店はどこか」「並ぶ前に候補を決めたい」という実用的な検索意図が強いです。`,
        en: `This is likely being searched because people heading to ${locationLabel} want to compare reliable nearby food or café options shortly before visiting.`,
      };
    case 'access':
      return {
        ja: `${locationLabel} では移動計画と一緒に検索されやすいワードです。最寄り駅、徒歩導線、駐車場、混雑回避などを確認しながら、現地での動き方を固めようとしている検索が集まっています。`,
        en: `This usually rises because visitors to ${locationLabel} are checking route details, walking access, parking, or transfer friction before moving.`,
      };
    case 'event':
      return {
        ja: `${locationLabel} でこのワードが伸びるのは、新店オープン、期間限定企画、イベント、展示、コラボなどで短期的に注目が高まりやすいからです。「今行く価値があるか」を確かめる検索として動いています。`,
        en: `This is probably rising because a new opening, limited event, collaboration, or exhibition has made it newly relevant around ${locationLabel}.`,
      };
    case 'sightseeing':
      return {
        ja: `${locationLabel} の見どころや回遊先を探す文脈で検索が増えています。初めて行く人が「どこから回るか」「近くで何を一緒に見るか」を決めるときに選ばれやすいワードです。`,
        en: `This appears to be rising because people planning a visit to ${locationLabel} are deciding what to see and how to sequence nearby stops.`,
      };
    case 'people':
      return {
        ja: `${locationLabel} 周辺でこのワードが伸びる背景として、メディア露出や SNS 話題化が影響している可能性があります。人物名や話題語をきっかけに、その周辺エリアや関連スポットまで検索が広がるパターンです。`,
        en: `This likely reflects media exposure or social buzz, which can spill over into searches for ${locationLabel} and related nearby places.`,
      };
    default:
      return {
        ja: `${locationLabel} では、このワードを起点に「今どこが注目されているか」「実際に行くなら何を押さえるべきか」を探す検索が集まっています。比較検討や直前確認の入口として伸びている可能性が高いです。`,
        en: `This looks like a comparison and pre-visit query that people use to understand what is currently getting attention around ${locationLabel}.`,
      };
  }
};

const stripLocationPrefix = (value: string, location: string) => {
  const variants = [location, location.replace(/日本|東京都|京都府|ソウル特別市|ニューヨーク州/gu, '').trim()]
    .map((part) => part.trim())
    .filter(Boolean);
  let output = value.trim();
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`^${escaped}[\s　:/-]*`, 'i'), '').trim();
  }
  return output || value.trim();
};

const dedupeKeywords = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalize(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const generateTrends = async (location: string, category: string, region: RegionConfig): Promise<TrendItem[]> => {
  const area = pickAreaProfile(location, region);
  const locationLabel = area?.labelJa || location;
  const queries = buildTrendQueries(locationLabel, category, area);
  const collected: string[] = [];
  for (const query of queries.slice(0, 10)) {
    const suggestions = await fetchAutocompleteSuggestions(query, region);
    collected.push(...suggestions);
    if (collected.length >= 40) break;
  }

  let keywords = dedupeKeywords(collected)
    .map((item) => stripLocationPrefix(item, locationLabel))
    .filter(isDisplayableKeyword)
    .filter((item) => item.length >= 2);

  if (keywords.length < 8 && area?.trendSeeds?.length) {
    keywords = dedupeKeywords([...keywords, ...area.trendSeeds.map((seed) => stripLocationPrefix(seed, locationLabel))]);
  }

  if (keywords.length < 8) {
    keywords = dedupeKeywords([
      ...keywords,
      `${locationLabel} 人気`, `${locationLabel} 観光`, `${locationLabel} ランチ`, `${locationLabel} カフェ`, `${locationLabel} イベント`, `${locationLabel} 見どころ`,
    ].map((item) => stripLocationPrefix(item, locationLabel)));
  }

  return keywords.slice(0, 10).map((keyword, index) => {
    const reason = trendExplanation(keyword, locationLabel);
    return {
      topic_ja: keyword,
      topic_en: keyword,
      keyword_ja: keyword,
      keyword_en: keyword,
      description_ja: reason.ja,
      description_en: reason.en,
      category: classifyTrend(keyword).toUpperCase(),
      popularity: Math.max(61, 96 - index * 4),
      source_url: `https://www.google.com/search?q=${encodeURIComponent(`${locationLabel} ${keyword}`.trim())}`,
    };
  });
};

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode: Mode = body?.mode === 'trend' ? 'trend' : 'recommend';
    const location = String(body?.location || '日本 東京都 渋谷').trim().slice(0, 180);
    const category = String(body?.category || 'general').trim().slice(0, 80);
    const bodyRefresh = Boolean(body?.refresh);
    const region = pickRegion(location, String(body?.region || '').trim().toLowerCase());

    const cacheScope = `${region.key}|${location}|${categoryLabel(category)}|${mode}`;
    const cacheKey = await buildCacheKey(mode, cacheScope, categoryLabel(category));
    const cacheUrl = `https://edge-cache.local/milz-ai-${cacheKey}`;
    const cache = caches.default;
    const cached = bodyRefresh ? null : await cache.match(cacheUrl);
    if (cached) {
      return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers.entries()), ...corsHeaders, 'X-AI-Cache': 'HIT' } });
    }

    if (mode === 'recommend') {
      const recommendations = await generateRecommendations(location, category, region, env);
      return await toCacheResponse(cache, cacheUrl, {
        recommendations,
        generatedAt: new Date().toISOString(),
        mode,
        location,
        category,
        region: region.key,
      }, RECOMMEND_TTL);
    }

    const trends = await generateTrends(location, category, region);
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

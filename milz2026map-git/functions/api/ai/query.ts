import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

export interface Env {
  GEMINI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type Mode = 'recommend' | 'trend';

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

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
};

const CACHE_VERSION = 'v2';

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
const contains = (source: string, ...needles: string[]) => needles.some((n) => source.includes(normalize(n)));

const buildCacheKey = async (mode: Mode, location: string, category: string) => {
  const source = `${CACHE_VERSION}|${mode}|${normalize(location)}|${normalize(category || 'general')}`;
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

const verifyAuth = async (request: Request, env: Env): Promise<AuthResult> => {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) return { ok: false, response: json({ error: 'Unauthorized' }, 401) };
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { ok: false, response: json({ error: 'Supabase auth is not configured' }, 500) };

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, response: json({ error: 'Unauthorized' }, 401) };

  return { ok: true, userId: data.user.id };
};

const categoryLabel = (category: string) => {
  const c = normalize(category || 'all');
  if (contains(c, 'cafe', 'coffee', 'カフェ', '喫茶')) return 'cafe';
  if (contains(c, 'restaurant', 'food', 'レストラン', 'グルメ', 'ランチ')) return 'restaurant';
  if (contains(c, 'shopping', 'shop', 'ショッピング', '買い物')) return 'shopping';
  if (contains(c, 'park', 'nature', '公園', '自然')) return 'park';
  if (contains(c, 'transit', 'station', 'rail', '交通', '駅')) return 'transit';
  return 'all';
};

const isNewYork = (location: string) => contains(normalize(location), 'new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'nyc');

const curatedNYRecommendations = (category: string): RecommendationItem[] => {
  const c = categoryLabel(category);
  const base: Record<string, RecommendationItem[]> = {
    cafe: [
      { name_ja: 'Blue Bottle Coffee Bryant Park', name_en: 'Blue Bottle Coffee Bryant Park', reason_ja: 'ブライアントパークや図書館に寄る動線と相性が良く、朝でも午後でも使いやすい定番のコーヒーストップです。', reason_en: 'A dependable coffee stop that fits naturally into Bryant Park and library routes, morning or afternoon.', category: 'CAFE', lat: 40.7531, lng: -73.9837 },
      { name_ja: 'La Cabra East Village', name_en: 'La Cabra East Village', reason_ja: 'ダウンタウン側でコーヒーとペストリーの評判が強く、街歩きの途中に入れやすい人気店です。', reason_en: 'A strong downtown pick for coffee and pastries, easy to fold into an East Village walk.', category: 'CAFE', lat: 40.7265, lng: -73.9847 },
      { name_ja: 'Maman Tribeca', name_en: 'Maman Tribeca', reason_ja: '店内の雰囲気が良く、朝食や軽いブランチ、カフェ利用までまとめやすいトライベッカの定番です。', reason_en: 'A reliable Tribeca staple for a slow coffee, light breakfast, or casual brunch stop.', category: 'CAFE', lat: 40.7192, lng: -74.0105 },
      { name_ja: 'Devoción Williamsburg', name_en: 'Devoción Williamsburg', reason_ja: 'ブルックリン側で特に人気の高いスペシャルティコーヒー店で、空間の広さも魅力です。', reason_en: 'One of Brooklyn’s standout specialty coffee stops, known for both beans and atmosphere.', category: 'CAFE', lat: 40.7183, lng: -73.9619 },
      { name_ja: 'Birch Coffee Flatiron', name_en: 'Birch Coffee Flatiron', reason_ja: 'フラットアイアンやユニオンスクエア周辺で一息つきたい時に使いやすい、安定感のある一軒です。', reason_en: 'A practical and easy coffee break around Flatiron and Union Square.', category: 'CAFE', lat: 40.7412, lng: -73.9894 },
    ],
    restaurant: [
      { name_ja: 'Katz’s Delicatessen', name_en: 'Katz’s Delicatessen', reason_ja: 'ロウアーイーストサイドを代表する老舗で、初回訪問でも分かりやすくニューヨークらしさを感じやすい一軒です。', reason_en: 'A classic Lower East Side deli that feels unmistakably New York and is easy to justify as a first visit.', category: 'RESTAURANT', lat: 40.7223, lng: -73.9874 },
      { name_ja: 'Chelsea Market', name_en: 'Chelsea Market', reason_ja: '複数の店を一度に見られるので、同行者がいても選びやすく、短時間でも満足度を出しやすいスポットです。', reason_en: 'An efficient food stop where groups can split choices quickly and still keep the route compact.', category: 'RESTAURANT', lat: 40.7424, lng: -74.006 },
      { name_ja: 'Los Tacos No. 1 Times Square', name_en: 'Los Tacos No. 1 Times Square', reason_ja: 'ミッドタウンの移動途中に入りやすく、回転も速いので観光の合間でも使いやすい人気店です。', reason_en: 'A high-traffic Midtown favorite that works well when you need something fast between stops.', category: 'RESTAURANT', lat: 40.758, lng: -73.9855 },
      { name_ja: 'Eataly Flatiron', name_en: 'Eataly Flatiron', reason_ja: '食事・スイーツ・買い物を一緒に済ませやすく、初めてでも使いやすい大型フードスポットです。', reason_en: 'A flexible food destination where eating, sweets, and shopping come together in one stop.', category: 'RESTAURANT', lat: 40.741, lng: -73.9897 },
      { name_ja: 'Russ & Daughters Cafe', name_en: 'Russ & Daughters Cafe', reason_ja: 'ニューヨークらしい朝食やブランチを狙う時に強く、歴史も含めて印象に残りやすい名店です。', reason_en: 'A strong choice for iconic New York brunch and appetizing traditions, with real local identity.', category: 'RESTAURANT', lat: 40.7197, lng: -73.9896 },
    ],
    shopping: [
      { name_ja: 'SoHo', name_en: 'SoHo', reason_ja: 'ブランド店、セレクトショップ、街歩きがまとまりやすく、買い物目的でも散策目的でも動きやすいエリアです。', reason_en: 'A walkable retail district that works for both shopping plans and general city wandering.', category: 'SHOPPING', lat: 40.7233, lng: -74.002 },
      { name_ja: 'Fifth Avenue', name_en: 'Fifth Avenue', reason_ja: '定番の旗艦店やランドマークがまとまり、初回の買い物導線として使いやすい王道エリアです。', reason_en: 'A classic flagship corridor that is easy to understand and reliable for a first retail route.', category: 'SHOPPING', lat: 40.7606, lng: -73.9754 },
      { name_ja: 'Hudson Yards', name_en: 'Hudson Yards', reason_ja: '館内型の動線で天候に左右されにくく、食事や展望スポットも組み込みやすい新しめの商業拠点です。', reason_en: 'A weather-friendly modern retail stop that pairs easily with dining and nearby attractions.', category: 'SHOPPING', lat: 40.7538, lng: -74.0027 },
      { name_ja: 'The Shops at Columbus Circle', name_en: 'The Shops at Columbus Circle', reason_ja: 'セントラルパーク西側の動きと合わせやすく、比較的コンパクトに見て回れる買い物スポットです。', reason_en: 'A compact retail stop that fits naturally with Central Park and Upper West Side movement.', category: 'SHOPPING', lat: 40.7685, lng: -73.9822 },
      { name_ja: 'Brookfield Place', name_en: 'Brookfield Place', reason_ja: 'ダウンタウンの水辺側で、ショッピングと食事をまとめたい時に使いやすい施設です。', reason_en: 'A useful downtown waterfront stop when you want shopping and dining in one place.', category: 'SHOPPING', lat: 40.7126, lng: -74.0158 },
    ],
    park: [
      { name_ja: 'Central Park', name_en: 'Central Park', reason_ja: '街中で最も分かりやすい自然スポットで、散歩、休憩、景色、周辺施設との組み合わせがしやすい大本命です。', reason_en: 'The city’s clearest all-purpose park choice for walks, breaks, views, and flexible routing.', category: 'PARK', lat: 40.7812, lng: -73.9665 },
      { name_ja: 'Bryant Park', name_en: 'Bryant Park', reason_ja: 'ミッドタウンで立ち寄りやすく、周辺のカフェや図書館と合わせて短時間でも満足度を作りやすい公園です。', reason_en: 'A very practical Midtown park that fits neatly with coffee stops and nearby cultural spots.', category: 'PARK', lat: 40.7536, lng: -73.9832 },
      { name_ja: 'Brooklyn Bridge Park', name_en: 'Brooklyn Bridge Park', reason_ja: '景色の強さがあり、ダンボ側と合わせた散歩導線を作りやすいブルックリンの人気スポットです。', reason_en: 'A strong Brooklyn pick for skyline views and a natural walk with DUMBO.', category: 'PARK', lat: 40.7003, lng: -73.9967 },
      { name_ja: 'The High Line', name_en: 'The High Line', reason_ja: 'チェルシーやハドソンヤーズと一緒に回りやすく、観光と散歩を両立しやすい高架公園です。', reason_en: 'An elevated park that makes it easy to combine walking with Chelsea and Hudson Yards visits.', category: 'PARK', lat: 40.748, lng: -74.0048 },
      { name_ja: 'Washington Square Park', name_en: 'Washington Square Park', reason_ja: 'ダウンタウンの街歩きと相性が良く、周囲のカフェや軽食と組み合わせやすい定番広場です。', reason_en: 'A downtown classic that works well with cafés, casual food, and nearby neighborhood walking.', category: 'PARK', lat: 40.7308, lng: -73.9973 },
    ],
    transit: [
      { name_ja: 'Grand Central Terminal', name_en: 'Grand Central Terminal', reason_ja: '単なる交通結節点ではなく、建築自体も見どころで、周辺へ移動を広げやすい基点になります。', reason_en: 'More than a transit hub, it is a destination with architecture and strong route connectivity.', category: 'TRANSIT', lat: 40.7527, lng: -73.9772 },
      { name_ja: 'Penn Station / Moynihan Train Hall', name_en: 'Penn Station / Moynihan Train Hall', reason_ja: '広域移動にも市内移動にも使いやすく、ハドソンヤーズやチェルシー方面ともつなぎやすい主要拠点です。', reason_en: 'A practical major hub for both city movement and longer-range rail routes.', category: 'TRANSIT', lat: 40.7506, lng: -73.9935 },
      { name_ja: 'World Trade Center Oculus', name_en: 'World Trade Center Oculus', reason_ja: '交通と建築鑑賞が同時に成立し、ロウアーマンハッタン側の散策の起点にもなりやすいです。', reason_en: 'A combined transit and architecture stop that also anchors Lower Manhattan exploration.', category: 'TRANSIT', lat: 40.7116, lng: -74.0111 },
      { name_ja: 'Fulton Center', name_en: 'Fulton Center', reason_ja: 'ダウンタウンの乗換えに便利で、周辺の食事や買い物と組み合わせやすい実用的なハブです。', reason_en: 'A useful downtown transfer point that pairs well with nearby shopping and food.', category: 'TRANSIT', lat: 40.7103, lng: -74.0084 },
      { name_ja: 'Times Sq–42 St', name_en: 'Times Sq–42 St', reason_ja: '劇場街や大型観光動線に絡めやすく、ミッドタウン中央で一番分かりやすい交通拠点の一つです。', reason_en: 'One of the easiest Midtown hubs to understand, especially around theater and tourist movement.', category: 'TRANSIT', lat: 40.7553, lng: -73.987 },
    ],
    all: [
      { name_ja: 'Times Square', name_en: 'Times Square', reason_ja: '王道のランドマークで、初回訪問でも分かりやすく、劇場や買い物導線とまとめて回りやすいのが強みです。', reason_en: 'An iconic first-stop landmark that connects naturally to theaters, retail, and Midtown routes.', category: 'LANDMARK', lat: 40.758, lng: -73.9855 },
      { name_ja: 'Central Park', name_en: 'Central Park', reason_ja: 'マンハッタン内で散歩や休憩の中心になりやすく、他の観光地とも組み合わせやすい定番の自然スポットです。', reason_en: 'A classic green anchor for Manhattan, useful for both relaxation and route planning.', category: 'PARK', lat: 40.7812, lng: -73.9665 },
      { name_ja: 'Grand Central Terminal', name_en: 'Grand Central Terminal', reason_ja: '建築の見応えがあり、移動の起点としても使いやすいため、観光と実用性の両方を満たしやすい場所です。', reason_en: 'A visually strong landmark that is also highly practical as a route anchor.', category: 'TRANSIT', lat: 40.7527, lng: -73.9772 },
      { name_ja: 'The Met Cloisters', name_en: 'The Met Cloisters', reason_ja: '少し静かな体験をしたい時に向いており、美術と景観の両方を楽しめる独特の目的地です。', reason_en: 'A quieter, more distinctive destination for art, architecture, and a different pace.', category: 'LANDMARK', lat: 40.8649, lng: -73.9319 },
      { name_ja: 'Katz’s Delicatessen', name_en: 'Katz’s Delicatessen', reason_ja: 'ニューヨークらしい食体験を外しにくく、初めてでも訪れる意味が分かりやすい代表的な一軒です。', reason_en: 'A memorable and very recognizable New York food stop, easy to justify for first-time visitors.', category: 'RESTAURANT', lat: 40.7223, lng: -73.9874 },
    ],
  };
  return (base[c] || base.all).slice(0, 5);
};

const curatedNYTrends = (category: string): TrendItem[] => {
  const c = categoryLabel(category);
  const all: TrendItem[] = [
    { topic_ja: 'ブルックリン・ブリッジ散策', topic_en: 'Brooklyn Bridge walk', description_ja: '橋の往復とダンボ周辺の景色をセットで楽しむ動きが引き続き人気です。', description_en: 'Walking the bridge and pairing it with DUMBO views continues to stay popular.', category: '公園・自然', popularity: 88 },
    { topic_ja: 'チェルシーマーケットでの食べ歩き', topic_en: 'Chelsea Market food crawl', description_ja: '短時間でも回りやすく、複数の選択肢を一気に見られる点が注目されやすいです。', description_en: 'Chelsea Market keeps attention because it offers many choices in a compact stop.', category: 'レストラン', popularity: 85 },
    { topic_ja: 'セントラルパークでのピクニック', topic_en: 'Central Park picnics', description_ja: '天気の良い時期は公園利用や周辺ベーカリーのテイクアウト需要が上がりやすいです。', description_en: 'Good-weather periods increase interest in park picnics and nearby takeout stops.', category: '公園・自然', popularity: 82 },
    { topic_ja: 'ソーホーでのショッピング', topic_en: 'SoHo shopping', description_ja: 'ブランド巡りと街歩きを同時にこなせるので、買い物系の話題として安定しています。', description_en: 'SoHo remains a stable shopping topic because it blends retail with easy neighborhood walking.', category: 'ショッピング', popularity: 79 },
    { topic_ja: 'ローカルカフェ巡り', topic_en: 'Local cafe hopping', description_ja: 'ミッドタウンとダウンタウンの双方で、コーヒー目的の街歩き需要が続いています。', description_en: 'Cafe-hopping remains visible across both Midtown and downtown routes.', category: 'カフェ', popularity: 77 },
  ];
  const map: Record<string, TrendItem[]> = {
    cafe: [
      { topic_ja: 'ローカルカフェ巡り', topic_en: 'Local cafe hopping', description_ja: 'ブライアントパーク周辺からダウンタウンまで、コーヒー目的の立ち寄り需要が続いています。', description_en: 'Coffee-focused stopovers from Bryant Park to downtown continue to trend.', category: 'カフェ', popularity: 80 },
      { topic_ja: '朝カフェ需要', topic_en: 'Morning cafe runs', description_ja: '観光や通勤の前に短時間で寄れる店を探す動きが強めです。', description_en: 'Quick pre-sightseeing and pre-commute coffee runs stay relevant.', category: 'カフェ', popularity: 77 },
      { topic_ja: 'ベーカリー併設カフェ', topic_en: 'Bakery cafes', description_ja: 'コーヒーと軽食を一度に済ませたい需要が引き続き目立ちます。', description_en: 'Spots that combine coffee with pastries or light food keep drawing interest.', category: 'カフェ', popularity: 74 },
      { topic_ja: '作業しやすいカフェ', topic_en: 'Laptop-friendly cafes', description_ja: '席の広さや滞在しやすさを重視した検索が出やすいです。', description_en: 'Searches keep focusing on comfortable stays and laptop-friendly seating.', category: 'カフェ', popularity: 71 },
      { topic_ja: '季節ドリンクの話題', topic_en: 'Seasonal drinks', description_ja: '新作や期間限定ドリンクの話題がカフェ検索を後押ししています。', description_en: 'Seasonal drinks and limited menus continue to push café interest.', category: 'カフェ', popularity: 68 },
    ],
    restaurant: [
      { topic_ja: 'チェルシーマーケットでの食べ歩き', topic_en: 'Chelsea Market food crawl', description_ja: '複数人でも選びやすく、短時間で満足度を作りやすいのが強みです。', description_en: 'Chelsea Market stays strong because groups can choose easily and move fast.', category: 'レストラン', popularity: 82 },
      { topic_ja: 'デリ・サンド系の人気', topic_en: 'Deli and sandwich popularity', description_ja: 'ニューヨークらしい軽食を探す流れが引き続き目立ちます。', description_en: 'Classic deli and sandwich searches remain a visible New York food pattern.', category: 'レストラン', popularity: 79 },
      { topic_ja: 'ブランチ混雑回避', topic_en: 'Brunch crowd avoidance', description_ja: '予約しやすい時間帯や比較的入りやすい店が話題になりやすいです。', description_en: 'People keep searching for brunch spots with easier timing and lower friction.', category: 'レストラン', popularity: 75 },
      { topic_ja: 'フードホール需要', topic_en: 'Food hall demand', description_ja: '一度に複数候補を見られる食の集積地が安定して強いです。', description_en: 'Food halls remain attractive because they condense multiple options into one stop.', category: 'レストラン', popularity: 72 },
      { topic_ja: '夜遅めの食事探し', topic_en: 'Late dining searches', description_ja: '観劇後や移動後でも入りやすい店への関心が出やすいです。', description_en: 'Searches for easier late-night dining continue after theater and evening plans.', category: 'レストラン', popularity: 69 },
    ],
    shopping: [
      { topic_ja: 'ソーホーでのショッピング', topic_en: 'SoHo shopping', description_ja: 'ブランド巡りと街歩きの両立がしやすく、安定した注目があります。', description_en: 'SoHo remains a durable shopping topic because it blends browsing with neighborhood walking.', category: 'ショッピング', popularity: 81 },
      { topic_ja: 'フラッグシップ巡り', topic_en: 'Flagship store visits', description_ja: '有名ブランドの大型店をまとめて回る動きが続いています。', description_en: 'Flagship-store loops remain a common and practical shopping pattern.', category: 'ショッピング', popularity: 77 },
      { topic_ja: 'ギフト探し', topic_en: 'Gift shopping', description_ja: '雑貨やちょっとした手土産をまとめて探せるエリアが注目されます。', description_en: 'Gift-friendly districts and easy browse areas continue to attract attention.', category: 'ショッピング', popularity: 74 },
      { topic_ja: 'セール情報チェック', topic_en: 'Sale hunting', description_ja: '価格重視の買い方や期間限定のセールが気にされやすいです。', description_en: 'Value shopping and sale timing remain part of retail interest.', category: 'ショッピング', popularity: 71 },
      { topic_ja: 'ウィンドーショッピング', topic_en: 'Window shopping', description_ja: '歩いて回りながら雰囲気も楽しめるエリアの関心が高めです。', description_en: 'Walkable retail districts stay relevant even when browsing is the main goal.', category: 'ショッピング', popularity: 67 },
    ],
    park: [
      { topic_ja: 'ブルックリン・ブリッジ散策', topic_en: 'Brooklyn Bridge walk', description_ja: '橋と周辺の景色をまとめて楽しむ散歩導線が引き続き強いです。', description_en: 'Bridge walks and skyline views remain a strong walking trend.', category: '公園・自然', popularity: 83 },
      { topic_ja: 'セントラルパークでのピクニック', topic_en: 'Central Park picnics', description_ja: '天気の良い日は芝生エリア利用やテイクアウト需要が高まりやすいです。', description_en: 'Good-weather days keep park picnics and takeout pairings in focus.', category: '公園・自然', popularity: 80 },
      { topic_ja: 'ウォーターフロント散歩', topic_en: 'Waterfront walks', description_ja: '川沿いや海沿いの景色を楽しむ散歩ニーズが安定しています。', description_en: 'Riverside and waterfront walking remains a steady interest.', category: '公園・自然', popularity: 76 },
      { topic_ja: '展望スポット探し', topic_en: 'Scenic viewpoint searches', description_ja: '写真を撮りやすい景色の良い場所への関心が続いています。', description_en: 'Photo-friendly scenic viewpoints continue to attract searches.', category: '公園・自然', popularity: 72 },
      { topic_ja: '季節の自然と緑', topic_en: 'Seasonal greenery', description_ja: '季節感のある自然スポットは常に一定の注目があります。', description_en: 'Seasonal greenery and plant-filled spots keep a stable audience.', category: '公園・自然', popularity: 68 },
    ],
    transit: [
      { topic_ja: 'グランドセントラル周辺', topic_en: 'Grand Central area', description_ja: '移動だけでなく建築や周辺立ち寄り先も含めて話題に上がりやすいです。', description_en: 'Grand Central remains relevant as both a transport point and a destination area.', category: '交通', popularity: 79 },
      { topic_ja: 'オキュラス周辺', topic_en: 'Oculus area', description_ja: '建築と移動の両方を目的に含めやすく、ダウンタウン導線と相性が良いです。', description_en: 'The Oculus stays visible because transit and architecture overlap there.', category: '交通', popularity: 75 },
      { topic_ja: '主要ハブの乗換え最適化', topic_en: 'Major hub routing', description_ja: '混雑回避や効率の良い移動ルートへの関心が出やすいです。', description_en: 'Searches often focus on efficient transfers and reducing friction.', category: '交通', popularity: 71 },
      { topic_ja: '空港アクセスの確認', topic_en: 'Airport access checks', description_ja: '市内と空港の接続を事前に確認する動きが続いています。', description_en: 'Airport connection checks remain a recurring practical topic.', category: '交通', popularity: 68 },
      { topic_ja: '夜遅い移動手段', topic_en: 'Late-night transport options', description_ja: '深夜帯の帰路や移動手段を探す需要があります。', description_en: 'Late-night movement and return-route concerns continue to show up.', category: '交通', popularity: 64 },
    ],
  };
  return (map[c] || all).slice(0, 5);
};

const fallbackRecommendations = (location: string, category: string): RecommendationItem[] => curatedNYRecommendations(category);
const fallbackTrends = (location: string, category: string): TrendItem[] => curatedNYTrends(category);

const sanitizeRecommendations = (items: unknown, location: string, category: string): RecommendationItem[] => {
  const raw = Array.isArray(items) ? items : [];
  const cleaned = raw
    .map((item) => {
      const row = item as Partial<RecommendationItem> & { name?: string; reason?: string };
      const nameJa = String(row.name_ja || row.name || '').trim();
      const nameEn = String(row.name_en || row.name || '').trim();
      const reasonJa = String(row.reason_ja || row.reason || '').trim();
      const reasonEn = String(row.reason_en || row.reason || '').trim();
      return {
        name_ja: nameJa,
        name_en: nameEn,
        reason_ja: reasonJa,
        reason_en: reasonEn,
        category: String(row.category || '').trim() || 'PLACE',
        lat: typeof row.lat === 'number' ? row.lat : 0,
        lng: typeof row.lng === 'number' ? row.lng : 0,
      };
    })
    .filter((item) => item.name_ja && item.name_en && item.reason_ja && item.reason_en);

  if (cleaned.length >= 5) return cleaned.slice(0, 5);
  const fallback = fallbackRecommendations(location, category);
  const seen = new Set(cleaned.map((item) => item.name_en));
  for (const item of fallback) {
    if (seen.has(item.name_en)) continue;
    cleaned.push(item);
    seen.add(item.name_en);
    if (cleaned.length >= 5) break;
  }
  return cleaned.slice(0, 5);
};

const sanitizeTrends = (items: unknown, location: string, category: string): TrendItem[] => {
  const raw = Array.isArray(items) ? items : [];
  const banned = ['駅前', '商店街', '市役所周辺', '道の駅', 'station area', 'city hall area', 'shopping street', 'roadside station'];
  const cleaned = raw
    .map((item) => {
      const row = item as Partial<TrendItem>;
      return {
        topic_ja: String(row.topic_ja || '').trim(),
        topic_en: String(row.topic_en || '').trim(),
        description_ja: String(row.description_ja || '').trim(),
        description_en: String(row.description_en || '').trim(),
        category: String(row.category || '').trim() || category,
        popularity: typeof row.popularity === 'number' ? Math.max(50, Math.min(99, row.popularity)) : 72,
      };
    })
    .filter((item) => item.topic_ja && item.topic_en && item.description_ja && item.description_en)
    .filter((item) => !banned.some((word) => item.topic_ja.includes(word) || item.topic_en.toLowerCase().includes(word)));

  if (cleaned.length >= 5) return cleaned.slice(0, 5);
  const fallback = fallbackTrends(location, category);
  const seen = new Set(cleaned.map((item) => item.topic_en));
  for (const item of fallback) {
    if (seen.has(item.topic_en)) continue;
    cleaned.push(item);
    seen.add(item.topic_en);
    if (cleaned.length >= 5) break;
  }
  return cleaned.slice(0, 5);
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth.ok) return auth.response;
    if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not configured' }, 500);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode: Mode = body?.mode === 'trend' ? 'trend' : 'recommend';
    const location = String(body?.location || 'New York State > Manhattan').trim().slice(0, 140);
    const category = String(body?.category || 'general').trim().slice(0, 80);
    const bodyRefresh = Boolean(body?.refresh);

    const cacheKey = await buildCacheKey(mode, location, category);
    const cacheUrl = new URL(`https://edge-cache.local/api-ai-${cacheKey}`);
    const cache = caches.default;
    const canUseCache = !(mode === 'trend' && bodyRefresh);
    const cached = canUseCache ? await cache.match(cacheUrl.toString()) : null;
    if (cached) {
      return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers.entries()), ...corsHeaders, 'X-AI-Cache': 'HIT' } });
    }

    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    let prompt = '';
    let responseSchema: any = {};
    let maxOutputTokens = 700;
    let temperature = 0.25;
    let ttlSeconds = 60 * 60 * 24 * 14;
    let staleWhileRevalidateSeconds = 60 * 60 * 24 * 2;

    if (mode === 'recommend') {
      prompt = [
        'You are a concise bilingual local discovery assistant for Milz.',
        `Location: "${location}". Category: "${category}".`,
        'Return exactly 5 practical places people can actually visit right now.',
        'Use real place names only. No generic placeholders.',
        'Each item must include Japanese and English names, plus slightly fuller reasons in both languages.',
        'Recommendation reasons should explain why the place is good and how it fits a local route or visit plan.',
        'Return JSON only.',
      ].join('\n');

      responseSchema = {
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
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
              },
              required: ['name_ja', 'name_en', 'reason_ja', 'reason_en', 'category', 'lat', 'lng'],
            },
          },
        },
        required: ['recommendations'],
      };
    } else {
      prompt = [
        'You are a concise bilingual local trends assistant for Milz.',
        `Location: "${location}". Category: "${category}".`,
        'Return exactly 5 current-looking local themes or search-worthy topics for the area.',
        'Do not invent station-front districts, city hall areas, shopping streets, or roadside stations unless they are genuinely well-known and natural for the place.',
        'Trends do not need store names. They should feel like things people are currently curious about in that area.',
        'Keep descriptions practical, natural, and short in both Japanese and English.',
        'Return JSON only.',
      ].join('\n');

      responseSchema = {
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
              },
              required: ['topic_ja', 'topic_en', 'description_ja', 'description_en', 'category', 'popularity'],
            },
          },
        },
        required: ['trends'],
      };
      maxOutputTokens = 500;
      temperature = 0.35;
      ttlSeconds = 60 * 60 * 24;
      staleWhileRevalidateSeconds = 60 * 60 * 6;
    }

    const response = await timeoutFetch(
      () => ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema, maxOutputTokens, temperature },
      }),
      8000,
    );

    const text = response.text;
    if (!text) throw new Error('Empty AI response');
    const parsed = JSON.parse(text);

    const finalPayload = mode === 'recommend'
      ? { recommendations: sanitizeRecommendations(parsed?.recommendations, location, category) }
      : { trends: sanitizeTrends(parsed?.trends, location, category) };

    const payload = JSON.stringify({
      ...finalPayload,
      generatedAt: new Date().toISOString(),
      mode,
      location,
      category,
    });

    const cacheable = new Response(payload, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
        'X-AI-Cache': 'MISS',
      },
    });

    await cache.put(cacheUrl.toString(), cacheable.clone());
    return cacheable;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return json({ error: message }, 500);
  }
};

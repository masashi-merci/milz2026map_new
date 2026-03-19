export interface TrendItem {
  topic_ja: string;
  topic_en: string;
  description_ja: string;
  description_en: string;
  category: string;
  popularity: number;
  keyword_ja?: string;
  keyword_en?: string;
  examples_ja?: string[];
  examples_en?: string[];
}

type CanonicalCategory = 'all' | 'cafe' | 'restaurant' | 'transit' | 'parking' | 'park' | 'shopping' | 'school' | 'convenience' | 'other' | 'tourism';

interface PlaceTemplate {
  keywordJa: string;
  keywordEn: string;
  placeJa: string;
  placeEn: string;
  examplesJa: string[];
  examplesEn: string[];
  descriptionJa: string;
  descriptionEn: string;
  category: string;
  canonicalCategory: Exclude<CanonicalCategory, 'all'>;
  triggers?: string[];
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const includesAny = (haystack: string, needles: string[]) => needles.some((needle) => haystack.includes(normalize(needle)));

const CATEGORY_ALIASES: Record<CanonicalCategory, string[]> = {
  all: ['all', 'general', 'すべて'],
  cafe: ['カフェ', 'cafe', 'coffee', '喫茶'],
  restaurant: ['レストラン', 'restaurant', 'food', 'グルメ', '食事', '食べ歩き', '居酒屋', 'ランチ'],
  transit: ['駅・交通', 'station', 'transit', 'rail', 'train', '交通', '駅'],
  parking: ['駐車場', 'parking', 'パーキング'],
  park: ['公園・自然', 'park', 'nature', '自然', '公園', '散策'],
  shopping: ['ショッピング', 'shopping', 'mall', 'shop', '買い物', '商店街'],
  school: ['学校', 'school', 'campus', '大学'],
  convenience: ['コンビニ', 'convenience', 'drugstore', 'ドラッグストア'],
  other: ['その他', 'other'],
  tourism: ['観光', 'tourism', 'sightseeing', 'ランドマーク', 'seasonal', '季節', 'event', 'イベント'],
};

function canonicalizeCategory(value: string): CanonicalCategory {
  const normalized = normalize(value || 'all');
  for (const [key, aliases] of Object.entries(CATEGORY_ALIASES) as Array<[CanonicalCategory, string[]]>) {
    if (aliases.some((alias) => normalized.includes(normalize(alias)))) return key;
  }
  return 'other';
}

const REGION_ALIASES: Record<string, string[]> = {
  yamanashi: ['山梨', '甲府', '勝沼', '笛吹', '河口湖', '昇仙峡', 'kofu', 'yamanashi', 'katsunuma', 'fuefuki', 'kawaguchiko'],
  kyoto: ['京都', '祇園', '嵐山', '河原町', '清水寺', '烏丸', 'kyoto', 'gion', 'arashiyama', 'karasuma'],
  shibuya: ['渋谷', '原宿', '表参道', '恵比寿', 'shibuya', 'harajuku', 'omotesando', 'ebisu'],
  shinjuku: ['新宿', '代々木', '新大久保', 'shinjuku', 'yoyogi', 'shin-okubo'],
  nakano: ['中野', '東中野', '新井薬師', 'nakano', 'higashi-nakano', 'araiyakushi'],
  osaka: ['大阪', '梅田', '難波', '心斎橋', '天王寺', 'osaka', 'umeda', 'namba', 'shinsaibashi'],
  fukuoka: ['福岡', '博多', '天神', '中洲', 'fukuoka', 'hakata', 'tenjin', 'nakasu'],
  hawaii: ['hawaii', 'honolulu', 'waikiki', 'kakaako', 'ala moana', 'north shore', 'ハワイ', 'ホノルル', 'ワイキキ', 'カカアコ', 'アラモアナ'],
};

const TEMPLATES: Record<string, PlaceTemplate[]> = {
  yamanashi: [
    { keywordJa: 'ぶどう狩り', keywordEn: 'Grape picking', placeJa: '勝沼ぶどう郷', placeEn: 'Katsunuma Budokyo', examplesJa: ['勝沼ぶどう郷', 'ぶどうの丘', 'シャトー勝沼'], examplesEn: ['Katsunuma Budokyo', 'Budo no Oka', 'Chateau Katsunuma'], descriptionJa: '勝沼ぶどう郷を軸に、ぶどうの丘やシャトー勝沼まで回りやすい定番導線。', descriptionEn: 'A classic route around Katsunuma Budokyo, Budo no Oka, and Chateau Katsunuma.', category: '観光', canonicalCategory: 'tourism', triggers: ['ぶどう', 'grape', 'orchard', 'fruit', 'フルーツ'] },
    { keywordJa: 'ワイン巡り', keywordEn: 'Winery hopping', placeJa: '勝沼ワイナリーエリア', placeEn: 'Katsunuma Winery Area', examplesJa: ['シャトー勝沼', '勝沼醸造', 'マンズワイン勝沼ワイナリー'], examplesEn: ['Chateau Katsunuma', 'Katsunuma Jozo', 'Manns Wines Katsunuma Winery'], descriptionJa: '勝沼ワイナリーエリアなら試飲や景観をまとめて楽しみやすい。', descriptionEn: 'Katsunuma makes it easy to combine tastings and scenery.', category: '観光', canonicalCategory: 'tourism', triggers: ['ワイン', 'winery', 'wine'] },
    { keywordJa: 'カフェ巡り', keywordEn: 'Cafe hopping', placeJa: '河口湖カフェエリア', placeEn: 'Kawaguchiko Cafe Area', examplesJa: ['Cafe Troisieme Marche', '葡萄屋kofu ハナテラスcafe', 'Lake Bake'], examplesEn: ['Cafe Troisieme Marche', 'Budoya Kofu Hana Terrace Cafe', 'Lake Bake'], descriptionJa: '河口湖周辺は景色と一緒に楽しめるカフェがまとまりやすい。', descriptionEn: 'Kawaguchiko clusters scenic cafes that work well for a relaxed stopover.', category: 'カフェ', canonicalCategory: 'cafe', triggers: ['カフェ', 'cafe', 'coffee'] },
    { keywordJa: '郷土グルメ', keywordEn: 'Local food', placeJa: '甲府駅北口グルメエリア', placeEn: 'Kofu Station North Gourmet Area', examplesJa: ['小作 甲府駅前店', 'ほうとう不動 河口湖北本店', '奥藤本店 甲府駅前店'], examplesEn: ['Kosaku Kofu Ekimae', 'Hoto Fudo Kawaguchiko', 'Okuto Honten Kofu Ekimae'], descriptionJa: '小作や奥藤本店など、山梨らしい食事先を拾いやすい駅周辺。', descriptionEn: 'A station area where classic Yamanashi dining options are easy to find.', category: 'レストラン', canonicalCategory: 'restaurant', triggers: ['グルメ', 'food', 'restaurant', 'ほうとう', 'レストラン'] },
    { keywordJa: '紅葉散策', keywordEn: 'Autumn walk', placeJa: '河口湖もみじ回廊', placeEn: 'Kawaguchiko Momiji Corridor', examplesJa: ['河口湖もみじ回廊', '大石公園', '河口湖音楽と森の美術館'], examplesEn: ['Kawaguchiko Momiji Corridor', 'Oishi Park', 'Music Forest Museum'], descriptionJa: '河口湖もみじ回廊を中心に大石公園までつなげやすい秋の定番。', descriptionEn: 'A classic autumn route centered on the Momiji Corridor and Oishi Park.', category: '公園・自然', canonicalCategory: 'park', triggers: ['紅葉', 'autumn', 'fall foliage', 'nature', '公園'] },
    { keywordJa: 'お土産探し', keywordEn: 'Souvenir shopping', placeJa: '桔梗信玄餅 工場テーマパーク', placeEn: 'Kikyo Shingen Mochi Factory Theme Park', examplesJa: ['桔梗信玄餅 工場テーマパーク', '甲州夢小路', '山梨県地場産業センターかいてらす'], examplesEn: ['Kikyo Shingen Mochi Factory Theme Park', 'Koshu Yume Koji', 'Kaiterasu'], descriptionJa: '桔梗信玄餅と甲州夢小路をセットで回ると山梨らしい買い物導線になる。', descriptionEn: 'Combining the Shingen Mochi theme park with Koshu Yume Koji makes a strong souvenir route.', category: 'ショッピング', canonicalCategory: 'shopping', triggers: ['souvenir', '土産', 'shopping', '買い物'] },
  ],
  kyoto: [
    { keywordJa: 'カフェ巡り', keywordEn: 'Cafe hopping', placeJa: '清水寺参道カフェエリア', placeEn: 'Kiyomizu Approach Cafe Area', examplesJa: ['スターバックス 京都二寧坂ヤサカ茶屋店', '伊右衛門カフェ', 'arabica Kyoto Higashiyama'], examplesEn: ['Starbucks Kyoto Ninenzaka Yasaka Chaya', 'IYEMON Salon Kyoto', '% ARABICA Kyoto Higashiyama'], descriptionJa: '二寧坂のスターバックスや東山の arabica をつなげやすい。', descriptionEn: 'A practical route linking the famous Ninenzaka Starbucks and Higashiyama cafes.', category: 'カフェ', canonicalCategory: 'cafe', triggers: ['カフェ', 'cafe', 'coffee', 'matcha', '抹茶'] },
    { keywordJa: '京グルメ', keywordEn: 'Kyoto food', placeJa: '祇園四条グルメエリア', placeEn: 'Gion-Shijo Gourmet Area', examplesJa: ['ぎをん小森', '祇園きなな', '南座周辺の京料理店'], examplesEn: ['Gion Komori', 'Gion Kinana', 'Kyoto restaurants near Minamiza'], descriptionJa: '祇園四条は甘味から京料理までまとまりやすい。', descriptionEn: 'Gion-Shijo works well for both sweets and Kyoto cuisine.', category: 'レストラン', canonicalCategory: 'restaurant', triggers: ['グルメ', 'restaurant', 'food', 'ランチ', 'レストラン'] },
    { keywordJa: '寺社散策', keywordEn: 'Temple walk', placeJa: '清水寺周辺エリア', placeEn: 'Kiyomizu-dera Area', examplesJa: ['清水寺', '八坂の塔', '高台寺'], examplesEn: ['Kiyomizu-dera', 'Yasaka Pagoda', 'Kodaiji'], descriptionJa: '清水寺を軸に八坂の塔や高台寺までつなげやすい王道導線。', descriptionEn: 'A classic temple walk linking Kiyomizu-dera, Yasaka Pagoda, and Kodaiji.', category: '観光', canonicalCategory: 'tourism', triggers: ['観光', '寺', 'temple', 'sightseeing', '季節'] },
  ],
  shibuya: [
    { keywordJa: 'カフェ巡り', keywordEn: 'Cafe hopping', placeJa: '表参道カフェエリア', placeEn: 'Omotesando Cafe Area', examplesJa: ['Blue Bottle Coffee 青山カフェ', 'スターバックス リザーブ 表参道ヒルズ店', 'LATTEST'], examplesEn: ['Blue Bottle Coffee Aoyama', 'Starbucks Reserve Omotesando Hills', 'LATTEST'], descriptionJa: '表参道は定番チェーンと感度の高い個店を混ぜて回りやすい。', descriptionEn: 'Omotesando makes it easy to mix iconic chains with trend-driven indie cafes.', category: 'カフェ', canonicalCategory: 'cafe', triggers: ['カフェ', 'cafe', 'coffee'] },
    { keywordJa: 'ショッピング', keywordEn: 'Shopping', placeJa: '渋谷スクランブルスクエア', placeEn: 'Shibuya Scramble Square', examplesJa: ['渋谷スクランブルスクエア', 'MIYASHITA PARK', '渋谷PARCO'], examplesEn: ['Shibuya Scramble Square', 'MIYASHITA PARK', 'Shibuya PARCO'], descriptionJa: 'スクランブルスクエアを軸に MIYASHITA PARK や PARCO へ広げやすい。', descriptionEn: 'A strong shopping route centered on Scramble Square, MIYASHITA PARK, and PARCO.', category: 'ショッピング', canonicalCategory: 'shopping', triggers: ['shopping', '買い物', 'fashion', 'mall'] },
  ],
  nakano: [
    { keywordJa: 'カフェ巡り', keywordEn: 'Cafe hopping', placeJa: '中野駅北口カフェエリア', placeEn: 'Nakano North Exit Cafe Area', examplesJa: ['スターバックス 中野通り店', '喫茶ジンガロ', '不純喫茶ドープ 中野店'], examplesEn: ['Starbucks Nakano Dori', 'Kissa Zingaro', 'Jun Kissa Dope Nakano'], descriptionJa: '駅前のスターバックスから中野ブロードウェイ内の喫茶ジンガロまでつなげやすい。', descriptionEn: 'A usable route from the station-front Starbucks to Kissa Zingaro inside Nakano Broadway.', category: 'カフェ', canonicalCategory: 'cafe', triggers: ['カフェ', 'cafe', 'coffee'] },
    { keywordJa: '街歩き', keywordEn: 'Town walk', placeJa: '中野ブロードウェイ周辺', placeEn: 'Nakano Broadway Area', examplesJa: ['中野ブロードウェイ', '中野サンモール商店街', '中野四季の森公園'], examplesEn: ['Nakano Broadway', 'Nakano Sunmall', 'Nakano Shiki no Mori Park'], descriptionJa: 'ブロードウェイとサンモールを軸に、四季の森公園まで回遊しやすい。', descriptionEn: 'A practical walking route linking Nakano Broadway, Sunmall, and Shiki no Mori Park.', category: '観光', canonicalCategory: 'tourism', triggers: ['観光', 'town', 'walk', '散策', 'event'] },
    { keywordJa: '食べ歩き', keywordEn: 'Casual food crawl', placeJa: '中野サンモール商店街', placeEn: 'Nakano Sunmall Shopping Street', examplesJa: ['中野サンモール商店街', '青葉 中野本店', '中野レンガ坂'], examplesEn: ['Nakano Sunmall', 'Aoba Nakano Honten', 'Nakano Renga Zaka'], descriptionJa: 'サンモールからレンガ坂まで軽食と飲食店をつなげやすい。', descriptionEn: 'Sunmall and Renga Zaka create an easy casual food route.', category: 'レストラン', canonicalCategory: 'restaurant', triggers: ['グルメ', 'restaurant', 'food', 'ランチ', '食べ歩き'] },
  ],
  hawaii: [
    { keywordJa: 'カフェ巡り', keywordEn: 'Cafe hopping', placeJa: 'カカアコカフェエリア', placeEn: 'Kakaako Cafe Area', examplesJa: ['ARVO', 'Morning Glass Coffee', 'Nourish Cafe Hawaii'], examplesEn: ['ARVO', 'Morning Glass Coffee', 'Nourish Cafe Hawaii'], descriptionJa: 'カカアコは ARVO などローカル寄りのカフェを拾いやすい。', descriptionEn: 'Kakaako makes it easy to pick up local-leaning cafes like ARVO.', category: 'カフェ', canonicalCategory: 'cafe', triggers: ['カフェ', 'cafe', 'coffee'] },
    { keywordJa: 'ビーチ散策', keywordEn: 'Beach walk', placeJa: 'ワイキキビーチ周辺', placeEn: 'Waikiki Beach Area', examplesJa: ['ワイキキビーチ', 'クヒオビーチ', 'ワイキキビーチウォーク'], examplesEn: ['Waikiki Beach', 'Kuhio Beach', 'Waikiki Beach Walk'], descriptionJa: 'ワイキキビーチからビーチウォークまでつなげやすい王道導線。', descriptionEn: 'A classic route linking Waikiki Beach, Kuhio Beach, and Waikiki Beach Walk.', category: '観光', canonicalCategory: 'tourism', triggers: ['観光', 'beach', 'sightseeing', 'walk'] },
    { keywordJa: 'ショッピング', keywordEn: 'Shopping', placeJa: 'アラモアナセンター周辺', placeEn: 'Ala Moana Center Area', examplesJa: ['アラモアナセンター', 'アラモアナビーチパーク', 'ワードビレッジ'], examplesEn: ['Ala Moana Center', 'Ala Moana Beach Park', 'Ward Village'], descriptionJa: 'アラモアナセンターを軸にワードビレッジまで広げやすい。', descriptionEn: 'A flexible route around Ala Moana Center and Ward Village.', category: 'ショッピング', canonicalCategory: 'shopping', triggers: ['shopping', '買い物', 'mall'] },
  ],
};

function detectRegion(location: string): string | null {
  const normalized = normalize(location);
  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    if (includesAny(normalized, aliases)) return region;
  }
  return null;
}

function inferCategoryFromTrend(trend: TrendItem): CanonicalCategory {
  const source = normalize([trend.topic_ja, trend.topic_en, trend.description_ja, trend.description_en, trend.category].join(' '));
  if (includesAny(source, CATEGORY_ALIASES.cafe)) return 'cafe';
  if (includesAny(source, CATEGORY_ALIASES.restaurant)) return 'restaurant';
  if (includesAny(source, CATEGORY_ALIASES.shopping)) return 'shopping';
  if (includesAny(source, CATEGORY_ALIASES.park)) return 'park';
  if (includesAny(source, CATEGORY_ALIASES.transit)) return 'transit';
  if (includesAny(source, CATEGORY_ALIASES.parking)) return 'parking';
  if (includesAny(source, CATEGORY_ALIASES.school)) return 'school';
  if (includesAny(source, CATEGORY_ALIASES.convenience)) return 'convenience';
  return 'tourism';
}

function extractArea(location: string): string {
  const raw = location
    .split(/[>,／/|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const priority = [...raw].reverse().find((part) => part.length >= 2);
  const area = priority || location.trim() || 'この地域';
  return area.replace(/^(日本|japan)$/i, 'この地域');
}

function genericTemplates(area: string): PlaceTemplate[] {
  const safeArea = area || 'この地域';
  return [
    { keywordJa: 'カフェ巡り', keywordEn: 'Cafe hopping', placeJa: `${safeArea}駅前カフェエリア`, placeEn: `${safeArea} Station Cafe Area`, examplesJa: [`${safeArea}駅前`, `${safeArea}中心街カフェ`, `${safeArea}商店街喫茶店`], examplesEn: [`${safeArea} Station`, `${safeArea} central cafe area`, `${safeArea} shopping street cafe`], descriptionJa: `${safeArea}では駅前・中心街・商店街の3点を押さえるとカフェ候補を探しやすい。`, descriptionEn: `In ${safeArea}, the station-front, central area, and shopping street are the most practical cafe anchors.`, category: 'カフェ', canonicalCategory: 'cafe' },
    { keywordJa: '食べ歩き', keywordEn: 'Food crawl', placeJa: `${safeArea}中心グルメエリア`, placeEn: `${safeArea} Central Gourmet Area`, examplesJa: [`${safeArea}駅前飲食街`, `${safeArea}中心街`, `${safeArea}商店街`], examplesEn: [`${safeArea} station-front dining`, `${safeArea} central district`, `${safeArea} shopping street`], descriptionJa: `${safeArea}なら駅前飲食街と商店街まわりが食事の基本導線。`, descriptionEn: `For ${safeArea}, the station-front dining zone and shopping street are the default dining anchors.`, category: 'レストラン', canonicalCategory: 'restaurant' },
    { keywordJa: '街歩き', keywordEn: 'Town walk', placeJa: `${safeArea}中心散策エリア`, placeEn: `${safeArea} Central Walking Area`, examplesJa: [`${safeArea}中心街`, `${safeArea}市役所周辺`, `${safeArea}駅周辺`], examplesEn: [`${safeArea} central district`, `${safeArea} city hall area`, `${safeArea} station area`], descriptionJa: `${safeArea}では中心街・市役所周辺・駅周辺を軸に回遊しやすい。`, descriptionEn: `In ${safeArea}, the central district, city hall area, and station area form the most practical walking route.`, category: '観光', canonicalCategory: 'tourism' },
    { keywordJa: '買い物', keywordEn: 'Shopping', placeJa: `${safeArea}ショッピングエリア`, placeEn: `${safeArea} Shopping Area`, examplesJa: [`${safeArea}商店街`, `${safeArea}中心街`, `${safeArea}道の駅`], examplesEn: [`${safeArea} shopping street`, `${safeArea} central district`, `${safeArea} roadside station`], descriptionJa: `${safeArea}では商店街や中心街の買い物導線が使いやすい。`, descriptionEn: `For ${safeArea}, shopping streets and the central district are the most practical shopping anchors.`, category: 'ショッピング', canonicalCategory: 'shopping' },
    { keywordJa: '公園散策', keywordEn: 'Park walk', placeJa: `${safeArea}公園・自然エリア`, placeEn: `${safeArea} Park Area`, examplesJa: [`${safeArea}総合公園`, `${safeArea}河川沿い`, `${safeArea}展望スポット`], examplesEn: [`${safeArea} general park`, `${safeArea} riverside`, `${safeArea} lookout`], descriptionJa: `${safeArea}では総合公園や河川沿いが自然系の基本候補。`, descriptionEn: `For ${safeArea}, parks and riverside areas are the default nature anchors.`, category: '公園・自然', canonicalCategory: 'park' },
  ];
}

function pickTemplates(region: string | null, area: string, requested: CanonicalCategory, trend: TrendItem): PlaceTemplate[] {
  const pool = region ? (TEMPLATES[region] || []) : [];
  const source = normalize([trend.topic_ja, trend.topic_en, trend.description_ja, trend.description_en, trend.category].join(' '));
  const byRequested = requested === 'all' ? pool : pool.filter((item) => item.canonicalCategory === requested);
  const matched = byRequested.filter((item) => item.triggers?.some((t) => source.includes(normalize(t))));
  if (matched.length) return matched;
  if (byRequested.length) return byRequested;
  const generic = genericTemplates(area);
  return requested === 'all' ? generic : generic.filter((item) => item.canonicalCategory === requested);
}

export function concretizeTrends(location: string, requestedCategoryValue: string, trends: TrendItem[]): TrendItem[] {
  const region = detectRegion(location);
  const requestedCategory = canonicalizeCategory(requestedCategoryValue || 'all');
  const area = extractArea(location);
  const used = new Set<string>();
  const results: TrendItem[] = [];
  const baseTrends = trends.length ? trends : [{ topic_ja: '', topic_en: '', description_ja: '', description_en: '', category: requestedCategoryValue, popularity: 88 }];

  for (let index = 0; index < Math.max(baseTrends.length, 5); index += 1) {
    const trend = baseTrends[index % baseTrends.length] as TrendItem;
    const inferred = requestedCategory === 'all' ? inferCategoryFromTrend(trend) : requestedCategory;
    const candidates = [
      ...pickTemplates(region, area, inferred, trend),
      ...pickTemplates(region, area, requestedCategory === 'all' ? 'tourism' : requestedCategory, trend),
    ];
    const chosen = candidates.find((item) => !used.has(item.placeJa));
    if (!chosen) continue;

    used.add(chosen.placeJa);
    results.push({
      topic_ja: chosen.placeJa,
      topic_en: chosen.placeEn,
      keyword_ja: trend.topic_ja?.trim() || chosen.keywordJa,
      keyword_en: trend.topic_en?.trim() || chosen.keywordEn,
      description_ja: chosen.descriptionJa,
      description_en: chosen.descriptionEn,
      examples_ja: chosen.examplesJa,
      examples_en: chosen.examplesEn,
      category: chosen.category,
      popularity: typeof trend.popularity === 'number' ? trend.popularity : Math.max(55, 92 - index * 7),
    });

    if (results.length >= 5) break;
  }

  while (results.length < 5) {
    const generic = genericTemplates(area).find((item) => !used.has(item.placeJa));
    if (!generic) break;
    used.add(generic.placeJa);
    results.push({
      topic_ja: generic.placeJa,
      topic_en: generic.placeEn,
      keyword_ja: generic.keywordJa,
      keyword_en: generic.keywordEn,
      description_ja: generic.descriptionJa,
      description_en: generic.descriptionEn,
      examples_ja: generic.examplesJa,
      examples_en: generic.examplesEn,
      category: generic.category,
      popularity: Math.max(50, 82 - results.length * 6),
    });
  }

  return results.slice(0, 5);
}

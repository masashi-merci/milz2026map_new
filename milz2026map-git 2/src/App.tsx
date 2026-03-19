/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { getSupabase, testSupabaseConnection, resetSupabaseClient } from './supabase';
import { renderToStaticMarkup } from 'react-dom/server';
import { 
  MapPin, 
  LogIn, 
  LogOut, 
  Plus, 
  X, 
  ExternalLink, 
  Navigation, 
  ShieldCheck, 
  User as UserIcon, 
  Loader2,
  Map as MapIcon,
  List as ListIcon,
  Search,
  Filter,
  ChevronRight,
  Info,
  Trash2,
  Utensils,
  ShoppingBag,
  MoreHorizontal,
  Heart,
  Sparkles,
  Globe,
  MapPinned,
  Send,
  TrendingUp,
  AlertCircle,
  Hash,
  Coffee,
  Gift,
  Ticket,
  Mail,
  Lock,
  UserPlus,
  Camera,
  Image as ImageIcon,
  CheckCircle2,
  Copy,
  Trees,
  Palette,
  Train,
  ParkingCircle,
  School,
  Store,
  Pencil,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const AI_CACHE_PREFIX = 'milz_ai_cache_v6';
const GEO_CACHE_PREFIX = 'milz_geo_cache_v1';

function normalizeCacheText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: number; value?: T };
    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T, ttlMs: number) {
  try {
    localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {}
}

function getAiCacheKey(mode: 'recommend' | 'trend', location: string, category: string) {
  return `${AI_CACHE_PREFIX}:${mode}:${normalizeCacheText(location)}:${normalizeCacheText(category || 'general')}`;
}

function getGeocodeCacheKey(address: string) {
  return `${GEO_CACHE_PREFIX}:${normalizeCacheText(address)}`;
}

// Fix Leaflet icon issue
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

type UserRole = 'admin' | 'user';
type Tab = 'map' | 'list' | 'ai' | 'profile';

interface Place {
  id: string;
  name: string;
  description?: string;
  category: 'restaurant' | 'shop' | 'other';
  lat: number;
  lng: number;
  country?: string;
  prefecture?: string;
  municipality?: string;
  address?: string;
  website_url?: string;
  image_url?: string;
  created_by: string;
  created_at: string;
}

interface Favorite {
  id: string;
  user_id: string;
  place_id: string;
  created_at: string;
}

interface AIResults {
  recommendations?: {
    name_ja: string;
    name_en: string;
    reason_ja: string;
    reason_en: string;
    category: string;
    lat: number;
    lng: number;
  }[];
  trends?: {
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
    source_url?: string;
  }[];
}


type RecommendationCard = {
  name_ja: string;
  name_en: string;
  reason_ja: string;
  reason_en: string;
  category: string;
};

function curatedRecommendationFallback(location: string): RecommendationCard[] {
  const normalized = normalizeCacheText(location);
  if (normalized.includes('manhattan') || normalized.includes('new york')) {
    return [
      { name_ja: 'Times Square', name_en: 'Times Square', reason_ja: 'ブロードウェイやミッドタウン観光の中心で、初回訪問でも動線を組みやすい定番ランドマークです。', reason_en: 'A classic Midtown landmark that is easy to work into a first New York route.', category: 'LANDMARK' },
      { name_ja: 'Central Park', name_en: 'Central Park', reason_ja: '街歩きの合間に自然と景色をまとめて楽しめる、最も使いやすい公園スポットです。', reason_en: 'The city’s most flexible park stop for scenery, rest, and neighborhood walking.', category: 'PARK' },
    ];
  }
  if (normalized.includes('tokyo') || normalized.includes('東京')) {
    return [
      { name_ja: '明治神宮', name_en: 'Meiji Jingu', reason_ja: '原宿や表参道と組み合わせやすく、東京観光で非常に使いやすい定番スポットです。', reason_en: 'A highly practical Tokyo stop that pairs naturally with Harajuku and Omotesando.', category: 'LANDMARK' },
      { name_ja: '渋谷スクランブルスクエア', name_en: 'Shibuya Scramble Square', reason_ja: '買い物・食事・展望をまとめやすい渋谷の代表スポットです。', reason_en: 'A strong Shibuya anchor for shopping, dining, and views.', category: 'SHOPPING' },
    ];
  }
  if (normalized.includes('kyoto') || normalized.includes('京都')) {
    return [
      { name_ja: '清水寺', name_en: 'Kiyomizu-dera', reason_ja: '京都らしい景観を感じやすく、東山散策の軸として使いやすいです。', reason_en: 'A classic Kyoto anchor for eastern Kyoto walking.', category: 'LANDMARK' },
      { name_ja: '錦市場', name_en: 'Nishiki Market', reason_ja: '食べ歩きと中心部散策をまとめやすい定番スポットです。', reason_en: 'A practical central Kyoto stop for food and browsing.', category: 'RESTAURANT' },
    ];
  }
  if (normalized.includes('seoul') || normalized.includes('韓国') || normalized.includes('ソウル')) {
    return [
      { name_ja: '景福宮', name_en: 'Gyeongbokgung Palace', reason_ja: 'ソウル観光の定番で、韓国らしい体験として非常に分かりやすいです。', reason_en: 'A core Seoul landmark that works very well for first-time visitors.', category: 'LANDMARK' },
      { name_ja: '明洞', name_en: 'Myeongdong', reason_ja: '買い物と食べ歩きを短時間でまとめやすい王道エリアです。', reason_en: 'A practical district for shopping and street-food.', category: 'SHOPPING' },
    ];
  }
  return [];
}

function normalizeRecommendationCards(results: AIResults | null, location: string): RecommendationCard[] {
  const raw = Array.isArray(results?.recommendations) ? results!.recommendations : [];
  const mapped = raw
    .map((rec: any) => ({
      name_ja: String(rec?.name_ja || rec?.title_ja || rec?.title || rec?.name || rec?.name_en || '').trim(),
      name_en: String(rec?.name_en || rec?.title_en || rec?.title || rec?.name || rec?.name_ja || '').trim(),
      reason_ja: String(rec?.reason_ja || rec?.description_ja || rec?.description || rec?.reason || rec?.reason_en || '').trim(),
      reason_en: String(rec?.reason_en || rec?.description_en || rec?.description || rec?.reason || rec?.reason_ja || '').trim(),
      category: String(rec?.category || 'PLACE').trim() || 'PLACE',
    }))
    .filter((rec) => rec.name_ja || rec.name_en)
    .map((rec) => ({
      ...rec,
      reason_ja: rec.reason_ja || rec.reason_en || 'このエリアで立ち寄りやすいおすすめ候補です。',
      reason_en: rec.reason_en || rec.reason_ja || 'A practical recommendation for this area.',
    }));

  if (mapped.length >= 5) return mapped.slice(0, 5);

  const fallback = curatedRecommendationFallback(location);
  const seen = new Set(mapped.map((rec) => (rec.name_en || rec.name_ja).toLowerCase()));
  for (const rec of fallback) {
    const key = (rec.name_en || rec.name_ja).toLowerCase();
    if (seen.has(key)) continue;
    mapped.push(rec);
    seen.add(key);
    if (mapped.length >= 5) break;
  }
  return mapped.slice(0, 5);
}

// Custom Map Events Component
function MapEvents({ 
  user, 
  role, 
  activeTab, 
  setNewPlacePos, 
  setIsAdding, 
  setMapBounds, 
  mapRef 
}: { 
  user: any, 
  role: UserRole | null, 
  activeTab: Tab, 
  setNewPlacePos: (pos: { lat: number; lng: number } | null) => void, 
  setIsAdding: (val: boolean) => void, 
  setMapBounds: (bounds: L.LatLngBounds | null) => void, 
  mapRef: React.MutableRefObject<L.Map | null>
}) {
  const map = useMap();
  
  useEffect(() => {
    if (map) {
      mapRef.current = map;
      setMapBounds(map.getBounds());
    }
  }, [map, mapRef, setMapBounds]);

  useMapEvents({
    click(e) {
      if (user && role === 'admin' && activeTab === 'map') {
        setNewPlacePos(e.latlng);
        setIsAdding(true);
      }
    },
    moveend() {
      setMapBounds(map.getBounds());
    }
  });
  return null;
}

const MAP_STYLES = {
  original: {
    name: 'オリジナル',
    description: '標準の地図表示',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  guide_mono: {
    name: 'ガイドデザイン',
    description: '案内図のようなモノトーンデザイン',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }
};


const REGION_PRESETS = {
  ny: {
    key: 'ny',
    name: 'New York',
    country: 'USA',
    prefecture: 'New York',
    municipality: 'Manhattan',
    mapCenter: [40.7831, -73.9712] as [number, number],
    mapZoom: 12,
    lockCountry: true,
    lockPrefecture: true,
  },
  tokyo: {
    key: 'tokyo',
    name: 'Tokyo',
    country: 'Japan',
    prefecture: 'Tokyo',
    municipality: 'Shibuya',
    mapCenter: [35.6595, 139.7005] as [number, number],
    mapZoom: 12,
    lockCountry: true,
    lockPrefecture: true,
  },
  kyoto: {
    key: 'kyoto',
    name: 'Kyoto',
    country: 'Japan',
    prefecture: 'Kyoto',
    municipality: 'Higashiyama',
    mapCenter: [35.0037, 135.7788] as [number, number],
    mapZoom: 12,
    lockCountry: true,
    lockPrefecture: true,
  },
  korea: {
    key: 'korea',
    name: 'Seoul',
    country: 'South Korea',
    prefecture: 'Seoul',
    municipality: 'Jung-gu',
    mapCenter: [37.5665, 126.9780] as [number, number],
    mapZoom: 12,
    lockCountry: true,
    lockPrefecture: true,
  },
} as const;

type RegionKey = keyof typeof REGION_PRESETS;

function normalizeLocationFilter(region: (typeof REGION_PRESETS)[RegionKey], input: { country: string; prefecture: string; municipality: string; address: string }) {
  return {
    country: region.lockCountry ? region.country : input.country,
    prefecture: region.lockPrefecture ? region.prefecture : input.prefecture,
    municipality: input.municipality?.trim() || region.municipality,
    address: input.address?.trim() || '',
  };
}

function buildScopedLocationString(region: (typeof REGION_PRESETS)[RegionKey], input: { country: string; prefecture: string; municipality: string; address?: string }) {
  const scoped = normalizeLocationFilter(region, { ...input, address: input.address || '' });
  return [scoped.country, scoped.prefecture, scoped.municipality, scoped.address].filter(Boolean).join(' ').trim();
}


const UI_TEXT = {
  ja: {
    searchSpots: 'スポットを検索...',
    refreshMap: '地図を更新',
    aiTitle: 'MILZ AI',
    aiSubtitle: '実在スポットの推薦と、実際に検索されている旬の話題を表示します。',
    locationFilter: 'ロケーションフィルター',
    locationNote: 'Region を切り替えると、Map と AI の対象地域も切り替わります。',
    region: 'Region',
    cityArea: 'City / Area',
    addressOptional: '住所・ランドマーク（任意）',
    recommend: 'RECOMMEND',
    trends: 'TRENDS',
    getRecommendations: 'おすすめを取得',
    getTrends: 'このエリアの旬を取得',
    recommendedSpots: 'おすすめスポット',
    localTrends: 'ローカルトレンド',
    mapStyleSettings: '地図テーマ設定',
    signOut: 'サインアウト',
    examples: '具体例: ',
    allSpots: 'すべてのスポット',
    favorites: 'お気に入り',
    profile: 'プロフィール',
    original: 'オリジナル',
    guide: 'ガイドデザイン',
    aiErrorPrefix: 'AIエラー',
    source: '参照',
  },
  en: {
    searchSpots: 'Search spots...',
    refreshMap: 'Refresh map',
    aiTitle: 'MILZ AI',
    aiSubtitle: 'Shows real place recommendations and search-driven local trends.',
    locationFilter: 'Location Filter',
    locationNote: 'Changing the region also switches the map and AI target area.',
    region: 'Region',
    cityArea: 'City / Area',
    addressOptional: 'Address or landmark (optional)',
    recommend: 'RECOMMEND',
    trends: 'TRENDS',
    getRecommendations: 'GET RECOMMENDATIONS',
    getTrends: 'GET LOCAL TRENDS',
    recommendedSpots: 'Recommended Spots',
    localTrends: 'Local Trends',
    mapStyleSettings: 'Map Theme',
    signOut: 'Sign out',
    examples: 'Examples: ',
    allSpots: 'All Spots',
    favorites: 'Favorites',
    profile: 'Profile',
    original: 'Original',
    guide: 'Guide Design',
    aiErrorPrefix: 'AI error',
    source: 'Source',
  }
} as const;

const CATEGORY_CONFIG: Record<string, { icon: any, color: string, bg: string }> = {
  'レストラン': { icon: Utensils, color: '#000000', bg: '#FFFFFF' },
  'カフェ': { icon: Coffee, color: '#000000', bg: '#FFFFFF' },
  '駅・交通': { icon: Train, color: '#000000', bg: '#FFFFFF' },
  '駐車場': { icon: ParkingCircle, color: '#000000', bg: '#FFFFFF' },
  '公園・自然': { icon: Trees, color: '#000000', bg: '#FFFFFF' },
  'ショッピング': { icon: ShoppingBag, color: '#000000', bg: '#FFFFFF' },
  '学校': { icon: School, color: '#000000', bg: '#FFFFFF' },
  'コンビニ': { icon: Store, color: '#000000', bg: '#FFFFFF' },
  'その他': { icon: MoreHorizontal, color: '#000000', bg: '#FFFFFF' },
};

const getCustomIcon = (category: string, mapStyle: string) => {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG['その他'];
  const Icon = config.icon;
  
  const isIllustrative = mapStyle === 'guide_mono';
  
  const html = renderToStaticMarkup(
    <div style={{
      backgroundColor: isIllustrative ? '#000000' : config.bg,
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: isIllustrative ? '2px solid #000000' : '3px solid white',
      boxShadow: isIllustrative ? 'none' : '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      transition: 'all 0.3s ease'
    }}>
      <Icon size={18} color={isIllustrative ? '#FFFFFF' : config.color} strokeWidth={isIllustrative ? 2.5 : 3} />
    </div>
  );

  return L.divIcon({
    html,
    className: 'custom-div-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18]
  });
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [places, setPlaces] = useState<Place[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('map');
  const [isAdding, setIsAdding] = useState(false);
  const [newPlacePos, setNewPlacePos] = useState<{ lat: number; lng: number } | null>(null);
  const [editingPlace, setEditingPlace] = useState<Place | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [listFilter, setListFilter] = useState<'all' | 'favorites'>('all');
  const [mapStyle, setMapStyle] = useState<keyof typeof MAP_STYLES>(() => {
    const saved = localStorage.getItem('milz_map_style');
    if (saved && saved in MAP_STYLES) {
      return saved as keyof typeof MAP_STYLES;
    }
    return 'original';
  });

  useEffect(() => {
    localStorage.setItem('milz_map_style', mapStyle);
  }, [mapStyle]);

  const [uiLanguage, setUiLanguage] = useState<'ja' | 'en'>(() => {
    const saved = localStorage.getItem('milz_ui_language');
    return saved === 'en' ? 'en' : 'ja';
  });

  useEffect(() => {
    localStorage.setItem('milz_ui_language', uiLanguage);
  }, [uiLanguage]);
  
  const [selectedRegionKey, setSelectedRegionKey] = useState<RegionKey>('ny');
  const activeRegion = REGION_PRESETS[selectedRegionKey];

  const [locationFilter, setLocationFilter] = useState(() => normalizeLocationFilter(REGION_PRESETS.ny, {
    country: REGION_PRESETS.ny.country,
    prefecture: REGION_PRESETS.ny.prefecture,
    municipality: REGION_PRESETS.ny.municipality,
    address: ''
  }));

  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<'recommend' | 'trend'>('recommend');
  const [aiTrendCategory, setAiTrendCategory] = useState('all');
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    setLocationFilter(normalizeLocationFilter(activeRegion, {
      country: activeRegion.country,
      prefecture: activeRegion.prefecture,
      municipality: activeRegion.municipality,
      address: '',
    }));
    setAiResults(null);
    setAiError('');
  }, [activeRegion]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ 
    title: string; 
    message: string; 
    onConfirm: () => void; 
    onCancel?: () => void;
  } | null>(null);

  const showToast = React.useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Add to debug logs
  const addLog = React.useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  // Listen for Supabase diagnostic logs
  useEffect(() => {
    const handleDiagLog = (e: any) => {
      addLog(`Supabase: ${e.detail}`);
    };
    window.addEventListener('supabase-debug-log', handleDiagLog);
    return () => window.removeEventListener('supabase-debug-log', handleDiagLog);
  }, [addLog]);
  const [aiResults, setAiResults] = useState<AIResults | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'signin'>('signin');
  const [selectedAuthRole, setSelectedAuthRole] = useState<UserRole>('user');
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [uploading, setUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const isFetchingProfileRef = useRef(false);

  const mapRef = useRef<L.Map | null>(null);

  const [isConfigMissing, setIsConfigMissing] = useState(!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY);

  // Auth and Role listener
  useEffect(() => {
    console.log('App: Initializing auth...', { isConfigMissing });
    
    if (isConfigMissing) {
      console.log('App: Config missing, stopping loading');
      setLoading(false);
      return;
    }

    let isMounted = true;

    const initAuth = async () => {
      try {
        console.log('App: initAuth starting');
        const client = getSupabase();
        if (!client) {
          console.log('App: Supabase client not available');
          if (isMounted) setLoading(false);
          return;
        }
        
        const sessionPromise = client.auth.getSession();
        const sessionTimeout = new Promise((resolve) => 
          setTimeout(() => {
            console.warn('App: getSession timed out, proceeding with null session');
            resolve({ data: { session: null }, error: null });
          }, 10000)
        );
        
        const { data: { session }, error: sessionError } = await Promise.race([sessionPromise, sessionTimeout]) as any;
        if (sessionError) throw sessionError;
        
        if (session?.user) {
          console.log('App: Session found', session.user.email);
          setUser(session.user);
          // Immediate role override for admin
          if (session.user.email === 'masashi@milz.tech') {
            setRole('admin');
          }
          await fetchProfile(session.user.id, session.user.email);
        } else {
          console.log('App: No session found');
        }
      } catch (error) {
        console.error('App: Auth init error:', error);
      } finally {
        console.log('App: initAuth finished');
        if (isMounted) setLoading(false);
      }
    };

    initAuth();

    const client = getSupabase();
    let subscription: any = null;
    
    if (client) {
      const { data } = client.auth.onAuthStateChange(async (event, session) => {
        console.log('App: Auth state change', event, session?.user?.email);
        if (isMounted) {
          if (session?.user) {
            setUser(session.user);
            // Immediate role override for admin
            if (session.user.email === 'masashi@milz.tech') {
              setRole('admin');
            }
            await fetchProfile(session.user.id, session.user.email);
          } else {
            setUser(null);
            setRole(null);
          }
          setLoading(false);
        }
      });
      subscription = data.subscription;
    }

    // Fallback: Ensure loading is disabled after a timeout
    const timer = setTimeout(() => {
      if (isMounted && loading) {
        console.warn('App: Initialization timeout, forcing loading off');
        setLoading(false);
      }
    }, 10000);

    return () => {
      isMounted = false;
      if (subscription) subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [isConfigMissing]);

  const fetchProfile = async (userId: string, userEmail?: string) => {
    if (isFetchingProfileRef.current) return;
    isFetchingProfileRef.current = true;

    const tryRawProfileFetch = async () => {
      addLog('fetchProfile: Attempting Raw API fallback...');
      try {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=role`, {
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          const profile = data[0];
          if (profile) {
            addLog('fetchProfile: Raw API Success (Profile found)');
            let currentRole = profile.role as UserRole;
            const adminEmail = 'masashi@milz.tech';
            if (userEmail?.toLowerCase().trim() === adminEmail) {
              currentRole = 'admin';
            }
            setRole(currentRole);
            return true;
          }
          addLog('fetchProfile: Raw API Success (No profile found)');
          return false;
        }
        addLog(`fetchProfile: Raw API Failed (${res.status})`);
        return false;
      } catch (e: any) {
        addLog(`fetchProfile: Raw API Exception: ${e.message}`);
        return false;
      }
    };

    try {
      const email = userEmail?.toLowerCase().trim();
      console.log('App: fetchProfile', { userId, email });
      const client = getSupabase();
      if (!client) {
        addLog('fetchProfile: Client missing, trying raw fetch');
        await tryRawProfileFetch();
        isFetchingProfileRef.current = false;
        return;
      }
      
      const adminEmail = 'masashi@milz.tech';
      
      // Force state if email matches
      if (email === adminEmail) {
        console.log('App: Email matches admin, forcing state');
        setRole('admin');
      }

      const fetchPromise = client
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Profile fetch timed out (10s)')), 10000)
      );

      addLog('fetchProfile: Awaiting response from Supabase library...');
      try {
        const result = await Promise.race([fetchPromise, timeoutPromise]) as any;
        const { data: profile, error } = result;

        if (error) {
          addLog(`fetchProfile: Library Error: ${error.message}`);
          await tryRawProfileFetch();
        } else if (profile) {
          let currentRole = profile.role as UserRole;
          console.log('App: Profile found in DB', { currentRole });
          
          // Force admin role if email matches adminEmail
          if (email === adminEmail && currentRole !== 'admin') {
            console.log('App: Forcing admin role update in DB for', email);
            currentRole = 'admin';
            await client.from('profiles').update({ role: 'admin' }).eq('id', userId);
          }
          setRole(currentRole);
        } else {
          // Create or update profile using upsert to avoid race conditions
          const roleToSet = (email === adminEmail) ? 'admin' : (pendingRole || 'user');
          console.log('App: Upserting profile with role', roleToSet);
          
          const { error: upsertError } = await client
            .from('profiles')
            .upsert({
              id: userId,
              email: email,
              display_name: email?.split('@')[0] || 'User',
              role: roleToSet,
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
          
          if (!upsertError) {
            setRole(roleToSet);
          } else {
            console.error('App: Profile upsert error:', upsertError);
            addLog(`fetchProfile: Error upserting profile: ${upsertError.message}`);
            await tryRawProfileFetch();
          }
          setPendingRole(null);
        }
      } catch (err: any) {
        addLog(`fetchProfile: Library Exception/Timeout: ${err.message}`);
        await tryRawProfileFetch();
      }
    } catch (error: any) {
      console.error('App: Profile fetch error:', error);
      addLog(`fetchProfile: Exception: ${error.message}`);
    } finally {
      isFetchingProfileRef.current = false;
    }
  };

  const isFetchingRef = useRef(false);

  // Fetch places
  const fetchPlaces = React.useCallback(async () => {
    if (isFetchingRef.current) {
      addLog('fetchPlaces: Already in progress, skipping');
      return;
    }
    
    isFetchingRef.current = true;
    addLog('fetchPlaces: Starting...');
    
    const tryRawFetch = async () => {
      addLog('fetchPlaces: Attempting Raw API fallback...');
      try {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const res = await fetch(`${url}/rest/v1/admin_places?select=*&order=created_at.desc`, {
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          addLog(`fetchPlaces: Raw API Success (${data.length} items)`);
          setPlaces(data as Place[]);
          return true;
        }
        addLog(`fetchPlaces: Raw API Failed (${res.status})`);
        return false;
      } catch (e: any) {
        addLog(`fetchPlaces: Raw API Exception: ${e.message}`);
        return false;
      }
    };

    try {
      const client = getSupabase();
      if (!client) {
        addLog('fetchPlaces: Client missing, trying raw fetch');
        await tryRawFetch();
        isFetchingRef.current = false;
        return;
      }

      // 5s timeout for the library call, then fallback to raw fetch
      const fetchPromise = client
        .from('admin_places')
        .select('*')
        .order('created_at', { ascending: false });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Library call timed out (5s)')), 5000)
      );

      addLog('fetchPlaces: Awaiting response from Supabase library...');
      try {
        const result = await Promise.race([fetchPromise, timeoutPromise]) as any;
        const { data, error } = result;
        
        if (error) {
          addLog(`fetchPlaces: Library Error ${error.code}: ${error.message}`);
          await tryRawFetch();
        } else if (data) {
          addLog(`fetchPlaces: Library Success (${data.length} items)`);
          setPlaces(data as Place[]);
        }
      } catch (err: any) {
        addLog(`fetchPlaces: Library Exception/Timeout: ${err.message}`);
        await tryRawFetch();
      }
    } catch (error: any) {
      addLog(`fetchPlaces: Global Exception: ${error.message}`);
      await tryRawFetch();
    } finally {
      isFetchingRef.current = false;
    }
  }, [addLog]);

  useEffect(() => {
    if (isConfigMissing) return;

    if (!isFetchingRef.current) {
      fetchPlaces();
    }

    const client = getSupabase();
    if (!client) return;
    // Realtime subscription
    const channel = client
      .channel('admin_places_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_places' }, fetchPlaces)
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [isConfigMissing, fetchPlaces]);

  // Fetch favorites
  useEffect(() => {
    if (!user || isConfigMissing) {
      setFavorites([]);
      return;
    }

    const fetchFavorites = async () => {
      try {
        const client = getSupabase();
        if (!client) return;
        const { data, error } = await client
          .from('favorites')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        
        if (data) setFavorites(data as Favorite[]);
      } catch (error) {
        console.error('Fetch favorites error:', error);
      }
    };

    fetchFavorites();

    const client = getSupabase();
    if (!client) return;
    const channel = client
      .channel('favorites_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'favorites', filter: `user_id=eq.${user.id}` }, fetchFavorites)
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [user, isConfigMissing]);

  const handleLogin = async () => {
    setAuthError('');
    setPendingRole(selectedAuthRole);
    try {
      const client = getSupabase();
      if (!client) return;
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) {
        setAuthError(error.message);
        setPendingRole(null);
      }
    } catch (error: any) {
      setAuthError(error.message);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const client = getSupabase();
      if (!client) return;
      if (authMode === 'signup') {
        setPendingRole(selectedAuthRole);
        const { error } = await client.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
      showToast("Check your email for confirmation!", "info");
      } else {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (error: any) {
      setAuthError(error.message);
      setPendingRole(null);
    }
  };

  const [modalAddress, setModalAddress] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);

  const getAuthHeaders = async () => {
    const client = getSupabase();
    const session = await client?.auth.getSession();
    const accessToken = session?.data?.session?.access_token;

    return {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    } as Record<string, string>;
  };

  const handleModalAddressSearch = async () => {
    const address = modalAddress.trim();
    if (!address) return;

    const cacheKey = getGeocodeCacheKey(address);
    const cached = readCache<{ lat: number; lng: number }>(cacheKey);
    if (cached?.lat && cached?.lng) {
      setNewPlacePos({ lat: cached.lat, lng: cached.lng });
      mapRef.current?.flyTo([cached.lat, cached.lng], 16);
      return;
    }

    setIsGeocoding(true);
    try {
      const response = await fetch('/api/ai/geocode', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        throw new Error('Failed to geocode address');
      }

      const coords = await response.json();
      if (coords.lat && coords.lng) {
        writeCache(cacheKey, { lat: coords.lat, lng: coords.lng }, 1000 * 60 * 60 * 24 * 30);
        setNewPlacePos({ lat: coords.lat, lng: coords.lng });
        mapRef.current?.flyTo([coords.lat, coords.lng], 16);
      }
    } catch (error) {
      console.error('Modal geocoding error:', error);
      showToast("Could not find location for this address.", "error");
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleLogout = async () => {
    console.log('App: handleLogout starting');
    // Force local state clear immediately to ensure UI responsiveness
    const clearLocalState = () => {
      setUser(null);
      setRole(null);
      setActiveTab('map');
      console.log('App: Local state cleared');
    };

    try {
      const client = getSupabase();
      if (client) {
        console.log('App: Calling Supabase signOut');
        // Use a timeout for signOut to prevent hanging
        const signOutPromise = client.auth.signOut();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Sign out timed out')), 10000)
        );
        
        await Promise.race([signOutPromise, timeoutPromise]);
      }
    } catch (error: any) {
      console.error('App: Logout error (ignoring for local state):', error);
      // We don't alert here to avoid blocking the user if the network is flaky
    } finally {
      clearLocalState();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadToR2 = async (file: File): Promise<string | null> => {
    try {
      setUploading(true);

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/storage/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to upload image');
      }

      const data = await response.json();
      return data.publicUrl ?? null;
    } catch (error) {
      console.error('R2 Upload Error:', error);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const closeAddModal = () => {
    setIsAdding(false);
    setNewPlacePos(null);
    setSelectedFile(null);
    setPreviewImage(null);
    setModalAddress('');
    setEditingPlace(null);
  };

  const handleEditPlace = (place: Place) => {
    setEditingPlace(place);
    setNewPlacePos({ lat: place.lat, lng: place.lng });
    setPreviewImage(place.image_url || null);
    setIsAdding(true);
  };

  const handleDeletePlace = async (placeId: string) => {
    setConfirmModal({
      title: "スポットの削除",
      message: "このスポットを削除しますか？この操作は取り消せません。",
      onConfirm: async () => {
        setConfirmModal(null);
        const client = getSupabase();
        if (!client) return;

        try {
          const { error } = await client
            .from('admin_places')
            .delete()
            .eq('id', placeId);

          if (error) throw error;
          showToast("スポットを削除しました。", "success");
          fetchPlaces();
        } catch (error: any) {
          showToast("削除に失敗しました: " + error.message, "error");
        }
      }
    });
  };

  const handleAddPlace = async (e: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting || uploading) {
      addLog('handleAddPlace: Already submitting/uploading, ignoring');
      return;
    }

    addLog('handleAddPlace: Triggered');
    
    if (!user) {
      showToast("ログインが必要です。", "error");
      return;
    }
    if (!newPlacePos) {
      showToast("地図上で場所を選択してください。", "error");
      return;
    }
    if (role !== 'admin') {
      showToast(`権限がありません。現在のロール: ${role}。管理者のみスポットを追加できます。`, "error");
      return;
    }

    setIsSubmitting(true);
    addLog('handleAddPlace: Starting process...');

    const formData = e ? new FormData(e.currentTarget as HTMLFormElement) : new FormData();
    const name = formData.get('name') as string || (document.querySelector('input[name="name"]') as HTMLInputElement)?.value;
    const description = formData.get('description') as string || (document.querySelector('textarea[name="description"]') as HTMLTextAreaElement)?.value;
    const category = (formData.get('category') as any) || (document.querySelector('select[name="category"]') as HTMLSelectElement)?.value || 'その他';
    const website_url = formData.get('website_url') as string || (document.querySelector('input[name="website_url"]') as HTMLInputElement)?.value;

    if (!name) {
      showToast("スポット名を入力してください。", "error");
      setIsSubmitting(false);
      return;
    }

    let image_url = editingPlace?.image_url || '';
    try {
      if (selectedFile) {
        addLog('handleAddPlace: Uploading image...');
        const uploadedUrl = await uploadToR2(selectedFile);
        if (uploadedUrl) {
          image_url = uploadedUrl;
          addLog('handleAddPlace: Image uploaded');
        } else {
          addLog('handleAddPlace: Image upload failed');
          // If confirm is blocked in iframe, we'll just log and proceed without image
          addLog("Image upload failed, proceeding without image");
          showToast("画像のアップロードに失敗しました。画像なしで保存します。", "info");
          // if (!confirm("画像のアップロードに失敗しました。画像なしで保存しますか？")) {
          //   setIsSubmitting(false);
          //   return;
          // }
        }
      }
    } catch (err) {
      console.error('App: Upload process error', err);
    }

    const client = getSupabase();
    if (!client) {
      addLog('handleAddPlace: Client missing');
      showToast("データベースに接続できません。設定を確認してください。", "error");
      setIsSubmitting(false);
      return;
    }

    addLog('handleAddPlace: Processing spot...');
    
    const tryRawUpsert = async (data: any) => {
      addLog('handleAddPlace: Attempting Raw API fallback...');
      try {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const method = editingPlace ? 'PATCH' : 'POST';
        const endpoint = editingPlace ? `${url}/rest/v1/admin_places?id=eq.${editingPlace.id}` : `${url}/rest/v1/admin_places`;
        
        const res = await fetch(endpoint, {
          method,
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(data)
        });
        if (res.ok) {
          addLog('handleAddPlace: Raw API Success');
          return true;
        }
        addLog(`handleAddPlace: Raw API Failed (${res.status})`);
        return false;
      } catch (e: any) {
        addLog(`handleAddPlace: Raw API Exception: ${e.message}`);
        return false;
      }
    };

    try {
      const upsertData: any = {
        name,
        description,
        category,
        lat: newPlacePos.lat,
        lng: newPlacePos.lng,
        website_url: website_url || null,
        image_url: image_url || null,
      };

      if (!editingPlace) {
        upsertData.created_by = user.id;
      }

      addLog(`handleAddPlace: Data: ${name}`);
      
      const clientToUse = getSupabase();
      if (!clientToUse) {
        addLog('handleAddPlace: Client missing, trying raw upsert');
        const success = await tryRawUpsert(upsertData);
        if (success) {
          showToast("スポットを保存しました！(Raw API)", "success");
          closeAddModal();
          fetchPlaces();
        } else {
          showToast("保存に失敗しました。", "error");
        }
        setIsSubmitting(false);
        return;
      }

      const query = editingPlace 
        ? clientToUse.from('admin_places').update(upsertData).eq('id', editingPlace.id)
        : clientToUse.from('admin_places').insert([upsertData]);
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Library upsert timed out (5s)')), 5000)
      );

      addLog('handleAddPlace: Awaiting response from Supabase library...');
      try {
        const result = await Promise.race([query, timeoutPromise]) as any;
        const { error } = result;
        
        if (!error) {
          addLog('handleAddPlace: Library Success');
          showToast("スポットを保存しました！", "success");
          closeAddModal();
          fetchPlaces();
        } else {
          addLog(`handleAddPlace: Library Error ${error.code}: ${error.message}`);
          const success = await tryRawUpsert(upsertData);
          if (success) {
            showToast("スポットを保存しました！(Raw API Fallback)", "success");
            closeAddModal();
            fetchPlaces();
          } else {
            showToast(`保存エラー: ${error.message}`, "error");
          }
        }
      } catch (err: any) {
        addLog(`handleAddPlace: Library Exception/Timeout: ${err.message}`);
        const success = await tryRawUpsert(upsertData);
        if (success) {
          showToast("スポットを保存しました！(Raw API Fallback)", "success");
          closeAddModal();
          fetchPlaces();
        } else {
          showToast(`保存エラー: ${err.message}`, "error");
        }
      }
    } catch (err: any) {
      addLog(`handleAddPlace: Global Exception: ${err.message}`);
      console.error('handleAddPlace exception:', err);
      showToast("予期せぬエラーが発生しました: " + (err.message || JSON.stringify(err)), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleFavorite = async (placeId: string) => {
    if (!user) return;

    const client = getSupabase();
    if (!client) return;
    const existing = favorites.find(f => f.place_id === placeId);
    if (existing) {
      await client
        .from('favorites')
        .delete()
        .eq('id', existing.id);
    } else {
      await client
        .from('favorites')
        .insert({
          user_id: user.id,
          place_id: placeId
        });
    }
  };

  const handleLocationSearch = async () => {
    const scopedFilter = normalizeLocationFilter(activeRegion, locationFilter);
    const fullAddress = buildScopedLocationString(activeRegion, scopedFilter);
    if (!fullAddress) return;

    const cacheKey = getGeocodeCacheKey(fullAddress);
    const cached = readCache<{ lat: number; lng: number }>(cacheKey);
    if (cached?.lat && cached?.lng) {
      mapRef.current?.flyTo([cached.lat, cached.lng], 14);
      setIsFiltering(false);
      return;
    }

    setAiLoading(true);
    try {
      const response = await fetch('/api/ai/geocode', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ address: fullAddress }),
      });

      if (!response.ok) {
        throw new Error('Failed to geocode address');
      }

      const coords = await response.json();
      if (coords.lat && coords.lng) {
        writeCache(cacheKey, { lat: coords.lat, lng: coords.lng }, 1000 * 60 * 60 * 24 * 30);
        mapRef.current?.flyTo([coords.lat, coords.lng], 14);
        setIsFiltering(false);
      }
    } catch (error) {
      console.error('Geocoding error:', error);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiRecommend = async () => {
    setAiLoading(true);
    setAiError('');

    try {
      const locationStr = buildScopedLocationString(activeRegion, locationFilter) || `${activeRegion.country} ${activeRegion.prefecture} ${activeRegion.municipality}`;
      const category = aiTrendCategory || 'general';
      const cacheKey = getAiCacheKey(aiMode, `${selectedRegionKey}:${locationStr}`, category);
      const cached = readCache<AIResults>(cacheKey);
      if (cached) {
        setAiResults(cached);
        setAiLoading(false);
        return;
      }

      const response = await fetch('/api/ai/query', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          mode: aiMode,
          location: locationStr,
          category,
          region: selectedRegionKey,
        }),
      });

      const results = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String((results as any)?.error || 'Failed to fetch AI results'));
      }

      writeCache(cacheKey, results as AIResults, aiMode === 'recommend' ? 1000 * 60 * 60 * 24 * 14 : 1000 * 60 * 60 * 24);
      setAiResults(results as AIResults);
    } catch (error) {
      console.error('AI error:', error);
      setAiResults(null);
      setAiError(error instanceof Error ? error.message : 'Unknown AI error');
    } finally {
      setAiLoading(false);
    }
  };

  const t = UI_TEXT[uiLanguage];

  const filteredPlaces = places.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const isInBounds = (activeTab === 'list' && listFilter === 'all' && mapBounds) 
      ? mapBounds.contains([p.lat, p.lng]) 
      : true;
    
    return matchesSearch && isInBounds;
  });

  const favoritePlaces = places.filter(p => favorites.some(f => f.place_id === p.id));

  const recommendationCards = normalizeRecommendationCards(aiResults, buildScopedLocationString(activeRegion, locationFilter) || `${activeRegion.country} ${activeRegion.prefecture} ${activeRegion.municipality}`);

  if (isConfigMissing) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-2xl space-y-8 text-center border border-stone-100">
          <div className="w-24 h-24 bg-amber-50 rounded-[2rem] flex items-center justify-center mx-auto">
            <AlertCircle className="w-12 h-12 text-amber-500" />
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-black text-stone-900 tracking-tight">設定が必要です</h1>
            <p className="text-stone-500 font-medium leading-relaxed">
              Supabaseの接続設定が見つかりません。AI Studioの左側にある「Settings」メニューから、以下の環境変数を設定してください。
            </p>
          </div>
          <div className="p-6 bg-stone-50 rounded-3xl text-left space-y-3 border border-stone-100">
            <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">必要な環境変数:</p>
            <div className="space-y-2">
              <code className="block text-xs font-mono text-stone-600 bg-white p-3 rounded-xl border border-stone-100">VITE_SUPABASE_URL</code>
              <code className="block text-xs font-mono text-stone-600 bg-white p-3 rounded-xl border border-stone-100">VITE_SUPABASE_ANON_KEY</code>
            </div>
          </div>
          <p className="text-xs text-stone-400 font-medium">
            設定後、アプリが自動的に再読み込みされます。
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Loader2 className="w-8 h-8 text-emerald-600" />
        </motion.div>
      </div>
    );
  }

  // Login Screen
  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-stone-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10 text-center space-y-8 border border-stone-100"
        >
          <div className="flex flex-col items-center gap-6">
            <div className={cn(
              "w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg rotate-3 transition-colors duration-500",
              selectedAuthRole === 'admin' ? "bg-emerald-500 shadow-emerald-500/20" : "bg-blue-500 shadow-blue-500/20"
            )}>
              {selectedAuthRole === 'admin' ? <ShieldCheck className="w-12 h-12 text-white" /> : <MapPin className="w-12 h-12 text-white" />}
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-stone-900">milz</h1>
              <p className="text-stone-500 mt-2 font-medium">
                {selectedAuthRole === 'admin' ? 'Admin Portal' : 'Personal Map Bookmark'}
              </p>
            </div>
          </div>

          {/* Role Selector */}
          <div className="flex p-1 bg-stone-100 rounded-2xl">
            <button 
              onClick={() => setSelectedAuthRole('user')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all",
                selectedAuthRole === 'user' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400 hover:text-stone-600"
              )}
            >
              <UserIcon className="w-4 h-4" />
              User
            </button>
            <button 
              onClick={() => setSelectedAuthRole('admin')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all",
                selectedAuthRole === 'admin' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400 hover:text-stone-600"
              )}
            >
              <ShieldCheck className="w-4 h-4" />
              Admin
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key="email"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4 text-left"
            >
              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                    <input 
                      type="email" 
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full pl-12 pr-4 py-4 bg-stone-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl outline-none transition-all font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                    <input 
                      type="password" 
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-12 pr-4 py-4 bg-stone-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl outline-none transition-all font-medium"
                    />
                  </div>
                </div>

                {authError && (
                  <p className="text-xs text-red-500 font-bold px-1">{authError}</p>
                )}

                <button 
                  type="submit"
                  className={cn(
                    "w-full py-5 text-white rounded-2xl font-bold active:scale-95 transition-all shadow-xl",
                    selectedAuthRole === 'admin' ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20" : "bg-stone-900 hover:bg-stone-800 shadow-stone-900/20"
                  )}
                >
                  {authMode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              </form>

              <div className="flex flex-col gap-2 pt-2">
                <button 
                  onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                  className="text-xs font-bold text-stone-500 hover:text-stone-900 transition-colors"
                >
                  {authMode === 'signin' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="pt-4">
            <p className="text-[10px] text-stone-300 font-bold">
              Powered by milztech
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-stone-900 overflow-hidden">
      {/* Header */}
      <header className="bg-white px-6 pt-6 pb-4 z-[1001] border-b border-stone-100">
        {role === 'admin' && (
          <div className="mb-2 px-2 py-1 bg-emerald-50 text-[8px] font-black text-emerald-600 rounded flex items-center gap-2">
            <ShieldCheck className="w-2 h-2" />
            ADMIN DEBUG MODE ACTIVE
          </div>
        )}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black tracking-tight text-stone-900">milz</h1>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fetchPlaces()}
              className="p-2 hover:bg-stone-100 rounded-xl transition-colors active:scale-95"
              title={t.refreshMap}
            >
              <Loader2 className={cn("w-5 h-5 text-stone-400", isFetchingRef.current && "animate-spin")} />
            </button>
            <div className="flex items-center p-1 bg-stone-100 rounded-xl">
              <button
                onClick={() => setUiLanguage('ja')}
                className={cn("px-3 py-1.5 text-[10px] font-black rounded-lg transition-all", uiLanguage === 'ja' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400")}
              >
                JP
              </button>
              <button
                onClick={() => setUiLanguage('en')}
                className={cn("px-3 py-1.5 text-[10px] font-black rounded-lg transition-all", uiLanguage === 'en' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400")}
              >
                EN
              </button>
            </div>
            <div className="relative">
              <button 
                onClick={() => setActiveTab('profile')}
                className="w-8 h-8 bg-stone-900 rounded-full flex items-center justify-center hover:bg-stone-800 transition-colors active:scale-95"
              >
                <UserIcon className="w-4 h-4 text-white" />
              </button>
              {role === 'admin' && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center">
                  <ShieldCheck className="w-2 h-2 text-white" />
                </div>
              )}
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-stone-100 rounded-xl transition-colors"
            >
              <LogOut className="w-5 h-5 text-stone-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'map' && (
            <motion.div 
              key="map"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full w-full relative"
            >
              {/* Map Controls */}
              <div className="absolute top-6 left-6 right-6 z-[1000] flex flex-col gap-3">
                <div className="flex gap-3">
                  <div className="flex-1 bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-white/20 flex items-center px-4 py-3">
                    <Search className="w-5 h-5 text-stone-400 mr-3" />
                    <input
                      type="text"
                      placeholder={t.searchSpots}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-transparent border-none outline-none text-sm w-full font-medium"
                    />
                  </div>
                  <button
                    onClick={() => setIsFiltering(!isFiltering)}
                    className={cn(
                      "p-4 rounded-2xl shadow-xl border backdrop-blur-md transition-all active:scale-95",
                      isFiltering 
                        ? "bg-stone-900 text-white border-stone-900" 
                        : "bg-white/90 text-stone-900 border-white/20"
                    )}
                  >
                    <MapPinned className="w-5 h-5" />
                  </button>
                </div>

                <AnimatePresence>
                  {isFiltering && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="bg-white/90 backdrop-blur-md rounded-3xl shadow-xl border border-white/20 p-6 space-y-4"
                    >
                      <div className="grid grid-cols-1 gap-3">
                        <input
                          type="text"
                          placeholder="Country"
                          value={locationFilter.country}
                          readOnly
                          className="w-full px-4 py-3 bg-stone-100 border border-stone-100 rounded-2xl text-sm text-stone-500 cursor-not-allowed"
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            type="text"
                            placeholder="State"
                            value={locationFilter.prefecture}
                            readOnly
                            className="w-full px-4 py-3 bg-stone-100 border border-stone-100 rounded-2xl text-sm text-stone-500 cursor-not-allowed"
                          />
                          <input
                            type="text"
                            placeholder={t.cityArea}
                            value={locationFilter.municipality}
                            onChange={(e) => setLocationFilter(prev => ({ ...prev, municipality: e.target.value }))}
                            className="w-full px-4 py-3 bg-stone-50 border border-stone-100 rounded-2xl text-sm focus:outline-none"
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Detailed Address"
                          value={locationFilter.address}
                          onChange={(e) => setLocationFilter(prev => ({ ...prev, address: e.target.value }))}
                          className="w-full px-4 py-3 bg-stone-50 border border-stone-100 rounded-2xl text-sm focus:outline-none"
                        />
                        <button
                          onClick={() => {
                            setLocationFilter(normalizeLocationFilter(activeRegion, { country: activeRegion.country, prefecture: activeRegion.prefecture, municipality: activeRegion.municipality, address: '' }));
                            setIsFiltering(false);
                          }}
                          className="w-full py-3 text-[10px] font-black text-stone-400 hover:text-stone-900 transition-colors"
                        >
                          CLEAR ALL FILTERS
                        </button>
                        <button
                          onClick={handleLocationSearch}
                          disabled={loading}
                          className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black text-xs active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          GO TO LOCATION
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <MapContainer 
                key={selectedRegionKey}
                center={activeRegion.mapCenter} 
                zoom={activeRegion.mapZoom} 
                className={cn(
                  "h-full w-full transition-all duration-700",
                  mapStyle === 'guide_mono' && "guide-map-theme"
                )}
                zoomControl={false}
              >
                <TileLayer
                  attribution={MAP_STYLES[mapStyle]?.attribution || MAP_STYLES.original.attribution}
                  url={MAP_STYLES[mapStyle]?.url || MAP_STYLES.original.url}
                />
                <MapEvents 
                  user={user}
                  role={role}
                  activeTab={activeTab}
                  setNewPlacePos={setNewPlacePos}
                  setIsAdding={setIsAdding}
                  setMapBounds={setMapBounds}
                  mapRef={mapRef}
                />
                
                {filteredPlaces.map((place) => (
                  <Marker 
                    key={place.id} 
                    position={[place.lat, place.lng]}
                    icon={getCustomIcon(place.category, mapStyle)}
                  >
                    <Popup className="custom-popup">
                      <div className="p-3 min-w-[200px] space-y-3">
                        <div className="border-b border-stone-100 pb-2">
                          <h3 className="font-black text-lg text-stone-900 leading-tight">{place.name}</h3>
                          <span className="inline-block px-2 py-0.5 bg-stone-100 rounded text-[10px] font-black text-stone-500 uppercase tracking-widest mt-1">
                            {place.category}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-stone-600 leading-relaxed">{place.description}</p>
                          {place.website_url && (
                            <a 
                              href={place.website_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] font-black text-emerald-600 hover:text-emerald-700 transition-colors uppercase tracking-widest pt-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Visit Website
                            </a>
                          )}
                        </div>
                        {role === 'admin' && (
                          <div className="flex gap-2 pt-2 border-t border-stone-50">
                            <button 
                              onClick={() => handleEditPlace(place)}
                              className="flex-1 py-2 bg-stone-900 text-white text-[10px] font-black rounded-lg uppercase tracking-widest flex items-center justify-center gap-1"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                            <button 
                              onClick={() => handleDeletePlace(place.id)}
                              className="flex-1 py-2 bg-rose-50 text-rose-500 text-[10px] font-black rounded-lg uppercase tracking-widest flex items-center justify-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}

                {newPlacePos && (
                  <Marker 
                    position={[newPlacePos.lat, newPlacePos.lng]} 
                    icon={L.divIcon({
                      html: renderToStaticMarkup(
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center border-4 shadow-xl animate-bounce",
                          false 
                            ? "bg-black border-black" 
                            : "bg-emerald-500 border-white"
                        )}>
                          <Plus size={24} color="white" strokeWidth={4} />
                        </div>
                      ),
                      className: 'custom-div-icon',
                      iconSize: [40, 40],
                      iconAnchor: [20, 20]
                    })}
                  />
                )}
              </MapContainer>
            </motion.div>
          )}

          {activeTab === 'list' && (
            <motion.div 
              key="list"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="h-full overflow-y-auto p-6 space-y-6 bg-stone-50"
            >
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input 
                  type="text" 
                  placeholder={t.searchSpots}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-stone-100 rounded-2xl text-sm font-medium shadow-sm focus:ring-2 focus:ring-stone-200 outline-none transition-all"
                />
              </div>

              <div className="flex items-center gap-2 p-1 bg-white rounded-2xl shadow-sm border border-stone-100">
                <button 
                  onClick={() => setListFilter('all')}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-xs font-black transition-all",
                    listFilter === 'all' ? "bg-stone-900 text-white" : "text-stone-400"
                  )}
                >
                  {t.allSpots.toUpperCase()}
                </button>
                <button 
                  onClick={() => setListFilter('favorites')}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-xs font-black transition-all",
                    listFilter === 'favorites' ? "bg-stone-900 text-white" : "text-stone-400"
                  )}
                >
                  {t.favorites.toUpperCase()}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {(listFilter === 'all' ? filteredPlaces : favoritePlaces).map((place) => (
                  <motion.div 
                    layout
                    key={place.id}
                    className="bg-white p-4 rounded-3xl shadow-sm border border-stone-100 group"
                  >
                    <div className="flex gap-4">
                      <div className={cn(
                        "w-16 h-16 rounded-2xl flex items-center justify-center shrink-0",
                        place.category === 'restaurant' ? "bg-orange-50 text-orange-500" :
                        place.category === 'shop' ? "bg-blue-50 text-blue-500" : "bg-stone-50 text-stone-500"
                      )}>
                        {place.image_url ? (
                          <img src={place.image_url} className="w-full h-full object-cover rounded-2xl" />
                        ) : (
                          place.category === 'restaurant' ? <Utensils className="w-6 h-6" /> :
                          place.category === 'shop' ? <ShoppingBag className="w-6 h-6" /> : <MapPin className="w-6 h-6" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <h3 className="font-black text-stone-900 truncate">{place.name}</h3>
                          <button 
                            onClick={() => handleToggleFavorite(place.id)}
                            className={cn(
                              "p-2 rounded-xl transition-all",
                              favorites.some(f => f.place_id === place.id) ? "bg-red-50 text-red-500" : "hover:bg-stone-50 text-stone-300"
                            )}
                          >
                            <Heart className={cn("w-4 h-4", favorites.some(f => f.place_id === place.id) && "fill-current")} />
                          </button>
                        </div>
                        <p className="text-xs text-stone-500 line-clamp-2 mt-1">{place.description}</p>
                        <div className="flex items-center gap-3 mt-4">
                          <button 
                            onClick={() => {
                              setActiveTab('map');
                              setTimeout(() => mapRef.current?.flyTo([place.lat, place.lng], 16), 100);
                            }}
                            className="flex items-center gap-1 text-[10px] font-black text-stone-400 hover:text-stone-900 transition-colors"
                          >
                            <Navigation className="w-3 h-3" />
                            VIEW ON MAP
                          </button>
                          {place.website_url && (
                            <a 
                              href={place.website_url} 
                              target="_blank" 
                              className="flex items-center gap-1 text-[10px] font-black text-stone-400 hover:text-stone-900 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              WEBSITE
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'ai' && (
            <motion.div 
              key="ai"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="h-full overflow-y-auto p-6 space-y-8 bg-stone-50"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-black text-stone-900 flex items-center gap-3">
                  {t.aiTitle}
                  <Sparkles className="w-6 h-6 text-emerald-500" />
                </h2>
              </div>

              {/* {t.locationFilter}s */}
              <div className="bg-white p-6 rounded-[2rem] border border-stone-100 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-stone-400 mb-2">
                  <MapPinned className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">{t.locationFilter}</span>
                </div>
                <p className="text-xs text-stone-400">{t.locationNote}</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-1 gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">{t.region}</span>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(REGION_PRESETS) as RegionKey[]).map((regionKey) => (
                        <button
                          key={regionKey}
                          onClick={() => setSelectedRegionKey(regionKey)}
                          className={cn(
                            'px-4 py-3 rounded-2xl text-sm font-black border transition-all',
                            selectedRegionKey === regionKey ? 'bg-stone-900 text-white border-stone-900' : 'bg-stone-50 text-stone-500 border-stone-100'
                          )}
                        >
                          {REGION_PRESETS[regionKey].name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    placeholder="Country"
                    value={locationFilter.country}
                    readOnly
                    className="w-full px-4 py-3 bg-stone-100 border border-stone-100 rounded-2xl text-sm text-stone-500 cursor-not-allowed"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="State"
                      value={locationFilter.prefecture}
                      readOnly
                      className="w-full px-4 py-3 bg-stone-100 border border-stone-100 rounded-2xl text-sm text-stone-500 cursor-not-allowed"
                    />
                    <input
                      type="text"
                      placeholder={t.cityArea}
                      value={locationFilter.municipality}
                      onChange={(e) => setLocationFilter(prev => ({ ...prev, municipality: e.target.value }))}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/5"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder={t.addressOptional}
                    value={locationFilter.address}
                    onChange={(e) => setLocationFilter(prev => ({ ...prev, address: e.target.value }))}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/5"
                  />
                </div>
              </div>

              {/* Mode Switcher */}
              <div className="flex p-1 bg-stone-100 rounded-2xl">
                <button
                  onClick={() => setAiMode('recommend')}
                  className={cn(
                    "flex-1 py-3 text-xs font-black rounded-xl transition-all",
                    aiMode === 'recommend' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400"
                  )}
                >
                  {t.recommend}
                </button>
                <button
                  onClick={() => setAiMode('trend')}
                  className={cn(
                    "flex-1 py-3 text-xs font-black rounded-xl transition-all",
                    aiMode === 'trend' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400"
                  )}
                >
                  {t.trends}
                </button>
              </div>

              {aiMode === 'trend' && (
                <div className="space-y-4">
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {['all', ...Object.keys(CATEGORY_CONFIG)].map(cat => (
                      <button
                        key={cat}
                        onClick={() => setAiTrendCategory(cat)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all",
                          aiTrendCategory === cat ? "bg-stone-900 text-white" : "bg-white text-stone-400 border border-stone-100"
                        )}
                      >
                        {cat.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={handleAiRecommend}
                disabled={aiLoading}
                className="w-full p-6 bg-stone-900 text-white rounded-[2rem] font-black flex items-center justify-center gap-3 shadow-xl shadow-stone-900/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
                {aiMode === 'recommend' ? t.getRecommendations : t.getTrends}
              </button>

              {aiError && (
                <div className="rounded-3xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <span>{t.aiErrorPrefix}: {aiError}</span>
                  </div>
                </div>
              )}

              {aiResults && (
                <div className="space-y-8">
                  {aiMode === 'recommend' && recommendationCards.length > 0 && (
                    <section className="space-y-4">
                      <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest">{t.recommendedSpots}</h3>
                      <div className="grid grid-cols-1 gap-4">
                        {recommendationCards.map((rec, i) => (
                          <div key={i} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm">
                            <div className="flex items-start justify-between mb-2">
                              <h4 className="font-black text-stone-900">{uiLanguage === 'ja' ? (rec.name_ja || rec.name_en) : (rec.name_en || rec.name_ja)}</h4>
                              <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg uppercase">
                                {rec.category}
                              </span>
                            </div>
                            <p className="text-sm text-stone-500 leading-relaxed">{uiLanguage === 'ja' ? (rec.reason_ja || rec.reason_en) : (rec.reason_en || rec.reason_ja)}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {aiMode === 'trend' && aiResults.trends && (
                    <section className="space-y-4">
                      <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest">{t.localTrends}</h3>
                      <div className="grid grid-cols-1 gap-4">
                        {aiResults.trends.map((trend, i) => (
                          <div key={i} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm">
                            <div className="flex items-start justify-between mb-2 gap-3">
                              <div className="flex items-start gap-2">
                                <TrendingUp className="w-4 h-4 text-emerald-500 mt-0.5" />
                                <div>
                                  <h4 className="font-black text-stone-900">
                                    {uiLanguage === 'ja' ? (trend.topic_ja || trend.keyword_ja) : (trend.topic_en || trend.keyword_en)}
                                  </h4>
                                  <p className="mt-1 text-xs font-semibold text-stone-500">
                                    {uiLanguage === 'ja' ? trend.topic_ja : trend.topic_en}
                                  </p>
                                </div>
                              </div>
                              <span className="text-[10px] font-black bg-stone-50 text-stone-500 px-2 py-1 rounded-lg uppercase whitespace-nowrap">
                                {trend.category}
                              </span>
                            </div>
                            <p className="text-sm text-stone-500 leading-relaxed">
                              {uiLanguage === 'ja' ? trend.description_ja : trend.description_en}
                            </p>
                            <div className="mt-4 flex items-center gap-2">
                              <div className="flex-1 h-1 bg-stone-100 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-emerald-500" 
                                  style={{ width: `${trend.popularity}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-black text-stone-400">{trend.popularity}%</span>
                            </div>
                            {trend.source_url && (
                              <a
                                href={trend.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex items-center gap-2 text-xs font-black text-stone-500 hover:text-stone-900"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {t.source}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="h-full overflow-y-auto p-6 pb-40 space-y-8 bg-stone-50 relative z-10"
            >
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-stone-100 text-center space-y-6">
                <div className="relative inline-block">
                  <div className="w-24 h-24 bg-stone-900 rounded-[2rem] flex items-center justify-center mx-auto shadow-xl">
                    <UserIcon className="w-10 h-10 text-white" />
                  </div>
                  {role === 'admin' && (
                    <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-500 rounded-2xl border-4 border-white flex items-center justify-center shadow-lg">
                      <ShieldCheck className="w-5 h-5 text-white" />
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-black text-stone-900">{user.email?.split('@')[0]}</h2>
                  <p className="text-stone-400 font-medium">{user.email}</p>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                    role === 'admin' ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
                  )}>
                    {role === 'admin' ? 'ADMIN' : 'PERSONAL'}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-stone-400 bg-stone-100 p-2 rounded-lg break-all">
                  ID: {user.id}<br/>
                  Role: {role || 'none'}
                </div>

                <div className="space-y-4 text-left">
                  <div className="flex items-center gap-2 px-1">
                    <Globe className="w-4 h-4 text-stone-400" />
                    <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">{t.mapStyleSettings}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(Object.keys(MAP_STYLES) as Array<keyof typeof MAP_STYLES>).map((styleKey) => (
                      <button
                        key={styleKey}
                        onClick={() => setMapStyle(styleKey)}
                        className={cn(
                          "p-4 rounded-2xl border-2 transition-all text-left space-y-1",
                          mapStyle === styleKey 
                            ? "border-stone-900 bg-stone-900 text-white shadow-lg" 
                            : "border-stone-100 bg-white text-stone-900 hover:border-stone-200"
                        )}
                      >
                        <div className="font-black text-xs uppercase tracking-tighter">{styleKey === 'original' ? t.original : t.guide}</div>
                        <div className={cn(
                          "text-[9px] font-medium leading-tight",
                          mapStyle === styleKey ? "text-stone-400" : "text-stone-400"
                        )}>
                          {MAP_STYLES[styleKey].description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 space-y-2">
                  <button
                    onClick={handleLogout}
                    className="w-full py-3 text-xs font-black text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-widest border border-rose-100 rounded-xl"
                  >
                    {t.signOut}
                  </button>
                  <button
                    onClick={async () => {
                      addLog('Manual Connection Test: Starting...');
                      const diag = await testSupabaseConnection();
                      if (diag.success) {
                        addLog(`Manual Connection Test: Success (${diag.message})`);
                        showToast(`接続成功! (${diag.message})`, "success");
                      } else {
                        addLog(`Manual Connection Test: Failed (${diag.message})`);
                        console.error('Connection Test Failed:', diag);
                        let msg = `接続失敗: ${diag.message}`;
                        if (diag.details) msg += `\n詳細: ${diag.details}`;
                        
                        if (diag.isTimeout) {
                          msg += `\n\n【考えられる原因】\n1. Supabaseプロジェクトが「Paused (停止中)」になっている（ダッシュボードでRestoreしてください）\n2. ネットワーク環境（VPNや社内LAN）で通信が遮断されている\n3. URLが間違っている（https://[ID].supabase.co である必要があります）`;
                        }
                        
                        // Check for common URL errors
                        const url = import.meta.env.VITE_SUPABASE_URL || '';
                        if (url.includes('supabase.com/dashboard')) {
                          msg += `\n\n⚠️ 注意: URLにダッシュボードのURLが設定されています。API URLを設定してください。`;
                        } else if (!url.startsWith('https://')) {
                          msg += `\n\n⚠️ 注意: URLは https:// で始まる必要があります。`;
                        }
                        
                        showToast(msg, "error");
                      }
                    }}
                    className="w-full py-3 text-[10px] font-black text-emerald-600 hover:text-emerald-700 transition-colors uppercase tracking-widest bg-emerald-50 rounded-xl"
                  >
                    Test DB Connection
                  </button>
                  <button
                    onClick={async () => {
                      addLog('Raw Fetch Test: Starting...');
                      try {
                        const url = import.meta.env.VITE_SUPABASE_URL;
                        const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
                        const res = await fetch(`${url}/rest/v1/admin_places?select=*`, {
                          headers: {
                            'apikey': key,
                            'Authorization': `Bearer ${key}`
                          }
                        });
                        if (res.ok) {
                          const data = await res.json();
                          addLog(`Raw Fetch Test: Success (${data.length} items)`);
                          setPlaces(data);
                          showToast(`Raw Fetch成功: ${data.length}件`, "success");
                        } else {
                          const err = await res.text();
                          addLog(`Raw Fetch Test: Failed (${res.status})`);
                          showToast(`Raw Fetch失敗: ${res.status}`, "error");
                        }
                      } catch (e: any) {
                        addLog(`Raw Fetch Test: Exception: ${e.message}`);
                        showToast(`Raw Fetchエラー: ${e.message}`, "error");
                      }
                    }}
                    className="w-full py-3 text-[10px] font-black text-blue-600 hover:text-blue-700 transition-colors uppercase tracking-widest bg-blue-50 rounded-xl"
                  >
                    Debug: Fetch with Raw API
                  </button>
                  <button
                    onClick={async () => {
                      addLog('Manual Reset: Resetting client...');
                      resetSupabaseClient();
                      addLog('Manual Reset: Client recreated. Retrying fetch...');
                      fetchPlaces();
                      showToast("再初期化しました。", "info");
                    }}
                    className="w-full py-3 text-[10px] font-black text-amber-600 hover:text-amber-700 transition-colors uppercase tracking-widest bg-amber-50 rounded-xl"
                  >
                    Reset & Reconnect
                  </button>
                  <button
                    onClick={() => {
                      localStorage.clear();
                      sessionStorage.clear();
                      addLog('Manual Reset: Storage cleared. Reloading...');
                      showToast("キャッシュをクリアしました。", "info");
                      window.location.reload();
                    }}
                    className="w-full py-3 text-[10px] font-black text-rose-600 hover:text-rose-700 transition-colors uppercase tracking-widest bg-rose-50 rounded-xl"
                  >
                    Clear Cache & Session
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="w-full py-3 text-[10px] font-black text-stone-600 hover:text-stone-700 transition-colors uppercase tracking-widest bg-stone-100 rounded-xl"
                  >
                    Refresh Application
                  </button>
                  <button
                    onClick={() => setShowSqlModal(true)}
                    className="w-full py-3 text-[10px] font-black text-stone-600 hover:text-stone-700 transition-colors uppercase tracking-widest bg-stone-100 rounded-xl"
                  >
                    View SQL Setup Script
                  </button>
                  <button
                    onClick={() => setShowConfigModal(true)}
                    className="w-full py-3 text-[10px] font-black text-stone-600 hover:text-stone-700 transition-colors uppercase tracking-widest bg-stone-100 rounded-xl"
                  >
                    Check Config URL & Key
                  </button>

                  {/* Debug Logs Section */}
                  <div className="pt-6 border-t border-stone-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Debug Logs</h3>
                      <button 
                        onClick={() => setDebugLogs([])}
                        className="text-[10px] font-black text-stone-400 hover:text-stone-600 uppercase"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="bg-stone-900 rounded-2xl p-4 h-40 overflow-y-auto font-mono text-[10px] text-emerald-400 space-y-1 text-left">
                      {debugLogs.length === 0 ? (
                        <div className="text-stone-600 italic">No logs yet...</div>
                      ) : (
                        debugLogs.map((log, i) => (
                          <div key={i} className="border-b border-stone-800 pb-1 last:border-0">
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      console.log('App: Manual Role Refresh');
                      fetchProfile(user.id, user.email);
                    }}
                    className="w-full py-3 text-[10px] font-black text-stone-400 hover:text-stone-600 transition-colors uppercase tracking-widest"
                  >
                    Refresh Permissions
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest px-2">Stats</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm">
                    <p className="text-2xl font-black text-stone-900">{favorites.length}</p>
                    <p className="text-[10px] font-black text-stone-400 uppercase">Favorites</p>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm">
                    <p className="text-2xl font-black text-stone-900">{places.length}</p>
                    <p className="text-[10px] font-black text-stone-400 uppercase">Global Spots</p>
                  </div>
                </div>
              </div>

              <div className="pt-8 text-center">
                <p className="text-[10px] text-stone-300 font-bold uppercase tracking-widest">
                  Powered by milztech
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Action Button (Admin Only) */}
        {role === 'admin' && activeTab === 'map' && (
          <button 
            onClick={() => isAdding ? closeAddModal() : setIsAdding(true)}
            className="absolute bottom-8 right-8 w-16 h-16 bg-stone-900 text-white rounded-2xl shadow-2xl flex items-center justify-center z-[1001] active:scale-95 transition-all"
          >
            {isAdding ? <X className="w-8 h-8" /> : <Plus className="w-8 h-8" />}
          </button>
        )}
      </main>

      {/* Navigation */}
      <nav className="bg-white border-t border-stone-100 px-6 py-4 flex items-center justify-between z-[1001]">
        <button 
          onClick={() => setActiveTab('map')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all",
            activeTab === 'map' ? "text-stone-900" : "text-stone-300"
          )}
        >
          <MapIcon className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-tighter">Map</span>
        </button>
        <button 
          onClick={() => setActiveTab('list')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all",
            activeTab === 'list' ? "text-stone-900" : "text-stone-300"
          )}
        >
          <ListIcon className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-tighter">List</span>
        </button>
        <button 
          onClick={() => setActiveTab('ai')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all",
            activeTab === 'ai' ? "text-stone-900" : "text-stone-300"
          )}
        >
          <Sparkles className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-tighter">AI</span>
        </button>
        <button 
          onClick={() => setActiveTab('profile')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all",
            activeTab === 'profile' ? "text-stone-900" : "text-stone-300"
          )}
        >
          <UserIcon className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-tighter">Me</span>
        </button>
      </nav>

      {/* Add Spot Modal */}
      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-[2000] flex items-end sm:items-center justify-center p-4"
          >
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 space-y-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-stone-900">
                  {editingPlace ? 'Edit Spot' : 'Add New Spot'}
                </h2>
                <button onClick={closeAddModal} className="p-2 hover:bg-stone-100 rounded-xl">
                  <X className="w-6 h-6 text-stone-400" />
                </button>
              </div>

              {!newPlacePos ? (
                <div className="space-y-6">
                  <div className="p-8 border-2 border-dashed border-stone-100 rounded-3xl text-center space-y-4">
                    <div className="w-16 h-16 bg-stone-50 rounded-2xl flex items-center justify-center mx-auto">
                      <MapPinned className="w-8 h-8 text-stone-300" />
                    </div>
                    <p className="text-stone-500 font-medium">Tap anywhere on the map to set the location.</p>
                  </div>

                  <div className="relative flex items-center">
                    <div className="flex-1 h-px bg-stone-100"></div>
                    <span className="px-4 text-[10px] font-black text-stone-300 uppercase tracking-widest">OR</span>
                    <div className="flex-1 h-px bg-stone-100"></div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Enter Address</label>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={modalAddress}
                          onChange={(e) => setModalAddress(e.target.value)}
                          placeholder="e.g. 1-1-1 Shiba-koen, Minato-ku, Tokyo"
                          className="flex-1 px-6 py-4 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                          onKeyDown={(e) => e.key === 'Enter' && handleModalAddressSearch()}
                        />
                        <button
                          onClick={handleModalAddressSearch}
                          disabled={isGeocoding}
                          className="px-6 bg-stone-900 text-white rounded-2xl font-black text-xs active:scale-95 transition-all disabled:opacity-50"
                        >
                          {isGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={closeAddModal}
                    className="w-full py-4 text-[10px] font-black text-stone-400 hover:text-stone-900 transition-colors"
                  >
                    CANCEL
                  </button>
                </div>
              ) : (
                <form onSubmit={handleAddPlace} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Spot Name</label>
                      <input 
                        name="name"
                        required
                        defaultValue={editingPlace?.name}
                        placeholder="e.g. Blue Bottle Coffee"
                        className="w-full px-6 py-4 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Photo</label>
                      <div className="flex items-center gap-4">
                        <div className="relative w-24 h-24 bg-stone-50 rounded-2xl overflow-hidden border-2 border-stone-100 flex items-center justify-center">
                          {previewImage ? (
                            <img src={previewImage} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="w-8 h-8 text-stone-200" />
                          )}
                          <input 
                            type="file" 
                            accept="image/*"
                            onChange={handleFileChange}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </div>
                        <div className="flex-1 text-xs text-stone-400 font-medium">
                          Upload a photo of the spot. Images are stored on Cloudflare R2 for maximum performance.
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Category</label>
                        <select 
                          name="category"
                          defaultValue={editingPlace?.category || 'その他'}
                          className="w-full px-6 py-4 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium appearance-none"
                        >
                          {Object.keys(CATEGORY_CONFIG).map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Website (Optional)</label>
                        <input 
                          name="website_url"
                          defaultValue={editingPlace?.website_url || ''}
                          placeholder="https://..."
                          className="w-full px-6 py-4 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Description</label>
                      <textarea 
                        name="description"
                        rows={3}
                        defaultValue={editingPlace?.description || ''}
                        placeholder="What's special about this place?"
                        className="w-full px-6 py-4 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium resize-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <button 
                      type="submit"
                      disabled={isSubmitting || uploading}
                      className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-black shadow-xl shadow-emerald-600/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {(isSubmitting || uploading) ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin" />
                          SAVING...
                        </>
                      ) : (editingPlace ? 'UPDATE SPOT' : 'SAVE SPOT')}
                    </button>
                    {!editingPlace && (
                      <button 
                        type="button"
                        onClick={() => setNewPlacePos(null)}
                        className="w-full py-3 text-[10px] font-black text-stone-400 hover:text-stone-900 transition-colors uppercase tracking-widest"
                      >
                        Change Location
                      </button>
                    )}
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Config Check Modal */}
      <AnimatePresence>
        {showConfigModal && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-stone-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                <h2 className="text-xl font-black text-stone-900 uppercase tracking-tight">Supabase Config</h2>
                <button 
                  onClick={() => setShowConfigModal(false)}
                  className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-stone-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Supabase URL</label>
                    <div className="flex gap-2">
                      <div className="flex-1 p-4 bg-stone-50 rounded-2xl font-mono text-xs break-all text-stone-600">
                        {import.meta.env.VITE_SUPABASE_URL || 'MISSING'}
                      </div>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(import.meta.env.VITE_SUPABASE_URL || '');
                          showToast('URLをコピーしました', "success");
                        }}
                        className="p-4 bg-stone-100 rounded-2xl hover:bg-stone-200 transition-colors"
                      >
                        <Copy className="w-4 h-4 text-stone-600" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Anon Key (Publishable)</label>
                    <div className="p-4 bg-stone-50 rounded-2xl font-mono text-xs break-all text-stone-600">
                      {import.meta.env.VITE_SUPABASE_ANON_KEY ? 
                        (import.meta.env.VITE_SUPABASE_ANON_KEY.substring(0, 10) + '...' + import.meta.env.VITE_SUPABASE_ANON_KEY.substring(import.meta.env.VITE_SUPABASE_ANON_KEY.length - 10)) : 
                        'MISSING'}
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex gap-3">
                  <Info className="w-5 h-5 text-blue-600 shrink-0" />
                  <div className="text-[10px] text-blue-800 leading-relaxed font-medium">
                    URLは "https://[PROJECT_ID].supabase.co"、<br/>
                    Keyは "eyJ..." で始まる長い文字列である必要があります。
                  </div>
                </div>
              </div>
              
              <div className="p-6 bg-stone-50 border-t border-stone-100">
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-stone-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SQL Setup Modal */}
      <AnimatePresence>
        {showSqlModal && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-stone-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black text-stone-900 uppercase tracking-tight">Supabase SQL Setup</h2>
                  <p className="text-xs text-stone-500 mt-1 uppercase tracking-widest font-bold">Paste this into Supabase SQL Editor</p>
                </div>
                <button 
                  onClick={() => setShowSqlModal(false)}
                  className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-stone-400" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto bg-stone-50">
                <div className="bg-stone-900 rounded-2xl p-6 relative group">
                  <pre className="text-[10px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`-- 1. 拡張機能の有効化
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. プロフィールテーブルの作成
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. スポットテーブルの作成
CREATE TABLE IF NOT EXISTS admin_places (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  country TEXT,
  prefecture TEXT,
  municipality TEXT,
  address TEXT,
  website_url TEXT,
  image_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. お気に入りテーブルの作成
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  place_id UUID REFERENCES admin_places(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, place_id)
);

-- 5. RLSの有効化
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- 6. ポリシーの作成 (profiles)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 7. ポリシーの作成 (admin_places)
DROP POLICY IF EXISTS "Allow public read access" ON admin_places;
CREATE POLICY "Allow public read access" ON admin_places FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert" ON admin_places;
CREATE POLICY "Allow authenticated insert" ON admin_places FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Allow owners to update" ON admin_places;
CREATE POLICY "Allow owners to update" ON admin_places FOR UPDATE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Allow owners to delete" ON admin_places;
CREATE POLICY "Allow owners to delete" ON admin_places FOR DELETE USING (auth.uid() = created_by);

-- 8. ポリシーの作成 (favorites)
DROP POLICY IF EXISTS "Users can view own favorites" ON favorites;
CREATE POLICY "Users can view own favorites" ON favorites FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own favorites" ON favorites;
CREATE POLICY "Users can insert own favorites" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own favorites" ON favorites;
CREATE POLICY "Users can delete own favorites" ON favorites FOR DELETE USING (auth.uid() = user_id);`}
                  </pre>
                  <button
                    onClick={() => {
                      const text = `-- 1. 拡張機能の有効化
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. プロフィールテーブルの作成
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. スポットテーブルの作成
CREATE TABLE IF NOT EXISTS admin_places (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  country TEXT,
  prefecture TEXT,
  municipality TEXT,
  address TEXT,
  website_url TEXT,
  image_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. お気に入りテーブルの作成
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  place_id UUID REFERENCES admin_places(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, place_id)
);

-- 5. RLSの有効化
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- 6. ポリシーの作成 (profiles)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 7. ポリシーの作成 (admin_places)
DROP POLICY IF EXISTS "Allow public read access" ON admin_places;
CREATE POLICY "Allow public read access" ON admin_places FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert" ON admin_places;
CREATE POLICY "Allow authenticated insert" ON admin_places FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Allow owners to update" ON admin_places;
CREATE POLICY "Allow owners to update" ON admin_places FOR UPDATE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Allow owners to delete" ON admin_places;
CREATE POLICY "Allow owners to delete" ON admin_places FOR DELETE USING (auth.uid() = created_by);

-- 8. ポリシーの作成 (favorites)
DROP POLICY IF EXISTS "Users can view own favorites" ON favorites;
CREATE POLICY "Users can view own favorites" ON favorites FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own favorites" ON favorites;
CREATE POLICY "Users can insert own favorites" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own favorites" ON favorites;
CREATE POLICY "Users can delete own favorites" ON favorites FOR DELETE USING (auth.uid() = user_id);`;
                      navigator.clipboard.writeText(text).then(() => {
                        showToast('コピーしました！', "success");
                      }).catch(() => {
                        showToast('コピーに失敗しました。', "error");
                      });
                    }}
                    className="absolute top-4 right-4 p-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Copy
                  </button>
                </div>
                
                <div className="mt-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                  <div className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <div className="text-xs text-amber-800 leading-relaxed">
                      <p className="font-black uppercase tracking-tight mb-1">Important Note</p>
                      <p>もし既にテーブルを作成済みの場合は、一度テーブルを削除（DROP TABLE admin_places;）してから再実行するか、不足しているカラムを追加してください。</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-6 bg-stone-50 border-t border-stone-100">
                <button
                  onClick={() => setShowSqlModal(false)}
                  className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-stone-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* Custom Toast */}
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[3000] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[280px] backdrop-blur-xl border"
            style={{
              backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.9)' : 
                               toast.type === 'error' ? 'rgba(244, 63, 94, 0.9)' : 
                               'rgba(31, 41, 55, 0.9)',
              borderColor: toast.type === 'success' ? 'rgba(255, 255, 255, 0.2)' : 
                           toast.type === 'error' ? 'rgba(255, 255, 255, 0.2)' : 
                           'rgba(255, 255, 255, 0.1)',
              color: 'white'
            }}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5" />}
            {toast.type === 'info' && <Info className="w-5 h-5" />}
            <span className="text-sm font-black tracking-tight">{toast.message}</span>
          </motion.div>
        )}

        {/* Custom Confirm Modal */}
        {confirmModal && (
          <div className="fixed inset-0 z-[4000] flex items-center justify-center p-6 backdrop-blur-sm bg-black/40">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden border border-stone-100"
            >
              <div className="p-8 text-center space-y-4">
                <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto">
                  <AlertCircle className="w-8 h-8 text-rose-500" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-stone-900">{confirmModal.title}</h3>
                  <p className="mt-2 text-sm text-stone-500 leading-relaxed">{confirmModal.message}</p>
                </div>
              </div>
              <div className="p-6 bg-stone-50 flex gap-3">
                <button
                  onClick={() => {
                    if (confirmModal.onCancel) confirmModal.onCancel();
                    setConfirmModal(null);
                  }}
                  className="flex-1 py-4 bg-white text-stone-900 rounded-2xl font-black uppercase tracking-widest text-xs border border-stone-200 hover:bg-stone-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmModal.onConfirm}
                  className="flex-1 py-4 bg-rose-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-rose-600 shadow-lg shadow-rose-200 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

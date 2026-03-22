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

const AI_CACHE_PREFIX = 'milz_ai_cache_v21';
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
  lat?: number;
  lng?: number;
};

type AiFavorite = {
  id: string;
  type: 'recommend' | 'trend';
  title: string;
  subtitle?: string;
  description: string;
  locationLabel: string;
  lat?: number;
  lng?: number;
  source_url?: string;
  created_at: string;
};

type AIMapPin = {
  id: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  category?: string;
};

function curatedRecommendationFallback(location: string): RecommendationCard[] {
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
      lat: Number(rec?.lat),
      lng: Number(rec?.lng),
    }))
    .filter((rec) => rec.name_ja || rec.name_en)
    .map((rec) => ({
      ...rec,
      reason_ja: rec.reason_ja || rec.reason_en || 'このエリアで立ち寄りやすいおすすめ候補です。',
      reason_en: rec.reason_en || rec.reason_ja || 'A practical recommendation for this area.',
    }));

  if (mapped.length >= 10) return mapped.slice(0, 10);

  const fallback = curatedRecommendationFallback(location);
  const seen = new Set(mapped.map((rec) => (rec.name_en || rec.name_ja).toLowerCase()));
  for (const rec of fallback) {
    const key = (rec.name_en || rec.name_ja).toLowerCase();
    if (seen.has(key)) continue;
    mapped.push(rec);
    seen.add(key);
    if (mapped.length >= 10) break;
  }
  return mapped.slice(0, 10);
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
    country: 'アメリカ',
    prefecture: 'ニューヨーク州',
    municipality: 'マンハッタン',
    mapCenter: [40.7831, -73.9712] as [number, number],
    mapZoom: 12,
    lockCountry: true,
    lockPrefecture: true,
  },
  tokyo: {
    key: 'tokyo',
    name: 'Tokyo',
    country: '日本',
    prefecture: '東京都',
    municipality: '渋谷',
    mapCenter: [35.6595, 139.7005] as [number, number],
    mapZoom: 12,
    lockCountry: true,
    lockPrefecture: true,
  },
  kyoto: {
    key: 'kyoto',
    name: 'Kyoto',
    country: '日本',
    prefecture: '京都府',
    municipality: '東山',
    mapCenter: [35.0037, 135.7788] as [number, number],
    mapZoom: 12,
    lockCountry: true,
    lockPrefecture: true,
  },
  korea: {
    key: 'korea',
    name: 'Seoul',
    country: '韓国',
    prefecture: 'ソウル特別市',
    municipality: '中区',
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
    region: '地域',
    countryLabel: '国',
    prefectureLabel: '都道府県 / 州',
    cityArea: '市区町村 / エリア',
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
    region: '地域',
    cityArea: '市区町村 / エリア',
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
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
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
  const [aiMapPin, setAiMapPin] = useState<AIMapPin | null>(null);

  useEffect(() => {
    setLocationFilter(normalizeLocationFilter(activeRegion, {
      country: activeRegion.country,
      prefecture: activeRegion.prefecture,
      municipality: activeRegion.municipality,
      address: '',
    }));
    setAiResults(null);
    setAiError('');
    setSelectedPlace(null);
    setAiMapPin(null);
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

  const openPlaceDetail = React.useCallback((place: Place) => {
    setSelectedPlace(place);
  }, []);

  const closePlaceDetail = React.useCallback(() => {
    setSelectedPlace(null);
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
  const [aiFavorites, setAiFavorites] = useState<AiFavorite[]>(() => {
    try {
      const raw = localStorage.getItem('milz_ai_saved_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
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

  useEffect(() => {
    try {
      localStorage.setItem('milz_ai_saved_v1', JSON.stringify(aiFavorites));
    } catch {}
  }, [aiFavorites]);

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
          if (selectedPlace?.id === placeId) setSelectedPlace(null);
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


  const isAiFavoriteSaved = (id: string) => aiFavorites.some((item) => item.id === id);

  const toggleAiFavorite = (item: AiFavorite) => {
    setAiFavorites((current) => current.some((entry) => entry.id === item.id)
      ? current.filter((entry) => entry.id !== item.id)
      : [item, ...current]);
  };

  const moveToMapLocation = (lat?: number, lng?: number, pin?: { title?: string; description?: string; category?: string }) => {
    setActiveTab('map');
    const hasCoords = typeof lat === 'number' && !Number.isNaN(lat) && typeof lng === 'number' && !Number.isNaN(lng);
    const targetLat = hasCoords ? lat! : activeRegion.mapCenter[0];
    const targetLng = hasCoords ? lng! : activeRegion.mapCenter[1];
    setAiMapPin({
      id: `${pin?.title || 'selected'}:${targetLat}:${targetLng}`,
      title: pin?.title || 'Selected location',
      description: pin?.description || 'AI が選んだ場所です。',
      lat: targetLat,
      lng: targetLng,
      category: pin?.category,
    });
    setTimeout(() => {
      mapRef.current?.flyTo([targetLat, targetLng], hasCoords ? 16 : activeRegion.mapZoom);
    }, 180);
  };

  const makeRecommendationFavorite = (rec: RecommendationCard): AiFavorite => ({
    id: `recommend:${selectedRegionKey}:${(rec.name_en || rec.name_ja).toLowerCase()}`,
    type: 'recommend',
    title: uiLanguage === 'ja' ? (rec.name_ja || rec.name_en) : (rec.name_en || rec.name_ja),
    subtitle: rec.category,
    description: uiLanguage === 'ja' ? (rec.reason_ja || rec.reason_en) : (rec.reason_en || rec.reason_ja),
    locationLabel: buildScopedLocationString(activeRegion, locationFilter) || `${activeRegion.country} ${activeRegion.prefecture} ${activeRegion.municipality}`,
    lat: rec.lat,
    lng: rec.lng,
    created_at: new Date().toISOString(),
  });

  const makeTrendFavorite = (trend: NonNullable<AIResults['trends']>[number]): AiFavorite => ({
    id: `trend:${selectedRegionKey}:${(trend.topic_en || trend.topic_ja || trend.keyword_en || trend.keyword_ja).toLowerCase()}`,
    type: 'trend',
    title: uiLanguage === 'ja' ? (trend.topic_ja || trend.keyword_ja || trend.topic_en) : (trend.topic_en || trend.keyword_en || trend.topic_ja),
    subtitle: trend.category,
    description: uiLanguage === 'ja' ? trend.description_ja : trend.description_en,
    locationLabel: buildScopedLocationString(activeRegion, locationFilter) || `${activeRegion.country} ${activeRegion.prefecture} ${activeRegion.municipality}`,
    lat: activeRegion.mapCenter[0],
    lng: activeRegion.mapCenter[1],
    source_url: trend.source_url,
    created_at: new Date().toISOString(),
  });

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
  const selectedPlaceIsFavorite = selectedPlace ? favorites.some((favorite) => favorite.place_id === selectedPlace.id) : false;
  const selectedPlaceScopedLocation = selectedPlace
    ? [selectedPlace.address, selectedPlace.municipality, selectedPlace.prefecture, selectedPlace.country].filter(Boolean).join(', ')
    : '';

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
      <div className="milz-editorial-bg relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(181,28,0,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(0,106,98,0.18),transparent_28%)]" />
        <div className="pointer-events-none absolute right-[-8rem] top-[-5rem] h-72 w-72 rounded-full bg-[#b51c00]/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-6rem] left-[-4rem] h-72 w-72 rounded-full bg-[#006a62]/10 blur-3xl" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 grid w-full max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr]"
        >
          <div className="hidden rounded-[2rem] bg-[linear-gradient(135deg,rgba(181,28,0,0.96),rgba(217,55,26,0.88))] p-10 text-white shadow-[0_30px_80px_rgba(25,28,29,0.18)] lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-5">
              <span className="inline-flex w-fit items-center rounded-full bg-white/14 px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-white/90">
                Digital Concierge
              </span>
              <div className="space-y-4">
                <h1 className="font-['Plus_Jakarta_Sans'] text-5xl font-extrabold leading-[1.02] tracking-[-0.04em]">
                  MILZ discovers places with a more editorial feel.
                </h1>
                <p className="max-w-xl text-sm leading-7 text-white/84">
                  Keep the map practical. Make everything around it feel curated, premium, and easier to trust.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="glass-panel rounded-[1.5rem] border border-white/20 p-5 text-white shadow-[0_16px_40px_rgba(25,28,29,0.12)] backdrop-blur-xl">
                  <p className="text-[10px] font-black uppercase tracking-[0.26em] text-white/70">Recommendation</p>
                  <p className="mt-2 font-['Plus_Jakarta_Sans'] text-xl font-bold">Real places only</p>
                  <p className="mt-2 text-sm text-white/75">14-day cache with meaningful AI reasoning.</p>
                </div>
                <div className="glass-panel rounded-[1.5rem] border border-white/20 p-5 text-white shadow-[0_16px_40px_rgba(25,28,29,0.12)] backdrop-blur-xl">
                  <p className="text-[10px] font-black uppercase tracking-[0.26em] text-white/70">Trend</p>
                  <p className="mt-2 font-['Plus_Jakarta_Sans'] text-xl font-bold">Search-driven</p>
                  <p className="mt-2 text-sm text-white/75">1-day cache based on currently rising topics.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-white/72">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/14">
                  {selectedAuthRole === 'admin' ? <ShieldCheck className="h-6 w-6" /> : <MapPin className="h-6 w-6" />}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.26em] text-white/60">Portal</p>
                  <p className="font-semibold">{selectedAuthRole === 'admin' ? 'Admin management and curation' : 'Personal discovery and saved spots'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-[2rem] border border-white/70 bg-white/88 p-8 shadow-[0_30px_80px_rgba(25,28,29,0.12)] backdrop-blur-xl sm:p-10">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#b51c00]">MILZ Access</p>
                <h2 className="mt-3 font-['Plus_Jakarta_Sans'] text-4xl font-extrabold tracking-[-0.04em] text-[#191c1d]">Sign in</h2>
                <p className="mt-2 text-sm text-[#5f6368]">
                  {selectedAuthRole === 'admin' ? 'Manage spots, imagery, and editorial controls.' : 'Save your favorite spots and get AI discovery.'}
                </p>
              </div>
              <div className={cn(
                "flex h-16 w-16 items-center justify-center rounded-[1.35rem] text-white shadow-[0_14px_34px_rgba(25,28,29,0.12)]",
                selectedAuthRole === 'admin' ? 'bg-[#006a62]' : 'bg-[linear-gradient(135deg,#b51c00,#d9371a)]'
              )}>
                {selectedAuthRole === 'admin' ? <ShieldCheck className="h-8 w-8" /> : <Sparkles className="h-8 w-8" />}
              </div>
            </div>

            <div className="mb-7 grid grid-cols-2 gap-3 rounded-[1.35rem] bg-[#f3f4f5] p-1.5">
              <button
                onClick={() => setSelectedAuthRole('user')}
                className={cn(
                  "rounded-[1rem] px-4 py-3 text-sm font-bold transition-all",
                  selectedAuthRole === 'user' ? 'bg-white text-[#191c1d] shadow-[0_8px_24px_rgba(25,28,29,0.06)]' : 'text-[#5f6368]'
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <UserIcon className="h-4 w-4" />
                  User
                </span>
              </button>
              <button
                onClick={() => setSelectedAuthRole('admin')}
                className={cn(
                  "rounded-[1rem] px-4 py-3 text-sm font-bold transition-all",
                  selectedAuthRole === 'admin' ? 'bg-white text-[#191c1d] shadow-[0_8px_24px_rgba(25,28,29,0.06)]' : 'text-[#5f6368]'
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Admin
                </span>
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
                    <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Email Address</label>
                    <div className="relative overflow-hidden rounded-[1.25rem] bg-[#f8f9fa]">
                      <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7c7f82]" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        className="w-full border-0 bg-transparent py-4 pl-12 pr-4 font-medium outline-none ring-0 placeholder:text-[#9ca0a4] focus:bg-white"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Password</label>
                    <div className="relative overflow-hidden rounded-[1.25rem] bg-[#f8f9fa]">
                      <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7c7f82]" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full border-0 bg-transparent py-4 pl-12 pr-4 font-medium outline-none ring-0 placeholder:text-[#9ca0a4] focus:bg-white"
                      />
                    </div>
                  </div>

                  {authError && (
                    <div className="rounded-[1.25rem] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className={cn(
                      "w-full rounded-full px-6 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(181,28,0,0.18)] transition-all active:scale-[0.98]",
                      selectedAuthRole === 'admin' ? 'bg-[#006a62] shadow-[0_16px_34px_rgba(0,106,98,0.18)]' : 'bg-[linear-gradient(135deg,#b51c00,#d9371a)]'
                    )}
                  >
                    {authMode === 'signin' ? 'Sign In' : 'Create Account'}
                  </button>
                </form>

                <div className="flex flex-col gap-3 pt-2">
                  <button
                    onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                    className="text-sm font-semibold text-[#5f6368] transition-colors hover:text-[#191c1d]"
                  >
                    {authMode === 'signin' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 border-t border-[#eceef0] pt-5 text-center text-[11px] font-bold uppercase tracking-[0.28em] text-[#a2a6ab]">
              Powered by Milztech
            </div>
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
                          placeholder={t.countryLabel}
                          value={locationFilter.country}
                          readOnly
                          className="w-full px-4 py-3 bg-stone-100 border border-stone-100 rounded-2xl text-sm text-stone-500 cursor-not-allowed"
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            type="text"
                            placeholder={t.prefectureLabel}
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
                          placeholder={t.addressOptional}
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
                          フィルターをクリア
                        </button>
                        <button
                          onClick={handleLocationSearch}
                          disabled={loading}
                          className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black text-xs active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          地図でこの住所へ移動
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
                        <div className="flex gap-2 pt-2 border-t border-stone-50">
                          <button 
                            onClick={() => handleToggleFavorite(place.id)}
                            className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-lg border text-[10px] font-black transition-colors",
                              favorites.some(f => f.place_id === place.id)
                                ? "border-stone-900 bg-stone-900 text-white"
                                : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
                            )}
                            aria-label="Toggle favorite"
                          >
                            <Heart className={cn("w-4 h-4", favorites.some(f => f.place_id === place.id) ? "fill-red-500 text-red-500" : "text-stone-400")} />
                          </button>
                          <button 
                            onClick={() => openPlaceDetail(place)}
                            className="flex-1 py-2 bg-stone-900 text-white text-[10px] font-black rounded-lg uppercase tracking-widest flex items-center justify-center gap-1"
                          >
                            <Info className="w-3 h-3" />
                            Details
                          </button>
                          {role === 'admin' && (
                            <>
                              <button 
                                onClick={() => handleEditPlace(place)}
                                className="flex-1 py-2 bg-stone-900 text-white text-[10px] font-black rounded-lg uppercase tracking-widest flex items-center justify-center gap-1"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                              <button 
                                onClick={() => handleDeletePlace(place.id)}
                                className="flex-1 py-2 bg-stone-100 text-stone-700 text-[10px] font-black rounded-lg uppercase tracking-widest flex items-center justify-center gap-1"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}


                {aiMapPin && (
                  <Marker position={[aiMapPin.lat, aiMapPin.lng]}>
                    <Popup className="custom-popup">
                      <div className="min-w-[220px] space-y-2 p-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-stone-400">AI PIN</p>
                          <h3 className="mt-1 text-base font-black text-stone-900">{aiMapPin.title}</h3>
                          {aiMapPin.category && <p className="mt-1 text-[11px] font-semibold text-stone-500">{aiMapPin.category}</p>}
                        </div>
                        <p className="text-xs leading-5 text-stone-600">{aiMapPin.description}</p>
                      </div>
                    </Popup>
                  </Marker>
                )}

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
              className="h-full overflow-y-auto bg-stone-50 p-6 pb-32 space-y-6"
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

              <div className="grid grid-cols-1 gap-4 pb-28">
                {(listFilter === 'all' ? filteredPlaces : favoritePlaces).map((place) => (
                  <motion.div 
                    layout
                    key={place.id}
                    className="bg-white p-4 rounded-3xl shadow-sm border border-stone-100 group cursor-pointer transition-transform hover:-translate-y-0.5"
                    onClick={() => openPlaceDetail(place)}
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
                            onClick={(e) => { e.stopPropagation(); handleToggleFavorite(place.id); }}
                            className={cn(
                              "p-2 rounded-xl transition-all",
                              favorites.some(f => f.place_id === place.id) ? "bg-stone-900 text-white" : "hover:bg-stone-50 text-stone-300"
                            )}
                          >
                            <Heart className={cn("w-4 h-4", favorites.some(f => f.place_id === place.id) ? "fill-red-500 text-red-500" : "text-stone-400")} />
                          </button>
                        </div>
                        <p className="text-xs text-stone-500 line-clamp-2 mt-1">{place.description}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-4">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              openPlaceDetail(place);
                            }}
                            className="flex items-center gap-1 text-[10px] font-black text-stone-900 hover:opacity-80 transition-colors"
                          >
                            <Info className="w-3 h-3" />
                            DETAILS
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
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
                              onClick={(e) => e.stopPropagation()}
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
              className="milz-editorial-bg h-full overflow-y-auto px-6 pb-36 pt-6"
            >
              <div className="mx-auto max-w-6xl space-y-8">
                <section className="relative overflow-hidden rounded-[2rem] border border-stone-200 bg-white px-7 py-8 text-stone-900 shadow-[0_18px_44px_rgba(25,28,29,0.08)]">
                  <div className="relative z-10 flex flex-col gap-4">
                    <div className="max-w-3xl space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.32em] text-stone-400">MILZ AI Discovery</p>
                      <h2 className="font-['Plus_Jakarta_Sans'] text-4xl font-extrabold tracking-[-0.04em] text-stone-900 md:text-5xl">
                        Curated recommendations and real-time trends for your selected region.
                      </h2>
                      <p className="max-w-2xl text-sm leading-7 text-stone-500">
                        Keep discovery practical, premium, and easy to trust without decorative noise.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="glass-panel overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_18px_44px_rgba(25,28,29,0.08)]">
                  <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#7c7f82]">{t.locationFilter}</p>
                      <h3 className="mt-2 font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em] text-[#191c1d]">Active region</h3>
                    </div>
                    <p className="max-w-xl text-sm text-[#5f6368]">{t.locationNote}</p>
                  </div>

                  <div className="flex gap-3 overflow-x-auto pb-1 hide-scrollbar">
                    {(Object.keys(REGION_PRESETS) as RegionKey[]).map((regionKey) => {
                      const active = selectedRegionKey === regionKey;
                      return (
                        <button
                          key={regionKey}
                          onClick={() => setSelectedRegionKey(regionKey)}
                          className={cn(
                            'flex-none rounded-full px-5 py-3 text-sm font-bold transition-all',
                            active
                              ? 'bg-stone-900 text-white shadow-[0_14px_30px_rgba(25,28,29,0.16)]'
                              : 'bg-[#f3f4f5] text-[#191c1d] hover:bg-white'
                          )}
                        >
                          <span className="inline-flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            {REGION_PRESETS[regionKey].name}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">{t.countryLabel}</p>
                      <p className="mt-2 font-semibold text-[#191c1d]">{locationFilter.country}</p>
                    </div>
                    <div className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">{t.prefectureLabel}</p>
                      <p className="mt-2 font-semibold text-[#191c1d]">{locationFilter.prefecture}</p>
                    </div>
                    <label className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                      <span className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">{t.cityArea}</span>
                      <input
                        type="text"
                        placeholder={t.cityArea}
                        value={locationFilter.municipality}
                        onChange={(e) => setLocationFilter(prev => ({ ...prev, municipality: e.target.value }))}
                        className="mt-2 w-full bg-transparent font-semibold text-[#191c1d] outline-none placeholder:text-[#a2a6ab]"
                      />
                    </label>
                    <label className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                      <span className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">{t.addressOptional}</span>
                      <input
                        type="text"
                        placeholder={t.addressOptional}
                        value={locationFilter.address}
                        onChange={(e) => setLocationFilter(prev => ({ ...prev, address: e.target.value }))}
                        className="mt-2 w-full bg-transparent font-semibold text-[#191c1d] outline-none placeholder:text-[#a2a6ab]"
                      />
                    </label>
                  </div>
                </section>

                <section className="grid gap-6 lg:grid-cols-[0.72fr_0.28fr]">
                  <div className="space-y-6">
                    <div className="glass-panel rounded-[2rem] border border-white/70 bg-white/88 p-4 shadow-[0_18px_44px_rgba(25,28,29,0.08)]">
                      <div className="grid grid-cols-2 gap-2 rounded-[1.4rem] bg-[#f3f4f5] p-1.5">
                        <button
                          onClick={() => setAiMode('recommend')}
                          className={cn(
                            'rounded-[1rem] px-4 py-3 text-sm font-bold transition-all',
                            aiMode === 'recommend' ? 'bg-white text-[#191c1d] shadow-[0_8px_24px_rgba(25,28,29,0.06)]' : 'text-[#7c7f82]'
                          )}
                        >
                          {t.recommend}
                        </button>
                        <button
                          onClick={() => setAiMode('trend')}
                          className={cn(
                            'rounded-[1rem] px-4 py-3 text-sm font-bold transition-all',
                            aiMode === 'trend' ? 'bg-white text-[#191c1d] shadow-[0_8px_24px_rgba(25,28,29,0.06)]' : 'text-[#7c7f82]'
                          )}
                        >
                          {t.trends}
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={handleAiRecommend}
                      disabled={aiLoading}
                      className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-stone-900 px-6 py-5 text-sm font-black text-white shadow-[0_18px_34px_rgba(25,28,29,0.18)] transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {aiLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                      {aiMode === 'recommend' ? t.getRecommendations : t.getTrends}
                    </button>

                    {aiError && (
                      <div className="rounded-[1.5rem] border border-stone-200 bg-white px-5 py-4 text-sm text-stone-700">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4" />
                          <span>{t.aiErrorPrefix}: {aiError}</span>
                        </div>
                      </div>
                    )}

                    {aiMode === 'recommend' && aiResults && recommendationCards.length > 0 && (
                      <section className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em] text-[#191c1d]">{t.recommendedSpots}</h3>
                          <span className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">{REGION_PRESETS[selectedRegionKey].name}</span>
                        </div>

                        {recommendationCards[0] && (
                          <div className="group relative overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#191c1d,#2f3335)] p-8 text-white shadow-[0_24px_60px_rgba(25,28,29,0.18)]">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_26%)]" />
                            <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                              <div className="max-w-2xl">
                                <span className="inline-flex rounded-full bg-stone-900 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-white">MILZ Top Match</span>
                                <h4 className="mt-4 font-['Plus_Jakarta_Sans'] text-4xl font-extrabold tracking-[-0.04em]">
                                  {uiLanguage === 'ja' ? (recommendationCards[0].name_ja || recommendationCards[0].name_en) : (recommendationCards[0].name_en || recommendationCards[0].name_ja)}
                                </h4>
                                <div className="mt-4 max-w-xl rounded-[1.5rem] border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
                                  <div className="flex gap-3">
                                    <Sparkles className="mt-0.5 h-5 w-5 text-stone-200" />
                                    <p className="text-sm leading-7 text-white/88">
                                      {uiLanguage === 'ja' ? (recommendationCards[0].reason_ja || recommendationCards[0].reason_en) : (recommendationCards[0].reason_en || recommendationCards[0].reason_ja)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              <div className="glass-panel rounded-[1.5rem] border border-white/16 bg-white/10 px-5 py-4 text-white/86">
                                <p className="text-[10px] font-black uppercase tracking-[0.26em] text-white/58">Category</p>
                                <p className="mt-2 text-sm font-semibold">{recommendationCards[0].category}</p>
                                <div className="mt-4 flex gap-2">
                                  <button onClick={() => moveToMapLocation(recommendationCards[0].lat, recommendationCards[0].lng, { title: uiLanguage === 'ja' ? (recommendationCards[0].name_ja || recommendationCards[0].name_en) : (recommendationCards[0].name_en || recommendationCards[0].name_ja), description: uiLanguage === 'ja' ? (recommendationCards[0].reason_ja || recommendationCards[0].reason_en) : (recommendationCards[0].reason_en || recommendationCards[0].reason_ja), category: recommendationCards[0].category })} className="rounded-full border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white">View on map</button>
                                  <button onClick={() => toggleAiFavorite(makeRecommendationFavorite(recommendationCards[0]))} className="rounded-full border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white inline-flex items-center gap-2">
                                    <Heart className={cn('h-3.5 w-3.5', isAiFavoriteSaved(makeRecommendationFavorite(recommendationCards[0]).id) ? 'fill-red-500 text-red-500' : 'text-white')} />
                                    Save
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2">
                          {recommendationCards.slice(1).map((rec, i) => (
                            <div key={i} className="glass-panel rounded-[1.75rem] border border-white/70 bg-white/92 p-6 shadow-[0_16px_34px_rgba(25,28,29,0.08)]">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Recommendation</p>
                                  <h4 className="mt-2 font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em] text-[#191c1d]">
                                    {uiLanguage === 'ja' ? (rec.name_ja || rec.name_en) : (rec.name_en || rec.name_ja)}
                                  </h4>
                                </div>
                                <span className="rounded-full bg-[#f3f4f5] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#5f6368]">{rec.category}</span>
                              </div>
                              <p className="mt-4 text-sm leading-7 text-[#5f6368]">{uiLanguage === 'ja' ? (rec.reason_ja || rec.reason_en) : (rec.reason_en || rec.reason_ja)}</p>
                              <div className="mt-5 flex flex-wrap gap-2">
                                <button onClick={() => moveToMapLocation(rec.lat, rec.lng, { title: uiLanguage === 'ja' ? (rec.name_ja || rec.name_en) : (rec.name_en || rec.name_ja), description: uiLanguage === 'ja' ? (rec.reason_ja || rec.reason_en) : (rec.reason_en || rec.reason_ja), category: rec.category })} className="rounded-full border border-stone-200 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-stone-900">View on map</button>
                                <button onClick={() => toggleAiFavorite(makeRecommendationFavorite(rec))} className="rounded-full border border-stone-200 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-stone-900 inline-flex items-center gap-2">
                                  <Heart className={cn('h-3.5 w-3.5', isAiFavoriteSaved(makeRecommendationFavorite(rec).id) ? 'fill-red-500 text-red-500' : 'text-stone-500')} />
                                  Save
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {aiMode === 'trend' && aiResults?.trends && (
                      <section className="space-y-5">
                        <div className="flex items-center justify-between">
                          <h3 className="font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em] text-[#191c1d]">{t.localTrends}</h3>
                          <span className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Google search based</span>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          {aiResults.trends.map((trend, i) => (
                            <div key={i} className="glass-panel rounded-[1.75rem] border border-white/70 bg-white/92 p-6 shadow-[0_16px_34px_rgba(25,28,29,0.08)]">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-100 text-stone-700">
                                    <TrendingUp className="h-5 w-5" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Trend #{i + 1}</p>
                                    <h4 className="mt-1 font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em] text-[#191c1d]">
                                      {uiLanguage === 'ja' ? (trend.topic_ja || trend.keyword_ja) : (trend.topic_en || trend.keyword_en)}
                                    </h4>
                                  </div>
                                </div>
                              </div>
                              <p className="mt-4 text-sm leading-7 text-[#5f6368]">{uiLanguage === 'ja' ? trend.description_ja : trend.description_en}</p>
                              <div className="mt-5">
                                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[#5f6368]">
                                  <span>Popularity</span>
                                  <span>{trend.popularity}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-[#eef0f1]">
                                  <div className="h-full rounded-full bg-stone-900" style={{ width: `${trend.popularity}%` }} />
                                </div>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button onClick={() => moveToMapLocation(activeRegion.mapCenter[0], activeRegion.mapCenter[1], { title: uiLanguage === 'ja' ? (trend.topic_ja || trend.keyword_ja || trend.topic_en) : (trend.topic_en || trend.keyword_en || trend.topic_ja), description: uiLanguage === 'ja' ? trend.description_ja : trend.description_en, category: trend.category })} className="rounded-full border border-stone-200 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-stone-900">View on map</button>
                                <button onClick={() => toggleAiFavorite(makeTrendFavorite(trend))} className="rounded-full border border-stone-200 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-stone-900 inline-flex items-center gap-2">
                                  <Heart className={cn('h-3.5 w-3.5', isAiFavoriteSaved(makeTrendFavorite(trend).id) ? 'fill-red-500 text-red-500' : 'text-stone-500')} />
                                  Save
                                </button>
                                {trend.source_url && (
                                  <a
                                    href={trend.source_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-full border border-stone-200 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-stone-900 hover:opacity-80"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    {t.source}
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>

                  <aside className="space-y-4">
                    <div className="glass-panel rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_18px_44px_rgba(25,28,29,0.08)]">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#7c7f82]">Region Summary</p>
                      <div className="mt-4 space-y-4">
                        <div className="rounded-[1.4rem] bg-[#f8f9fa] px-4 py-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">{t.countryLabel}</p>
                          <p className="mt-2 font-semibold text-[#191c1d]">{locationFilter.country}</p>
                        </div>
                        <div className="rounded-[1.4rem] bg-[#f8f9fa] px-4 py-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Scope</p>
                          <p className="mt-2 font-semibold text-[#191c1d]">{buildScopedLocationString(activeRegion, locationFilter) || `${activeRegion.country} ${activeRegion.prefecture} ${activeRegion.municipality}`}</p>
                        </div>
                      </div>
                    </div>
                  </aside>
                </section>
              </div>
            </motion.div>
          )}
          {activeTab === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="milz-editorial-bg h-full overflow-y-auto px-6 pb-40 pt-6"
            >
              <div className="mx-auto max-w-5xl space-y-8">
                <section className="glass-panel overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_rgba(25,28,29,0.10)] sm:p-10">
                  <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-5">
                      <div className="relative">
                        <div className="flex h-24 w-24 items-center justify-center rounded-[1.8rem] bg-[linear-gradient(135deg,#b51c00,#d9371a)] text-white shadow-[0_20px_40px_rgba(181,28,0,0.18)]">
                          <UserIcon className="h-11 w-11" />
                        </div>
                        {role === 'admin' && (
                          <div className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center rounded-2xl border-4 border-white bg-[#006a62] text-white shadow-[0_14px_28px_rgba(0,106,98,0.16)]">
                            <ShieldCheck className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.32em] text-[#7c7f82]">Profile</p>
                        <h2 className="mt-2 font-['Plus_Jakarta_Sans'] text-4xl font-extrabold tracking-[-0.04em] text-[#191c1d]">{user.email?.split('@')[0]}</h2>
                        <p className="mt-2 text-sm text-[#5f6368]">{user.email}</p>
                        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#f3f4f5] px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#191c1d]">
                          {role === 'admin' ? 'ADMIN' : 'PERSONAL'}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:w-[22rem] sm:grid-cols-2">
                      <div className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Access</p>
                        <p className="mt-2 font-semibold text-[#191c1d]">{role === 'admin' ? 'Curation + admin tools' : 'Bookmarks + AI discovery'}</p>
                      </div>
                      <div className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Account ID</p>
                        <p className="mt-2 truncate text-sm font-semibold text-[#191c1d]">{user.id}</p>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid gap-6 lg:grid-cols-[0.72fr_0.28fr]">
                  <div className="space-y-6">
                    <div className="glass-panel rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_18px_44px_rgba(25,28,29,0.08)]">
                      <div className="mb-5 flex items-center gap-3">
                        <Palette className="h-5 w-5 text-[#b51c00]" />
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#7c7f82]">Settings</p>
                          <h3 className="mt-1 font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em] text-[#191c1d]">{t.mapStyleSettings}</h3>
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {(Object.keys(MAP_STYLES) as Array<keyof typeof MAP_STYLES>).map((styleKey) => (
                          <button
                            key={styleKey}
                            onClick={() => setMapStyle(styleKey)}
                            className={cn(
                              'rounded-[1.5rem] p-5 text-left transition-all',
                              mapStyle === styleKey
                                ? 'bg-[linear-gradient(135deg,#191c1d,#2f3335)] text-white shadow-[0_18px_34px_rgba(25,28,29,0.14)]'
                                : 'bg-[#f8f9fa] text-[#191c1d] hover:bg-white'
                            )}
                          >
                            <p className="text-[10px] font-black uppercase tracking-[0.26em] opacity-65">{styleKey === 'original' ? t.original : t.guide}</p>
                            <p className="mt-3 font-['Plus_Jakarta_Sans'] text-xl font-extrabold tracking-[-0.03em]">{styleKey === 'original' ? 'Current map' : 'Guide map'}</p>
                            <p className={cn('mt-3 text-sm leading-6', mapStyle === styleKey ? 'text-white/72' : 'text-[#5f6368]')}>
                              {MAP_STYLES[styleKey].description}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="glass-panel rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_18px_44px_rgba(25,28,29,0.08)]">
                      <div className="mb-5 flex items-center gap-3">
                        <Globe className="h-5 w-5 text-[#006a62]" />
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#7c7f82]">Workspace</p>
                          <h3 className="mt-1 font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em] text-[#191c1d]">Preferences</h3>
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Language</p>
                          <p className="mt-2 font-semibold text-[#191c1d]">{uiLanguage === 'ja' ? 'Japanese' : 'English'}</p>
                        </div>
                        <div className="rounded-[1.5rem] bg-[#f8f9fa] px-5 py-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Favorites</p>
                          <p className="mt-2 font-semibold text-[#191c1d]">{favorites.length} saved spots</p>
                        </div>
                        <div className="rounded-[1.5rem] border border-stone-200 bg-white p-5 md:col-span-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#7c7f82]">AI SAVED</p>
                          <p className="mt-2 font-semibold text-[#191c1d]">{aiFavorites.length} saved recommendation / trend items</p>
                          <div className="mt-4 space-y-3">
                            {aiFavorites.slice(0, 8).map((item) => (
                              <div key={item.id} className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7c7f82]">{item.type}</p>
                                    <p className="mt-1 font-semibold text-[#191c1d]">{item.title}</p>
                                    <p className="mt-1 text-xs text-[#5f6368]">{item.locationLabel}</p>
                                  </div>
                                  <button onClick={() => moveToMapLocation(item.lat, item.lng)} className="rounded-full border border-stone-200 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-stone-900">View on map</button>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-[#5f6368]">{item.description}</p>
                              </div>
                            ))}
                            {aiFavorites.length === 0 && <p className="text-sm text-[#7c7f82]">Saved recommendations and trends will appear here.</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <aside className="space-y-4">
                    <div className="glass-panel rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_18px_44px_rgba(25,28,29,0.08)]">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#7c7f82]">Account</p>
                      <p className="mt-3 text-sm leading-7 text-[#5f6368]">
                        Keep the map as-is, while the surrounding experience feels softer, more premium, and easier to navigate.
                      </p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full rounded-full border border-[#f0c5bc] bg-white px-6 py-4 text-sm font-black uppercase tracking-[0.18em] text-[#b51c00] transition-colors hover:bg-[#fff4f1]"
                    >
                      {t.logout}
                    </button>
                  </aside>
                </section>
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
      <nav className="fixed bottom-0 left-0 right-0 z-[1002] mx-auto flex max-w-screen-sm items-end justify-around rounded-t-[32px] bg-white/92 px-4 pb-6 pt-3 shadow-[0_-8px_32px_rgba(0,0,0,0.06)] backdrop-blur-xl md:left-6 md:right-6 md:bottom-4 md:max-w-4xl">
        <button
          onClick={() => setActiveTab('map')}
          className={cn('group flex flex-col items-center justify-center transition-colors', activeTab === 'map' ? 'text-stone-900' : 'text-zinc-400 hover:text-stone-700')}
        >
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-full transition-all', activeTab === 'map' ? 'bg-stone-100 text-stone-900' : 'bg-transparent')}>
            <MapIcon className="h-5 w-5" />
          </span>
          <span className="mt-1 font-['Inter'] text-[10px] font-bold uppercase tracking-widest">MAP</span>
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={cn('group flex flex-col items-center justify-center transition-colors', activeTab === 'list' ? 'text-stone-900' : 'text-zinc-400 hover:text-stone-700')}
        >
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-full transition-all', activeTab === 'list' ? 'bg-stone-100 text-stone-900' : 'bg-transparent')}>
            <ListIcon className="h-5 w-5" />
          </span>
          <span className="mt-1 font-['Inter'] text-[10px] font-bold uppercase tracking-widest">LIST</span>
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={cn('group flex flex-col items-center justify-center transition-colors', activeTab === 'ai' ? 'text-stone-900' : 'text-zinc-400 hover:text-stone-700')}
        >
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-full transition-all', activeTab === 'ai' ? 'bg-stone-100 text-stone-900' : 'bg-transparent')}>
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="mt-1 font-['Inter'] text-[10px] font-bold uppercase tracking-widest">AI</span>
        </button>
        <button
          onClick={() => setActiveTab('profile')}
          className={cn('group flex flex-col items-center justify-center transition-colors', activeTab === 'profile' ? 'text-stone-900' : 'text-zinc-400 hover:text-stone-700')}
        >
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-full transition-all', activeTab === 'profile' ? 'bg-stone-100 text-stone-900' : 'bg-transparent')}>
            <UserIcon className="h-5 w-5" />
          </span>
          <span className="mt-1 font-['Inter'] text-[10px] font-bold uppercase tracking-widest">PROFILE</span>
        </button>
      </nav>

      <AnimatePresence>
        {selectedPlace && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2050] bg-[#f8f9fa]"
          >
            <div className="h-full overflow-y-auto pb-40">
              <header className="sticky top-0 z-20 flex items-center justify-between bg-white/88 px-5 py-4 backdrop-blur-xl border-b border-[#eceef0]">
                <button onClick={closePlaceDetail} className="text-stone-700">
                  <ChevronRight className="h-5 w-5 rotate-180" />
                </button>
                <div className="text-sm font-black tracking-tight text-stone-900">MILZ</div>
                <button
                  onClick={() => selectedPlace && handleToggleFavorite(selectedPlace.id)}
                  className={cn('flex h-9 w-9 items-center justify-center rounded-full border transition-colors', selectedPlaceIsFavorite ? 'border-red-500 bg-red-50 text-red-600' : 'border-stone-200 bg-white text-stone-700')}
                >
                  <Heart className={cn('h-4 w-4', selectedPlaceIsFavorite ? 'fill-red-500 text-red-500' : 'text-stone-500')} />
                </button>
              </header>

              <section className="relative h-[38vh] min-h-[19rem] overflow-hidden bg-[linear-gradient(135deg,#2f3335,#191c1d)]">
                {selectedPlace.image_url ? (
                  <img src={selectedPlace.image_url} alt={selectedPlace.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_28%),linear-gradient(135deg,#cfa77d,#4f3528)]" />
                )}
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(25,28,29,0.06),rgba(25,28,29,0.72)_68%,rgba(25,28,29,0.9))]" />
                <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#84f5e8] px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-[#00201d]">Admin Spot</span>
                    <span className="rounded-full bg-white/14 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-white/92">{selectedPlace.category}</span>
                  </div>
                  <h2 className="mt-4 font-['Plus_Jakarta_Sans'] text-4xl font-extrabold tracking-[-0.04em] text-white">{selectedPlace.name}</h2>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/82">
                    {selectedPlaceScopedLocation && <span>{selectedPlaceScopedLocation}</span>}
                    <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {selectedPlace.lat.toFixed(4)}, {selectedPlace.lng.toFixed(4)}</span>
                  </div>
                  <div className="mt-5 flex gap-3">
                    <button
                      onClick={() => { setActiveTab('map'); closePlaceDetail(); setTimeout(() => mapRef.current?.flyTo([selectedPlace.lat, selectedPlace.lng], 16), 140); }}
                      className="inline-flex min-w-[11rem] items-center justify-center gap-2 rounded-full bg-stone-900 px-6 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(25,28,29,0.18)]"
                    >
                      <Navigation className="h-4 w-4" />
                      View on Map
                    </button>
                    {selectedPlace.website_url && (
                      <a href={selectedPlace.website_url} target="_blank" rel="noreferrer" className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/12 text-white backdrop-blur-xl">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              </section>

              <div className="space-y-8 px-5 py-6">
                <section className="rounded-[1.75rem] bg-[#f3f4f5] p-6">
                  <h3 className="font-['Plus_Jakarta_Sans'] text-[2rem] font-extrabold leading-tight tracking-[-0.04em] text-[#191c1d]">About the MILZ Discovery</h3>
                  <p className="mt-4 text-[15px] leading-8 text-[#5f6368]">
                    {selectedPlace.description || 'This MILZ spot was registered by the admin team as a saved destination worth checking in this region. Open the map to view its exact location or use the website link for the latest official information.'}
                  </p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[1.4rem] bg-white px-5 py-4">
                      <div className="flex items-start gap-3">
                        <MapPin className="mt-0.5 h-5 w-5 text-stone-700" />
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#191c1d]">Address</p>
                          <p className="mt-2 text-sm leading-6 text-[#5f6368]">{selectedPlace.address || selectedPlaceScopedLocation || 'Pinned directly on the map by the MILZ admin team.'}</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[1.4rem] bg-white px-5 py-4">
                      <div className="flex items-start gap-3">
                        <Globe className="mt-0.5 h-5 w-5 text-stone-700" />
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#191c1d]">Official Link</p>
                          <p className="mt-2 text-sm leading-6 text-[#5f6368] break-all">{selectedPlace.website_url || 'No official website was registered for this spot.'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-5 flex items-end justify-between">
                    <h3 className="font-['Plus_Jakarta_Sans'] text-[2rem] font-extrabold leading-tight tracking-[-0.04em] text-[#191c1d]">Spot Details</h3>
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-900">MILZ Editorial</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="overflow-hidden rounded-[1.25rem] bg-[#191c1d] p-5 text-white">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/60">Category</p>
                      <p className="mt-3 font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em]">{selectedPlace.category}</p>
                    </div>
                    <div className="overflow-hidden rounded-[1.25rem] bg-[#f0faf8] p-5 text-[#00201d]">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Saved Status</p>
                      <p className="mt-3 font-['Plus_Jakarta_Sans'] text-2xl font-extrabold tracking-[-0.03em]">{selectedPlaceIsFavorite ? 'Saved' : 'Not Saved'}</p>
                    </div>
                    <div className="rounded-[1.25rem] bg-white p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7c7f82]">Coordinates</p>
                      <p className="mt-3 text-sm font-semibold text-[#191c1d]">Lat {selectedPlace.lat.toFixed(5)} / Lng {selectedPlace.lng.toFixed(5)}</p>
                    </div>
                    <div className="rounded-[1.25rem] bg-white p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7c7f82]">Registered</p>
                      <p className="mt-3 text-sm font-semibold text-[#191c1d]">{new Date(selectedPlace.created_at).toLocaleDateString(uiLanguage === 'ja' ? 'ja-JP' : 'en-US')}</p>
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.75rem] bg-[#eaf7f4] p-6 relative overflow-hidden">
                  <div className="relative z-10">
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-stone-500">Save for Later</p>
                    <h4 className="mt-3 font-['Plus_Jakarta_Sans'] text-3xl font-extrabold tracking-[-0.04em] text-[#00201d]">Keep this spot in your MILZ list</h4>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-[#33544f]">Save the admin-curated spot to revisit it later or jump back to the map when you are building a route.</p>
                    <button
                      onClick={() => selectedPlace && handleToggleFavorite(selectedPlace.id)}
                      className="mt-6 inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-stone-900"
                    >
                      <Heart className={cn('h-4 w-4', selectedPlaceIsFavorite ? 'fill-red-500 text-red-500' : 'text-stone-500')} />
                      {selectedPlaceIsFavorite ? 'Saved to Favorites' : 'Add to Favorites'}
                    </button>
                  </div>
                  <Heart className="absolute -bottom-4 -right-4 h-28 w-28 text-stone-200" />
                </section>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Spot Modal */}
      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] flex items-end justify-center bg-[rgba(25,28,29,0.46)] p-4 backdrop-blur-sm sm:items-center"
          >
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="glass-panel w-full max-w-2xl rounded-[2rem] border border-white/70 bg-white/92 p-8 shadow-[0_30px_80px_rgba(25,28,29,0.14)]"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-['Plus_Jakarta_Sans'] text-3xl font-extrabold tracking-[-0.04em] text-[#191c1d]">
                  {editingPlace ? 'Edit Spot' : 'Add New Spot'}
                </h2>
                <button onClick={closeAddModal} className="rounded-full p-2 text-[#7c7f82] transition-colors hover:bg-[#f3f4f5]">
                  <X className="w-6 h-6 text-stone-400" />
                </button>
              </div>

              {!newPlacePos ? (
                <div className="space-y-6">
                  <div className="rounded-[1.75rem] bg-[#f8f9fa] p-8 text-center space-y-4">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-white">
                      <MapPinned className="w-8 h-8 text-stone-300" />
                    </div>
                    <p className="font-medium text-[#5f6368]">Tap anywhere on the map to set the location.</p>
                  </div>

                  <div className="relative flex items-center">
                    <div className="h-px flex-1 bg-[#eceef0]"></div>
                    <span className="px-4 text-[10px] font-black uppercase tracking-[0.26em] text-[#a2a6ab]">OR</span>
                    <div className="h-px flex-1 bg-[#eceef0]"></div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Enter Address</label>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={modalAddress}
                          onChange={(e) => setModalAddress(e.target.value)}
                          placeholder="e.g. 1-1-1 Shiba-koen, Minato-ku, Tokyo"
                          className="flex-1 rounded-[1.25rem] bg-[#f8f9fa] px-5 py-4 font-medium outline-none transition-all focus:ring-2 focus:ring-[#006a62]/15"
                          onKeyDown={(e) => e.key === 'Enter' && handleModalAddressSearch()}
                        />
                        <button
                          onClick={handleModalAddressSearch}
                          disabled={isGeocoding}
                          className="rounded-full bg-[linear-gradient(135deg,#b51c00,#d9371a)] px-6 text-xs font-black text-white transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                          {isGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={closeAddModal}
                    className="w-full py-4 text-[10px] font-black uppercase tracking-[0.22em] text-[#7c7f82] transition-colors hover:text-[#191c1d]"
                  >
                    CANCEL
                  </button>
                </div>
              ) : (
                <form onSubmit={handleAddPlace} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Spot Name</label>
                      <input 
                        name="name"
                        required
                        defaultValue={editingPlace?.name}
                        placeholder="e.g. Blue Bottle Coffee"
                        className="w-full rounded-[1.25rem] bg-[#f8f9fa] px-5 py-4 font-medium outline-none transition-all focus:ring-2 focus:ring-[#006a62]/15"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Photo</label>
                      <div className="flex items-center gap-4">
                        <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[1.25rem] bg-[#f8f9fa]">
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
                        <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Category</label>
                        <select 
                          name="category"
                          defaultValue={editingPlace?.category || 'その他'}
                          className="w-full rounded-[1.25rem] bg-[#f8f9fa] px-5 py-4 font-medium outline-none transition-all focus:ring-2 focus:ring-[#006a62]/15 appearance-none"
                        >
                          {Object.keys(CATEGORY_CONFIG).map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Website (Optional)</label>
                        <input 
                          name="website_url"
                          defaultValue={editingPlace?.website_url || ''}
                          placeholder="https://..."
                          className="w-full rounded-[1.25rem] bg-[#f8f9fa] px-5 py-4 font-medium outline-none transition-all focus:ring-2 focus:ring-[#006a62]/15"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="px-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7c7f82]">Description</label>
                      <textarea 
                        name="description"
                        rows={3}
                        defaultValue={editingPlace?.description || ''}
                        placeholder="What's special about this place?"
                        className="w-full rounded-[1.25rem] bg-[#f8f9fa] px-5 py-4 font-medium outline-none transition-all focus:ring-2 focus:ring-[#006a62]/15 resize-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <button 
                      type="submit"
                      disabled={isSubmitting || uploading}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#b51c00,#d9371a)] py-5 font-black text-white shadow-[0_18px_34px_rgba(181,28,0,0.18)] transition-all active:scale-[0.98] disabled:opacity-50"
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

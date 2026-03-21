import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

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

const buildCacheKey = async (address: string) => {
  const bytes = new TextEncoder().encode(normalize(address));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const verifyAuth = async (request: Request, env: Env) => {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  return null;
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json({ error: 'Supabase auth is not configured' }, 500);
    }

    const authError = await verifyAuth(request, env);
    if (authError) return authError;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const address = String(body?.address || '').trim().slice(0, 200);

    if (!address) {
      return json({ error: 'address is required' }, 400);
    }

    const cacheKey = await buildCacheKey(address);
    const cacheUrl = new URL(`https://edge-cache.local/api-geo-${cacheKey}`);
    const cache = caches.default;
    const cached = await cache.match(cacheUrl.toString());
    if (cached) {
      return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers.entries()), ...corsHeaders } });
    }

    const endpoint = new URL('https://nominatim.openstreetmap.org/search');
    endpoint.searchParams.set('q', address);
    endpoint.searchParams.set('format', 'jsonv2');
    endpoint.searchParams.set('limit', '1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(endpoint.toString(), {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return json({ error: 'Geocoding provider error' }, 502);
    }

    const results = (await response.json()) as any[];
    const first = results?.[0];
    if (!first?.lat || !first?.lon) {
      return json({ error: 'Location not found' }, 404);
    }

    const payload = JSON.stringify({
      lat: Number(first.lat),
      lng: Number(first.lon),
      display_name: first.display_name ?? null,
      provider: 'nominatim',
    });

    const cacheable = new Response(payload, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=604800',
        'X-Geo-Cache': 'MISS',
      },
    });

    await cache.put(cacheUrl.toString(), cacheable.clone());
    return cacheable;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Geocoding failed';
    return json({ error: message }, 500);
  }
};

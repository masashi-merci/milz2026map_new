import { GoogleGenAI, Type } from '@google/genai';
import { concretizeTrends, type TrendItem } from '../../_shared/trend-place-map';

export interface Env {
  GEMINI_API_KEY: string;
  PREWARM_SECRET: string;
}

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Prewarm-Secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const buildCacheKey = async (location: string, category: string) => {
  const source = `trend|${normalize(location)}|${normalize(category || 'general')}`;
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

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const secret = request.headers.get('X-Prewarm-Secret') || '';
    if (!env.PREWARM_SECRET || secret !== env.PREWARM_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'GEMINI_API_KEY is not configured' }, 500);
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      return json({ error: 'items is required' }, 400);
    }

    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const cache = caches.default;
    const responseSchema = {
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

    const results = [];

    for (const raw of items.slice(0, 50)) {
      const record = (raw || {}) as Record<string, unknown>;
      const location = String(record.location || '').trim().slice(0, 120);
      const category = String(record.category || 'general').trim().slice(0, 80);
      if (!location) continue;

      const prompt = [
        'You are a concise bilingual local trends assistant.',
        `For the location "${location}" and category "${category}", provide exactly 5 current local trends that match the selected category.`,
        'Use specific local area names, districts, landmarks, facilities, or venue names whenever possible. Never use abstract titles like cafe, shopping, sightseeing, fruit picking, or winery by themselves.',
        'If an exact venue is uncertain, prefer a concrete area name over an abstract topic.',
        'Prefer current search interest, seasonal movement, recurring events, transit, food, shopping, and attractions.',
        'Keep descriptions short and practical.',
        'Return JSON only.',
      ].join('\n');

      const response = await timeoutFetch(
        () =>
          ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema,
              maxOutputTokens: 800,
              temperature: 0.35,
            },
          }),
        8000,
      );

      const parsed = JSON.parse(response.text || '{}');
      if (Array.isArray(parsed?.trends)) {
        parsed.trends = concretizeTrends(location, category, parsed.trends as TrendItem[]);
      }
      const payload = JSON.stringify({
        ...parsed,
        generatedAt: new Date().toISOString(),
        mode: 'trend',
        location,
        category,
        prewarmed: true,
      });

      const cacheKey = await buildCacheKey(location, category);
      const cacheUrl = new URL(`https://edge-cache.local/api-ai-${cacheKey}`);
      const cacheable = new Response(payload, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=21600',
          'X-AI-Cache': 'PREWARM',
        },
      });
      await cache.put(cacheUrl.toString(), cacheable);

      results.push({ location, category, ok: true });
    }

    return json({ ok: true, count: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prewarm failed';
    return json({ error: message }, 500);
  }
};

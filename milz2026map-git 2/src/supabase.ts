import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient | null => {
  if (supabaseInstance) return supabaseInstance;

  let supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Normalize URL
  if (supabaseUrl && supabaseUrl.endsWith('/')) {
    supabaseUrl = supabaseUrl.slice(0, -1);
  }

  console.log('Supabase: Initializing client', { 
    url: supabaseUrl ? 'SET' : 'MISSING', 
    key: supabaseAnonKey ? 'SET' : 'MISSING' 
  });

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase: Config missing');
    return null;
  }

  if (supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1')) {
    console.warn('Supabase: Localhost URL detected. This will not work in a cloud environment.');
    addLog('Warning: Localhost URL detected. Please use your Supabase project API URL.');
  }

  if (supabaseUrl.includes('supabase.com/dashboard')) {
    console.error('Supabase: Invalid URL detected. You provided the Dashboard URL instead of the API URL.');
    addLog('Error: Invalid URL detected (Dashboard URL provided)');
    return null;
  }

  if (!supabaseAnonKey.startsWith('eyJ')) {
    console.error('Supabase: Invalid Anon Key detected.');
    addLog('Error: Invalid Anon Key detected');
    return null;
  }

  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        // Disable the lock mechanism if it's causing AbortErrors in this environment
        // This effectively runs the auth tasks without cross-tab locking
        lock: (name: string, _acquireTimeout: number, acquire: () => Promise<any>) => acquire(),
      },
      global: {
        headers: { 'x-application-name': 'milz-app' },
      },
    });
    console.log('Supabase: Client instance created successfully');
  } catch (err) {
    console.error('Supabase: Failed to create client instance', err);
  }
  return supabaseInstance;
};

/**
 * Force recreate the Supabase client instance
 */
export const resetSupabaseClient = () => {
  supabaseInstance = null;
  console.log('Supabase: Client instance reset');
  return getSupabase();
};

/**
 * Diagnostic function to test connection using raw fetch
 * This helps determine if the issue is with the library or network
 */
export const testSupabaseConnection = async () => {
  let supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { success: false, message: 'Configuration missing' };
  }

  if (supabaseUrl.endsWith('/')) {
    supabaseUrl = supabaseUrl.slice(0, -1);
  }

  try {
    const start = Date.now();
    
    // Step 1: Basic reachability test (Ping)
    // We try to fetch the base URL. If it fails with a network error immediately, it might be a DNS issue.
    // If it timeouts, it's a routing/firewall issue.
    try {
      addLog(`Diagnostic: Pinging ${supabaseUrl}...`);
      const pingRes = await fetch(supabaseUrl, { mode: 'no-cors', signal: AbortSignal.timeout(5000) });
      console.log('Supabase Diagnostic: URL is reachable', pingRes);
      addLog('Diagnostic: URL is reachable (Ping success)');
    } catch (pingErr: any) {
      console.warn('Supabase Diagnostic: Basic ping failed', pingErr);
      addLog(`Diagnostic: Ping failed: ${pingErr.message}`);
      if (pingErr.name === 'TimeoutError') {
        return { 
          success: false, 
          message: 'Network Timeout during ping. The Supabase URL is not responding.',
          details: 'ブラウザからSupabaseのサーバーに到達できません。VPNやファイアウォール、またはプロキシ設定を確認してください。',
          isTimeout: true
        };
      }
    }

    // Step 2: Test basic REST endpoint
    addLog('Diagnostic: Testing REST API endpoint...');
    const response = await fetch(`${supabaseUrl}/rest/v1/admin_places?select=count`, {
      method: 'GET',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      },
      signal: AbortSignal.timeout(15000)
    });

    const duration = Date.now() - start;

    if (response.ok) {
      addLog(`Diagnostic: REST API success (${duration}ms)`);
      return { success: true, message: `Connection successful (${duration}ms)`, status: response.status };
    } else {
      const errorText = await response.text();
      addLog(`Diagnostic: REST API failed with status ${response.status}`);
      return { success: false, message: `HTTP Error: ${response.status} ${response.statusText}`, details: errorText };
    }
  } catch (err) {
    console.error('Supabase Diagnostic: Fetch failed', err);
    addLog(`Diagnostic: Fetch exception: ${err instanceof Error ? err.message : 'Unknown'}`);
    return { 
      success: false, 
      message: err instanceof Error ? err.message : 'Unknown network error',
      isTimeout: err instanceof Error && err.name === 'TimeoutError'
    };
  }
};

// Helper to add logs to the global debug log if possible
const addLog = (msg: string) => {
  console.log(`[Supabase Diagnostic] ${msg}`);
  // We can't easily access the React state here, but we can use a custom event
  window.dispatchEvent(new CustomEvent('supabase-debug-log', { detail: msg }));
};

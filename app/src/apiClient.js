const ENV = import.meta.env || {};
const BASE_URL = ENV.VITE_AT_TEAM_API_BASE_URL || '';
const TOKEN = ENV.VITE_AT_TEAM_API_TOKEN || '';

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createApiClient({ baseUrl = BASE_URL, token = TOKEN, fetchImpl = fetch } = {}) {
  function scopedBuildUrl(path) {
    if (path.startsWith('http')) return path;
    const base = baseUrl.replace(/\/$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }

  async function request(path, options = {}) {
    const url = scopedBuildUrl(path);
    const headers = {
      'content-type': 'application/json',
      ...(token ? { 'x-at-token': token } : {}),
      ...(options.headers || {})
    };

    let lastError;
    const maxAttempts = options.retry === false ? 1 : 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
      try {
        const response = await fetchImpl(url, {
          ...options,
          headers,
          signal: controller.signal
        });

        const json = await response.json();
        if (!response.ok) throw new Error(json.error || response.statusText);
        return json;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts && !error.name?.includes('Abort') && error.message !== 'Unauthorized') {
          await delay((options.retryDelayMs ?? 300) * attempt);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw lastError;
  }

  function streamUrl(path) {
    if (!token) return scopedBuildUrl(path);
    const separator = path.includes('?') ? '&' : '?';
    return scopedBuildUrl(`${path}${separator}token=${encodeURIComponent(token)}`);
  }

  return { api: request, eventStreamUrl: streamUrl };
}

const defaultClient = createApiClient();

export async function api(path, options = {}) {
  return defaultClient.api(path, options);
}

export function eventStreamUrl(path) {
  return defaultClient.eventStreamUrl(path);
}

const DEFAULT_GAME_API_BASE_URL = 'https://avcb-api-prd.onrender.com';

function getApiBaseUrl() {
  const configured = window.__GAME_API_BASE_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/+$/, '');
  }

  return DEFAULT_GAME_API_BASE_URL;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      Accept: 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Falha na API de partidas (${response.status})`);
  }

  return response.json();
}

function normalizeMatchCounterPayload(payload) {
  return {
    totalMatches: Number(payload?.dados?.totalPartidas ?? 0),
    lastMatchAt: payload?.dados?.ultimaPartidaEm ?? null
  };
}

export async function fetchMatchCount() {
  const payload = await requestJson('/api/game/matches/count');
  return normalizeMatchCounterPayload(payload);
}

export async function registerStartedMatch() {
  const payload = await requestJson('/api/game/matches/start', {
    method: 'POST'
  });
  return normalizeMatchCounterPayload(payload);
}

function getApiBaseUrl() {
  const configured = window.__GAME_API_BASE_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/+$/, '');
  }

  const { protocol, hostname, origin } = window.location;
  if (protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }

  return origin.replace(/\/+$/, '');
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

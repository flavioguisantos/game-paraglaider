const DEFAULT_GAME_API_BASE_URL = 'https://avcb-api-prd.onrender.com';
const GAME_PLAYER_IDENTITY_KEY = 'jogo-parapente.game-player-identity.v1';
const PILOT_DISPLAY_NAME_KEY = 'jogo-parapente.pilot-display-name.v1';

export function getGameApiBaseUrl() {
  const configured = window.__GAME_API_BASE_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/+$/, '');
  }

  return DEFAULT_GAME_API_BASE_URL;
}

export function getGameRealtimeUrl() {
  const configured = window.__GAME_REALTIME_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/+$/, '');
  }

  const apiBaseUrl = new URL(getGameApiBaseUrl());
  const protocol = apiBaseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${apiBaseUrl.host}/api/game/realtime`;
}

export async function requestGameJson(path, options = {}) {
  const response = await fetch(`${getGameApiBaseUrl()}${path}`, {
    headers: {
      Accept: 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Falha na API do jogo (${response.status})`);
  }

  return response.json();
}

export async function fetchMatchCount() {
  const payload = await requestGameJson('/api/game/matches/count');
  return {
    totalMatches: Number(payload?.dados?.totalPartidas ?? 0),
    lastMatchAt: payload?.dados?.ultimaPartidaEm ?? null
  };
}

export async function registerStartedMatch() {
  const payload = await requestGameJson('/api/game/matches/start', {
    method: 'POST'
  });
  return {
    totalMatches: Number(payload?.dados?.totalPartidas ?? 0),
    lastMatchAt: payload?.dados?.ultimaPartidaEm ?? null
  };
}

export async function fetchLaunches() {
  const payload = await requestGameJson('/api/game/launches');
  return payload?.dados?.launches ?? [];
}

export async function fetchLaunchSession(launchId) {
  const payload = await requestGameJson(`/api/game/launches/${encodeURIComponent(launchId)}/session`);
  return payload?.dados ?? null;
}

export async function ensureGuestPlayerIdentity(options = {}) {
  const displayName = normalizePilotDisplayName(options.displayName);
  const preferredVehicleType = options.preferredVehicleType ?? 'paraglider';
  const cached = readStoredIdentity();
  if (
    cached?.accessToken
    && cached?.playerId
    && cached.displayName === displayName
    && cached.preferredVehicleType === preferredVehicleType
  ) {
    return cached;
  }

  const payload = await requestGameJson('/api/game/players/guest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      displayName,
      preferredVehicleType
    })
  });

  const identity = {
    playerId: payload?.dados?.playerId,
    displayName: payload?.dados?.displayName ?? displayName,
    preferredVehicleType: payload?.dados?.preferredVehicleType ?? preferredVehicleType,
    accessToken: payload?.dados?.access_token
  };
  writeStoredIdentity(identity);
  writeStoredPilotDisplayName(identity.displayName);
  return identity;
}

export function readStoredPilotDisplayName() {
  try {
    const raw = window.localStorage.getItem(PILOT_DISPLAY_NAME_KEY);
    if (!raw) return '';
    return normalizePilotDisplayName(raw);
  } catch {
    return '';
  }
}

export async function joinLaunchSession(launchId, identity, player) {
  const payload = await requestGameJson(`/api/game/launches/${encodeURIComponent(launchId)}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identity.accessToken}`
    },
    body: JSON.stringify({
      playerId: identity.playerId,
      ...player
    })
  });
  return payload?.dados ?? null;
}

export async function postPlayerState(launchId, identity, player) {
  const payload = await requestGameJson(`/api/game/launches/${encodeURIComponent(launchId)}/players/${encodeURIComponent(identity.playerId)}/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identity.accessToken}`
    },
    body: JSON.stringify({ player })
  });
  return payload?.dados ?? null;
}

export async function postPlayerResult(launchId, identity, status, result) {
  const payload = await requestGameJson(`/api/game/launches/${encodeURIComponent(launchId)}/players/${encodeURIComponent(identity.playerId)}/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identity.accessToken}`
    },
    body: JSON.stringify({ status, result })
  });
  return payload?.dados ?? null;
}

export async function leaveLaunchSession(launchId, identity) {
  return requestGameJson(`/api/game/launches/${encodeURIComponent(launchId)}/leave`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identity.accessToken}`
    },
    body: JSON.stringify({
      playerId: identity.playerId
    })
  });
}

function normalizePilotDisplayName(displayName) {
  const cleaned = String(displayName ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 24);
}

function readStoredIdentity() {
  try {
    const raw = window.localStorage.getItem(GAME_PLAYER_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.playerId || !parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredIdentity(identity) {
  try {
    window.localStorage.setItem(GAME_PLAYER_IDENTITY_KEY, JSON.stringify(identity));
  } catch {}
}

function writeStoredPilotDisplayName(displayName) {
  try {
    window.localStorage.setItem(PILOT_DISPLAY_NAME_KEY, normalizePilotDisplayName(displayName));
  } catch {}
}

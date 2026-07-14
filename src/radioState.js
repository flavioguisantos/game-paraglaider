export const RADIO_CHANNEL_STATUS = Object.freeze({
  IDLE: 'idle',
  REQUESTING: 'requesting',
  GRANTED: 'granted',
  BROADCASTING: 'broadcasting',
  RELEASING: 'releasing',
  OCCUPIED: 'occupied',
  ERROR: 'error'
});

export const RADIO_CLIENT_STATUS = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
  MIC_BLOCKED: 'mic_blocked',
  READY: 'ready',
  TRANSMITTING: 'transmitting',
  LISTENING: 'listening'
});

export const RADIO_RELEASE_REASONS = Object.freeze({
  BUTTON_RELEASE: 'button_release',
  CHANNEL_TAKEN: 'channel_taken',
  FORCE_STOP: 'force_stop',
  TIMEOUT: 'timeout',
  DISCONNECTED: 'disconnected',
  SESSION_LEFT: 'session_left',
  MIC_ERROR: 'mic_error'
});

export function createInitialRadioState({
  playerId = null,
  launchId = null
} = {}) {
  return {
    playerId,
    launchId,
    channelStatus: RADIO_CHANNEL_STATUS.IDLE,
    clientStatus: RADIO_CLIENT_STATUS.DISCONNECTED,
    speakerPlayerId: null,
    isMicArmed: false,
    isPressingTalk: false,
    canTransmit: false,
    expiresAt: null,
    errorCode: null,
    errorDetail: null,
    lastReleaseReason: null
  };
}

export function reduceRadioState(state, event) {
  const current = state ?? createInitialRadioState();
  const next = {
    ...current,
    errorCode: null,
    errorDetail: null
  };

  switch (event?.type) {
    case 'socket_connected':
      next.clientStatus = next.isMicArmed
        ? RADIO_CLIENT_STATUS.READY
        : RADIO_CLIENT_STATUS.CONNECTED;
      if (next.channelStatus === RADIO_CHANNEL_STATUS.ERROR) {
        next.channelStatus = RADIO_CHANNEL_STATUS.IDLE;
      }
      return next;

    case 'socket_disconnected':
      return applyRadioDisconnect(next, event.reason ?? RADIO_RELEASE_REASONS.DISCONNECTED);

    case 'session_joined':
      next.launchId = event.launchId ?? next.launchId;
      next.playerId = event.playerId ?? next.playerId;
      return next;

    case 'session_left':
      return {
        ...createInitialRadioState(),
        playerId: next.playerId,
        launchId: null,
        lastReleaseReason: RADIO_RELEASE_REASONS.SESSION_LEFT
      };

    case 'mic_ready':
      next.isMicArmed = true;
      if (next.clientStatus !== RADIO_CLIENT_STATUS.DISCONNECTED) {
        next.clientStatus = RADIO_CLIENT_STATUS.READY;
      }
      return next;

    case 'mic_denied':
      next.isMicArmed = false;
      next.clientStatus = RADIO_CLIENT_STATUS.MIC_BLOCKED;
      next.channelStatus = RADIO_CHANNEL_STATUS.ERROR;
      next.errorCode = 'mic_denied';
      next.errorDetail = event.detail ?? 'Permissao de microfone negada.';
      return next;

    case 'mic_lost':
      next.isMicArmed = false;
      next.clientStatus = RADIO_CLIENT_STATUS.MIC_BLOCKED;
      next.channelStatus = RADIO_CHANNEL_STATUS.ERROR;
      next.lastReleaseReason = RADIO_RELEASE_REASONS.MIC_ERROR;
      next.errorCode = 'mic_lost';
      next.errorDetail = event.detail ?? 'Microfone indisponivel.';
      next.canTransmit = false;
      next.isPressingTalk = false;
      return next;

    case 'press_to_talk_start':
      next.isPressingTalk = true;
      if (!canRequestTalk(next)) return next;
      next.channelStatus = RADIO_CHANNEL_STATUS.REQUESTING;
      return next;

    case 'press_to_talk_cancel':
    case 'press_to_talk_end':
      next.isPressingTalk = false;
      if (next.channelStatus === RADIO_CHANNEL_STATUS.REQUESTING) {
        next.channelStatus = RADIO_CHANNEL_STATUS.IDLE;
      } else if (isSpeaker(next)) {
        next.channelStatus = RADIO_CHANNEL_STATUS.RELEASING;
      }
      return next;

    case 'radio_granted':
      next.speakerPlayerId = event.speakerPlayerId ?? next.playerId;
      next.expiresAt = event.expiresAt ?? null;
      next.canTransmit = isSpeaker(next);
      if (next.canTransmit) {
        next.channelStatus = next.isPressingTalk
          ? RADIO_CHANNEL_STATUS.BROADCASTING
          : RADIO_CHANNEL_STATUS.GRANTED;
        next.clientStatus = RADIO_CLIENT_STATUS.TRANSMITTING;
      } else {
        next.channelStatus = RADIO_CHANNEL_STATUS.OCCUPIED;
        next.clientStatus = RADIO_CLIENT_STATUS.LISTENING;
      }
      return next;

    case 'radio_busy':
      next.channelStatus = RADIO_CHANNEL_STATUS.OCCUPIED;
      next.speakerPlayerId = event.speakerPlayerId ?? next.speakerPlayerId;
      next.expiresAt = event.expiresAt ?? next.expiresAt;
      if (!isSpeaker(next) && next.clientStatus !== RADIO_CLIENT_STATUS.MIC_BLOCKED) {
        next.clientStatus = RADIO_CLIENT_STATUS.LISTENING;
      }
      next.canTransmit = false;
      return next;

    case 'radio_released':
      return clearChannel(next, event.reason ?? RADIO_RELEASE_REASONS.BUTTON_RELEASE);

    case 'radio_force_stop':
      return applyRadioError(
        clearChannel(next, event.reason ?? RADIO_RELEASE_REASONS.FORCE_STOP),
        'force_stop',
        event.detail ?? 'Transmissao interrompida pelo servidor.'
      );

    case 'radio_timeout':
      return applyRadioError(
        clearChannel(next, RADIO_RELEASE_REASONS.TIMEOUT),
        'timeout',
        event.detail ?? 'Tempo maximo de transmissao atingido.'
      );

    case 'radio_error':
      return applyRadioError(
        next,
        event.code ?? 'radio_error',
        event.detail ?? 'Falha no radio.'
      );

    case 'session_radio_state':
      return reconcileSessionRadioState(next, event.radio ?? null);

    default:
      return next;
  }
}

export function canRequestTalk(state) {
  return state.clientStatus === RADIO_CLIENT_STATUS.READY
    && state.channelStatus === RADIO_CHANNEL_STATUS.IDLE
    && !state.speakerPlayerId;
}

export function isSpeaker(state) {
  return Boolean(state.playerId) && state.speakerPlayerId === state.playerId;
}

function applyRadioDisconnect(state, reason) {
  const next = clearChannel(state, reason);
  next.clientStatus = RADIO_CLIENT_STATUS.DISCONNECTED;
  next.isPressingTalk = false;
  next.isMicArmed = false;
  next.launchId = null;
  return next;
}

function clearChannel(state, reason) {
  const next = {
    ...state,
    channelStatus: RADIO_CHANNEL_STATUS.IDLE,
    speakerPlayerId: null,
    expiresAt: null,
    canTransmit: false,
    lastReleaseReason: reason ?? null
  };

  if (next.clientStatus !== RADIO_CLIENT_STATUS.DISCONNECTED) {
    next.clientStatus = next.isMicArmed
      ? RADIO_CLIENT_STATUS.READY
      : RADIO_CLIENT_STATUS.CONNECTED;
  }

  return next;
}

function applyRadioError(state, errorCode, errorDetail) {
  state.channelStatus = RADIO_CHANNEL_STATUS.ERROR;
  state.canTransmit = false;
  state.errorCode = errorCode;
  state.errorDetail = errorDetail;
  if (state.clientStatus !== RADIO_CLIENT_STATUS.DISCONNECTED
    && state.clientStatus !== RADIO_CLIENT_STATUS.MIC_BLOCKED) {
    state.clientStatus = state.isMicArmed
      ? RADIO_CLIENT_STATUS.READY
      : RADIO_CLIENT_STATUS.CONNECTED;
  }
  return state;
}

function reconcileSessionRadioState(state, radio) {
  if (!radio || radio.status === RADIO_CHANNEL_STATUS.IDLE) {
    return clearChannel(state, state.lastReleaseReason);
  }

  const next = {
    ...state,
    speakerPlayerId: radio.speakerPlayerId ?? null,
    expiresAt: radio.expiresAt ?? null,
    canTransmit: false
  };

  if (isSpeaker(next)) {
    next.channelStatus = next.isPressingTalk
      ? RADIO_CHANNEL_STATUS.BROADCASTING
      : RADIO_CHANNEL_STATUS.GRANTED;
    next.clientStatus = RADIO_CLIENT_STATUS.TRANSMITTING;
    next.canTransmit = true;
  } else {
    next.channelStatus = RADIO_CHANNEL_STATUS.OCCUPIED;
    if (next.clientStatus !== RADIO_CLIENT_STATUS.DISCONNECTED
      && next.clientStatus !== RADIO_CLIENT_STATUS.MIC_BLOCKED) {
      next.clientStatus = RADIO_CLIENT_STATUS.LISTENING;
    }
  }

  return next;
}

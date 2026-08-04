import { getGameRealtimeUrl } from './gameApi.js';

export function createGameRealtimeClient(handlers = {}) {
  let socket = null;
  let joinedLaunchId = null;
  let identity = null;
  let heartbeatTimer = null;
  let hasJoinedLaunch = false;
  let pendingMessages = [];

  function connect({ launchId, playerIdentity, player }) {
    disconnect({ notifyLeave: false });
    joinedLaunchId = launchId;
    identity = playerIdentity;
    hasJoinedLaunch = false;
    pendingMessages = [];
    socket = new WebSocket(getGameRealtimeUrl());

    socket.addEventListener('open', () => {
      handlers.onOpen?.();
      send({
        type: 'join_launch',
        token: identity.accessToken,
        launchId,
        playerId: identity.playerId,
        player
      });
    });

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        handlers.onError?.(error);
      }
    });

    socket.addEventListener('close', () => {
      stopHeartbeat();
      handlers.onClose?.();
    });

    socket.addEventListener('error', (event) => {
      handlers.onError?.(event);
    });
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'joined_launch':
        hasJoinedLaunch = true;
        flushPendingMessages();
        startHeartbeat();
        handlers.onSessionMessage?.(message);
        return;
      case 'presence_update':
      case 'world_snapshot':
      case 'round_event':
      case 'radio_talk_granted':
      case 'radio_talk_denied':
      case 'radio_talk_released':
      case 'radio_force_stop':
      case 'radio_offer':
      case 'radio_answer':
      case 'radio_ice_candidate':
        handlers.onSessionMessage?.(message);
        return;
      case 'error':
        handlers.onError?.(new Error(message.error ?? 'Erro no canal realtime.'));
        return;
      default:
        handlers.onMessage?.(message);
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      send({
        type: 'heartbeat',
        status: 'connected'
      });
    }, 10000);
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function sendPlayerState(player) {
    send({
      type: 'player_state',
      player
    });
  }

  function sendPlayerResult(status, result) {
    send({
      type: 'player_result',
      status,
      result
    });
  }

  function requestSnapshot(launchId = joinedLaunchId) {
    if (!launchId) return;
    send({
      type: 'get_snapshot',
      launchId
    });
  }

  function disconnect({ notifyLeave = true } = {}) {
    if (notifyLeave && socket?.readyState === WebSocket.OPEN) {
      send({
        type: 'leave_launch',
        reason: 'left'
      });
    }

    stopHeartbeat();
    hasJoinedLaunch = false;
    pendingMessages = [];
    if (socket) {
      socket.close();
      socket = null;
    }
  }

  function sendRadioRequestTalk() {
    send({
      type: 'radio_request_talk'
    });
  }

  function sendRadioReleaseTalk(reason = 'button_release') {
    send({
      type: 'radio_release_talk',
      reason
    });
  }

  function sendRadioOffer(targetPlayerId, sdp) {
    send({
      type: 'radio_offer',
      targetPlayerId,
      sdp
    });
  }

  function sendRadioAnswer(targetPlayerId, sdp) {
    send({
      type: 'radio_answer',
      targetPlayerId,
      sdp
    });
  }

  function sendRadioIceCandidate(targetPlayerId, candidate) {
    send({
      type: 'radio_ice_candidate',
      targetPlayerId,
      candidate
    });
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!hasJoinedLaunch && payload.type !== 'join_launch') {
      pendingMessages.push(payload);
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function flushPendingMessages() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !hasJoinedLaunch || pendingMessages.length === 0) return;

    const queue = pendingMessages;
    pendingMessages = [];
    for (const payload of queue) {
      socket.send(JSON.stringify(payload));
    }
  }

  return {
    connect,
    disconnect,
    requestSnapshot,
    sendRadioAnswer,
    sendRadioIceCandidate,
    sendRadioOffer,
    sendRadioReleaseTalk,
    sendRadioRequestTalk,
    sendPlayerResult,
    sendPlayerState
  };
}

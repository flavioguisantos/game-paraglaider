import { getGameRealtimeUrl } from './gameApi.js';

export function createGameRealtimeClient(handlers = {}) {
  let socket = null;
  let joinedLaunchId = null;
  let identity = null;
  let heartbeatTimer = null;

  function connect({ launchId, playerIdentity, player }) {
    disconnect({ notifyLeave: false });
    joinedLaunchId = launchId;
    identity = playerIdentity;
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
      startHeartbeat();
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
      case 'presence_update':
      case 'world_snapshot':
      case 'round_event':
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
    if (socket) {
      socket.close();
      socket = null;
    }
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  return {
    connect,
    disconnect,
    requestSnapshot,
    sendPlayerResult,
    sendPlayerState
  };
}

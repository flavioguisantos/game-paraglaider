const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const OFFER_CREATE_TIMEOUT_MS = 5000;
const LOCAL_DESCRIPTION_TIMEOUT_MS = 5000;
const BROADCAST_OFFER_RETRY_LIMIT = 1;

export function createRadioVoiceClient({ onError, onDebugEvent } = {}) {
  let identity = null;
  let launchId = null;
  let localStream = null;
  let preparedMic = false;
  let peerInstanceCounter = 0;
  const peers = new Map();
  const audioElements = new Map();

  function setIdentity(nextIdentity) {
    identity = nextIdentity ?? null;
  }

  function setLaunchId(nextLaunchId) {
    launchId = nextLaunchId ?? null;
  }

  async function prepareMicrophone() {
    if (localStream) return localStream;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microfone nao suportado neste navegador.');
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    preparedMic = true;
    onDebugEvent?.('mic_stream_ready', {
      audioTracks: localStream.getAudioTracks().length
    });
    return localStream;
  }

  async function startBroadcast(listenerPlayerIds, signaling) {
    await prepareMicrophone();
    onDebugEvent?.('broadcast_start', {
      listeners: listenerPlayerIds.length
    });
    closeAllPeers();
    for (const playerId of listenerPlayerIds) {
      if (!playerId) {
        onDebugEvent?.('broadcast_listener_skipped', {
          reason: 'missing_player_id'
        });
        continue;
      }
      if (playerId === identity?.playerId) {
        onDebugEvent?.('broadcast_listener_skipped', {
          reason: 'self_target',
          targetPlayerId: playerId
        });
        continue;
      }
      await startBroadcastForListener(playerId, signaling);
    }
  }

  async function handleSignal(message, signaling) {
    const sourcePlayerId = message.sourcePlayerId;
    if (!sourcePlayerId || sourcePlayerId === identity?.playerId) return;

    switch (message.type) {
      case 'radio_offer': {
        onDebugEvent?.('offer_received', { sourcePlayerId });
        const peer = createPeerConnection(sourcePlayerId, signaling);
        await peer.setRemoteDescription({
          type: 'offer',
          sdp: normalizeSessionDescriptionSdp(message.sdp)
        });
        const answer = await peer.createAnswer();
        const normalizedAnswerSdp = normalizeSessionDescriptionSdp(answer.sdp);
        await peer.setLocalDescription({ type: 'answer', sdp: normalizedAnswerSdp });
        onDebugEvent?.('answer_created', { targetPlayerId: sourcePlayerId });
        signaling.sendAnswer(sourcePlayerId, normalizedAnswerSdp);
        return;
      }
      case 'radio_answer': {
        onDebugEvent?.('answer_received', { sourcePlayerId });
        const peer = getActivePeer(sourcePlayerId);
        if (!peer) return;
        await peer.setRemoteDescription({
          type: 'answer',
          sdp: normalizeSessionDescriptionSdp(message.sdp)
        });
        return;
      }
      case 'radio_ice_candidate': {
        onDebugEvent?.('ice_received', { sourcePlayerId });
        const peer = getActivePeer(sourcePlayerId);
        if (!peer || !message.candidate) return;
        await peer.addIceCandidate(message.candidate);
      }
    }
  }

  function stopBroadcast() {
    stopTracks();
    closeAllPeers();
  }

  function stopListening() {
    closeAllPeers();
    removeAllAudioElements();
  }

  function dispose() {
    stopBroadcast();
    stopListening();
    identity = null;
    launchId = null;
  }

  function isMicrophonePrepared() {
    return preparedMic;
  }

  function createPeerConnection(targetPlayerId, signaling, { replaceExisting = false } = {}) {
    if (replaceExisting && peers.has(targetPlayerId)) {
      detachPeer(targetPlayerId);
    }

    const currentEntry = peers.get(targetPlayerId);
    if (currentEntry?.peer) return currentEntry.peer;

    const peer = new RTCPeerConnection({ iceServers: getIceServers() });
    const peerEntry = {
      peer,
      targetPlayerId,
      instanceId: ++peerInstanceCounter
    };
    peers.set(targetPlayerId, peerEntry);

    peer.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return;
      if (!isCurrentPeerInstance(targetPlayerId, peerEntry.instanceId, peer)) return;
      try {
        onDebugEvent?.('ice_sent', { targetPlayerId });
        signaling.sendIceCandidate(targetPlayerId, event.candidate.toJSON?.() ?? event.candidate);
      } catch (error) {
        onError?.(error);
      }
    });

    peer.addEventListener('track', (event) => {
      if (!isCurrentPeerInstance(targetPlayerId, peerEntry.instanceId, peer)) return;
      const [stream] = event.streams;
      if (!stream) return;
      onDebugEvent?.('remote_track', {
        targetPlayerId,
        audioTracks: stream.getAudioTracks().length
      });
      attachRemoteStream(targetPlayerId, stream);
    });

    peer.addEventListener('connectionstatechange', () => {
      if (!isCurrentPeerInstance(targetPlayerId, peerEntry.instanceId, peer)) return;
      onDebugEvent?.('peer_connection_state', {
        targetPlayerId,
        state: peer.connectionState
      });
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        detachPeer(targetPlayerId, { expectedPeer: peer, expectedInstanceId: peerEntry.instanceId });
      }
    });

    peer.addEventListener('iceconnectionstatechange', () => {
      if (!isCurrentPeerInstance(targetPlayerId, peerEntry.instanceId, peer)) return;
      onDebugEvent?.('peer_ice_state', {
        targetPlayerId,
        state: peer.iceConnectionState
      });
    });

    return peer;
  }

  function attachRemoteStream(playerId, stream) {
    let audio = audioElements.get(playerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.radioPlayerId = playerId;
      audio.style.display = 'none';
      document.body.append(audio);
      audioElements.set(playerId, audio);
    }
    if (audio.srcObject !== stream) {
      audio.srcObject = stream;
      onDebugEvent?.('remote_audio_attached', { playerId });
      audio.play().catch((error) => onError?.(error));
    }
  }

  function detachPeer(playerId, { expectedPeer = null, expectedInstanceId = null } = {}) {
    const peerEntry = peers.get(playerId);
    const peer = peerEntry?.peer ?? null;
    if (expectedPeer && peer !== expectedPeer) {
      expectedPeer.close();
      return;
    }
    if (expectedInstanceId && peerEntry?.instanceId !== expectedInstanceId) {
      expectedPeer?.close();
      return;
    }
    if (peer) {
      peer.close();
      peers.delete(playerId);
      onDebugEvent?.('peer_detached', {
        playerId,
        instanceId: peerEntry?.instanceId ?? null
      });
    }
    const audio = audioElements.get(playerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      audioElements.delete(playerId);
    }
  }

  function closeAllPeers() {
    for (const playerId of [...peers.keys()]) {
      detachPeer(playerId);
    }
  }

  function removeAllAudioElements() {
    for (const [playerId] of audioElements.entries()) {
      detachPeer(playerId);
    }
  }

  function stopTracks() {
    if (!localStream) return;
    for (const track of localStream.getTracks()) {
      track.stop();
    }
    localStream = null;
    preparedMic = false;
  }

  function getActivePeer(playerId) {
    return peers.get(playerId)?.peer ?? null;
  }

  function isCurrentPeerInstance(playerId, instanceId, peer) {
    const currentEntry = peers.get(playerId);
    return currentEntry?.instanceId === instanceId && currentEntry.peer === peer;
  }

  async function startBroadcastForListener(targetPlayerId, signaling) {
    for (let attempt = 0; attempt <= BROADCAST_OFFER_RETRY_LIMIT; attempt += 1) {
      let peer = null;
      try {
        onDebugEvent?.('broadcast_listener_begin', {
          targetPlayerId,
          attempt: attempt + 1
        });
        peer = createPeerConnection(targetPlayerId, signaling, { replaceExisting: true });
        onDebugEvent?.('broadcast_peer_ready', {
          targetPlayerId,
          attempt: attempt + 1
        });

        const track = await getBroadcastAudioTrack({ forceRefresh: attempt > 0 });
        const transceiver = peer.addTransceiver('audio', { direction: 'sendonly' });
        await transceiver.sender.replaceTrack(track);
        onDebugEvent?.('broadcast_track_added', {
          targetPlayerId,
          attempt: attempt + 1,
          trackKind: track.kind,
          trackState: track.readyState
        });

        onDebugEvent?.('broadcast_offer_creating', {
          targetPlayerId,
          attempt: attempt + 1
        });
        const offer = await withTimeout(
          peer.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
          }),
          OFFER_CREATE_TIMEOUT_MS,
          () => {
            onDebugEvent?.('broadcast_offer_timeout', {
              targetPlayerId,
              attempt: attempt + 1,
              signalingState: peer.signalingState,
              connectionState: peer.connectionState,
              iceConnectionState: peer.iceConnectionState
            });
          },
          'Timeout ao criar oferta WebRTC do radio.'
        );
        onDebugEvent?.('broadcast_offer_created_raw', {
          targetPlayerId,
          attempt: attempt + 1,
          sdpLength: typeof offer.sdp === 'string' ? offer.sdp.length : 0
        });

        const normalizedOfferSdp = normalizeSessionDescriptionSdp(offer.sdp);
        onDebugEvent?.('broadcast_offer_normalized', {
          targetPlayerId,
          attempt: attempt + 1,
          sdpLength: normalizedOfferSdp.length
        });

        await withTimeout(
          peer.setLocalDescription({ type: 'offer', sdp: normalizedOfferSdp }),
          LOCAL_DESCRIPTION_TIMEOUT_MS,
          () => {
            onDebugEvent?.('broadcast_local_description_timeout', {
              targetPlayerId,
              attempt: attempt + 1,
              signalingState: peer.signalingState,
              connectionState: peer.connectionState,
              iceConnectionState: peer.iceConnectionState
            });
          },
          'Timeout ao aplicar localDescription WebRTC do radio.'
        );
        onDebugEvent?.('broadcast_local_description_set', {
          targetPlayerId,
          attempt: attempt + 1
        });
        onDebugEvent?.('offer_created', {
          targetPlayerId,
          attempt: attempt + 1
        });
        signaling.sendOffer(targetPlayerId, normalizedOfferSdp);
        onDebugEvent?.('broadcast_offer_sent', {
          targetPlayerId,
          attempt: attempt + 1
        });
        return;
      } catch (error) {
        onDebugEvent?.('broadcast_listener_failed', {
          targetPlayerId,
          attempt: attempt + 1,
          message: error?.message ?? String(error),
          signalingState: typeof peer?.signalingState === 'string' ? peer.signalingState : null,
          connectionState: typeof peer?.connectionState === 'string' ? peer.connectionState : null,
          iceConnectionState: typeof peer?.iceConnectionState === 'string' ? peer.iceConnectionState : null
        });
        detachPeer(targetPlayerId);

        if (attempt < BROADCAST_OFFER_RETRY_LIMIT && shouldRetryBroadcastOffer(error)) {
          onDebugEvent?.('broadcast_listener_retry', {
            targetPlayerId,
            nextAttempt: attempt + 2,
            reason: error?.message ?? String(error)
          });
          continue;
        }

        onError?.(error);
        return;
      }
    }
  }

  async function getBroadcastAudioTrack({ forceRefresh = false } = {}) {
    if (forceRefresh) {
      stopTracks();
    }

    const stream = await prepareMicrophone();
    const track = stream.getAudioTracks().find((entry) => entry.readyState === 'live');
    if (!track) {
      throw new Error('Nenhuma faixa de audio ativa disponivel para o radio.');
    }
    return track;
  }

  return {
    dispose,
    handleSignal,
    isMicrophonePrepared,
    prepareMicrophone,
    setIdentity,
    setLaunchId,
    startBroadcast,
    stopBroadcast,
    stopListening,
  };
}

function getIceServers() {
  const configured = window.__GAME_WEBRTC_ICE_SERVERS;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_ICE_SERVERS;
}

function normalizeSessionDescriptionSdp(sdp) {
  if (typeof sdp !== 'string') {
    throw new Error('SDP invalido para sinalizacao de radio.');
  }

  const normalizedLines = sdp
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  while (normalizedLines.length && normalizedLines.at(-1) === '') {
    normalizedLines.pop();
  }

  return `${normalizedLines.join('\r\n')}\r\n`;
}

function withTimeout(promise, timeoutMs, onTimeout, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout?.();
      } catch {}
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function shouldRetryBroadcastOffer(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('timeout')
    || message.includes('setlocaldescription')
    || message.includes('criar oferta webrtc');
}

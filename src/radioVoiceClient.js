const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const OFFER_CREATE_TIMEOUT_MS = 5000;
const LOCAL_DESCRIPTION_TIMEOUT_MS = 5000;
const LISTEN_OFFER_RETRY_LIMIT = 1;

export function createRadioVoiceClient({ onError, onDebugEvent } = {}) {
  let identity = null;
  let launchId = null;
  let localStream = null;
  let preparedMic = false;
  let peerInstanceCounter = 0;
  let activeListeningSpeakerId = null;
  let activeListeningPromise = null;
  const peers = new Map();
  const audioElements = new Map();
  const outboundAudioSenders = new WeakMap();

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
    closePeersByRole('speaker');
    onDebugEvent?.('broadcast_start', {
      listeners: listenerPlayerIds.length,
      launchId
    });

    for (const playerId of listenerPlayerIds) {
      if (!playerId || playerId === identity?.playerId) continue;
      onDebugEvent?.('broadcast_listener_ready', {
        targetPlayerId: playerId
      });
    }

    void signaling;
  }

  async function startListeningToSpeaker(speakerPlayerId, signaling) {
    if (!speakerPlayerId || speakerPlayerId === identity?.playerId) return;

    const currentEntry = peers.get(speakerPlayerId);
    if (activeListeningSpeakerId === speakerPlayerId) {
      if (activeListeningPromise) {
        await activeListeningPromise;
        return;
      }
      if (currentEntry?.role === 'listener' && currentEntry.peer.signalingState !== 'closed') {
        return;
      }
    }

    stopListening();
    activeListeningSpeakerId = speakerPlayerId;
    const promise = negotiateListeningPeer(speakerPlayerId, signaling);
    activeListeningPromise = promise;

    try {
      await promise;
    } finally {
      if (activeListeningPromise === promise) {
        activeListeningPromise = null;
      }
    }
  }

  async function handleSignal(message, signaling) {
    const sourcePlayerId = message.sourcePlayerId;
    if (!sourcePlayerId || sourcePlayerId === identity?.playerId) return;

    switch (message.type) {
      case 'radio_offer': {
        onDebugEvent?.('offer_received', { sourcePlayerId });
        const peer = createPeerConnection(sourcePlayerId, signaling, {
          role: 'speaker',
          replaceExisting: true
        });
        assertPeerOpen(peer, 'Peer fechado antes de receber oferta de radio.');
        await peer.setRemoteDescription({
          type: 'offer',
          sdp: normalizeSessionDescriptionSdp(message.sdp)
        });
        await attachOutboundTrack(sourcePlayerId, peer);
        const answer = await peer.createAnswer();
        const normalizedAnswerSdp = normalizeSessionDescriptionSdp(answer.sdp);
        await peer.setLocalDescription({ type: 'answer', sdp: normalizedAnswerSdp });
        onDebugEvent?.('answer_created', { targetPlayerId: sourcePlayerId });
        signaling.sendAnswer(sourcePlayerId, normalizedAnswerSdp);
        return;
      }
      case 'radio_answer': {
        onDebugEvent?.('answer_received', { sourcePlayerId });
        const peer = getActivePeer(sourcePlayerId, 'listener');
        if (!peer || peer.signalingState === 'closed') return;
        await peer.setRemoteDescription({
          type: 'answer',
          sdp: normalizeSessionDescriptionSdp(message.sdp)
        });
        onDebugEvent?.('listen_remote_description_set', {
          sourcePlayerId
        });
        return;
      }
      case 'radio_ice_candidate': {
        onDebugEvent?.('ice_received', { sourcePlayerId });
        const peer = getActivePeer(sourcePlayerId);
        if (!peer || !message.candidate || peer.signalingState === 'closed') return;
        await peer.addIceCandidate(message.candidate);
      }
    }
  }

  function stopBroadcast() {
    stopTracks();
    closePeersByRole('speaker');
  }

  function stopListening() {
    activeListeningSpeakerId = null;
    activeListeningPromise = null;
    closePeersByRole('listener');
    removeAllAudioElements();
  }

  function dispose() {
    stopBroadcast();
    stopListening();
    closeAllPeers();
    identity = null;
    launchId = null;
  }

  function isMicrophonePrepared() {
    return preparedMic;
  }

  function getListeningSpeakerPlayerId() {
    return activeListeningSpeakerId;
  }

  function createPeerConnection(targetPlayerId, signaling, { role, replaceExisting = false } = {}) {
    if (replaceExisting && peers.has(targetPlayerId)) {
      detachPeer(targetPlayerId);
    }

    const currentEntry = peers.get(targetPlayerId);
    if (currentEntry?.peer && currentEntry.role === role) {
      return currentEntry.peer;
    }

    const peer = new RTCPeerConnection({ iceServers: getIceServers() });
    const peerEntry = {
      peer,
      role,
      targetPlayerId,
      instanceId: ++peerInstanceCounter
    };
    peers.set(targetPlayerId, peerEntry);

    peer.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return;
      if (!isCurrentPeerInstance(targetPlayerId, peerEntry.instanceId, peer)) return;
      try {
        onDebugEvent?.('ice_sent', {
          targetPlayerId,
          role
        });
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
        role,
        audioTracks: stream.getAudioTracks().length
      });
      attachRemoteStream(targetPlayerId, stream);
    });

    peer.addEventListener('connectionstatechange', () => {
      if (!isCurrentPeerInstance(targetPlayerId, peerEntry.instanceId, peer)) return;
      onDebugEvent?.('peer_connection_state', {
        targetPlayerId,
        role,
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
        role,
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
        role: peerEntry?.role ?? null,
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
    if (activeListeningSpeakerId === playerId) {
      activeListeningSpeakerId = null;
    }
  }

  function closePeersByRole(role) {
    for (const [playerId, entry] of peers.entries()) {
      if (entry.role !== role) continue;
      detachPeer(playerId);
    }
  }

  function closeAllPeers() {
    for (const playerId of [...peers.keys()]) {
      detachPeer(playerId);
    }
  }

  function removeAllAudioElements() {
    for (const audio of audioElements.values()) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    audioElements.clear();
  }

  function stopTracks() {
    if (!localStream) return;
    for (const track of localStream.getTracks()) {
      track.stop();
    }
    localStream = null;
    preparedMic = false;
  }

  function getActivePeer(playerId, role = null) {
    const entry = peers.get(playerId);
    if (!entry) return null;
    if (role && entry.role !== role) return null;
    return entry.peer;
  }

  function isCurrentPeerInstance(playerId, instanceId, peer) {
    const currentEntry = peers.get(playerId);
    return currentEntry?.instanceId === instanceId && currentEntry.peer === peer;
  }

  async function negotiateListeningPeer(targetPlayerId, signaling) {
    for (let attempt = 0; attempt <= LISTEN_OFFER_RETRY_LIMIT; attempt += 1) {
      let peer = null;
      try {
        onDebugEvent?.('listen_speaker_begin', {
          targetPlayerId,
          attempt: attempt + 1
        });
        peer = createPeerConnection(targetPlayerId, signaling, {
          role: 'listener',
          replaceExisting: true
        });
        assertPeerOpen(peer, 'Peer fechado antes da negociacao de escuta.');
        peer.addTransceiver('audio', { direction: 'recvonly' });
        onDebugEvent?.('listen_offer_creating', {
          targetPlayerId,
          attempt: attempt + 1
        });

        const offer = await withTimeout(
          peer.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
          }),
          OFFER_CREATE_TIMEOUT_MS,
          () => {
            onDebugEvent?.('listen_offer_timeout', {
              targetPlayerId,
              attempt: attempt + 1,
              signalingState: peer.signalingState,
              connectionState: peer.connectionState,
              iceConnectionState: peer.iceConnectionState
            });
          },
          'Timeout ao criar oferta WebRTC do ouvinte.'
        );

        const normalizedOfferSdp = normalizeSessionDescriptionSdp(offer.sdp);
        await withTimeout(
          peer.setLocalDescription({ type: 'offer', sdp: normalizedOfferSdp }),
          LOCAL_DESCRIPTION_TIMEOUT_MS,
          () => {
            onDebugEvent?.('listen_local_description_timeout', {
              targetPlayerId,
              attempt: attempt + 1,
              signalingState: peer.signalingState,
              connectionState: peer.connectionState,
              iceConnectionState: peer.iceConnectionState
            });
          },
          'Timeout ao aplicar localDescription WebRTC do ouvinte.'
        );

        onDebugEvent?.('listen_offer_sent', {
          targetPlayerId,
          attempt: attempt + 1
        });
        signaling.sendOffer(targetPlayerId, normalizedOfferSdp);
        return;
      } catch (error) {
        onDebugEvent?.('listen_speaker_failed', {
          targetPlayerId,
          attempt: attempt + 1,
          message: error?.message ?? String(error),
          signalingState: typeof peer?.signalingState === 'string' ? peer.signalingState : null,
          connectionState: typeof peer?.connectionState === 'string' ? peer.connectionState : null,
          iceConnectionState: typeof peer?.iceConnectionState === 'string' ? peer.iceConnectionState : null
        });
        detachPeer(targetPlayerId);

        if (attempt < LISTEN_OFFER_RETRY_LIMIT && shouldRetryNegotiation(error)) {
          onDebugEvent?.('listen_speaker_retry', {
            targetPlayerId,
            nextAttempt: attempt + 2,
            reason: error?.message ?? String(error)
          });
          continue;
        }

        activeListeningSpeakerId = null;
        onError?.(error);
        return;
      }
    }
  }

  async function attachOutboundTrack(targetPlayerId, peer) {
    const track = await getBroadcastAudioTrack();
    const stream = await prepareMicrophone();
    let sender = outboundAudioSenders.get(peer);
    if (!sender) {
      sender = peer.addTrack(track, stream);
      outboundAudioSenders.set(peer, sender);
    } else {
      await sender.replaceTrack(track);
    }
    onDebugEvent?.('broadcast_track_added', {
      targetPlayerId,
      trackKind: track.kind,
      trackState: track.readyState
    });
  }

  async function getBroadcastAudioTrack() {
    const stream = await prepareMicrophone();
    const track = stream.getAudioTracks().find((entry) => entry.readyState === 'live');
    if (!track) {
      throw new Error('Nenhuma faixa de audio ativa disponivel para o radio.');
    }
    return track;
  }

  return {
    dispose,
    getListeningSpeakerPlayerId,
    handleSignal,
    isMicrophonePrepared,
    prepareMicrophone,
    setIdentity,
    setLaunchId,
    startBroadcast,
    startListeningToSpeaker,
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

function shouldRetryNegotiation(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('timeout')
    || message.includes('setlocaldescription')
    || message.includes('criar oferta webrtc')
    || message.includes('peer fechado');
}

function assertPeerOpen(peer, message) {
  if (!peer || peer.signalingState === 'closed') {
    throw new Error(message);
  }
}

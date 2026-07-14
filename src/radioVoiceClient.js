const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function createRadioVoiceClient({ onError } = {}) {
  let identity = null;
  let launchId = null;
  let localStream = null;
  let preparedMic = false;
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
    return localStream;
  }

  async function startBroadcast(listenerPlayerIds, signaling) {
    const stream = await prepareMicrophone();
    for (const playerId of listenerPlayerIds) {
      if (!playerId || playerId === identity?.playerId || peers.has(playerId)) continue;
      const peer = createPeerConnection(playerId, signaling);
      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
      }
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signaling.sendOffer(playerId, offer.sdp);
    }
  }

  async function handleSignal(message, signaling) {
    const sourcePlayerId = message.sourcePlayerId;
    if (!sourcePlayerId || sourcePlayerId === identity?.playerId) return;

    switch (message.type) {
      case 'radio_offer': {
        const peer = createPeerConnection(sourcePlayerId, signaling);
        await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        signaling.sendAnswer(sourcePlayerId, answer.sdp);
        return;
      }
      case 'radio_answer': {
        const peer = peers.get(sourcePlayerId);
        if (!peer) return;
        await peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        return;
      }
      case 'radio_ice_candidate': {
        const peer = peers.get(sourcePlayerId);
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

  function createPeerConnection(targetPlayerId, signaling) {
    let peer = peers.get(targetPlayerId);
    if (peer) return peer;

    peer = new RTCPeerConnection({ iceServers: getIceServers() });
    peers.set(targetPlayerId, peer);

    peer.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return;
      try {
        signaling.sendIceCandidate(targetPlayerId, event.candidate.toJSON?.() ?? event.candidate);
      } catch (error) {
        onError?.(error);
      }
    });

    peer.addEventListener('track', (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      attachRemoteStream(targetPlayerId, stream);
    });

    peer.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        detachPeer(targetPlayerId);
      }
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
      audio.play().catch((error) => onError?.(error));
    }
  }

  function detachPeer(playerId) {
    const peer = peers.get(playerId);
    if (peer) {
      peer.close();
      peers.delete(playerId);
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

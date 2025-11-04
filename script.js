/* script.js — Debug & resilient voice chat
   Version: 20251104_01
   Notes: Replace or add servers in SIGNAL_SERVERS array if you have a preferred signaling endpoint.
*/

console.log('script.js loaded — version 20251104_01');

const UI = {
  startBtn: document.getElementById('startBtn'),
  muteBtn: document.getElementById('muteBtn'),
  hangupBtn: document.getElementById('hangupBtn'),
  status: document.getElementById('status'),
  remoteAudio: document.getElementById('remoteAudio')
};

const CONFIG = {
  // Try multiple signaling servers in order. Keep the old dead URL in the list so the code demonstrates fallback.
  SIGNAL_SERVERS: [
    'wss://signal.emn178.workers.dev',            // historically used, may be dead
    'wss://wrtc-signaling-eu.herokuapp.com',      // community examples (may go down over time)
    'wss://demo-signaling-server.example.invalid' // placeholder (won't connect) — replace with known working server if you have one
  ],
  WS_TRY_TIMEOUT_MS: 6000,  // how long to wait for a server to open before trying next
  WS_RECONNECT_MAX: 5,
  ICE: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// internal state
let roomId;
let signaling = null;
let signalingQueue = []; // messages waiting to be sent until WS is open
let signalingIndex = 0;  // index of current server we're trying
let wsReconnectAttempts = 0;

let pc = null;
let localStream = null;
let isMuted = false;

function setStatus(s) {
  UI.status.textContent = s;
  console.log('STATUS:', s);
}

function getRoomId() {
  if (!location.hash) {
    location.hash = Math.random().toString(36).slice(2, 10);
  }
  return location.hash.slice(1);
}

// Queue send — will send immediately if WS open, otherwise push
function signalingSend(obj) {
  const payload = JSON.stringify(obj);
  try {
    if (signaling && signaling.readyState === WebSocket.OPEN) {
      console.log('signalingSend -> sending immediately', obj);
      signaling.send(payload);
    } else {
      console.warn('signalingSend -> WS not open. Queuing message', obj, 'readyState:', signaling && signaling.readyState);
      signalingQueue.push(payload);
    }
  } catch (err) {
    console.error('signalingSend exception:', err, 'readyState:', signaling && signaling.readyState);
    signalingQueue.push(payload);
  }
}

// Flush queued messages (called after WS open)
function flushQueue() {
  if (!signaling || signaling.readyState !== WebSocket.OPEN) {
    console.warn('flushQueue called but WS not open');
    return;
  }
  console.log('flushQueue: sending', signalingQueue.length, 'messages');
  while (signalingQueue.length) {
    const p = signalingQueue.shift();
    try {
      signaling.send(p);
      console.log('flushQueue: sent', p);
    } catch (err) {
      console.error('flushQueue: send failed', err, p);
      // push back and stop to avoid busy loop
      signalingQueue.unshift(p);
      break;
    }
  }
}

// Attempt to connect to next signaling server in list
function tryConnectSignaling() {
  return new Promise((resolve) => {
    if (signaling) {
      try { signaling.close(); } catch(e){ console.warn('closing old ws failed', e); }
      signaling = null;
    }

    if (signalingIndex >= CONFIG.SIGNAL_SERVERS.length) {
      console.error('All signaling servers failed or attempted. Restart index and increase retry/backoff');
      signalingIndex = 0;
      wsReconnectAttempts++;
      if (wsReconnectAttempts > CONFIG.WS_RECONNECT_MAX) {
        setStatus('signaling failed (max attempts).');
      }
    }

    const base = CONFIG.SIGNAL_SERVERS[signalingIndex];
    const url = base + '/?room=' + encodeURIComponent(roomId);
    console.log('tryConnectSignaling -> attempting', url, '(index', signalingIndex, ')');

    let didResolve = false;

    try {
      signaling = new WebSocket(url);

      // safety timeout: if no open within WS_TRY_TIMEOUT_MS, close and try next
      const tryTimeout = setTimeout(() => {
        if (!didResolve) {
          console.warn('Signaling open timeout for', url, '; closing and trying next');
          try { signaling.close(); } catch(e){ console.warn('close error', e); }
          signaling = null;
          signalingIndex++;
          // slight delay to avoid spin
          setTimeout(() => { resolve(tryConnectSignaling()); }, 200);
          didResolve = true;
        }
      }, CONFIG.WS_TRY_TIMEOUT_MS);

      signaling.onopen = () => {
        clearTimeout(tryTimeout);
        console.log('Signaling connected to', url);
        wsReconnectAttempts = 0;
        signalingIndex = 0; // reset preferred index to start-of-list for next reconnect
        setStatus('signaling connected');
        // flush queued messages
        flushQueue();
        if (!didResolve) { didResolve = true; resolve(signaling); }
      };

      signaling.onerror = (err) => {
        console.error('Signaling error on', url, err);
      };

      signaling.onclose = (ev) => {
        console.warn('Signaling closed', url, ev && ev.code, ev && ev.reason);
        // try next server if we haven't already resolved
        if (!didResolve) {
          clearTimeout(tryTimeout);
          signaling = null;
          signalingIndex++;
          setTimeout(() => { resolve(tryConnectSignaling()); }, 200);
          didResolve = true;
        } else {
          // If closed after previously open, try reconnect with backoff
          const backoff = Math.min(5000 * (wsReconnectAttempts+1), 30000);
          console.log('Scheduling reconnect in', backoff, 'ms');
          setTimeout(() => {
            signalingIndex = 0;
            wsReconnectAttempts++;
            tryConnectSignaling().catch(e => console.error('reconnect try failed', e));
          }, backoff);
        }
      };

      signaling.onmessage = async (msg) => {
        console.log('Signaling message raw:', msg.data);
        let data;
        try { data = JSON.parse(msg.data); } catch (e) { console.warn('non-JSON signaling message', msg.data); return; }
        // handle messages (offer/answer/ice)
        if (!pc) {
          console.warn('Got signaling message but PC not initialized', data);
          return;
        }
        try {
          if (data.offer) {
            console.log('Received offer via signaling');
            await pc.setRemoteDescription(data.offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signalingSend({ answer });
          } else if (data.answer) {
            console.log('Received answer via signaling');
            await pc.setRemoteDescription(data.answer);
          } else if (data.ice) {
            console.log('Received ICE via signaling', data.ice && data.ice.candidate ? 'candidate present' : data.ice);
            // safe addIceCandidate with try/catch
            try {
              await pc.addIceCandidate(data.ice);
            } catch (err) {
              console.error('addIceCandidate failed', err);
            }
          } else {
            console.log('Unknown signaling payload', data);
          }
        } catch (err) {
          console.error('Error handling signaling message', err);
        }
      };

    } catch (err) {
      console.error('tryConnectSignaling exception creating WebSocket', err);
      signaling = null;
      signalingIndex++;
      if (!didResolve) { didResolve = true; resolve(tryConnectSignaling()); }
    }
  });
}

// Build the RTCPeerConnection and attach hooks
function buildPeerConnection() {
  console.log('buildPeerConnection: creating RTCPeerConnection');
  pc = new RTCPeerConnection({ iceServers: CONFIG.ICE });

  pc.addEventListener('icecandidate', (e) => {
    console.log('pc: icecandidate', e.candidate);
    if (e.candidate) signalingSend({ ice: e.candidate });
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    console.log('pc: iceConnectionState ->', pc.iceConnectionState);
    setStatus('pc ice state: ' + pc.iceConnectionState);
  });

  pc.addEventListener('connectionstatechange', () => {
    console.log('pc: connectionState ->', pc.connectionState);
    setStatus('pc state: ' + pc.connectionState);
  });

  pc.addEventListener('track', (evt) => {
    console.log('pc: track event', evt);
    try {
      UI.remoteAudio.srcObject = evt.streams && evt.streams[0] ? evt.streams[0] : evt.stream;
      console.log('Attached remote stream to audio element');
    } catch (err) {
      console.error('Error attaching remote audio', err);
    }
  });

  // Extra safety: log stats occasionally
  setInterval(async () => {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      console.log('pc stats snapshot:', stats && typeof stats === 'object' ? 'size=' + [...stats].length : stats);
    } catch (err) {
      console.warn('getStats failed', err);
    }
  }, 8000);

  return pc;
}

async function startFlow() {
  try {
    setStatus('starting');
    UI.startBtn.disabled = true;

    roomId = getRoomId();
    console.log('RoomId:', roomId);

    // ensure signaling is connected (tries fallback list)
    await tryConnectSignaling();
    console.log('Signaling connected (or at least attempted), readyState:', signaling && signaling.readyState);

    // get local audio
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Obtained local microphone stream', localStream);
    } catch (err) {
      console.error('getUserMedia failed', err);
      setStatus('mic denied or error');
      UI.startBtn.disabled = false;
      return;
    }

    // build pc
    buildPeerConnection();

    // add tracks
    try {
      localStream.getTracks().forEach(t => {
        const sender = pc.addTrack(t, localStream);
        console.log('Added track to pc', t, sender);
      });
    } catch (err) {
      console.error('addTrack failed', err);
    }

    // Create local offer and send via signaling (queue-safe)
    const offer = await pc.createOffer();
    console.log('Created offer', offer && offer.type);
    await pc.setLocalDescription(offer);
    console.log('Set local description (offer)');
    signalingSend({ offer });

    // enable UI controls
    UI.muteBtn.disabled = false;
    UI.hangupBtn.disabled = false;
    setStatus('offer sent, waiting for answer');

  } catch (err) {
    console.error('startFlow top-level error', err);
    setStatus('error: ' + (err && err.message ? err.message : err));
    UI.startBtn.disabled = false;
  }
}

function hangup() {
  console.log('hangup called');
  if (pc) {
    try {
      pc.getSenders().forEach(s => {
        try { if (s.track) s.track.stop(); } catch(e){ console.warn('stop track error', e); }
      });
    } catch(e){ console.warn('stopping senders err', e); }
    try { pc.close(); } catch(e){ console.warn('pc close err', e); }
    pc = null;
  }
  if (localStream) {
    try {
      localStream.getTracks().forEach(t => t.stop());
    } catch(e){ console.warn('stop tracks err', e); }
    localStream = null;
  }
  if (signaling) {
    try { signaling.close(); } catch(e){ console.warn('closing signaling err', e); }
    signaling = null;
  }
  signalingQueue = [];
  setStatus('hung up');
  UI.startBtn.disabled = false;
  UI.muteBtn.disabled = true;
  UI.hangupBtn.disabled = true;
  UI.remoteAudio.srcObject = null;
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  UI.muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  console.log('toggleMute ->', isMuted);
}

// utility
function getRoomId() {
  if (!location.hash) location.hash = Math.random().toString(36).slice(2,10);
  return location.hash.slice(1);
}

// Wire UI
UI.startBtn.addEventListener('click', async () => {
  console.log('Start button click');
  await startFlow();
});
UI.hangupBtn.addEventListener('click', hangup);
UI.muteBtn.addEventListener('click', toggleMute);

// Show active code version in console
console.log('script.js finished loading (version 20251104_01). Make sure this file's version appears in console output; if you still see the OLD server URL in the console, the browser is loading a cached old file — do a hard refresh (Ctrl+Shift+R) or clear cache.');

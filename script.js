// script.js - full multi-participant WebRTC logic

// Replace with your Worker URL
const SIGNALING_URL = "https://calling.very-cool-email2001.workers.dev?room=default";

const localVideo = document.getElementById("localVideo");
const remoteVideos = document.getElementById("remoteVideos");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");

let localStream;
let pcs = {}; // mapping remoteId -> RTCPeerConnection
let ws;
let audioEnabled = true;
let videoEnabled = true;

// Helper to create a video element for a remote peer
function createRemoteVideo(peerId) {
  let video = document.createElement("video");
  video.id = "remote_" + peerId;
  video.autoplay = true;
  video.playsInline = true;
  remoteVideos.appendChild(video);
  return video;
}

// Initialize media and signaling
async function init() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    ws = Debug.wrapWebSocket(new WebSocket(SIGNALING_URL));

    ws.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);
      const senderId = data.sender || "unknown";

      if(data.type === "offer") {
        if(!pcs[senderId]){
          pcs[senderId] = createPeerConnection(senderId);
        }
        await pcs[senderId].setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pcs[senderId].createAnswer();
        await pcs[senderId].setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", sdp: pcs[senderId].localDescription, receiver: senderId }));
      } 
      else if(data.type === "answer") {
        if(pcs[senderId]){
          await pcs[senderId].setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } 
      else if(data.type === "candidate") {
        if(pcs[senderId]){
          try { await pcs[senderId].addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(err){ Debug.log("ICE error", err); }
        }
      }
    };

    ws.onopen = () => {
      Debug.log("Connected to signaling server");
    };

    ws.onclose = () => Debug.log("Signaling server disconnected");

    muteBtn.addEventListener("click", () => {
      audioEnabled = !audioEnabled;
      localStream.getAudioTracks().forEach(track => track.enabled = audioEnabled);
    });

    cameraBtn.addEventListener("click", () => {
      videoEnabled = !videoEnabled;
      localStream.getVideoTracks().forEach(track => track.enabled = videoEnabled);
    });

    // Create initial offer to everyone else
    // In Cloudflare worker setup, new clients receive the offer automatically

  } catch(err) {
    Debug.log("Initialization error:", err);
  }
}

// Create peer connection for a remote peer
function createPeerConnection(peerId){
  const pc = Debug.wrapPeerConnection(new RTCPeerConnection());

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    let video = document.getElementById("remote_" + peerId) || createRemoteVideo(peerId);
    video.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if(event.candidate){
      ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, receiver: peerId }));
    }
  };

  pc.oniceconnectionstatechange = () => {
    Debug.log(`ICE state (${peerId}):`, pc.iceConnectionState);
    if(pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed"){
      // Clean up disconnected peer
      const video = document.getElementById("remote_" + peerId);
      if(video) video.remove();
      delete pcs[peerId];
    }
  };

  return pc;
}

init();

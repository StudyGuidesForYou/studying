console.log("script.js loaded");

const startBtn = document.getElementById("startBtn");

let localStream;
let peerConnection;

// ✅ Replace with working signaling server
const SIGNAL_SERVER = "wss://wrtc-signaling-eu.herokuapp.com";

console.log("Connecting to signaling server:", SIGNAL_SERVER);

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

function getRoomId() {
    if (!location.hash) {
        location.hash = Math.random().toString(36).substring(2, 10);
    }
    return location.hash.substring(1);
}

const roomId = getRoomId();
console.log("Room ID:", roomId);

// ✅ Connect signaling websocket
let signaling = new WebSocket(`${SIGNAL_SERVER}/?room=${roomId}`);

signaling.onopen = () => {
    console.log("WebSocket connected ✅");
};

signaling.onerror = (err) => {
    console.error("WebSocket ERROR ❌", err);
};

signaling.onclose = () => {
    console.warn("WebSocket closed ❌");
};

signaling.onmessage = async (msg) => {
    console.log("WS MESSAGE:", msg.data);
    const data = JSON.parse(msg.data);

    if (!peerConnection) return;

    if (data.offer) {
        console.log("Received offer");
        await peerConnection.setRemoteDescription(data.offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signaling.send(JSON.stringify({ answer }));
    }

    if (data.answer) {
        console.log("Received answer");
        await peerConnection.setRemoteDescription(data.answer);
    }

    if (data.ice) {
        console.log("Received ICE candidate");
        await peerConnection.addIceCandidate(data.ice);
    }
};

startBtn.onclick = async () => {
    console.log("Start button pressed");

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Got microphone stream");

    peerConnection = new RTCPeerConnection(servers);

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE State:", peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("PC State:", peerConnection.connectionState);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("New ICE candidate:", event.candidate);
            signaling.send(JSON.stringify({ ice: event.candidate }));
        }
    };

    peerConnection.ontrack = (event) => {
        console.log("Received remote audio stream");
        const audio = document.createElement("audio");
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
    };

    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    signaling.send(JSON.stringify({ offer }));

    console.log("Offer sent");
};

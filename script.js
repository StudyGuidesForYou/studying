console.log("script.js loaded");

// ✅ Working signaling server
const SIGNAL_SERVER = "wss://wrtc-signaling-eu.herokuapp.com";

const startBtn = document.getElementById("startBtn");
let signaling;
let peerConnection;
let localStream;

// ✅ Prevent sending before WebSocket is open
function waitForSocket(ws) {
    return new Promise((resolve) => {
        if (ws.readyState === 1) return resolve();
        ws.addEventListener("open", resolve);
    });
}

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

function getRoomId() {
    if (!location.hash)
        location.hash = Math.random().toString(36).substring(2, 10);
    return location.hash.substring(1);
}

const roomId = getRoomId();
console.log("Room ID:", roomId);

// ✅ Create WebSocket
function createSignaling() {
    signaling = new WebSocket(`${SIGNAL_SERVER}/?room=${roomId}`);

    signaling.onopen = () => console.log("WebSocket connected ✅");
    signaling.onerror = (err) => console.error("WebSocket error ❌", err);
    signaling.onclose = () => console.warn("WebSocket closed ❌");

    signaling.onmessage = async (msg) => {
        console.log("WS message:", msg.data);
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
            console.log("Received ICE");
            await peerConnection.addIceCandidate(data.ice);
        }
    };
}

createSignaling();

startBtn.onclick = async () => {
    console.log("Start clicked");

    // ✅ Wait for WebSocket to be fully ready
    await waitForSocket(signaling);

    console.log("WebSocket ready, continuing...");

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Microphone stream acquired");

    peerConnection = new RTCPeerConnection(servers);

    peerConnection.oniceconnectionstatechange = () =>
        console.log("ICE state:", peerConnection.iceConnectionState);

    peerConnection.onconnectionstatechange = () =>
        console.log("Connection state:", peerConnection.connectionState);

    peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            console.log("Sending ICE candidate");
            signaling.send(JSON.stringify({ ice: event.candidate }));
        }
    };

    peerConnection.ontrack = (event) => {
        console.log("Received remote stream");
        const audio = document.createElement("audio");
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
    };

    localStream.getTracks().forEach((t) =>
        peerConnection.addTrack(t, localStream)
    );

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    console.log("Sending offer...");
    signaling.send(JSON.stringify({ offer }));
};

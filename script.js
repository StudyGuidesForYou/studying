const startBtn = document.getElementById("startBtn");

let localStream;
let peerConnection;

const servers = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};

function getRoomId() {
    // Use URL hash as room ID
    if (!location.hash) {
        location.hash = Math.random().toString(36).substring(2, 10);
    }
    return location.hash.substring(1);
}

const roomId = getRoomId();

// Signaling via public WebSocket server (free)
const signaling = new WebSocket(`wss://signal.emn178.workers.dev/?room=${roomId}`);

signaling.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    if (data.offer) {
        await peerConnection.setRemoteDescription(data.offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        signaling.send(JSON.stringify({ answer }));
    }

    if (data.answer) {
        await peerConnection.setRemoteDescription(data.answer);
    }

    if (data.ice) {
        try {
            await peerConnection.addIceCandidate(data.ice);
        } catch (err) {
            console.error(err);
        }
    }
};

startBtn.onclick = async () => {
    startBtn.disabled = true;

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    peerConnection = new RTCPeerConnection(servers);

    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

    peerConnection.ontrack = (event) => {
        const audio = document.createElement("audio");
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            signaling.send(JSON.stringify({ ice: event.candidate }));
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    signaling.send(JSON.stringify({ offer }));
};

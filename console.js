// console.js - full debug logging for WebRTC + DOM + WebSocket

function log(...args) {
  console.log("%c[DEBUG]", "color: cyan; font-weight: bold;", ...args);
  const logBox = document.getElementById("log");
  if(logBox){
    const line = document.createElement("div");
    line.textContent = args.join(" ");
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }
}

// DOM ready
document.addEventListener("DOMContentLoaded", () => log("DOM fully loaded"));

// Global errors
window.addEventListener("error", (e) => log("Window Error:", e.message, e.filename, e.lineno, e.colno, e.error));
window.addEventListener("unhandledrejection", (e) => log("Unhandled Promise Rejection:", e.reason));

// Wrap WebSocket for logging
function wrapWebSocket(ws) {
  const originalSend = ws.send;
  ws.send = function(data) {
    log("WS Send:", data);
    return originalSend.apply(ws, arguments);
  };
  ws.addEventListener("open", () => log("WS Open"));
  ws.addEventListener("message", (e) => log("WS Message:", e.data));
  ws.addEventListener("close", (e) => log("WS Closed:", e));
  ws.addEventListener("error", (e) => log("WS Error:", e));
  return ws;
}

// Wrap PeerConnection for logging
function wrapPeerConnection(pc) {
  const events = [
    "icecandidate", "iceconnectionstatechange", "track", "connectionstatechange",
    "signalingstatechange", "icegatheringstatechange", "negotiationneeded"
  ];
  events.forEach(event => {
    pc.addEventListener(event, (e) => log("PC Event:", event, e));
  });

  const originalAddIceCandidate = pc.addIceCandidate.bind(pc);
  pc.addIceCandidate = async function(candidate) {
    log("PC addIceCandidate:", candidate);
    return originalAddIceCandidate(candidate);
  };

  const originalCreateOffer = pc.createOffer.bind(pc);
  pc.createOffer = async function(options) {
    const offer = await originalCreateOffer(options);
    log("PC createOffer:", offer);
    return offer;
  };

  const originalCreateAnswer = pc.createAnswer.bind(pc);
  pc.createAnswer = async function(options) {
    const answer = await originalCreateAnswer(options);
    log("PC createAnswer:", answer);
    return answer;
  };

  return pc;
}

window.Debug = { log, wrapWebSocket, wrapPeerConnection };

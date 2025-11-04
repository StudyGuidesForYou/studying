// console.js — super verbose global logger
(function () {
  // Save originals
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  function ts() {
    return (new Date()).toISOString();
  }

  // Replace console methods with timestamped wrappers
  console.log = function(...a){ orig.log(`[${ts()}]`, ...a); };
  console.info = function(...a){ orig.info(`[${ts()}]`, ...a); };
  console.warn = function(...a){ orig.warn(`[${ts()}]`, ...a); };
  console.error = function(...a){ orig.error(`[${ts()}]`, ...a); };
  console.debug = function(...a){ orig.debug(`[${ts()}]`, ...a); };

  // Global error handlers
  window.addEventListener('error', (e) => {
    console.error('WINDOW ERROR:', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: e.error });
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('UNHANDLED PROMISE REJECTION:', e.reason);
  });

  // Log fetch/XHR
  (function(){
    const origFetch = window.fetch;
    window.fetch = function(...args){
      console.log('fetch()', ...args);
      return origFetch.apply(this, args).then(r => {
        console.log('fetch() response:', r && r.status, r && r.url);
        return r;
      }).catch(err => {
        console.error('fetch() failed:', err);
        throw err;
      });
    };
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    XHR.open = function(method, url, ...rest){
      this._dbg_url = url;
      console.log('XHR open', method, url);
      return origOpen.call(this, method, url, ...rest);
    };
    const origSend = XHR.send;
    XHR.send = function(body){
      console.log('XHR send to', this._dbg_url, 'body:', body);
      this.addEventListener('load', () => console.log('XHR load', this._dbg_url, this.status));
      this.addEventListener('error', () => console.error('XHR error', this._dbg_url));
      return origSend.call(this, body);
    };
  })();

  // Wrap WebSocket to log events and messages
  (function(){
    const NativeWS = window.WebSocket;
    function WrappedWebSocket(url, protocols){
      console.log('WebSocket: constructing ->', url, protocols);
      const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
      ws.addEventListener('open', () => console.log('WebSocket OPEN:', url));
      ws.addEventListener('close', (e) => console.warn('WebSocket CLOSE:', url, e && e.code, e && e.reason));
      ws.addEventListener('error', (e) => console.error('WebSocket ERROR:', url, e));
      ws.addEventListener('message', (m) => {
        let payload = m.data;
        try { payload = JSON.parse(m.data); } catch(e){ /* not JSON */ }
        console.log('WebSocket MESSAGE:', url, payload);
      });
      const origSend = ws.send.bind(ws);
      ws.send = function(data){
        console.log('WebSocket SEND:', url, data);
        try {
          return origSend(data);
        } catch (err) {
          console.error('WebSocket send threw:', err, 'readyState:', ws.readyState);
          throw err;
        }
      };
      return ws;
    }
    WrappedWebSocket.prototype = NativeWS.prototype;
    WrappedWebSocket.CONNECTING = NativeWS.CONNECTING;
    WrappedWebSocket.OPEN = NativeWS.OPEN;
    WrappedWebSocket.CLOSING = NativeWS.CLOSING;
    WrappedWebSocket.CLOSED = NativeWS.CLOSED;
    window.WebSocket = WrappedWebSocket;
  })();

  // Wrap RTCPeerConnection to log lifecycle events & method calls
  (function(){
    const NativePC = window.RTCPeerConnection;
    if (!NativePC) {
      console.warn('RTCPeerConnection not supported in this browser');
      return;
    }
    function WrappedPC(config){
      console.log('RTCPeerConnection: new', config);
      const pc = new NativePC(config);
      // hook all common events
      ['icecandidate','iceconnectionstatechange','connectionstatechange','signalingstatechange','track','datachannel','negotiationneeded'].forEach(evt => {
        pc.addEventListener(evt, (e) => console.log('PC EVENT', evt, e && e.type, e && (e.candidate || e.target && e.target.readyState ? {state:e.target.readyState}: undefined), e));
      });
      // wrap addTrack/replaceTrack/removeTrack/createOffer/createAnswer/setLocalDescription/setRemoteDescription
      const origAddTrack = pc.addTrack.bind(pc);
      pc.addTrack = function(track, stream){
        console.log('pc.addTrack', track, stream);
        return origAddTrack(track, stream);
      };
      const origCreateOffer = pc.createOffer.bind(pc);
      pc.createOffer = function(options){
        console.log('pc.createOffer', options);
        return origCreateOffer(options).then(o => { console.log('pc.createOffer ->', o); return o; });
      };
      const origCreateAnswer = pc.createAnswer.bind(pc);
      pc.createAnswer = function(options){
        console.log('pc.createAnswer', options);
        return origCreateAnswer(options).then(a => { console.log('pc.createAnswer ->', a); return a; });
      };
      const origSetLocal = pc.setLocalDescription.bind(pc);
      pc.setLocalDescription = function(desc){
        console.log('pc.setLocalDescription', desc && desc.type);
        return origSetLocal(desc).then(r => { console.log('pc.setLocalDescription DONE', desc && desc.type); return r; });
      };
      const origSetRemote = pc.setRemoteDescription.bind(pc);
      pc.setRemoteDescription = function(desc){
        console.log('pc.setRemoteDescription', desc && desc.type);
        return origSetRemote(desc).then(r => { console.log('pc.setRemoteDescription DONE', desc && desc.type); return r; });
      };
      const origAddCandidate = pc.addIceCandidate.bind(pc);
      pc.addIceCandidate = function(cand){
        console.log('pc.addIceCandidate', cand);
        return origAddCandidate(cand).then(r => { console.log('pc.addIceCandidate DONE'); return r; }).catch(err => { console.error('pc.addIceCandidate ERR', err); throw err; });
      };
      return pc;
    }
    WrappedPC.prototype = NativePC.prototype;
    window.RTCPeerConnection = WrappedPC;
  })();

  console.log('Console logger initialized.');
})();

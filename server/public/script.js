const socket = io();

let isInitiator = false;
let localStream = null;
let peerConnection = null;
let pendingCandidates = [];

/* UI */
const status = document.getElementById("status");
const chat = document.getElementById("chat");
const messages = document.getElementById("messages");
const input = document.getElementById("input");
const send = document.getElementById("send");
const skip = document.getElementById("skip");
const online = document.getElementById("online");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const videoArea = document.getElementById("videoArea");

/* RTC */
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },

    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};


/* Kamera */
async function ensureCamera() {
  if (localStream) return;

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  localVideo.srcObject = localStream;
}

/* Peer */
function ensurePeer() {
  if (peerConnection) return;

  peerConnection = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    remoteVideo.play?.().catch(() => {});
  };

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) socket.emit("ice-candidate", e.candidate);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log("RTC:", peerConnection.connectionState);
  };
}

async function ensureMediaAndPeer() {
  await ensureCamera();
  ensurePeer();
}

/* Kapat */
function stopVideo() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  pendingCandidates = [];

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  videoArea.classList.add("hidden");
}

/* SOCKET */

socket.on("onlineCount", (count) => {
  online.innerText = "Online: " + count;
});

socket.on("waiting", () => {
  status.innerText = "Eşleşme bekleniyor...";
});

/* MATCH */
socket.on("matched", async (data) => {
  isInitiator = data === true;
  console.log("INITIATOR =", isInitiator);

  if (peerConnection) stopVideo();

  status.innerText = "Eşleşti 🎉";
  chat.classList.remove("hidden");
  videoArea.classList.remove("hidden");

  await ensureMediaAndPeer();

  if (isInitiator) {
    console.log("OFFER oluşturuluyor");

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("offer", offer);
  }
});

/* OFFER */
socket.on("offer", async (offer) => {
  console.log("OFFER alındı");

  await ensureMediaAndPeer();

  await peerConnection.setRemoteDescription(offer);

  for (const c of pendingCandidates) {
    await peerConnection.addIceCandidate(c);
  }

  pendingCandidates = [];

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", answer);
});

/* ANSWER */
socket.on("answer", async (answer) => {
  if (!peerConnection) return;

  console.log("ANSWER alındı");

  await peerConnection.setRemoteDescription(answer);

  for (const c of pendingCandidates) {
    await peerConnection.addIceCandidate(c);
  }

  pendingCandidates = [];
});

/* ICE */
socket.on("ice-candidate", async (candidate) => {
  if (!peerConnection) return;

  if (!peerConnection.remoteDescription) {
    pendingCandidates.push(candidate);
    return;
  }

  await peerConnection.addIceCandidate(candidate);
});

/* CHAT */
socket.on("message", (data) => {
  const div = document.createElement("div");
  div.innerText = `${data.from}: ${data.text}`;
  messages.appendChild(div);
});

send.onclick = () => {
  const msg = input.value.trim();
  if (!msg) return;

  socket.emit("message", msg);

  const div = document.createElement("div");
  div.innerText = "Sen: " + msg;
  messages.appendChild(div);

  input.value = "";
};

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    send.click();
  }
});

/* SKIP */
skip.onclick = () => {
  stopVideo();

  messages.innerHTML = "";
  chat.classList.add("hidden");

  status.innerText = "Yeni eşleşme aranıyor...";
  socket.emit("skip");
};

socket.on("partnerDisconnected", () => {
  stopVideo();

  messages.innerHTML = "";
  chat.classList.add("hidden");

  status.innerText = "Yeni eşleşme aranıyor...";
});

/* SYSTEM */
socket.on("system", (text) => {
  const div = document.createElement("div");
  div.style.color = "red";
  div.innerText = "⚠️ Sistem: " + text;
  messages.appendChild(div);
});

const socket = io();


let reported = false;
let isInitiator = false;
let localStream = null;
let peerConnection = null;
let pendingCandidates = [];
let currentFacing = "user"; // front
let firstSwipe = false;

const homeScreen = document.getElementById("homeScreen");
const appScreen = document.getElementById("appScreen");

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const previewVideo = document.getElementById("previewVideo");


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

const toggleMic = document.getElementById("toggleMic");
const toggleCam = document.getElementById("toggleCam");
const pauseBtn = document.getElementById("pauseBtn");
const reportBtn = document.getElementById("reportBtn");


/* RTC 
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

*/

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

let previewStream = null;

/* async function startPreview(){

  previewStream =
    await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

  previewVideo.srcObject = previewStream;
} */


/* Kamera */
async function ensureCamera() {

  if (localStream) return;

  try {

    localStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacing
        },
        audio: true
      });

    localVideo.srcObject = localStream;

  } catch (err) {

    console.error("CAM ERROR:", err);

    alert("Kamera açılamadı!");
  }
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
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  pendingCandidates = [];

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  videoArea.classList.add("hidden");
}


function haptic(ms = 40){
  if (navigator.vibrate) {
    navigator.vibrate(ms);
  }
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

  reported = false;

  isInitiator = data === true;

  console.log("MATCHED | INIT:", isInitiator);

  stopVideo(); // temiz reset

  status.innerText = "Eşleşti 🎉";

  chat.classList.remove("hidden");
  videoArea.classList.remove("hidden");

  await ensureCamera();
  ensurePeer();

  if (isInitiator) {

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

btnStart.onclick = () => {

  homeScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");

  status.innerText = "Bağlanıyor...";

  socket.emit("skip");
};



btnStop.onclick = () => {

  homeScreen.classList.remove("hidden");
  appScreen.classList.add("hidden");

};


/* CHAT */
socket.on("message", (data) => {
  const div = document.createElement("div");
  div.innerText = `${data.from}: ${data.text}`;
  messages.appendChild(div);
});

send.onclick = () => {
  haptic(20);
  const msg = input.value.trim();
  if (!msg) return;

  socket.emit("message", msg);

  const div = document.createElement("div");
  div.innerText = "Sen: " + msg;
  messages.appendChild(div);

  input.value = "";
};

remoteVideo.addEventListener("dblclick", ()=>{
  socket.emit("skip");
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    send.click();
  }
});

/* SKIP */
skip.onclick = () => {

  if(!firstSwipe){
  firstSwipe = true;
}

  haptic();
  stopVideo();
  socket.emit("skip");

  messages.innerHTML = "";
  chat.classList.add("hidden");

  status.innerText = "Yeni eşleşme aranıyor...";
};

socket.on("partnerDisconnected", () => {
  reported = false;

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


let micOn = true;

toggleMic.onclick = () => {
  if (!localStream) return;

  micOn = !micOn;

  localStream.getAudioTracks().forEach(t => {
    t.enabled = micOn;
  });

  toggleMic.innerText = micOn ? "🎤 Ses Kapat" : "🔇 Ses Aç";
};


let camOn = true;

toggleCam.onclick = () => {
  if (!localStream) return;

  camOn = !camOn;

  localStream.getVideoTracks().forEach(t => {
    t.enabled = camOn;
  });

  toggleCam.innerText = camOn ? "📷 Kamera Kapat" : "📵 Kamera Aç";
};


let paused = false;

pauseBtn.onclick = () => {

  if (!localStream) return;

  paused = !paused;

  localStream.getTracks().forEach(t => {
    t.enabled = !paused;
  });

  pauseBtn.innerText = paused ? "▶️ Devam" : "⏸️ Durdur";
};




    reportBtn.addEventListener("click", () => {

      if (reported) return;

      reported = true;

      socket.emit("reportUser");

});


socket.on("force-ban", data => {

  const until = data?.until || "";
  const reason = data?.reason || "";

  window.location.href =
    "/banned.html?until=" + until + "&reason=" + encodeURIComponent(reason);

});


socket.on("force-kick", ()=>{

  window.location.href = "/kicked.html";

});




//Dark/Light mode toggle
let dark = true;

const themeBtn = document.getElementById("themeBtn");

if (themeBtn) {

  themeBtn.onclick = () => {

    dark = !dark;

    document.body.classList.toggle("bg-black");
    document.body.classList.toggle("bg-white");

    document.body.classList.toggle("text-white");
    document.body.classList.toggle("text-black");

    themeBtn.innerText = dark ? "🌙" : "☀️";
  };

}

//flip camera
const flipCam = document.getElementById("flipCam");

if (flipCam) {

  flipCam.onclick = async () => {

    currentFacing =
      currentFacing === "user" ? "environment" : "user";

    if (localStream) {
        localStream.getTracks().forEach(t => {
        t.enabled = false;
    });
  }


    await ensureCamera();

    haptic();
  };
}

// Swipe öğretici (1 kere)
if (!localStorage.getItem("swipeHintShown")) {

  const hint = document.getElementById("swipeHint");

  if (hint) {

    hint.classList.remove("hidden");

    setTimeout(() => {
      hint.classList.add("hidden");
      localStorage.setItem("swipeHintShown", "1");
    }, 6000);

  }
}


// =======================
// SWIPE LAYER SYSTEM
// =======================

const swipeLayer = document.getElementById("swipeLayer");

let sx = 0;
let cx = 0;
let dragging = false;

if (swipeLayer) {

  swipeLayer.addEventListener("pointerdown", e => {

    if (videoArea.classList.contains("hidden")) return;

    sx = e.clientX;
    cx = sx;
    dragging = true;

    swipeLayer.setPointerCapture(e.pointerId);

    videoArea.style.transition = "none";
  });


  swipeLayer.addEventListener("pointermove", e => {

    if (!dragging) return;

    cx = e.clientX;

    const diff = cx - sx;

    videoArea.style.transform =
      `translateX(${diff}px) rotate(${diff/22}deg)`;
  });


  swipeLayer.addEventListener("pointerup", () => {

    if (!dragging) return;

    dragging = false;

    const diff = cx - sx;

    videoArea.style.transition = "0.25s ease";

    if (Math.abs(diff) > 80) {

      const dir = diff > 0 ? 1 : -1;

      videoArea.style.transform =
        `translateX(${dir * window.innerWidth}px) rotate(${dir * 14}deg)`;

      haptic(40);

      setTimeout(() => {

        videoArea.style.transition = "none";
        videoArea.style.transform = "translateX(0)";

        socket.emit("skip");

      }, 250);

    } else {

      videoArea.style.transform = "translateX(0)";
    }
  });


  swipeLayer.addEventListener("pointercancel", () => {
    dragging = false;
    videoArea.style.transform = "translateX(0)";
  });
}

// Sayfa açılınca kamera önizleme başlasın
//startPreview();

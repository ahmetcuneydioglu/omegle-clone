const socket = io();  // Socket.IO sunucusuna bağlan (aynı host üzerinden)

// HTML elementlerine erişimler
const startBtn     = document.getElementById('startBtn');
const stopBtn      = document.getElementById('stopBtn');
const nextBtn      = document.getElementById('nextBtn');
const remoteVideo  = document.getElementById('remoteVideo');
const localVideo   = document.getElementById('localVideo');
const waitingText  = document.getElementById('waitingText');
const previewText  = document.getElementById('cameraPreviewText');
const unmuteBtn    = document.getElementById('unmuteBtn');
const camToggleBtn = document.getElementById('camToggleBtn');
const chatInput    = document.getElementById('chatInput');
const sendBtn      = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');

// Durum değişkenleri
let localStream = null;
let peerConn    = null;
let isInitiator = false;   // Bu kullanıcı eşleşmede teklifi başlatacak mı?
let remoteStreamStarted = false;

// STUN sunucuları (NAT traversing için)
const iceConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },       // Google STUN
    { urls: "stun:stun.services.mozilla.com" }      // Mozilla STUN
    // Gerekirse buraya bir TURN sunucusu da eklenebilir (prod ortam için)
  ]
};

// Yeni bir WebRTC PeerConnection oluştur ve olaylarını tanımla
function createPeerConnection() {
  peerConn = new RTCPeerConnection(iceConfig);
  // Tüm yerel medya akışını RTCPeerConnection'a ekle
  localStream.getTracks().forEach(track => peerConn.addTrack(track, localStream));

  // ICE adayları bulundukça karşı tarafa ilet
  peerConn.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('candidate', event.candidate);
    }
  };

  // Karşı taraftan bir medya akışı (track) geldiyse, remote videoda oynat
  peerConn.ontrack = event => {
    const [stream] = event.streams;
    remoteVideo.srcObject = stream;
    remoteVideo.play().catch(e => console.error("Remote video play failed:", e));
    remoteStreamStarted = true;
    // Karşı tarafın sesi başlangıçta kapalı (unmuteBtn ile açılabilir)
    remoteVideo.muted = true;
    unmuteBtn.style.display = 'inline-block';
  };
}

// Socket.IO sunucusundan gelen çevrimiçi kişi sayısını güncelle
socket.on('onlineCount', count => {
  document.getElementById('onlineCount').innerText = count;
});

// Eşleşme bulunduğunda sunucudan bu olay geliyor
socket.on('matched', data => {
  console.log("Eşleşme bulundu:", data);
  // Eşleşme geldiğinde yeni bir peer connection başlat
  createPeerConnection();
  if (data && data.initiator) {
    isInitiator = true;
    // Teklifi oluştur ve karşı tarafa gönder
    peerConn.createOffer().then(offer => {
      return peerConn.setLocalDescription(offer);
    }).then(() => {
      socket.emit('offer', peerConn.localDescription);
    }).catch(err => console.error("Offer error:", err));
  } else {
    // Bu taraf cevap bekleyecek (initiator = false)
    isInitiator = false;
  }
  // Artık bekleme mesajını kaldırabiliriz (eşleşti)
  waitingText.style.display = 'none';
});

// Karşı taraftan WebRTC offer (teklif) geldi
socket.on('offer', offerDesc => {
  console.log("Offer alındı");
  if (!peerConn) { createPeerConnection(); }
  peerConn.setRemoteDescription(new RTCSessionDescription(offerDesc)).then(() => {
    // Teklif alındı, kendi cevabımızı (answer) oluştur
    return peerConn.createAnswer();
  }).then(answer => {
    return peerConn.setLocalDescription(answer);
  }).then(() => {
    // Oluşturulan answer'ı karşı tarafa gönder
    socket.emit('answer', peerConn.localDescription);
  }).catch(err => console.error("Answer error:", err));
});

// Karşı taraftan WebRTC answer (cevap) geldi
socket.on('answer', answerDesc => {
  console.log("Answer alındı");
  peerConn.setRemoteDescription(new RTCSessionDescription(answerDesc))
         .catch(err => console.error("Remote SDP set error:", err));
});

// Karşı taraftan ICE adayı bilgisi geldi
socket.on('candidate', candidate => {
  // Yeni bir ICE adayı ekle
  if (peerConn) {
    peerConn.addIceCandidate(new RTCIceCandidate(candidate))
           .catch(err => console.error("ICE candidate eklenemedi:", err));
  }
});

// Eşleşmedeki diğer kullanıcı bağlantıyı kesti (veya “Dur/Yeni” dedi)
socket.on('partnerDisconnected', () => {
  console.log("Partner ayrıldı");
  // Mevcut eşleşmeyi sonlandır
  if (peerConn) { peerConn.close(); peerConn = null; }
  remoteVideo.srcObject = null;
  remoteStreamStarted = false;
  isInitiator = false;
  // Kullanıcıyı bilgilendir (metin göster)
  waitingText.innerText = "Eşleşme sonlandı";
  waitingText.style.display = 'block';
  // Tekrar kamerayı önizleme moduna al (kullanıcı isterse yeniden başlatabilir)
  startBtn.disabled = false;
  stopBtn.disabled = true;
});

// Sunucudan gelen sohbet mesajı
socket.on('message', msg => {
  // Gelen mesajı sohbet alanına ekle
  const msgDiv = document.createElement('div');
  msgDiv.textContent = "Yabancı: " + msg;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// ** Etkinlik Bağlayıcıları (Event Handlers) ** //

// Başlat butonuna tıklandığında
startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  if (!localStream) {
    // Kamera ve mikrofon izni iste ve akışı al
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        localStream = stream;
        // Yerel videoda kendi görüntümüzü göster
        localVideo.srcObject = stream;
        localVideo.play().catch(e => console.error("Local video play failed:", e));
        previewText.style.display = 'block';  // Kamera önizleme yazısını göster
        // Eşleşme isteği gönder (kendimizi bekleme kuyruğuna sokuyoruz)
        socket.emit('startMatch');
        previewText.style.display = 'none';
        waitingText.style.display = 'block';  // "Eşleşme bekleniyor..." göster
      })
      .catch(err => {
        console.error("Kamera/mikrofon erişimi reddedildi:", err);
        alert("Kamera veya mikrofon erişimi verilmedi.");
        startBtn.disabled = false;
        stopBtn.disabled = true;
      });
  } else {
    // Zaten localStream varsa (ör. daha önce bağlanmıştı)
    socket.emit('startMatch');
    previewText.style.display = 'none';
    waitingText.style.display = 'block';
  }
});

// Dur (Stop) butonuna tıklandığında
stopBtn.addEventListener('click', () => {
  socket.emit('stopChat');  // Sunucuya eşleşmeyi sonlandırdığımızı bildir
  // Mevcut peer bağlantısını sonlandır
  if (peerConn) { peerConn.close(); peerConn = null; }
  if (remoteVideo.srcObject) { remoteVideo.srcObject = null; }
  remoteStreamStarted = false;
  isInitiator = false;
  // Kullanıcıyı başlangıç durumuna döndür (kamera önizleme moduna)
  waitingText.style.display = 'none';
  previewText.style.display = 'block';
  startBtn.disabled = false;
  stopBtn.disabled = true;
});

// Yeni (Next) butonuna tıklandığında – mevcut sohbeti sonlandırıp yenisini başlat
nextBtn.addEventListener('click', () => {
  socket.emit('stopChat');    // Önce mevcut eşleşmeyi sonlandır
  if (peerConn) { peerConn.close(); peerConn = null; }
  remoteVideo.srcObject = null;
  remoteStreamStarted = false;
  isInitiator = false;
  // Yeni eşleşme iste
  socket.emit('startMatch');
  waitingText.innerText = "Eşleşme bekleniyor...";
  waitingText.style.display = 'block';
  previewText.style.display = 'none';
  startBtn.disabled = true;
  stopBtn.disabled = false;
});

// "Ses Aç" (unmute) butonuna tıklandığında – karşı tarafın sesini aç/kapa
unmuteBtn.addEventListener('click', () => {
  if (remoteStreamStarted) {
    remoteVideo.muted = !remoteVideo.muted;
    unmuteBtn.textContent = remoteVideo.muted ? "🔇 Ses Aç" : "🔊 Ses Kapat";
  }
});

// (Opsiyonel) Kamera butonu – kullanıcının kendi kamerasını aç/kapat (şu an sadece ikon değiştiriyor)
camToggleBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
  camToggleBtn.textContent = videoTrack.enabled ? "📷 Kamera" : "📷 Kapalı";
});

// Sohbet mesajı gönderme
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') { sendMessage(); }
});

function sendMessage() {
  const msg = chatInput.value.trim();
  if (msg === "") return;
  socket.emit('message', msg);  // Sunucu üzerinden karşı tarafa ilet
  // Kendi mesajımızı da ekrana yaz
  const msgDiv = document.createElement('div');
  msgDiv.textContent = "Ben: " + msg;
  msgDiv.style.color = "#aaf";  // kendi mesajlarımız farklı renkte
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  chatInput.value = "";
}

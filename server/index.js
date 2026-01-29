import express from 'express';
import http from 'http';
import { Server } from 'socket.io';


const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Statik dosyalara servis (index.html, script.js vs. "public" klasöründen)
app.use(express.static('public'));
app.use(express.json());

// Sunucu PORT ayarı (Render kendi portunu ENV ile atar, yoksa 5000 kullan)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu çalışıyor (port ${PORT})`);
});

// Eşleştirme için bekleyen kullanıcı
let waitingSocket = null;

io.on('connection', socket => {
  console.log(`Yeni kullanıcı bağlandı: ${socket.id}`);
  // Şu an online olan kullanıcı sayısını tüm istemcilere gönder
  io.emit('onlineCount', io.engine.clientsCount);

  // Kullanıcı eşleşme başlatmak istedi (Başlat butonuna bastı)
  socket.on('startMatch', () => {
    if (waitingSocket && waitingSocket.connected) {
      // Halihazırda bekleyen biri var, eşleştir
      const partner = waitingSocket;
      waitingSocket = null;
      // İki kullanıcıyı birbirine partner olarak atayalım
      socket.partner = partner;
      partner.partner = socket;
      // Eşleştikleri bilgisini her iki tarafa da gönder
      // Birine initiator=true (teklifi başlatıcı olacak), diğerine false atıyoruz
      socket.emit('matched',   { initiator: true });
      partner.emit('matched', { initiator: false });
      console.log(`Eşleştirildi: ${socket.id} <-> ${partner.id}`);
    } else {
      // Bekleyen yoksa, bu kullanıcı beklemeye alınsın
      waitingSocket = socket;
      console.log(`Kullanıcı beklemeye alındı: ${socket.id}`);
    }
  });

  // Kullanıcı mevcut eşleşmesini sonlandırmak istedi (Dur veya Yeni butonu)
  socket.on('stopChat', () => {
    console.log(`Kullanıcı sonlandırma isteği: ${socket.id}`);
    // Eğer bir eşleşmesi varsa karşı tarafa partnerDisconnected gönder
    if (socket.partner) {
      const partner = socket.partner;
      // Karşı tarafa partnerin ayrıldığını bildir
      partner.emit('partnerDisconnected');
      // Her iki tarafta da partner referanslarını temizle
      partner.partner = null;
      socket.partner  = null;
    }
    // Eğer bu socket bekleme kuyruğunda ise oradan çıkar
    if (waitingSocket === socket) {
      waitingSocket = null;
    }
  });

  // WebRTC: Teklif iletimi
  socket.on('offer', offerDesc => {
    if (socket.partner) {
      socket.partner.emit('offer', offerDesc);
    }
  });

  // WebRTC: Cevap iletimi
  socket.on('answer', answerDesc => {
    if (socket.partner) {
      socket.partner.emit('answer', answerDesc);
    }
  });

  // WebRTC: ICE Adayı iletimi
  socket.on('candidate', candidate => {
    if (socket.partner) {
      socket.partner.emit('candidate', candidate);
    }
  });

  // Sohbet mesajı iletimi
  socket.on('message', msg => {
    if (socket.partner) {
      // Mesajı karşı tarafa aynen ilet
      socket.partner.emit('message', msg);
    }
  });

  // Kullanıcı bağlantıyı kopardığında
  socket.on('disconnect', reason => {
    console.log(`Kullanıcı ayrıldı: ${socket.id} (${reason})`);
    // Online kullanıcı sayısını güncelle
    io.emit('onlineCount', io.engine.clientsCount);
    // Eğer beklemede ise listeden çıkar
    if (waitingSocket === socket) {
      waitingSocket = null;
    }
    // Eşleşmedeydi ise karşı tarafa haber ver
    if (socket.partner) {
      socket.partner.emit('partnerDisconnected');
      socket.partner.partner = null;
      socket.partner = null;
    }
  });
});

// Admin giriş endpointi
// Mevcut app.post('/admin'...) kısmını SİLİN ve yerine bunu yapıştırın:
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    // Güvenlik notu: Gerçek projede şifreleri düz metin saklamayın
    if (username === 'ahmet' && password === 'sifre') {
        // İstemciye başarı mesajı dönüyoruz
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Yetkisiz giriş' });
    }
});
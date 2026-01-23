import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const bannedWords = ["amk", "sik", "küfür3"];


const strikeCount = new Map();
// socket.id => count

function addStrike(socket, reason) {

  const count = (strikeCount.get(socket.id) || 0) + 1;

  strikeCount.set(socket.id, count);

  console.log("STRIKE", socket.ip, count, reason);

  // 3 ihlal = 1 saat ban
  if (count >= 3) {

    bannedIPs.set(socket.ip, {
      reason,
      until: Date.now() + 60 * 60 * 1000
    });

    socket.emit("system", "Güvenlik ihlali nedeniyle geçici olarak engellendin.");
    socket.disconnect(true);
  }
}


const bannedIPs = new Map(); 
// ip => { reason, until }


function isBanned(ip) {
  const ban = bannedIPs.get(ip);

  if (!ban) return false;

  if (ban.until && ban.until < Date.now()) {
    bannedIPs.delete(ip);
    return false;
  }

  return true;
}


const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, "public")));

let waitingUser = null;
let onlineCount = 0;



function generateNickname() {
  return "Stranger #" + Math.floor(1000 + Math.random() * 9000);
}

function enqueue(socket) {
  if (!socket || socket.disconnected) return;
  if (socket.partner) return;

  if (waitingUser && (waitingUser.disconnected || waitingUser.partner)) {
    waitingUser = null;
  }

  if (waitingUser && waitingUser.id === socket.id) {
    socket.emit("waiting");
    return;
  }

  if (waitingUser) {
    const other = waitingUser;
    waitingUser = null;

    if (!other || other.disconnected || other.partner) {
      enqueue(socket);
      return;
    }

    socket.partner = other;
    other.partner = socket;

    // Waiting’deki kişi initiator olsun
    other.emit("matched", true);
    socket.emit("matched", false);
    return;
  }

  waitingUser = socket;
  socket.emit("waiting");
}

io.on("connection", (socket) => {


  const ip =
  socket.handshake.headers["x-forwarded-for"]?.split(",")[0] ||
  socket.handshake.address;

if (isBanned(ip)) {
  console.log("BANNED IP blocked:", ip);
  socket.disconnect(true);
  return;
}

socket.ip = ip;


  onlineCount++;
  io.emit("onlineCount", onlineCount);

  socket.nickname = generateNickname();
  socket.partner = null;

  enqueue(socket);

  socket.on("report", () => {

  if (!socket.partner) return;

  addStrike(socket.partner, "report");

  console.log("REPORT:", socket.partner.ip);
});



  // ✅ CHAT MESAJ
  // ✅ CHAT MESAJ
  socket.on("message", (msg) => {
    if (!socket.partner) return;

    function isSpamming(socket) {
      const now = Date.now();
      const last = messageTimestamps.get(socket.id) || 0;

      messageTimestamps.set(socket.id, now);

      return now - last < 800; // 0.8 saniye
    }


        function containsBannedWord(msg) {
          if (!msg) return false;

          const lower = msg.toLowerCase();

          return bannedWords.some(word => lower.includes(word));
       }


    socket.partner.emit("message", {
      from: socket.nickname,
      text: msg
    });
  });


  // ✅ WEBRTC SİNYALLEŞME (BUNLAR message İÇİNDE OLMAMALI!)
  socket.on("offer", (data) => {
    console.log("SERVER: offer geldi", socket.id, "partner?", !!socket.partner);
    if (socket.partner) socket.partner.emit("offer", data);
  });

  socket.on("answer", (data) => {
    console.log("SERVER: answer geldi", socket.id, "partner?", !!socket.partner);
    if (socket.partner) socket.partner.emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    // console.log("SERVER: ice geldi", socket.id, "partner?", !!socket.partner);
    if (socket.partner) socket.partner.emit("ice-candidate", data);
  });

  // ✅ SKIP
  socket.on("skip", () => {
    const partner = socket.partner;

    if (partner) {
      partner.partner = null;
      partner.emit("partnerDisconnected");
    }
    socket.partner = null;

    if (
      waitingUser &&
      (waitingUser.id === socket.id || (partner && waitingUser.id === partner.id))
    ) {
      waitingUser = null;
    }

    enqueue(socket);
    if (partner) enqueue(partner);
  });

  // ✅ DISCONNECT
  socket.on("disconnect", () => {
    onlineCount--;
    io.emit("onlineCount", onlineCount);

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }

    const partner = socket.partner;
    if (partner) {
      partner.partner = null;
      partner.emit("partnerDisconnected");
      if (waitingUser && waitingUser.id === partner.id) waitingUser = null;
      enqueue(partner);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));

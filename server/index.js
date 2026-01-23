import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, "public")));

let waitingUser = null;
let onlineCount = 0;

const messageTimestamps = new Map();
function isSpamming(socket) {
  const now = Date.now();
  const last = messageTimestamps.get(socket.id) || 0;
  messageTimestamps.set(socket.id, now);
  return now - last < 800;
}

const bannedWords = ["amk", "sik", "küfür3"];
function containsBannedWord(text) {
  const lower = String(text || "").toLowerCase();
  return bannedWords.some((w) => lower.includes(w));
}

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
  onlineCount++;
  io.emit("onlineCount", onlineCount);

  socket.nickname = generateNickname();
  socket.partner = null;

  enqueue(socket);

  socket.on("report", () => {
  console.log("REPORT:", socket.id, socket.nickname);
});


  // ✅ CHAT MESAJ
  socket.on("message", (msg) => {
    if (!socket.partner) return;

    if (isSpamming(socket)) {
      socket.emit("system", "Çok hızlı mesaj gönderiyorsun.");
      return;
    }

    if (containsBannedWord(msg)) {
      socket.emit("system", "Mesajın uygunsuz içerik nedeniyle gönderilmedi.");
      return;
    }

    socket.partner.emit("message", { from: socket.nickname, text: msg });
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

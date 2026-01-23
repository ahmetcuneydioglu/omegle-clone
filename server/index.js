import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

/* ==== SECURITY ==== */

const bannedWords = ["amk", "sik", "küfür3"];

const bannedIPs = new Map(); // ip => {reason, until}
const strikeCount = new Map(); // socket.id => count
const messageTimestamps = new Map(); // spam control

function isBanned(ip) {
  const ban = bannedIPs.get(ip);

  if (!ban) return false;

  if (ban.until && ban.until < Date.now()) {
    bannedIPs.delete(ip);
    return false;
  }

  return true;
}

function addStrike(socket, reason) {

  const count = (strikeCount.get(socket.id) || 0) + 1;
  strikeCount.set(socket.id, count);

  console.log("STRIKE:", socket.ip, count, reason);

  if (count >= 3) {

    bannedIPs.set(socket.ip, {
      reason,
      until: Date.now() + 1 * 60 * 1000 // 1 saat
    });

    socket.emit("system", "Geçici olarak engellendin.");
    socket.disconnect(true);
  }
}

function isSpamming(socket) {

  const now = Date.now();
  const last = messageTimestamps.get(socket.id) || 0;

  messageTimestamps.set(socket.id, now);

  return now - last < 800;
}

function containsBannedWord(msg) {

  if (!msg) return false;

  const lower = msg.toLowerCase();

  return bannedWords.some(w => lower.includes(w));
}

/* ================== */

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(express.static(path.join(__dirname, "public")));

let waitingUser = null;
let onlineCount = 0;

/* MATCH */

function generateNickname() {
  return "Stranger #" + Math.floor(1000 + Math.random() * 9000);
}

function enqueue(socket) {

  if (!socket || socket.disconnected) return;
  if (socket.partner) return;

  if (waitingUser && waitingUser.disconnected) waitingUser = null;

  if (waitingUser) {

    const other = waitingUser;
    waitingUser = null;

    socket.partner = other;
    other.partner = socket;

    other.emit("matched", true);
    socket.emit("matched", false);
    return;
  }

  waitingUser = socket;
  socket.emit("waiting");
}

/* SOCKET */

io.on("connection", (socket) => {

  const ip =
    socket.handshake.headers["x-forwarded-for"]?.split(",")[0] ||
    socket.handshake.address;

  if (isBanned(ip)) {
    console.log("BLOCKED:", ip);
    socket.disconnect(true);
    return;
  }

  socket.ip = ip;

  onlineCount++;
  io.emit("onlineCount", onlineCount);

  socket.nickname = generateNickname();
  socket.partner = null;

  enqueue(socket);

  /* REPORT */

  socket.on("report", () => {

    if (!socket.partner) return;

    addStrike(socket.partner, "report");
  });

  /* CHAT */

  socket.on("message", (msg) => {

    if (!socket.partner) return;

    if (isSpamming(socket)) {
      addStrike(socket, "spam");
      socket.emit("system", "Çok hızlı yazıyorsun.");
      return;
    }

    if (containsBannedWord(msg)) {
      addStrike(socket, "küfür");
      socket.emit("system", "Uygunsuz mesaj.");
      return;
    }

    socket.partner.emit("message", {
      from: socket.nickname,
      text: msg
    });
  });

  /* WEBRTC */

  socket.on("offer", d => socket.partner?.emit("offer", d));
  socket.on("answer", d => socket.partner?.emit("answer", d));
  socket.on("ice-candidate", d => socket.partner?.emit("ice-candidate", d));

  /* SKIP */

  socket.on("skip", () => {

    const p = socket.partner;

    if (p) {
      p.partner = null;
      p.emit("partnerDisconnected");
    }

    socket.partner = null;

    enqueue(socket);
    if (p) enqueue(p);
  });

  /* DISCONNECT */

  socket.on("disconnect", () => {

    onlineCount--;
    io.emit("onlineCount", onlineCount);

    if (waitingUser === socket) waitingUser = null;

    const p = socket.partner;

    if (p) {
      p.partner = null;
      p.emit("partnerDisconnected");
      enqueue(p);
    }
  });

});

/* START */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () =>
  console.log("Server running:", PORT)
);

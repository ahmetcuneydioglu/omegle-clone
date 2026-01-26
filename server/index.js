import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====== AYARLAR ======
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin-123"; // Render ENV'e koyacağız
const bannedWords = ["amk", "sik", "küfür3"];

// ip => { reason, until }
const bannedIPs = new Map();
// socket.ip => strike count
const strikeCount = new Map();
// socket.id => last message time
const messageTimestamps = new Map();

function getIP(socket) {
  // Render arkasında gerçek ip genelde x-forwarded-for’dan gelir
  const xf = socket.handshake.headers["x-forwarded-for"];
  const ip =
    (typeof xf === "string" && xf.split(",")[0].trim()) ||
    socket.handshake.address ||
    "unknown";
  return ip;
}

function isBanned(ip) {
  const ban = bannedIPs.get(ip);
  if (!ban) return false;

  if (ban.until && ban.until < Date.now()) {
    bannedIPs.delete(ip);
    return false;
  }
  return true;
}

function banIP(ip, reason = "manual", ms = 60 * 60 * 1000) {
  bannedIPs.set(ip, { reason, until: Date.now() + ms });
}

function unbanIP(ip) {
  bannedIPs.delete(ip);
}

function addStrike(targetSocket, reason) {
  const ip = targetSocket.ip;
  const count = (strikeCount.get(ip) || 0) + 1;
  strikeCount.set(ip, count);

  console.log("STRIKE", ip, count, reason);

  if (count >= 3) {
    banIP(ip, reason, 60 * 60 * 1000);
    targetSocket.emit(
      "system",
      "Güvenlik ihlali nedeniyle geçici olarak engellendin."
    );
    targetSocket.disconnect(true);
  }
}

function isSpamming(socket) {
  const now = Date.now();
  const last = messageTimestamps.get(socket.id) || 0;
  messageTimestamps.set(socket.id, now);
  return now - last < 800; // 800ms altı spam
}

function containsBannedWord(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return bannedWords.some((w) => lower.includes(w));
}

// ====== SOCKET.IO ======
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 25000,
});

// ====== STATIC ======
app.use(express.static(path.join(__dirname, "public")));

// ====== ADMIN AUTH MIDDLEWARE ======
function requireAdmin(req, res, next) {
  const token =
    req.headers["x-admin-token"] ||
    req.query.token ||
    req.headers.authorization?.replace("Bearer ", "");

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// ====== ADMIN ROUTES (ÖNEMLİ: static'ten SONRA da çalışır) ======
// /admin -> admin panel HTML
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
});

// /admin/api/stats -> online + banned list
app.get("/admin/api/stats", requireAdmin, (req, res) => {
  const banned = Array.from(bannedIPs.entries()).map(([ip, info]) => ({
    ip,
    reason: info.reason,
    until: info.until,
    remainingMs: Math.max(0, info.until - Date.now()),
  }));

  res.json({
    ok: true,
    online: onlineCount,
    waiting: waitingUser ? waitingUser.id : null,
    banned,
  });
});

// ip ban
app.post("/admin/api/ban", requireAdmin, (req, res) => {
  const { ip, minutes, reason } = req.body || {};
  if (!ip) return res.status(400).json({ ok: false, error: "ip required" });

  const mins = Number(minutes || 60);
  const ms = Math.max(1, mins) * 60 * 1000;

  banIP(String(ip).trim(), reason || "manual", ms);
  res.json({ ok: true });
});

// ip unban
app.post("/admin/api/unban", requireAdmin, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ ok: false, error: "ip required" });

  unbanIP(String(ip).trim());
  res.json({ ok: true });
});

// ====== MATCHING ======
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

    // waitingUser olan initiator olsun
    other.emit("matched", true);
    socket.emit("matched", false);
    return;
  }

  waitingUser = socket;
  socket.emit("waiting");
}

io.on("connection", (socket) => {
  socket.ip = getIP(socket);

  if (isBanned(socket.ip)) {
    console.log("BANNED blocked:", socket.ip);
    socket.disconnect(true);
    return;
  }

  onlineCount++;
  io.emit("onlineCount", onlineCount);

  socket.nickname = generateNickname();
  socket.partner = null;

  enqueue(socket);

  // Report -> karşı taraf strike
  socket.on("report", () => {
    if (!socket.partner) return;
    addStrike(socket.partner, "report");
    console.log("REPORT:", socket.partner.ip);
  });

  // Chat message
  socket.on("message", (msg) => {
    if (!socket.partner) return;

    if (isSpamming(socket)) {
      socket.emit("system", "Çok hızlı mesaj gönderiyorsun.");
      return;
    }

    if (containsBannedWord(msg)) {
      socket.emit("system", "Mesajın uygunsuz içerik nedeniyle gönderilmedi.");
      addStrike(socket, "banned_word");
      return;
    }

    socket.partner.emit("message", { from: socket.nickname, text: msg });
  });

  // WebRTC signaling
  socket.on("offer", (data) => {
    if (socket.partner) socket.partner.emit("offer", data);
  });
  socket.on("answer", (data) => {
    if (socket.partner) socket.partner.emit("answer", data);
  });
  socket.on("ice-candidate", (data) => {
    if (socket.partner) socket.partner.emit("ice-candidate", data);
  });

  // Skip
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

import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const adminSessions = new Set();
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

  const BAN_DURATION = 1 * 60 * 1000; // 1 dakika

  // 3 ihlal = ban
  if (count >= 3) {

    const until = Date.now() + BAN_DURATION;

    bannedIPs.set(socket.ip, {
      reason,
      until
    });

    console.log(
      "🚫 BAN:",
      socket.ip,
      "Sebep:", reason,
      "Bitiş:",
      new Date(until).toLocaleString()
    );

    socket.emit(
      "system",
      "3 ihlal yaptığın için 1 dakika banlandın."
    );

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

    socket.on("admin:getData", () => {

  const banList = [...bannedIPs.keys()];

  socket.emit("admin:data", {
    online: onlineCount,
    bans: banList
  });

  });


  function isBanned(ip) {
  const ban = bannedIPs.get(ip);

  if (!ban) return false;

  // Süresi bittiyse kaldır
  if (ban.until && ban.until < Date.now()) {

    console.log("✅ BAN KALKTI:", ip);

    bannedIPs.delete(ip);
    return false;
  }

  console.log("⛔ BANNED IP DENEDİ:", ip);

  return true;
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


app.get("/admin/bans", (req, res) => {

  let html = `
  <h2>🚫 Ban Listesi</h2>
  <table border="1" cellpadding="8">
  <tr>
    <th>IP</th>
    <th>Sebep</th>
    <th>Bitiş</th>
  </tr>
  `;

  for (const [ip, info] of bannedIPs.entries()) {

    const until = info.until
      ? new Date(info.until).toLocaleString()
      : "Süresiz";

    html += `
      <tr>
        <td>${ip}</td>
        <td>${info.reason}</td>
        <td>${until}</td>
      </tr>
    `;
  }

  html += "</table>";

  res.send(html);
});

app.get("/admin/unban", (req, res) => {
  const ip = req.query.ip;

  if (!ip) {
    return res.status(400).send("IP adresi girilmedi.");
  }

  if (!bannedIPs.has(ip)) {
    return res.send(`❗ ${ip} zaten banlı değil.`);
  }

  bannedIPs.delete(ip);

  res.send(`✅ ${ip} banı kaldırıldı.`);
});


app.post("/admin/login", express.json(), (req, res) => {

  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false });
  }

  const token = Math.random().toString(36).slice(2);

  adminSessions.add(token);

  res.json({ success: true, token });
});


app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin/index.html"));
});


app.get("/admin/data", (req, res) => {

  const token = req.headers["x-admin-token"];

  if (!adminSessions.has(token)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const users = [];

  for (const [id, s] of io.sockets.sockets) {
    users.push({
      id,
      ip: s.ip,
      nick: s.nickname,
      connected: !!s.partner
    });
  }

  res.json({
    online: onlineCount,
    users,
    bans: Array.from(bannedIPs.entries())
  });
});


/* START */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () =>
  console.log("Server running:", PORT)
);

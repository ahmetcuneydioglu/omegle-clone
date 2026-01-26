import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import session from "express-session";



dotenv.config();

// socket.id => user info
const liveUsers = new Map();


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);


app.use(session({
  name: "admin-session",
  secret: process.env.SESSION_SECRET || "devsecret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // HTTPS olunca true yapacağız
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 2 // 2 saat
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());


// ====== AYARLAR ======
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin-123"; // Render ENV'e koyacağız
const bannedWords = ["amk", "sik", "küfür3"];

const adminUser = {
  username: process.env.ADMIN_USER,
  passwordHash: bcrypt.hashSync(process.env.ADMIN_PASS, 10)
};


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

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }

  res.redirect("/admin/login.html");
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

  const user = liveUsers.get(targetSocket.id);
  if (user) user.strikes = count;

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



// ====== ADMIN ROUTES (ÖNEMLİ: static'ten SONRA da çalışır) ======

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin/index.html"));
});



app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login.html");
  });
});


// ====== STATIC ======
app.use(express.static(path.join(__dirname, "public")));


// /admin/api/stats -> online + banned list
app.get("/admin/api/stats", requireAdmin, (req, res) => {

  const banned = Array.from(bannedIPs.entries()).map(([ip, info]) => ({
    ip,
    reason: info.reason,
    until: info.until
  }));

  const users = Array.from(liveUsers.entries()).map(([id, u]) => ({
    id,
    ip: u.ip,
    nickname: u.nickname,
    strikes: strikeCount.get(u.ip) || 0
  }));

  res.json({
    ok: true,
    online: onlineCount,
    users,
    banned
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

app.post("/admin/api/kick", requireAdmin, (req,res)=>{

  const { socketId } = req.body;

  const sock = io.sockets.sockets.get(socketId);

  if(!sock){
    return res.json({ ok:false });
  }

  sock.disconnect(true);

  res.json({ ok:true });
});

app.post("/admin/api/ban-socket", requireAdmin, (req,res)=>{

  const { socketId, minutes } = req.body;

  const sock = io.sockets.sockets.get(socketId);

  if(!sock){
    return res.json({ ok:false });
  }

  const mins = Number(minutes||60);

  banIP(sock.ip,"admin",mins*60000);

  sock.disconnect(true);

  res.json({ ok:true });
});



app.get("/admin/api/users", requireAdmin, (req, res) => {

  const list = [...liveUsers.values()];

  res.json({
    ok: true,
    users: list
  });
});


app.post("/admin/api/kick", requireAdmin, (req, res) => {

  const { id } = req.body;

  const socket = io.sockets.sockets.get(id);

  if (!socket) return res.json({ ok: false });

  socket.disconnect(true);

  res.json({ ok: true });
});


app.post("/admin/api/ban-user", requireAdmin, (req, res) => {

  const { id } = req.body;

  const socket = io.sockets.sockets.get(id);

  if (!socket) return res.json({ ok: false });

  banIP(socket.ip, "admin-ban", 60 * 60 * 1000);
  socket.disconnect(true);

  res.json({ ok: true });
});



// Admin login API
app.post("/admin/login", async (req, res) => {

  const { username, password } = req.body;

  if (
    username !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({ error: "Hatalı giriş" });
  }

  req.session.admin = true;

  res.json({ success: true });
});




// ====== MATCHING ======
let waitingUser = null;
let onlineCount = 0;

function adminAuth(req, res, next) {
  const token = req.cookies.admin_token;

  if (!token) return res.redirect("/admin/login.html");

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.redirect("/admin/login.html");
  }
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

    if (liveUsers.has(socket.id))
      liveUsers.get(socket.id).partner = other.id;

      if (liveUsers.has(other.id))
      liveUsers.get(other.id).partner = socket.id;


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

  liveUsers.set(socket.id, {
    ip: socket.ip,
    nickname: socket.nickname,
    strikes: strikeCount.get(socket.ip) || 0
  });



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

    liveUsers.delete(socket.id);
    

  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));

// server/index.js

import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let waitingUser = null;
let onlineCount = 0;

const bannedIPs = new Map();
const liveUsers = new Map();

// ================= MIDDLEWARE =================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: "admin-session",
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false
}));

// ================= BAN CHECK =================

function checkBan(req, res, next) {

  // Buralar serbest
  if (
    req.path.startsWith("/banned") ||
    req.path.startsWith("/admin") ||
    req.path.startsWith("/socket.io")
  ) return next();

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  const ban = bannedIPs.get(ip);

  if (!ban) return next();

  if (ban.until < Date.now()) {
    bannedIPs.delete(ip);
    return next();
  }

  res.redirect(`/banned.html?until=${ban.until}`);
}

app.use(checkBan);
app.use(express.static(path.join(__dirname, "public")));

// ================= HELPERS =================

function getIP(socket) {
  return socket.handshake.headers["x-forwarded-for"]?.split(",")[0]
    || socket.handshake.address;
}

function banIP(ip, reason, ms) {
  bannedIPs.set(ip, {
    reason,
    until: Date.now() + ms
  });
}

function isBanned(ip) {
  const ban = bannedIPs.get(ip);

  if (!ban) return false;

  if (ban.until < Date.now()) {
    bannedIPs.delete(ip);
    return false;
  }

  return true;
}

function genNick() {
  return "Stranger#" + Math.floor(1000 + Math.random() * 9000);
}

// ================= ADMIN =================

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.redirect("/admin/login.html");
}

app.post("/admin/login", (req, res) => {

  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.admin = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ ok: false });
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login.html");
  });
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin/index.html"));
});

// ================= ADMIN API =================

app.get("/admin/api/stats", requireAdmin, (req, res) => {

  const users = [...liveUsers.entries()].map(([id, u]) => ({
    id,
    ip: u.ip,
    nickname: u.nickname
  }));

  const banned = [...bannedIPs.entries()].map(([ip, b]) => ({
    ip,
    reason: b.reason,
    until: b.until
  }));

  res.json({
    online: onlineCount,
    users,
    banned
  });
});

app.post("/admin/api/kick", requireAdmin, (req, res) => {

  const sock = io.sockets.sockets.get(req.body.socketId);
  if (!sock) return res.json({ ok: false });

  sock.emit("force-kick");
  sock.disconnect(true);

  res.json({ ok: true });
});

app.post("/admin/api/ban-socket", requireAdmin, (req, res) => {

  const sock = io.sockets.sockets.get(req.body.socketId);
  if (!sock) return res.json({ ok: false });

  const mins = Number(req.body.minutes || 60);

  banIP(sock.ip, "admin", mins * 60000);

  sock.emit("force-ban", {
    until: bannedIPs.get(sock.ip).until
  });

  sock.disconnect(true);

  res.json({ ok: true });
});

// ================= MATCHING =================

function enqueue(socket) {

  if (socket.partner) return;

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

// ================= SOCKET =================

io.on("connection", socket => {

  socket.ip = getIP(socket);

  // BANLI GELİRSE
  if (isBanned(socket.ip)) {

    socket.emit("force-ban", {
      until: bannedIPs.get(socket.ip).until
    });

    return socket.disconnect(true);
  }

  socket.nickname = genNick();
  socket.partner = null;

  onlineCount++;
  io.emit("onlineCount", onlineCount);

  liveUsers.set(socket.id, {
    ip: socket.ip,
    nickname: socket.nickname
  });

  enqueue(socket);

  // MESSAGE
  socket.on("message", msg => {

    if (!socket.partner) return;

    socket.partner.emit("message", {
      from: socket.nickname,
      text: msg
    });
  });

  // DISCONNECT
  socket.on("disconnect", () => {

    onlineCount--;
    io.emit("onlineCount", onlineCount);

    liveUsers.delete(socket.id);

    if (waitingUser === socket) waitingUser = null;

    const p = socket.partner;

    if (p) {
      p.partner = null;
      p.emit("partnerDisconnected");
      enqueue(p);
    }
  });
});

// ================= START =================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running:", PORT);
});

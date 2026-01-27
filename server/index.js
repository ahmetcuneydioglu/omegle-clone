import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

// admin'in izlediği oda
let spyRoom = null;
let adminSockets = new Set();



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// ================= MIDDLEWARE =================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: "admin-session",
  secret: process.env.SESSION_SECRET || "secret123",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 2
  }
}));

// ================= SOCKET =================

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ================= GLOBAL =================

let onlineCount = 0;
let waitingUser = null;

const bannedIPs = new Map();
const strikeCount = new Map();
const liveUsers = new Map(); // 👈 CANLI KULLANICILAR

// ================= HELPERS =================

function getIP(socket) {
  const xf = socket.handshake.headers["x-forwarded-for"];
  return (xf && xf.split(",")[0]) || socket.handshake.address;
}

function banIP(ip, reason = "admin", ms = 3600000) {
  bannedIPs.set(ip, {
    reason,
    until: Date.now() + ms
  });
}

function unbanIP(ip) {
  bannedIPs.delete(ip);
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

function addStrike(ip) {
  const n = (strikeCount.get(ip) || 0) + 1;
  strikeCount.set(ip, n);

  if (n >= 3) {
    banIP(ip, "auto");
  }
}

function generateNick() {
  return "Stranger#" + Math.floor(1000 + Math.random() * 9000);
}

// ================= ADMIN AUTH =================

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.redirect("/admin/login.html");
}

// ================= STATIC =================

app.use(express.static(path.join(__dirname, "public")));

// ================= ADMIN LOGIN =================

app.post("/admin/login", (req, res) => {

  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.admin = true;

    return res.json({ success: true });
  }

  res.status(401).json({ error: "Hatalı giriş" });
});



app.get("/admin/logout", (req, res) => {

  req.session.destroy(() => {
    res.redirect("/admin/login.html");
  });

});


// ================= ADMIN PANEL =================

app.get("/admin", requireAdmin, (req,res)=>{
  res.sendFile(path.join(__dirname,"public/admin/index.html"));
});

// ================= ADMIN API =================

// STATISTICS
app.get("/admin/api/stats", requireAdmin, (req,res)=>{

  const users = Array.from(liveUsers.entries()).map(([id,u])=>({
    id,
    ip: u.ip,
    nickname: u.nickname,
    strikes: strikeCount.get(u.ip) || 0
  }));

  const banned = Array.from(bannedIPs.entries()).map(([ip,info])=>({
    ip,
    reason: info.reason,
    until: info.until
  }));

  res.json({
    ok:true,
    online: onlineCount,
    users,
    banned
  });
});

app.post("/admin/api/spy", requireAdmin, (req, res) => {

  const { socketId } = req.body;

  const sock = io.sockets.sockets.get(socketId);

  if (!sock || !sock.partner) {
    return res.json({ ok: false });
  }

  // Odayı işaretle
  spyRoom = {
    a: sock.id,
    b: sock.partner.id
  };

  res.json({ ok: true });
});



// KICK
app.post("/admin/api/kick", requireAdmin, (req,res)=>{

  const { socketId } = req.body;

  const sock = io.sockets.sockets.get(socketId);

  if(!sock) return res.json({ ok:false });

  sock.disconnect(true);

  res.json({ ok:true });
});


// BAN SOCKET
app.post("/admin/api/ban-socket", requireAdmin, (req,res)=>{

  const { socketId, minutes } = req.body;

  const sock = io.sockets.sockets.get(socketId);

  if(!sock) return res.json({ ok:false });

  const mins = Number(minutes || 60);

  banIP(sock.ip,"admin",mins*60000);

  sock.disconnect(true);

  res.json({ ok:true });
});


// MANUAL IP BAN
app.post("/admin/api/ban", requireAdmin, (req,res)=>{

  const { ip, minutes } = req.body;

  if(!ip) return res.json({ ok:false });

  banIP(ip,"manual",Number(minutes||60)*60000);

  res.json({ ok:true });
});


// UNBAN
app.post("/admin/api/unban", requireAdmin, (req,res)=>{

  const { ip } = req.body;

  if(!ip) return res.json({ ok:false });

  unbanIP(ip);

  res.json({ ok:true });
});

// ================= MATCHING =================

function enqueue(socket){

  if(!socket || socket.disconnected) return;
  if(socket.partner) return;

  if(waitingUser && (waitingUser.disconnected || waitingUser.partner)){
    waitingUser = null;
  }

  if(waitingUser){

    const other = waitingUser;
    waitingUser = null;

    socket.partner = other;
    other.partner = socket;

    other.emit("matched",true);
    socket.emit("matched",false);

    return;
  }

  waitingUser = socket;
  socket.emit("waiting");
}

// ================= SOCKET EVENTS =================

io.on("connection",(socket)=>{

  if (socket.handshake.query.admin === "1") { 
    socket.join("admin-room");
    console.log("ADMIN CONNECTED:", socket.id);
  }

  socket.ip = getIP(socket);

  if(isBanned(socket.ip)){
    socket.disconnect(true);
    return;
  }

  socket.nickname = generateNick();
  socket.partner = null;

  onlineCount++;
  io.emit("onlineCount",onlineCount);

  // CANLI LİSTEYE EKLE
  liveUsers.set(socket.id,{
    ip: socket.ip,
    nickname: socket.nickname
  });

  enqueue(socket);

  // MESSAGE
  socket.on("message",(msg)=>{

    if(!socket.partner) return;

    socket.partner.emit("message",{
      from: socket.nickname,
      text: msg
    });

    // ADMIN SPY
     if (
        spyRoom &&
        (spyRoom.a === socket.id || spyRoom.b === socket.id)
      ) {
        io.to("admin-room").emit("admin-spy", {
          from: socket.nickname,
          text: msg
        });
      }



  });

  // REPORT
  socket.on("report",()=>{

    if(!socket.partner) return;

    addStrike(socket.partner.ip);
  });

  // WEBRTC
  socket.on("offer",(d)=>{
    if(socket.partner) socket.partner.emit("offer",d);
  });

  socket.on("answer",(d)=>{
    if(socket.partner) socket.partner.emit("answer",d);
  });

  socket.on("ice-candidate",(d)=>{
    if(socket.partner) socket.partner.emit("ice-candidate",d);
  });

  // SKIP
  socket.on("skip",()=>{

    const p = socket.partner;

    if(p){
      p.partner = null;
      p.emit("partnerDisconnected");
    }

    socket.partner = null;

    if(waitingUser === socket || waitingUser === p){
      waitingUser = null;
    }

    enqueue(socket);
    if(p) enqueue(p);
  });

  if (socket.handshake.query.admin === "1") {
    adminSockets.add(socket.id);
  }

  // DISCONNECT
  socket.on("disconnect",()=>{

    onlineCount--;
    io.emit("onlineCount",onlineCount);

    liveUsers.delete(socket.id);

    if(waitingUser === socket){
      waitingUser = null;
    }

    const p = socket.partner;

    if(p){
      p.partner = null;
      p.emit("partnerDisconnected");
      enqueue(p);
    }
    adminSockets.delete(socket.id);

  });
});

// ================= START =================

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>{
  console.log("Server running:",PORT);
});

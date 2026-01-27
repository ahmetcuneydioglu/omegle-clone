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

// Abuse score: ip => score
const abuseScore = new Map();


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

function checkBan(req, res, next) {

  const allowList = [
    "/banned.html",
    "/admin",
    "/admin/login",
    "/admin/logout"
  ];

  if (allowList.some(p => req.path.startsWith(p))) {
    return next();
  }

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  const ban = bannedIPs.get(ip);

  // Ban yoksa devam et
  if (!ban) return next();

  // Süresi bitmişse sil, devam et
  if (ban.until < Date.now()) {
    bannedIPs.delete(ip);
    return next();
  }

  // Aktif ban varsa yönlendir
  return res.redirect(`/banned.html?until=${ban.until}`);
}




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

function addAbuse(ip, point, reason = "") {

  const current = abuseScore.get(ip) || 0;
  const next = current + point;

  abuseScore.set(ip, next);

  console.log("ABUSE", ip, next, reason);

  return next;
}

function reduceAbuse(ip, point = 1) {

  const current = abuseScore.get(ip) || 0;
  const next = Math.max(0, current - point);

  abuseScore.set(ip, next);

  return next;
}


function addStrike(ip) {
  const until = Date.now() + 60*60*1000;

    banIP(ip,"auto",60*60*1000);


    setTimeout(()=>{
      socket.disconnect(true);
    },200);

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

app.use(checkBan);
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
    strikes: strikeCount.get(u.ip) || 0,
    abuse: abuseScore.get(u.ip) || 0

  }));

  const banned = Array.from(bannedIPs.entries()).map(([ip,info])=>({

  ip,
  reason: info.reason,
  until: info.until,
  remaining: Math.max(0, info.until - Date.now())

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

  
  sock.emit("force-ban",{
  until: bannedIPs.get(sock.ip).until,
  reason: "Admin tarafından"
});

setTimeout(()=>{
  sock.emit("force-kick");
  sock.disconnect(true);
},200);

  res.json({ ok:true });
});


// BAN SOCKET
app.post("/admin/api/ban-socket", requireAdmin, (req,res)=>{

  const { socketId, minutes } = req.body;

  const sock = io.sockets.sockets.get(socketId);

  if(!sock) return res.json({ ok:false });

  const mins = Number(minutes || 60);

  banIP(sock.ip,"admin",mins*60000);

  sock.emit("force-ban",{
  until: bannedIPs.get(sock.ip).until,
  reason: "Admin tarafından"
});

setTimeout(()=>{
  sock.disconnect(true);
},200);


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

    // Abuse sıfırla (yeni eşleşme temiz başlasın)
    abuseScore.set(socket.ip, 0);
    abuseScore.set(other.ip, 0);

    other.emit("matched", true);
    socket.emit("matched", false);

    return;
  }

  waitingUser = socket;
  socket.emit("waiting");
}


// ================= SOCKET EVENTS =================

io.on("connection",(socket)=>{


  socket.ip = getIP(socket);

  socket.on("reportUser", () => {

  if (!socket.partner) return;

  const target = socket.partner;
  const ip = target.ip;

  // Abuse puanı artır
  const score = addAbuse(ip, 3, "report");

  console.log("REPORT:", ip, "score =", score);

  // İlk uyarı
  if (score >= 3 && score < 6) {

    target.emit("system",
      "⚠️ Şikayet alıyorsun. Kurallara dikkat et!"
    );
  }

  // Kick
  if (score >= 6 && score < 9) {

    target.emit("system",
      "⛔ Çok fazla şikayet! Bağlantın kesiliyor."
    );

    setTimeout(() => {
      target.disconnect(true);
    }, 300);
  }

  // Ban
  if (score >= 9) {

    banIP(ip, "report abuse", 60 * 60 * 1000);

    target.emit("force-ban", {
      until: bannedIPs.get(ip).until,
      reason: "Çok fazla şikayet"
    });

    setTimeout(() => {
      target.disconnect(true);
    }, 300);
  }

});




  if (isBanned(socket.ip)) {

  socket.emit("banned", {
  until: bannedIPs.get(socket.ip)?.until
    });

    setTimeout(()=>{
      socket.disconnect(true);
    },100);

}

if (socket.handshake.query.admin === "1") { 
    socket.join("admin-room");
    console.log("ADMIN CONNECTED:", socket.id);
  }


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

  // Spam kontrol
  const now = Date.now();
  if (!socket.lastMsg) socket.lastMsg = 0;

  if (now - socket.lastMsg < 700) {
    const s = addAbuse(socket.ip, 1, "spam");

    if (s >= 8) {
      socket.disconnect(true);
      return;
    }
  }

  socket.lastMsg = now;

  // Küfür kontrol
  const badWords = ["amk","sik","piç","orospu","yarrak"];

  if (badWords.some(w => msg.toLowerCase().includes(w))) {

    const s = addAbuse(socket.ip, 3, "badword");

    socket.emit("system","⚠️ Uygunsuz mesaj!");

    if (s >= 12) {
      banIP(socket.ip,"abuse",60*60*1000);
      socket.disconnect(true);
      console.log("BANNED:", socket.ip);
      return;
    }

    return;
  }

  // Normal mesaj → puan düşür
  reduceAbuse(socket.ip,1);

  // Mesaj gönder
  socket.partner.emit("message",{
    from: socket.nickname,
    text: msg
  });


  // Spy Mode
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

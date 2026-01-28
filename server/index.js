import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

/* ================= SETUP ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

/* ================= GLOBAL ================= */

let onlineCount = 0;
let waitingUser = null;

const bannedIPs = new Map();
const abuseScore = new Map();
const liveUsers = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: "admin-session",
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname,"public")));

/* ================= HELPERS ================= */

function getIP(socket){

  const xf = socket.handshake.headers["x-forwarded-for"];

  return (xf && xf.split(",")[0]) || socket.handshake.address;
}

function banIP(ip, reason, ms){

  bannedIPs.set(ip,{
    reason,
    until: Date.now() + ms
  });
}

function isBanned(ip){

  const ban = bannedIPs.get(ip);

  if(!ban) return false;

  if(ban.until < Date.now()){
    bannedIPs.delete(ip);
    return false;
  }

  return true;
}

function addAbuse(ip, point){

  const cur = abuseScore.get(ip) || 0;
  const next = cur + point;

  abuseScore.set(ip,next);

  console.log("ABUSE:",ip,next);

  return next;
}

function reduceAbuse(ip, point = 1){

  const cur = abuseScore.get(ip) || 0;

  abuseScore.set(ip, Math.max(0, cur - point));
}

function generateNick(){

  return "Stranger#" + Math.floor(1000 + Math.random()*9000);
}

/* ================= MATCHING ================= */

function enqueue(socket){

  if(!socket || socket.disconnected) return;
  if(socket.partner) return;

  if(waitingUser &&
     (waitingUser.disconnected || waitingUser.partner)){
    waitingUser = null;
  }

  if(waitingUser){

    const other = waitingUser;

    waitingUser = null;

    socket.partner = other;
    other.partner = socket;

    abuseScore.set(socket.ip,0);
    abuseScore.set(other.ip,0);

    other.emit("matched",true);
    socket.emit("matched",false);

    return;
  }

  waitingUser = socket;

  socket.emit("waiting");
}

/* ================= SOCKET ================= */

io.on("connection",(socket)=>{

  socket.ip = getIP(socket);

  /* BAN KONTROL */

  if(isBanned(socket.ip)){

    socket.emit("force-ban",{
      until: bannedIPs.get(socket.ip)?.until,
      reason:"Banned"
    });

    socket.disconnect(true);
    return;
  }

  /* INIT */

  socket.nickname = generateNick();
  socket.partner = null;

  onlineCount++;

  io.emit("onlineCount",onlineCount);

  liveUsers.set(socket.id,{
    ip: socket.ip,
    nick: socket.nickname
  });


  /* ================= START ================= */

  socket.on("start",()=>{

    console.log("START:",socket.id);

    if(socket.partner) return;

    enqueue(socket);
  });


  /* ================= REPORT ================= */

  socket.on("reportUser",()=>{

    if(!socket.partner) return;

    const target = socket.partner;

    const score = addAbuse(target.ip,3);

    if(score >= 3 && score < 6){

      target.emit("system","⚠️ Şikayet alıyorsun!");
    }

    if(score >= 6 && score < 9){

      target.emit("system","⛔ Bağlantın kesiliyor!");

      setTimeout(()=>{
        target.disconnect(true);
      },300);
    }

    if(score >= 9){

      banIP(target.ip,"abuse",60*60*1000);

      target.emit("force-ban",{
        until:bannedIPs.get(target.ip).until,
        reason:"Çok fazla şikayet"
      });

      setTimeout(()=>{
        target.disconnect(true);
      },300);
    }
  });


  /* ================= MESSAGE ================= */

  socket.on("message",(msg)=>{

    if(!socket.partner) return;

    const now = Date.now();

    if(!socket.lastMsg) socket.lastMsg = 0;

    if(now - socket.lastMsg < 700){

      const s = addAbuse(socket.ip,1);

      if(s >= 8){
        socket.disconnect(true);
        return;
      }
    }

    socket.lastMsg = now;

    const bad = ["amk","sik","orospu","piç","yarrak"];

    if(bad.some(w => msg.toLowerCase().includes(w))){

      const s = addAbuse(socket.ip,3);

      socket.emit("system","⚠️ Uygunsuz mesaj!");

      if(s >= 12){

        banIP(socket.ip,"abuse",60*60*1000);

        socket.disconnect(true);
      }

      return;
    }

    reduceAbuse(socket.ip,1);

    socket.partner.emit("message",{
      from: socket.nickname,
      text: msg
    });
  });


  /* ================= WEBRTC ================= */

  socket.on("offer",(d)=>{
    if(socket.partner) socket.partner.emit("offer",d);
  });

  socket.on("answer",(d)=>{
    if(socket.partner) socket.partner.emit("answer",d);
  });

  socket.on("ice-candidate",(d)=>{
    if(socket.partner) socket.partner.emit("ice-candidate",d);
  });


  /* ================= SKIP ================= */

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


  /* ================= DISCONNECT ================= */

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
  });

});


/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>{

  console.log("Server running:",PORT);
});

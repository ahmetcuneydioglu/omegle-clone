import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let waitingUser = null;
let onlineCount = 0;

const messageTimestamps = new Map();

function isSpamming(socket) {
  const now = Date.now();
  const last = messageTimestamps.get(socket.id) || 0;
  messageTimestamps.set(socket.id, now);

  // 800 ms'den hızlı mesaj = spam
  return now - last < 800;
}


const bannedWords = [
  "amk",
  "sik",
  "küfür3"
  // buraya istediğini ekleyebilirsin
];

function containsBannedWord(text) {
  const lower = text.toLowerCase();
  return bannedWords.some(word => lower.includes(word));
}




function generateNickname() {
  return "Stranger #" + Math.floor(1000 + Math.random() * 9000);
}

function enqueue(socket) {
  if (!socket || socket.disconnected) return;
  if (socket.partner) return;

  if (waitingUser && !waitingUser.disconnected && waitingUser.id !== socket.id) {
    const other = waitingUser;
    waitingUser = null;

    socket.partner = other;
    other.partner = socket;

    socket.emit("matched");
    other.emit("matched");
  } else {
    waitingUser = socket;
    socket.emit("waiting");
  }
}

io.on("connection", (socket) => {
  onlineCount++;
  io.emit("onlineCount", onlineCount);

  socket.nickname = generateNickname();
  socket.partner = null;

  enqueue(socket);

  socket.on("message", (msg) => {
  if (!socket.partner) return;

  // Spam kontrolü
  if (isSpamming(socket)) {
    socket.emit("system", "Çok hızlı mesaj gönderiyorsun.");
    return;
  }

  // Küfür kontrolü
  if (containsBannedWord(msg)) {
    socket.emit("system", "Mesajın uygunsuz içerik nedeniyle gönderilmedi.");
    return;
  }

  socket.partner.emit("message", {
    from: socket.nickname,
    text: msg
  });
});


  socket.on("skip", () => {
    const partner = socket.partner;

    if (partner) {
      partner.partner = null;
      partner.emit("partnerDisconnected");
    }

    socket.partner = null;
    socket.nickname = generateNickname();

    enqueue(socket);
    enqueue(partner);
  });

  socket.on("disconnect", () => {
    onlineCount--;
    io.emit("onlineCount", onlineCount);

    if (socket === waitingUser) {
      waitingUser = null;
    }

    const partner = socket.partner;
    if (partner) {
      partner.partner = null;
      partner.emit("partnerDisconnected");
      enqueue(partner);
    }
  });
});

server.listen(3000, () => {
  console.log("Server 3000 portunda çalışıyor 🚀");
});

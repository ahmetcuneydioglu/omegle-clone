const socket = io();

const status = document.getElementById("status");
const chat = document.getElementById("chat");
const messages = document.getElementById("messages");
const input = document.getElementById("input");
const send = document.getElementById("send");
const skip = document.getElementById("skip");
const online = document.getElementById("online");

socket.on("onlineCount", (count) => {
  online.innerText = "Online: " + count;
});

socket.on("waiting", () => {
  status.innerText = "Eşleşme bekleniyor...";
});

socket.on("matched", () => {
  status.innerText = "Eşleşti 🎉";
  chat.style.display = "block";
});

socket.on("message", (data) => {
  const div = document.createElement("div");
  div.innerText = `${data.from}: ${data.text}`;
  messages.appendChild(div);
});

send.onclick = () => {
  const msg = input.value.trim();
  if (!msg) return;

  socket.emit("message", msg);

  const div = document.createElement("div");
  div.innerText = "Sen: " + msg;
  messages.appendChild(div);

  input.value = "";
};

skip.onclick = () => {
  messages.innerHTML = "";
  chat.style.display = "none";
  status.innerText = "Yeni eşleşme aranıyor...";
  socket.emit("skip");
};

socket.on("partnerDisconnected", () => {
  messages.innerHTML = "";
  chat.style.display = "none";
  status.innerText = "Karşı taraf ayrıldı. Yeni eşleşme aranıyor...";
  // Burada ekstra emit gerek yok, server zaten enqueue ediyor
});


socket.on("system", (text) => {
  const div = document.createElement("div");
  div.style.color = "red";
  div.innerText = "⚠️ Sistem: " + text;
  messages.appendChild(div);
});


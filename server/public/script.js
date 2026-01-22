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
  chat.classList.remove("hidden");
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

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    send.click();
  }
});

skip.onclick = () => {
  messages.innerHTML = "";
  chat.classList.add("hidden");
  status.innerText = "Yeni eşleşme aranıyor...";
  socket.emit("skip");
};


socket.on("partnerDisconnected", () => {
  messages.innerHTML = "";
  chat.classList.add("hidden");
  status.innerText = "Yeni eşleşme aranıyor...";
});



socket.on("system", (text) => {
  const div = document.createElement("div");
  div.style.color = "red";
  div.innerText = "⚠️ Sistem: " + text;
  messages.appendChild(div);
});


input.addEventListener("focus", () => {
  setTimeout(() => {
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 300);
});


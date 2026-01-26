const socket = io();

const online = document.getElementById("online");
const bans = document.getElementById("bans");
const refresh = document.getElementById("refresh");

function load() {
  socket.emit("admin:getData");
}

refresh.onclick = load;

socket.on("admin:data", (data) => {

  online.innerText = data.online;

  bans.innerHTML = "";

  data.bans.forEach(ip => {
    const li = document.createElement("li");
    li.innerText = ip;
    bans.appendChild(li);
  });
});

load();

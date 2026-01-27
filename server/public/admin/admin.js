let ADMIN_READY = false;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {})
    },
    ...opts
  });

  const ct = res.headers.get("content-type") || "";

  if (ct.includes("text/html")) {
    location.href = "/admin/login.html";
    throw new Error("Not auth");
  }

  return res.json();
}

function el(id) {
  return document.getElementById(id);
}

function msToHuman(ms) {
  if (!ms || ms <= 0) return "-";
  const m = Math.floor(ms / 60000);
  if (m > 0) return m + " dk";
  return Math.floor(ms / 1000) + " sn";
}

// ================= REFRESH =================

async function refresh() {

  const data = await api("/admin/api/stats");

  // ONLINE
  el("onlineCount").innerText = data.online || 0;

  // ================= BANNED =================

  const bannedBox = el("bannedList");

  if (!data.banned.length) {
    bannedBox.innerHTML = `<div class="text-gray-400">Ban yok</div>`;
  } else {

    bannedBox.innerHTML = data.banned.map(b => {

      const remain = Math.max(0, b.until - Date.now());

      return `
        <div class="p-2 border mb-2 rounded">
          <b>${b.ip}</b><br>
          Sebep: ${b.reason}<br>
          Kalan: ${msToHuman(remain)}
        </div>
      `;

    }).join("");
  }

  // ================= USERS =================

  const liveBox = el("liveUsers");

  if (!data.users.length) {
    liveBox.innerHTML = `<div class="text-gray-400">Kullanıcı yok</div>`;
    return;
  }

  liveBox.innerHTML = data.users.map(u => {

    return `
      <div class="p-3 mb-2 rounded bg-slate-900 border flex justify-between">

        <div>
          <b>${u.nickname}</b><br>
          ${u.ip}<br>
          Strike: ${u.strikes}
        </div>

        <div class="flex gap-2">

          <button class="kick bg-yellow-600 px-2 rounded"
            data-id="${u.id}">
            Kick
          </button>

          <button class="ban bg-red-600 px-2 rounded"
            data-id="${u.id}">
            Ban
          </button>

          <button class="spy bg-blue-600 px-2 rounded"
            data-id="${u.id}">
            İzle
          </button>

        </div>
      </div>
    `;

  }).join("");

  bindUserButtons();
}

// ================= BUTTON EVENTS =================

function bindUserButtons() {

  // KICK
  document.querySelectorAll(".kick").forEach(btn => {

    btn.onclick = async () => {

      await api("/admin/api/kick", {
        method: "POST",
        body: JSON.stringify({
          socketId: btn.dataset.id
        })
      });

      refresh();
    };

  });

  // BAN
  document.querySelectorAll(".ban").forEach(btn => {

    btn.onclick = async () => {

      const min = prompt("Kaç dk?", "60");
      if (!min) return;

      await api("/admin/api/ban-socket", {
        method: "POST",
        body: JSON.stringify({
          socketId: btn.dataset.id,
          minutes: Number(min)
        })
      });

      refresh();
    };

  });

  // SPY
  document.querySelectorAll(".spy").forEach(btn => {

    btn.onclick = async () => {

      await api("/admin/api/spy", {
        method: "POST",
        body: JSON.stringify({
          socketId: btn.dataset.id
        })
      });

      alert("Spy başlatıldı");

    };

  });
}

// ================= MANUAL BAN =================

async function manualBan() {

  const ip = el("banIp").value.trim();
  const min = Number(el("banMinutes").value || 60);
  const reason = el("banReason").value || "manual";

  if (!ip) return alert("IP gir");

  await api("/admin/api/ban", {
    method: "POST",
    body: JSON.stringify({ ip, minutes: min, reason })
  });

  refresh();
}

async function manualUnban() {

  const ip = el("banIp").value.trim();

  if (!ip) return alert("IP gir");

  await api("/admin/api/unban", {
    method: "POST",
    body: JSON.stringify({ ip })
  });

  refresh();
}

// ================= INIT =================

function bind() {

  if (ADMIN_READY) return;
  ADMIN_READY = true;

  el("btnRefresh").onclick = refresh;
  el("btnBan").onclick = manualBan;
  el("btnUnban").onclick = manualUnban;

  el("btnLogout").onclick = () => {
    location.href = "/admin/logout";
  };

  refresh();
  setInterval(refresh, 5000);
}

document.addEventListener("DOMContentLoaded", bind);

socket.on("banned",(data)=>{

  const until = data?.until || "";

  window.location.href = "/banned.html?until=" + until;

});



// ================= SPY SOCKET =================

const spySocket = io({ query: { admin: "1" } });

spySocket.on("connect", () => {
  console.log("ADMIN SOCKET CONNECTED:", spySocket.id);
});

spySocket.on("admin-spy", data => {

  const box = document.getElementById("spyBox");

  if (!box) return;

  const div = document.createElement("div");

  div.innerText = `${data.from}: ${data.text}`;

  box.appendChild(div);

  box.scrollTop = box.scrollHeight;
});


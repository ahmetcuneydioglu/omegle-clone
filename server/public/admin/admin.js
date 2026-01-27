// public/admin/admin.js

const socket = io();

async function api(url, opts = {}) {

  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts
  });

  return res.json();
}

// ================= REFRESH =================

async function refresh() {

  const data = await api("/admin/api/stats");

  document.getElementById("onlineCount").innerText = data.online;

  // BAN LIST
  const bannedBox = document.getElementById("bannedList");

  bannedBox.innerHTML = data.banned.length
    ? data.banned.map(b => `
      <div class="p-2 border mb-2 rounded">
        ${b.ip}<br>
        ${new Date(b.until).toLocaleString()}
      </div>
    `).join("")
    : "Ban yok";

  // USERS
  const live = document.getElementById("liveUsers");

  live.innerHTML = data.users.map(u => `
    <div class="p-3 border rounded mb-2 flex justify-between">

      <div>
        <b>${u.nickname}</b><br>
        ${u.ip}
      </div>

      <div class="flex gap-2">

        <button class="kick" data-id="${u.id}">Kick</button>
        <button class="ban" data-id="${u.id}">Ban</button>

      </div>

    </div>
  `).join("");

  bindButtons();
}

// ================= BUTTONS =================

function bindButtons() {

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

  document.querySelectorAll(".ban").forEach(btn => {

    btn.onclick = async () => {

      const min = prompt("Kaç dk?", "60");
      if (!min) return;

      await api("/admin/api/ban-socket", {
        method: "POST",
        body: JSON.stringify({
          socketId: btn.dataset.id,
          minutes: min
        })
      });

      refresh();
    };
  });
}

// ================= INIT =================

document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("btnRefresh").onclick = refresh;

  document.getElementById("btnLogout").onclick = () => {
    location.href = "/admin/logout";
  };

  refresh();
  setInterval(refresh, 5000);
});

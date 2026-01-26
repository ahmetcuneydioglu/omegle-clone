// Token: Panel açılınca bir kere soralım, localStorage'a kaydedelim
let token = localStorage.getItem("ADMIN_TOKEN");
if (!token) {
  token = prompt("Admin Token gir:");
  if (token) localStorage.setItem("ADMIN_TOKEN", token);
}

const elOnline = document.getElementById("online");
const elList = document.getElementById("bannedList");
const btnRefresh = document.getElementById("refresh");

const ip = document.getElementById("ip");
const minutes = document.getElementById("minutes");
const reason = document.getElementById("reason");
const banBtn = document.getElementById("banBtn");
const unbanBtn = document.getElementById("unbanBtn");

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token || "",
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "API error");
  return data;
}

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ss = s % 60;
  if (h > 0) return `${h}sa ${mm}dk`;
  if (m > 0) return `${m}dk ${ss}sn`;
  return `${ss}sn`;
}

async function load() {
  const data = await api("/admin/api/stats");
  elOnline.textContent = data.online;

  elList.innerHTML = "";
  if (!data.banned || data.banned.length === 0) {
    elList.innerHTML = `<div class="text-slate-400">Banlı IP yok.</div>`;
    return;
  }

  for (const b of data.banned) {
    const row = document.createElement("div");
    row.className =
      "bg-slate-900/70 border border-slate-700 rounded-lg p-3 flex items-start gap-3";

    row.innerHTML = `
      <div class="flex-1">
        <div class="font-semibold">${b.ip}</div>
        <div class="text-slate-400 text-xs">Sebep: ${b.reason || "-"}</div>
        <div class="text-slate-400 text-xs">Kalan: ${fmtMs(b.remainingMs || 0)}</div>
      </div>
      <button class="unbanOne bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded-lg text-xs">Unban</button>
    `;

    row.querySelector(".unbanOne").onclick = async () => {
      await api("/admin/api/unban", {
        method: "POST",
        body: JSON.stringify({ ip: b.ip }),
      });
      await load();
    };

    elList.appendChild(row);
  }
}

btnRefresh.onclick = () => load();

banBtn.onclick = async () => {
  if (!ip.value.trim()) return alert("IP gir");
  const mins = minutes.value.trim() ? Number(minutes.value.trim()) : 60;

  await api("/admin/api/ban", {
    method: "POST",
    body: JSON.stringify({
      ip: ip.value.trim(),
      minutes: isNaN(mins) ? 60 : mins,
      reason: reason.value.trim(),
    }),
  });

  await load();
};

unbanBtn.onclick = async () => {
  if (!ip.value.trim()) return alert("IP gir");
  await api("/admin/api/unban", {
    method: "POST",
    body: JSON.stringify({ ip: ip.value.trim() }),
  });
  await load();
};

load().catch((e) => {
  console.error(e);
  alert("Admin API erişimi yok. Token yanlış olabilir veya ENV eksik.");
});

async function loadUsers() {

  const res = await fetch("/admin/api/users");
  const data = await res.json();

  const box = document.getElementById("userList");
  box.innerHTML = "";

  data.users.forEach(u => {

    const div = document.createElement("div");

    div.className =
      "bg-gray-900 p-2 rounded flex justify-between items-center";

    div.innerHTML = `
      <div>
        <b>${u.nickname}</b><br>
        <span class="text-xs text-gray-400">${u.ip}</span><br>
        <span class="text-xs">Strike: ${u.strikes}</span>
      </div>

      <div class="flex gap-1">
        <button class="kick bg-yellow-600 px-2 rounded">Kick</button>
        <button class="ban bg-red-600 px-2 rounded">Ban</button>
      </div>
    `;

    div.querySelector(".kick").onclick = async () => {
      await fetch("/admin/api/kick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id })
      });
    };

    div.querySelector(".ban").onclick = async () => {
      await fetch("/admin/api/ban-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id })
      });
    };

    box.appendChild(div);
  });
}


fetch("/admin/api/kick",{
  method:"POST",
  headers:{ "Content-Type":"application/json"},
  body:JSON.stringify({ socketId })
});


fetch("/admin/api/ban-socket",{
  method:"POST",
  headers:{ "Content-Type":"application/json"},
  body:JSON.stringify({ socketId, minutes:60 })
});


setInterval(loadUsers, 3000);
loadUsers();


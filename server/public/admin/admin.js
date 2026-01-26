let ADMIN_READY = false;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "include", // session cookie
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {})
    },
    ...opts
  });

  // login sayfasına redirect olduysa (HTML dönerse) yakala
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    window.location.href = "/admin/login.html";
    throw new Error("Not authenticated");
  }

  return res.json();
}

function msToHuman(ms) {
  if (!ms || ms <= 0) return "-";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr} saat ${min % 60} dk`;
  if (min > 0) return `${min} dk`;
  return `${sec} sn`;
}

function el(id) {
  return document.getElementById(id);
}

async function refresh() {
  const data = await api("/admin/api/stats");

  // Online
  if (el("onlineCount")) el("onlineCount").innerText = String(data.online ?? 0);

  // Banned list
  const bannedBox = el("bannedList");
  if (bannedBox) {
    const banned = data.banned || [];
    if (banned.length === 0) {
      bannedBox.innerHTML = `<div class="text-sm text-gray-400">Banlı IP yok.</div>`;
    } else {
      bannedBox.innerHTML = banned
        .map((b) => {
          const remaining = b.until ? Math.max(0, b.until - Date.now()) : 0;
          return `
            <div class="p-3 rounded bg-slate-900/60 border border-slate-700 mb-2">
              <div class="font-semibold">${b.ip}</div>
              <div class="text-sm text-gray-400">Sebep: ${b.reason || "-"}</div>
              <div class="text-sm text-gray-400">Kalan: ${msToHuman(remaining)}</div>
            </div>
          `;
        })
        .join("");
    }
  }

  // Live users
  const liveBox = el("liveUsers");
  if (liveBox) {
    const users = data.users || [];
    if (users.length === 0) {
      liveBox.innerHTML = `<div class="text-sm text-gray-400">Canlı kullanıcı yok.</div>`;
    } else {
      liveBox.innerHTML = users
        .map((u) => {
          const nick = u.nickname || "(no nick)";
          const strikes = (u.strikes ?? 0);
          return `
            <div class="p-3 rounded bg-slate-900/60 border border-slate-700 mb-2 flex items-center justify-between gap-3">
              <div>
                <div class="font-semibold">${nick}</div>
                <div class="text-sm text-gray-400">${u.ip || "-"}</div>
                <div class="text-sm text-gray-400">Strike: ${strikes}</div>
                <div class="text-xs text-gray-500">socketId: ${u.id}</div>
              </div>
              <div class="flex gap-2">
                <button class="px-3 py-2 rounded bg-amber-600 hover:bg-amber-700 text-sm"
                        data-action="kick" data-sid="${u.id}">
                  Kick
                </button>
                <button class="px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-sm"
                        data-action="ban" data-sid="${u.id}">
                  Ban
                </button>
              </div>
            </div>
          `;
        })
        .join("");

      // event delegation
      liveBox.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const action = btn.dataset.action;
          const socketId = btn.dataset.sid;

          try {
            if (action === "kick") {
              const r = await api("/admin/api/kick", {
                method: "POST",
                body: JSON.stringify({ socketId })
              });
              if (!r.ok) alert("Kick başarısız (socket bulunamadı).");
            }

            if (action === "ban") {
              const minutes = prompt("Kaç dakika banlansın? (örn 60)", "60");
              if (minutes === null) return;

              const r = await api("/admin/api/ban-socket", {
                method: "POST",
                body: JSON.stringify({ socketId, minutes: Number(minutes || 60) })
              });
              if (!r.ok) alert("Ban başarısız (socket bulunamadı).");
            }

            await refresh();
          } catch (e) {
            console.error(e);
            alert("İşlem sırasında hata: " + e.message);
          }
        });
      });
    }
  }
}

async function manualBan() {
  const ip = el("banIp")?.value?.trim();
  const minutes = Number(el("banMinutes")?.value || 60);
  const reason = el("banReason")?.value?.trim() || "manual";

  if (!ip) return alert("IP gir.");

  const r = await api("/admin/api/ban", {
    method: "POST",
    body: JSON.stringify({ ip, minutes, reason })
  });

  if (!r.ok) alert("Ban başarısız");
  await refresh();
}

async function manualUnban() {
  const ip = el("banIp")?.value?.trim();
  if (!ip) return alert("Unban için IP gir.");

  const r = await api("/admin/api/unban", {
    method: "POST",
    body: JSON.stringify({ ip })
  });

  if (!r.ok) alert("Unban başarısız");
  await refresh();
}

function bind() {
  if (ADMIN_READY) return;
  ADMIN_READY = true;

  el("btnRefresh")?.addEventListener("click", refresh);
  el("btnBan")?.addEventListener("click", manualBan);
  el("btnUnban")?.addEventListener("click", manualUnban);

  el("btnLogout")?.addEventListener("click", () => {
    window.location.href = "/admin/logout";
  });

  refresh();
  setInterval(refresh, 5000);
}

document.addEventListener("DOMContentLoaded", bind);

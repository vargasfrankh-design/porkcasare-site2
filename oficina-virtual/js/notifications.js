import { auth } from "/src/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const ICON_MAP = {
  general: "🔔",
  pedido: "📦",
  documento: "📄",
  comision: "💰",
  reunion: "📅",
  empresa: "🏢",
  plataforma: "⚙️",
};

let currentFilter = "all";
let notificationsCache = [];
let pollTimer = null;

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return mins + " min";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h";
  const days = Math.floor(hrs / 24);
  return days + "d";
}

async function getToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

async function fetchNotifications(type) {
  const token = await getToken();
  if (!token) return;
  let url = "/api/notifications?limit=50";
  if (type && type !== "all") url += "&type=" + encodeURIComponent(type);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    notificationsCache = data.notifications || [];
    updateBadge(data.unreadCount || 0);
    renderNotifications();
  } catch (e) {
    console.error("Notification fetch error:", e);
  }
}

function updateBadge(count) {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;
  if (count > 0) {
    badge.style.display = "flex";
    badge.textContent = count > 99 ? "99+" : count;
  } else {
    badge.style.display = "none";
  }
}

function renderNotifications() {
  const list = document.getElementById("notificationList");
  if (!list) return;

  const filtered =
    currentFilter === "all"
      ? notificationsCache
      : notificationsCache.filter((n) => n.type === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML =
      '<div class="notification-empty">No tienes notificaciones</div>';
    return;
  }

  list.innerHTML = filtered
    .map(
      (n) => `
    <div class="notification-item ${n.read ? "" : "unread"}" data-id="${n.id}">
      <div class="notif-icon ${n.type}">${ICON_MAP[n.type] || "🔔"}</div>
      <div class="notif-body">
        <p class="notif-title">${escapeHtml(n.title)}</p>
        <p class="notif-message">${escapeHtml(n.message)}</p>
        <span class="notif-time">${timeAgo(n.createdAt)}</span>
      </div>
      ${!n.read ? '<div class="notif-unread-dot"></div>' : ""}
    </div>
  `
    )
    .join("");

  list.querySelectorAll(".notification-item.unread").forEach((item) => {
    item.addEventListener("click", () => markAsRead(parseInt(item.dataset.id)));
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

async function markAsRead(id) {
  const token = await getToken();
  if (!token) return;
  try {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ action: "markRead", notificationId: id }),
    });
    const n = notificationsCache.find((x) => x.id === id);
    if (n) n.read = true;
    const unread = notificationsCache.filter((x) => !x.read).length;
    updateBadge(unread);
    renderNotifications();
  } catch (e) {
    console.error("Mark read error:", e);
  }
}

async function markAllRead() {
  const token = await getToken();
  if (!token) return;
  try {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ action: "markAllRead" }),
    });
    notificationsCache.forEach((n) => (n.read = true));
    updateBadge(0);
    renderNotifications();
  } catch (e) {
    console.error("Mark all read error:", e);
  }
}

function init() {
  const bellBtn = document.getElementById("notificationBellBtn");
  const dropdown = document.getElementById("notificationDropdown");
  const markAllBtn = document.getElementById("notifMarkAllRead");

  if (!bellBtn || !dropdown) return;

  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== "none";
    dropdown.style.display = isOpen ? "none" : "flex";
    if (!isOpen) fetchNotifications(currentFilter);
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
      dropdown.style.display = "none";
    }
  });

  if (markAllBtn) {
    markAllBtn.addEventListener("click", markAllRead);
  }

  document.querySelectorAll(".notif-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".notif-filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.type;
      renderNotifications();
    });
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      fetchNotifications("all");
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => fetchNotifications(currentFilter), 60000);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

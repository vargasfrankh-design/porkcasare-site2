import { auth } from "/src/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

let conversationHistory = [];
let isOpen = false;

async function getToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function addMessage(role, content) {
  const container = document.getElementById("assistantMessages");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "assistant-message " + role;
  div.innerHTML =
    '<div class="assistant-msg-content">' + escapeHtml(content) + "</div>";
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  const container = document.getElementById("assistantMessages");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "assistant-message bot typing";
  div.id = "typingIndicator";
  div.innerHTML =
    '<div class="assistant-msg-content"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

async function sendMessage(text) {
  if (!text.trim()) return;

  addMessage("user", text);
  conversationHistory.push({ role: "user", content: text });

  const input = document.getElementById("assistantInput");
  const sendBtn = document.getElementById("assistantSendBtn");
  if (input) input.value = "";
  if (sendBtn) sendBtn.disabled = true;

  showTyping();

  try {
    const token = await getToken();
    if (!token) {
      removeTyping();
      addMessage("bot", "Debes iniciar sesion para usar el asistente.");
      return;
    }

    const previousHistory = conversationHistory.slice(0, -1).slice(-6);
    const resp = await fetch("/api/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        message: text,
        conversationHistory: previousHistory,
      }),
    });

    removeTyping();
    const data = await resp.json();
    const reply =
      data.reply ||
      "Lo siento, no pude procesar tu mensaje. Intenta de nuevo.";
    addMessage("bot", reply);
    conversationHistory.push({ role: "assistant", content: reply });
  } catch (e) {
    removeTyping();
    addMessage(
      "bot",
      "Hubo un error de conexion. Intenta de nuevo o contacta soporte por WhatsApp."
    );
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }
}

function togglePanel() {
  const panel = document.getElementById("assistantPanel");
  const fabIcon = document.querySelector(".assistant-fab-icon");
  const fabClose = document.querySelector(".assistant-fab-close");
  if (!panel) return;

  isOpen = !isOpen;
  panel.style.display = isOpen ? "flex" : "none";
  if (fabIcon) fabIcon.style.display = isOpen ? "none" : "block";
  if (fabClose) fabClose.style.display = isOpen ? "block" : "none";

  if (isOpen) {
    const input = document.getElementById("assistantInput");
    if (input) setTimeout(() => input.focus(), 200);
  }
}

function init() {
  const fab = document.getElementById("assistantFab");
  const closeBtn = document.getElementById("assistantCloseBtn");
  const sendBtn = document.getElementById("assistantSendBtn");
  const input = document.getElementById("assistantInput");
  const quickActions = document.getElementById("assistantQuickActions");

  if (fab) fab.addEventListener("click", togglePanel);
  if (closeBtn) closeBtn.addEventListener("click", togglePanel);

  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const val = input ? input.value : "";
      sendMessage(val);
    });
  }

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });
  }

  if (quickActions) {
    quickActions.querySelectorAll(".quick-action-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        sendMessage(btn.dataset.question);
      });
    });
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
});

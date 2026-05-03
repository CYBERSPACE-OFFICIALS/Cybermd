const express = require("express");
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const pino = require("pino");

const logger = pino({ level: "silent" });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const AUTH_FOLDER = path.join(__dirname, "auth_info_baileys");
const PORT = process.env.PORT || 3000;

let currentQR = null;
let pairingCode = null;
let isConnected = false;
let connectionStatus = "disconnected";
let sseClients = [];
let sock = null;
let reconnectTimer = null;

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter((c) => !c.destroyed);
  sseClients.forEach((c) => {
    try {
      c.write(message);
    } catch (_) {}
  });
}

async function startConnection(usePairingCode = false, phoneNumber = "") {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: ["Cybermd", "Chrome", "3.0.0"],
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    getMessage: async () => ({ conversation: "" }),
  });

  if (usePairingCode && phoneNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const cleaned = phoneNumber.replace(/[^0-9]/g, "");
        const code = await sock.requestPairingCode(cleaned);
        pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
        connectionStatus = "awaiting-pairing";
        broadcast("pairing-code", { code: pairingCode });
        console.log("[Cybermd] Pairing code:", pairingCode);
      } catch (err) {
        console.error("[Cybermd] Pairing code error:", err.message);
        broadcast("error", { message: "Failed to get pairing code: " + err.message });
      }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        currentQR = await QRCode.toDataURL(qr);
        connectionStatus = "awaiting-scan";
        broadcast("qr", { qr: currentQR });
        console.log("[Cybermd] New QR code generated");
      } catch (err) {
        console.error("[Cybermd] QR error:", err);
      }
    }

    if (connection === "close") {
      isConnected = false;
      currentQR = null;
      pairingCode = null;

      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("[Cybermd] Connection closed. Status code:", statusCode);

      if (statusCode === DisconnectReason.loggedOut) {
        connectionStatus = "logged-out";
        broadcast("status", {
          status: "logged-out",
          message: "Logged out. Please reconnect.",
        });
        try {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        } catch (_) {}
      } else if (
        statusCode === DisconnectReason.badSession ||
        statusCode === DisconnectReason.connectionClosed ||
        statusCode === DisconnectReason.connectionLost ||
        statusCode === DisconnectReason.connectionReplaced ||
        statusCode === DisconnectReason.timedOut ||
        statusCode === DisconnectReason.restartRequired
      ) {
        connectionStatus = "reconnecting";
        broadcast("status", { status: "reconnecting", message: "Reconnecting..." });
        reconnectTimer = setTimeout(() => startConnection(), 5000);
      } else {
        connectionStatus = "disconnected";
        broadcast("status", { status: "disconnected", message: "Disconnected." });
      }
    } else if (connection === "open") {
      isConnected = true;
      currentQR = null;
      pairingCode = null;
      connectionStatus = "connected";

      const user = sock.user;
      const number = user?.id?.split(":")[0] || user?.id || "";
      const name = user?.name || "Bot";

      console.log("[Cybermd] Connected as:", number, "-", name);
      broadcast("connected", {
        status: "connected",
        number,
        name,
        message: "Bot is now connected and running!",
      });
    } else if (connection === "connecting") {
      connectionStatus = "connecting";
      broadcast("status", { status: "connecting", message: "Connecting to WhatsApp..." });
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      console.log("[Cybermd] Message from:", from);
    }
  });
}

app.get("/api/status", (req, res) => {
  res.json({
    connected: isConnected,
    status: connectionStatus,
    hasQR: !!currentQR,
    hasPairingCode: !!pairingCode,
  });
});

app.post("/api/connect/qr", async (req, res) => {
  if (isConnected) {
    return res.json({ success: false, message: "Bot is already connected." });
  }
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      try {
        await sock.logout();
      } catch (_) {}
      sock = null;
    }
    currentQR = null;
    pairingCode = null;
    await startConnection(false);
    res.json({ success: true, message: "Generating QR code..." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/connect/pair", async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: "Phone number is required." });
  }
  if (isConnected) {
    return res.json({ success: false, message: "Bot is already connected." });
  }
  const cleaned = phoneNumber.replace(/[^0-9]/g, "");
  if (cleaned.length < 7 || cleaned.length > 15) {
    return res.status(400).json({ success: false, message: "Invalid phone number." });
  }
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      try {
        await sock.logout();
      } catch (_) {}
      sock = null;
    }
    currentQR = null;
    pairingCode = null;
    await startConnection(true, cleaned);
    res.json({ success: true, message: "Requesting pairing code..." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/disconnect", async (req, res) => {
  try {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sock) {
      sock.ev.removeAllListeners();
      try {
        await sock.logout();
      } catch (_) {}
      sock = null;
    }
    try {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    } catch (_) {}
    isConnected = false;
    currentQR = null;
    pairingCode = null;
    connectionStatus = "disconnected";
    broadcast("status", { status: "disconnected", message: "Bot disconnected." });
    res.json({ success: true, message: "Disconnected and session cleared." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const sendCurrentState = () => {
    if (isConnected && sock?.user) {
      const number = sock.user?.id?.split(":")[0] || "";
      const name = sock.user?.name || "Bot";
      res.write(
        `event: connected\ndata: ${JSON.stringify({
          status: "connected",
          number,
          name,
          message: "Bot is connected.",
        })}\n\n`
      );
    } else if (currentQR) {
      res.write(`event: qr\ndata: ${JSON.stringify({ qr: currentQR })}\n\n`);
    } else if (pairingCode) {
      res.write(
        `event: pairing-code\ndata: ${JSON.stringify({ code: pairingCode })}\n\n`
      );
    } else {
      res.write(
        `event: status\ndata: ${JSON.stringify({
          status: connectionStatus,
          message: "Waiting...",
        })}\n\n`
      );
    }
  };

  sendCurrentState();
  sseClients.push(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(":heartbeat\n\n");
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((c) => c !== res);
  });
});

app.get("/session", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "session.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║       CYBERMD SESSION SERVER      ║`);
  console.log(`║  Port: ${String(PORT).padEnd(26)}║`);
  console.log(`╚══════════════════════════════════╝\n`);
  await startConnection();
});

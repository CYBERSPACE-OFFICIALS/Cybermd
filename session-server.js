const express = require("express");
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const pino = require("pino");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const AUTH_FOLDER = "./auth_info_baileys";
const PORT = process.env.PORT || 3000;

let currentQR = null;
let pairingCode = null;
let isConnected = false;
let connectionStatus = "disconnected";
let sseClients = [];
let sock = null;

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter((client) => !client.destroyed);
  sseClients.forEach((client) => {
    try {
      client.write(message);
    } catch (e) {}
  });
}

async function startConnection(usePairingCode = false, phoneNumber = "") {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["Cybermd", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
  });

  if (usePairingCode && phoneNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, "");
        const code = await sock.requestPairingCode(formattedNumber);
        pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
        connectionStatus = "awaiting-pairing";
        broadcast("pairing-code", { code: pairingCode });
        console.log("Pairing code:", pairingCode);
      } catch (err) {
        console.error("Pairing code error:", err.message);
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
        console.log("New QR code generated");
      } catch (err) {
        console.error("QR generation error:", err);
      }
    }

    if (connection === "close") {
      isConnected = false;
      currentQR = null;
      pairingCode = null;
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (statusCode === DisconnectReason.loggedOut) {
        connectionStatus = "logged-out";
        broadcast("status", { status: "logged-out", message: "Bot was logged out. Delete auth folder and restart." });
        if (fs.existsSync(AUTH_FOLDER)) {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        }
      } else {
        connectionStatus = "reconnecting";
        broadcast("status", { status: "reconnecting", message: "Reconnecting..." });
        if (shouldReconnect) {
          setTimeout(() => startConnection(), 5000);
        }
      }
    } else if (connection === "open") {
      isConnected = true;
      currentQR = null;
      pairingCode = null;
      connectionStatus = "connected";
      const user = sock.user;
      broadcast("connected", {
        status: "connected",
        number: user?.id?.split(":")[0] || "",
        name: user?.name || "Bot",
        message: "Bot is now connected and running!",
      });
      console.log("Bot connected:", user?.id);
    } else if (connection === "connecting") {
      connectionStatus = "connecting";
      broadcast("status", { status: "connecting", message: "Connecting..." });
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      console.log("Message from:", msg.key.remoteJid);
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

app.get("/api/qr", (req, res) => {
  res.json({
    qr: currentQR,
    status: connectionStatus,
    connected: isConnected,
  });
});

app.post("/api/connect/qr", async (req, res) => {
  if (isConnected) {
    return res.json({ success: false, message: "Bot is already connected." });
  }
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      try { await sock.logout(); } catch (e) {}
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
      try { await sock.logout(); } catch (e) {}
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
    if (sock) {
      await sock.logout();
      sock = null;
    }
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    }
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

  const sendCurrentState = async () => {
    if (isConnected) {
      const user = sock?.user;
      res.write(
        `event: connected\ndata: ${JSON.stringify({
          status: "connected",
          number: user?.id?.split(":")[0] || "",
          name: user?.name || "Bot",
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
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((c) => c !== res);
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Cybermd session server running on port ${PORT}`);
  startConnection();
});

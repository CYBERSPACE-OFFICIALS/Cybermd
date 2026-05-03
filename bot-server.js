'use strict';
const express = require('express');
const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const PORT = process.env.PORT || 3000;
const logger = pino({ level: 'silent' });

let pairingCode   = null;
let isConnected   = false;
let connectedNum  = '';
let sseClients    = [];
let sock          = null;
let reconnTimer   = null;
let inPairingMode = false;

// ── helpers ───────────────────────────────────────────────────────────────────

function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients = sseClients.filter(c => !c.destroyed);
    sseClients.forEach(c => { try { c.write(msg); } catch (_) {} });
}

function wipeAuth() {
    try { if (fs.existsSync(AUTH_FOLDER)) fs.rmSync(AUTH_FOLDER, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}

function closeSocket() {
    if (sock) {
        try { sock.ev.removeAllListeners(); } catch (_) {}
        try { sock.end(); } catch (_) {}
        sock = null;
    }
}

// ── core connection ───────────────────────────────────────────────────────────

async function startConnection(usePairing = false, phoneNumber = '') {
    if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
    closeSocket();

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
        browser: Browsers.ubuntu('Edge'),
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true,
    });

    // ── request pairing code ──
    if (usePairing && phoneNumber && !state.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                pairingCode = code;
                console.log('[CYBERMD] Pairing code:', code);
                broadcast('pairing-code', { code });
            } catch (err) {
                console.error('[CYBERMD] Code error:', err.message);
                broadcast('error', { message: 'Could not get pairing code: ' + err.message });
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            isConnected   = true;
            inPairingMode = false;
            pairingCode   = null;
            const num = sock.user?.id?.split(':')[0] || sock.user?.id || '';
            connectedNum = num;
            console.log('[CYBERMD] Connected:', num);
            broadcast('connected', { number: num, name: sock.user?.name || 'Bot' });

        } else if (connection === 'close') {
            isConnected = false;
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

            if (code === DisconnectReason.loggedOut) {
                wipeAuth();
                broadcast('status', { status: 'logged-out', message: 'Logged out. Reconnect to pair again.' });
            } else if (!inPairingMode) {
                // auto-reconnect only when NOT in the middle of pairing
                broadcast('status', { status: 'reconnecting', message: 'Reconnecting...' });
                reconnTimer = setTimeout(() => startConnection(), 5000);
            }
        }
    });
}

// ── SSE endpoint  (used by session.html as GET /events) ──────────────────────

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // push current state right away so late-joiners get it
    if (isConnected) {
        res.write(`event: connected\ndata: ${JSON.stringify({ number: connectedNum })}\n\n`);
    } else if (pairingCode) {
        res.write(`event: pairing-code\ndata: ${JSON.stringify({ code: pairingCode })}\n\n`);
    }

    sseClients.push(res);

    const hb = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (_) { clearInterval(hb); }
    }, 20000);

    req.on('close', () => {
        clearInterval(hb);
        sseClients = sseClients.filter(c => c !== res);
    });
});

// ── REST endpoints ────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
    res.json({ connected: isConnected, number: connectedNum });
});

app.post('/api/connect/pair', async (req, res) => {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ success: false, message: 'Phone number required' });

    const cleaned = String(phoneNumber).replace(/\D/g, '');
    if (cleaned.length < 7 || cleaned.length > 15)
        return res.status(400).json({ success: false, message: 'Invalid phone number' });

    // reset state & wipe old session so registered = false
    pairingCode   = null;
    isConnected   = false;
    connectedNum  = '';
    inPairingMode = true;
    wipeAuth();

    res.json({ success: true });

    try {
        await startConnection(true, cleaned);
    } catch (err) {
        broadcast('error', { message: err.message });
        inPairingMode = false;
    }
});

app.post('/api/disconnect', async (_req, res) => {
    inPairingMode = false;
    if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
    closeSocket();
    wipeAuth();
    isConnected  = false;
    pairingCode  = null;
    connectedNum = '';
    broadcast('status', { status: 'disconnected', message: 'Disconnected.' });
    res.json({ success: true });
});

// ── HTML routes ───────────────────────────────────────────────────────────────

app.get('/session', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'session.html')));
app.get('*',        (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── boot ─────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
    console.log(`\n╔═══════════════════════════════════╗`);
    console.log(`║      CYBERMD SESSION SERVER       ║`);
    console.log(`║  Port: ${String(PORT).padEnd(27)}║`);
    console.log(`╚═══════════════════════════════════╝\n`);
    // start idle connection on boot (auto-reconnects if creds exist)
    try { await startConnection(); } catch (_) {}
});

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
const PAIRING_DIR = path.join(__dirname, 'nexstore', 'pairing');
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

// After pairing succeeds, copy session to nexstore/pairing/{jid}/ and start pair.js
async function handOffToPairJs(jid) {
    try {
        const destFolder = path.join(PAIRING_DIR, jid);
        fs.mkdirSync(destFolder, { recursive: true });

        // Copy session files so pair.js can pick them up
        if (fs.existsSync(AUTH_FOLDER)) {
            const files = fs.readdirSync(AUTH_FOLDER);
            for (const f of files) {
                const src = path.join(AUTH_FOLDER, f);
                const dest = path.join(destFolder, f);
                if (fs.lstatSync(src).isFile()) {
                    fs.copyFileSync(src, dest);
                }
            }
        }

        console.log('[CYBERMD] Session copied to', destFolder);

        // Close the pairing socket — pair.js will open its own
        closeSocket();

        // Load pair.js and start the bot with case.js command handlers
        const startpairing = require('./pair');
        await startpairing(jid);
        console.log('[CYBERMD] Bot started with case.js for', jid);

    } catch (err) {
        console.error('[CYBERMD] Hand-off error:', err.message);
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

            // Build the JID that pair.js expects: number@s.whatsapp.net
            const rawId = sock.user?.id || '';
            const num   = rawId.replace(/:.+@/, '@').replace('@s.whatsapp.net', '');
            const jid   = num + '@s.whatsapp.net';
            connectedNum = num;

            console.log('[CYBERMD] Connected:', num);
            broadcast('connected', { number: num, name: sock.user?.name || 'Bot' });

            // Hand off to pair.js so case.js command handlers are active
            // Small delay to let creds finish saving
            setTimeout(() => handOffToPairJs(jid), 2000);

        } else if (connection === 'close') {
            isConnected = false;
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

            if (code === DisconnectReason.loggedOut) {
                wipeAuth();
                broadcast('status', { status: 'logged-out', message: 'Logged out. Reconnect to pair again.' });
            } else if (!inPairingMode) {
                broadcast('status', { status: 'reconnecting', message: 'Reconnecting...' });
                reconnTimer = setTimeout(() => startConnection(), 5000);
            }
        }
    });
}

// ── SSE endpoint ──────────────────────────────────────────────────────────────

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Send current state immediately to late-joiners
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

    // On startup, if sessions already exist in nexstore/pairing/, resume them
    if (fs.existsSync(PAIRING_DIR)) {
        const existing = fs.readdirSync(PAIRING_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.endsWith('@s.whatsapp.net'))
            .map(d => d.name);

        if (existing.length > 0) {
            console.log(`[CYBERMD] Resuming ${existing.length} existing session(s)...`);
            const startpairing = require('./pair');
            for (const jid of existing) {
                try {
                    await startpairing(jid);
                    console.log('[CYBERMD] Resumed:', jid);
                } catch (e) {
                    console.error('[CYBERMD] Resume error for', jid, e.message);
                }
            }
        } else {
            // No existing sessions — start idle connection for auto-reconnect
            try { await startConnection(); } catch (_) {}
        }
    } else {
        try { await startConnection(); } catch (_) {}
    }
});

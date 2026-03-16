// web.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Starts the web admin dashboard.
 * @param {Set} userIDs - Set of Telegram user IDs (for stats)
 * @param {Array} pairedSessions - Array of WhatsApp JIDs from pairing folder
 */
module.exports = (userIDs, pairedSessions) => {
  const app = express();
  const PORT = process.env.WEB_PORT || 3000;

  // Admin credentials – change if desired
  const ADMIN_USERNAME = 'kboy';
  const ADMIN_PASSWORD = 'kboy2010';

  // Session middleware – use a strong secret
  app.use(session({
    secret: 'f8a7d9f1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5g6h7i8j9k0',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // set to true if using HTTPS
  }));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ----- Helper functions to get server stats -----
  const getUptime = () => {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  };

  const getMemoryUsage = () => {
    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    const total = os.totalmem() / 1024 / 1024 / 1024;
    const free = os.freemem() / 1024 / 1024 / 1024;
    return {
      used: used.toFixed(2) + ' MB',
      total: total.toFixed(2) + ' GB',
      free: free.toFixed(2) + ' GB'
    };
  };

  const getConnectedUsers = () => ({
    telegram: userIDs ? userIDs.size : 0,
    whatsapp: pairedSessions ? pairedSessions.length : 0
  });

  // ----- Routes -----
  // Serve the main HTML page
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Health check endpoint for Render (required for free tier)
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Login endpoint
  app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      req.session.isAdmin = true;
      req.session.username = username;
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  });

  // Logout endpoint
  app.post('/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
  });

  // Check login status
  app.get('/admin/status', (req, res) => {
    res.json({ loggedIn: !!req.session.isAdmin, username: req.session.username });
  });

  // Get server stats (protected)
  app.get('/admin/stats', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: 'Unauthorized' });
    res.json({
      uptime: getUptime(),
      memory: getMemoryUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      users: getConnectedUsers()
    });
  });

  // Start the server
  app.listen(PORT, () => {
    console.log(`🌐 Web admin dashboard running at http://localhost:${PORT}`);
  });

  return app;
};
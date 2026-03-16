const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '../database/antideleteMessages.json');
const ANTI_SETTINGS_FILE = path.join(__dirname, '../database/antidelete.json');

// Load the store (object)
function loadStore() {
    if (!fs.existsSync(STORE_FILE)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

// Save the store
function saveStore(store) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

// Store a message by its ID (overwrites if already exists)
function storeMessage(id, data) {
    const store = loadStore();
    store[id] = data;
    saveStore(store);
    console.log(`💾 data.js saved message: ${id}`); // DEBUG LOG (optional)
}

// Load a message by ID
function loadMessage(id) {
    const store = loadStore();
    return store[id] || null;
}

// Get all stored IDs (optional)
function getStoredIds() {
    const store = loadStore();
    return Object.keys(store);
}

// ===== Anti‑delete settings functions =====
// Get anti‑delete setting for a type ('gc' or 'dm')
function getAnti(type) {
    try {
        if (!fs.existsSync(ANTI_SETTINGS_FILE)) {
            return false;
        }
        const data = JSON.parse(fs.readFileSync(ANTI_SETTINGS_FILE, 'utf8'));
        return data[type] || false;
    } catch {
        return false;
    }
}

// Set anti‑delete setting for a type
function setAnti(type, value) {
    try {
        let data = {};
        if (fs.existsSync(ANTI_SETTINGS_FILE)) {
            data = JSON.parse(fs.readFileSync(ANTI_SETTINGS_FILE, 'utf8'));
        }
        data[type] = value;
        fs.writeFileSync(ANTI_SETTINGS_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch {
        return false;
    }
}

module.exports = { 
    storeMessage, 
    loadMessage, 
    getStoredIds,
    getAnti,
    setAnti
};
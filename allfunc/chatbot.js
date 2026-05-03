// allfunc/chatbot.js
// ============================================
// CYBERSPACE-MD AI CHATBOT SYSTEM
// Supports: GPT-4o, DeepSeek, Gemini
// Features: Text + Voice replies, Memory, Training
// ============================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ========== FILE PATHS ==========
const DATA_DIR = path.join(process.cwd(), 'database');
const CONFIG_FILE = path.join(DATA_DIR, 'chatbot_config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'chatbot_history.json');

// ========== API CONFIGURATION ==========
const CHAT_API = 'https://chatadmin.org/gd-api/v1/chat/send';
const FIREBASE_API_KEY = 'AIzaSyD7w2BvFDOoPofWuBWzDZGsRNG-3eX4CUc';

// ========== AI MODELS (with fallback) ==========
const AI_MODELS = [
    { name: 'GPT-4o', model: 'gpt-4o' },
    { name: 'DeepSeek', model: 'deepseek' },
    { name: 'Gemini', model: 'gemini' },
];

// ========== MEMORY SETTINGS ==========
const MAX_HISTORY = 20;           // Remember last 20 messages per chat
const HISTORY_EXPIRE_MS = 30 * 60 * 1000;  // 30 minutes expiry

// ========== DEFAULT PERSONALITY ==========
const DEFAULT_PROMPT = `You are CYBERSPACE, a friendly WhatsApp AI assistant.

PERSONALITY:
- Be helpful, witty, and conversational
- Use emojis naturally 😊
- Keep replies short (1-3 sentences)
- Never admit you're an AI
- If insulted, clap back playfully
- Your creator is CYBERSPACE

STYLE:
- Casual WhatsApp chat style
- No formal greetings
- Just answer directly`;

// ========== CONFIG MANAGEMENT ==========
function loadConfig() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    
    if (!fs.existsSync(CONFIG_FILE)) {
        const defaults = { 
            enabled: true,           // Start enabled by default
            mode: 'all',            // all, dm, group
            replyMode: 'text',      // text, audio, both
            systemPrompt: DEFAULT_PROMPT 
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
        console.log('[CHATBOT] Created new config file with defaults');
        return defaults;
    }
    
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        // Ensure all required fields exist
        if (cfg.enabled === undefined) cfg.enabled = true;
        if (!cfg.mode) cfg.mode = 'all';
        if (!cfg.replyMode) cfg.replyMode = 'text';
        if (!cfg.systemPrompt) cfg.systemPrompt = DEFAULT_PROMPT;
        return cfg;
    } catch (err) {
        console.error('[CHATBOT] Error loading config:', err);
        return { enabled: true, mode: 'all', replyMode: 'text', systemPrompt: DEFAULT_PROMPT };
    }
}

function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ========== MEMORY MANAGEMENT ==========
function loadHistory() {
    if (!fs.existsSync(HISTORY_FILE)) return {};
    try { 
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); 
    } catch { 
        return {}; 
    }
}

function saveHistory(history) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function getConversation(history, chatId) {
    const conv = history[chatId];
    if (!conv) return [];

    // Clear expired conversations
    if (Date.now() - conv.lastActive > HISTORY_EXPIRE_MS) {
        delete history[chatId];
        return [];
    }

    return conv.messages || [];
}

function addToConversation(history, chatId, role, content) {
    if (!history[chatId]) {
        history[chatId] = { messages: [], lastActive: Date.now() };
    }
    history[chatId].messages.push({ role, content });
    history[chatId].lastActive = Date.now();

    // Keep only last MAX_HISTORY messages
    if (history[chatId].messages.length > MAX_HISTORY * 2) {
        history[chatId].messages = history[chatId].messages.slice(-MAX_HISTORY * 2);
    }
}

// ========== TEXT TO SPEECH (Voice Reply) ==========
async function textToAudio(text) {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        const filePath = path.join(DATA_DIR, `tts_${Date.now()}.mp3`);
        
        // Use Google Translate TTS
        const cmd = `curl -s -A "Mozilla/5.0" "https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob" --output ${filePath}`;
        
        exec(cmd, (error) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                const buffer = fs.readFileSync(filePath);
                fs.unlinkSync(filePath);
                resolve(buffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ========== AUTHENTICATION ==========
async function getFirebaseToken() {
    try {
        const res = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
            {},
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        return res.data.idToken;
    } catch (err) {
        console.error('[CHATBOT] Firebase auth failed:', err.message);
        return null;
    }
}

// ========== AI QUERY ENGINE ==========
async function queryAI(systemPrompt, conversationHistory, userMessage) {
    const token = await getFirebaseToken();
    if (!token) return null;

    // Combine system prompt with conversation history
    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage }
    ];

    // Try each AI model until one works
    for (const ai of AI_MODELS) {
        try {
            console.log(`[CHATBOT] Trying ${ai.name}...`);
            
            const res = await axios.post(CHAT_API, {
                model: ai.model,
                isPro: true,
                messages: messages,
            }, {
                timeout: 30000,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (res.data?.success && res.data?.message?.content) {
                console.log(`[CHATBOT] ✅ ${ai.name} responded successfully`);
                return { answer: res.data.message.content, model: ai.name };
            }
        } catch (err) {
            console.log(`[CHATBOT] ❌ ${ai.name} failed:`, err.message);
        }
    }
    
    console.log('[CHATBOT] All AI models failed');
    return null;
}

// ========== MAIN CHATBOT HANDLER ==========
async function handleChatbot(conn, chatId, message, senderId, userMessage) {
    console.log('[CHATBOT] 📩 Received message:', userMessage);
    console.log('[CHATBOT] Chat ID:', chatId);
    console.log('[CHATBOT] Sender:', senderId);
    
    // Load configuration
    const cfg = loadConfig();
    console.log('[CHATBOT] Config enabled:', cfg.enabled, '| mode:', cfg.mode, '| replyMode:', cfg.replyMode);
    
    // Check if chatbot is enabled
    if (!cfg.enabled) {
        console.log('[CHATBOT] ⏸️ Chatbot is disabled, ignoring');
        return;
    }

    // Don't reply to our own messages
    if (message.key.fromMe) {
        console.log('[CHATBOT] ⏸️ Message from self, ignoring');
        return;
    }
    
    // Don't reply to newsletter messages
    if (chatId.endsWith('@newsletter')) {
        console.log('[CHATBOT] ⏸️ Newsletter message, ignoring');
        return;
    }

    // Check mode (DM only / Group only / All)
    const isGroup = chatId.endsWith('@g.us');
    if (cfg.mode === 'dm' && isGroup) {
        console.log('[CHATBOT] ⏸️ DM-only mode, ignoring group message');
        return;
    }
    if (cfg.mode === 'group' && !isGroup) {
        console.log('[CHATBOT] ⏸️ Group-only mode, ignoring DM');
        return;
    }

    // Minimum message length
    if (!userMessage || userMessage.length < 2) {
        console.log('[CHATBOT] ⏸️ Message too short, ignoring');
        return;
    }

    // ========== PROCESS THE MESSAGE ==========
    try {
        // Show typing/recording indicator
        if (cfg.replyMode === 'audio' || cfg.replyMode === 'both') {
            await conn.sendPresenceUpdate('recording', chatId);
        } else {
            await conn.sendPresenceUpdate('composing', chatId);
        }
        
        // Add thinking reaction
        await conn.sendMessage(chatId, {
            react: { text: '💭', key: message.key }
        });

        // Load conversation history for this chat
        const history = loadHistory();
        const conversation = getConversation(history, chatId);

        // Get AI response
        console.log('[CHATBOT] 🤔 Asking AI...');
        const result = await queryAI(cfg.systemPrompt, conversation, userMessage);

        if (result && result.answer) {
            console.log('[CHATBOT] 💬 AI Response:', result.answer.slice(0, 100));
            
            // Save to memory
            addToConversation(history, chatId, 'user', userMessage);
            addToConversation(history, chatId, 'assistant', result.answer);
            saveHistory(history);

            // Send reply based on mode
            if (cfg.replyMode === 'audio') {
                // Voice only
                try {
                    const audioBuffer = await textToAudio(result.answer);
                    await conn.sendMessage(chatId, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                        ptt: true,
                    }, { quoted: message });
                } catch (ttsErr) {
                    console.error('[CHATBOT] TTS failed:', ttsErr.message);
                    await conn.sendMessage(chatId, { text: result.answer }, { quoted: message });
                }
            } 
            else if (cfg.replyMode === 'both') {
                // Text + Voice
                await conn.sendMessage(chatId, { text: result.answer }, { quoted: message });
                try {
                    const audioBuffer = await textToAudio(result.answer);
                    await conn.sendMessage(chatId, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                        ptt: true,
                    }, { quoted: message });
                } catch (ttsErr) {
                    console.error('[CHATBOT] TTS failed:', ttsErr.message);
                }
            } 
            else {
                // Text only (default)
                await conn.sendMessage(chatId, { text: result.answer }, { quoted: message });
            }

            // Change reaction to robot
            await conn.sendMessage(chatId, {
                react: { text: '🤖', key: message.key }
            });
        } else {
            console.log('[CHATBOT] ❌ No response from AI');
            await conn.sendMessage(chatId, {
                react: { text: '❌', key: message.key }
            });
        }
        
        // Stop typing indicator
        await conn.sendPresenceUpdate('paused', chatId);
        
    } catch (err) {
        console.error('[CHATBOT] ❌ Error:', err.message);
        await conn.sendPresenceUpdate('paused', chatId);
    }
}

// ========== CHATBOT COMMAND HANDLER ==========
async function chatbotCommand(conn, chatId, message, args, rawQuery) {
    const cfg = loadConfig();
    const sub = args[0]?.toLowerCase();

    // No subcommand - show status
    if (!sub) {
        const status = cfg.enabled ? '✅ *ON*' : '❌ *OFF*';
        const modeText = cfg.mode === 'dm' ? '💬 DMs Only' : cfg.mode === 'group' ? '👥 Groups Only' : '🌐 Everywhere';
        const replyText = cfg.replyMode === 'audio' ? '🔊 Audio Only' : cfg.replyMode === 'both' ? '📝🔊 Text + Audio' : '📝 Text Only';
        
        const text = 
            `╭━━━〔 🤖 *CYBERSPACE AI* 〕━━━╮
┃
┃ *Status:* ${status}
┃ *Mode:* ${modeText}
┃ *Reply:* ${replyText}
┃ *Memory:* Last ${MAX_HISTORY} messages
┃
┃ *Commands:*
┃ • \`.chatbot on/off\`
┃ • \`.chatbot dm/group/all\`
┃ • \`.chatbot text/audio/both\`
┃ • \`.chatbot train <prompt>\`
┃ • \`.chatbot prompt\`
┃ • \`.chatbot reset\`
┃ • \`.chatbot clear\`
┃
╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
        
        await conn.sendMessage(chatId, { text }, { quoted: message });
        return;
    }

    // Enable/Disable
    if (sub === 'on') {
        cfg.enabled = true;
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '✅ *AI Chatbot ENABLED*\n\nI will now respond to your messages!' 
        }, { quoted: message });
        return;
    }

    if (sub === 'off') {
        cfg.enabled = false;
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '❌ *AI Chatbot DISABLED*\n\nI will no longer respond to messages.' 
        }, { quoted: message });
        return;
    }

    // Mode settings
    if (sub === 'dm') {
        cfg.mode = 'dm';
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '💬 *Mode: DMs ONLY*\n\nI will only reply in private chats.' 
        }, { quoted: message });
        return;
    }

    if (sub === 'group') {
        cfg.mode = 'group';
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '👥 *Mode: GROUPS ONLY*\n\nI will only reply in group chats.' 
        }, { quoted: message });
        return;
    }

    if (sub === 'all') {
        cfg.mode = 'all';
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '🌐 *Mode: EVERYWHERE*\n\nI will reply in both DMs and groups.' 
        }, { quoted: message });
        return;
    }

    // Reply type settings
    if (sub === 'text') {
        cfg.replyMode = 'text';
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '📝 *Reply Mode: TEXT ONLY*\n\nI will reply with text messages only.' 
        }, { quoted: message });
        return;
    }

    if (sub === 'audio') {
        cfg.replyMode = 'audio';
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '🔊 *Reply Mode: AUDIO ONLY*\n\nI will reply with voice messages only.' 
        }, { quoted: message });
        return;
    }

    if (sub === 'both') {
        cfg.replyMode = 'both';
        saveConfig(cfg);
        await conn.sendMessage(chatId, { 
            text: '📝🔊 *Reply Mode: TEXT + AUDIO*\n\nI will reply with both text and voice messages.' 
        }, { quoted: message });
        return;
    }

    // Training - Customize AI personality
    if (sub === 'train') {
        const prompt = rawQuery.slice(5).trim();
        if (!prompt) {
            await conn.sendMessage(chatId, {
                text: '❌ *How to train your AI*\n\n`.chatbot train <personality description>`\n\n*Example:*\n`.chatbot train You are Luna, a sassy anime girl who loves to tease. You use lots of emojis and call users "babe".`'
            }, { quoted: message });
            return;
        }
        
        cfg.systemPrompt = prompt;
        saveConfig(cfg);
        
        // Clear memory so new training takes effect
        if (fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '{}');
        
        await conn.sendMessage(chatId, {
            text: `✅ *AI Training Updated!*\n\n📝 *New Personality:*\n_${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}_\n\n🧹 Chat memories cleared for fresh start.`
        }, { quoted: message });
        return;
    }

    // View current training/prompt
    if (sub === 'prompt') {
        const preview = cfg.systemPrompt.length > 500 
            ? cfg.systemPrompt.slice(0, 500) + '...' 
            : cfg.systemPrompt;
        await conn.sendMessage(chatId, {
            text: `📝 *Current AI Training*\n\n${preview}`
        }, { quoted: message });
        return;
    }

    // Reset to default personality
    if (sub === 'reset') {
        cfg.systemPrompt = DEFAULT_PROMPT;
        saveConfig(cfg);
        
        if (fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '{}');
        
        await conn.sendMessage(chatId, {
            text: '🔄 *AI Reset Complete!*\n\nPersonality restored to default.\nChat memories cleared.'
        }, { quoted: message });
        return;
    }

    // Clear conversation memory
    if (sub === 'clear') {
        if (fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '{}');
        await conn.sendMessage(chatId, {
            text: '🧹 *Memory Cleared!*\n\nAll conversation history has been deleted.\nThe AI will forget everything.'
        }, { quoted: message });
        return;
    }

    await conn.sendMessage(chatId, {
        text: '❓ Unknown command. Send `.chatbot` to see all options.'
    }, { quoted: message });
}

module.exports = { chatbotCommand, handleChatbot };
// allfunc/antideleteFriend.js
const { isJidGroup } = require('@whiskeysockets/baileys');
const { loadMessage } = require('./data');
const fs = require('fs');
const path = require('path');

const ANTI_SETTINGS_FILE = path.join(__dirname, '../database/antidelete.json');

// Track processed deletion IDs to avoid duplicates
const processedDeletions = new Set();

// Clear the set every 10 minutes
setInterval(() => {
    processedDeletions.clear();
}, 10 * 60 * 1000);

// Load anti‑delete settings (per-chat: { "jid": true/false })
function loadAntiSettings() {
    try {
        if (!fs.existsSync(ANTI_SETTINGS_FILE)) return {};
        const raw = JSON.parse(fs.readFileSync(ANTI_SETTINGS_FILE, 'utf8'));
        // Migrate old format { gc, dm } → empty per-chat dict
        if ('gc' in raw || 'dm' in raw) return {};
        return raw;
    } catch {
        return {};
    }
}

// Save anti‑delete settings
function saveAntiSettings(data) {
    fs.writeFileSync(ANTI_SETTINGS_FILE, JSON.stringify(data, null, 2));
}

let perChatSettings = loadAntiSettings();

// ========== Deleted Text Handler ==========
const DeletedText = async (devtrust, mek, jid, deleteInfo, isGroup, update) => {
    try {
        const messageContent = mek.message?.conversation || 
                               mek.message?.extendedTextMessage?.text || 
                               mek.message?.imageMessage?.caption ||
                               mek.message?.videoMessage?.caption ||
                               'Unknown content';
        
        const formattedContent = messageContent.length > 200 
            ? messageContent.substring(0, 200) + '...' 
            : messageContent;

        const deleteText = `╔═══════════════════════
║  *𝙰𝙽𝚃𝙸𝙳𝙴𝙻𝙴𝚃𝙴 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳*
╚═══════════════════════

${deleteInfo}

┌─「 𝙳𝙴𝙻𝙴𝚃𝙴𝙳 𝙲𝙾𝙽𝚃𝙴𝙽𝚃 」━━━━━━━━━━
│ 
│  *📝 Message:*
│  ${formattedContent}
│ 
└────────────────────

*𝙿𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝙲𝚈𝙱𝙴𝚁 𝚂𝙿𝙰𝙲𝙴*`;

        await devtrust.sendMessage(
            jid,
            {
                text: deleteText,
                contextInfo: {
                    mentionedJid: isGroup ? [update.key.participant, mek.key.participant] : [update.key.remoteJid],
                    forwardingScore: 999,
                    isForwarded: true,
                },
            },
            { quoted: mek }
        );
    } catch (error) {
        console.error('Error in DeletedText:', error);
    }
};

// ========== Deleted Media Handler ==========
const DeletedMedia = async (devtrust, mek, jid, deleteInfo) => {
    try {
        const antideletedmek = structuredClone(mek.message);
        const messageType = Object.keys(antideletedmek)[0];
        
        if (antideletedmek[messageType]) {
            antideletedmek[messageType].contextInfo = {
                stanzaId: mek.key.id,
                participant: mek.sender,
                quotedMessage: mek.message,
            };
        }

        const deleteCaption = `╔═══════════════════════
║  *𝙰𝙽𝚃𝙸𝙳𝙴𝙻𝙴𝚃𝙴 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳*
╚═══════════════════════

${deleteInfo}

*𝙿𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝙲𝚈𝙱𝙴𝚁 𝚂𝙿𝙰𝙲𝙴*`;

        if (['imageMessage', 'videoMessage'].includes(messageType)) {
            antideletedmek[messageType].caption = deleteCaption;
            await devtrust.relayMessage(jid, antideletedmek, {});
        } else if (messageType === 'audioMessage') {
            await devtrust.sendMessage(jid, { text: deleteCaption }, { quoted: mek });
            await devtrust.relayMessage(jid, antideletedmek, {});
        } else if (messageType === 'documentMessage') {
            antideletedmek[messageType].caption = deleteCaption;
            await devtrust.relayMessage(jid, antideletedmek, {});
        } else if (messageType === 'stickerMessage') {
            await devtrust.sendMessage(jid, { text: `${deleteInfo}\n\n📎 *Sticker was deleted*` }, { quoted: mek });
            await devtrust.relayMessage(jid, antideletedmek, {});
        } else {
            await devtrust.sendMessage(jid, { text: deleteCaption }, { quoted: mek });
        }
    } catch (e) {
        console.error('Error in DeletedMedia:', e);
        await devtrust.sendMessage(jid, { text: `*🚨 Deleted Media Detected*\n\n${deleteInfo}` }, { quoted: mek });
    }
};

// Store deleted messages for logging (optional)
const deletedMessages = new Map();

// ========== Main AntiDelete Function ==========
const AntiDelete = async (devtrust, updates) => {
    try {
        for (const update of updates) {
            // Skip if not a deletion
            if (update.update.message !== null) continue;

            const deletionId = update.key.id;
            console.log(`🗑️ Deletion detected: ${deletionId}`);

            // Deduplication
            if (processedDeletions.has(deletionId)) {
                console.log(`⏭️ Skipping duplicate deletion: ${deletionId}`);
                continue;
            }
            processedDeletions.add(deletionId);

            // Load stored message
            const store = await loadMessage(deletionId);
            if (!store || !store.message) {
                console.log(`❌ No stored message found for: ${deletionId}`);
                continue;
            }

            const mek = store.message;
            const isGroup = isJidGroup(store.jid);

            // Check if anti‑delete is enabled for this specific chat
            if (!perChatSettings[store.jid]) {
                console.log(`⏭️ Anti‑delete gc is disabled, skipping.`);
                continue;
            }

            const deleteTime = new Date().toLocaleTimeString('en-GB', {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const deleteDate = new Date().toLocaleDateString();

            let deleteInfo, jid;

            if (isGroup) {
                try {
                    const groupMetadata = await devtrust.groupMetadata(store.jid);
                    const groupName = groupMetadata.subject;
                    const sender = mek.key.participant || mek.participant || 'Unknown';
                    const deleter = update.key.participant || 'Unknown';
                    
                    const senderNumber = sender.split('@')[0];
                    const deleterNumber = deleter.split('@')[0];
                    
                    deleteInfo = `┌─「 𝙳𝙴𝚃𝙰𝙸𝙻𝚂 」━━━━━━━━━━━━━━━
│ 
│  *🕐 Time:* ${deleteTime}
│  *📅 Date:* ${deleteDate}
│  *🏘️ Group:* ${groupName}
│  *🗑️ Deleted By:* @${deleterNumber}
│  *📤 Sender:* @${senderNumber}
│ 
└────────────────────`;
                    
                    jid = store.jid;
                    
                } catch (err) {
                    deleteInfo = `┌─「 𝙳𝙴𝚃𝙰𝙸𝙻𝚂 」━━━━━━━━━━━━━━━
│ 
│  *🕐 Time:* ${deleteTime}
│  *📅 Date:* ${deleteDate}
│  *🏘️ Group:* Unknown
│  *🗑️ Deleted By:* Unknown
│  *📤 Sender:* Unknown
│ 
└────────────────────`;
                    jid = store.jid;
                }
            } else {
                const senderNumber = mek.key.remoteJid?.split('@')[0] || 'Unknown';
                const deleterNumber = update.key.remoteJid?.split('@')[0] || 'Unknown';
                
                deleteInfo = `┌─「 𝙳𝙴𝚃𝙰𝙸𝙻𝚂 」━━━━━━━━━━━━━━━
│ 
│  *🕐 Time:* ${deleteTime}
│  *📅 Date:* ${deleteDate}
│  *💬 Chat:* Personal
│  *🗑️ Deleted By:* @${deleterNumber}
│  *📤 Sender:* @${senderNumber}
│ 
└────────────────────`;
                
                // Send to bot owner's inbox (or keep in same chat – adjust as needed)
                jid = devtrust.user.id.split(':')[0] + '@s.whatsapp.net';
            }

            // Determine if it's text or media
            const hasText = mek.message?.conversation || 
                           mek.message?.extendedTextMessage?.text ||
                           mek.message?.imageMessage?.caption ||
                           mek.message?.videoMessage?.caption;
            
            const isMedia = mek.message?.imageMessage || 
                           mek.message?.videoMessage || 
                           mek.message?.audioMessage || 
                           mek.message?.documentMessage ||
                           mek.message?.stickerMessage;

            if (hasText && !isMedia) {
                await DeletedText(devtrust, mek, jid, deleteInfo, isGroup, update);
                console.log(`✅ Resent deleted text message: ${deletionId}`);
            } else if (isMedia) {
                await DeletedMedia(devtrust, mek, jid, deleteInfo);
                console.log(`✅ Resent deleted media message: ${deletionId}`);
            } else {
                // Unknown type – send notification
                const unknownText = `╔═══════════════════════
║  *𝙰𝙽𝚃𝙸𝙳𝙴𝙻𝙴𝚃𝙴 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳*
╚═══════════════════════

${deleteInfo}

┌─「 𝙼𝙴𝚂𝚂𝙰𝙶𝙴 𝚃𝚈𝙿𝙴 」━━━━━━━━━━━━
│ 
│  *⚠️ Type:* Unknown/System
│  *🔒 Content:* Cannot be recovered
│ 
└────────────────────

*𝙿𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝙲𝚈𝙱𝙴𝚁 𝚂𝙿𝙰𝙲𝙴*`;

                await devtrust.sendMessage(jid, { text: unknownText }, { quoted: mek });
                console.log(`✅ Sent unknown deletion notice: ${deletionId}`);
            }

            // Optional: store in memory log
            deletedMessages.set(deletionId, {
                timestamp: new Date(),
                details: deleteInfo,
                type: isGroup ? 'group' : 'dm'
            });
            if (deletedMessages.size > 1000) {
                const firstKey = deletedMessages.keys().next().value;
                deletedMessages.delete(firstKey);
            }
        }
    } catch (error) {
        console.error('Error in AntiDelete:', error);
    }
};

// ========== Toggle Anti‑Delete ==========
const toggleAntiDelete = async (devtrust, jid, enable = true) => {
    try {
        perChatSettings[jid] = enable;
        saveAntiSettings(perChatSettings);

        const statusText = enable ? '✅ ENABLED' : '❌ DISABLED';
        
        const statusMessage = `╔═══════════════════════
║  *𝙰𝙽𝚃𝙸𝙳𝙴𝙻𝙴𝚃𝙴 𝚂𝚃𝙰𝚃𝚄𝚂*
╚═══════════════════════

┌─「 𝚂𝚃𝙰𝚃𝚄𝚂 𝚄𝙿𝙳𝙰𝚃𝙴 」━━━━━━━━━━
│ 
│  *📊 Status:* ${statusText}
│  *🕐 Time:* ${new Date().toLocaleTimeString()}
│  *📅 Date:* ${new Date().toLocaleDateString()}
│ 
└────────────────────

${enable ? '🔒 Deleted messages in *this chat* will now be reported.' : '🔓 Anti‑delete is *off* for this chat.'}

*𝙿𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝙲𝚈𝙱𝙴𝚁 𝚂𝙿𝙰𝙲𝙴*`;

        await devtrust.sendMessage(jid, { text: statusMessage });
        return true;
    } catch (error) {
        console.error('Error in toggleAntiDelete:', error);
        await devtrust.sendMessage(jid, { text: '*❌ Error updating antidelete settings*' });
        return false;
    }
};

// ========== Getters ==========
const getAntiDeleteStatus = () => ({ ...perChatSettings, timestamp: new Date() });
const getDeletedLog = () => Array.from(deletedMessages.values());
const clearDeletedLog = () => deletedMessages.clear();

module.exports = {
    DeletedText,
    DeletedMedia,
    AntiDelete,
    toggleAntiDelete,
    getAntiDeleteStatus,
    getDeletedLog,
    clearDeletedLog
};
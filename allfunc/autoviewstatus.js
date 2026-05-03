const fs = require('fs');
const path = require('path');

// Path to store auto status configuration
const configPath = path.join(__dirname, '../data/autoStatus.json');

// Initialize config file if it doesn't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ 
        enabled: false, 
        reactOn: false 
    }));
}

/**
 * Command handler for .autostatus
 * @param {object} devtrust - Your bot's socket
 * @param {string} chatId - WhatsApp chat ID
 * @param {object} msg - The message object
 * @param {array} args - Command arguments
 * @param {boolean} isCreator - Whether the sender is the bot owner
 */
async function autoStatusCommand(devtrust, chatId, msg, args, isCreator) {
    try {
        // Permission check: only owner can use this command
        if (!msg.key.fromMe && !isCreator) {
            await devtrust.sendMessage(chatId, { 
                text: '❌ This command can only be used by the owner!'
            });
            return;
        }

        // Read current config
        let config = JSON.parse(fs.readFileSync(configPath));

        // If no arguments, show current status
        if (!args || args.length === 0) {
            const status = config.enabled ? 'enabled' : 'disabled';
            const reactStatus = config.reactOn ? 'enabled' : 'disabled';
            await devtrust.sendMessage(chatId, { 
                text: `🔄 *Auto Status Settings*\n\n📱 *Auto Status View:* ${status}\n💫 *Status Reactions:* ${reactStatus}\n\n*Commands:*\n.autostatus on - Enable auto status view\n.autostatus off - Disable auto status view\n.autostatus react on - Enable status reactions\n.autostatus react off - Disable status reactions`
            });
            return;
        }

        const command = args[0].toLowerCase();
        
        if (command === 'on') {
            config.enabled = true;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await devtrust.sendMessage(chatId, { 
                text: '✅ Auto status view has been enabled!\nBot will now automatically view all contact statuses.'
            });
        } else if (command === 'off') {
            config.enabled = false;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await devtrust.sendMessage(chatId, { 
                text: '❌ Auto status view has been disabled!\nBot will no longer automatically view statuses.'
            });
        } else if (command === 'react') {
            if (!args[1]) {
                await devtrust.sendMessage(chatId, { 
                    text: '❌ Please specify on/off for reactions!\nUse: .autostatus react on/off'
                });
                return;
            }
            
            const reactCommand = args[1].toLowerCase();
            if (reactCommand === 'on') {
                config.reactOn = true;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await devtrust.sendMessage(chatId, { 
                    text: '💫 Status reactions have been enabled!\nBot will now react to status updates with a green heart 💚.'
                });
            } else if (reactCommand === 'off') {
                config.reactOn = false;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await devtrust.sendMessage(chatId, { 
                    text: '❌ Status reactions have been disabled!\nBot will no longer react to status updates.'
                });
            } else {
                await devtrust.sendMessage(chatId, { 
                    text: '❌ Invalid reaction command! Use: .autostatus react on/off'
                });
            }
        } else {
            await devtrust.sendMessage(chatId, { 
                text: '❌ Invalid command! Use:\n.autostatus on/off - Enable/disable auto status view\n.autostatus react on/off - Enable/disable status reactions'
            });
        }

    } catch (error) {
        console.error('Error in autostatus command:', error);
        await devtrust.sendMessage(chatId, { 
            text: '❌ Error occurred while managing auto status!\n' + error.message
        });
    }
}

// Function to check if auto status is enabled
function isAutoStatusEnabled() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.enabled;
    } catch (error) {
        console.error('Error checking auto status config:', error);
        return false;
    }
}

// Function to check if status reactions are enabled
function isStatusReactionEnabled() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.reactOn;
    } catch (error) {
        console.error('Error checking status reaction config:', error);
        return false;
    }
}

// Function to react to status using proper method
async function reactToStatus(devtrust, statusKey) {
    try {
        if (!isStatusReactionEnabled()) return;

        await devtrust.relayMessage(
            'status@broadcast',
            {
                reactionMessage: {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: statusKey.id,
                        participant: statusKey.participant || statusKey.remoteJid,
                        fromMe: false
                    },
                    text: '💚'
                }
            },
            {
                messageId: statusKey.id,
                statusJidList: [statusKey.remoteJid, statusKey.participant || statusKey.remoteJid]
            }
        );
    } catch (error) {
        console.error('❌ Error reacting to status:', error.message);
    }
}

// Function to handle status updates
async function handleStatusUpdate(devtrust, status) {
    try {
        if (!isAutoStatusEnabled()) return;

        // Add delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Handle status from messages.upsert
        if (status.messages && status.messages.length > 0) {
            const msg = status.messages[0];
            if (msg.key && msg.key.remoteJid === 'status@broadcast') {
                try {
                    await devtrust.readMessages([msg.key]);
                    await reactToStatus(devtrust, msg.key);
                } catch (err) {
                    if (err.message?.includes('rate-overlimit')) {
                        console.log('⚠️ Rate limit hit, waiting before retrying...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await devtrust.readMessages([msg.key]);
                    } else {
                        throw err;
                    }
                }
                return;
            }
        }

        // Handle direct status updates
        if (status.key && status.key.remoteJid === 'status@broadcast') {
            try {
                await devtrust.readMessages([status.key]);
                await reactToStatus(devtrust, status.key);
            } catch (err) {
                if (err.message?.includes('rate-overlimit')) {
                    console.log('⚠️ Rate limit hit, waiting before retrying...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await devtrust.readMessages([status.key]);
                } else {
                    throw err;
                }
            }
            return;
        }

        // Handle status in reactions
        if (status.reaction && status.reaction.key.remoteJid === 'status@broadcast') {
            try {
                await devtrust.readMessages([status.reaction.key]);
                await reactToStatus(devtrust, status.reaction.key);
            } catch (err) {
                if (err.message?.includes('rate-overlimit')) {
                    console.log('⚠️ Rate limit hit, waiting before retrying...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await devtrust.readMessages([status.reaction.key]);
                } else {
                    throw err;
                }
            }
            return;
        }

    } catch (error) {
        console.error('❌ Error in auto status view:', error.message);
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate
};
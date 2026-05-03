  require('dotenv').config();
require('./setting/config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const chalk = require('chalk');
const os = require('os');
const { sleep } = require('./nexstore/utils');
const { BOT_TOKEN } = require('./nexstore/token');
const { autoLoadPairs } = require('./autoload');
 
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const adminFilePath = path.join(__dirname, 'nexstore', 'admin.json');
let adminIDs = [];

// Store for user tracking
const userFilePath = path.join(__dirname, 'nexstore', 'users.json');
let userIDs = new Set();

// Required group and channels
const REQUIRED_GROUP = '@CyberSpaceOfficials02';
const REQUIRED_CHANNELS = [
  '@CyberspaceOfficials01',//channel 1
  '@CyberSpaceOfficials02',
    '@CyberspaceOfficials01',// backup channel
    '@CyberSpaceOfficials02'
];

// Social media links
const SOCIAL_LINKS = {
  whatsapp: 'https://whatsapp.com/channel/0029Vb6wIlg2Jl87sRJwyg2r',// whatsapp channel
    telegram_channels: [
    'https://t.me/CyberspaceOfficials01',
    'https://t.me/CyberSpaceOfficials02',
  ],
    telegram_group: '@CyberSpaceOfficials',
      
  channel1: 'https://t.me/CyberspaceOfficials01',//telegram main channel 1
  channel2: 'https://t.me/CyberSpaceOfficials02',// telegram backup channel
  group1: 'https://t.me/+7-kNPFkOEuY2NWY0', // telegram main group
  group2: 'https://t.me/+qk54rffhz3U0ZjJk',// telegram backup group
  developer: 'https://t.me/Cyberspace_officials',// bot owner
  channel4: 'https://t.me/Cyberspaceofficial03',
};

// Utility functions
const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const loadAdminIDs = async () => {
  const ownerID = '7613538380';
  const defaultAdmins = [ownerID];

  if (!(await exists(adminFilePath))) {
    await fs.writeFile(adminFilePath, JSON.stringify(defaultAdmins, null, 2));
    adminIDs = defaultAdmins;
    console.log('✅ created admin.json with default owner id');
  } else {
    try {
      const raw = await fs.readFile(adminFilePath, 'utf8');
      adminIDs = JSON.parse(raw);
    } catch (err) {
      console.error('❌ error loading admin.json:', err);
      adminIDs = defaultAdmins;
    }
  }
  console.log('📥 loaded admin ids:', adminIDs);
};
function runtime(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}
// Load user IDs
const loadUserIDs = async () => {
  if (await exists(userFilePath)) {
    try {
      const raw = await fs.readFile(userFilePath, 'utf8');
      const users = JSON.parse(raw);
      userIDs = new Set(users);
      console.log(`📥 loaded ${userIDs.size} users`);
    } catch (err) {
      console.error('❌ error loading users.json:', err);
      userIDs = new Set();
    }
  }
};

// Save user IDs
const saveUserIDs = async () => {
  try {
    await fs.writeFile(userFilePath, JSON.stringify([...userIDs], null, 2));
  } catch (err) {
    console.error('❌ error saving users.json:', err);
  }
};

// Track user
const trackUser = async (userId) => {
  const userIdStr = userId.toString();
  if (!userIDs.has(userIdStr)) {
    userIDs.add(userIdStr);
    await saveUserIDs();
    console.log(`➕ new user tracked: ${userIdStr}`);
  }
};

// Check if user has joined required group and channels
const checkMembership = async (userId) => {
  try {
    // Check group membership
    const groupMember = await bot.getChatMember(REQUIRED_GROUP, userId).catch(() => null);
    
    // Check all channels
    const channelChecks = await Promise.all(
      REQUIRED_CHANNELS.map(channel => 
        bot.getChatMember(channel, userId).catch(() => null)
      )
    );

    const validStatuses = ['member', 'administrator', 'creator'];
    const hasJoinedGroup = groupMember && validStatuses.includes(groupMember.status);
    const hasJoinedAllChannels = channelChecks.every(member => member && validStatuses.includes(member.status));

    return {
      hasJoinedGroup,
      hasJoinedAllChannels,
      hasJoinedAll: hasJoinedGroup && hasJoinedAllChannels
    };
  } catch (error) {
    console.error('error checking membership:', error);
    return {
      hasJoinedGroup: false,
      hasJoinedAllChannels: false,
      hasJoinedAll: false
    };
  }
};

// Send join requirement message
const sendJoinRequirement = (chatId) => {
  return bot.sendMessage(
    chatId,
    'Join all our channels to get updates and to proceed',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ᴄʜᴀɴɴᴇʟ 1', url: SOCIAL_LINKS.channel1 }],
          [
            { text: 'ᴄʜᴀɴɴᴇʟ 2', url: SOCIAL_LINKS.channel2 },
            { text: 'ɢʀᴏᴜᴘ 1', url: SOCIAL_LINKS.group1 }
          ],
          [{ text: 'ᴀᴜᴛʜᴏʀɪᴢᴇ', callback_data: 'check_membership' }]
          
        ]
      }
    }
  );
};

// Middleware to check membership before executing commands
const requireMembership = (handler) => {
  return async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Track user
    await trackUser(userId);

    // Admins bypass membership check
    if (adminIDs.includes(userId.toString())) {
      return handler(msg, match);
    }

    // Check membership
    const membership = await checkMembership(userId);
    
    if (!membership.hasJoinedAll) {
      return sendJoinRequirement(chatId);
    }

    return handler(msg, match);
  };
};

// State management
let isShuttingDown = false;
let isAutoLoadRunning = false;

// Auto-load functionality
const runAutoLoad = async () => {
  if (isAutoLoadRunning || isShuttingDown) return;
  isAutoLoadRunning = true;

  try {
    console.log('⏱️ initializing auto-load');
    await autoLoadPairs();
    console.log('✅ auto-load completed');
  } catch (e) {
    console.error('❌ auto-load failed:', e);
  } finally {
    isAutoLoadRunning = false;
  }
};

const startAutoLoadLoop = () => {
  runAutoLoad();
  setInterval(runAutoLoad, 60 * 60 * 1000);
};

// Graceful shutdown
const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`🛑 received ${signal}. shutting down gracefully...`);
  bot.stopPolling();
  console.log('✅ bot stopped successfully');
  process.exit(0);
};

// ========================
// COMMAND HANDLING
// ========================

// Helper to create inline keyboard with copy button
const copyButtonKeyboard = (code, extraButtons = []) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: '📑 COPY CODE', copy_text: { text: code } }],
      ...extraButtons
    ]
  }
});

bot.onText(/\/runtime/, async (msg) => {
  try {
    const chatId = msg.chat.id;

    const caption = `🟢ʙᴏᴛ ɪs ʀᴜɴɴɪɴɢ ғᴏʀ ${runtime(process.uptime())}
`;

    await bot.sendMessage(chatId, caption, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "ᴄʜᴀɴɴᴇʟ", url: SOCIAL_LINKS.channel1 }]
        ]
      }
    });
  } catch (err) {
    console.error('RUNTIME CMD ERROR:', err);
    try {
      await bot.sendMessage(msg.chat.id, '⚠️ Failed to get runtime info.');
    } catch (e) { /* ignore */ }
  }
});

// ========================
// START COMMAND
// ========================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await trackUser(userId);

  const welcomeCaption = `
┌──────────────────┐
🌘𝑪🅈𝐁𝙀𝗥𝑺𝗣🅐𝐂𝙀 𝙈🅓🌑
└──────────────────┘

𝗪𝐞𝙡𝗰𝐨𝙢𝐞 𝙩𝒐 𝘾𝒚𝗯𝐞𝙧 𝙎𝐩𝗮𝙘𝙚 𝙊𝒇𝗳𝐢𝙘𝒊𝐚𝙡 𝒑𝙖𝐢𝒓𝐢𝗻𝙜 𝐛𝗼𝙩
`;

  const startKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '★ START BOT ★', callback_data: 'start_bot' }]
      ]
    }
  };

  const video1 = 'https://files.catbox.moe/s7epfe.mp4';

  try {
    await bot.sendVideo(chatId, video1, {
      caption: welcomeCaption,
      parse_mode: 'Markdown',
      supports_streaming: true,
      ...startKeyboard
    });
  } catch (err) {
    console.error('Video 1 error:', err.message);
    await bot.sendMessage(chatId, welcomeCaption, startKeyboard);
  }
});

// ========================
// CALLBACK HANDLER
// ========================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  // Remove loading spinner
  await bot.answerCallbackQuery(query.id);

  // ========================
  // START BOT BUTTON
  // ========================
  if (data === 'start_bot') {

    // Delete first video/message
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch (e) {
      console.log('Delete failed:', e.message);
    }

    const menuCaption = `╔═•°•❈•°•═╗
🌑 𝗖𝗬𝗕𝗘𝗥 𝗦𝗣𝗔𝗖𝗘 𝗠𝗗 🌑
╚═•°•❈•°•═╝

👋 𝗛𝗘𝗬 THERE,
 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝗖𝗬𝗕𝗘𝗥 𝗦𝗣𝗔𝗖𝗘

─────────────────────────

 🌘 𝗕𝗢𝗧 𝗜𝗡𝗙𝗢
💠 Name    : CYBER SPACE
💠 Version : 2.0
💠 Status  : Online

─────────────────────────

🎯 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦
/pair <number>
/delpair <number>
/runtime
/help
/report <message>

─────────────────────────

🌘❦︎ POWERED BY CYBER SPACE ❦︎︎`;

    const menuKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ᴄʜᴀɴɴᴇʟ 1', url: SOCIAL_LINKS.channel1 }],
          [
            { text: 'ᴄʜᴀɴɴᴇʟ 2', url: SOCIAL_LINKS.channel2 },
            { text: 'ɢʀᴏᴜᴘ 1', url: SOCIAL_LINKS.group1 }
          ],
          [
            { text: 'ᴡʜᴀᴛꜱᴀᴘᴘ', url: SOCIAL_LINKS.whatsapp },
            { text: 'ᴅᴇᴠᴇʟᴏᴘᴇʀ', url: SOCIAL_LINKS.developer }
          ],
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }]
        ]
      }
    };

    const video2 = 'https://files.catbox.moe/uorrn4.mp4';

    try {
      await bot.sendVideo(chatId, video2, {
        caption: menuCaption,
        parse_mode: 'Markdown',
        supports_streaming: true,
        ...menuKeyboard
      });
    } catch (err) {
      console.error('Video 2 error:', err.message);
      await bot.sendMessage(chatId, menuCaption, {
        parse_mode: 'Markdown',
        ...menuKeyboard
      });
    }
  }
});

// Handle bare /pair command
bot.onText(/^\/pair\s*$/, requireMembership((msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    '❌ Invalid format. Use 234xxxxxxxxxx or 234xxxxxxxxxx|1234 Avoid symbols or special characters.',
     { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📖ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: '🔊ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
        }
  }
)}
)); // <-- Make sure this closing has both )) 

// Enhanced /connect command
bot.onText(/\/pair (.+)/, requireMembership(async (msg, match) => {
  const chatId = msg.chat.id;
  const text = match[1].trim();

  try {
    if (!text || /[a-z]/i.test(text)) {
      return bot.sendMessage(chatId, '❌ Invalid format. Use 234xxxxxxxxxx or 234xxxxxxxxxx|1234 Avoid symbols or special characters.',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📖ʜᴇʟᴘ', callback_data: 'help_msg' }],
            [{ text: '🔊ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }]
          ]
        }
      });
    }

    if (!/^\d{7,15}(\|\d{1,10})?$/.test(text)) {
      return bot.sendMessage(chatId, 'Invalid format /pair 234xxx',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
            [{ text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }]
          ]
        }
      });
    }

    if (text.startsWith('0')) {
      return bot.sendMessage(chatId, 'Numbers starting with 0 are not allowed',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
            [{ text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }]
          ]
        }
      });
    }

    const countryCode = text.slice(0, 3);
    if (["252", "4567877"].includes(countryCode)) {
      return bot.sendMessage(chatId, "Numbers with this country code are not supported",
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
            [{ text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }]
          ]
        }
      });
    }

    const pairingFolder = path.join(__dirname, 'nexstore', 'pairing');
    if (!(await exists(pairingFolder))) {
      await fs.mkdir(pairingFolder, { recursive: true });
    }

    const files = await fs.readdir(pairingFolder);
    const pairedCount = files.filter(file => file.endsWith('@s.whatsapp.net')).length;
    
    if (pairedCount >= 30) {
      return bot.sendMessage(chatId, "Pairing limit reached. Try again later or inform my owner t.me/Cyberspace_officials .",
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ᴏᴡɴᴇr', url: SOCIAL_LINKS.developer }],
            [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }]
          ]
        }
      });
    }

    const startpairing = require('./pair.js');
    const Xreturn = text.split("|")[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    
    await startpairing(Xreturn);
    await sleep(4000);

    const pairingFile = path.join(pairingFolder, 'pairing.json');
    const cu = await fs.readFile(pairingFile, 'utf-8');
    const cuObj = JSON.parse(cu);
    delete require.cache[require.resolve('./pair.js')];

    // Save paired user to owner.json with proper WhatsApp format
    const senderNumber = text.split("|")[0].replace(/[^0-9]/g, ''); // Clean number only
    const whatsappFormat = senderNumber + "@s.whatsapp.net"; // Standard format
    const lidFormat = senderNumber + "@lid"; // LID format

    // Read current owner.json
    const ownerPath = path.join(__dirname, 'allfunc', 'owner.json');
    let ownerData = [];

    try {
      const ownerFile = await fs.readFile(ownerPath, 'utf-8');
      ownerData = JSON.parse(ownerFile);
    } catch (err) {
      console.log("⚠️ Creating new owner.json file");
      ownerData = [];
    }

    // Add both formats if not already present
    let isNew = false;
    if (!ownerData.includes(whatsappFormat)) {
      ownerData.push(whatsappFormat);
      isNew = true;
    }
    if (!ownerData.includes(lidFormat)) {
      ownerData.push(lidFormat);
      isNew = true;
    }

    if (isNew) {
      await fs.writeFile(ownerPath, JSON.stringify(ownerData, null, 2));
      console.log("✅ Saved new owner (both formats):", senderNumber);
      
      // Send success message with copy button (new user)
      bot.sendMessage(chatId, 
        `
╔══════════════════╗
║   CYBER PAIR MD  ║
╚══════════════════╝

STATUS   : PENDING ⏳
PHONE    : ${senderNumber}
CODE     : \`${cuObj.code}\`
EXPIRES  : 2 MINUTES

Next Steps:
① Open WhatsApp
② Settings ⚙️
③ Linked Devices
④ Link Phone Number
⑤ Enter code above
⑥ Confirm ✅

Tip: Tap the button below to copy the code.
`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📑 COPY CODE', copy_text: { text: cuObj.code } }]
            ]
          }
        }
      );
    } else {
      console.log("ℹ️ User already in owner list:", senderNumber);
      
      // Send success message with copy button (existing user)
      bot.sendMessage(chatId, 
        `
╔══════════════════╗
║   CYBER PAIR MD  ║
╚══════════════════╝

STATUS   : PENDING ⏳
PHONE    : ${senderNumber}
CODE     : \`${cuObj.code}\`
EXPIRES  : 2 MINUTES

Next Steps:
① Open WhatsApp
② Settings ⚙️
③ Linked Devices
④ Link Phone Number
⑤ Enter code above
⑥ Confirm ✅

Tip: Tap the button below to copy the code.
`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📑 COPY CODE', copy_text: { text: cuObj.code } }]
            ]
          }
        }
      );
    }

  } catch (error) {
    console.error('❌ Connection error:', error);
    bot.sendMessage(chatId, '┃◈ ᴄᴏɴɴᴇᴄᴛɪᴏɴ ғᴀɪʟᴇᴅ , ' + error.message);
  }
}));
// <-- Make sure this closing has both ))
// Handle bare /delpair command
bot.onText(/^\/delpair\s*$/, requireMembership((msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'To proceed enter a phone number in the format: /delpair 234xxxxxxxx',
        { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
      });
}));

// Enhanced /delpair command
bot.onText(/\/delpair (.+)/, requireMembership(async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1].trim();

  try {
    if (!input || /[a-z]/i.test(input) || !/^\d{7,15}$/.test(input) || input.startsWith('0')) {
      return bot.sendMessage(chatId, 'Your whatsapp number cannot start with 0',
            { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
          });
    }

    const jidSuffix = `${input}@s.whatsapp.net`;
    const pairingPath = path.join(__dirname, 'nexstore', 'pairing');

    if (!(await exists(pairingPath))) {
      return bot.sendMessage(chatId, 'The session you are trying to delete does bot exist in the bot database',
            { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
          });
    }

    const entries = await fs.readdir(pairingPath, { withFileTypes: true });
    const matched = entries.find(entry => entry.isDirectory() && entry.name.endsWith(jidSuffix));

    if (!matched) {
      return bot.sendMessage(chatId, `${input} is not found in the bot database`,
            { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
          });
      }

    const targetPath = path.join(pairingPath, matched.name);
    await fs.rm(targetPath, { recursive: true, force: true });

    bot.sendMessage(chatId, `${input} ʜᴀs ʙᴇᴇɴ ᴅᴇʟᴇᴛᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ`,
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  } catch (err) {
    console.error('delpair error:', err);
    bot.sendMessage(chatId, 'opps, i have failed to delete session',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  }
}));

// Admin command - /listpair
bot.onText(/\/listpair$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, 'This command is restricted to my owner only',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  }
  
  bot.sendMessage(chatId, 'ᴜsᴀɢᴇ: /listpair confirm',
        { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
      });
});

// /listpair command with confirmation
bot.onText(/\/listpair (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const confirmation = match[1].trim().toLowerCase();

  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, 'This command is restricted to bot owner only',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  }

  if (confirmation !== 'confirm') {
    return bot.sendMessage(chatId, '⚄︎═══════════════════⚄︎\n┃ \n┃ /listpair confirm\n┃ \n⚄︎═══════════════════⚄︎',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❓ ʜᴇʟᴘ', callback_data: 'help_msg' }]
          ]
          }
        });
  }

  try {
    const pairingPath = path.join(__dirname, 'nexstore', 'pairing');
    
    if (!(await exists(pairingPath))) {
      return bot.sendMessage(chatId, '⚄︎═══════════════════⚄︎\n┃ \n┃ No paired device found \n┃ \n⚄︎═══════════════════⚄︎',
            { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
          });
    }

    const entries = await fs.readdir(pairingPath, { withFileTypes: true });
    const pairedDevices = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

    if (pairedDevices.length === 0) {
      return bot.sendMessage(chatId, '⚄︎═══════════════════⚄︎\n┃ \n┃ No paired device found \n┃ \n⚄︎═══════════════════⚄',
            { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
          });
    }

    const deviceList = pairedDevices.map((device, index) => {
      const phoneNumber = device.split('@')[0];
      return `┃ ${index + 1}. ${phoneNumber}`;
    }).join('\n');

    bot.sendMessage(chatId, `⚄︎═══════════════════⚄︎
┃ Total: ${pairedDevices.length}
┃Devices: ${deviceList}
┃ 
⚄︎═══════════════════⚄︎`,
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  } catch (err) {
    console.error('listpair error:', err);
    bot.sendMessage(chatId, '╭━━〔 ᴇʀʀᴏʀ 〕━━┈⊷\n┃◈ ғᴀɪʟᴇᴅ ᴛᴏ ʀᴇᴛʀɪᴇᴠᴇ\n╰━━━━━━━━━━━━━━━┈⊷',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  }
});

// /autoload command (admin only)
bot.onText(/\/autoload (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const confirmation = match[1].trim().toLowerCase();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, 'This command is restricted to owner only',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  }
  
  if (confirmation !== 'confirm') {
    return bot.sendMessage(chatId, '⚄︎═══════════════════⚄︎\n┃ \n┃ Usage: /autoload confirm\n┃ \n⚄︎═══════════════════⚄',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  }
  
  console.log('manual auto-load triggered');
  autoLoadPairs()
    .then(() => bot.sendMessage(chatId, '╭⚄︎═══════════════════⚄︎\n┃ \n┃ Autoload completed \n┃ \n⚄︎═══════════════════⚄'))
    .catch(e => bot.sendMessage(chatId, `╭━━〔 ᴇʀʀᴏʀ 〕━━┈⊷\n┃◈ ${e.message}\n╰━━━━━━━━━━━━━━━┈⊷`));
});

// /report command - Users can report bugs/issues
bot.onText(/^\/report$/, requireMembership((msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `🛠️ *Report Guide*\n\nUse the command below to report issues:
\`/report <your message>\`

Example:
\`/report bot not working\`

✅ Keep it clear and brief  
✅ Only report real issues

Your feedback helps us improve!`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }],
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{ text: 'ᴍᴀɪɴ ᴍᴇɴᴜ', callback_data: 'start_bot' }]
        ]
      }
    }
  );
}));

// /report with message
bot.onText(/\/report (.+)/, requireMembership(async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username ? `@${msg.from.username}` : 'ɴᴏ ᴜsᴇʀɴᴀᴍᴇ';
  const firstName = msg.from.first_name || 'ᴜsᴇʀ';
  const reportMessage = match[1].trim();

  if (!reportMessage) {
    return bot.sendMessage(
      chatId,
      '┃ ➩ Please provide a message\n┃└────────────',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❓ ʜᴇʟᴘ', callback_data: 'help_msg' }]
          ]
        }
      }
    );
  }

  try {
    const reportText =
`╭━━〔 ɴᴇᴡ ʀᴇᴘᴏʀᴛ 〕━━┈⊷
┃◈ ғʀᴏᴍ: ${firstName}
┃◈ ᴜsᴇʀɴᴀᴍᴇ: ${username}
┃◈ ᴜsᴇʀ ɪᴅ: ${userId}
┃
┃◈ ᴍᴇssᴀɢᴇ:
┃ ${reportMessage}
╰━━━━━━━━━━━━━━━┈⊷`;

    let sentCount = 0;

    for (const adminId of adminIDs) {
      try {
        await bot.sendMessage(adminId, reportText, {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'ʀᴇᴘʟʏ ᴛᴏ ᴜsᴇʀ', callback_data: `reply_${userId}` }]
            ]
          }
        });
        sentCount++;
      } catch (e) {
        console.error(`Failed to send report to admin ${adminId}:`, e.message);
      }
    }

    if (sentCount > 0) {
      bot.sendMessage(
        chatId,
        `✅ *Your report has been sent to the admins.*
They’ll review it and respond soon.
Thanks for your feedback!`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗨 ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }]
            ]
          }
        }
      );
      console.log(chalk.green(`📨 Report from ${userId} sent to ${sentCount} admins`));
    } else {
      bot.sendMessage(chatId, '❌ Failed to send report');
    }

  } catch (error) {
    console.error('report command error:', error);
    bot.sendMessage(
      chatId,
      '╭━━〔 ᴇʀʀᴏʀ 〕━━┈⊷\n┃◈ ғᴀɪʟᴇᴅ ᴛᴏ sᴇɴᴅ ʀᴇᴘᴏʀᴛ\n╰━━━━━━━━━━━━━━━┈⊷',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗨 ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }]
          ]
        }
      }
    );
  }
}));
// /cleansession command (admin only) - Clean up invalid sessions
bot.onText(/\/clean$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, 'This command is restricted to owner only',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
        });
  }
  
  try {
    const pairingPath = path.join(__dirname, 'nexstore', 'pairing');
    
    if (!(await exists(pairingPath))) {
      return bot.sendMessage(chatId, '╭━━〔 ɴᴏ sᴇssɪᴏɴs 〕━━┈⊷\n┃◈ ɴᴏ sᴇssɪᴏɴs ᴛᴏ ᴄʟᴇᴀɴ\n╰━━━━━━━━━━━━━━━┈⊷',
            { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
          });
    }

    const entries = await fs.readdir(pairingPath, { withFileTypes: true });
    let cleaned = 0;
    let kept = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'pairing.json') continue;
      
      const sessionPath = path.join(pairingPath, entry.name);
      const credsPath = path.join(sessionPath, 'creds.json');
      
      // Check if session is valid
      let isValid = false;
      if (await exists(credsPath)) {
        try {
          const creds = JSON.parse(await fs.readFile(credsPath, 'utf8'));
          isValid = !!(creds.me && creds.me.id && creds.registered);
        } catch (e) {
          isValid = false;
        }
      }
      
      if (!isValid) {
        await fs.rm(sessionPath, { recursive: true, force: true });
        console.log(`🗑️ Cleaned invalid session: ${entry.name}`);
        cleaned++;
      } else {
        kept++;
      }
    }

    bot.sendMessage(
      chatId, 
      `⚄︎═══════════════════⚄︎\n`+
      `┃  ᴄʟᴇᴀɴ ᴜᴘ ᴄᴏᴍᴘʟᴇᴛᴇ\n`+
      `┃  ᴄʟᴇᴀɴᴇᴅ: ${cleaned}\n`+
      `┃ ᴋᴇᴘᴛ: ${kept}\n`+
      `⚄︎═══════════════════⚄︎`,
            { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
                });
  } catch (err) {
    console.error('cleansession error:', err);
    bot.sendMessage(chatId, '╭━━〔 ᴇʀʀᴏʀ 〕━━┈⊷\n┃◈ ᴄʟᴇᴀɴᴜᴘ ғᴀɪʟᴇᴅ\n╰━━━━━━━━━━━━━━━┈⊷');
  }
});
// /broadcast command (admin only)
bot.onText(/\/broadcast$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, 'This command is restricted for bot owner only');
  }
  bot.sendMessage(
    chatId,
'⚄︎═══════════════════⚄︎\n'+
'┃ ʙʀᴏᴀᴅᴄᴀsᴛ ɢᴜɪᴅᴇ\n' +
'┃/broadcast <message>\n'+
'┃ ᴛᴏᴛᴀʟ ᴜsᴇʀs' + UserIDs.size + '\n'+
'⚄︎═══════════════════⚄︎',
          { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
          [{  text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1}]
          ]
          }
              });
});
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Track user
  await trackUser(userId);
  
  const caption = `
╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
┃          📚 HELP MENU           ┃
┃       Cyber Space Pairing Bot    ┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1️⃣ – Request a Pairing Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Command: /pair <your_number>
• Example: /pair 2348123456789
• Do NOT include a leading '+' or '00'.
• Wait 3–5 seconds for your code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2️⃣ – Link on WhatsApp
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ Copy the 8‑digit code from above.
2️⃣ Open WhatsApp → Settings.
3️⃣ Tap "Linked devices".
4️⃣ Choose "Link a device".
5️⃣ Enter the code when prompted.
6️⃣ Done! Your device is now linked.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❓ Need Help?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Code not working? Try again.
• Still issues? Use /report <your message>
• Our team will assist you promptly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       💡 Share with friends!      
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌸 Thank you for using Cyber Space MD 🌸`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }],
        [
          { text: 'ʙᴀᴄᴋᴜᴘ', url: SOCIAL_LINKS.channel2 },
          { text: 'ɢʀᴏᴜᴘ', url: SOCIAL_LINKS.group1 }
        ],
        [{ text: 'ᴍᴇɴᴜ', callback_data: 'start_bot' }]
      ]
    }
  };
  {   
    await bot.sendMessage(chatId, caption, keyboard);
  }
});
// /broadcast with message
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const message = match[1].trim();

  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, 'Only owner can use this command');
  }

  if (!message) {
    return bot.sendMessage(chatId, '╭━━〔 ᴇʀʀᴏʀ 〕━━┈⊷\n┃◈ ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴍᴇssᴀɢᴇ\n╰━━━━━━━━━━━━━━━┈⊷');
  }

  const totalUsers = userIDs.size;
  
  if (totalUsers === 0) {
    return bot.sendMessage(chatId, '╭━━〔 ɴᴏ ᴜsᴇʀs 〕━━┈⊷\n┃◈ ɴᴏ ᴜsᴇʀs ᴛᴏ ʙʀᴏᴀᴅᴄᴀsᴛ ᴛᴏ\n╰━━━━━━━━━━━━━━━┈⊷');
  }

  // Send initial status
  const statusMsg = await bot.sendMessage(
    chatId,
    '╭━━〔 ʙʀᴏᴀᴅᴄᴀsᴛɪɴɢ 〕━━┈⊷\n' +
    '┃◈ sᴛᴀʀᴛɪɴɢ ʙʀᴏᴀᴅᴄᴀsᴛ...\n' +
    `┃◈ ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${totalUsers}\n` +
    '┃◈ sᴇɴᴛ: 0\n' +
    '┃◈ ғᴀɪʟᴇᴅ: 0\n' +
    '╰━━━━━━━━━━━━━━━┈⊷'
  );

  let sent = 0;
  let failed = 0;
  const users = [...userIDs];

  // Broadcast message
  for (let i = 0; i < users.length; i++) {
    try {
      await bot.sendMessage(
        users[i],
        `⚄︎═══════════════════⚄︎\n┃ ᴀᴅᴍɪɴ ʙʀᴏᴀᴅᴄᴀsᴛ:\n┃ ${message}\n┃ \n⚄︎═══════════════════⚄︎`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
              [{ text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }]
            ]
          }
        }
      );
      sent++;
      
      // Update status every 10 messages
      if (i % 10 === 0 || i === users.length - 1) {
        try {
          await bot.editMessageText(
            '╭━━〔 ʙʀᴏᴀᴅᴄᴀsᴛɪɴɢ 〕━━┈⊷\n' +
            '┃◈ ɪɴ ᴘʀᴏɢʀᴇss...\n' +
            `┃◈ ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${totalUsers}\n` +
            `┃◈ sᴇɴᴛ: ${sent}\n` +
            `┃◈ ғᴀɪʟᴇᴅ: ${failed}\n` +
            `┃◈ ᴘʀᴏɢʀᴇss: ${Math.round((i + 1) / users.length * 100)}%\n` +
            '╰━━━━━━━━━━━━━━━┈⊷',
            {
              chat_id: chatId,
              message_id: statusMsg.message_id
            }
          );
        } catch (e) {
          // Ignore edit errors
        }
      }
      
      // Delay to avoid rate limits
      await sleep(100);
      
    } catch (error) {
      failed++;
      console.log(`Failed to send to ${users[i]}: ${error.message}`);
      
      // Remove blocked users
      if (error.response && error.response.body && error.response.body.error_code === 403) {
        userIDs.delete(users[i]);
        await saveUserIDs();
      }
    }
  }

  // Final status
  await bot.editMessageText(
    '╭━━〔 ʙʀᴏᴀᴅᴄᴀsᴛ ᴄᴏᴍᴘʟᴇᴛᴇᴅ 〕━━┈⊷\n' +
    `┃◈ ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${totalUsers}\n` +
    `┃◈ sᴜᴄᴄᴇssғᴜʟ: ${sent}\n` +
    `┃◈ ғᴀɪʟᴇᴅ: ${failed}\n` +
    `┃◈ sᴜᴄᴄᴇss ʀᴀᴛᴇ: ${Math.round(sent / totalUsers * 100)}%\n` +
    '╰━━━━━━━━━━━━━━━┈⊷',
    {
      chat_id: chatId,
      message_id: statusMsg.message_id
    }
  );

  console.log(chalk.green(`✅ Broadcast completed: ${sent}/${totalUsers} sent, ${failed} failed`));
});

// Handle unrecognized commands
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) {
    const command = msg.text.split(' ')[0];
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const validCommands = [
      '/start',
      '/pair',
      '/delpair',
      '/autoload',
      '/listpair',
      '/runtime',
      '/broadcast',
      '/clean',
      '/help',
      '/runtime'

    ];

    if (!validCommands.includes(command)) {
      // Track user even for unknown commands
      await trackUser(userId);
      
      // Check membership for unknown commands (except for admins)
      if (!adminIDs.includes(userId.toString())) {
        const membership = await checkMembership(userId);
        if (!membership.hasJoinedAll) {
          return sendJoinRequirement(chatId);
        }
      }

      bot.sendMessage(
        chatId,
        `**⚠️Unknown command** 
Type /help to view all available commands.`,
        { 
          reply_markup: {
            inline_keyboard: [
              [{ text: 'sᴜᴘᴘᴏʀᴛ', callback_data: 'help_msg' }],
              [
                { text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }
                
              ],
              [{ text: 'ᴍᴇɴᴜ', callback_data: 'start_bot' }]
            ]
          }
        }
      );
    }
  }
});

// Handle text messages for admin replies
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  // Check if this is an admin replying to a user
  if (adminIDs.includes(userId) && msg.reply_to_message) {
    const replyToText = msg.reply_to_message.text;
    
    // Check if the replied message is a report
    if (replyToText && replyToText.includes('ɴᴇᴡ ʀᴇᴘᴏʀᴛ')) {
      // Extract user ID from the report
      const userIdMatch = replyToText.match(/ᴜsᴇʀ ɪᴅ: (\d+)/);
      
      if (userIdMatch && userIdMatch[1]) {
        const targetUserId = userIdMatch[1];
        const adminReply = msg.text;
        
        try {
          // Send admin's reply to the user
          await bot.sendMessage(
            targetUserId,
            `ᴀᴅᴍɪɴ ʀᴇᴘʟʏ\n\n${adminReply}\n\n`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '👨‍💻 ᴏᴡɴᴇʀ ', url: SOCIAL_LINKS.developer }]
                ]
              }
            }
          );
          
          // Confirm to admin
          bot.sendMessage(chatId, '╭━━〔 sᴇɴᴛ 〕━━┈⊷\n┃◈ ʀᴇᴘʟʏ sᴇɴᴛ ᴛᴏ ᴜsᴇʀ\n╰━━━━━━━━━━━━━━━┈⊷');
          
          console.log(chalk.green(`📬 Admin ${userId} replied to user ${targetUserId}`));
        } catch (error) {
          console.error('Error sending admin reply:', error);
          bot.sendMessage(chatId, '╭━━〔 ᴇʀʀᴏʀ 〕━━┈⊷\n┃◈ ғᴀɪʟᴇᴅ ᴛᴏ sᴇɴᴅ ʀᴇᴘʟʏ\n╰━━━━━━━━━━━━━━━┈⊷');
        }
      }
    }
  }
});

// Enhanced Callback handler
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name;
  // Track user
  await trackUser(userId);

  if (data === 'check_membership') {
    try {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Authorising Members...' });

      const membership = await checkMembership(userId);

      if (membership.hasJoinedAll) {
        await bot.editMessageText(
          '⚄︎═══════════════════⚄︎\n' +
          '┃ ᴀᴜᴛʜᴏʀɪᴢᴀᴛɪᴏɴ ᴄᴏᴍᴘʟᴇᴛᴇ\n' +
          '┃ ɢʀᴏᴜᴘ ᴊᴏɪɴᴇᴅ\n' +
          '┃ ᴄʜᴀɴɴᴇʟ ᴊᴏɪɴᴇᴅ\n' +
          '┃ ᴄʟɪᴄᴋ ᴏɴ sᴛᴀʀᴛ ʙᴏᴛ ᴛᴏ ʙᴇɢɪɴ\n' +
          '⚄︎═══════════════════⚄︎',
          {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: 'sᴛᴀʀᴛ ʙᴏᴛ', callback_data: 'start_bot' }],
                [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }],
                [
                  { text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 },
                  { text: 'ʙᴀᴄᴋᴜᴘ', url: SOCIAL_LINKS.channel2 }
                ]
              ]
            }
          }
        );
      } else {
        let missingText = '';
        if (!membership.hasJoinedGroup && !membership.hasJoinedAllChannels) {
          missingText = '┃ ❌ ᴍᴀɪɴ ɢʀᴏᴜᴘ\n┃ ❌ ʙᴀᴄᴋᴜᴘ ᴄʜᴀɴɴᴇʟ';
        } else if (!membership.hasJoinedGroup) {
          missingText = '┃ ❌ ʙᴀᴄᴋᴜᴘ ɢʀᴏᴜᴘ\n┃ ✅ ᴀʟʟ ᴄʜᴀɴɴᴇʟs';
        } else {
          missingText = '┃ ✅ ᴀʟʟ ɢʀᴏᴜᴘ\n┃ ❌ ᴍᴀɪɴ ᴄʜᴀɴɴᴇʟ';
        }

        await bot.editMessageText(
                    '⚄︎═══════════════════⚄︎\n' +
                    '┃ ᴀᴜᴛʜᴏʀɪᴢᴀᴛɪᴏɴ ɪɴᴄᴏᴍᴘʟᴇᴛᴇ\n' +
                    '┃ ᴘʟᴇᴀsᴇ ᴊᴏɪɴ:\n' +
                    '┃\n' +
                    missingText + '\n' +
                    '┃\n' +
                    '┃\n' +
                    '┃ ᴛʜᴇɴ ᴀᴜᴛʜᴏʀɪᴢᴇ ᴀɢᴀɪɴ\n' +
                    '⚄︎═══════════════════⚄︎',
          {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: {
              inline_keyboard: [
                [
                  { 
                    text: 'ᴊᴏɪɴ ɢʀᴏᴜᴘ', 
                    url: SOCIAL_LINKS.group1
                  }
                ],
                [
                  { 
                    text: 'ᴄʜᴀɴɴᴇʟ', 
                    url: SOCIAL_LINKS.channel1
                  },
                  { 
                    text: 'ᴄʜᴀɴɴᴇʟ', 
url: SOCIAL_LINKS.channel2
                  },
                   {text: 'ᴄʜᴀɴɴᴇʟ 4', url: SOCIAL_LINKS.channel4 }
                ],
                [
                  { 
                    text: 'ᴀᴜᴛʜᴏʀɪᴢᴇ', 
                    callback_data: 'check_membership' 
                  }
                ],
                [
                  { text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel3 }
                ],
                [
                  { text: 'ɢʀᴏᴜᴘ', url: SOCIAL_LINKS.group2 }
                ]
              ]
            }
          }
        );
      }
    } catch (error) {
      console.error('error in membership check callback:', error);
      await bot.answerCallbackQuery(
        callbackQuery.id, 
        { text: '⚠️ ᴇʀʀᴏʀ ᴄʜᴇᴄᴋɪɴɢ ᴍᴇᴍʙᴇʀsʜɪᴘ', show_alert: true }
      );
    }
  } else if (data === 'start_bot') {
    await bot.answerCallbackQuery(callbackQuery.id);
    
    const caption = `╔═•°•❈•°•═╗
🌸 𝗖𝗬𝗕𝗘𝗥 𝗦𝗣𝗔𝗖𝗘 𝗠𝗗 🌸
╚═•°•❈•°•═╝

👋 𝗛𝗘𝗬 THERE,
⚡ 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝗖𝗬𝗕𝗘𝗥 𝗦𝗣𝗔𝗖𝗘 - 𝗬𝗢𝗨𝗥 𝗨𝗟𝗧𝗜𝗠𝗔𝗧𝗘 𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗣𝗔𝗜𝗥𝗜𝗡𝗚 𝗕𝗢𝗧!

─────────────────────────

🤖 𝗕𝗢𝗧 𝗜𝗡𝗙𝗢
💠 𝗡𝗔𝗠𝗘      : 𝗖𝗬𝗕𝗘𝗥 𝗦𝗣𝗔𝗖𝗘
💠 𝗩𝗘𝗥𝗦𝗜𝗢𝗡 : 2.0 ✰
💠 𝗦𝗧𝗔𝗧𝗨𝗦   : Online & Running Smoothly

─────────────────────────

🎯 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦
💠 /pair <number>
└─❏ Pair your device

💠 /delpair <number>
└─❏ Remove paired devices

💠 /runtime
└─❏ Check bot uptime

💠 /help
└─❏ To guide you through

💠 /report <your message>
└─❏ Report issues

─────────────────────────

🌸❦︎ 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗖𝗬𝗕𝗘𝗥 𝗦𝗣𝗔𝗖𝗘 ❦`;

  const menuKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: 'ᴄʜᴀɴɴᴇʟ 1', url: SOCIAL_LINKS.channel1 }],
      [
        { text: 'ᴄʜᴀɴɴᴇʟ 2', url: SOCIAL_LINKS.channel2 },
        { text: 'ɢʀᴏᴜᴘ 1', url: SOCIAL_LINKS.group1 }
      ],

      // ✅ NEW BUTTONS
      [
        { text: 'ᴡʜᴀᴛꜱᴀᴘᴘ', url: SOCIAL_LINKS.whatsapp },
        { text: 'ᴅᴇᴠᴇʟᴏᴘᴇʀ', url: SOCIAL_LINKS.developer }
      ],

      [{ text: 'ʜᴇʟᴘ', callback_data: 'help_msg' }]
    ]
  }
};
    {
      await bot.sendMessage(chatId, caption, keyboard);
    }
  } else if (data.startsWith('reply_')) {
    // Admin wants to reply to a user report
    const targetUserId = data.replace('reply_', '');
    
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: 'ʀᴇᴘʟʏ ᴛᴏ ᴛʜᴇ ʀᴇᴘᴏʀᴛ ᴍᴇssᴀɢᴇ', 
      show_alert: true 
    });
    
    // Send instruction to admin
    await bot.sendMessage(
      chatId,
      `╭━━〔 ʀᴇᴘʟʏ ᴍᴏᴅᴇ 〕━━┈⊷\n` +
      `┃◈ ʀᴇᴘʟʏ ᴛᴏ ᴛʜᴇ ʀᴇᴘᴏʀᴛ ᴍᴇssᴀɢᴇ\n` +
      `┃◈ ᴀʙᴏᴠᴇ ᴛᴏ sᴇɴᴅ ʏᴏᴜʀ\n` +
      `┃◈ ʀᴇsᴘᴏɴsᴇ ᴛᴏ ᴛʜᴇ ᴜsᴇʀ\n` +
      `╰━━━━━━━━━━━━━━━┈⊷`,
      {
        reply_to_message_id: msg.message_id
      }
    );
  } else if (data === 'help_msg') {
    await bot.answerCallbackQuery(callbackQuery.id);
    
    const caption = `╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
┃          📚 HELP MENU           ┃
┃       Cyber Space Pairing Bot    ┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1️⃣ – Request a Pairing Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Command: /pair <your_number>
• Example: /pair 2348123456789
• Do NOT include a leading '+' or '00'.
• Wait 3–5 seconds for your code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2️⃣ – Link on WhatsApp
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ Copy the 8‑digit code from above.
2️⃣ Open WhatsApp → Settings.
3️⃣ Tap "Linked devices".
4️⃣ Choose "Link a device".
5️⃣ Enter the code when prompted.
6️⃣ Done! Your device is now linked.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❓ Need Help?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Code not working? Try again.
• Still issues? Use /report <your message>
• Our team will assist you promptly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       💡 Share with friends!      
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌸 Thank you for using Cyber Space MD 🌸`;

const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'ᴄʜᴀɴɴᴇʟ', url: SOCIAL_LINKS.channel1 }],
        [
          { text: 'ʙᴀᴄᴋᴜᴘ', url: SOCIAL_LINKS.channel2 },
          { text: 'ɢʀᴏᴜᴘ', url: SOCIAL_LINKS.group1 }
        ],
         [{ text: 'ᴍᴇɴᴜ', callback_data: 'start_bot' }]
      ]
    }
  };
    {
      await bot.sendMessage(chatId, caption, keyboard);
    }

}
  
});

// Initialize and start
(async () => {
  await loadAdminIDs();
  await loadUserIDs();
  //startAutoLoadLoop(); // Uncomment if you want auto-load
  
  const restartCount = parseInt(process.env.RESTART_COUNT || '0', 10);
  console.log(`♻️ restart #${restartCount + 1}`);
  process.env.RESTART_COUNT = String(restartCount + 1);

  console.log(chalk.magenta('🤖 bot is running...'));
  console.log(chalk.blue(`📢 required groups: ${REQUIRED_GROUP}`));
  console.log(chalk.red(`📢 required channels: ${REQUIRED_CHANNELS.join(', ')}`));
  console.log('🔗 social links updated:');
  console.log(chalk.green(` 💬 wa channel: ${SOCIAL_LINKS.whatsapp}`));
  console.log(`📢 telegram channels: ${SOCIAL_LINKS.telegram_channels.join(', ')}`);
  console.log('🔗 social links updated:');
  console.log(chalk.cyan(` 👥 telegram group: ${SOCIAL_LINKS.telegram_group}`));
  console.log(chalk.yellow(`   👨‍💻 developer: ${SOCIAL_LINKS.developer}`));
  console.log('');
  console.log(chalk.green('✅ Membership checking: ENABLED'));
  console.log(chalk.green('✅ Report system: ENABLED'));
  console.log(chalk.yellow('⚠️  Make sure bot is admin in group and channels!'));
})();

// Shutdown handlers
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('message', (msg) => {
  if (msg === 'shutdown') gracefulShutdown('PM2_SHUTDOWN');
});
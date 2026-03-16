const yts = require('yt-search');
const axios = require('axios');

// Your newsletter JID and name
const NEWSLETTER_JID = '120363423360315473@newsletter';
const NEWSLETTER_NAME = '𝗖𝗬𝗕𝗘𝗥 𝗦𝗣𝗔𝗖𝗘 𝗢𝗙𝗙𝗜𝗖𝗜𝗔𝗟𝗦';

// Images for the menu (you can change these)
const PLAY_IMAGES = [
    'https://cdn-icons-png.flaticon.com/512/727/727218.png',
    'https://cdn-icons-png.flaticon.com/512/2995/2995101.png',
    'https://cdn-icons-png.flaticon.com/512/1384/1384060.png'
];

const getRandomImage = () => PLAY_IMAGES[Math.floor(Math.random() * PLAY_IMAGES.length)];

// Newsletter configuration
const NEWSLETTER_CONFIG = {
    newsletterJid: NEWSLETTER_JID,
    newsletterName: NEWSLETTER_NAME,
    serverMessageId: -1
};

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatViews(views) {
    if (!views) return '0';
    if (views >= 1000000) return (views / 1000000).toFixed(1) + 'M';
    if (views >= 1000) return (views / 1000).toFixed(1) + 'K';
    return views.toString();
}

async function playCommandNew(devtrust, chatId, message) {
    try {
        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";

        const searchQuery = text.split(' ').slice(1).join(' ').trim();

        if (!searchQuery) {
            return await devtrust.sendMessage(chatId, {
                image: { url: getRandomImage() },
                caption: `🎵 *Usage:* \`.play <song name or YouTube link>\`\n\n*Example:* \`.play shape of you\``,
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: NEWSLETTER_CONFIG,
                    externalAdReply: {
                        title: "🎵 Cyber Music Player",
                        body: "Play any song from YouTube",
                        thumbnailUrl: getRandomImage(),
                        mediaType: 1,
                        renderLargerThumbnail: true,
                        sourceUrl: "https://whatsapp.com/channel/0029Vb6wIlg2Jl87sRJwyg2r"
                    }
                }
            }, { quoted: message });
        }

        // Searching message
        const searchingMsg = await devtrust.sendMessage(chatId, {
            text: "🔍 *Searching in the cyber archives...*"
        }, { quoted: message });

        // YouTube search
        const search = await yts(searchQuery);
        if (!search.videos || search.videos.length === 0) {
            return await devtrust.sendMessage(chatId, {
                image: { url: getRandomImage() },
                caption: "❌ *No music found for this search.*\n\nTry different keywords.",
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: NEWSLETTER_CONFIG
                }
            }, { quoted: message });
        }

        const video = search.videos[0];
        const videoUrl = video.url;

        // Build menu
        const menuText = `
╭──── *CYBER MUSIC PLAYER* ────╮

🎼 𝐓𝐫𝐚𝐜𝐤
│ ${video.title}

╭───── 𝐈𝐍𝐅𝐎 ────────╮
│ ⏱️ Duration   : ${video.timestamp}
│ 👤 Artist     : ${video.author.name}
│ 👁️ Views      : ${formatViews(video.views)}
│ 📅 Published  : ${video.ago}
╰──────────────────╯

╭───── 𝐒𝐓𝐀𝐓𝐔𝐒 ───────╮
│ 🎧 Now Playing...
│ ⚡ Optimizing sound stream
│ 🔐 Secure media connection
╰────────────────────╯
`;

        // Delete searching message
        try {
            await devtrust.sendMessage(chatId, { delete: searchingMsg.key });
        } catch {}

        // Send thumbnail with menu
        await devtrust.sendMessage(chatId, {
            image: { url: video.thumbnail },
            caption: menuText,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: NEWSLETTER_CONFIG,
                externalAdReply: {
                    title: "🎵 " + video.title.substring(0, 50),
                    body: `👤 ${video.author.name} | ⏱️ ${video.timestamp}`,
                    thumbnailUrl: video.thumbnail,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                    sourceUrl: videoUrl
                }
            }
        }, { quoted: message });

        // API call
        const apiUrl = `https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(videoUrl)}`;
        const { data } = await axios.get(apiUrl, { timeout: 15000 });

        if (!data?.status || !data?.audio) {
            return await devtrust.sendMessage(chatId, {
                image: { url: getRandomImage() },
                caption: "❌ *Unable to retrieve audio.*\n\nTry another song.",
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: NEWSLETTER_CONFIG
                }
            }, { quoted: message });
        }

        // Download audio
        const audioResponse = await axios.get(data.audio, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept-Encoding': 'identity'
            }
        });

        const audioBuffer = Buffer.from(audioResponse.data);
        const safeTitle = (data.title || video.title || "audio")
            .replace(/[<>:"/\\|?*]+/g, '');

        // Success message
        const successText = `
✅ *Download Complete!*

🎵 *${safeTitle}*
📦 Format: MP3 Audio
🔊 Quality: High Quality

Enjoy your music! 🎼
`;

        // Send audio with newsletter
        await devtrust.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: "audio/mpeg",
            fileName: `${safeTitle}.mp3`,
            ptt: false,
            caption: successText,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: NEWSLETTER_CONFIG,
                externalAdReply: {
                    title: "🎵 " + safeTitle.substring(0, 50),
                    body: "Downloaded by Cyber Space",
                    thumbnailUrl: video.thumbnail,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                    sourceUrl: "https://whatsapp.com/channel/0029Vb6wIlg2Jl87sRJwyg2r"
                }
            }
        }, { quoted: message });

    } catch (error) {
        console.error('Play command error:', error);
        await devtrust.sendMessage(chatId, {
            image: { url: getRandomImage() },
            caption: "❌ *Download failed.*\n\nPlease try again later.",
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: NEWSLETTER_CONFIG
            }
        }, { quoted: message });
    }
}

module.exports = playCommandNew;

// credit to CYBER 
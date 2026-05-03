const axios = require('axios');

async function soraCommand(devtrust, chatId, message) {
    try {
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            '';

        const used = (rawText || '').split(/\s+/)[0] || '.sora';
        const args = rawText.slice(used.length).trim();
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        const input = args || quotedText;

        if (!input) {
            await devtrust.sendMessage(chatId, { text: 'Provide a prompt. Example: .sora anime girl with short blue hair' }, { quoted: message });
            return;
        }

        const apiUrl = `https://okatsu-rolezapiiz.vercel.app/ai/txt2video?text=${encodeURIComponent(input)}`;
        const { data } = await axios.get(apiUrl, { timeout: 60000, headers: { 'user-agent': 'Mozilla/5.0' } });

        // Try to extract video URL from various possible response structures
        const videoUrl = data?.videoUrl || data?.result || data?.data?.videoUrl;
        if (!videoUrl) {
            throw new Error('No videoUrl in API response');
        }

        await devtrust.sendMessage(chatId, {
            video: { url: videoUrl },
            mimetype: 'video/mp4',
            caption: `Prompt: ${input}`
        }, { quoted: message });

    } catch (error) {
        console.error('[SORA] error:', error?.message || error);
        await devtrust.sendMessage(chatId, { text: 'Failed to generate video. Try a different prompt later.' }, { quoted: message });
    }
}

module.exports = soraCommand;
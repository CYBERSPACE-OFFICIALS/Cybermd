const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const APIs = require('./apis');  // the file we just created
const { toAudio } = require('./converter');

const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

async function playNew(devtrust, chatId, message, args) {
    try {
        const text = args.join(' ');
        if (!text) {
            return await devtrust.sendMessage(chatId, {
                text: 'Usage: .play <song name or YouTube link>'
            }, { quoted: message });
        }

        let video;
        if (text.includes('youtube.com') || text.includes('youtu.be')) {
            video = { url: text };
        } else {
            const search = await yts(text);
            if (!search || !search.videos.length) {
                return await devtrust.sendMessage(chatId, {
                    text: 'No results found.'
                }, { quoted: message });
            }
            video = search.videos[0];
        }

        // Inform user
        await devtrust.sendMessage(chatId, {
            image: { url: video.thumbnail },
            caption: `🎵 Downloading: *${video.title}*\n⏱ Duration: ${video.timestamp}`
        }, { quoted: message });

        // Try multiple APIs with fallback chain
        let audioData;
        let audioBuffer;
        let downloadSuccess = false;

        // List of API methods to try
        const apiMethods = [
            { name: 'EliteProTech', method: () => APIs.getEliteProTechDownloadByUrl(video.url) },
            { name: 'Yupra', method: () => APIs.getYupraDownloadByUrl(video.url) },
            { name: 'Okatsu', method: () => APIs.getOkatsuDownloadByUrl(video.url) },
            { name: 'Izumi', method: () => APIs.getIzumiDownloadByUrl(video.url) }
        ];

        for (const apiMethod of apiMethods) {
            try {
                audioData = await apiMethod.method();
                const audioUrl = audioData.download || audioData.dl || audioData.url;

                if (!audioUrl) {
                    console.log(`${apiMethod.name} returned no download URL, trying next API...`);
                    continue;
                }

                // Try arraybuffer first
                try {
                    const audioResponse = await axios.get(audioUrl, {
                        responseType: 'arraybuffer',
                        timeout: 90000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                        decompress: true,
                        validateStatus: s => s >= 200 && s < 400,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': '*/*',
                            'Accept-Encoding': 'identity'
                        }
                    });
                    audioBuffer = Buffer.from(audioResponse.data);

                    if (audioBuffer && audioBuffer.length > 0) {
                        downloadSuccess = true;
                        break;
                    }
                } catch (downloadErr) {
                    const statusCode = downloadErr.response?.status || downloadErr.status;
                    if (statusCode === 451) {
                        console.log(`Download blocked (451) from ${apiMethod.name}, trying next API...`);
                        continue;
                    }

                    // Try stream mode as fallback
                    try {
                        const audioResponse = await axios.get(audioUrl, {
                            responseType: 'stream',
                            timeout: 90000,
                            maxContentLength: Infinity,
                            maxBodyLength: Infinity,
                            validateStatus: s => s >= 200 && s < 400,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': '*/*',
                                'Accept-Encoding': 'identity'
                            }
                        });
                        const chunks = [];
                        await new Promise((resolve, reject) => {
                            audioResponse.data.on('data', c => chunks.push(c));
                            audioResponse.data.on('end', resolve);
                            audioResponse.data.on('error', reject);
                        });
                        audioBuffer = Buffer.concat(chunks);

                        if (audioBuffer && audioBuffer.length > 0) {
                            downloadSuccess = true;
                            break;
                        }
                    } catch (streamErr) {
                        const streamStatusCode = streamErr.response?.status || streamErr.status;
                        if (streamStatusCode === 451) {
                            console.log(`Stream download blocked (451) from ${apiMethod.name}, trying next API...`);
                        } else {
                            console.log(`Stream download failed from ${apiMethod.name}:`, streamErr.message);
                        }
                        continue;
                    }
                }
            } catch (apiErr) {
                console.log(`${apiMethod.name} API failed:`, apiErr.message);
                continue;
            }
        }

        if (!downloadSuccess || !audioBuffer) {
            throw new Error('All download sources failed. The content may be unavailable or blocked in your region.');
        }

        // Detect format and convert if needed
        const firstBytes = audioBuffer.slice(0, 12);
        const asciiSignature = firstBytes.toString('ascii', 4, 8);
        let fileExtension = 'mp3';

        if (asciiSignature === 'ftyp') {
            fileExtension = 'm4a';
        } else if (audioBuffer.toString('ascii', 0, 4) === 'OggS') {
            fileExtension = 'ogg';
        } else if (audioBuffer.toString('ascii', 0, 4) === 'RIFF') {
            fileExtension = 'wav';
        }

        let finalBuffer = audioBuffer;
        let finalMimetype = 'audio/mpeg';
        let finalExtension = 'mp3';

        if (fileExtension !== 'mp3') {
            try {
                finalBuffer = await toAudio(audioBuffer, fileExtension);
                if (!finalBuffer || finalBuffer.length === 0) {
                    throw new Error('Conversion returned empty buffer');
                }
            } catch (convErr) {
                throw new Error(`Failed to convert ${fileExtension} to MP3: ${convErr.message}`);
            }
        }

        // Send audio
        await devtrust.sendMessage(chatId, {
            audio: finalBuffer,
            mimetype: finalMimetype,
            fileName: `${(audioData.title || video.title || 'song').replace(/[^\w\s-]/g, '')}.${finalExtension}`,
            ptt: false
        }, { quoted: message });

        // Cleanup temp files (optional, handled by converter.js internally)
        try {
            const tempDir = path.join(__dirname, '../tmp');
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                const now = Date.now();
                files.forEach(file => {
                    const filePath = path.join(tempDir, file);
                    try {
                        const stats = fs.statSync(filePath);
                        if (now - stats.mtimeMs > 10000) {
                            if (file.endsWith('.mp3') || file.endsWith('.m4a') || /^\d+\.(mp3|m4a)$/.test(file)) {
                                fs.unlinkSync(filePath);
                            }
                        }
                    } catch (e) {}
                });
            }
        } catch (cleanupErr) {}

    } catch (err) {
        console.error('PlayNew command error:', err);
        let errorMessage = '❌ Failed to download song.';
        if (err.message && err.message.includes('blocked')) {
            errorMessage = '❌ Download blocked. The content may be unavailable in your region or due to legal restrictions.';
        } else if (err.response?.status === 451 || err.status === 451) {
            errorMessage = '❌ Content unavailable (451). This may be due to legal restrictions or regional blocking.';
        } else if (err.message && err.message.includes('All download sources failed')) {
            errorMessage = '❌ All download sources failed. The content may be unavailable or blocked.';
        }
        await devtrust.sendMessage(chatId, { text: errorMessage }, { quoted: message });
    }
}

module.exports = playNew;
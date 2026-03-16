const axios = require('axios');

const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

async function tryRequest(getter, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await getter();
        } catch (err) {
            lastError = err;
            if (attempt < attempts) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

async function getYupraDownloadByUrl(youtubeUrl) {
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
        return {
            download: res.data.data.download_url,
            title: res.data.data.title,
            thumbnail: res.data.data.thumbnail
        };
    }
    throw new Error('Yupra returned no download');
}

async function getOkatsuDownloadByUrl(youtubeUrl) {
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.dl) {
        return {
            download: res.data.dl,
            title: res.data.title,
            thumbnail: res.data.thumb
        };
    }
    throw new Error('Okatsu ytmp3 returned no download');
}

// EliteProTech API (example – replace with actual working endpoint if needed)
async function getEliteProTechDownloadByUrl(youtubeUrl) {
    const apiUrl = `https://eliteprotech-ytdl.herokuapp.com/api/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.download_url) {
        return {
            download: res.data.download_url,
            title: res.data.title,
            thumbnail: res.data.thumbnail
        };
    }
    throw new Error('EliteProTech returned no download');
}

// Izumi API (example – replace if needed)
async function getIzumiDownloadByUrl(youtubeUrl) {
    const apiUrl = `https://api.izumixd.my.id/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.download) {
        return {
            download: res.data.download,
            title: res.data.title,
            thumbnail: res.data.thumbnail
        };
    }
    throw new Error('Izumi returned no download');
}

module.exports = {
    getYupraDownloadByUrl,
    getOkatsuDownloadByUrl,
    getEliteProTechDownloadByUrl,
    getIzumiDownloadByUrl
};
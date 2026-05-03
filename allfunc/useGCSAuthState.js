const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { Storage } = require('@google-cloud/storage');

// Replit sidecar provides authenticated access to GCS in both preview and production
const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

const storage = new Storage({
    credentials: {
        audience: 'replit',
        subject_token_type: 'access_token',
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: 'external_account',
        credential_source: {
            url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
            format: {
                type: 'json',
                subject_token_field_name: 'access_token',
            },
        },
        universe_domain: 'googleapis.com',
    },
    projectId: '',
});

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

function gcsPrefix(jid) {
    return `bot-sessions/${jid}/`;
}

async function readFromGCS(bucket, filePath) {
    try {
        const [exists] = await bucket.file(filePath).exists();
        if (!exists) return null;
        const [content] = await bucket.file(filePath).download();
        return JSON.parse(content.toString(), BufferJSON.reviver);
    } catch {
        return null;
    }
}

async function writeToGCS(bucket, filePath, data) {
    const content = JSON.stringify(data, BufferJSON.replacer, 2);
    await bucket.file(filePath).save(content, { contentType: 'application/json' });
}

async function deleteFromGCS(bucket, filePath) {
    try {
        await bucket.file(filePath).delete({ ignoreNotFound: true });
    } catch {
    }
}

async function useGCSAuthState(jid) {
    if (!BUCKET_ID) throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID env var not set');
    const bucket = storage.bucket(BUCKET_ID);
    const prefix = gcsPrefix(jid);

    const writeKey = async (type, id, value) => {
        try {
            if (value) {
                await writeToGCS(bucket, `${prefix}${type}-${id}.json`, value);
            } else {
                await deleteFromGCS(bucket, `${prefix}${type}-${id}.json`);
            }
        } catch (err) {
            console.error(`[GCS] Failed to write key ${type}-${id}:`, err.message || err);
        }
    };

    const creds = (await readFromGCS(bucket, `${prefix}creds.json`)) || initAuthCreds();

    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {};
                await Promise.all(
                    ids.map(async (id) => {
                        const val = await readFromGCS(bucket, `${prefix}${type}-${id}.json`);
                        if (val) {
                            if (type === 'app-state-sync-key') {
                                data[id] = proto.Message.AppStateSyncKeyData.fromObject(val);
                            } else {
                                data[id] = val;
                            }
                        }
                    })
                );
                return data;
            },
            set: async (data) => {
                await Promise.all(
                    Object.entries(data).flatMap(([type, ids]) =>
                        Object.entries(ids).map(([id, value]) => writeKey(type, id, value))
                    )
                );
            },
        },
    };

    const saveCreds = async () => {
        try {
            await writeToGCS(bucket, `${prefix}creds.json`, state.creds);
        } catch (err) {
            console.error(`[GCS] Failed to save creds for ${jid}:`, err.message || err);
        }
    };

    return { state, saveCreds };
}

async function listGCSSessions() {
    if (!BUCKET_ID) return [];
    try {
        const bucket = storage.bucket(BUCKET_ID);
        const [files] = await bucket.getFiles({ prefix: 'bot-sessions/' });
        const sessionMap = {};
        for (const file of files) {
            const parts = file.name.split('/');
            if (parts.length >= 3) {
                const jid = parts[1];
                if (jid.endsWith('@s.whatsapp.net')) {
                    if (!sessionMap[jid]) sessionMap[jid] = [];
                    sessionMap[jid].push(file.name);
                }
            }
        }
        return Object.keys(sessionMap);
    } catch {
        return [];
    }
}

async function readGCSCreds(jid) {
    if (!BUCKET_ID) return null;
    const bucket = storage.bucket(BUCKET_ID);
    return readFromGCS(bucket, `${gcsPrefix(jid)}creds.json`);
}

async function deleteGCSSession(jid) {
    if (!BUCKET_ID) return;
    try {
        const bucket = storage.bucket(BUCKET_ID);
        const [files] = await bucket.getFiles({ prefix: gcsPrefix(jid) });
        await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
        console.log(`[GCS] Deleted session: ${jid}`);
    } catch (err) {
        console.error(`[GCS] Failed to delete session ${jid}:`, err.message);
    }
}

module.exports = { useGCSAuthState, listGCSSessions, readGCSCreds, deleteGCSSession };

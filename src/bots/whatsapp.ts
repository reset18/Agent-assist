import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import { processUserMessage } from '../agent/loop.js';
import { transcribeAudio } from '../agent/audio.js';
import { createSession } from '../db/index.js';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sanitizeBotText(text: string) {
    if (!text) return '';
    let out = String(text);
    out = out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
    out = out.replace(/&lt;system-reminder&gt;[\s\S]*?&lt;\/system-reminder&gt;/gi, '').trim();
    out = out.replace(/#\s*Plan Mode\s*-\s*System Reminder[\s\S]*$/gi, '').trim();
    out = out.replace(/CRITICAL:\s*Plan mode ACTIVE[\s\S]*$/gi, '').trim();
    return out;
}

function resolveMediaFilePath(audioPath: string) {
    const normalized = audioPath.startsWith('/') ? audioPath.slice(1) : audioPath;
    const candidates = [
        path.join(process.cwd(), normalized),
        path.join(process.cwd(), 'dist', 'web', 'public', normalized),
        path.join(process.cwd(), 'src', 'web', 'public', normalized)
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return path.join(process.cwd(), normalized);
}

function normalizeAudioExt(extOrMime: string) {
    const lower = (extOrMime || '').toLowerCase();
    if (lower.includes('ogg') || lower.includes('opus') || lower.endsWith('.ogg')) return '.ogg';
    if (lower.includes('mpeg') || lower.includes('mp3') || lower.endsWith('.mp3')) return '.mp3';
    if (lower.includes('wav') || lower.endsWith('.wav')) return '.wav';
    if (lower.includes('m4a') || lower.includes('mp4') || lower.endsWith('.m4a') || lower.endsWith('.mp4')) return '.m4a';
    if (lower.includes('webm') || lower.endsWith('.webm')) return '.webm';
    return '.ogg';
}

async function saveIncomingAudioForWeb(buffer: Buffer, extOrMime: string) {
    const publicDirCandidates = [
        path.join(process.cwd(), 'dist', 'web', 'public'),
        path.join(process.cwd(), 'src', 'web', 'public')
    ];
    const publicDir = publicDirCandidates.find((p) => fs.existsSync(p)) || publicDirCandidates[0];
    const mediaDir = path.join(publicDir, 'media');
    await fs.promises.mkdir(mediaDir, { recursive: true });

    const ext = normalizeAudioExt(extOrMime);
    const fileName = `whatsapp_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    await fs.promises.writeFile(path.join(mediaDir, fileName), buffer);
    return `/media/${fileName}`;
}

export let whatsappGlobalState = { status: 'initializing', qr: '' };

async function sendWithAudioIntercept(msg: any, response: string) {
    response = sanitizeBotText(response);
    const audioRegex = /\[AUDIO:\s*(\/media\/[^\]]+)\]/g;
    let match;
    let audios: string[] = [];
    let cleanText = response;

    while ((match = audioRegex.exec(response)) !== null) {
        audios.push(match[1]);
        cleanText = cleanText.replace(match[0], '').trim();
    }

        if (cleanText) {
            await msg.reply(cleanText);
        }

    for (const audioPath of audios) {
        const fullPath = resolveMediaFilePath(audioPath);
        try {
            const media = MessageMedia.fromFilePath(fullPath);
            await msg.reply(media, undefined, { sendAudioAsVoice: true });
        } catch (e) {
            console.error('[WhatsApp] Error enviando nota de voz:', e);
        }
    }
}

export async function startWhatsappBot() {
    console.log('[WhatsApp] Iniciando cliente. Por favor espera a que se genere el QR...');
    whatsappGlobalState.status = 'initializing';

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log('\n[WhatsApp] === ESCANEA ESTE CÓDIGO QR PARA VINCULAR ===');
        qrcode.generate(qr, { small: true });
        whatsappGlobalState.status = 'qr_ready';
        whatsappGlobalState.qr = qr;
    });

    client.on('ready', () => {
        console.log('[WhatsApp] ¡Cliente vinculado y listo!');
        whatsappGlobalState.status = 'connected';
        whatsappGlobalState.qr = '';
    });

    client.on('disconnected', (reason) => {
        console.log('[WhatsApp] Cliente desconectado:', reason);
        whatsappGlobalState.status = 'disconnected';
    });

    client.on('message', async (msg) => {
        const userId = msg.from;
        const chat = await msg.getChat();

        if (msg.type === 'chat') {
            const text = msg.body;
            if (!text) return;

            try {
                await chat.sendStateTyping();
                const sessionId = 'whatsapp_default';
                createSession(sessionId, 'Chat de WhatsApp', 'whatsapp');
                const response = await processUserMessage(userId, 'whatsapp', text, false, sessionId);
                await sendWithAudioIntercept(msg, response);
            } catch (e: any) {
                console.error('[WhatsApp] Error procesando mensaje de texto:', e);
                await msg.reply('Ha ocurrido un error interno tratando tu mensaje.');
            }
        } else if (msg.type === 'audio' || msg.type === 'ptt') {
            try {
                await chat.sendStateRecording();
                const media = await msg.downloadMedia();
                if (!media || !media.data) return;

                const buffer = Buffer.from(media.data, 'base64');
                const audioPathForWeb = await saveIncomingAudioForWeb(buffer, media.mimetype || msg.type || 'audio/ogg');
                const transcript = await transcribeAudio(buffer, 'whatsapp_audio.ogg');
                await chat.sendStateTyping();

                const sessionId = 'whatsapp_default';
                createSession(sessionId, 'Chat de WhatsApp', 'whatsapp');
                const response = await processUserMessage(
                    userId,
                    'whatsapp',
                    transcript,
                    true,
                    sessionId,
                    undefined,
                    `[AUDIO: ${audioPathForWeb}]`
                );
                await sendWithAudioIntercept(msg, response);
            } catch (e: any) {
                console.error('[WhatsApp] Error procesando audio:', e);
                await msg.reply('No he podido transcribir o procesar el audio. Inténtalo de nuevo en unos segundos.');
            }
        }
    });

    await client.initialize();
}

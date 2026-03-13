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

export let whatsappGlobalState = { status: 'initializing', qr: '' };

async function sendWithAudioIntercept(msg: any, response: string) {
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
                const transcript = await transcribeAudio(buffer, 'whatsapp_audio.ogg');

                await msg.reply(`_Has dicho: "${transcript}"_`);
                await chat.sendStateTyping();

                const sessionId = 'whatsapp_default';
                createSession(sessionId, 'Chat de WhatsApp', 'whatsapp');
                const response = await processUserMessage(userId, 'whatsapp', transcript, true, sessionId);
                await sendWithAudioIntercept(msg, response);
            } catch (e: any) {
                console.error('[WhatsApp] Error procesando audio:', e);
                await msg.reply('No he podido transcribir o procesar el audio. ' + e.message);
            }
        }
    });

    await client.initialize();
}

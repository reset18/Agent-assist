import { Bot, InputFile } from 'grammy';
import { processUserMessage } from '../agent/loop.js';
import { transcribeAudio } from '../agent/audio.js';
import { createSession } from '../db/index.js';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function splitAndSend(ctx: any, text: string) {
    const CHUNK_LIMIT = 4000;
    if (text.length <= CHUNK_LIMIT) {
        return await ctx.reply(text);
    }

    const chunks = [];
    let current = text;
    while (current.length > 0) {
        if (current.length <= CHUNK_LIMIT) {
            chunks.push(current);
            break;
        }
        let cutAt = current.lastIndexOf('\n', CHUNK_LIMIT);
        if (cutAt === -1) cutAt = CHUNK_LIMIT;
        chunks.push(current.substring(0, cutAt));
        current = current.substring(cutAt).trim();
    }

    for (const chunk of chunks) {
        if (chunk) await ctx.reply(chunk);
    }
}

async function sendWithAudioIntercept(ctx: any, response: string) {
    const audioRegex = /\[AUDIO:\s*(\/media\/[^\]]+)\]/g;
    let match;
    let audios: string[] = [];
    let cleanText = response;

    while ((match = audioRegex.exec(response)) !== null) {
        audios.push(match[1]);
        cleanText = cleanText.replace(match[0], '').trim();
    }

    if (cleanText) {
        await splitAndSend(ctx, cleanText);
    }

    for (const audioPath of audios) {
        const fullPath = path.join(process.cwd(), audioPath);
        try {
            await ctx.replyWithVoice(new InputFile(fullPath));
        } catch (e) {
            console.error('[Telegram] Error enviando nota de voz:', e);
        }
    }
}

export async function startTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token === 'SUTITUYE POR EL TUYO') {
        console.warn('[Telegram] Token no configurado. Configúralo en la Interfaz Web o en el .env');
        return;
    }

    const allowedIdsStr = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
    const allowedIds = allowedIdsStr.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));

    const bot = new Bot(token);

    // Middleware estricto para whitelist
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (userId && (allowedIds.includes(userId) || allowedIds.length === 0)) {
            // Si allowedIds está vacío, permitimos todo temporalmente (CUIDADO, mejor requerirlo)
            if (allowedIds.length === 0) {
                console.warn('[Telegram] ATENCIÓN: No hay IDs en la whitelist. Todos pueden hablar.');
            }
            await next();
        } else {
            console.log(`[Telegram] Intento de acceso denegado del ID: ${userId}`);
        }
    });

    bot.on('message:text', async (ctx) => {
        const userId = ctx.from.id.toString();
        const text = ctx.message.text;

        try {
            await ctx.replyWithChatAction('typing');
            const sessionId = 'telegram_default';
            createSession(sessionId, 'Chat de Telegram', 'telegram');
            const response = await processUserMessage(userId, 'telegram', text, false, sessionId);
            await sendWithAudioIntercept(ctx, response);
        } catch (e: any) {
            console.error('[Telegram] Error procesando texto:', e);
            await ctx.reply('Ha ocurrido un error interno tratando tu mensaje.');
        }
    });

    bot.on(['message:voice', 'message:audio'], async (ctx) => {
        const userId = ctx.from.id.toString();
        const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id;

        if (!fileId) return;

        try {
            await ctx.replyWithChatAction('typing');
            await ctx.reply('🎙️ *Escuchando audio...*', { parse_mode: 'Markdown' });

            // 1. Obtener informacíón del archivo
            const file = await ctx.api.getFile(fileId);
            const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

            // 2. Descargar el buffer
            const response = await fetch(url);
            if (!response.ok) throw new Error('Error descargando audio de Telegram');
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // 3. Transcribir
            const transcript = await transcribeAudio(buffer, 'telegram_audio.ogg');

            // 4. Pasar texto al Agente
            await ctx.reply(`_Has dicho: "${transcript}"_\nPensando...`, { parse_mode: 'Markdown' });

            await ctx.replyWithChatAction('typing');
            const sessionId = 'telegram_default';
            createSession(sessionId, 'Chat de Telegram', 'telegram');
            const reply = await processUserMessage(userId, 'telegram', transcript, true, sessionId);
            await sendWithAudioIntercept(ctx, reply);

        } catch (e: any) {
            console.error('[Telegram] Error procesando audio:', e);
            await ctx.reply('No he podido transcribir o procesar el audio. ' + e.message);
        }
    });

    bot.start({
        onStart: (botInfo) => {
            console.log(`[Telegram] Bot iniciado como @${botInfo.username}`);
        }
    });
}

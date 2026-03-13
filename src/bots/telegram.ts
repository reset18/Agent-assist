import { Bot, InputFile } from 'grammy';
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

function preferVoiceFilePath(filePath: string) {
    if (filePath.toLowerCase().endsWith('.mp3')) {
        const oggPath = filePath.replace(/\.mp3$/i, '.ogg');
        if (fs.existsSync(oggPath)) return oggPath;
    }
    return filePath;
}

function normalizeAudioExt(extOrFilename: string) {
    const lower = (extOrFilename || '').toLowerCase();
    if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return '.ogg';
    if (lower.endsWith('.mp3')) return '.mp3';
    if (lower.endsWith('.wav')) return '.wav';
    if (lower.endsWith('.m4a')) return '.m4a';
    if (lower.endsWith('.mp4')) return '.mp4';
    if (lower.endsWith('.webm')) return '.webm';
    return '.ogg';
}

async function saveIncomingAudioForWeb(buffer: Buffer, extOrFilename: string) {
    const publicDirCandidates = [
        path.join(process.cwd(), 'dist', 'web', 'public'),
        path.join(process.cwd(), 'src', 'web', 'public')
    ];
    const publicDir = publicDirCandidates.find((p) => fs.existsSync(p)) || publicDirCandidates[0];
    const mediaDir = path.join(publicDir, 'media');
    await fs.promises.mkdir(mediaDir, { recursive: true });

    const ext = normalizeAudioExt(extOrFilename);
    const fileName = `telegram_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    await fs.promises.writeFile(path.join(mediaDir, fileName), buffer);
    return `/media/${fileName}`;
}

async function splitAndSend(ctx: any, text: string) {
    const CHUNK_LIMIT = 4000;
    if (text.length <= CHUNK_LIMIT) {
        return await ctx.reply(text, { parse_mode: 'Markdown' });
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
        if (chunk) await ctx.reply(chunk, { parse_mode: 'Markdown' });
    }
}

async function sendWithAudioIntercept(ctx: any, response: string) {
    const audioRegex = /\[AUDIO:\s*(\/media\/[^\]]+)\]/g;
    let match;
    const audios: string[] = [];
    let cleanText = response;

    while ((match = audioRegex.exec(response)) !== null) {
        audios.push(match[1]);
        cleanText = cleanText.replace(match[0], '').trim();
    }

    if (cleanText) {
        await splitAndSend(ctx, cleanText);
    }

    for (const audioPath of audios) {
        const fullPath = preferVoiceFilePath(resolveMediaFilePath(audioPath));
        try {
            // Telegram: replyWithVoice espera OGG/Opus para nota de voz.
            // Si llega un .mp3, lo enviamos como audio normal para evitar fallo.
            if (fullPath.toLowerCase().endsWith('.ogg')) {
                await ctx.replyWithVoice(new InputFile(fullPath));
            } else {
                await ctx.replyWithAudio(new InputFile(fullPath));
            }
        } catch (e) {
            console.error('[Telegram] Error enviando nota de voz:', e);
        }
    }
}

async function sendAudioOnlyReply(ctx: any, reply: string) {
    const audioRegex = /\[AUDIO:\s*(\/media\/[^\]]+)\]/g;
    const matches = [...reply.matchAll(audioRegex)];

    if (matches.length > 0) {
        for (const m of matches) {
            const audioPath = m[1];
            const fullPath = preferVoiceFilePath(resolveMediaFilePath(audioPath));
            try {
                if (fullPath.toLowerCase().endsWith('.ogg')) {
                    await ctx.replyWithVoice(new InputFile(fullPath));
                } else {
                    await ctx.replyWithAudio(new InputFile(fullPath));
                }
            } catch (e) {
                console.error('[Telegram] Error enviando audio:', e);
            }
        }
        return;
    }

    const clean = (reply || '').trim();
    if (!clean) return;

    if (clean.includes('Límite de iteraciones alcanzado') || clean.startsWith('Error:')) {
        await ctx.reply(clean, { parse_mode: 'Markdown' });
        return;
    }

    try {
        const { execute_speak_message } = await import('../agent/tools/speak_message.js');
        const ttsResult = await execute_speak_message({ text_to_speak: clean });
        const ttsMatches = [...ttsResult.matchAll(/\[AUDIO:\s*(\/media\/[^\]]+)\]/g)];

        if (ttsMatches.length > 0) {
            for (const tm of ttsMatches) {
                const p = tm[1];
                const fullPath = preferVoiceFilePath(resolveMediaFilePath(p));
                if (fullPath.toLowerCase().endsWith('.ogg')) {
                    await ctx.replyWithVoice(new InputFile(fullPath));
                } else {
                    await ctx.replyWithAudio(new InputFile(fullPath));
                }
            }
            return;
        }

        await splitAndSend(ctx, clean);
    } catch (e) {
        console.error('[Telegram] Error generando TTS de fallback:', e);
        await splitAndSend(ctx, clean);
    }
}

async function processTelegramAudioBuffer(ctx: any, userId: string, audioBuffer: Buffer, filename: string) {
    const audioPathForWeb = await saveIncomingAudioForWeb(audioBuffer, filename);
    const transcript = await transcribeAudio(audioBuffer, filename);
    console.log(`[Telegram] Transcripción recibida (${transcript.length} chars)`);

    const sessionId = 'telegram_default';
    createSession(sessionId, 'Chat de Telegram', 'telegram');
    const reply = await processUserMessage(
        userId,
        'telegram',
        transcript,
        true,
        sessionId,
        undefined,
        `[AUDIO: ${audioPathForWeb}]`
    );

    await sendAudioOnlyReply(ctx, reply);
}

async function ensureTelegramMediaDir() {
    const mediaDir = path.join(process.cwd(), 'data', 'telegram_media');
    await fs.promises.mkdir(mediaDir, { recursive: true });
    return mediaDir;
}

async function downloadTelegramFileToDisk(ctx: any, token: string, fileId: string, suggestedName: string) {
    const mediaDir = await ensureTelegramMediaDir();

    const file = await ctx.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error descargando archivo de Telegram (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const safeName = (suggestedName || 'telegram_file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const outPath = path.join(mediaDir, `${Date.now()}_${safeName}`);
    await fs.promises.writeFile(outPath, buffer);

    return { outPath, url };
}

function buildAttachmentNote(attachments: Array<{ type: string; path: string; url?: string }>) {
    // Bloque legacy para depurar y para modelos que no soporten multimodal
    let note = '\n\n[Adjuntos de Telegram]\n';
    for (const a of attachments) {
        note += `- type: ${a.type}\n  path: ${a.path}${a.url ? `\n  url: ${a.url}` : ''}\n`;
    }
    return note;
}

export async function startTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token === 'SUTITUYE POR EL TUYO') {
        console.warn('[Telegram] Token no configurado. Configúralo en la Interfaz Web o en el .env');
        return;
    }

    const allowedIdsStr = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
    const allowedIds = allowedIdsStr
        .split(',')
        .map(id => parseInt(id.trim(), 10))
        .filter(id => !isNaN(id));

    const bot = new Bot(token);

    // Middleware estricto para whitelist
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (userId && (allowedIds.includes(userId) || allowedIds.length === 0)) {
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
            await ctx.reply('Ha ocurrido un error interno tratando tu mensaje.', { parse_mode: 'Markdown' });
        }
    });

    const handleTelegramAudio = async (ctx: any, fileId: string, filename: string) => {
        const userId = ctx.from.id.toString();

        try {
            await ctx.replyWithChatAction('typing');
            await ctx.reply('🎤 Escuchando audio.', { parse_mode: 'Markdown' });

            const file = await ctx.api.getFile(fileId);
            const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error('Error descargando audio de Telegram');
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            await processTelegramAudioBuffer(ctx, userId, buffer, filename);
        } catch (e: any) {
            console.error('[Telegram] Error procesando audio:', e);
            await ctx.reply('No he podido transcribir o procesar el audio. ' + (e.message || ''), { parse_mode: 'Markdown' });
        }
    };

    bot.on('message:voice', async (ctx) => {
        const fileId = (ctx.message as any).voice?.file_id;
        if (!fileId) return;
        await handleTelegramAudio(ctx, fileId, 'telegram_voice.ogg');
    });

    bot.on('message:audio', async (ctx) => {
        const audio: any = (ctx.message as any).audio;
        const fileId = audio?.file_id;
        if (!fileId) return;
        const filename = audio?.file_name || 'telegram_audio_file';
        await handleTelegramAudio(ctx, fileId, filename);
    });

    bot.on('message:video_note', async (ctx) => {
        const fileId = (ctx.message as any).video_note?.file_id;
        if (!fileId) return;
        await handleTelegramAudio(ctx, fileId, 'telegram_video_note.mp4');
    });

    // Adjuntos: fotos y documentos (incluye audio enviado como "archivo")
    bot.on(['message:photo', 'message:document'], async (ctx) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;

        try {
            const msg: any = ctx.message;
            const attachments: Array<{ type: string; path: string; url?: string }> = [];

            // Foto: coger la mayor resolución
            if (Array.isArray(msg.photo) && msg.photo.length > 0) {
                const best = msg.photo[msg.photo.length - 1];
                const fileId = best.file_id;
                const { outPath, url } = await downloadTelegramFileToDisk(ctx, token, fileId, 'telegram_photo.jpg');
                attachments.push({ type: 'image', path: outPath, url });
            }

            // Documento: podría ser imagen u otro archivo
            if (msg.document?.file_id) {
                const mime = msg.document.mime_type || '';
                const fname = msg.document.file_name || 'telegram_document';

                if (mime.startsWith('audio/')) {
                    await ctx.replyWithChatAction('typing');
                    await ctx.reply('🎤 Escuchando audio.', { parse_mode: 'Markdown' });
                    const { outPath } = await downloadTelegramFileToDisk(ctx, token, msg.document.file_id, fname);
                    const buffer = await fs.promises.readFile(outPath);
                    await processTelegramAudioBuffer(ctx, userId, buffer, fname || 'telegram_audio_document');
                    return;
                }

                const { outPath, url } = await downloadTelegramFileToDisk(ctx, token, msg.document.file_id, fname);
                attachments.push({ type: mime.startsWith('image/') ? 'image' : 'document', path: outPath, url });
            }

            if (attachments.length === 0) {
                // Otros tipos no soportados por ahora
                await ctx.reply('He recibido un mensaje con adjunto, pero de momento solo proceso fotos y documentos.', { parse_mode: 'Markdown' });
                return;
            }

            await ctx.replyWithChatAction('typing');
            const caption = msg.caption || '';
            const sessionId = 'telegram_default';
            createSession(sessionId, 'Chat de Telegram', 'telegram');

            // Mandamos caption + bloque legacy de adjuntos.
            // El loop del agente detectará el bloque y lo transformará a multimodal
            // (si el proveedor soporta el formato OpenAI-compatible).
            const injected = `${caption || 'Analiza la imagen adjunta.'}${buildAttachmentNote(attachments)}`;
            const response = await processUserMessage(userId, 'telegram', injected, false, sessionId);
            await sendWithAudioIntercept(ctx, response);
        } catch (e: any) {
            console.error('[Telegram] Error procesando adjunto:', e);
            await ctx.reply('No he podido descargar o procesar el adjunto. ' + (e.message || ''), { parse_mode: 'Markdown' });
        }
    });

    bot.start({
        onStart: (botInfo) => {
            console.log(`[Telegram] Bot iniciado como @${botInfo.username}`);
        },
    });
}

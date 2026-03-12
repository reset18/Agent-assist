import { Bot, InputFile } from 'grammy';
import { processUserMessage } from '../agent/loop.js';
import { transcribeAudio } from '../agent/audio.js';
import { createSession } from '../db/index.js';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
        const fullPath = path.join(process.cwd(), audioPath);
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

    // Adjuntos: fotos, documentos, etc.
    bot.on('message', async (ctx) => {
        // Evitar capturar texto/voz que ya tienen su handler
        if ((ctx.message as any).text) return;
        if ((ctx.message as any).voice || (ctx.message as any).audio) return;

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

    bot.on(['message:voice', 'message:audio'], async (ctx) => {
        const userId = ctx.from.id.toString();
        const fileId = ctx.message.voice?.file_id || (ctx.message as any).audio?.file_id;

        if (!fileId) return;

        try {
            await ctx.replyWithChatAction('typing');
            // Regla estricta de Kevin: el texto debe ser exactamente una línea
            await ctx.reply('escuchando audio', { parse_mode: 'Markdown' });

            const file = await ctx.api.getFile(fileId);
            const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error('Error descargando audio de Telegram');
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const transcript = await transcribeAudio(buffer, 'telegram_audio.ogg');

            const sessionId = 'telegram_default';
            createSession(sessionId, 'Chat de Telegram', 'telegram');
            const reply = await processUserMessage(userId, 'telegram', transcript, true, sessionId);

            // Si el usuario habló por audio, respondemos siempre con audio.
            // - En texto: SOLO "escuchando audio" (ya enviado arriba)
            // - En Telegram: mandamos nota de voz si el motor genera [AUDIO: ...]
            // - Si no hay audio generado, generamos uno nosotros con TTS.
            const audioRegex = /\[AUDIO:\s*(\/media\/[^\]]+)\]/g;
            const matches = [...reply.matchAll(audioRegex)];

            if (matches.length > 0) {
                // Mandar únicamente los audios detectados, sin texto adicional
                for (const m of matches) {
                    const audioPath = m[1];
                    const fullPath = path.join(process.cwd(), audioPath);
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
            } else {
                // Fallback: convertir el reply (limpio) a TTS y enviarlo
                const clean = reply.trim();
                if (clean) {
                    try {
                        const { execute_speak_message } = await import('../agent/tools/speak_message.js');
                        const ttsResult = await execute_speak_message({ text_to_speak: clean });
                        const ttsMatches = [...ttsResult.matchAll(/\[AUDIO:\s*(\/media\/[^\]]+)\]/g)];
                        if (ttsMatches.length > 0) {
                            for (const tm of ttsMatches) {
                                const p = tm[1];
                                const fullPath = path.join(process.cwd(), p);
                                if (fullPath.toLowerCase().endsWith('.ogg')) {
                                    await ctx.replyWithVoice(new InputFile(fullPath));
                                } else {
                                    await ctx.replyWithAudio(new InputFile(fullPath));
                                }
                            }
                        } else {
                            // Último fallback: si TTS no devuelve tag, mandar como texto (pero eso rompería la regla)
                            // Mejor avisar en logs y no mandar nada extra.
                            console.warn('[Telegram] TTS no devolvió [AUDIO:], no se envía texto para respetar la regla.');
                        }
                    } catch (e) {
                        console.error('[Telegram] Error generando TTS de fallback:', e);
                    }
                }
            }
        } catch (e: any) {
            console.error('[Telegram] Error procesando audio:', e);
            await ctx.reply('No he podido transcribir o procesar el audio. ' + (e.message || ''), { parse_mode: 'Markdown' });
        }
    });

    bot.start({
        onStart: (botInfo) => {
            console.log(`[Telegram] Bot iniciado como @${botInfo.username}`);
        },
    });
}

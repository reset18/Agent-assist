import fs from 'fs';
import os from 'os';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { getSetting } from '../../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function isOauthLikeKey(key: string) {
    if (!key) return false;
    return key.startsWith('eyJ');
}

function tryGenerateLocalPiperAudioTag(text: string): string {
    const defaults = process.platform === 'win32'
        ? { bin: 'C:\\piper\\piper.exe', model: 'C:\\piper\\es_ES-sharvard-medium.onnx' }
        : { bin: path.join(os.homedir(), 'piper', 'piper', 'piper'), model: path.join(os.homedir(), 'piper', 'es_ES-sharvard-medium.onnx') };

    const piperPath = (getSetting('piper_bin_path') || defaults.bin).trim();
    const modelPath = (getSetting('piper_model_path') || defaults.model).trim();
    const speaker = (getSetting('piper_speaker') || '').trim();
    const speedRaw = (getSetting('piper_speed') || '').trim();

    if (!piperPath || !fs.existsSync(piperPath)) {
        throw new Error(`Piper local no encontrado en: ${piperPath}`);
    }
    if (!modelPath || !fs.existsSync(modelPath)) {
        throw new Error(`Modelo Piper no encontrado en: ${modelPath}`);
    }

    const mediaDir = path.join(__dirname, '..', '..', 'web', 'public', 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

    const now = Date.now();
    const tempWav = path.join(mediaDir, `temp_${now}.wav`);
    const base = `voice_${now}`;
    const oggFilename = `${base}.ogg`;
    const oggPath = path.join(mediaDir, oggFilename);

    const piperArgs = ['--model', modelPath, '--output_file', tempWav];
    if (speaker) piperArgs.push('--speaker', speaker);
    if (speedRaw) {
        const speed = Number.parseFloat(speedRaw);
        if (Number.isFinite(speed) && speed > 0) piperArgs.push('--length_scale', String(speed));
    }

    const piperRun = spawnSync(piperPath, piperArgs, { input: text, encoding: 'utf8' });
    if (piperRun.status !== 0 || !fs.existsSync(tempWav)) {
        throw new Error(`Piper falló: ${(piperRun.stderr || piperRun.stdout || '').toString().slice(0, 220)}`);
    }

    const ffmpegRun = spawnSync('ffmpeg', ['-i', tempWav, '-acodec', 'libopus', '-y', oggPath], { encoding: 'utf8' });
    if (ffmpegRun.status === 0 && fs.existsSync(oggPath)) {
        try { fs.unlinkSync(tempWav); } catch {}
        return `[AUDIO: /media/${oggFilename}]`;
    }

    return `[AUDIO: /media/${base}.wav]`;
}

async function requestOpenAITts(apiKey: string, model: string, voice: string, input: string) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            input,
            voice
        })
    });

    if (!response.ok) {
        const error = await response.text();
        const err: any = new Error(`OpenAI TTS falló con status: ${response.status} - ${error}`);
        err.status = response.status;
        err.raw = error;
        throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

export const speak_message_def = {
    type: "function",
    function: {
        name: "speak_message",
        description: "Genera un audio con tu propia voz (usando ElevenLabs) y devuelve la ruta del archivo. Úsala SIEMPRE que el usuario te pida que le mandes un audio, una nota de voz, o te pida explícitamente que le hables usando voz.",
        parameters: {
            type: "object",
            properties: {
                text_to_speak: {
                    type: "string",
                    description: "El mensaje exacto que quieres dictar y convertir a voz."
                }
            },
            required: ["text_to_speak"],
            additionalProperties: false
        }
    }
};

export async function execute_speak_message(args: { text_to_speak: string }) {
    console.log(`[Tool: speak_message] Generando audio para: "${args.text_to_speak.substring(0, 30)}..."`);

    const enabled = getSetting('voice_enabled') || getSetting('elevenlabs_enabled'); // Retrocompatibilidad

    if (enabled !== '1') {
        return "Las capacidades de voz están deshabilitadas. Por favor, indícale al usuario: El audio no se ha mandado porque las capacidades de voz están desactivadas en los ajustes.";
    }

    const attemptErrors: Array<{ engine: string; error: string }> = [];

    // Orden solicitado: local -> openai -> elevenlabs
    const engines: Array<'local' | 'openai' | 'elevenlabs'> = ['local', 'openai', 'elevenlabs'];

    for (const engine of engines) {
        try {
            if (engine === 'local') {
                return tryGenerateLocalPiperAudioTag(args.text_to_speak);
            }

            if (engine === 'openai') {
                let apiKey = getSetting('openai_api_key_audio');
                if (!apiKey && getSetting('model_provider') === 'openai') {
                    const main = getSetting('llm_api_key') || '';
                    apiKey = isOauthLikeKey(main) ? '' : main;
                }
                if (!apiKey || apiKey === 'SUTITUYE POR EL TUYO') {
                    apiKey = process.env.OPENAI_API_KEY || null;
                }
                if (!apiKey || apiKey === 'SUTITUYE POR EL TUYO') {
                    throw new Error('No hay API Key de OpenAI Platform válida para TTS.');
                }

                const voiceId = getSetting('openai_voice_id') || 'alloy';
                const configuredModel = (getSetting('openai_tts_model') || 'auto').trim();
                const modelCandidates = configuredModel === 'auto'
                    ? ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
                    : [configuredModel];

                let lastError: any = null;
                for (const modelCandidate of modelCandidates) {
                    try {
                        const buffer = await requestOpenAITts(apiKey, modelCandidate, voiceId, args.text_to_speak);
                        const mediaDir = path.join(__dirname, '..', '..', 'web', 'public', 'media');
                        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
                        const filename = `voice_${Date.now()}.mp3`;
                        fs.writeFileSync(path.join(mediaDir, filename), buffer);
                        return `[AUDIO: /media/${filename}]`;
                    } catch (e: any) {
                        lastError = e;
                        const raw = String(e?.raw || e?.message || '');
                        const status = Number(e?.status || 0);
                        const modelAccessDenied = status === 403 && (
                            raw.includes('does not have access to model') ||
                            raw.includes('model_not_found')
                        );
                        if (modelAccessDenied) continue;
                        throw e;
                    }
                }
                throw lastError || new Error('No se pudo generar audio con OpenAI TTS.');
            }

            // elevenlabs
            const apiKey = getSetting('elevenlabs_api_key');
            const voiceId = getSetting('elevenlabs_voice_id');
            if (!apiKey || !voiceId) throw new Error('Faltan credenciales de ElevenLabs.');

            const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: args.text_to_speak,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`ElevenLabs falló con status: ${response.status} - ${error}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const mediaDir = path.join(__dirname, '..', '..', 'web', 'public', 'media');
            if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
            const filename = `voice_${Date.now()}.mp3`;
            fs.writeFileSync(path.join(mediaDir, filename), buffer);
            return `[AUDIO: /media/${filename}]`;
        } catch (e: any) {
            const msg = e?.message || String(e);
            attemptErrors.push({ engine, error: msg });
            console.warn(`[Voice Engine] Fallo ${engine}: ${msg}`);
        }
    }

    const details = attemptErrors.map((a) => `${a.engine}: ${a.error}`).join(' | ');
    console.error('[Voice Engine] Error generando voz en todos los motores:', details);
    return `Error interno generando voz: ${details}`;
}

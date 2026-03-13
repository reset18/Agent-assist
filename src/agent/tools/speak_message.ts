import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSetting } from '../../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    const engine = getSetting('voice_engine') || 'elevenlabs';

    if (enabled !== '1') {
        return "Las capacidades de voz están deshabilitadas. Por favor, indícale al usuario: El audio no se ha mandado porque las capacidades de voz están desactivadas en los ajustes.";
    }

    let audioBuffer: Buffer;

    try {
        if (engine === 'local') {
            console.log('[Voice Engine] Usando motor Local (Piper)...');
            const piperPath = path.join(process.env.HOME || '/home/ubuntu', 'piper', 'piper', 'piper');
            const modelPath = path.join(process.env.HOME || '/home/ubuntu', 'piper', 'es_ES-sharvard-medium.onnx');

            if (!fs.existsSync(piperPath)) {
                throw new Error("El binario de Piper no se encuentra en ~/piper/piper/piper. Por favor, ejecuta el script de instalación scripts/setup-piper.sh en el servidor.");
            }

            const { execSync } = await import('child_process');
            const mediaDir = path.join(__dirname, '..', '..', 'web', 'public', 'media');
            if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

            const now = Date.now();
            const tempWav = path.join(mediaDir, `temp_${now}.wav`);
            const base = `voice_${now}`;
            const mp3Filename = `${base}.mp3`;
            const oggFilename = `${base}.ogg`;
            const mp3Path = path.join(mediaDir, mp3Filename);
            const oggPath = path.join(mediaDir, oggFilename);

            // 1) Ejecutar Piper UNA sola vez para generar WAV
            const piperCmd = `echo ${JSON.stringify(args.text_to_speak)} | ${piperPath} --model ${modelPath} --output_file ${tempWav}`;
            execSync(piperCmd);

            // 2) Convertir con ffmpeg (si está disponible) para máxima compatibilidad con el frontend que espera .mp3
            try {
                execSync(`ffmpeg -i ${tempWav} -acodec libmp3lame -y ${mp3Path}`);
                // 3) Generar también OGG para compatibilidad (Telegram, etc.)
                execSync(`ffmpeg -i ${tempWav} -acodec libopus -y ${oggPath}`);
                execSync(`rm ${tempWav}`);
            } catch (e) {
                console.warn("[Voice Engine] ffmpeg falló o no está instalado, usando WAV directamente.");
                const wavFilename = `${base}.wav`;
                const wavPath = path.join(mediaDir, wavFilename);
                fs.renameSync(tempWav, wavPath);
                return `Éxito. El audio fue generado (formato WAV). [AUDIO: /media/${wavFilename}]`;
            }

            return `Éxito. El audio fue generado e incrustado. Por favor, para que el usuario pueda reproducirlo, debes acabar tu mensaje de texto respondiendo EXACTAMENTE la siguiente etiqueta oculta al final del todo:\n[AUDIO: /media/${oggFilename}]`;
        } else if (engine === 'openrouter') {
            const apiKey = getSetting('llm_key_openrouter') || process.env.OPENROUTER_API_KEY;
            if (!apiKey) throw new Error("Falta API Key de OpenRouter para Voz.");

            // OpenRouter no suele tener TTS propio directo tipo ElevenLabs en la misma API de Chat, 
            // pero si el usuario lo pide, intentamos mapear a un proveedor de OpenAI-compatible que soporte TTS en OpenRouter
            // o redirigimos a OpenAI si la clave es compartida.
            // Como fallback razonable:
            throw new Error("OpenRouter no soporta síntesis de voz (TTS) directamente. Por favor, selecciona OpenAI o ElevenLabs en los ajustes de voz.");
        } else if (engine === 'elevenlabs') {
            const apiKey = getSetting('elevenlabs_api_key');
            const voiceId = getSetting('elevenlabs_voice_id');
            if (!apiKey || !voiceId) throw new Error("Faltan credenciales de ElevenLabs.");

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
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`ElevenLabs falló con status: ${response.status} - ${error}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
        } else {
            // OpenAI TTS
            let apiKey = getSetting('openai_api_key_audio');

            // Si no hay clave específica de audio, usar la principal SOLO si estamos en modo OpenAI
            if (!apiKey && getSetting('model_provider') === 'openai') {
                apiKey = getSetting('llm_api_key');
            }

            // Fallback final a la variable de entorno
            if (!apiKey || apiKey === 'SUTITUYE POR EL TUYO') {
                apiKey = process.env.OPENAI_API_KEY || null;
            }

            const voiceId = getSetting('openai_voice_id') || 'alloy';
            if (!apiKey || apiKey === 'SUTITUYE POR EL TUYO') {
                throw new Error("No hay una API Key de OpenAI válida configurada. Por favor configúrala en Habilidades > Voz.");
            }

            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "tts-1",
                    input: args.text_to_speak,
                    voice: voiceId
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`OpenAI TTS falló con status: ${response.status} - ${error}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
        }

        const mediaDir = path.join(__dirname, '..', '..', 'web', 'public', 'media');
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }

        const filename = `voice_${Date.now()}.mp3`;
        const filePath = path.join(mediaDir, filename);

        fs.writeFileSync(filePath, audioBuffer);

        return `Éxito. El audio fue generado e incrustado. Por favor, para que el usuario pueda reproducirlo, debes acabar tu mensaje de texto respondiendo EXACTAMENTE la siguiente etiqueta oculta al final del todo:\n[AUDIO: /media/${filename}]`;
    } catch (error: any) {
        console.error('[Voice Engine] Error generando voz:', error);
        return `Error interno generando voz: ${error.message}`;
    }
}

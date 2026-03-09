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
        if (engine === 'elevenlabs') {
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
            const apiKey = process.env.OPENAI_API_KEY;
            const voiceId = getSetting('openai_voice_id') || 'alloy';
            if (!apiKey || apiKey === 'SUTITUYE POR EL TUYO') {
                throw new Error("No hay una API Key de OpenAI válida configurada para usar el motor de voz de OpenAI.");
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

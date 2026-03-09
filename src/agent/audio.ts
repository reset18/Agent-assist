import { getSetting } from '../db/index.js';

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<string> {
    const provider = getSetting('model_provider') || 'openrouter';
    const dbApiKey = getSetting('llm_api_key') || '';

    let transcriptionUrl = '';
    let apiKey = '';
    let model = '';

    // Intentamos usar Groq o OpenAI preferentemente para audio
    if (provider === 'groq') {
        transcriptionUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
        apiKey = dbApiKey || process.env.GROQ_API_KEY || '';
        model = 'whisper-large-v3';
    } else if (provider === 'openai') {
        transcriptionUrl = 'https://api.openai.com/v1/audio/transcriptions';
        apiKey = dbApiKey || process.env.OPENAI_API_KEY || '';
        model = 'whisper-1';
    } else {
        // Fallback automático si estamos en otro proveedor (Claude/Gemini/OpenRouter)
        // Intentamos usar lo que esté disponible en variables de entorno como red de seguridad
        if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'SUTITUYE POR EL TUYO') {
            transcriptionUrl = 'https://api.openai.com/v1/audio/transcriptions';
            apiKey = process.env.OPENAI_API_KEY;
            model = 'whisper-1';
        } else if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'SUTITUYE POR EL TUYO') {
            transcriptionUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
            apiKey = process.env.GROQ_API_KEY;
            model = 'whisper-large-v3';
        } else {
            throw new Error('No hay una configuración válida para transcribir audio. Por favor, configura OpenAI o Groq en el panel.');
        }
    }

    if (!apiKey) {
        throw new Error('API Key para la transcripción de audio no encontrada.');
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)]);
    form.append('file', blob, filename);
    form.append('model', model);
    form.append('response_format', 'json');

    try {
        const response = await fetch(transcriptionUrl, {
            method: 'POST',
            body: form,
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error HTTP: ${response.status} - ${errorText}`);
        }

        const data: any = await response.json();
        if (data.text) {
            return data.text;
        } else {
            throw new Error('La respuesta de transcripción no contiene texto válido.');
        }
    } catch (error: any) {
        console.error('[Audio] Error transcribiendo archivo:', error.message);
        throw error;
    }
}

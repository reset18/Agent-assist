import fs from 'fs';
import path from 'path';
import os from 'os';
import { getSetting } from '../db/index.js';

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<string> {
    const voiceEngine = getSetting('stt_engine') || 'cloud';

    if (voiceEngine === 'local') {
        console.log('[Audio] Usando Whisper Local para transcripción...');
        try {
            // @ts-ignore
            const whisper = await import('whisper-node').catch(() => null);
            if (!whisper || typeof whisper.transcribe !== 'function') {
                throw new Error("Módulo whisper-node no encontrado o no válido.");
            }

            const tmpFile = path.join(os.tmpdir(), filename);
            fs.writeFileSync(tmpFile, audioBuffer);
            const result = await whisper.transcribe(tmpFile);
            return result;
        } catch (e: any) {
            console.warn(`[Audio] Whisper-node no detectado o falló: ${e.message}. Reintentando con cloud fallback...`);
        }
    }

    const provider = getSetting('model_provider') || 'openrouter';
    const mainApiKey = getSetting('llm_api_key') || '';
    const audioApiKey = getSetting('openai_api_key_audio') || '';

    let transcriptionUrl = '';
    let apiKey = '';
    let model = '';

    // Nueva prioridad: 1. Clave específica de audio (si existe, usamos OpenAI Whisper por defecto)
    if (audioApiKey) {
        transcriptionUrl = 'https://api.openai.com/v1/audio/transcriptions';
        apiKey = audioApiKey;
        model = 'whisper-1';
    }
    // 2. Si usamos groq como proveedor principal
    else if (provider === 'groq') {
        transcriptionUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
        apiKey = mainApiKey || process.env.GROQ_API_KEY || '';
        model = 'whisper-large-v3';
    }
    // 3. Si usamos openai como proveedor principal
    else if (provider === 'openai') {
        transcriptionUrl = 'https://api.openai.com/v1/audio/transcriptions';
        apiKey = mainApiKey || process.env.OPENAI_API_KEY || '';
        model = 'whisper-1';
    }
    // 4. Fallback automático a variables de entorno para transcribir sí o sí
    else {
        if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'SUTITUYE POR EL TUYO') {
            transcriptionUrl = 'https://api.openai.com/v1/audio/transcriptions';
            apiKey = process.env.OPENAI_API_KEY;
            model = 'whisper-1';
        } else if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'SUTITUYE POR EL TUYO') {
            transcriptionUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
            apiKey = process.env.GROQ_API_KEY;
            model = 'whisper-large-v3';
        } else {
            throw new Error('Configura una "OpenAI API Key (Voz)" en ajustes o usa OpenAI/Groq como motor para poder transcribir audios.');
        }
    }

    if (!apiKey) throw new Error('API Key para la transcripción no encontrada.');

    const form = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)]);
    form.append('file', blob, filename);
    form.append('model', model);
    form.append('response_format', 'json');

    try {
        const response = await fetch(transcriptionUrl, {
            method: 'POST',
            body: form,
            headers: { 'Authorization': `Bearer ${apiKey}` }
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

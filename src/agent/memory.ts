import fs from 'fs';
import path from 'path';
import { addOrUpdateMemory, getSetting, listMemories, type MemoryRecord } from '../db/index.js';

export const MEMORY_DIR = path.join(process.cwd(), 'memory');

export function initMemoryFiles() {
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }

    const files = [
        {
            name: 'identidad.md',
            defaultContent: `# Identidad del Agente\n\nNombre: ${getSetting('agent_name') || 'Asistente'}\nPersonalidad: ${getSetting('agent_personality') || 'Eficiente, natural y directo.'}\nFunción Principal: ${getSetting('agent_function') || 'Ayudar en tareas generales.'}\n\n*Esta es tu identidad principal. Compórtate de acuerdo a esto en todas tus respuestas.*`
        },
        {
            name: 'usuario.md',
            defaultContent: `# Información del Usuario\n\nNombre: ${getSetting('user_name') || 'Usuario'}\n\n*Aquí se guardan las preferencias y datos importantes sobre el usuario con el que interactúas.*`
        },
        {
            name: 'memoria_agente.md',
            defaultContent: `# Memoria del Agente (Long-Term Facts)\n\n*Aquí puedes registrar hechos importantes, descubrimientos, o reglas que debes recordar a largo plazo sobre tus tareas.*`
        }
    ];

    files.forEach(file => {
        const filePath = path.join(MEMORY_DIR, file.name);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, file.defaultContent, 'utf-8');
            console.log(`[Memory] Creado archivo de memoria base: ${file.name}`);
        }
    });
}

export function getMemoryPrompt(): string {
    let memoryPrompt = '\n\n=== ARCHIVOS DE MEMORIA A LARGO PLAZO ===\n';
    memoryPrompt += 'A continuación se muestra tu memoria persistente. Usa esta información para mantener la consistencia en el tiempo:\n\n';

    const files = ['identidad.md', 'usuario.md', 'memoria_agente.md'];

    files.forEach(file => {
        const filePath = path.join(MEMORY_DIR, file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            memoryPrompt += `--- INICIO DE ${file} ---\n${content}\n--- FIN DE ${file} ---\n\n`;
        }
    });

    memoryPrompt += 'Si descubres nueva información crítica sobre el usuario o tus tareas, usa la herramienta "update_memory" para añadirla a memoria_agente.md.\n';
    memoryPrompt += '============================================\n';
    return memoryPrompt;
}

const SECRET_LIKE_RX = /(api[_-]?key|token|secret|password|passwd|bearer|authorization|sk-[a-z0-9]{10,})/i;

function tokenize(text: string): string[] {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s\u00c0-\u017f]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3);
}

function overlapScore(query: string, candidate: string): number {
    const a = new Set(tokenize(query));
    const b = new Set(tokenize(candidate));
    if (!a.size || !b.size) return 0;
    let hits = 0;
    for (const t of a) {
        if (b.has(t)) hits += 1;
    }
    return hits / Math.max(a.size, 1);
}

function isDurableFact(text: string): boolean {
    const t = String(text || '').toLowerCase();
    if (t.length < 15) return false;
    if (SECRET_LIKE_RX.test(t)) return false;
    if (/\b(hoy|ahora|luego|despues|más tarde|manana|mañana|ayer)\b/i.test(t)) return false;
    return /\b(prefiero|siempre|nunca|mi nombre|me llamo|usa|recorda|recuerda|home assistant|telegram|whatsapp|idioma|tono|estilo|configur)/i.test(t);
}

function normalizeMemorySentence(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

export function buildRelevantPersistentMemoriesPrompt(sessionId: string, userInput: string, limit = 6): string {
    if (getSetting('auto_memory_enabled') === '0') return '';
    const pool = listMemories({ scope: 'all', sessionId, limit: 180 });
    if (!pool.length) return '';

    const ranked = pool
        .map((m) => ({
            m,
            score: overlapScore(userInput, m.content) + (m.scope === 'global' ? 0.05 : 0),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.m);

    if (!ranked.length) return '';

    let out = '\n\n=== RECUERDOS PERSISTENTES RELEVANTES ===\n';
    for (const item of ranked) {
        const scopeTag = item.scope === 'global' ? 'GLOBAL' : `SESION:${item.session_id || 'default'}`;
        out += `- [${scopeTag}] ${item.content}\n`;
    }
    out += 'Usa estos recuerdos solo si aplican a la peticion actual.\n';
    out += '========================================\n';
    return out;
}

export function autoPersistMemories(sessionId: string, userInput: string, assistantOutput: string) {
    if (getSetting('auto_memory_enabled') === '0') return;

    const candidates: Array<{ scope: 'global' | 'session'; kind: string; content: string; confidence: number }> = [];
    const userText = normalizeMemorySentence(userInput || '');
    const assistantText = normalizeMemorySentence(assistantOutput || '');

    if (isDurableFact(userText)) {
        candidates.push({ scope: 'global', kind: 'user_preference', content: userText, confidence: 0.84 });
    }

    if (assistantText && assistantText.length < 220 && /\b(queda|guardado|configurado|activado|desactivado|usare|usaré|recordare|recordaré)\b/i.test(assistantText) && !SECRET_LIKE_RX.test(assistantText)) {
        candidates.push({ scope: 'session', kind: 'decision', content: assistantText, confidence: 0.62 });
    }

    const seen = new Set<string>();
    for (const c of candidates) {
        const key = `${c.scope}|${c.kind}|${c.content.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        addOrUpdateMemory({
            scope: c.scope,
            sessionId: c.scope === 'session' ? sessionId : undefined,
            kind: c.kind,
            content: c.content,
            confidence: c.confidence,
            source: 'auto',
        });
    }
}

export function listPersistentMemoriesForSession(sessionId: string, q?: string, limit = 80): MemoryRecord[] {
    return listMemories({ scope: 'all', sessionId, q, limit });
}

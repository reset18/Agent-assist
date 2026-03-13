import { chatCompletion, normalizeTextForComparison } from './llm.js';
import { getSetting, setSetting, getRecentMessages, addMessage, addToolRuntimeMetric } from '../db/index.js';
import { getMemoryPrompt } from './memory.js';
import { getActiveTools, executeToolCall } from './tools.js';
import { getMCPTools, executeMCPTool } from '../mcp/client.js';
import fs from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { createHash } from 'crypto';

const MAX_ITERATIONS = 30;

type RuntimeHookEvent = {
    at: string;
    type: 'before' | 'after' | 'error' | 'loop_warning' | 'loop_block';
    sessionId: string;
    source: string;
    toolName: string;
    reason?: string;
};

const runtimeHookEvents: RuntimeHookEvent[] = [];
const MAX_RUNTIME_HOOK_EVENTS = 200;

const runtimeHookCounters = {
    beforeBlocked: 0,
    afterSuccess: 0,
    onError: 0,
    loopWarnings: 0,
    loopBlocks: 0,
};

function pushRuntimeHookEvent(event: RuntimeHookEvent) {
    runtimeHookEvents.push(event);
    if (runtimeHookEvents.length > MAX_RUNTIME_HOOK_EVENTS) {
        runtimeHookEvents.shift();
    }
}

function readBoolSetting(key: string, fallback: boolean) {
    const v = getSetting(key);
    if (v === null) return fallback;
    return v === '1' || v.toLowerCase() === 'true';
}

function readIntSetting(key: string, fallback: number) {
    const raw = getSetting(key);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function getRuntimeGuardConfig() {
    const warningThreshold = Math.max(readIntSetting('tool_loop_warning_threshold', 6), 6);
    const criticalThreshold = Math.max(readIntSetting('tool_loop_critical_threshold', 12), warningThreshold + 1, 12);
    const globalThreshold = Math.max(readIntSetting('tool_loop_global_threshold', 40), criticalThreshold + 1, 40);

    return {
        hooksEnabled: readBoolSetting('tool_hooks_enabled', true),
        strictMode: readBoolSetting('tool_hooks_strict_mode', true),
        warningThreshold,
        criticalThreshold,
        globalThreshold,
    };
}

export function getToolRuntimeDiagnostics() {
    return {
        config: getRuntimeGuardConfig(),
        counters: { ...runtimeHookCounters },
        recentEvents: [...runtimeHookEvents].reverse().slice(0, 40),
    };
}

// --- ESTADO GLOBAL DE COLAS (OpenClaw Parity) ---
const sessionQueues: Record<string, {
    busy: boolean;
    messages: { 
        text: string; 
        displayText?: string;
        isAudio: boolean; 
        onDelta?: (delta: any) => void; 
        userId: string; 
        source: string; 
        resolve: (val: string) => void; 
        reject: (err: any) => void 
    }[];
    processedIds: Map<string, number>;
}> = {};

const DUPLICATE_WINDOW_MS = 8000;

function getSessionState(sessionId: string) {
    if (!sessionQueues[sessionId]) {
        sessionQueues[sessionId] = {
            busy: false,
            messages: [],
            processedIds: new Map()
        };
    }
    return sessionQueues[sessionId];
}

// Extraer directrices de habilidades habilitadas
function getEnabledSkillsContext(): string {
    try {
        const mcpPath = join(process.cwd(), 'MCP');
        if (!fs.existsSync(mcpPath)) return '';

        const files = fs.readdirSync(mcpPath).filter((f: string) => f.endsWith('.zip'));
        let skillsContext = '';

        for (const file of files) {
            if (getSetting(`skill_enabled_${file}`) === '1') {
                try {
                    const zipPath = join(mcpPath, file);
                    const zip = new AdmZip(zipPath);
                    const skillEntry = zip.getEntry('SKILL.md');
                    if (skillEntry) {
                        skillsContext += `\n--- HABILIDAD EXTRA ACTIVA: ${file.replace('.zip', '')} ---\n`;
                        let content = skillEntry.getData().toString('utf8');
                        content = content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, ''); // limpiar metadata
                        skillsContext += content.trim() + '\n';
                    }
                } catch (err) {
                    console.error(`[Agent] Error cargando Habilidad de ${file}:`, err);
                }
            }
        }

        const gogSecret = getSetting('gog_client_secret');
        const gogEmail = getSetting('gog_email');
        if (gogSecret || gogEmail) {
            skillsContext += `\n[Variables de Configuraci\u00f3n Externas del Usuario]:\n`;
            if (gogSecret) skillsContext += `- Ruta de credenciales Google Cloud (client_secret.json): ${gogSecret}\n`;
            if (gogEmail) skillsContext += `- Email de Google Cloud a vincular: ${gogEmail}\n`;
        }

        return skillsContext;
    } catch (e) {
        return '';
    }
}

function isProbablyLocalFilePath(p: string) {
    if (!p) return false;
    // Linux absolute or windows drive
    return p.startsWith('/') || /^[a-zA-Z]:\\/.test(p);
}

function guessMimeFromPath(p: string) {
    const lower = (p || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'application/octet-stream';
}

function extractImageAttachmentsFromText(message: string): Array<{ path: string; url?: string }> {
    const out: Array<{ path: string; url?: string }> = [];
    const lines = (message || '').split(/\r?\n/);
    let inBlock = false;
    let current: any = null;

    for (const line of lines) {
        if (line.trim() === '[Adjuntos de Telegram]') {
            inBlock = true;
            continue;
        }
        if (!inBlock) continue;

        const typeMatch = line.match(/^\s*-\s*type:\s*(.+)\s*$/);
        if (typeMatch) {
            if (current && current.type === 'image' && current.path) out.push({ path: current.path, url: current.url });
            current = { type: typeMatch[1].trim(), path: '', url: '' };
            continue;
        }

        const pathMatch = line.match(/^\s*path:\s*(.+)\s*$/);
        if (pathMatch && current) {
            current.path = pathMatch[1].trim();
            continue;
        }

        const urlMatch = line.match(/^\s*url:\s*(.+)\s*$/);
        if (urlMatch && current) {
            current.url = urlMatch[1].trim();
            continue;
        }
    }

    if (current && current.type === 'image' && current.path) out.push({ path: current.path, url: current.url });
    return out;
}

function stripTelegramAttachmentsBlock(message: string) {
    const lines = (message || '').split(/\r?\n/);
    const out: string[] = [];
    let inBlock = false;

    for (const line of lines) {
        if (line.trim() === '[Adjuntos de Telegram]') {
            inBlock = true;
            continue;
        }
        if (inBlock) {
            if (line.startsWith('- ') || line.startsWith('  ') || line.trim() === '') {
                continue;
            } else {
                inBlock = false;
            }
        }
        if (!inBlock) out.push(line);
    }
    return out.join('\n').trim();
}

/**
 * Busca el solapamiento más largo entre el final de 'base' y el inicio de 'addition'.
 * Esta versión es más agresiva para detectar repeticiones parciales.
 */
function fuzzyMerge(base: string, addition: string): string {
    if (!base) return addition;
    if (!addition) return base;

    const b = base.trim();
    const a = addition.trim();

    // Intentar encontrar el solapamiento más largo (mínimo 6 caracteres)
    let maxOverlap = 0;
    const minOverlapSize = 6; 

    for (let i = minOverlapSize; i <= Math.min(b.length, a.length); i++) {
        const baseSuffix = b.substring(b.length - i);
        const additionPrefix = a.substring(0, i);
        
        if (baseSuffix === additionPrefix) {
            maxOverlap = i;
        }
    }

    if (maxOverlap > 0) {
        return base + addition.substring(maxOverlap);
    }

    return base + (base.endsWith('\n') ? '' : '\n\n') + addition;
}

/**
 * Deduplicador de Streaming: Asegura que nunca enviemos deltas que ya forman parte del texto acumulado.
 * Esto evita que la interfaz muestre texto duplicado cuando el modelo itera sobre herramientas.
 */
class StreamDeduplicator {
    private fullOutput = '';

    wrap(onDelta?: (delta: any) => void) {
        if (!onDelta) return undefined;
        return (delta: any) => {
            if ((delta.type === 'delta' || delta.type === 'text') && delta.delta) {
                const newText = delta.delta;
                // Si el nuevo texto ya está contenido al final de lo que llevamos, lo ignoramos
                if (this.fullOutput.endsWith(newText)) return;
                
                // Si hay un solapamiento parcial, lo limpiamos
                let cleanDelta = newText;
                for (let i = newText.length; i >= 1; i--) {
                    if (this.fullOutput.endsWith(newText.substring(0, i))) {
                        cleanDelta = newText.substring(i);
                        break;
                    }
                }

                if (cleanDelta) {
                    this.fullOutput += cleanDelta;
                    onDelta({ ...delta, delta: cleanDelta });
                }
            } else {
                onDelta(delta);
            }
        };
    }
}

function looksNonSpanishCJK(text: string) {
    if (!text) return false;
    const cjkMatches = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || [];
    const latinMatches = text.match(/[A-Za-zÁÉÍÓÚáéíóúÑñÜü]/g) || [];
    return cjkMatches.length >= 8 && cjkMatches.length > latinMatches.length * 2;
}

function enforceSpanishOutput(text: string) {
    if (!looksNonSpanishCJK(text)) return text;
    return 'Entendido 😄 ¿Qué quieres que haga ahora mismo?';
}

function sanitizeInternalArtifacts(text: string) {
    if (!text) return text;
    let out = text;
    out = out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
    out = out.replace(/#\s*Plan Mode\s*-\s*System Reminder[\s\S]*$/gi, '').trim();
    out = out.replace(/CRITICAL:\s*Plan mode ACTIVE[\s\S]*$/gi, '').trim();
    out = out.replace(/\{\s*"command"\s*:\s*"[\s\S]*?\}\s*$/gi, '').trim();
    out = out.replace(/```(?:bash|sh|shell|json)?[\s\S]*?(?:ip route|getent|awk|python3|bash -lc)[\s\S]*?```/gi, '').trim();
    return out;
}

function stableStringify(value: any): string {
    const normalize = (input: any): any => {
        if (input === null || input === undefined) return input;
        if (typeof input !== 'object') return input;
        if (Array.isArray(input)) return input.map(normalize);
        const out: Record<string, any> = {};
        for (const key of Object.keys(input).sort()) {
            out[key] = normalize(input[key]);
        }
        return out;
    };

    try {
        return JSON.stringify(normalize(value));
    } catch {
        return String(value ?? '');
    }
}

function digestStable(value: any): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function isPlainObject(value: any): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function runBeforeToolCallHook(args: {
    sessionId: string;
    source: string;
    toolName: string;
    toolArgs: any;
    allowedTools: Set<string>;
    isAudio: boolean;
}) {
    const cfg = getRuntimeGuardConfig();
    if (!cfg.hooksEnabled) {
        return { blocked: false, reason: '', adjustedArgs: args.toolArgs };
    }

    if (!args.toolName || !args.allowedTools.has(args.toolName)) {
        const reason = `Tool no permitida para este turno: ${args.toolName || 'unknown'}`;
        pushRuntimeHookEvent({ at: new Date().toISOString(), type: 'before', sessionId: args.sessionId, source: args.source, toolName: args.toolName || 'unknown', reason });
        if (cfg.strictMode) {
            runtimeHookCounters.beforeBlocked++;
            addToolRuntimeMetric('before', args.sessionId, args.source, args.toolName || 'unknown', reason);
            return { blocked: true, reason, adjustedArgs: {} };
        }
    }

    if (args.isAudio && args.toolName !== 'speak_message') {
        const reason = `En modo audio solo se permite speak_message: ${args.toolName || 'unknown'}`;
        pushRuntimeHookEvent({ at: new Date().toISOString(), type: 'before', sessionId: args.sessionId, source: args.source, toolName: args.toolName || 'unknown', reason });
        runtimeHookCounters.beforeBlocked++;
        addToolRuntimeMetric('before', args.sessionId, args.source, args.toolName || 'unknown', reason);
        return { blocked: true, reason, adjustedArgs: {} };
    }

    if (!isPlainObject(args.toolArgs)) {
        const reason = `Parámetros inválidos para ${args.toolName}. Se esperaba un objeto JSON.`;
        pushRuntimeHookEvent({ at: new Date().toISOString(), type: 'before', sessionId: args.sessionId, source: args.source, toolName: args.toolName || 'unknown', reason });
        if (cfg.strictMode) {
            runtimeHookCounters.beforeBlocked++;
            addToolRuntimeMetric('before', args.sessionId, args.source, args.toolName || 'unknown', reason);
            return { blocked: true, reason, adjustedArgs: {} };
        }
    }

    return { blocked: false, reason: '', adjustedArgs: isPlainObject(args.toolArgs) ? args.toolArgs : {} };
}

function runAfterToolCallHook(args: { sessionId: string; source: string; toolName: string; }) {
    runtimeHookCounters.afterSuccess++;
    pushRuntimeHookEvent({ at: new Date().toISOString(), type: 'after', sessionId: args.sessionId, source: args.source, toolName: args.toolName });
    addToolRuntimeMetric('after', args.sessionId, args.source, args.toolName, 'ok');
}

function runToolErrorHook(args: { sessionId: string; source: string; toolName: string; reason: string; }) {
    runtimeHookCounters.onError++;
    pushRuntimeHookEvent({ at: new Date().toISOString(), type: 'error', sessionId: args.sessionId, source: args.source, toolName: args.toolName, reason: args.reason });
    addToolRuntimeMetric('error', args.sessionId, args.source, args.toolName, args.reason);
}

function recordLoopSignal(args: { sessionId: string; source: string; toolName: string; reason: string; blocked: boolean; }) {
    if (args.blocked) runtimeHookCounters.loopBlocks++;
    else runtimeHookCounters.loopWarnings++;

    pushRuntimeHookEvent({
        at: new Date().toISOString(),
        type: args.blocked ? 'loop_block' : 'loop_warning',
        sessionId: args.sessionId,
        source: args.source,
        toolName: args.toolName,
        reason: args.reason,
    });
    addToolRuntimeMetric(args.blocked ? 'loop_block' : 'loop_warning', args.sessionId, args.source, args.toolName, args.reason);
}

const DEFAULT_LOOP_WARNING_BUCKET_SIZE = 6;
const MAX_LOOP_WARNING_KEYS = 128;

class ToolLoopGuard {
    private callSignatureCount = new Map<string, number>();
    private noProgressOutcomeCount = new Map<string, number>();
    private warningBuckets = new Map<string, number>();
    private totalToolCalls = 0;
    private consecutiveSameTool = 0;
    private lastToolName = '';
    private warningThreshold: number;
    private criticalThreshold: number;
    private globalThreshold: number;

    constructor(config?: { warningThreshold?: number; criticalThreshold?: number; globalThreshold?: number; }) {
        this.warningThreshold = config?.warningThreshold || DEFAULT_LOOP_WARNING_BUCKET_SIZE;
        this.criticalThreshold = config?.criticalThreshold || 12;
        this.globalThreshold = config?.globalThreshold || 40;
    }

    register(toolName: string, args: any, result?: string, error?: string) {
        this.totalToolCalls++;

        if (toolName === this.lastToolName) this.consecutiveSameTool++;
        else this.consecutiveSameTool = 1;
        this.lastToolName = toolName;

        const argsHash = digestStable(args);
        const callSignature = `${toolName}:${argsHash}`;
        const callCount = (this.callSignatureCount.get(callSignature) || 0) + 1;
        this.callSignatureCount.set(callSignature, callCount);

        const normalizedResult = normalizeTextForComparison((result || '').slice(0, 1000));
        const normalizedError = normalizeTextForComparison((error || '').slice(0, 1000));
        const outcomeHash = digestStable({ result: normalizedResult, error: normalizedError || null });
        const noProgressKey = `${toolName}:${argsHash}:${outcomeHash}`;
        const noProgressCount = (this.noProgressOutcomeCount.get(noProgressKey) || 0) + 1;
        this.noProgressOutcomeCount.set(noProgressKey, noProgressCount);

        if (this.callSignatureCount.size > 500) {
            const first = this.callSignatureCount.keys().next().value;
            if (first) this.callSignatureCount.delete(first);
        }
        if (this.noProgressOutcomeCount.size > 500) {
            const first = this.noProgressOutcomeCount.keys().next().value;
            if (first) this.noProgressOutcomeCount.delete(first);
        }

        const warningKey = `np:${toolName}:${argsHash}`;
        const warningBucket = Math.floor(noProgressCount / this.warningThreshold);
        const lastBucket = this.warningBuckets.get(warningKey) || 0;
        if (warningBucket > lastBucket && noProgressCount >= this.warningThreshold) {
            this.warningBuckets.set(warningKey, warningBucket);
            if (this.warningBuckets.size > MAX_LOOP_WARNING_KEYS) {
                const first = this.warningBuckets.keys().next().value;
                if (first) this.warningBuckets.delete(first);
            }
            return {
                blocked: false,
                level: 'warning',
                reason: `sin_progreso(${toolName})`,
                count: noProgressCount
            };
        }

        if (noProgressCount >= this.criticalThreshold) {
            return {
                blocked: true,
                level: 'critical',
                reason: `sin_progreso_critico(${toolName})`,
                count: noProgressCount
            };
        }

        if (this.consecutiveSameTool >= 14) {
            return {
                blocked: true,
                level: 'critical',
                reason: `misma_herramienta_en_cadena(${toolName})`,
                count: this.consecutiveSameTool
            };
        }

        if (this.totalToolCalls >= this.globalThreshold) {
            return {
                blocked: true,
                level: 'critical',
                reason: 'exceso_total_de_herramientas',
                count: this.totalToolCalls
            };
        }

        return { blocked: false, level: 'ok', reason: '', count: 0 };
    }
}


/**
 * Función principal expuesta al exterior. Implementa colas por sesión.
 */
export async function processUserMessage(
    userId: string,
    source: string,
    message: string,
    isAudio: boolean = false,
    sessionId = 'default',
    onDelta?: (delta: any) => void,
    displayMessage?: string
): Promise<string> {
    const state = getSessionState(sessionId);
    
    const normalized = normalizeTextForComparison(message);
    const messageHash = `${userId}:${normalized}`;
    const now = Date.now();

    // Limpiar expirados para no crecer indefinidamente
    for (const [key, ts] of state.processedIds.entries()) {
        if ((now - ts) > DUPLICATE_WINDOW_MS) {
            state.processedIds.delete(key);
        }
    }
    
    // Deduplicación temporal: bloquear solo duplicados inmediatos (reintentos técnicos)
    // No bloquear audios porque la transcripción puede repetir texto de forma legítima.
    const previousTs = state.processedIds.get(messageHash);
    if (!isAudio && normalized.length > 2 && previousTs && (now - previousTs) <= DUPLICATE_WINDOW_MS) {
        console.warn(`[Agent/Queue] Bloqueado duplicado inmediato (${Math.round((now - previousTs) / 1000)}s) en sesión ${sessionId}: "${normalized.substring(0, 30)}..."`);
        return "";
    }
    state.processedIds.set(messageHash, now);

    // Tamaño máximo acotado
    if (state.processedIds.size > 250) {
        const first = state.processedIds.keys().next().value;
        if (first) state.processedIds.delete(first);
    }

    // Crear promesa para este mensaje
    return new Promise((resolve, reject) => {
        state.messages.push({ text: message, displayText: displayMessage, isAudio, onDelta, userId, source, resolve, reject });

        if (!state.busy) {
            runProcessorQueue(sessionId).catch(e => console.error(`[Agent/Queue] Error fatal en cola ${sessionId}:`, e));
        } else {
            console.log(`[Agent/Queue] Sesión ${sessionId} ocupada. Mensaje encolado (Total: ${state.messages.length})`);
        }
    });
}

/**
 * Procesador de la cola de la sesión.
 */
async function runProcessorQueue(sessionId: string) {
    const state = getSessionState(sessionId);
    if (state.busy) return;
    
    state.busy = true;

    try {
        while (state.messages.length > 0) {
            // FUSIÓN DE TURNOS (OpenClaw Parity): Agrupar ráfagas de mensajes del usuario
            let burst = state.messages.splice(0, state.messages.length);
            
            // DEDUPLICACIÓN DE RÁFAGA: Eliminar mensajes idénticos consecutivos dentro de la misma ráfaga
            // (Común cuando bots reintentan envíos de audio/texto)
            burst = burst.filter((m, index, self) => 
                index === 0 || normalizeTextForComparison(m.text) !== normalizeTextForComparison(self[index - 1].text)
            );

            const combinedText = burst.map(m => m.text).join('\n---\n');
            const combinedDisplayText = burst
                .map((m) => m.displayText)
                .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                .join('\n---\n');
            const primaryMessage = burst[0];
            const isAudioBurst = burst.some(m => m.isAudio);

            console.log(`[Agent/Processor] Procesando ráfaga de ${burst.length} mensajes (filtrada) en sesión ${sessionId}`);
            
            const deduplicator = new StreamDeduplicator();
            try {
                // Combinar todos los callbacks onDelta del burst con deduplicación de streaming
                const combinedOnDelta = deduplicator.wrap((delta: any) => {
                    for (const m of burst) {
                        if (m.onDelta) m.onDelta(delta);
                    }
                });


                const response = await _executeAgentLogic(
                    primaryMessage.userId, 
                    primaryMessage.source, 
                    combinedText, 
                    isAudioBurst, 
                    sessionId, 
                    combinedOnDelta,
                    combinedDisplayText || undefined
                );

                // Resolver la primera promesa con la respuesta, y las demás con vacío
                // Esto evita que bots como Telegram respondan N veces a la misma ráfaga
                burst[0].resolve(response);
                for (let i = 1; i < burst.length; i++) {
                    burst[i].resolve("");
                }
            } catch (err: any) {
                console.error(`[Agent/Processor] Error en sesión ${sessionId}:`, err);
                for (const m of burst) m.reject(err);
            }
        }
    } finally {
        state.busy = false;
    }
}

/**
 * La lógica central del agente (anteriormente processUserMessage).
 */
async function _executeAgentLogic(
    userId: string,
    source: string,
    message: string,
    isAudio: boolean,
    sessionId: string,
    onDelta?: (delta: any) => void,
    displayMessage?: string
): Promise<string> {
    const agentName = getSetting('agent_name');
    let setupDone = getSetting('agent_setup_done');
    let setupStep = parseInt(getSetting('agent_setup_step') || '0', 10);

    if (!getSetting('agent_personality') || !getSetting('user_name')) {
        setupDone = '0';
        if (setupStep === 5) {
            setupStep = 0;
            setSetting('agent_setup_step', '0');
        }
    }

    if (setupDone !== '1') {
        const messageTrim = message.trim();
        if (setupStep === 0) {
            setSetting('agent_setup_step', '1');
            return "\u00a1Hola! Soy un nuevo agente de Inteligencia Artificial reci\u00e9n encendido en tu m\u00e1quina. Para calibrar mi sistema, te har\u00e9 4 preguntas r\u00e1pidas.\n\nPara empezar: **\u00bfQu\u00e9 nombre te gustar\u00eda ponerme a m\u00ed (tu agente)?**";
        } else if (setupStep === 1) {
            setSetting('agent_name', messageTrim);
            setSetting('agent_setup_step', '2');
            return `\u00a1Me gusta el nombre ${messageTrim}! Segunda pregunta: **\u00bfC\u00f3mo te llamas t\u00fa (mi usuario)?**`;
        } else if (setupStep === 2) {
            setSetting('user_name', messageTrim);
            setSetting('agent_setup_step', '3');
            return `\u00a1Encantado de conocerte, ${messageTrim}! Tercera pregunta: **\u00bfQu\u00e9 car\u00e1cter o personalidad quieres que tenga al responderte?**`;
        } else if (setupStep === 3) {
            setSetting('agent_personality', messageTrim);
            setSetting('agent_setup_step', '4');
            return "\u00a1Anotado de por vida! Por \u00faltimo: **\u00bfCu\u00e1l ser\u00e1 mi funci\u00f3n principal?**";
        } else if (setupStep === 4) {
            setSetting('agent_function', messageTrim);
            setSetting('agent_setup_step', '5');
            setSetting('agent_setup_done', '1');
            return "\u00a1Todo listo! \u00bfEn qu\u00e9 te ayudo?";
        }
    }

    const imageAttachments = extractImageAttachmentsFromText(message);
    const cleanUserText = stripTelegramAttachmentsBlock(message) || message;

    const nameToUse = getSetting('agent_name') || 'Asistente';
    const userNameToUse = getSetting('user_name') || 'Usuario';
    const personalityToUse = getSetting('agent_personality') || 'Eficiente, natural y directo.';
    const functionToUse = getSetting('agent_function') || 'Ayudar en tareas generales.';

    const provider = getSetting('model_provider') || process.env.LLM_PROVIDER || 'openrouter';
    let model = getSetting('model_name') || process.env.MODEL_NAME || (provider === 'openai' ? 'gpt-4o-mini' : 'openrouter/free');

    // --- System Prompt Builder ---
    // Kevin's rule: prominence for voice notes
    const voiceContext = isAudio ? "\n!!! [IMPORTANTE: EL USUARIO TE HA ENVIADO UNA NOTA DE VOZ] !!!\nDebes responder SIEMPRE activando la herramienta 'speak_message'. No respondas solo con texto." : "Responde por texto estándar.";

    const systemPromptTemplate = `Eres un asistente de IA llamado {agent_name}. Tu usuario es {user_name}.\nTu personalidad: {agent_personality}\nTu misión: {agent_function}\n\nHabla siempre en castellano. Eres capaz de recordar contexto.\n\nDIRECTRICES DE FORMATO:\n{voice_context}\n\nUsa las herramientas autónomamente. No pidas permiso si tienes una herramienta que soluciona la petición del usuario.`;
    
    let fullSystemPrompt = systemPromptTemplate
        .replace('{agent_name}', nameToUse)
        .replace('{user_name}', userNameToUse)
        .replace('{agent_personality}', personalityToUse)
        .replace('{agent_function}', functionToUse)
        .replace('{voice_context}', voiceContext);

    fullSystemPrompt += getMemoryPrompt();

    // Bootstrap
    const bootstrapFiles = ['package.json', 'README.md', 'src/index.ts'];
    let bootstrapContext = '';
    for (const file of bootstrapFiles) {
        try {
            const filePath = join(process.cwd(), file);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                bootstrapContext += `\n[ARCHIVO: ${file}]:\n${content}\n`;
            }
        } catch (e) {}
    }
    if (bootstrapContext) fullSystemPrompt += `\n\nBOOTSTRAP CONTEXT:\n${bootstrapContext}`;

    const extraSkills = getEnabledSkillsContext();
    if (extraSkills) fullSystemPrompt += `\n\nHABILIDADES ACTIVAS:\n${extraSkills}`;

    // Historial LIMPIO: No incluye el mensaje actual porque aún no lo hemos guardado en DB
    const dbMessages = Array.from(getRecentMessages(12, sessionId));

    let currentUserMsg: any = (imageAttachments.length > 0 && provider !== 'anthropic') 
        ? { role: 'user', content: [{ type: 'text', text: cleanUserText }, ...imageAttachments.map(img => ({ type: 'image_url', image_url: { url: img.url || `data:${guessMimeFromPath(img.path)};base64,${fs.readFileSync(img.path).toString('base64')}` } }))] }
        : { role: 'user', content: cleanUserText };

    const thread: any[] = [
        { role: 'system', content: fullSystemPrompt },
        ...dbMessages,
        currentUserMsg
    ];

    // Prominencia MÁXIMA para audio: inyectamos recordatorio al final del hilo
    if (isAudio) {
        thread.push({ 
            role: 'system', 
            content: `!!! [ATENCIÓN: EL USUARIO ACABA DE ENVIAR UNA NOTA DE VOZ] !!!\nDebes responder exclusivamente usando la herramienta 'speak_message'. No incluyas texto fuera de esa herramienta.` 
        });
    }

    console.log(`[Agent Logic] Procesando: isAudio=${isAudio}, textLength=${cleanUserText.length}, historySize=${dbMessages.length}`);
    if (getSetting('debug_llm') === '1') {
        process.stdout.write(`[Debug LLM] Hilo enviado (${thread.length} msgs): ` + JSON.stringify(thread.map(m => ({r: m.role, len: (m.content?.length || 0)}))) + '\n');
    }

    let currentIteration = 0;
    let fullAccumulatedText = '';
    const runtimeGuardConfig = getRuntimeGuardConfig();
    const toolLoopGuard = new ToolLoopGuard({
        warningThreshold: runtimeGuardConfig.warningThreshold,
        criticalThreshold: runtimeGuardConfig.criticalThreshold,
        globalThreshold: runtimeGuardConfig.globalThreshold,
    });
    let nonVoiceToolHitsInAudio = 0;
    let beforeToolBlockedHits = 0;
    const userMessageForDb = (isAudio && displayMessage && displayMessage.trim())
        ? displayMessage.trim()
        : (stripTelegramAttachmentsBlock(message) || message);
    const persistTurn = (assistantText: string) => {
        addMessage('user', userMessageForDb, sessionId);
        addMessage('assistant', assistantText, sessionId);
        return assistantText;
    };

    while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;
        try {
            if (onDelta) {
                onDelta({ type: 'status', stage: 'thinking', message: 'Analizando tu solicitud...' });
            }
            const mcpTools = getMCPTools();
            let tools = [...getActiveTools(), ...mcpTools];

            const needsVoice = isAudio || cleanUserText.toLowerCase().includes('háblame') || cleanUserText.toLowerCase().includes('audio') || cleanUserText.toLowerCase().includes('voz');
            if (!needsVoice) {
                tools = tools.filter(t => (t.function?.name || t.name) !== 'speak_message');
            }

            const allowedToolNames = new Set(
                tools
                    .map((t: any) => t?.function?.name || t?.name)
                    .filter((n: any) => typeof n === 'string' && n.trim().length > 0)
            );

            const responseMessage = await chatCompletion(model, provider, thread, tools, undefined, onDelta);
            thread.push(responseMessage);

            if ('tool_calls' in responseMessage && (responseMessage as any).tool_calls?.length > 0) {
                for (const toolCall of (responseMessage as any).tool_calls) {
                    const toolName = toolCall?.function?.name || '';
                    const rawArgs = toolCall?.function?.arguments || '{}';
                    const toolCallId = toolCall?.id || `call_local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    const isMCP = mcpTools.some(t => (t.function?.name || t.name) === toolName);
                    let parsedArgs: any = {};
                    try {
                        parsedArgs = JSON.parse(rawArgs || '{}');
                    } catch {
                        parsedArgs = {};
                    }

                    const before = runBeforeToolCallHook({
                        sessionId,
                        source,
                        toolName,
                        toolArgs: parsedArgs,
                        allowedTools: allowedToolNames,
                        isAudio,
                    });
                    if (before.blocked) {
                        beforeToolBlockedHits++;
                        if (isAudio && toolName !== 'speak_message') {
                            nonVoiceToolHitsInAudio++;
                        }
                        console.warn(`[Agent/BeforeTool] ${before.reason} (hit=${beforeToolBlockedHits})`);
                        thread.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: JSON.stringify({ status: 'error', message: before.reason })
                        });

                        if (isAudio && nonVoiceToolHitsInAudio >= 2) {
                            return persistTurn('No he podido generar la nota de voz correctamente. Intenta reenviar el audio.');
                        }

                        if (beforeToolBlockedHits >= 2) {
                            const forcedReply = isAudio
                                ? 'No he podido completar la respuesta en voz por un conflicto interno de herramientas. Reenvía la nota.'
                                : 'No he podido ejecutar herramientas de forma segura en este turno. Reformula la petición y lo reintento.';
                            return persistTurn(forcedReply);
                        }
                        continue;
                    }

                    const finalArgs = before.adjustedArgs;
                    let result = '';
                    try {
                        if (onDelta) {
                            onDelta({ type: 'status', stage: 'tool', message: `Ejecutando herramienta: ${toolName}` });
                        }
                        if (isMCP) {
                            result = await executeMCPTool(toolName, finalArgs);
                        } else {
                            const normalizedToolCall = {
                                ...toolCall,
                                function: {
                                    ...(toolCall?.function || {}),
                                    name: toolName,
                                    arguments: JSON.stringify(finalArgs || {})
                                }
                            };
                            result = await executeToolCall(normalizedToolCall);
                        }
                        runAfterToolCallHook({ sessionId, source, toolName });
                    } catch (toolError: any) {
                        const reason = toolError?.message || String(toolError);
                        runToolErrorHook({ sessionId, source, toolName, reason });
                        thread.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: JSON.stringify({ status: 'error', message: reason })
                        });
                        continue;
                    }
                    thread.push({ role: 'tool', tool_call_id: toolCallId, content: result || 'success' });

                    const loopCheck = toolLoopGuard.register(toolName, finalArgs, String(result || ''));
                    if (!loopCheck.blocked && loopCheck.level === 'warning') {
                        console.warn(`[Agent/LoopGuard] Warning: ${loopCheck.reason} (count=${loopCheck.count})`);
                        recordLoopSignal({ sessionId, source, toolName, reason: loopCheck.reason, blocked: false });
                    }
                    if (loopCheck.blocked) {
                        console.error(`[Agent/LoopGuard] Bucle de herramientas detectado (${loopCheck.reason}).`);
                        recordLoopSignal({ sessionId, source, toolName, reason: loopCheck.reason, blocked: true });
                        if (fullAccumulatedText && !isAudio) {
                            return persistTurn(sanitizeInternalArtifacts(enforceSpanishOutput(fullAccumulatedText)));
                        }
                        const forcedReply = isAudio
                            ? 'No he podido completar la respuesta en voz por un bucle interno. Reintenta con una nota más corta.'
                            : 'He detectado un bucle interno ejecutando herramientas. Reformula tu petición y lo intento de nuevo.';
                        return persistTurn(sanitizeInternalArtifacts(forcedReply));
                    }

                    if (
                        isAudio &&
                        toolName === 'speak_message'
                    ) {
                        const finalAudioReply = typeof result === 'string' && result.trim()
                            ? result
                            : 'No he podido generar la nota de voz.';
                        return persistTurn(sanitizeInternalArtifacts(finalAudioReply));
                    }
                }
                continue;
            }

            if (responseMessage.content) {
                const newContent = responseMessage.content.trim();
                const merged = fuzzyMerge(fullAccumulatedText, newContent);

                if (getSetting('debug_llm') === '1' && merged.length < fullAccumulatedText.length + newContent.length) {
                    console.log(`[Fuzzy Merger] Detectado solapamiento. Recortado de ${newContent.length} a ${merged.length - fullAccumulatedText.length} chars.`);
                }

                fullAccumulatedText = merged;
            }

            if (fullAccumulatedText) {
                // Registro ATÓMICO del turno en la base de datos al finalizar con éxito
                if (onDelta) {
                    onDelta({ type: 'status', stage: 'finalizing', message: 'Preparando respuesta final...' });
                }
                return persistTurn(sanitizeInternalArtifacts(enforceSpanishOutput(fullAccumulatedText)));
            }
            return "Respuesta vacía.";
        } catch (error: any) {
            console.error('[Agent Logic] Error:', error);
            return sanitizeInternalArtifacts(`Error: ${error.message}`);
        }
    }
    return sanitizeInternalArtifacts("Límite de iteraciones alcanzado.");
}

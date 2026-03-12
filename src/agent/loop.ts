import { chatCompletion, normalizeTextForComparison } from './llm.js';
import { getSetting, setSetting, getRecentMessages, addMessage } from '../db/index.js';
import { getMemoryPrompt } from './memory.js';
import { getActiveTools, executeToolCall } from './tools.js';
import { getMCPTools, executeMCPTool } from '../mcp/client.js';
import fs from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';

const MAX_ITERATIONS = 30;

// --- ESTADO GLOBAL DE COLAS (OpenClaw Parity) ---
const sessionQueues: Record<string, {
    busy: boolean;
    messages: { 
        text: string; 
        isAudio: boolean; 
        onDelta?: (delta: any) => void; 
        userId: string; 
        source: string; 
        resolve: (val: string) => void; 
        reject: (err: any) => void 
    }[];
    processedIds: Set<string>;
}> = {};

function getSessionState(sessionId: string) {
    if (!sessionQueues[sessionId]) {
        sessionQueues[sessionId] = {
            busy: false,
            messages: [],
            processedIds: new Set()
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
 * Función principal expuesta al exterior. Implementa colas por sesión.
 */
export async function processUserMessage(userId: string, source: string, message: string, isAudio: boolean = false, sessionId = 'default', onDelta?: (delta: any) => void): Promise<string> {
    const state = getSessionState(sessionId);
    
    const normalized = normalizeTextForComparison(message);
    const messageHash = `${userId}:${normalized}`;
    
    // Deduplicación estricta para todos (incluyendo audio para evitar duplicados por reintentos de bots)
    if (normalized.length > 2 && state.processedIds.has(messageHash)) {
        console.warn(`[Agent/Queue] Bloqueado mensaje duplicado en sesión ${sessionId}: "${normalized.substring(0, 30)}..."`);
        return ""; // Ignorar duplicado
    }
    state.processedIds.add(messageHash);
    // Limpieza periódica de IDs procesados para evitar fuga de memoria
    if (state.processedIds.size > 100) {
        const first = state.processedIds.values().next().value;
        if (first) state.processedIds.delete(first);
    }

    // Crear promesa para este mensaje
    return new Promise((resolve, reject) => {
        state.messages.push({ text: message, isAudio, onDelta, userId, source, resolve, reject });

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
            const burst = state.messages.splice(0, state.messages.length);
            const combinedText = burst.map(m => m.text).join('\n---\n');
            const primaryMessage = burst[0];
            const isAudioBurst = burst.some(m => m.isAudio);

            console.log(`[Agent/Processor] Procesando ráfaga de ${burst.length} mensajes en sesión ${sessionId}`);
            
            try {
                // Combinar todos los callbacks onDelta del burst
                const combinedOnDelta = (delta: any) => {
                    for (const m of burst) {
                        if (m.onDelta) m.onDelta(delta);
                    }
                };

                const response = await _executeAgentLogic(
                    primaryMessage.userId, 
                    primaryMessage.source, 
                    combinedText, 
                    isAudioBurst, 
                    sessionId, 
                    combinedOnDelta
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
async function _executeAgentLogic(userId: string, source: string, message: string, isAudio: boolean, sessionId: string, onDelta?: (delta: any) => void): Promise<string> {
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

    console.log(`[Agent Logic] Procesando: isAudio=${isAudio}, textLength=${cleanUserText.length}, historySize=${dbMessages.length}`);
    if (getSetting('debug_llm') === '1') {
        process.stdout.write(`[Debug LLM] Hilo enviado (${thread.length} msgs): ` + JSON.stringify(thread.map(m => ({r: m.role, len: (m.content?.length || 0)}))) + '\n');
    }

    let currentIteration = 0;
    let fullAccumulatedText = '';

    while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;
        try {
            const mcpTools = getMCPTools();
            let tools = [...getActiveTools(), ...mcpTools];

            const needsVoice = isAudio || cleanUserText.toLowerCase().includes('háblame') || cleanUserText.toLowerCase().includes('audio') || cleanUserText.toLowerCase().includes('voz');
            if (!needsVoice) {
                tools = tools.filter(t => (t.function?.name || t.name) !== 'speak_message');
            }

            const responseMessage = await chatCompletion(model, provider, thread, tools, undefined, onDelta);
            thread.push(responseMessage);

            if (responseMessage.content) {
                let newContent = responseMessage.content.trim();
                if (fullAccumulatedText && newContent.startsWith(fullAccumulatedText.substring(0, 50))) {
                    newContent = newContent.substring(fullAccumulatedText.length).trim();
                }
                if (newContent) {
                    fullAccumulatedText += (fullAccumulatedText ? '\n\n' : '') + newContent;
                }
            }

            if ('tool_calls' in responseMessage && (responseMessage as any).tool_calls?.length > 0) {
                for (const toolCall of (responseMessage as any).tool_calls) {
                    const isMCP = mcpTools.some(t => (t.function?.name || t.name) === toolCall.function.name);
                    const result = isMCP 
                        ? await executeMCPTool(toolCall.function.name, JSON.parse(toolCall.function.arguments))
                        : await executeToolCall(toolCall);
                    thread.push({ role: 'tool', tool_call_id: toolCall.id, content: result || 'success' });
                }
                continue;
            }

            if (fullAccumulatedText) {
                // Registro ATÓMICO del turno en la base de datos al finalizar con éxito
                const cleanUserTextForDb = stripTelegramAttachmentsBlock(message) || message;
                addMessage('user', cleanUserTextForDb, sessionId);
                addMessage('assistant', fullAccumulatedText, sessionId);
                
                return fullAccumulatedText;
            }
            return "Respuesta vacía.";
        } catch (error: any) {
            console.error('[Agent Logic] Error:', error);
            return `Error: ${error.message}`;
        }
    }
    return "Límite de iteraciones alcanzado.";
}

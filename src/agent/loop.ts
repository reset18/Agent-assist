import { chatCompletion } from './llm.js';
import { getSetting, setSetting, getRecentMessages, addMessage } from '../db/index.js';
import { getMemoryPrompt } from './memory.js';
import { getActiveTools, executeToolCall } from './tools.js';
import { getMCPTools, executeMCPTool } from '../mcp/client.js';
import fs from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';

const MAX_ITERATIONS = 15;

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
    // Parsea el bloque que inyecta el bot de Telegram:
    // [Adjuntos de Telegram]
    // - type: image
    //   path: /abs/path
    //   url: https://...
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
            // push previous
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
            // el bloque termina cuando acaban las líneas con '-' o '  key:' o vacías
            if (line.startsWith('- ') || line.startsWith('  ') || line.trim() === '') {
                continue;
            } else {
                // línea que no pertenece al bloque: salimos
                inBlock = false;
            }
        }
        if (!inBlock) out.push(line);
    }

    return out.join('\n').trim();
}

export async function processUserMessage(userId: string, source: string, message: string, isAudio: boolean = false, sessionId = 'default'): Promise<string> {
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
        if (setupStep === 0) {
            setSetting('agent_setup_step', '1');
            return "\u00a1Hola! Soy un nuevo agente de Inteligencia Artificial reci\u00e9n encendido en tu m\u00e1quina. Para calibrar mi sistema, te har\u00e9 4 preguntas r\u00e1pidas.\n\nPara empezar: **\u00bfQu\u00e9 nombre te gustar\u00eda ponerme a m\u00ed (tu agente)?**";
        } else if (setupStep === 1) {
            setSetting('agent_name', message.trim());
            setSetting('agent_setup_step', '2');
            return `\u00a1Me gusta el nombre ${message.trim()}! Segunda pregunta: **\u00bfC\u00f3mo te llamas t\u00fa (mi usuario)?**`;
        } else if (setupStep === 2) {
            setSetting('user_name', message.trim());
            setSetting('agent_setup_step', '3');
            return `\u00a1Encantado de conocerte, ${message.trim()}! Tercera pregunta: **\u00bfQu\u00e9 car\u00e1cter o personalidad quieres que tenga al responderte?** (Ej: "Serio y corto", "Sarc\u00e1stico y divertido", "Did\u00e1ctico y amigable", etc)`;
        } else if (setupStep === 3) {
            setSetting('agent_personality', message.trim());
            setSetting('agent_setup_step', '4');
            return "\u00a1Anotado de por vida! Por \u00faltimo: **\u00bfCu\u00e1l ser\u00e1 mi funci\u00f3n principal o en qu\u00e9 rol tecnol\u00f3gico me voy a enfocar contigo de ahora en adelante?**";
        } else if (setupStep === 4) {
            setSetting('agent_function', message.trim());
            setSetting('agent_setup_step', '5');
            setSetting('agent_setup_done', '1');
            return "\u00a1Todo listo! He guardado todas tus directrices en mi memoria base. A partir de ahora mi comportamiento ser\u00e1 exactamente el que has deseado. \u00bfEn qu\u00e9 te ayudo por primera vez?";
        }
    }

    // --- Adjuntos (multimodal) ---
    // Si el mensaje contiene un bloque de adjuntos de Telegram con una imagen descargada localmente,
    // intentamos transformar el mensaje de usuario a formato multimodal OpenAI-compatible:
    // { role: 'user', content: [ {type:'text', text:'...'}, {type:'image_url', image_url:{url:'data:...base64'}} ] }
    const imageAttachments = extractImageAttachmentsFromText(message);
    const cleanUserText = stripTelegramAttachmentsBlock(message) || message;

    addMessage('user', cleanUserText, sessionId);

    const systemPromptTemplate = `Eres un asistente de IA interactuando con tu usuario principal. Sigue estrictamente esta configuraci\u00f3n persistente de perfil:\nTu nombre es: {agent_name}\nEl nombre del usuario que te habla es: {user_name}\nTu personalidad y tono de respuesta en absoluto DEBE ser: {agent_personality}\nTu misi\u00f3n principal o funci\u00f3n asignada es: {agent_function}\n\nSe te han otorgado herramientas para interactuar con sistemas locales de manera aut\u00f3noma. Habla siempre en castellano. Eres capaz de recordar contexto de mensajes pasados. Adapta toda respuesta al tono de tu personalidad y c\u00e9ntrate en tu misi\u00f3n.`;

    const nameToUse = getSetting('agent_name') || 'Asistente';
    const userNameToUse = getSetting('user_name') || 'Usuario';
    const personalityToUse = getSetting('agent_personality') || 'Eficiente, natural y directo.';
    const functionToUse = getSetting('agent_function') || 'Ayudar en tareas generales.';

    const provider = getSetting('model_provider') || process.env.LLM_PROVIDER || 'openrouter';
    let model = getSetting('model_name') || process.env.MODEL_NAME || (provider === 'openai' ? 'gpt-4o-mini' : 'openrouter/free');

    // Mapeo forzado para mayor robustez si el instalador us\u00f3 nombres antiguos o gen\u00e9ricos
    if (provider === 'openai' && (model.includes('openrouter') || model === '' || model === 'gpt-5.2' || model === 'n/a')) {
        model = 'gpt-4o-mini';
    } else if (provider === 'groq' && (model.includes('openrouter') || model === '' || model === 'n/a')) {
        model = 'llama-3.3-70b-versatile';
    } else if (provider === 'anthropic' && (model.includes('openrouter') || model === '' || model === 'n/a')) {
        model = 'claude-3-5-sonnet-20241022';
    } else if (provider === 'google' && (model.includes('openrouter') || model === '' || model === 'n/a')) {
        model = 'gemini-1.5-flash';
    }

    if (provider !== 'openrouter' && model.includes('/')) {
        model = model.split('/').pop() || model;
    }

    console.log(`[Core] Configuraci\u00f3n LLM detectada -> Proveedor: ${provider}, Modelo: ${model}, Origen: ${getSetting('model_provider') ? 'Base de Datos' : 'Variables de Entorno (.env)'}`);

    let fullSystemPrompt = systemPromptTemplate
        .replace('{agent_name}', nameToUse)
        .replace('{user_name}', userNameToUse)
        .replace('{agent_personality}', personalityToUse)
        .replace('{agent_function}', functionToUse);

    // Inyectar contexto de Memoria Avanzada (Fase 8)
    fullSystemPrompt += getMemoryPrompt();

    // Instrucciones din\u00e1micas para el uso de VOZ y Hosting
    const voiceContext = isAudio
        ? "EL USUARIO TE HA ENVIADO UNA NOTA DE VOZ. Debes responderle usando la herramienta 'speak_message'."
        : "EL USUARIO TE HA ESCRITO POR TEXTO. Responde \u00daNICAMENTE por texto, a menos que te pida expl\u00edcitamente un audio.";

    fullSystemPrompt += `\n\nDIRECTRICES CR\u00cdTICAS:\n1. USO DE VOZ (speak_message):\n${voiceContext}\n- Si el usuario te pide que hables pero la herramienta est\u00e1 desactivada, DEBES usar 'toggle_skill(skillId: "voice", enabled: true)' para activarla t\u00fa mismo antes de hablar.\n- IMPORTANTE: Si al intentar hablar notas que falta una configuraci\u00f3n cr\u00edtica (como la API Key de ElevenLabs), DEBES informar al usuario y ped\u00edrsela amablemente para poder completar la configuraci\u00f3n.\n\n2. USO DE HERRAMIENTAS ACTIVAS:\n- NUNCA respondas que no puedes hacer algo sin verificar primero el listado expl\u00edcito de funciones que se te ha entregado en este turno.\n- MEMORIA A LARGO PLAZO: Si el usuario te indica un dato importante, te pide recordar un hecho, o establece una regla que debe aplicar en el futuro, SIEMPRE usa OBLIGATORIAMENTE la herramienta 'update_memory' para asegurar que lo recuerdas. Las cosas no se guardan solas.\n- CONFIGURACI\u00d3N DEL SISTEMA: Si el usuario te dicta o pide guardar una API Key (ej. de OpenAI, Anthropic, ElevenLabs, etc.) o te pide cambiar un proveedor, DEBES usar OBLIGATORIAMENTE la herramienta 'update_setting' para guardar instant\u00e1neamente la clave en su base de datos en vez de intentar usar scripts de Bash locales.\n- AN\u00c1LISIS DE C\u00d3DIGO LOCAL: Usa bash para 'grep', lectura r\u00e1pida, o scripting en python/node.\n- ESCRITURA: Para escribir c\u00f3digo que te pida el usuario, USA UNICAMENTE 'write_file_local' indicando TODA la ruta absoluta correcta.\n\n3. HOSTING DE PROYECTOS WEB:\n- Si el usuario te pide crear una p\u00e1gina web o aplicaci\u00f3n frontend, DEBES usar la herramienta 'write_file_local' o 'run_shell_local' para crear los archivos en la ruta: 'src/web/public/sites/[nombre-del-proyecto]/'.\n- IMPORTANTE: No uses rutas relativas vagas, usa la ruta completa desde la ra\u00edz del proyecto si es necesario, o asume que est\u00e1s en la ra\u00edz.\n- Una vez creados, DEBES proporcionar al usuario el enlace para visualizarla: 'http://localhost:3005/sites/[nombre-del-proyecto]/index.html'.\n- NO te limites a pasar el c\u00f3digo, cr\u00e9alo f\u00edsicamente en esa ruta para que sea accesible.\n\n4. AUTONOM\u00cdA Y AUTO-APRENDIZAJE:\n- Eres un agente autodidacta. Tu objetivo es resolver problemas de forma independiente.\n- EVITA darle comandos al usuario para que los ejecute. Tu objetivo es resolverlo todo t\u00fa mismo.\n- Si te falta una herramienta para una tarea compleja (ej: auditor\u00eda de puertos, an\u00e1lisis de certificados), crea los archivos necesarios y usa 'package_skill' para autoinstalarte esa capacidad.\n- TAREAS MULTI-AGENTE (Fase 13): Si el usuario te pide investigar, resumir o procesar m\u00faltiples cosas complejas o diversas a la vez, DEBES usar la herramienta 'delegate_tasks' para repartir el trabajo entre tus agentes de relevo en paralelo y as\u00ed ahorrar tiempo.\n- Reflexiona sobre tus errores (Post-mortem) y ajusta tu l\u00f3gica en el siguiente paso.\n- Usa 'list_dir_local' y 'read_file_local' proactivamente para entender tu entorno si es necesario.`;

    const extraSkills = getEnabledSkillsContext();
    if (extraSkills) {
        fullSystemPrompt += `\n\nAdicionalmente, el usuario ha habilitado directrices MCP (Machine Control Protocol / Habilidades) en tu n\u00facleo. Debes incorporar este conocimiento profundamente en tu metodolog\u00eda a partir de ahora:\n${extraSkills}`;
    }

    let currentIteration = 0;
    const dbMessages = Array.from(getRecentMessages(10, sessionId));

    // Construir el mensaje actual (puede ser multimodal)
    let currentUserMsg: any;
    if (imageAttachments.length > 0 && provider !== 'anthropic') {
        // Para OpenAI-compatible providers
        const parts: any[] = [];
        parts.push({ type: 'text', text: cleanUserText || 'Analiza la imagen adjunta.' });

        for (const img of imageAttachments) {
            try {
                if (img.url && img.url.startsWith('http')) {
                    // Preferir URL pública si existe
                    parts.push({ type: 'image_url', image_url: { url: img.url } });
                } else if (img.path && isProbablyLocalFilePath(img.path) && fs.existsSync(img.path)) {
                    const buf = fs.readFileSync(img.path);
                    const mime = guessMimeFromPath(img.path);
                    const b64 = buf.toString('base64');
                    parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
                }
            } catch (e) {
                // Si falla, omitimos esa imagen
            }
        }

        currentUserMsg = { role: 'user', content: parts };
    } else {
        currentUserMsg = { role: 'user', content: cleanUserText };
    }

    const thread: any[] = [
        { role: 'system', content: fullSystemPrompt },
        ...dbMessages,
        currentUserMsg
    ];

    while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;

        try {
            const mcpTools = getMCPTools();
            let tools = [...getActiveTools(), ...mcpTools];

            const needsVoice = isAudio || cleanUserText.toLowerCase().includes('h\u00e1blame') || cleanUserText.toLowerCase().includes('audio') || cleanUserText.toLowerCase().includes('voz');
            if (!needsVoice) {
                tools = tools.filter(t => (t.function?.name || t.name) !== 'speak_message');
            }

            const responseMessage = await chatCompletion(model, provider, thread, tools);
            thread.push(responseMessage);

            if ('tool_calls' in responseMessage && (responseMessage as any).tool_calls && (responseMessage as any).tool_calls.length > 0) {
                const msg = responseMessage as any;
                console.log(`[Agent] Se invocan ${msg.tool_calls.length} herramientas...`);
                for (const toolCall of msg.tool_calls) {
                    if (!toolCall || !toolCall.function || !toolCall.function.name) {
                        console.warn('[Agent] toolCall malformado, omitiendo:', JSON.stringify(toolCall));
                        thread.push({
                            role: 'tool',
                            tool_call_id: toolCall?.id || 'unknown',
                            content: 'Error: tool call malformado'
                        });
                        continue;
                    }
                    let functionResult;
                    const isMCPTool = mcpTools.some(t => (t.function?.name || t.name) === toolCall.function.name);
                    if (isMCPTool) {
                        functionResult = await executeMCPTool(toolCall.function.name, JSON.parse(toolCall.function.arguments || '{}'));
                    } else {
                        functionResult = await executeToolCall(toolCall);
                    }
                    thread.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: functionResult || 'success'
                    });
                }
                continue;
            }

            if (responseMessage.content) {
                addMessage('assistant', responseMessage.content, sessionId);
                return responseMessage.content;
            }
            return "Lo siento, la respuesta generada estaba vac\u00eda.";
        } catch (error: any) {
            console.error('[Agent Loop] Error interno:', error);
            return `Lo siento, ocurri\u00f3 un error interno consultando el modelo (${error.message || 'Desconocido'}). Revisa tu API key y tu conexi\u00f3n.`;
        }
    }
    return "He alcanzado el l\u00edmite de operaciones mentales seguidas. Por favor, int\u00e9ntalo de nuevo o di algo diferente.";
}

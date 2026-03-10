import { chatCompletion } from './llm.js';
import { getSetting, setSetting, getRecentMessages, addMessage } from '../db/index.js';
import { getMemoryPrompt } from './memory.js';
import { getActiveTools, executeToolCall } from './tools.js';
import { getMCPTools, executeMCPTool } from '../mcp/client.js';
import fs from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';

const MAX_ITERATIONS = 5;

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
            skillsContext += `\n[Variables de Configuración Externas del Usuario]:\n`;
            if (gogSecret) skillsContext += `- Ruta de credenciales Google Cloud (client_secret.json): ${gogSecret}\n`;
            if (gogEmail) skillsContext += `- Email de Google Cloud a vincular: ${gogEmail}\n`;
        }

        return skillsContext;
    } catch (e) {
        return '';
    }
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
            return "¡Hola! Soy un nuevo agente de Inteligencia Artificial recién encendido en tu máquina. Para calibrar mi sistema, te haré 4 preguntas rápidas.\n\nPara empezar: **¿Qué nombre te gustaría ponerme a mí (tu agente)?**";
        } else if (setupStep === 1) {
            setSetting('agent_name', message.trim());
            setSetting('agent_setup_step', '2');
            return `¡Me gusta el nombre ${message.trim()}! Segunda pregunta: **¿Cómo te llamas tú (mi usuario)?**`;
        } else if (setupStep === 2) {
            setSetting('user_name', message.trim());
            setSetting('agent_setup_step', '3');
            return `¡Encantado de conocerte, ${message.trim()}! Tercera pregunta: **¿Qué carácter o personalidad quieres que tenga al responderte?** (Ej: "Serio y corto", "Sarcástico y divertido", "Didáctico y amigable", etc)`;
        } else if (setupStep === 3) {
            setSetting('agent_personality', message.trim());
            setSetting('agent_setup_step', '4');
            return "¡Anotado de por vida! Por último: **¿Cuál será mi función principal o en qué rol tecnológico me voy a enfocar contigo de ahora en adelante?**";
        } else if (setupStep === 4) {
            setSetting('agent_function', message.trim());
            setSetting('agent_setup_step', '5');
            setSetting('agent_setup_done', '1');
            return "¡Todo listo! He guardado todas tus directrices en mi memoria base. A partir de ahora mi comportamiento será exactamente el que has deseado. ¿En qué te ayudo por primera vez?";
        }
    }

    addMessage('user', message, sessionId);

    const systemPromptTemplate = `Eres un asistente de IA interactuando con tu usuario principal. Sigue estrictamente esta configuración persistente de perfil:
Tu nombre es: {agent_name}
El nombre del usuario que te habla es: {user_name}
Tu personalidad y tono de respuesta en absoluto DEBE ser: {agent_personality}
Tu misión principal o función asignada es: {agent_function}

Se te han otorgado herramientas para interactuar con sistemas locales de manera autónoma. Habla siempre en castellano. Eres capaz de recordar contexto de mensajes pasados. Adapta toda respuesta al tono de tu personalidad y céntrate en tu misión.`;

    const nameToUse = getSetting('agent_name') || 'Asistente';
    const userNameToUse = getSetting('user_name') || 'Usuario';
    const personalityToUse = getSetting('agent_personality') || 'Eficiente, natural y directo.';
    const functionToUse = getSetting('agent_function') || 'Ayudar en tareas generales.';

    const provider = getSetting('model_provider') || process.env.LLM_PROVIDER || 'openrouter';
    let model = getSetting('model_name') || process.env.MODEL_NAME || (provider === 'openai' ? 'gpt-4o-mini' : 'openrouter/free');

    // Mapeo forzado para mayor robustez si el instalador usó nombres antiguos o genéricos
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

    console.log(`[Core] Configuración LLM detectada -> Proveedor: ${provider}, Modelo: ${model}, Origen: ${getSetting('model_provider') ? 'Base de Datos' : 'Variables de Entorno (.env)'}`);

    let fullSystemPrompt = systemPromptTemplate
        .replace('{agent_name}', nameToUse)
        .replace('{user_name}', userNameToUse)
        .replace('{agent_personality}', personalityToUse)
        .replace('{agent_function}', functionToUse);

    // Inyectar contexto de Memoria Avanzada (Fase 8)
    fullSystemPrompt += getMemoryPrompt();

    // Instrucciones dinámicas para el uso de VOZ y Hosting
    const voiceContext = isAudio
        ? "EL USUARIO TE HA ENVIADO UNA NOTA DE VOZ. Debes responderle usando la herramienta 'speak_message'."
        : "EL USUARIO TE HA ESCRITO POR TEXTO. Responde ÚNICAMENTE por texto, a menos que te pida explícitamente un audio.";

    fullSystemPrompt += `\n\nDIRECTRICES CRÍTICAS:
1. USO DE VOZ (speak_message):
${voiceContext}
- Si el usuario te pide que hables pero la herramienta está desactivada, DEBES usar 'toggle_skill(skillId: "voice", enabled: true)' para activarla tú mismo antes de hablar.
- IMPORTANTE: Si al intentar hablar notas que falta una configuración crítica (como la API Key de ElevenLabs), DEBES informar al usuario y pedírsela amablemente para poder completar la configuración.

2. USO DE HERRAMIENTAS ACTIVAS:
- NUNCA respondas que no puedes hacer algo sin verificar primero el listado explícito de funciones que se te ha entregado en este turno.
- MEMORIA A LARGO PLAZO: Si el usuario te indica un dato importante, te pide recordar un hecho, o establece una regla que debe aplicar en el futuro, SIEMPRE usa OBLIGATORIAMENTE la herramienta 'update_memory' para asegurar que lo recuerdas. Las cosas no se guardan solas.
- CONFIGURACIÓN DEL SISTEMA: Si el usuario te dicta o pide guardar una API Key (ej. de OpenAI, Anthropic, ElevenLabs, etc.) o te pide cambiar un proveedor, DEBES usar OBLIGATORIAMENTE la herramienta 'update_setting' para guardar instantáneamente la clave en la base de datos de Horus en vez de intentar usar scripts de Bash locales.
- ANÁLISIS DE CÓDIGO LOCAL: Usa bash para 'grep', lectura rápida, o scripting en python/node.
- ESCRITURA: Para escribir código que te pida el usuario, USA UNICAMENTE 'write_file_local' indicando TODA la ruta absoluta correcta.

3. HOSTING DE PROYECTOS WEB:
- Si el usuario te pide crear una página web o aplicación frontend, DEBES usar la herramienta 'write_file_local' o 'run_shell_local' para crear los archivos en la ruta: 'src/web/public/sites/[nombre-del-proyecto]/'.
- IMPORTANTE: No uses rutas relativas vagas, usa la ruta completa desde la raíz del proyecto si es necesario, o asume que estás en la raíz.
- Una vez creados, DEBES proporcionar al usuario el enlace para visualizarla: 'http://localhost:3005/sites/[nombre-del-proyecto]/index.html'.
- NO te limites a pasar el código, créalo físicamente en esa ruta para que sea accesible.

4. AUTONOMÍA Y AUTO-APRENDIZAJE:
- Eres un agente autodidacta. Tu objetivo es resolver problemas de forma independiente.
- EVITA darle comandos al usuario para que los ejecute. Si algo puede hacerse mediante un script o una Skill, HAZLO TÚ MISMO.
- Si te falta una herramienta para una tarea compleja (ej: auditoría de puertos, análisis de certificados), crea los archivos necesarios y usa 'package_skill' para autoinstalarte esa capacidad.
- Reflexiona sobre tus errores (Post-mortem) y ajusta tu lógica en el siguiente paso.
- Usa 'list_dir_local' y 'read_file_local' proactivamente para entender tu entorno si es necesario.`;

    const extraSkills = getEnabledSkillsContext();
    if (extraSkills) {
        fullSystemPrompt += `\n\nAdicionalmente, el usuario ha habilitado directrices MCP (Machine Control Protocol / Habilidades) en tu núcleo. Debes incorporar este conocimiento profundamente en tu metodología a partir de ahora:\n${extraSkills}`;
    }

    let currentIteration = 0;
    const dbMessages = Array.from(getRecentMessages(10, sessionId));
    const thread: any[] = [
        { role: 'system', content: fullSystemPrompt },
        ...dbMessages
    ];

    while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;

        try {
            const mcpTools = getMCPTools();
            let tools = [...getActiveTools(), ...mcpTools];

            const needsVoice = isAudio || message.toLowerCase().includes('háblame') || message.toLowerCase().includes('audio') || message.toLowerCase().includes('voz');
            if (!needsVoice) {
                tools = tools.filter(t => t.function.name !== 'speak_message');
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
                    const isMCPTool = mcpTools.some(t => t.function.name === toolCall.function.name);
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
            return "Lo siento, la respuesta generada estaba vacía.";
        } catch (error: any) {
            console.error('[Agent Loop] Error interno:', error);
            return `Lo siento, ocurrió un error interno consultando el modelo (${error.message || 'Desconocido'}). Revisa tu API key y tu conexíon.`;
        }
    }
    return "He alcanzado el límite de operaciones mentales seguidas. Por favor, inténtalo de nuevo o di algo diferente.";
}

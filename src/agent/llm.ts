import OpenAI from 'openai';
import { getSetting, addTokenUsage, getLLMAccounts } from '../db/index.js';

/**
 * Normaliza el texto para comparación de duplicados (estilo OpenClaw).
 */
export function normalizeTextForComparison(text: string): string {
    if (!text) return "";
    return text
        .trim()
        .toLowerCase()
        // Eliminar emojis y caracteres especiales de puntuación repetidos
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function _internalCompletion(model: string, provider: string, messages: any[], tools: any[] = [], overrideApiKey?: string) {
    let apiKey = overrideApiKey || getSetting(`llm_key_${provider}`) || getSetting('llm_api_key') || '';
    let baseURL = '';

    // Fallback to env vars if not in DB
    if (!apiKey) {
        if (provider === 'openrouter') apiKey = process.env.OPENROUTER_API_KEY || '';
        if (provider === 'groq') apiKey = process.env.GROQ_API_KEY || '';
        if (provider === 'openai') apiKey = process.env.OPENAI_API_KEY || '';
        if (provider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY || '';
        if (provider === 'google') apiKey = process.env.GEMINI_API_KEY || '';
        if (provider === 'qwen') apiKey = process.env.QWEN_API_KEY || '';
    }

    if (provider === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';
    else if (provider === 'groq') baseURL = 'https://api.groq.com/openai/v1';
    else if (provider === 'openai') baseURL = 'https://api.openai.com/v1';
    else if (provider === 'google') baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    else if (provider === 'qwen') baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    else if (provider === 'xai') baseURL = 'https://api.x.ai/v1';

    if (provider === 'anthropic') {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
                max_tokens: 4096,
                system: messages.find(m => m.role === 'system')?.content
            })
        });

        if (!anthropicResponse.ok) {
            const err = await anthropicResponse.text();
            throw new Error(`Anthropic Error ${anthropicResponse.status}: ${err}`);
        }

        const data: any = await anthropicResponse.json();
        if (data.usage) {
            addTokenUsage('anthropic', (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0));
        }

        return {
            role: 'assistant',
            content: data.content[0].text
        };
    }

    const client = new OpenAI({ apiKey, baseURL });
    const normalized = normalizeTools(tools);
    const payload: any = { model, messages };
    if (normalized.length > 0) {
        payload.tools = normalized;
        payload.tool_choice = "auto";
    }

    try {
        const response = await client.chat.completions.create(payload as any);
        if (response.usage) {
            addTokenUsage(provider, (response.usage.prompt_tokens || 0) + (response.usage.completion_tokens || 0));
        }
        return response.choices[0].message;
    } catch (apiError: any) {
        // Diagnóstico profundo para errores 400/429 (especialmente en Gemini)
        if (apiError.status === 400 || apiError.status === 429) {
            console.error(`[LLM/Error] Diagnóstico ${provider} (${apiError.status}):`, JSON.stringify(apiError.error || apiError.message || apiError, null, 2));
        }
        throw apiError;
    }
}

// ---------- NORMALIZADOR DE HERRAMIENTAS ----------
function normalizeTools(tools: any[]) {
    if (!tools || tools.length === 0) return [];

    return tools.map((t, idx) => {
        if (!t || typeof t !== 'object') return t;

        // Si ya está envuelta en { type: 'function', function: { ... } }, devolver tal cual
        if (t.type === 'function' && t.function && t.function.name) {
            return t;
        }

        // Si tiene la propiedad .function pero no el .type
        if (t.function && !t.type) {
            return {
                type: 'function',
                function: t.function
            };
        }

        // Si es una definición directa de función (tiene name y parameters)
        if (t.name && t.parameters) {
            return {
                type: 'function',
                function: t
            };
        }

        // Caso de emergencia: si falta el type pero parece ser una herramienta
        if (!t.type && (t.name || t.function)) {
            return {
                type: 'function',
                function: t.function || t
            };
        }

        console.warn(`[LLM] No se pudo normalizar la herramienta en el índice ${idx}:`, JSON.stringify(t));
        return t;
    });
}

// ---------- COMPLETION CON OAUTH (CODEX API) ----------
async function _responsesApiCompletion(model: string, messages: any[], apiKey: string, tools: any[] = [], onDelta?: (delta: any) => void) {
    const input: any[] = [];
    let systemInstruction = '';
    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = msg.content;
        } else if (msg.role === 'tool') {
            // Codex no soporta el rol 'tool'. Lo mapeamos a 'user' con un prefijo.
            input.push({
                role: 'user',
                content: `[RESULTADO DE HERRAMIENTA]: ${msg.content || ''}`
                // Omitimos tool_call_id ya que no es un rol 'tool' estándar aquí
            });
        } else {
            const processedMsg: any = { role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content || '' };
            // Codex no acepta el parámetro 'tool_calls' en el historial de mensajes
            // Lo omitimos para evitar el error 400: Unknown parameter
            input.push(processedMsg);
        }
    }

    let effectiveModel = model;

    const normalized = normalizeTools(tools);
    const body: any = {
        model: effectiveModel,
        input,
        store: getSetting('codex_store_enabled') === '1', // Default disabled for safety
        stream: true
    };
    if (systemInstruction) {
        body.instructions = systemInstruction;
    }
    
    // Server-side compaction support (OpenClaw style)
    if (getSetting('codex_compaction_enabled') !== '0') {
        body.context_management = [{
            type: 'compaction',
            compact_threshold: parseInt(getSetting('codex_compact_threshold') || '80000', 10)
        }];
    }

    if (normalized.length > 0) {
        // Codex (Responses API) requiere que cada tool tenga "type": "function"
        // pero que name/parameters estén en el primer nivel (semi-aplanado)
        body.tools = normalized.map((t: any) => ({
            type: 'function',
            ...(t.function || t)
        }));
    }

    const agentVersion = getSetting('agent_version') || 'v0.2.x';
    console.log(`[LLM/OAuth ${agentVersion}] Calling Codex Responses API (Streaming): model=${effectiveModel} (requested=${model}), tokenPrefix=${apiKey.substring(0, 10)}...`);

    const res = await fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        if (res.status === 400) {
            try {
                const errJson = JSON.parse(errText);
                if (errJson.detail?.includes('Store must be set to false')) {
                    throw new Error("ERROR CODEX: Tu cuenta de OpenAI no permite 'vía API' la persistencia de historial (store: true). Por favor, DESACTIVA 'Persistencia de Sesión' en los ajustes de Cerebro.");
                }
            } catch (jsonParseError) {
                // If errText is not valid JSON, just proceed to throw the original error
                console.warn("Failed to parse error text as JSON:", jsonParseError);
            }
        }
        throw new Error(`${res.status} ${errText}`);
    }

    // Procesar el stream SSE para reconstruir la respuesta completa
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No se pudo obtener el reader del stream");

    let fullText = '';
    const toolCallsMap = new Map<string, any>();
    const decoder = new TextDecoder();
    let buffer = '';

    // Algunos streams devuelven el texto final en un objeto response al final.
    // Guardamos la última respuesta completa por si no hubo deltas.
    let lastResponseObject: any = null;
    const debugLLM = getSetting('debug_llm') === '1';

    const appendText = (t: any) => {
        if (!t) return;
        let deltaText = '';
        if (typeof t === 'string') deltaText = t;
        else if (typeof t === 'object') {
            if (typeof t.text === 'string') deltaText = t.text;
            else if (typeof t.content === 'string') deltaText = t.content;
            else if (typeof t.delta === 'string') deltaText = t.delta;
        }
        
        if (deltaText) {
            fullText += deltaText;
            if (onDelta) onDelta({ type: 'text', delta: deltaText });
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

            const dataStr = trimmedLine.replace('data: ', '');
            if (dataStr === '[DONE]') break;

            try {
                const data = JSON.parse(dataStr);
                if (debugLLM) console.log(`[Codex/Stream] Event Type: ${data.type}`);

                // 0) Verificar si hay errores explícitos en el stream
                if (data?.type === 'error' || data?.error) {
                    const errMsg = data.error?.message || data.message || JSON.stringify(data.error || data);
                    throw new Error(`Codex Stream Error: ${errMsg}`);
                }

                // Guardar respuesta completa si viene en eventos tipo completed
                if (data?.type === 'response.completed' && data.response) {
                    lastResponseObject = data.response;
                    if (data.response?.usage) {
                        const usage = data.response.usage;
                        addTokenUsage('openai', (usage.input_tokens || 0) + (usage.output_tokens || 0));
                    }
                }

                // Capturar texto (muchas variantes y muy permisivo)
                const isDelta = data.type?.includes('.delta') || data.delta !== undefined || data.text !== undefined || data.content !== undefined;
                const isTool = data.type?.includes('tool_call') || data.type?.includes('part.added') || data.tool_call !== undefined || data.tool_calls !== undefined;

                if (isDelta && !isTool) {
                    // Capturar razonamiento (thinking) si está presente
                    if (data.type === 'response.reasoning.delta' || data.type === 'response.part.reasoning.delta') {
                        const reasoningDelta = data.delta?.reasoning || data.delta || '';
                        if (reasoningDelta && onDelta) {
                            onDelta({ type: 'reasoning', delta: reasoningDelta });
                        }
                    } else {
                        // Algunos eventos usan data.delta, otros data.text, otros data.content
                        if (data.delta !== undefined) appendText(data.delta);
                        else if (data.text !== undefined) appendText(data.text);
                        else if (data.content !== undefined) appendText(data.content);
                        else if (data?.message?.delta !== undefined) appendText(data.message.delta);
                    }
                }

                // Algunas implementaciones envían eventos done con texto final.
                // IMPORTANTE: Solo añadir si fullText está vacío para evitar duplicados si ya recibimos deltas anteriormente.
                else if (data.type?.includes('.done') && !isTool) {
                    if (!fullText) {
                        if (data.text !== undefined) appendText(data.text);
                        else if (data.content !== undefined) appendText(data.content);
                    }
                }

                // Capturar inicio de llamada a herramienta
                else if ((data.type === 'response.tool_call.added' || data.type === 'response.part.added') && (data.tool_call || data.part)) {
                    const tc = data.tool_call || data.part;
                    if (tc && tc.type === 'function') {
                        toolCallsMap.set(tc.id, {
                            id: tc.id,
                            type: 'function',
                            function: {
                                name: tc.function?.name || '',
                                arguments: tc.function?.arguments || ''
                            }
                        });
                    }
                }

                // Capturar deltas de argumentos de herramientas
                else if ((data.type === 'response.tool_call.arguments.delta' || data.type === 'response.tool_call.delta' || data.type === 'response.part.delta') && data.delta) {
                    const tcIdx = data.tool_call_id || data.part_id || (data.tool_call && data.tool_call.id);
                    const tc = toolCallsMap.get(tcIdx);
                    if (tc) {
                        if (typeof data.delta === 'string') {
                            tc.function.arguments += data.delta;
                        } else if (data.delta.arguments) {
                            tc.function.arguments += data.delta.arguments;
                        }
                    }
                }

                // LÍMITE DE SEGURIDAD: Evitar volcados infinitos si el modelo entra en bucle
                if (fullText.length > 100000) {
                    console.warn('[LLM/Codex] Límite de seguridad alcanzado (100k chars), truncando stream.');
                    reader.cancel();
                    break;
                }
            } catch (e: any) {
                if (e.message?.includes('Codex Stream Error')) throw e;
                console.warn(`[Codex SSE Diagnostic] Evento no reconocido o error: ${trimmedLine}`);
            }
        }
    }

    let toolCalls = Array.from(toolCallsMap.values());

    // Fallback mejorado: si no hubo deltas pero sí vino un objeto response al final, extraer texto.
    // Solo lo hacemos si fullText está vacío para evitar duplicados.
    if (!fullText.trim() && lastResponseObject) {
        fullText = extractTextFromResponseObject(lastResponseObject);
    }

    // --- DETECCIÓN DE HERRAMIENTAS EN CRUDO (JSON) PARA CODEX ---
    // Si el texto contiene bloques JSON (incluso si son múltiples), los extraemos.
    const jsonBlocks = extractJsonBlocks(fullText);
    if (jsonBlocks.length > 0) {
        for (const block of jsonBlocks) {
            try {
                // Solo si no tenemos ya tool calls nativas o si queremos ser redundantes (Codex a veces vierte argumentos en texto)
                const parsed = JSON.parse(block);
                if (tools.length > 0) {
                    const firstTool = tools[0];
                    const toolName = firstTool.function?.name || firstTool.name;
                    
                    if (toolName) {
                        console.log(`[LLM/Codex] Detectada llamada a herramienta en crudo (Texto): ${toolName}`);
                        toolCalls.push({
                            id: `call_raw_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments: block
                            }
                        });
                        // Removemos el bloque del texto final para que no se vea el JSON en el chat
                        fullText = fullText.replace(block, '').trim();
                    }
                }
            } catch (e) {
                // No era JSON válido o error al procesar
            }
        }
    }

    if (!fullText && toolCalls.length === 0) {
        console.error(`[LLM/Codex] Respuesta vacía. Last object: ${JSON.stringify(lastResponseObject).substring(0, 500)}`);
        throw new Error(`La respuesta del modelo está vacía. Intenta de nuevo o revisa tu cuenta.`);
    }

    return {
        role: 'assistant' as const,
        content: fullText,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    };
}

function extractTextFromResponseObject(resp: any) {
    // Intentar extraer texto del objeto final (varía por implementación de Codex)
    if (!resp || typeof resp !== 'object') return '';

    // 1) Caso Directo: text o content en la raíz
    if (typeof resp.text === 'string') return resp.text;
    if (typeof resp.content === 'string') return resp.content;
    if (typeof resp.output_text === 'string') return resp.output_text;

    // 2) Caso output[] (Muy común en Codex/Responses API)
    const out = resp.output;
    if (Array.isArray(out)) {
        let t = '';
        for (const item of out) {
            // Algunos envían item.item.content o similar, buscamos recursivamente
            if (typeof item?.text === 'string') {
                t += item.text;
            } else if (item?.content) {
                const content = item.content;
                if (Array.isArray(content)) {
                    for (const c of content) {
                        if (typeof c === 'string') t += c;
                        else if (typeof c?.text === 'string') t += c.text;
                        else if (typeof c?.content === 'string') t += c.content;
                    }
                } else if (typeof content === 'string') {
                    t += content;
                }
            }
        }
        if (t) return t;
    } else if (out && typeof out === 'object') {
        // Si output es un objeto en lugar de un array
        if (typeof out.text === 'string') return out.text;
        if (typeof out.content === 'string') return out.content;
    }

    // 3) Caso message.content (OpenAI standard fallback)
    if (typeof resp.message?.content === 'string') return resp.message.content;
    if (Array.isArray(resp.choices) && resp.choices[0]?.message?.content) {
        return resp.choices[0].message.content;
    }

    // 4) Caso reasoning (algunos modelos lo separan)
    if (typeof resp.reasoning === 'string' && resp.reasoning) {
        return `[Reasoning]: ${resp.reasoning}`;
    }

    console.warn('[LLM/Codex] No se pudo extraer texto del objeto de respuesta:', JSON.stringify(resp).substring(0, 500));
    return '';
}

/**
 * Extrae bloques de JSON válidos de un texto. 
 * Útil para cuando el LLM escupe JSON en lugar de usar herramientas estructuradas.
 */
function extractJsonBlocks(text: string): string[] {
    const blocks: string[] = [];
    let braceCount = 0;
    let start = -1;
    let inString = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        // Manejar strings para evitar confundir llaves dentro de textos
        if (char === '"' && text[i - 1] !== '\\') {
            inString = !inString;
        }

        if (inString) continue;

        if (char === '{') {
            if (braceCount === 0) start = i;
            braceCount++;
        } else if (char === '}') {
            braceCount--;
            if (braceCount === 0 && start !== -1) {
                blocks.push(text.substring(start, i + 1));
                start = -1;
            }
        }
    }
    return blocks;
}

// ---------- RESOLVER UNA CUENTA POR ID ----------
function resolveAccount(accountId: string): { provider: string, apiKey: string, isOauth: boolean, model?: string } | null {
    if (!accountId) return null;
    const accounts = getLLMAccounts();
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return null;
    return { provider: acc.provider, apiKey: acc.apiKey, isOauth: acc.isOauth || false, model: acc.model };
}

export async function chatCompletion(model: string, provider: string, messages: any[], tools: any[] = [], testApiKey?: string, onDelta?: (delta: any) => void) {
    // Si se envía una clave de prueba explícita (desde la UI modal de validación o delegación),
    // forzamos a probar SÓLO esa combinación inicial sin caer en tiers de backup.
    if (testApiKey) {
        const isJwtToken = (key: string) => key.startsWith('eyJ');
        const effectiveOAuth = isJwtToken(testApiKey) || provider === 'copilot';

        console.log(`[LLM] Intento directo (${provider}${effectiveOAuth ? '/OAuth' : ''}) -> ${model}`);

        if (effectiveOAuth && (provider === 'openai' || provider === 'copilot')) {
            return await _responsesApiCompletion(model, messages, testApiKey, tools, onDelta);
        }
        return await _internalCompletion(model, provider, messages, tools, testApiKey);
    }

    // Sistema Multi-tier v6.0 (basado en IDs de cuenta)
    interface Tier { p: string; m: string; key?: string; isOauth?: boolean }
    const tiers: Tier[] = [];

    // Tier 1: Cuenta principal (por ID de cuenta)
    const primaryAccountId = getSetting('llm_primary_account_id');
    const primaryModel = getSetting('llm_primary_model');
    if (primaryAccountId) {
        const acc = resolveAccount(primaryAccountId);
        if (acc) {
            tiers.push({ p: acc.provider, m: primaryModel || acc.model || model, key: acc.apiKey, isOauth: acc.isOauth });
        }
    }
    // Si no hay cuenta primaria seleccionada, usar los valores legacy como primer tier
    if (tiers.length === 0) {
        tiers.push({ p: provider, m: model });
    }

    // Tier 2
    const secondaryAccountId = getSetting('llm_secondary_account_id');
    const secondaryModel = getSetting('llm_secondary_model');
    if (secondaryAccountId) {
        const acc = resolveAccount(secondaryAccountId);
        if (acc && secondaryModel) {
            tiers.push({ p: acc.provider, m: secondaryModel, key: acc.apiKey, isOauth: acc.isOauth });
        }
    }

    // Tier 3
    const tertiaryAccountId = getSetting('llm_tertiary_account_id');
    const tertiaryModel = getSetting('llm_tertiary_model');
    if (tertiaryAccountId) {
        const acc = resolveAccount(tertiaryAccountId);
        if (acc && tertiaryModel) {
            tiers.push({ p: acc.provider, m: tertiaryModel, key: acc.apiKey, isOauth: acc.isOauth });
        }
    }

    let lastError: any = null;

    // Helper: detectar si una key es un token OAuth JWT (empieza con "eyJ")
    const isJwtToken = (key?: string) => key ? key.startsWith('eyJ') : false;

    for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];

        // Estabilización: Añadir un pequeño retardo entre intentos si no es el primero
        if (i > 0) {
            // Verificamos si los saltos están permitidos antes de continuar al siguiente tier
            const hoppingEnabled = getSetting('llm_relay_hopping_enabled') !== '0';
            if (!hoppingEnabled) {
                console.log(`[LLM] Saltos de proveedor desactivados. No se intentará el Tier ${i + 1}.`);
                break;
            }

            console.log(`[LLM] Esperando 1.5s antes de reintentar con Tier ${i + 1}...`);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        try {
            // Auto-detectar tokens OAuth por formato JWT, incluso si isOauth es false
            const effectiveOAuth = tier.isOauth || isJwtToken(tier.key);
            console.log(`[LLM] Intento Tier ${i + 1} (${tier.p}${effectiveOAuth ? '/OAuth' : ''}) -> ${tier.m}`);
            if (effectiveOAuth && (tier.p === 'openai' || tier.p === 'copilot') && tier.key) {
                return await _responsesApiCompletion(tier.m, messages, tier.key, tools, onDelta);
            }
            return await _internalCompletion(tier.m, tier.p, messages, tools, tier.key);
        } catch (error: any) {
            console.warn(`[LLM] Fallo en Tier ${i + 1} (${tier.p}): ${error.message}`);
            lastError = error;
        }
    }

    // Si no hay tiers con cuenta, verificar si la key legacy es un token JWT
    if (tiers.length === 1 && !tiers[0].key) {
        const legacyKey = getSetting('llm_api_key');
        if (legacyKey && isJwtToken(legacyKey) && provider === 'openai') {
            try {
                console.log(`[LLM] Detectado token OAuth JWT en key legacy, redirigiendo a Codex Responses API`);
                return await _responsesApiCompletion(model, messages, legacyKey, [], onDelta);
            } catch (error: any) {
                console.warn(`[LLM] Fallo en legacy OAuth: ${error.message}`);
                lastError = error;
            }
        }
    }

    console.error(`[LLM] Todos los tiers fallaron.`);
    throw lastError || new Error("Error desconocido en la comunicación con la IA.");
}

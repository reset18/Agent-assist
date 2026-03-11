import OpenAI from 'openai';
import { getSetting, addTokenUsage, getLLMAccounts } from '../db/index.js';

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

    const response = await client.chat.completions.create(payload as any);

    if (response.usage) {
        addTokenUsage(provider, (response.usage.prompt_tokens || 0) + (response.usage.completion_tokens || 0));
    }

    return response.choices[0].message;
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
async function _responsesApiCompletion(model: string, messages: any[], apiKey: string, tools: any[] = []) {
    const input: any[] = [];
    let systemInstruction = '';
    for (const msg of messages) {
        if (msg.role === 'system') systemInstruction = msg.content;
        else {
            input.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
        }
    }

    // Codex requiere identificadores específicos
    // - **v0.2.56**: Eliminado remapeo de gpt-4o/auto. Se permite el paso directo de nombres modernos (GPT-5).
    // - **v0.2.55**: Cambiado fallback de gpt-4o a 'auto' para evitar Error 400 en Codex.
    // - **v0.2.53**: Fix error 400 Codex (missing tools[0].name) mediante flattening a functions.
    // - **v0.2.52**: Añadido Copilot como proveedor y fallback de entrada manual para IDs de modelos (v0.2.52).
    let effectiveModel = model;

    const normalized = normalizeTools(tools);
    const body: any = {
        model: effectiveModel,
        input,
        store: false,
        stream: true
    };
    if (systemInstruction) {
        body.instructions = systemInstruction;
    }
    if (normalized.length > 0) {
        // Codex (Responses API) requiere que cada tool tenga "type": "function"
        // pero que name/parameters estén en el primer nivel (semi-aplanado)
        body.tools = normalized.map((t: any) => ({
            type: 'function',
            ...(t.function || t)
        }));
    }

    console.log(`[LLM/OAuth v0.2.58] Calling Codex Responses API (Streaming): model=${effectiveModel} (requested=${model}), tokenPrefix=${apiKey.substring(0, 10)}...`);

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
        throw new Error(`${res.status} ${errText}`);
    }

    // Procesar el stream SSE para reconstruir la respuesta completa
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No se pudo obtener el reader del stream");

    let fullText = '';
    const decoder = new TextDecoder();
    let buffer = '';

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

                // Formato OpenResponses / Codex SSE
                if (data.type === 'response.output_text.delta' && data.delta) {
                    fullText += data.delta;
                } else if (data.type === 'response.completed' && data.response?.usage) {
                    // Capturar uso de tokens si está disponible al final
                    const usage = data.response.usage;
                    addTokenUsage('openai', (usage.input_tokens || 0) + (usage.output_tokens || 0));
                }
            } catch (e) {
                // Ignorar errores de parseo de líneas parciales o eventos no JSON
            }
        }
    }

    if (!fullText) {
        throw new Error("La respuesta del stream está vacía");
    }

    return {
        role: 'assistant' as const,
        content: fullText
    };
}

// ---------- RESOLVER UNA CUENTA POR ID ----------
function resolveAccount(accountId: string): { provider: string, apiKey: string, isOauth: boolean, model?: string } | null {
    if (!accountId) return null;
    const accounts = getLLMAccounts();
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return null;
    return { provider: acc.provider, apiKey: acc.apiKey, isOauth: acc.isOauth || false, model: acc.model };
}

export async function chatCompletion(model: string, provider: string, messages: any[], tools: any[] = [], testApiKey?: string) {
    // Si se envía una clave de prueba explícita (desde la UI modal de validación),
    // forzamos a probar SÓLO esa combinación inicial sin caer en tiers de backup.
    if (testApiKey) {
        console.log(`[LLM] Intento validación directa (${provider}) -> ${model}`);
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
        try {
            // Auto-detectar tokens OAuth por formato JWT, incluso si isOauth es false
            const effectiveOAuth = tier.isOauth || isJwtToken(tier.key);
            console.log(`[LLM] Intento Tier ${i + 1} (${tier.p}${effectiveOAuth ? '/OAuth' : ''}) -> ${tier.m}`);
            if (effectiveOAuth && (tier.p === 'openai' || tier.p === 'copilot') && tier.key) {
                return await _responsesApiCompletion(tier.m, messages, tier.key, tools);
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
                return await _responsesApiCompletion(model, messages, legacyKey);
            } catch (error: any) {
                console.warn(`[LLM] Fallo en legacy OAuth: ${error.message}`);
                lastError = error;
            }
        }
    }

    console.error(`[LLM] Todos los tiers fallaron.`);
    throw lastError || new Error("Error desconocido en la comunicación con la IA.");
}

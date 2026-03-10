import OpenAI from 'openai';
import { getSetting, addTokenUsage } from '../db/index.js';

async function _internalCompletion(model: string, provider: string, messages: any[], tools: any[] = [], testApiKey?: string) {
    let apiKey = testApiKey || getSetting(`llm_key_${provider}`) || getSetting('llm_api_key') || '';
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
        // Registrar tokens
        if (data.usage) {
            addTokenUsage('anthropic', (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0));
        }

        return {
            role: 'assistant',
            content: data.content[0].text
        };
    }

    const client = new OpenAI({ apiKey, baseURL });
    const payload: any = { model, messages };
    if (tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = "auto";
    }

    const response = await client.chat.completions.create(payload);

    // Registrar tokens
    if (response.usage) {
        addTokenUsage(provider, response.usage.total_tokens);
    }

    return response.choices[0].message;
}

export async function chatCompletion(model: string, provider: string, messages: any[], tools: any[] = [], testApiKey?: string) {
    // Sistema Multi-tier (v5.0)
    const tiers = ([
        { p: getSetting('llm_primary_provider') || provider, m: getSetting('llm_primary_model') || model },
        { p: getSetting('llm_secondary_provider'), m: getSetting('llm_secondary_model') },
        { p: getSetting('llm_tertiary_provider'), m: getSetting('llm_tertiary_model') }
    ].filter(t => t.p && t.m) as { p: string, m: string }[]);

    // Si se envía una clave de prueba explícita (desde la UI modal de validación), 
    // forzamos a probar SÓLO esa combinación inicial sin caer en tiers de backup.
    if (testApiKey) {
        console.log(`[LLM] Intento validación directa (${provider}) -> ${model}`);
        return await _internalCompletion(model, provider, messages, tools, testApiKey);
    }

    let lastError: any = null;

    for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        try {
            console.log(`[LLM] Intento Tier ${i + 1} (${tier.p}) -> ${tier.m}`);
            return await _internalCompletion(tier.m, tier.p, messages, tools);
        } catch (error: any) {
            console.warn(`[LLM] Fallo en Tier ${i + 1} (${tier.p}): ${error.message}`);
            lastError = error;
            // Continuar al siguiente tier
        }
    }

    console.error(`[LLM] Todos los tiers fallaron.`);
    throw lastError || new Error("Error desconocido en la comunicación con la IA.");
}

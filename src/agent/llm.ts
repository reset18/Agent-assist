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
    const payload: any = { model, messages };
    if (tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = "auto";
    }

    const response = await client.chat.completions.create(payload);

    if (response.usage) {
        addTokenUsage(provider, response.usage.total_tokens);
    }

    return response.choices[0].message;
}

// ---------- RESOLVER UNA CUENTA POR ID ----------
function resolveAccount(accountId: string): { provider: string, apiKey: string } | null {
    if (!accountId) return null;
    const accounts = getLLMAccounts();
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return null;
    return { provider: acc.provider, apiKey: acc.apiKey };
}

export async function chatCompletion(model: string, provider: string, messages: any[], tools: any[] = [], testApiKey?: string) {
    // Si se envía una clave de prueba explícita (desde la UI modal de validación),
    // forzamos a probar SÓLO esa combinación inicial sin caer en tiers de backup.
    if (testApiKey) {
        console.log(`[LLM] Intento validación directa (${provider}) -> ${model}`);
        return await _internalCompletion(model, provider, messages, tools, testApiKey);
    }

    // Sistema Multi-tier v6.0 (basado en IDs de cuenta)
    interface Tier { p: string; m: string; key?: string }
    const tiers: Tier[] = [];

    // Tier 1: Cuenta principal (por ID de cuenta)
    const primaryAccountId = getSetting('llm_primary_account_id');
    const primaryModel = getSetting('llm_primary_model');
    if (primaryAccountId) {
        const acc = resolveAccount(primaryAccountId);
        if (acc) {
            tiers.push({ p: acc.provider, m: primaryModel || model, key: acc.apiKey });
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
            tiers.push({ p: acc.provider, m: secondaryModel, key: acc.apiKey });
        }
    }

    // Tier 3
    const tertiaryAccountId = getSetting('llm_tertiary_account_id');
    const tertiaryModel = getSetting('llm_tertiary_model');
    if (tertiaryAccountId) {
        const acc = resolveAccount(tertiaryAccountId);
        if (acc && tertiaryModel) {
            tiers.push({ p: acc.provider, m: tertiaryModel, key: acc.apiKey });
        }
    }

    let lastError: any = null;

    for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        try {
            console.log(`[LLM] Intento Tier ${i + 1} (${tier.p}) -> ${tier.m}`);
            return await _internalCompletion(tier.m, tier.p, messages, tools, tier.key);
        } catch (error: any) {
            console.warn(`[LLM] Fallo en Tier ${i + 1} (${tier.p}): ${error.message}`);
            lastError = error;
        }
    }

    console.error(`[LLM] Todos los tiers fallaron.`);
    throw lastError || new Error("Error desconocido en la comunicación con la IA.");
}


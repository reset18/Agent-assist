import OpenAI from 'openai';
import { getSetting } from '../db/index.js';

export async function chatCompletion(model: string, provider: string, messages: any[], tools: any[] = []) {
    let apiKey = getSetting('llm_api_key') || '';
    let baseURL = '';

    // Si no hay API Key en la DB, intentamos cargar la de las variables de entorno según el proveedor
    if (!apiKey) {
        if (provider === 'openrouter') {
            apiKey = process.env.OPENROUTER_API_KEY || '';
        } else if (provider === 'groq') {
            apiKey = process.env.GROQ_API_KEY || '';
        } else if (provider === 'openai') {
            apiKey = process.env.OPENAI_API_KEY || '';
        } else if (provider === 'anthropic') {
            apiKey = process.env.ANTHROPIC_API_KEY || '';
        } else if (provider === 'google') {
            apiKey = process.env.GEMINI_API_KEY || '';
        }
    }

    if (provider === 'openrouter') {
        baseURL = 'https://openrouter.ai/api/v1';
    } else if (provider === 'groq') {
        baseURL = 'https://api.groq.com/openai/v1';
    } else if (provider === 'openai') {
        baseURL = 'https://api.openai.com/v1';
    } else if (provider === 'anthropic') {
        baseURL = 'https://api.anthropic.com/v1';
    } else if (provider === 'google') {
        baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    }

    const finalApiKey = apiKey || 'NINGUNA';
    console.log(`[LLM] Intento de conexión -> Proveedor: ${provider}, Modelo Final: ${model}, BaseURL: ${baseURL}, Clave detectada: ${finalApiKey === 'NINGUNA' ? 'NO' : 'SÍ (' + finalApiKey.substring(0, 5) + '...)'}`);

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
                messages: messages
                    .filter(m => m.role !== 'system')
                    .map(m => ({ role: m.role, content: m.content })),
                max_tokens: 4096,
                system: messages.find(m => m.role === 'system')?.content
            })
        });

        if (!anthropicResponse.ok) {
            const err = await anthropicResponse.text();
            throw new Error(`Anthropic Error ${anthropicResponse.status}: ${err}`);
        }

        const data: any = await anthropicResponse.json();
        return {
            role: 'assistant',
            content: data.content[0].text
        };
    }

    if (apiKey === 'SUTITUYE POR EL TUYO') apiKey = '';

    const clientOptions: any = { apiKey, baseURL };

    if (provider === 'openrouter') {
        clientOptions.defaultHeaders = {
            "HTTP-Referer": "https://github.com/kevin-rovira/agent-assist", // Opcional pero recomendado
            "X-Title": "AgentAssist",
        };
    }

    const client = new OpenAI(clientOptions);

    const payload: any = {
        model,
        messages,
    };

    if (tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = "auto";
    }

    try {
        const response = await client.chat.completions.create(payload);
        return response.choices[0].message;
    } catch (error: any) {
        console.error(`[LLM] Error en chatCompletion: ${error.message}`);
        if (error.status === 401) {
            console.error(`[LLM] Error de autenticación (401). Verifica que la API Key de ${provider} sea válida.`);
        }
        throw error;
    }
}

import { getLLMAccounts, getSetting } from '../../db/index.js';
import { chatCompletion } from '../llm.js';

export const delegate_tasks_def = {
    type: "function",
    function: {
        name: "delegate_tasks",
        description: "Delega una lista de subtareas complejas a tus agentes de relevo (cuentas secundarias de LLM) para que las procesen en paralelo y devuelvan resúmenes. Úsalo para investigar cosas múltiples a la vez o dividir un problema grande.",
        parameters: {
            type: "object",
            properties: {
                tasks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Lista de tareas o preguntas específicas a delegar. Ej: ['Investiga X', 'Traduce Y', 'Resume Z']"
                }
            },
            required: ["tasks"]
        }
    }
};

export async function execute_delegate_tasks(args: { tasks: string[] }): Promise<string> {
    const { tasks } = args;
    if (!tasks || tasks.length === 0) {
        return "No se proporcionaron tareas para delegar.";
    }

    // Recopilar cuentas disponibles
    const accounts = getLLMAccounts();
    interface DelegateAccount {
        id: string;
        provider: string;
        model: string;
        apiKey: string;
        isOauth: boolean;
        name: string;
    }

    const availableDelegates: DelegateAccount[] = [];

    // Agregar la cuenta principal actual como opción si tiene datos
    const primaryProvider = getSetting('model_provider');
    const primaryModel = getSetting('model_name');
    const primaryApiKey = getSetting('llm_api_key');
    if (primaryProvider && primaryModel && primaryApiKey) {
        const isJwtToken = primaryApiKey.startsWith('eyJ');
        availableDelegates.push({
            id: 'primary',
            provider: primaryProvider,
            model: primaryModel,
            apiKey: primaryApiKey,
            isOauth: isJwtToken,
            name: 'Agente Principal'
        });
    }

    // Agregar las cuentas de relevo (secundarias)
    for (const acc of accounts) {
        if (acc.provider && acc.apiKey) {
            availableDelegates.push({
                id: acc.id,
                provider: acc.provider,
                model: acc.model || 'auto', // Fallback si no hay modelo definido
                apiKey: acc.apiKey,
                isOauth: acc.isOauth || false,
                name: acc.name || 'Relevo Desconocido'
            });
        }
    }

    if (availableDelegates.length === 0) {
        return "ERROR: No hay cuentas de LLM (relevos) configuradas para delegar tareas.";
    }

    console.log(`[Delegate] Iniciando delegación de ${tasks.length} tareas usando ${availableDelegates.length} agentes disponibles...`);

    const promises = tasks.map((task, index) => {
        // Round-robin distribution
        const delegate = availableDelegates[index % availableDelegates.length];
        return executeSubTask(task, delegate, index + 1);
    });

    const results = await Promise.allSettled(promises);

    let finalReport = "=== REPORTE DE DELEGACIÓN MULTI-AGENTE ===\n\n";

    results.forEach((res, i) => {
        finalReport += `--- TAREA ${i + 1}: ${tasks[i]} ---\n`;
        if (res.status === 'fulfilled') {
            finalReport += `${res.value}\n\n`;
        } else {
            finalReport += `[ERROR] El agente de relevo falló al procesar esta tarea: ${res.reason.message || res.reason}\n\n`;
        }
    });

    return finalReport;
}

async function executeSubTask(task: string, account: any, taskIndex: number): Promise<string> {
    console.log(`[Delegate] Enviando Sub-Tarea ${taskIndex} al agente '${account.name}' (${account.provider})...`);

    const thread = [
        {
            role: 'system',
            content: 'Eres un agente de relevo (sub-agente). Tu trabajo es resolver la tarea que se te pide de forma concisa, directa y precisa. Devuelve únicamente la respuesta útil, sin saludos ni introducciones largas.'
        },
        {
            role: 'user',
            content: task
        }
    ];

    try {
        // Note: No pasamos tools a los sub-agentes por seguridad y simplicidad en esta fase, 
        // solo capacidad de razonamiento/búsqueda interna del LLM.
        const response = await chatCompletion(account.model, account.provider, thread, [], account.apiKey);
        if (response && response.content) {
            console.log(`[Delegate] Sub-Tarea ${taskIndex} completada por '${account.name}'.`);
            return response.content;
        }
        return "[Advertencia] El agente devolvió una respuesta vacía.";
    } catch (e: any) {
        console.error(`[Delegate] Error en Sub-Tarea ${taskIndex} con '${account.name}':`, e.message);
        throw e;
    }
}

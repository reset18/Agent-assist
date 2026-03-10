import { setSetting } from '../../db/index.js';

export const update_setting_def = {
    type: "function",
    function: {
        name: "update_setting",
        description: "Actualiza o configura un parámetro de la base de datos de Horus. Úsalo sobre todo cuando el usuario te facilite una API Key (de texto, voz u otros) que necesites guardar.",
        parameters: {
            type: "object",
            properties: {
                setting_key: {
                    type: "string",
                    description: "La clave del parámetro a guardar. Valores permitidos comunes: 'openai_api_key_audio', 'elevenlabs_api_key', 'llm_api_key', 'model_provider', 'telegram_bot_token', 'agent_name'."
                },
                setting_value: {
                    type: "string",
                    description: "El valor a guardar."
                }
            },
            required: ["setting_key", "setting_value"],
            additionalProperties: false
        }
    }
};

export async function execute_update_setting(args: { setting_key: string, setting_value: string }) {
    const { setting_key, setting_value } = args;

    // Lista blanca de configuraciones permitidas por seguridad para que el LLM no rompa la base de datos
    const allowedKeys = [
        'openai_api_key_audio', 'elevenlabs_api_key', 'elevenlabs_voice_id',
        'openai_voice_id', 'voice_engine', 'voice_enabled',
        'llm_api_key', 'model_provider', 'model_name',
        'telegram_bot_token', 'telegram_whitelist',
        'agent_name', 'user_name', 'agent_personality', 'agent_function'
    ];

    if (!allowedKeys.includes(setting_key)) {
        return {
            success: false,
            message: `Acceso denegado: no tienes permisos para modificar la configuración '${setting_key}'. Usa solo configuraciones de API keys, voz o modelo.`
        };
    }

    try {
        setSetting(setting_key, setting_value);
        return {
            success: true,
            message: `Configuración '${setting_key}' actualizada correctamente a un nuevo valor. La configuración ya es persistente.`
        };
    } catch (e: any) {
        return {
            success: false,
            message: `Error interno de base de datos al guardar ${setting_key}: ${e.message}`
        };
    }
}

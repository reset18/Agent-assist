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
                    description: "La clave del parámetro a guardar. Puedes inventar claves nuevas para almacenar logins o memorias importantes del usuario."
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

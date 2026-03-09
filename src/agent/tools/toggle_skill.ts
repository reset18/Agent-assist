import { setSetting } from '../../db/index.js';

export const toggle_skill_def = {
    type: "function",
    function: {
        name: "toggle_skill",
        description: "Habilita o deshabilita una habilidad (Skill). Puede ser una habilidad MCP (ej: 'mi-habilidad.zip') o una habilidad nativa como 'voice' (Voz/TTS).",
        parameters: {
            type: "object",
            properties: {
                skillId: {
                    type: "string",
                    description: "ID de la habilidad. Usa el nombre del ZIP para MCP o 'voice' para activar/desactivar la capacidad de hablar."
                },
                enabled: {
                    type: "boolean",
                    description: "True para habilitar, False para deshabilitar."
                }
            },
            required: ["skillId", "enabled"]
        }
    }
};

export async function execute_toggle_skill(args: { skillId: string, enabled: boolean }) {
    const { skillId, enabled } = args;

    if (skillId === 'voice') {
        setSetting('voice_enabled', enabled ? '1' : '0');
        return {
            success: true,
            message: `Capacidad de VOZ ${enabled ? 'habilitada' : 'deshabilitada'}. Ahora puedes usar 'speak_message' para hablarle al usuario.`,
            skillId,
            enabled
        };
    }

    const key = `skill_enabled_${skillId}`;
    setSetting(key, enabled ? '1' : '0');

    return {
        success: true,
        message: `Habilidad '${skillId}' ${enabled ? 'habilitada' : 'deshabilitada'}. Estará activa en tu próximo turno de pensamiento.`,
        skillId,
        enabled
    };
}

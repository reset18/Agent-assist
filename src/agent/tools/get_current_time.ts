export const get_current_time_def = {
    type: "function",
    function: {
        name: "get_current_time",
        description: "Obtiene la hora y fecha local del sistema donde se aloja el bot.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    }
};

export async function execute_get_current_time(args: any) {
    return new Date().toLocaleString('es-ES');
}

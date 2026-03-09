import { Client } from 'ssh2';

export const run_ssh_command_def = {
    type: "function",
    function: {
        name: "run_ssh_command",
        description: "Se conecta por SSH a una máquina externa/remota (o al hipervisor Proxmox) y ejecuta un comando Bash/Shell devolviendo su salida. Útil para gestionar la red de servidores del usuario.",
        parameters: {
            type: "object",
            properties: {
                host: { type: "string", description: "IP o dominio del servidor destino (Ej: 192.168.1.100)." },
                port: { type: "number", description: "Puerto SSH (por defecto 22)." },
                username: { type: "string", description: "Usuario de acceso SSH." },
                password: { type: "string", description: "Contraseña secreta del usuario SSH." },
                command: { type: "string", description: "Comando bash a ejecutar en el servidor remoto." }
            },
            required: ["host", "username", "password", "command"],
        },
    }
};

export async function execute_run_ssh_command(args: any) {
    return new Promise((resolve) => {
        const conn = new Client();
        conn.on('ready', () => {
            conn.exec(args.command, (err, stream) => {
                if (err) {
                    conn.end();
                    return resolve(`Error al ejecutar contexto SSH: ${err.message}`);
                }

                let result = '';
                stream.on('close', (code: any, signal: any) => {
                    conn.end();
                    if (result.trim() === '') result = `Comando ejecutado con código ${code}. Salida vacía.`;
                    resolve(`[SSH Salida - Código ${code}]:\n${result}`);
                }).on('data', (data: any) => {
                    result += data;
                }).stderr.on('data', (data: any) => {
                    result += `[STDERR]: ${data}`;
                });
            });
        }).on('error', (err) => {
            resolve(`Error de conexión SSH: ${err.message}`);
        }).connect({
            host: args.host,
            port: args.port || 22,
            username: args.username,
            password: args.password,
            readyTimeout: 10000 // 10 segundos timeout
        });
    });
}

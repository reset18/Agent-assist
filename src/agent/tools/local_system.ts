import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export const read_file_local_def = {
    type: "function",
    function: {
        name: "read_file_local",
        description: "Lee el contenido de un archivo local en el servidor ejecutando el agente.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Ruta absoluta o relativa del archivo a leer." }
            },
            required: ["filePath"],
        },
    }
};

export async function execute_read_file_local(args: any) {
    try {
        const targetPath = path.resolve(process.cwd(), args.filePath);
        if (!fs.existsSync(targetPath)) return `Error: El archivo ${targetPath} no existe.`;
        return fs.readFileSync(targetPath, 'utf8');
    } catch (e: any) {
        return `Error leyendo archivo: ${e.message}`;
    }
}

export const write_file_local_def = {
    type: "function",
    function: {
        name: "write_file_local",
        description: "Escribe o sobreescribe contenido en un archivo local. Útil para que modifiques tu propio código o crees scripts.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Ruta absoluta o relativa del archivo." },
                content: { type: "string", description: "Contenido a escribir en el archivo." }
            },
            required: ["filePath", "content"],
        },
    }
};

export async function execute_write_file_local(args: any) {
    try {
        const targetPath = path.resolve(process.cwd(), args.filePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, args.content, 'utf8');
        return `Éxito: Archivo escrito en ${targetPath}`;
    } catch (e: any) {
        return `Error escribiendo archivo: ${e.message}`;
    }
}

export const list_dir_local_def = {
    type: "function",
    function: {
        name: "list_dir_local",
        description: "Lista el contenido de un directorio local para ver qué archivos existen.",
        parameters: {
            type: "object",
            properties: {
                dirPath: { type: "string", description: "Ruta del directorio a listar (usa '.' para el actual)." }
            },
            required: ["dirPath"],
        },
    }
};

export async function execute_list_dir_local(args: any) {
    try {
        const targetPath = path.resolve(process.cwd(), args.dirPath);
        if (!fs.existsSync(targetPath)) return `Error: El directorio ${targetPath} no existe.`;
        const items = fs.readdirSync(targetPath);
        return `Contenido de ${targetPath}:\n- ` + items.join('\n- ');
    } catch (e: any) {
        return `Error listando directorio: ${e.message}`;
    }
}

export const run_shell_local_def = {
    type: "function",
    function: {
        name: "run_shell_local",
        description: "Ejecuta un comando de terminal/shell en la propia máquina anfitriona (el Docker del agente). Retorna la salida estándar.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Comando bash/shell a ejecutar (ej: 'npm install', 'ls -la', 'ping -c 4 8.8.8.8')." }
            },
            required: ["command"],
        },
    }
};

export async function execute_run_shell_local(args: any) {
    try {
        const { stdout, stderr } = await execAsync(args.command);
        let result = "";
        if (stdout) result += `STDOUT:\n${stdout}\n`;
        if (stderr) result += `STDERR:\n${stderr}\n`;
        return result || "Comando ejecutado con éxito sin salida de texto.";
    } catch (e: any) {
        return `Error ejecutando comando: ${e.message}\n${e.stdout ? `STDOUT: ${e.stdout}` : ''}`;
    }
}

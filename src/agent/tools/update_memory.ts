import fs from 'fs';
import path from 'path';
import { MEMORY_DIR } from '../memory.js';

export const update_memory_details = {
    name: 'update_memory',
    description: 'Añade, actualiza o lee información en la memoria a largo plazo del Agente. Usa "append" para añadir un nuevo hecho a memoria_agente.md, "replace" para sobrescribir todo el archivo (útil si la memoria crece demasiado y quieres resumirla), o "read" para consultar el archivo específico. Los archivos viables son "identidad.md", "usuario.md" y "memoria_agente.md".',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'La acción a realizar: "append", "replace" o "read".',
                enum: ['append', 'replace', 'read']
            },
            file_name: {
                type: 'string',
                description: 'El archivo a modificar: "identidad.md", "usuario.md", o "memoria_agente.md". Por defecto usa "memoria_agente.md".',
                enum: ['identidad.md', 'usuario.md', 'memoria_agente.md']
            },
            content: {
                type: 'string',
                description: 'El contenido a añadir o reemplazar. Ignorar si la acción es "read".'
            }
        },
        required: ['action', 'file_name']
    }
};

export async function execute_update_memory(args: { action: string, file_name: string, content?: string }): Promise<string> {
    try {
        const targetFile = args.file_name || 'memoria_agente.md';
        const filePath = path.join(MEMORY_DIR, targetFile);

        if (!fs.existsSync(filePath)) {
            // Memory system was not initialized? Just create the directory
            if (!fs.existsSync(MEMORY_DIR)) {
                fs.mkdirSync(MEMORY_DIR, { recursive: true });
            }
            fs.writeFileSync(filePath, '', 'utf-8');
        }

        if (args.action === 'read') {
            const currentContent = fs.readFileSync(filePath, 'utf-8');
            return `Contenido actual de ${targetFile}:\n\n${currentContent}`;
        }

        if (!args.content) {
            return `Error: Se requiere proveer "content" para la acción ${args.action}`;
        }

        if (args.action === 'append') {
            // Append with a newline and timestamp
            const date = new Date().toISOString().split('T')[0];
            const appendData = `\n- [${date}] ${args.content}`;
            fs.appendFileSync(filePath, appendData, 'utf-8');
            return `Éxito: Conocimiento agregado a la memoria a largo plazo en ${targetFile}.`;
        } else if (args.action === 'replace') {
            fs.writeFileSync(filePath, args.content, 'utf-8');
            return `Éxito: Archivo de memoria ${targetFile} reemplazado totalmente.`;
        }

        return `Error: Acción desconocida ${args.action}`;
    } catch (e: any) {
        return `Error al actualizar la memoria: ${e.message}`;
    }
}

import fs from 'fs';
import path from 'path';
import { getSetting } from '../db/index.js';

export const MEMORY_DIR = path.join(process.cwd(), 'memory');

export function initMemoryFiles() {
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }

    const files = [
        {
            name: 'identidad.md',
            defaultContent: `# Identidad del Agente\n\nNombre: ${getSetting('agent_name') || 'Asistente'}\nPersonalidad: ${getSetting('agent_personality') || 'Eficiente, natural y directo.'}\nFunción Principal: ${getSetting('agent_function') || 'Ayudar en tareas generales.'}\n\n*Esta es tu identidad principal. Compórtate de acuerdo a esto en todas tus respuestas.*`
        },
        {
            name: 'usuario.md',
            defaultContent: `# Información del Usuario\n\nNombre: ${getSetting('user_name') || 'Usuario'}\n\n*Aquí se guardan las preferencias y datos importantes sobre el usuario con el que interactúas.*`
        },
        {
            name: 'memoria_agente.md',
            defaultContent: `# Memoria del Agente (Long-Term Facts)\n\n*Aquí puedes registrar hechos importantes, descubrimientos, o reglas que debes recordar a largo plazo sobre tus tareas.*`
        }
    ];

    files.forEach(file => {
        const filePath = path.join(MEMORY_DIR, file.name);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, file.defaultContent, 'utf-8');
            console.log(`[Memory] Creado archivo de memoria base: ${file.name}`);
        }
    });
}

export function getMemoryPrompt(): string {
    let memoryPrompt = '\n\n=== ARCHIVOS DE MEMORIA A LARGO PLAZO ===\n';
    memoryPrompt += 'A continuación se muestra tu memoria persistente. Usa esta información para mantener la consistencia en el tiempo:\n\n';

    const files = ['identidad.md', 'usuario.md', 'memoria_agente.md'];

    files.forEach(file => {
        const filePath = path.join(MEMORY_DIR, file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            memoryPrompt += `--- INICIO DE ${file} ---\n${content}\n--- FIN DE ${file} ---\n\n`;
        }
    });

    memoryPrompt += 'Si descubres nueva información crítica sobre el usuario o tus tareas, usa la herramienta "update_memory" para añadirla a memoria_agente.md.\n';
    memoryPrompt += '============================================\n';
    return memoryPrompt;
}

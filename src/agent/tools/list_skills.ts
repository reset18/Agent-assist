import fs from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { getSetting } from '../../db/index.js';

export const list_skills_def = {
    type: "function",
    function: {
        name: "list_skills",
        description: "Devuelve una lista de todas las habilidades (Skills) instaladas en la carpeta MCP, incluyendo su nombre, descripción y estado (activada/desactivada). Úsala ANTES de crear una habilidad nueva para evitar duplicados.",
        parameters: {
            type: "object",
            properties: {}
        }
    }
};

export async function execute_list_skills() {
    try {
        const mcpPath = join(process.cwd(), 'MCP');
        if (!fs.existsSync(mcpPath)) {
            return { skills: [], message: "No se encontró la carpeta MCP." };
        }

        const files = fs.readdirSync(mcpPath).filter((f: string) => f.endsWith('.zip'));
        const skills = [];

        const getEmoji = (name: string) => {
            const n = name.toLowerCase();
            if (n.includes('secure') || n.includes('auditor') || n.includes('tls') || n.includes('ssh')) return '🛡️';
            if (n.includes('scrap') || n.includes('browser') || n.includes('crawl')) return '🕸️';
            if (n.includes('mail') || n.includes('gmail')) return '📧';
            if (n.includes('voice') || n.includes('speak') || n.includes('tts')) return '🎙️';
            if (n.includes('learn') || n.includes('reflex')) return '🧠'; // Corrected category for learning
            if (n.includes('dev') || n.includes('code') || n.includes('program')) return '💻';
            if (n.includes('file') || n.includes('dir')) return '📂';
            if (n.includes('calc') || n.includes('math')) return '📊';
            if (n.includes('time') || n.includes('day')) return '📅';
            return '⚡';
        };

        for (const file of files) {
            let name = file.replace('.zip', '');
            let description = "Sin descripción";
            const enabled = getSetting(`skill_enabled_${file}`) === '1';
            let emoji = getEmoji(name);

            try {
                const zipPath = join(mcpPath, file);
                const zip = new AdmZip(zipPath);
                const skillEntry = zip.getEntry('SKILL.md');
                if (skillEntry) {
                    const content = skillEntry.getData().toString('utf8');
                    const nameMatch = content.match(/name:\s*(.*)/i);
                    const descMatch = content.match(/description:\s*(.*)/i);
                    if (nameMatch) {
                        name = nameMatch[1].trim();
                        emoji = getEmoji(name); // Re-evaluate based on inner name
                    }
                    if (descMatch) description = descMatch[1].trim();
                }
            } catch (err) {
                // Error leyendo zip
            }

            skills.push({
                id: file,
                name,
                description,
                enabled,
                emoji
            });
        }

        return {
            success: true,
            skills,
            count: skills.length
        };
    } catch (e: any) {
        throw new Error(`Error al listar habilidades: ${e.message}`);
    }
}

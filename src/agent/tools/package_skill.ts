import AdmZip from 'adm-zip';
import fs from 'fs';
import { join } from 'path';

export const package_skill_def = {
    type: "function",
    function: {
        name: "package_skill",
        description: "Empaqueta una carpeta de habilidad preparada en una ubicación temporal en un archivo .zip listo para la carpeta MCP. La carpeta debe contener al menos un archivo SKILL.md.",
        parameters: {
            type: "object",
            properties: {
                sourceDir: {
                    type: "string",
                    description: "Ruta de la carpeta que contiene los archivos de la habilidad (ej: 'tmp/mi-habilidad')."
                },
                skillName: {
                    type: "string",
                    description: "Nombre del archivo .zip final (sin extensión, ej: 'mi-nueva-habilidad')."
                }
            },
            required: ["sourceDir", "skillName"]
        }
    }
};

export async function execute_package_skill(args: { sourceDir: string, skillName: string }) {
    const { sourceDir, skillName } = args;
    const fullSourcePath = join(process.cwd(), sourceDir);
    const mcpDir = join(process.cwd(), 'MCP');
    const targetZipPath = join(mcpDir, `${skillName}.zip`);

    if (!fs.existsSync(fullSourcePath)) {
        throw new Error(`La carpeta origen no existe: ${fullSourcePath}`);
    }

    const skillMdPath = join(fullSourcePath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
        throw new Error(`La carpeta origen debe contener un archivo 'SKILL.md'.`);
    }

    try {
        if (!fs.existsSync(mcpDir)) {
            fs.mkdirSync(mcpDir, { recursive: true });
        }

        const zip = new AdmZip();
        zip.addLocalFolder(fullSourcePath);
        zip.writeZip(targetZipPath);

        return {
            success: true,
            message: `Habilidad '${skillName}' empaquetada y guardada en ${targetZipPath}`,
            path: targetZipPath
        };
    } catch (e: any) {
        throw new Error(`Error empaquetando la habilidad: ${e.message}`);
    }
}

import AdmZip from 'adm-zip';
import { join } from 'path';

const mcpPath = 'C:\\Users\\kevin.rovira\\OneDrive - TKH\\Proyectos\\Agent-assist\\MCP';
const file = 'agent-development.zip';

try {
    const zip = new AdmZip(join(mcpPath, file));
    const skillEntry = zip.getEntry('SKILL.md');
    if (skillEntry) {
        console.log(skillEntry.getData().toString('utf8'));
    } else {
        console.log('SKILL.md not found');
    }
} catch (e) {
    console.error(`Error reading ${file}:`, e);
}

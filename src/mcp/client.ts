import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";

interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}

const activeClients: Map<string, Client> = new Map();
let mcpToolsCache: any[] = [];

export async function initMCPClient() {
    const mcpConfigPath = path.join(process.cwd(), 'MCP', 'mcp_servers.json');

    // Crea el archivo por defecto si no existe
    if (!fs.existsSync(mcpConfigPath)) {
        const defaultCfg: MCPConfig = {
            mcpServers: {
                "sqlite": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-sqlite", "test.db"]
                }
            }
        };
        fs.mkdirSync(path.join(process.cwd(), 'MCP'), { recursive: true });
        fs.writeFileSync(mcpConfigPath, JSON.stringify(defaultCfg, null, 4));
        console.log('[MCP] Creado archivo de configuración base en /MCP/mcp_servers.json');
    }

    try {
        const configRaw = fs.readFileSync(mcpConfigPath, 'utf8');
        const config: MCPConfig = JSON.parse(configRaw);

        for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
            console.log(`[MCP] Intentando inicializar servidor MCP: ${serverName}...`);
            await startMCPServer(serverName, serverConfig);
        }

        await refreshAvailableMCPTools();

    } catch (err: any) {
        console.error('[MCP] Error inicializando clientes MCP:', err.message);
    }
}

async function startMCPServer(name: string, config: MCPServerConfig) {
    try {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: {
                ...process.env as Record<string, string>,
                ...(config.env || {})
            }
        });

        const client = new Client({
            name: `AgentAssist-${name}`,
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        await client.connect(transport);
        activeClients.set(name, client);
        console.log(`[MCP] Servidor ${name} conectado exitosamente.`);
    } catch (err: any) {
        console.error(`[MCP] Fallo al conectar servidor ${name}:`, err.message);
    }
}

async function refreshAvailableMCPTools() {
    mcpToolsCache = [];
    for (const [name, client] of activeClients.entries()) {
        try {
            const result = await client.listTools();
            // Transformar las herramientas MCP a formato compatible LLM (OpenAI/Groq schemas)
            for (const tool of result.tools) {
                mcpToolsCache.push({
                    _serverName: name, // Identificador interno para saber a qué cliente llamar
                    type: "function",
                    function: {
                        name: tool.name,
                        description: `[MCP: ${name}] ${tool.description || ''}`,
                        parameters: tool.inputSchema
                    }
                });
            }
        } catch (err: any) {
            console.error(`[MCP] Error listando herramientas de ${name}:`, err.message);
        }
    }
    console.log(`[MCP] Cargadas un total de ${mcpToolsCache.length} herramientas en el ecosistema.`);
}

export function getMCPTools() {
    return mcpToolsCache;
}

export async function executeMCPTool(toolName: string, args: any) {
    // Buscar a qué servidor MCP pertenece la herramienta
    const cachedTool = mcpToolsCache.find(t => t.function.name === toolName);
    if (!cachedTool) return `Error: Herramienta MCP '${toolName}' no encontrada en el ecosistema activo.`;

    const client = activeClients.get(cachedTool._serverName);
    if (!client) return `Error: Servidor MCP '${cachedTool._serverName}' está desconectado.`;

    try {
        console.log(`[MCP] Ejecutando '${toolName}' vía servidor remoto '${cachedTool._serverName}' con args:`, args);
        const result = await client.callTool({
            name: toolName,
            arguments: args
        });

        // Transformar content blocks del MCP
        if (result.isError) {
            return `Error interno del Servidor MCP: ${JSON.stringify(result.content)}`;
        }

        let outText = '';
        for (const block of result.content as any[]) {
            if (block.type === 'text') outText += block.text + "\n";
            else outText += `[Contenido Binario/Imagen omitido del MCP]`;
        }
        return outText.trim();

    } catch (err: any) {
        return `Excepción conectando al cliente MCP durante la herramienta: ${err.message}`;
    }
}

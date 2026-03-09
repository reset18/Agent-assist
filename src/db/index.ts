import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DB_PATH || join(process.cwd(), 'data', 'memory.db');

export function initDb() {
    // Asegurar que el directorio de la base de datos existe
    const dbDir = dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        console.log(`[DB] Creando directorio para la base de datos: ${dbDir}`);
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new Database(dbPath);
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Migración manual: Añadir columnas si no existen
    try {
        // sessions.platform
        const sessionsCols = db.prepare("PRAGMA table_info(sessions)").all() as any[];
        const hasPlatform = sessionsCols.some(col => col.name === 'platform');
        if (!hasPlatform) {
            console.log("[DB] Migración: Añadiendo columna 'platform' a la tabla 'sessions'...");
            db.exec("ALTER TABLE sessions ADD COLUMN platform TEXT NOT NULL DEFAULT 'web'");
        }

        // messages.session_id
        const messagesCols = db.prepare("PRAGMA table_info(messages)").all() as any[];
        const hasSessionId = messagesCols.some(col => col.name === 'session_id');
        if (!hasSessionId) {
            console.log("[DB] Migración: Añadiendo columna 'session_id' a la tabla 'messages'...");
            db.exec("ALTER TABLE messages ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'");
        }
    } catch (err) {
        console.error("[DB] Error en migración:", err);
    }

    console.log(`[DB] Base de datos SQLite inicializada en ${dbPath}`);
}

export function getSetting(key: string): string | null {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result ? result.value : null;
}

export function setSetting(key: string, value: string) {
    console.log(`[DB] Guardando Setting -> ${key}: ${key === 'llm_api_key' ? value.substring(0, 5) + '...' : value}`);
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, value);
}

export function addMessage(role: string, content: string, sessionId = 'default') {
    const stmt = db.prepare('INSERT INTO messages (role, content, session_id) VALUES (?, ?, ?)');
    stmt.run(role, content, sessionId);
}

export function getRecentMessages(limit = 20, sessionId = 'default') {
    const stmt = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?');
    const rows = stmt.all(sessionId, limit) as { role: string; content: string }[];
    return rows.reverse();
}

export function createSession(id: string, name: string, platform = 'web') {
    const stmt = db.prepare('INSERT OR IGNORE INTO sessions (id, name, platform) VALUES (?, ?, ?)');
    stmt.run(id, name, platform);
}

export function getSessions() {
    return db.prepare('SELECT id, name, platform FROM sessions ORDER BY timestamp DESC').all() as { id: string, name: string, platform: string }[];
}

export function clearMessages(sessionId?: string) {
    if (sessionId) {
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    } else {
        db.prepare('DELETE FROM messages').run();
    }
}

export function isToolEnabled(toolName: string): boolean {
    const stmt = db.prepare('SELECT enabled FROM tools_config WHERE tool_name = ?');
    const result = stmt.get(toolName) as { enabled: number } | undefined;
    if (result === undefined) return true; // Por defecto las tools están activadas
    return result.enabled === 1;
}

export function setToolEnabled(toolName: string, enabled: boolean) {
    const stmt = db.prepare('INSERT OR REPLACE INTO tools_config (tool_name, enabled) VALUES (?, ?)');
    stmt.run(toolName, enabled ? 1 : 0);
}

export function getDbInstance() {
    return new Database(dbPath);
}

const db = new Database(dbPath);
export default db;

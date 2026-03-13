import Database from 'better-sqlite3';
import fs, { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = process.cwd();
const dbPath = process.env.DB_PATH
    ? (process.env.DB_PATH.startsWith('.') ? join(projectRoot, process.env.DB_PATH) : process.env.DB_PATH)
    : join(projectRoot, 'data', 'memory.db');

// Asegurar que el directorio de la base de datos existe ANTES de cualquier conexión
const dbDir = dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    console.log(`[DB] Creando directorio persistente: ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

export function initDb() {
    const schemaPath = join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error(`[DB] ERROR CRÍTICO: No se encuentra el esquema en ${schemaPath}`);
        return;
    }
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

        db.exec(`
            CREATE TABLE IF NOT EXISTS tool_runtime_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT 'default',
                source TEXT NOT NULL DEFAULT 'web',
                tool_name TEXT NOT NULL DEFAULT 'unknown',
                reason TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL DEFAULT 'global',
                session_id TEXT,
                kind TEXT NOT NULL DEFAULT 'fact',
                content TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.6,
                source TEXT NOT NULL DEFAULT 'agent',
                fingerprint TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at DESC)`);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_fingerprint ON memories(fingerprint)`);

        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_memory_enabled', '1')").run();
    } catch (err) {
        console.error("[DB] Error en migración:", err);
    }

    console.log(`[DB] Base de datos inicializada correctamente en: ${dbPath}`);
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
    const stmt = db.prepare('SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?');
    const rows = stmt.all(sessionId, limit) as { role: string; content: string; timestamp: string }[];
    return rows.reverse();
}

export function addToolRuntimeMetric(eventType: string, sessionId: string, source: string, toolName: string, reason?: string) {
    const stmt = db.prepare('INSERT INTO tool_runtime_metrics (event_type, session_id, source, tool_name, reason) VALUES (?, ?, ?, ?, ?)');
    stmt.run(eventType, sessionId || 'default', source || 'web', toolName || 'unknown', reason || null);
}

export function getToolRuntimeMetricsHistory(hours = 24) {
    const safeHours = Number.isFinite(hours) && hours > 0 ? Math.min(Math.max(Math.floor(hours), 1), 168) : 24;
    const stmt = db.prepare(`
        SELECT
            strftime('%Y-%m-%d %H:%M', timestamp) AS bucket,
            SUM(CASE WHEN event_type = 'before' THEN 1 ELSE 0 END) AS beforeBlocked,
            SUM(CASE WHEN event_type = 'after' THEN 1 ELSE 0 END) AS afterSuccess,
            SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) AS onError,
            SUM(CASE WHEN event_type = 'loop_warning' THEN 1 ELSE 0 END) AS loopWarnings,
            SUM(CASE WHEN event_type = 'loop_block' THEN 1 ELSE 0 END) AS loopBlocks
        FROM tool_runtime_metrics
        WHERE timestamp >= datetime('now', ?)
        GROUP BY bucket
        ORDER BY bucket ASC
    `);
    return stmt.all(`-${safeHours} hours`) as Array<{
        bucket: string;
        beforeBlocked: number;
        afterSuccess: number;
        onError: number;
        loopWarnings: number;
        loopBlocks: number;
    }>;
}

export function createSession(id: string, name: string, platform = 'web') {
    const stmt = db.prepare('INSERT OR IGNORE INTO sessions (id, name, platform) VALUES (?, ?, ?)');
    stmt.run(id, name, platform);
}

export function deleteSession(id: string) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
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

export function addTokenUsage(provider: string, tokens: number) {
    const stmt = db.prepare('INSERT INTO tokens_usage (provider, tokens_count) VALUES (?, ?)');
    stmt.run(provider, tokens);
}

export function getTokenUsageToday() {
    const stmt = db.prepare("SELECT provider, SUM(tokens_count) as total FROM tokens_usage WHERE date = date('now') GROUP BY provider");
    return stmt.all() as { provider: string, total: number }[];
}

export function getTokenUsageHistory(days = 7) {
    const stmt = db.prepare("SELECT date, provider, SUM(tokens_count) as total FROM tokens_usage WHERE date >= date('now', ?) GROUP BY date, provider ORDER BY date DESC");
    return stmt.all(`-${days} days`) as { date: string, provider: string, total: number }[];
}

export function getDbInstance() {
    return db;
}

export type MemoryScope = 'global' | 'session';

export interface MemoryRecord {
    id: number;
    scope: MemoryScope;
    session_id: string | null;
    kind: string;
    content: string;
    confidence: number;
    source: string;
    fingerprint: string;
    created_at: string;
    updated_at: string;
}

export interface MemoryInsertInput {
    scope?: MemoryScope;
    sessionId?: string | null;
    kind?: string;
    content: string;
    confidence?: number;
    source?: string;
}

function normalizeMemoryContent(content: string): string {
    return String(content || '').replace(/\s+/g, ' ').trim();
}

function createMemoryFingerprint(scope: MemoryScope, sessionId: string | null, kind: string, content: string): string {
    const key = `${scope}|${sessionId || ''}|${kind}|${normalizeMemoryContent(content).toLowerCase()}`;
    return createHash('sha1').update(key).digest('hex');
}

export function addOrUpdateMemory(input: MemoryInsertInput): number {
    const scope: MemoryScope = input.scope === 'session' ? 'session' : 'global';
    const sessionId = scope === 'session' ? (input.sessionId || 'default') : null;
    const kind = (input.kind || 'fact').trim() || 'fact';
    const content = normalizeMemoryContent(input.content);
    if (!content) return -1;
    const confidenceRaw = Number(input.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0.6;
    const source = (input.source || 'agent').trim() || 'agent';
    const fingerprint = createMemoryFingerprint(scope, sessionId, kind, content);

    const existing = db.prepare('SELECT id FROM memories WHERE fingerprint = ?').get(fingerprint) as { id: number } | undefined;
    if (existing?.id) {
        db.prepare('UPDATE memories SET content = ?, confidence = ?, source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(content, confidence, source, existing.id);
        return existing.id;
    }

    const result = db.prepare(
        'INSERT INTO memories (scope, session_id, kind, content, confidence, source, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(scope, sessionId, kind, content, confidence, source, fingerprint);
    return Number(result.lastInsertRowid);
}

export function listMemories(options?: { scope?: MemoryScope | 'all'; sessionId?: string; q?: string; limit?: number }): MemoryRecord[] {
    const scope = options?.scope || 'all';
    const sessionId = options?.sessionId;
    const q = (options?.q || '').trim();
    const limitRaw = Number(options?.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 100;

    const where: string[] = [];
    const args: any[] = [];

    if (scope !== 'all') {
        where.push('scope = ?');
        args.push(scope);
    }

    if (sessionId) {
        where.push("(session_id = ? OR (scope = 'global'))");
        args.push(sessionId);
    }

    if (q) {
        where.push('content LIKE ?');
        args.push(`%${q}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const stmt = db.prepare(`SELECT * FROM memories ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT ?`);
    return stmt.all(...args, limit) as MemoryRecord[];
}

export function deleteMemory(id: number): boolean {
    const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
}

export function clearMemories(options?: { scope?: MemoryScope | 'all'; sessionId?: string }): number {
    const scope = options?.scope || 'all';
    const sessionId = options?.sessionId;

    if (scope === 'all') {
        const result = db.prepare('DELETE FROM memories').run();
        return result.changes;
    }

    if (scope === 'session') {
        if (sessionId) {
            const result = db.prepare('DELETE FROM memories WHERE scope = ? AND session_id = ?').run('session', sessionId);
            return result.changes;
        }
        const result = db.prepare('DELETE FROM memories WHERE scope = ?').run('session');
        return result.changes;
    }

    const result = db.prepare('DELETE FROM memories WHERE scope = ?').run('global');
    return result.changes;
}

export function getMemoryStats(sessionId?: string) {
    const total = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
    const global = db.prepare('SELECT COUNT(*) as c FROM memories WHERE scope = ?').get('global') as { c: number };
    const session = sessionId
        ? (db.prepare('SELECT COUNT(*) as c FROM memories WHERE scope = ? AND session_id = ?').get('session', sessionId) as { c: number })
        : (db.prepare('SELECT COUNT(*) as c FROM memories WHERE scope = ?').get('session') as { c: number });

    return {
        total: total.c || 0,
        global: global.c || 0,
        session: session.c || 0,
    };
}

// ==========================
// MÚLTIPLES CUENTAS (Fase 11)
// ==========================

export interface LLMAccount {
    id: string;
    provider: string;
    name: string;
    apiKey: string;
    isOauth: boolean;
    refreshToken: string | null;
    model?: string;
}

export function getLLMAccounts(): LLMAccount[] {
    const data = getSetting('llm_accounts');
    if (!data) return [];
    try {
        return JSON.parse(data);
    } catch {
        return [];
    }
}

export function saveLLMAccount(account: LLMAccount) {
    const accounts = getLLMAccounts();
    const idx = accounts.findIndex((a: LLMAccount) => a.id === account.id);
    if (idx !== -1) {
        accounts[idx] = account;
    } else {
        accounts.push(account);
    }
    setSetting('llm_accounts', JSON.stringify(accounts));
}

export function removeLLMAccount(accountId: string) {
    const accounts = getLLMAccounts().filter((a: LLMAccount) => a.id !== accountId);
    setSetting('llm_accounts', JSON.stringify(accounts));
}

export default db;

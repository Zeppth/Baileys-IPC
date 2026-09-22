import { DatabaseSync } from 'node:sqlite';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

const DBC = new Map();

export default async function SQLiteAuthState(DBPath, instanceId, options = {}) {
    if (typeof DBPath !== 'string') throw new Error('DBPath must be a string');
    if (typeof instanceId !== 'string') throw new Error('instanceId must be a string');
    const { autoPurge = false } = options;

    if (!DBC.has(DBPath)) {
        const database = new DatabaseSync(DBPath);
        database.exec('PRAGMA journal_mode = WAL;');
        database.exec('PRAGMA synchronous = NORMAL;');
        database.exec('PRAGMA busy_timeout = 5000;');
        DBC.set(DBPath, database);
    }

    const db = DBC.get(DBPath);

    db.exec(`CREATE TABLE IF NOT EXISTS baileys_sessions (
        instance_id TEXT NOT NULL, key_type TEXT NOT NULL,
        key_id TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (instance_id, key_type, key_id)
    );
    CREATE INDEX IF NOT EXISTS idx_instance_session ON baileys_sessions(instance_id);`);

    const selectStmt = db.prepare(`SELECT value FROM baileys_sessions WHERE instance_id = ? AND key_type = ? AND key_id = ?`);
    const insertStmt = db.prepare(`INSERT OR REPLACE INTO baileys_sessions (instance_id, key_type, key_id, value) VALUES (?, ?, ?, ?)`);
    const deleteStmt = db.prepare(`DELETE FROM baileys_sessions WHERE instance_id = ? AND key_type = ? AND key_id = ?`);
    const clearInstanceStmt = db.prepare(`DELETE FROM baileys_sessions WHERE instance_id = ?`);
    const purgeKeysStmt = db.prepare(`DELETE FROM baileys_sessions WHERE instance_id = ? AND key_type = 'pre-key'`);

    let creds;
    try {
        const rawCreds = selectStmt.get(instanceId, 'credential', 'creds');
        creds = rawCreds ? JSON.parse(rawCreds.value, BufferJSON.reviver) : initAuthCreds();
    } catch (e) {
        console.error(`[SQLiteAuthState] ERROR creds ${instanceId}`, e);
        creds = initAuthCreds();
    }

    const keys = {
        set: (data) => {
            db.exec('BEGIN TRANSACTION;');
            try {
                for (const category in data) for (const id in data[category]) {
                    const value = data[category][id];
                    if (value) insertStmt.run(instanceId, category, String(id),
                        JSON.stringify(value, BufferJSON.replacer));
                    else deleteStmt.run(instanceId, category, String(id));
                }

                if (autoPurge && data['pre-key']) {
                    purgeKeysStmt.run(instanceId);
                }
                db.exec('COMMIT;');
            } catch (error) {
                db.exec('ROLLBACK;');
                console.error(`[SQLiteAuthState] ERROR set ${instanceId}:`, error);
            }
        },
        get: (type, ids) => {
            const data = {};
            try {
                for (const id of ids) {
                    const row = selectStmt.get(instanceId, type, String(id));
                    if (row) data[id] = JSON.parse(row.value, BufferJSON.reviver);
                }
            } catch (error) {
                console.error(`[SQLiteAuthState] ERROR get ${type} ${instanceId}:`, error);
            }
            return data;
        },
    };

    return {
        state: { creds, keys },
        saveCreds: () => {
            try {
                insertStmt.run(instanceId, 'credential', 'creds',
                    JSON.stringify(creds, BufferJSON.replacer)
                );
            } catch (error) {
                console.error(`[SQLiteAuthState] ERROR saveCreds ${instanceId}:`, error);
            }
        },
        clearSession: () => {
            try {
                clearInstanceStmt.run(instanceId);
                console.log(`[SQLiteAuthState] clearSession: ${instanceId}`);
            } catch (error) {
                console.error(`[SQLiteAuthState] ERROR clearSession ${instanceId}:`, error);
            }
        }
    };
}
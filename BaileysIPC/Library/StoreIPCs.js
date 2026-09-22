import { DatabaseSync } from 'node:sqlite';
import path from 'path';

export class StoreIPCs {
    /**
     * Initializes the SQLite database connection and prepares statements for session management.
     * @param {string} [storagePath='./storage/'] - Directory path where the 'data.db' database file is located.
     */
    constructor(storagePath = './storage/') {
        const dbPath = path.join(storagePath, 'data.db');
        this.db = new DatabaseSync(dbPath);
        
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
        this.db.exec('PRAGMA busy_timeout = 5000;');

        this.db.exec(`CREATE TABLE IF NOT EXISTS baileys_sessions (
            instance_id TEXT NOT NULL, key_type TEXT NOT NULL,
            key_id TEXT NOT NULL, value TEXT NOT NULL,
            PRIMARY KEY (instance_id, key_type, key_id)
        );`);

        this.stmtList = this.db.prepare(`SELECT DISTINCT instance_id FROM baileys_sessions`);
        this.stmtGetCreds = this.db.prepare(`SELECT value FROM baileys_sessions WHERE instance_id = ? AND key_type = 'credential' AND key_id = 'creds'`);
        this.stmtDelete = this.db.prepare(`DELETE FROM baileys_sessions WHERE instance_id = ?`);
    }

    /**
     * Retrieves a list of all unique instance IDs stored in the database.
     * @returns {string[]} An array of instance identifiers.
     */
    list() {
        const rows = this.stmtList.all();
        return rows.map(row => row.instance_id);
    }

    /**
     * Checks if a valid credential record exists for a specific instance.
     * @param {string} InstanceId - The unique identifier of the instance.
     * @returns {boolean} True if credentials exist, false otherwise.
     */
    has(InstanceId) {
        if (typeof InstanceId !== 'string') return false;
        const row = this.stmtGetCreds.get(InstanceId);
        return Boolean(row);
    }

    /**
     * Retrieves and parses the credentials object for a specific instance.
     * @param {string} InstanceId - The unique identifier of the instance.
     * @returns {Object|undefined} The parsed credentials object, or undefined if not found/error.
     */
    getCreds(InstanceId) {
        if (!InstanceId) return undefined;
        const row = this.stmtGetCreds.get(InstanceId);
        if (!row) return undefined;

        try { return JSON.parse(row.value); } catch (e) {
            console.error(`[InstanceStore] ERROR creds ${InstanceId}:`, e);
            return undefined;
        }
    }

    /**
     * Deletes all database records associated with a specific instance ID.
     * @param {string} InstanceId - The unique identifier of the instance to delete.
     * @returns {boolean} True if any records were deleted, false otherwise.
     */
    delete(InstanceId) {
        if (!InstanceId) return false;
        const result = this.stmtDelete.run(InstanceId);
        return result.changes > 0;
    }
}
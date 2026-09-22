import { StoreIPCs } from "./StoreIPCs.js";
import { InstanceIPC } from "./InstanceIPC.js";
import path from "path";
import fs from "fs";

export class BaileysIPC {
    /**
     * Creates a manager for multiple Baileys client instances.
     * @param {string} StoragePath - Path where session data and databases will be stored.
     */
    constructor(StoragePath) {
        this.instances = new Map();
        fs.mkdirSync(path.resolve(StoragePath), { recursive: true });
        this.StoreIPCs = new StoreIPCs(StoragePath)
        this.storagePath = StoragePath
    }

    /**
     * Creates and runs a new WhatsApp client instance.
     * @param {string} InstanceId - A unique non-empty string identifier for the instance.
     * @param {Object} ConnectOptions - Connection options configuration.
     * @param {string} ConnectOptions.connectType - Type of connection ('qr-code' or 'pin-code').
     * @param {string} [ConnectOptions.phoneNumber] - Phone number required if connectType is 'pin-code'.
     * @param {string} [ConnectOptions.customCode] - Optional custom pairing code.
     * @returns {InstanceIPC} The created client instance.
     */
    createInstance(InstanceId, ConnectOptions) {
        if (typeof InstanceId !== 'string' || !InstanceId.trim())
            throw new TypeError('instanceId must be a non-empty string');
        if (typeof ConnectOptions?.connectType !== 'string')
            throw new TypeError('connectType must be a string');
        if (ConnectOptions.connectType === 'pin-code' && !ConnectOptions.phoneNumber)
            throw new Error('phoneNumber is required for pin-code connection');

        if (this.instances.has(InstanceId))
            throw new Error(`Instance "${InstanceId}" is already running`);

        const instance = new InstanceIPC(
            this.storagePath, this.StoreIPCs,
            InstanceId, ConnectOptions);

        this.instances.set(InstanceId, instance);
        return instance;
    }

    /**
     * Destroys an active instance and deletes its stored session data.
     * @param {string} InstanceId - The identifier of the instance to destroy.
     * @returns {Promise<boolean>} True when successfully destroyed.
     */
    async destroyInstance(InstanceId) {
        if (typeof InstanceId !== 'string' || !InstanceId.trim())
            throw new TypeError('instanceId must be a non-empty string');

        const instance = this.instances.get(InstanceId);
        if (instance) (await instance.destroy(),
            this.instances.delete(InstanceId));
            
        this.StoreIPCs.delete(InstanceId);
        return true;
    }

    /**
     * Checks if an instance exists either in memory or stored in the database.
     * @param {string} InstanceId - The instance identifier to check.
     * @returns {boolean} True if found.
     */
    hasStoredInstance(InstanceId) {
        return this.StoreIPCs.has(InstanceId)
            || this.instances.has(InstanceId);
    }

    /**
     * Retrieves an array of all active instance identifiers.
     * @returns {string[]} List of active instance IDs.
     */
    InstancesActive() {
        return Array.from(this.instances.keys())
    }

    /**
     * Checks if an instance is currently active in memory.
     * @param {string} InstanceId - The instance identifier.
     * @returns {boolean} True if running.
     */
    hasInstance(InstanceId) {
        return this.instances.has(InstanceId);
    }

    /**
     * Gets an active instance by its identifier.
     * @param {string} InstanceId - The instance identifier.
     * @returns {InstanceIPC|undefined} The instance object if active.
     */
    getInstance(InstanceId) {
        return this.instances.get(InstanceId)
    }
}
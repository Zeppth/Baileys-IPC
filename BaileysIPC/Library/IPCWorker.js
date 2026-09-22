// ./library/worker.js

import path from "path";
import { Worker } from "worker_threads";

export class IPCWorker {
    /**
     * Creates an IPCWorker instance.
     * @param {string} filePath - Path to the worker script file.
     * @param {Object} options - Initialization options to pass via workerData.
     */
    constructor(filePath, options) {

        if (typeof options == 'undefined')
            throw new Error('options:required');

        this.filePath = path.resolve(filePath);

        this.status = 'stop';
        this.options = options;
        this.startTime = null;
        this.worker = null;

        this.eventExit = null;
        this.eventMessage = null;
        this.eventError = null;
    }

    /**
     * Gets the uptime of the worker in milliseconds.
     * @returns {number|null} Uptime in milliseconds or null if not running.
     */
    get uptime() {
        if (!this.startTime) return null;
        return Date.now() - this.startTime;
    }

    /**
     * Sends a message to the worker thread.
     * @param {...any} args - Arguments to pass to worker's postMessage.
     * @returns {any|null} PostMessage result or null if worker is not active.
     */
    send(...args) {
        if (!this.worker) return null;
        try { return this.worker.postMessage(...args) }
        catch (e) { return console.error(e); }
    }

    /**
     * Binds internal event listeners to the underlying worker thread.
     */
    ev() {
        if (!this.worker) return;

        this.worker.on('message', async (m) => {
            if (typeof this.eventMessage === 'function') {
                try { return await this.eventMessage(m, this) }
                catch (e) { console.error('Error handling message:', e) }
            }
        });

        this.worker.on('exit', async (code) => {
            if (this.status !== 'stop') setTimeout(
                () => this.start(), 5000);

            if (typeof this.eventExit === 'function') {
                try { return await this.eventExit({ code, signal: null }, this) }
                catch (e) { console.error('Error handling exit event:', e) }
            }
        });

        this.worker.on('error', async (err) => {
            if (typeof this.eventError === 'function') {
                try { return await this.eventError(err, this) }
                catch (e) { console.error('Error handling error event:', e) }
            }
        });
    }

    /**
     * Terminates the worker thread and updates its status to stopped.
     * @param {Function} [func] - Optional callback function to execute after stopping.
     * @returns {Promise<any>}
     */
    async stop(func) {
        try {
            this.status = 'stop';
            if (this.worker) await this
                .worker.terminate();
            this.worker = null;

            if (typeof func === 'function')
                return await func(this);
        } catch (error) {
            console.error('worke stop error', error);
        }
    }

    /**
     * Starts or restarts the worker thread.
     * @param {Function} [func] - Optional callback function to execute after starting.
     * @returns {Promise<any>}
     */
    async start(func) {
        try {
            if (this.worker) await this.stop();
            const development = structuredClone(this.options);
            this.worker = new Worker(this.filePath,
                { workerData: development });
            this.status = 'running';
            this.startTime = Date.now();
            this.ev();

            if (typeof func === 'function') {
                return await func(this);
            }
        } catch (e) {
            this.status = 'stop';
            console.error('worker start error:', e);
        }
    }
}
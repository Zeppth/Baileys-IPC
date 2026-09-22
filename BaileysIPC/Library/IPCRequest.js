import { generateId } from "./IPCStreams.js";

export class IPCRequest {
    /**
     * Manages asynchronous request-response cycles between main thread and worker threads via IPC.
     * @param {Function} sendCallback - Function used to dispatch messages to the worker.
     */
    constructor(sendCallback) {
        this.requests = new Map();
        this.send = sendCallback;
    }

    /**
     * Sends an IPC request and returns a promise that awaits the worker's response.
     * @param {Object} object - The payload to send.
     * @param {number} [timeout=10000] - Timeout duration in milliseconds.
     * @returns {Promise<any>} Response promise.
     */
    send(object, timeout = 10000) {
        const requestId = generateId();
        return new Promise((resolve, reject) => {

            const timer = timeout ? setTimeout(() => {
                if (!this.requests.has(requestId)) return;
                this.reject(requestId, `Timeout [${requestId}]`);
            }, timeout) : null;

            this.requests.set(requestId, { resolve, reject, timer });

            if (typeof this.send === 'function') {
                this.send({ ...object, requestId });
            }
        });
    }

    /**
     * Resolves a pending IPC request by its unique ID.
     * @param {string} requestId - The unique identifier of the request.
     * @param {any} data - The data returned from the worker.
     * @returns {boolean} True if successfully resolved, false otherwise.
     */
    resolve(requestId, data) {
        if (!this.requests.has(requestId)) return false;
        const { resolve, timer } = this.requests.get(requestId);
        if (timer) clearTimeout(timer); this.requests.delete(requestId);
        resolve(data); return true;
    }

    /**
     * Rejects a pending IPC request due to an error or timeout.
     * @param {string} requestId - The unique identifier of the request.
     * @param {string|Error} errorMessage - The error message or Error object.
     * @returns {boolean} True if successfully rejected, false otherwise.
     */
    reject(requestId, errorMessage) {
        if (!this.requests.has(requestId)) return false;
        const { reject, timer } = this.requests.get(requestId);
        if (timer) clearTimeout(timer); this.requests.delete(requestId);
        reject(errorMessage instanceof Error
            ? errorMessage : new Error(errorMessage));
        return true;
    }

    /**
     * Clears and rejects all active pending requests with a reason.
     * @param {string} [reason='Worker stopped'] - The rejection reason.
     */
    clear(reason = 'Worker stopped') {
        for (const [requestId, { reject, timer }]
            of this.requests.entries()) {
            if (timer) clearTimeout(timer);
            reject(new Error(reason));
        }; this.requests.clear();
    }
}
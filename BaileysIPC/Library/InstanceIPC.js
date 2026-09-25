import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";

import { IPCWorker } from "./IPCWorker.js";
import { IPCRequest } from "./IPCRequest.js";
import { IPCProxy } from "./IPCProxy.js";

import { InterceptBaileys } from "./InterceptBaileys.js";
import { StreamReceiver, StreamSender } from "./IPCStreams.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class InstanceIPC extends EventEmitter {
    /**
    * Manages a single Baileys worker instance and its IPC communication.
    * @param {string} Storage - Path to the storage folder.
    * @param {InstanceStore} StoreIPCs - The database instance store manager.
    * @param {string} InstanceId - Unique identifier for this instance.
    * @param {Object} [ConnectOptions] - Connection settings.
    */
    constructor(Storage, StoreIPCs,
        InstanceId, ConnectOptions = {
            connectType: 'qr-code',
            phoneNumber: '000000000',
            customCode: '123abc'
        }) {

        super();
        this.responses = new Map();
        this.instanceId = InstanceId;
        this.StoreIPCs = StoreIPCs

        this.PATHFILEWORKER = path.resolve(
            __dirname, '../Worker/index.js');

        this.STORAGE = Storage || path.resolve('./storage/')

        this.worker = new IPCWorker(this.PATHFILEWORKER, {
            ...ConnectOptions, STORAGE: this.STORAGE,
            INSTANCEID: InstanceId
        });

        this.streamSender = new StreamSender(this
            .worker.send.bind(this.worker));

        this.streamReceiver = new StreamReceiver(this
            .worker.send.bind(this.worker));

        this.IPCRequest = new IPCRequest(this
            .worker.send.bind(this.worker));

        // eventExit
        this.worker.eventExit = (exitInfo) => {
            this.streamSender.clear('Worker terminated');
            this.streamReceiver.clear('Worker terminated');
            this.IPCRequest.clear('Worker terminated');

            super.emit('exit', exitInfo);
        };

        // eventMessage
        this.worker.eventMessage = async (msg, instance) => {

            // streamSender
            if (msg.type === 'STREAM_READY') return this
                .streamSender.start(msg.streamId);

            // streamReceiver
            if (msg.type === 'MAIN_STREAM_CHUNK') return this
                .streamReceiver.write(msg.streamId, msg.chunk);
            if (msg.type === 'MAIN_STREAM_ERROR') return this
                .streamReceiver.abort(msg.streamId, msg.error);
            if (msg.type === 'MAIN_STREAM_END') return this
                .streamReceiver.end(msg.streamId);

            // IPCRequest
            if (msg.requestId && msg.status === 'success') this
                .IPCRequest.resolve(msg.requestId, msg.data);
            else if (msg.requestId && msg.status === 'error') this
                .IPCRequest.reject(msg.requestId, msg.error);

            //connetion
            if (msg.type === 'connection_open') {
                this.Intercept.user = msg.data;
                this.sock.user = msg.data;
                this.conn.user = msg.data;
            }

            else if (msg.type === 'connection_close') {
                if (msg.action === 'restart') {
                    instance.options.connectType = 'qr-code';
                    await instance.stop();
                    await instance.start();

                }
                else if (msg.action === 'stop') {
                    await instance.stop();
                }
            }

            // connection
            if (msg.event === 'connection') {
                super.emit('connection.update', msg)
            }
            // messages
            if (msg.event === 'messages') {
                super.emit('messages.upsert', msg.data)
            }
        };

        this.Intercept = new InterceptBaileys(this);
        this.sock = new IPCProxy(this.request
            .bind(this), this.Intercept);
        this.conn = this.sock;
    }

    /**
     * Sends a raw IPC request payload to the background worker thread.
     * @param {Object} object - The request payload object containing PATH and ARGS.
     * @param {number} [timeout=10000] - Request timeout limit in milliseconds.
     * @returns {Promise<any>} A promise that resolves with the worker's response data.
     */
    request(object, timeout = 10000) {
        if (this.worker.status === 'stop') return null;
        return this.IPCRequest.send(object, timeout)
    };

    /**
    * Logs out the WhatsApp session, stops the worker, and clears stored data.
    * @returns {Promise<boolean>} True when cleanup is complete.
    */
    async destroy() {
        await this.sock.logout()
        await this.stop();
        this.StoreIPCs.delete(
            this.instanceId);
        return true
    }

    /**
    * Starts the background worker thread.
    * @param {Function} [func] - Optional callback function executed upon start.
    * @returns {Promise<any>}
    */
    async start(func) {
        if (typeof func === 'function')
            return await func(this);
        else return this.worker.start()
    }

    /**
     * Stops the background worker thread and clears active streams/requests.
     * @param {Function} [func] - Optional callback function executed upon stop.
     * @returns {Promise<any>}
     */
    async stop(func) {
        this.streamSender.clear('Instance stopped');
        this.streamReceiver.clear('Instance stopped');
        this.IPCRequest.clear('Instance stopped');

        if (typeof func === 'function')
            return await func(this);
        else return this.worker.stop()
    }
}

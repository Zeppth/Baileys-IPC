import crypto from "crypto"
import { pipeline } from "stream/promises"
import fs from "fs"

import {
    Stream,
    Readable,
    PassThrough,
    Writable
} from "stream"

export const _ = {}

/**
 * Generates a random hexadecimal uppercase ID string.
 * @param {number} [number=6] - Number of random bytes to generate.
 * @returns {string} The generated uppercase hex ID.
 */
export const generateId = (number = 6) => crypto
    .randomBytes(number).toString('hex')
    .toUpperCase()

/**
* Checks if an object is any kind of Node.js stream.
* @param {any} object - The target to check.
* @returns {boolean} True if it's a stream instance.
*/
export const isStream = (object) => {
    if (object instanceof Stream) return true;
    if (object instanceof Readable) return true;
    if (object instanceof Writable) return true;
    if (object instanceof PassThrough) return true;
    return false;
}

/**
 * Checks if an object is a Node.js Buffer.
 * @param {any} object - The target to check.
 * @returns {boolean} True if it's a Buffer.
 */
export const isBuffer = (object) => {
    if (Buffer.isBuffer(object)) return true;
    return false;
}

/**
 * Creates a readable stream from a file path.
 * @param {string} filePath - Path to the file.
 * @returns {fs.ReadStream} The file read stream.
 */
export const FileToStream = (filePath) => {
    if (!filePath || typeof filePath !== 'string')
        throw new Error('Invalid file path');
    if (!fs.existsSync(filePath))
        throw new Error('File not found');
    return fs.createReadStream(filePath);
};

/**
 * Converts a Buffer or binary input into a Readable stream.
 * @param {Buffer|Uint8Array|string} input - The input data to convert.
 * @returns {Readable} A readable stream containing the buffer.
 */
export const BufferToStream = (input) => {
    if (!input) throw new Error('Input is required');
    const buffer = Buffer.isBuffer(input)
        ? input : Buffer.from(input);
    return Readable.from(buffer);
};

/**
 * Pipes a readable stream directly into a destination file path.
 * @param {Readable} inputStream - The source stream to read from.
 * @param {string} destPath - The destination file path.
 * @returns {Promise<boolean>} True when the file write is complete.
 */
export const StreamToFile = async (inputStream, destPath) => {
    if (!inputStream) throw new Error('Input stream is required');
    if (!destPath || typeof destPath !== 'string')
        throw new Error('Invalid destination path');
    const outputStream = fs.createWriteStream(destPath);
    await pipeline(inputStream, outputStream);
    return true;
};

/**
 * Consumes a stream and converts all its data chunks into a single Buffer.
 * @param {Readable} stream - The stream to consume.
 * @returns {Promise<Buffer>} A promise that resolves with the combined Buffer.
 */
export const StreamToBuffer = async (stream) => {
    if (!stream) throw new Error('Stream is required');
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string'
            ? Buffer.from(chunk) : chunk);
    } return Buffer.concat(chunks);
};

export class StreamReceiver {
    /**
    * Creates a new StreamReceiver instance.
    * @param {Function} sendCallback - Callback function used to send messages/signals via IPC.
    */
    constructor(sendCallback) {
        this.streams = new Map();
        this.send = sendCallback;
    }

    /**
     * Initializes a PassThrough stream for an incoming stream ID and notifies readiness.
     * @param {string} streamId - The unique identifier of the stream.
     * @returns {PassThrough} The created pass-through stream.
     */
    init(streamId) {
        const pt = new PassThrough();
        this.streams.set(streamId, pt);
        if (typeof this.send === 'function') this.send(
            { type: 'STREAM_READY', streamId });
        return pt;
    }

    /**
     * Writes an incoming data chunk to the specified stream.
     * @param {string} streamId - The stream identifier.
     * @param {Buffer|Uint8Array} chunk - The data chunk to write.
     * @returns {boolean|undefined} False if the stream's internal buffer is full, otherwise true.
     */
    write(streamId, chunk) {
        return this.streams.get(streamId)
            ?.write(Buffer.from(chunk));
    }

    /**
     * Ends and removes a managed stream.
     * @param {string} streamId - The stream identifier.
     * @returns {boolean} True if the stream existed and was deleted.
     */
    end(streamId) {
        this.streams.get(streamId)?.end();
        return this.streams.delete(streamId);
    }

    /**
     * Aborts/destroys a stream with an error reason.
     * @param {string} streamId - The stream identifier.
     * @param {string} reason - The error reason message.
     * @returns {boolean} True if the stream existed and was deleted.
     */
    abort(streamId, reason) {
        this.streams.get(streamId)
            ?.destroy(new Error(reason));
        return this.streams.delete(streamId);
    }

    /**
    * Destroys all active incoming streams and clears the registry.
    * @param {string} [reason='Worker stopped'] - The reason for clearing.
    */
    clear(reason = 'Worker stopped') {
        for (const [streamId, stream]
            of this.streams.entries()) {
            stream.destroy(new Error(reason));
        }; this.streams.clear();
    }
}

export class StreamSender {
    /**
     * Creates a new StreamSender instance.
     * @param {Function} sendCallback - Callback function used to send data chunks via IPC.
     */
    constructor(sendCallback) {
        this.streams = new Map();
        this.send = sendCallback;
    }

    /**
    * Pauses and registers an outgoing stream, generating a token identifier.
    * @param {Readable} stream - The stream to prepare for sending.
    * @returns {{ __ipcStreamId: string }} The IPC stream tracking token object.
    */
    prepare(stream) {
        const streamId = generateId(8)
        if (typeof stream?.pause === 'function') {
            stream.pause()
        }
        this.streams.set(streamId, stream)
        return { __ipcStreamId: streamId }
    }

    /**
     * Starts listening to data events on a registered stream and transmits chunks via IPC.
     * @param {string} streamId - The stream tracking identifier.
     * @returns {boolean} True if the stream started successfully, false if not found.
     */
    start(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) return false;

        stream.on('data', (chunk) => {
            const arr = chunk.buffer.slice(chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength);

            if (typeof this.send === 'function') this.send({
                type: 'MAIN_STREAM_CHUNK',
                streamId, chunk: arr
            }, [arr]);
        });

        stream.on('end', () => {
            if (typeof this.send === 'function') this.send(
                { type: 'MAIN_STREAM_END', streamId });
            this.streams.delete(streamId);
        });

        stream.on('error', (err) => {
            if (typeof this.send === 'function') this.send({
                type: 'MAIN_STREAM_ERROR',
                streamId, error: err.message
            });

            this.streams.delete(streamId);
        });

        stream.resume();
        return true;
    }

    /**
     * Aborts and destroys an outgoing stream.
     * @param {string} streamId - The stream identifier.
     * @param {string} reason - The error reason message.
     * @returns {undefined}
     */
    abort(streamId, reason) {
        const stream = this.streams.get(streamId);
        if (!stream) return undefined;
        stream.destroy(new Error(reason));
        this.streams.delete(streamId);
    }

    /**
     * Destroys all active outgoing streams and clears the registry.
     * @param {string} [reason='Worker stopped'] - The reason for clearing.
     */
    clear(reason = 'Worker stopped') {
        for (const [streamId, stream]
            of this.streams.entries()) {
            stream.destroy(new Error(reason));
        }; this.streams.clear();
    }
}

import {
    isBuffer,
    BufferToStream,
    isStream,
} from "./IPCStreams.js";

export class InterceptBaileys {
    /**
     * Creates a InterceptBaileys instance.
     * @param {InstanceIPC} instance - The parent client instance.
     */
    constructor(instance) {
        this.instance = instance;
    }

    /**
     * Intercepts message sending, processes media buffers or streams, and forwards the request via IPC.
     * @param {string} jid - The recipient chat JID.
     * @param {Object} content - The message content object.
     * @param {Object} [options] - Additional Baileys message options.
     * @returns {Promise<any>|Error} The IPC request promise or an Error if validation fails.
     */
    sendMessage(jid, content, options) {
        if (typeof jid !== 'string') throw new TypeError('jid must be a string');
        if (typeof content !== 'object') throw new TypeError('content must be an object');
        if (content === null || content === undefined) throw new TypeError('content must be an object');
        if (Array.isArray(content)) throw new TypeError('content must be an object');

        const isMedia = ['audio', 'video', 'image', 'document', 'sticker']
            .find((key) => content[key]);

        if (isMedia) {
            const mediaContent = content[isMedia];
            if (isBuffer(mediaContent)) content[isMedia] = {
                stream: this.instance.streamSender.prepare(BufferToStream(mediaContent))
            }; else if (isStream(mediaContent?.stream)) content[isMedia] = {
                stream: this.instance.streamSender.prepare(mediaContent.stream)
            };
        }

        return this.instance.request({
            type: 'SOCKET', PATH: ['sendMessage'],
            ARGS: [jid, content, options]
        }, null);
    }

    /**
     * Intercepts newsletter profile picture updates, processes media, and forwards the request via IPC.
     * @param {string} jid - The newsletter JID.
     * @param {Buffer|Readable|Object} content - Image content as a Buffer, Stream, or stream wrapper.
     * @returns {Promise<any>|Error} The IPC request promise or an Error if validation fails.
     */
    newsletterUpdatePicture(jid, content) {
        if (typeof jid !== 'string') throw new TypeError('jid must be a string');
        if (typeof content !== 'object') throw new TypeError('content must be an object');
        if (content === null || content === undefined) throw new TypeError('content must be an object');
        if (Array.isArray(content)) throw new TypeError('content must be an object');

        if (isBuffer(content)) content = {
            stream: this.instance.streamSender.prepare(BufferToStream(content))
        };
        else if (isStream(content?.stream)) content = {
            stream: this.instance.streamSender.prepare(content.stream)
        };

        return this.instance.request({
            type: 'SOCKET', PATH: ['newsletterUpdatePicture'],
            ARGS: [jid, content]
        }, null);
    }

    /**
     * Intercepta la subida de multimedia a servidores MMS de WhatsApp via IPC.
     */
    waUploadToServer(streamOrBuffer, options) {
        let stream = streamOrBuffer;
        if (isBuffer(streamOrBuffer)) {
            stream = BufferToStream(streamOrBuffer);
        } else if (streamOrBuffer?.stream) {
            stream = streamOrBuffer.stream;
        }

        const streamToken = this.instance.streamSender.prepare(stream);

        return this.instance.request({
            type: 'SOCKET',
            PATH: ['waUploadToServer'],
            ARGS: [streamToken, options]
        }, 30000);
    }
}

import {
    isBuffer,
    BufferToStream,
    FileToStream,
    isStream
} from './IPCStreams.js'

export class InterceptBaileys {
    constructor(instance) {
        this.instance = instance
    }

    sendMessage(jid, content, options) {
        if (typeof jid !== 'string') throw new TypeError('jid must be a string')
        if (typeof content !== 'object' || content === null || Array.isArray(content)) {
            throw new TypeError('content must be an object')
        }

        const isMedia = ['audio', 'video', 'image', 'document', 'sticker'].find((key) => content[key])

        if (isMedia) {
            const mediaContent = content[isMedia]
            if (isBuffer(mediaContent)) {
                content[isMedia] = {
                    stream: this.instance.streamSender.prepare(BufferToStream(mediaContent))
                }
            } else if (isStream(mediaContent?.stream)) {
                content[isMedia] = {
                    stream: this.instance.streamSender.prepare(mediaContent.stream)
                }
            }
        }

        return this.instance.request({
            type: 'SOCKET',
            PATH: ['sendMessage'],
            ARGS: [jid, content, options]
        }, null)
    }

    newsletterUpdatePicture(jid, content) {
        if (typeof jid !== 'string') throw new TypeError('jid must be a string')
        if (typeof content !== 'object' || content === null || Array.isArray(content)) {
            throw new TypeError('content must be an object')
        }

        if (isBuffer(content)) {
            content = {
                stream: this.instance.streamSender.prepare(BufferToStream(content))
            }
        } else if (isStream(content?.stream)) {
            content = {
                stream: this.instance.streamSender.prepare(content.stream)
            }
        }

        return this.instance.request({
            type: 'SOCKET',
            PATH: ['newsletterUpdatePicture'],
            ARGS: [jid, content]
        }, null)
    }

    updateProfilePicture(jid, content, dimensions) {
        if (typeof jid !== 'string') throw new TypeError('jid must be a string')
        if (typeof content !== 'object' || content === null || Array.isArray(content)) {
            throw new TypeError('content must be an object')
        }

        if (isBuffer(content)) {
            content = {
                stream: this.instance.streamSender.prepare(BufferToStream(content))
            }
        } else if (isStream(content?.stream)) {
            content = {
                stream: this.instance.streamSender.prepare(content.stream)
            }
        }

        return this.instance.request({
            type: 'SOCKET',
            PATH: ['updateProfilePicture'],
            ARGS: [jid, content, dimensions]
        }, null)
    }

    waUploadToServer(streamOrBufferOrPath, options) {
        let stream = streamOrBufferOrPath

        if (typeof streamOrBufferOrPath === 'string') {
            stream = FileToStream(streamOrBufferOrPath)
        } else if (isBuffer(streamOrBufferOrPath)) {
            stream = BufferToStream(streamOrBufferOrPath)
        } else if (streamOrBufferOrPath?.stream) {
            stream = streamOrBufferOrPath.stream
        }

        const streamToken = this.instance.streamSender.prepare(stream)

        return this.instance.request({
            type: 'SOCKET',
            PATH: ['waUploadToServer'],
            ARGS: [streamToken, options]
        }, 30000)
    }
}

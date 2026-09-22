
export class InterceptBaileys {
    constructor(streamReceiver, streamSender, sock) {
        this.streamReceiver = streamReceiver;
        this.streamSender = streamSender;
        this.sock = sock;
    }

    sendMessage(jid, content, options) {
        if (content && typeof content === 'object') {
            const mediaType = ['audio', 'video', 'image',
                'document', 'sticker'].find(o => content[o]);

            if (mediaType && content[mediaType]?.stream?.__ipcStreamId) {
                const streamId = content[mediaType].stream.__ipcStreamId;
                content[mediaType].stream = this.streamReceiver.init(streamId);
            }
        }

        return [jid, content, options]
    }

    newsletterUpdatePicture(jid, content) {
        if (content?.stream?.__ipcStreamId) {
            const streamId = content.stream.__ipcStreamId;
            content.stream = this.streamReceiver.init(streamId);
        }

        return [jid, content]
    }

    updateProfilePicture(jid, content, dimensions) {
        if (content?.stream?.__ipcStreamId) {
            const streamId = content.stream.__ipcStreamId;
            content.stream = this.streamReceiver.init(streamId);
        }

        return [jid, content, dimensions]
    }
}
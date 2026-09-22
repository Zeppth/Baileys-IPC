import { getProperty } from 'dot-prop';
import { parentPort } from "worker_threads";
import { StreamReceiver, StreamSender, _ } from '../../Library/IPCStreams.js';
import { InterceptBaileys } from './InterceptBaileys.js';

const streamSender = new StreamSender(
    parentPort.postMessage.bind(parentPort));

const streamReceiver = new StreamReceiver(
    parentPort.postMessage.bind(parentPort));

let Interceptors

export default async (msg, sock) => {

    if (!Interceptors) Interceptors = new InterceptBaileys(
        streamReceiver, streamSender, sock)

    // streamSender
    if (msg.type === 'STREAM_READY')
        return streamSender.start(msg.streamId);

    // streamReceiver
    if (msg.type === 'MAIN_STREAM_CHUNK')
        return streamReceiver.write(msg.streamId, msg.chunk);
    if (msg.type === 'MAIN_STREAM_ERROR')
        return streamReceiver.abort(msg.streamId, msg.error);
    if (msg.type === 'MAIN_STREAM_END')
        return streamReceiver.end(msg.streamId);

    let { PATH, ARGS, requestId } = msg;

    try {
        if (msg.type === 'SOCKET') {
            let lastKey, current, parent;

            const pathString = Array.isArray(PATH)
                ? PATH.join('.') : PATH;

            const pathArray = Array.isArray(PATH)
                ? PATH : (typeof PATH === 'string'
                    ? PATH.split('.') : []);

            if (pathArray.length > 0) {
                lastKey = pathArray[pathArray.length - 1];
                const parentPathArray = pathArray.slice(0, -1);
                const parentString = parentPathArray.join('.');
                parent = parentPathArray.length > 0
                    ? getProperty(sock, parentString) : sock;
                current = getProperty(sock, pathString);

            } else if (typeof PATH === 'string') {
                current = sock[PATH]; parent = sock; lastKey = PATH;
            }

            if (typeof Interceptors[lastKey] == 'function') {
                ARGS = await Interceptors[lastKey](...ARGS);
            }

            if (typeof current === 'function') {
                const result = await current.apply(parent, ARGS || []);

                try {
                    parentPort.postMessage({
                        requestId,
                        status: 'success',
                        data: result
                    });
                } catch (e) {
                    parentPort.postMessage({
                        requestId, status: 'success',
                        data: JSON.parse(JSON.stringify(result, (k, v) =>
                            typeof v === 'bigint' ? v.toString() : v))
                    });
                }
            } else {
                let cloned;
                if (current !== undefined) {
                    try { cloned = structuredClone(current); } catch (e) {
                        try {
                            cloned = JSON.parse(JSON.stringify(current, (k, v) =>
                                typeof v === 'bigint' ? v.toString() : v));
                        } catch (e) { cloned = undefined; }
                    }
                }

                parentPort.postMessage({
                    requestId,
                    status: 'success',
                    data: cloned
                });
            }
        }
    } catch (e) {
        const is428 = e?.output?.statusCode === 428
            || e?.output?.payload?.statusCode === 428
            || e?.message?.includes('Connection Closed')
            || e?.message?.includes('Precondition Required')

        parentPort.postMessage({
            requestId, status: 'error',
            error: e ? (e.stack || e.message || String(e))
                : 'Unknown socket error'
        });

        if (is428) return parentPort.postMessage({
            event: 'connection', type: 'connection_close',
            action: 'restart', reasonCode: 428
        });
    }
}
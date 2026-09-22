# BaileysIPC

A wrapper around [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) that runs each WhatsApp session in its own `worker_thread`. Communication between the main process and each worker goes through an IPC layer built on top of Node.js worker message passing.

The main thread never loads Baileys directly at runtime. Instead it sends structured messages to the worker, and the worker translates them into actual Baileys socket calls. The result is sent back and resolved as a Promise on the main thread.

The public API on the main thread mimics the Baileys socket object through a JavaScript `Proxy`, so existing call patterns continue to work with minimal changes. Every call is async and goes over IPC.

> This is not a REST API or a ready-to-deploy service. It is a library you integrate into your own Node.js application.

---

## Requirements

| Requirement | Notes |
|---|---|
| Node.js | 22 or later. Uses `node:sqlite` (DatabaseSync), stabilized in Node 22. |
| ESM | The project uses ES Modules. Your `package.json` must include `"type": "module"`. |
| @whiskeysockets/baileys | `latest` |
| @hapi/boom | `^10.0.1` - Parses Baileys disconnect reason codes. |
| dot-prop | `^10.2.0` - Resolves nested property paths on the socket inside the worker. |
| pino | `9.1.0` - Logger passed to the Baileys socket (set to silent by default). |
| qrcode | `^1.5.3` - Generates base64 QR images sent back to the main thread. |
| qrcode-terminal | `^0.12.0` - Renders QR as ASCII text, also sent to the main thread. |

---

## Installation

Copy or clone the `BaileysIPC` folder into your project, then install the dependencies:

```sh
npm install @hapi/boom @whiskeysockets/baileys dot-prop pino@9.1.0 qrcode qrcode-terminal
```

Make sure your `package.json` has:

```json
{
  "type": "module"
}
```

---

## Project Structure

```
BaileysIPC/
├── Library/
│   ├── BaileysIPC.js         Top-level manager. Holds multiple instances.
│   ├── InstanceIPC.js        Per-instance controller. Bridges main thread and worker.
│   ├── InterceptBaileys.js   Main-thread interceptors for media-heavy methods.
│   ├── IPCProxy.js           JS Proxy that makes socket calls feel local.
│   ├── IPCRequest.js         Promise-based request/response tracker.
│   ├── IPCStreams.js          Stream piping utilities and stream managers.
│   ├── IPCWorker.js          Worker thread wrapper with auto-restart.
│   └── StoreIPCs.js          SQLite session store for the main thread.
├── Worker/
│   ├── Library/
│   │   ├── AuthState.js      SQLite-backed Baileys auth state.
│   │   ├── Connect.js        Connection event handler inside the worker.
│   │   ├── InterceptBaileys.js  Worker-side interceptors that restore streams.
│   │   └── Message.js        IPC message dispatcher inside the worker.
│   └── index.js              Worker entry point. Starts the Baileys socket.
├── dependencies.json
└── index.js                  Public exports.
```

The `Library/` folder runs on the main thread. The `Worker/` folder runs inside the isolated thread. Both sides share `IPCStreams.js`.

---

## Basic Usage

```js
import { BaileysIPC } from './BaileysIPC/index.js';

// Create a manager. Pass a path where session data will be stored.
const manager = new BaileysIPC('./storage');

// Create an instance.
const instance = manager.createInstance('my-session', {
    connectType: 'qr-code'
});

// Listen for connection events.
instance.on('connection.update', (msg) => {
    if (msg.type === 'connection_pairing' && msg.qrcode) {
        console.log('Scan this QR:');
        console.log(msg.data.qrCodeText);
    }
    if (msg.type === 'connection_open') {
        console.log('Connected as:', msg.data.id);
    }
});

// Listen for incoming messages.
instance.on('messages.upsert', (data) => {
    console.log('New message:', data);
});

// Start the worker.
await instance.start();
```

---

## Connection Types

### QR Code

```js
manager.createInstance('session-a', {
    connectType: 'qr-code'
});
```

When a QR code is ready, `connection.update` fires with:

```js
{
    event: 'connection',
    type: 'connection_pairing',
    qrcode: true,
    data: {
        rawQrCode: '...',
        qrCodeImage: 'data:image/png;base64,...',  // ready for an <img> tag
        qrCodeText: '...'                           // ASCII terminal render
    }
}
```

### Pin Code (Pairing Code)

```js
manager.createInstance('session-b', {
    connectType: 'pin-code',
    phoneNumber: '5491123456789',  // digits only, no + or spaces
    customCode: 'MYCODE11'          // optional, 8 chars max
});
```

When the code is ready, `connection.update` fires with:

```js
{
    event: 'connection',
    type: 'connection_pairing',
    pincode: true,
    data: {
        pairingCode: 'ABCD-1234'
    }
}
```

---

## Events

`InstanceIPC` extends `EventEmitter`.

| Event | Payload | Description |
|---|---|---|
| `connection.update` | `msg` object | Fires on any connection state change. Check `msg.type`. |
| `messages.upsert` | `data` object | Fires when new messages arrive. |
| `exit` | `{ code, signal }` | Fires when the worker thread exits. |

**`msg.type` values for `connection.update`:**

- `connection_pairing` - QR or pin code ready. Check `msg.qrcode` or `msg.pincode`.
- `connection_open` - Session authenticated. `msg.data` contains user info (`id`, `lid`, etc).
- `connection_close` - Session disconnected. `msg.action` is `'restart'` or `'stop'`.

---

## Sending Messages

`instance.sock` is a Proxy that mirrors the Baileys socket API. Call methods on it as you normally would. Every call returns a Promise.

```js
// Text message
await instance.sock.sendMessage('5491123456789@s.whatsapp.net', {
    text: 'Hello'
});

// Any Baileys method works the same way
await instance.sock.sendPresenceUpdate('available', jid);
await instance.sock.readMessages([msgKey]);

// Accessing properties also works
const user = await instance.sock.user;
```

---

## Media Handling

Buffers and Streams cannot be passed through `worker_thread` message channels directly. BaileysIPC handles this transparently in `sendMessage`. You can pass media as a `Buffer`, a `Readable` stream, or use the provided helpers.

```js
import fs from 'fs';

// From a Buffer
const imageBuffer = fs.readFileSync('./photo.jpg');
await instance.sock.sendMessage(jid, {
    image: imageBuffer,
    caption: 'A photo'
});
```

```js
import { FileToStream } from './BaileysIPC/index.js';

// From a file path
await instance.sock.sendMessage(jid, {
    video: { stream: FileToStream('./clip.mp4') },
    caption: 'A video'
});
```

**Stream utilities exported from `index.js`:**

```js
import { FileToStream, BufferToStream, StreamToFile, StreamToBuffer } from './BaileysIPC/index.js';

FileToStream('./audio.ogg')          // file path -> Readable
BufferToStream(someBuffer)           // Buffer    -> Readable
await StreamToFile(stream, './out')  // Readable  -> file
await StreamToBuffer(stream)         // Readable  -> Buffer
```

---

## Instance Lifecycle

```js
// Create (worker not started yet)
const instance = manager.createInstance('id', options);

// Start the worker
await instance.start();

// Stop without deleting the session (can be resumed with start())
await instance.stop();

// Destroy: logout + stop + wipe session from SQLite
await manager.destroyInstance('id');

// Check if credentials exist in SQLite
manager.hasStoredInstance('id');   // true/false

// Check if actively running in memory
manager.hasInstance('id');         // true/false

// List all active instance IDs
manager.InstancesActive();         // string[]
```

**Auto-restart:** If the worker exits unexpectedly, `IPCWorker` schedules a restart after 5 seconds, as long as the instance was not stopped intentionally. All pending requests and streams are rejected on restart so callers do not hang.

**Disconnect reasons that trigger a restart:** `restartRequired`, `connectionLost`, `connectionClosed`, `unavailableService`, `timedOut`.

**Disconnect reasons that stop the instance and clear the session:** `loggedOut`, `badSession`, `multideviceMismatch`, `forbidden`, `connectionReplaced`.

---

## Interceptors

### What they are

An interceptor is a named method that runs instead of the default IPC dispatch when a matching method is called through `instance.sock`. There are two layers: one on the main thread (`Library/InterceptBaileys.js`) and one inside the worker (`Worker/Library/InterceptBaileys.js`). They are designed to work as a pair for the same method name.

### Why they exist

The IPC channel uses `postMessage`, which only handles structured-clone-compatible data. Node.js `Readable` streams are not. Interceptors solve this by converting a stream on the main thread into a series of chunked binary messages over IPC, and reassembling them into a `PassThrough` stream on the worker side for Baileys to consume normally.

### Full flow for a media send

```
Your code
  sock.sendMessage(jid, { image: buffer })
        |
        v
Main InterceptBaileys.sendMessage()
  - Converts Buffer to stream via BufferToStream()
  - Pauses the stream, assigns ID (e.g. A1B2C3D4), stores in StreamSender
  - Replaces buffer with token: { __ipcStreamId: 'A1B2C3D4' }
  - Calls instance.request({ type:'SOCKET', PATH:['sendMessage'], ARGS:[jid, {image:{__ipcStreamId:'A1B2C3D4'}}, opts] })
        |
        v
Worker receives message in Message.js
  - Detects 'sendMessage' has a worker interceptor
  - Worker InterceptBaileys.sendMessage() runs
      - Finds __ipcStreamId in content
      - Calls StreamReceiver.init('A1B2C3D4')
          -> Creates PassThrough stream
          -> Sends STREAM_READY back to main thread
        |
        v
Main thread receives STREAM_READY
  - StreamSender.start('A1B2C3D4')
  - Stream resumes, emits chunks as MAIN_STREAM_CHUNK (ArrayBuffer, transferred not copied)
  - On stream end: sends MAIN_STREAM_END
        |
        v
Worker receives chunks
  - StreamReceiver.write() pipes each chunk into PassThrough
  - StreamReceiver.end() closes the PassThrough
        |
        v
Worker calls real Baileys method
  sock.sendMessage(jid, { image: { stream: PassThrough } }, opts)
        |
        v
Worker posts result
  { requestId, status: 'success', data }
        |
        v
Main thread IPCRequest resolves the Promise
```

### Currently intercepted methods

| Method | What the interceptor does |
|---|---|
| `sendMessage` | Converts `image`, `video`, `audio`, `document`, or `sticker` Buffer/Stream to an IPC stream token. |
| `updateProfilePicture` | Same conversion on the `content` argument. |
| `newsletterUpdatePicture` | Same conversion on the `content` argument. |

The `user` property is also intercepted as a plain value. When the session connects, `instance.Intercept.user` is set locally. Accessing `sock.user` returns it from memory without an IPC round-trip.

### Adding your own interceptor

Both files must be edited. The method name must be identical in both.

**Step 1 - `Library/InterceptBaileys.js` (main thread)**

This side handles non-serializable arguments and dispatches the IPC request.

```js
myMethod(jid, imageBuffer) {
    if (isBuffer(imageBuffer)) {
        imageBuffer = {
            stream: this.instance.streamSender.prepare(BufferToStream(imageBuffer))
        };
    }
    return this.instance.request({
        type: 'SOCKET',
        PATH: ['myMethod'],
        ARGS: [jid, imageBuffer]
    }, null); // null = no timeout, required for stream calls
}
```

**Step 2 - `Worker/Library/InterceptBaileys.js` (worker thread)**

This side restores stream tokens back into real streams and returns the modified argument array.

```js
myMethod(jid, imageBuffer) {
    if (imageBuffer?.stream?.__ipcStreamId) {
        const streamId = imageBuffer.stream.__ipcStreamId;
        imageBuffer.stream = this.streamReceiver.init(streamId);
    }
    return [jid, imageBuffer];
}
```

> The method name in both interceptors must match the last segment of the property path used when calling `sock.myMethod(...)`.

For methods that do not involve streams, you can still intercept to transform arguments. Call `this.instance.request()` with a normal timeout and skip the stream machinery on both sides.

---

## IPC Message Reference

### Main thread to Worker

| type | Purpose | Fields |
|---|---|---|
| `SOCKET` | Call a method or access a property on the Baileys socket. | `PATH`, `ARGS`, `requestId` |
| `MAIN_STREAM_CHUNK` | A data chunk from a main-thread stream. | `streamId`, `chunk` (ArrayBuffer) |
| `MAIN_STREAM_END` | End of a main-thread stream. | `streamId` |
| `MAIN_STREAM_ERROR` | Error in a main-thread stream. | `streamId`, `error` |
| `STREAM_READY` | Tells the main StreamSender it can start sending chunks. | `streamId` |

### Worker to Main thread

| type / fields | Purpose |
|---|---|
| `requestId` + `status:'success'` | Successful response. Contains `data`. |
| `requestId` + `status:'error'` | Failed response. Contains `error`. |
| `STREAM_READY` | Worker StreamReceiver is ready to accept chunks. |
| `event:'connection'` | Any connection state update. |
| `event:'messages'` | Incoming Baileys messages. |

---

## Internal Classes

### BaileysIPC

Top-level manager. Creates and tracks `InstanceIPC` objects. Exposes `createInstance`, `destroyInstance`, `hasInstance`, `hasStoredInstance`, `getInstance`, `InstancesActive`.

### InstanceIPC

Per-session controller. Extends `EventEmitter`. Owns the `IPCWorker`, `IPCRequest`, `StreamSender`, `StreamReceiver`, `InterceptBaileys`, and `IPCProxy`. Handles message routing between all components.

### IPCProxy

A recursive `Proxy` that translates property chains and function calls into IPC messages. When a method is called, it checks for a matching interceptor first. If none exists, it dispatches the call via `IPCRequest`. Property accesses return a nested Proxy that continues building the path until the chain is called or awaited.

### IPCRequest

Tracks pending request-response pairs. Each outgoing message gets a random hex `requestId`. The Promise is stored in a `Map`. When the worker responds with the matching ID and status, the Promise resolves or rejects. A configurable timeout rejects requests that receive no response. `clear()` rejects everything on stop or crash.

### IPCWorker

Thin wrapper around Node.js `Worker`. Handles start, stop, message routing, and auto-restart on unexpected exit. Options are deep-cloned via `structuredClone` before being passed as `workerData`.

### StreamSender / StreamReceiver

`StreamSender` manages outgoing streams: pauses them, assigns IDs, resumes and chunks them when the remote side signals readiness. `StreamReceiver` manages incoming streams: creates `PassThrough` streams, writes chunks, signals readiness. Both exist on both threads, handling each direction of transfer.

### AuthState (Worker)

Implements the Baileys `AuthenticationState` interface backed by SQLite (`node:sqlite`). Credentials and signal keys are stored in a `baileys_sessions` table. Uses WAL mode, transactions for writes, and a module-level connection cache to avoid duplicate open connections.

### StoreIPCs (Main thread)

Opens the same SQLite file from the main thread (read queries only) to check whether stored credentials exist for a given instance. Used by `hasStoredInstance` and `destroyInstance`.

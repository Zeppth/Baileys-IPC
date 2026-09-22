"use strict";

import path from 'path';
import v8 from 'node:v8';
import fs from 'fs';

import { parentPort, workerData } from "worker_threads";

if (!workerData) throw new Error("Worker data is required");
if (!workerData.STORAGE) throw new Error('STORAGE missing');

fs.mkdirSync(path.join(workerData
    .STORAGE), { recursive: true });

process.on('uncaughtException', (err) => {
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    setTimeout(() => process.exit(1), 1000);
});

import makeWASocket, {
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion, Browsers,
} from '@whiskeysockets/baileys';

import SQLiteAuthState from './Library/AuthState.js'
import { randomBytes } from 'crypto';
import pino from 'pino';

const { version } = await fetchLatestBaileysVersion();

const CONNECTION = {
    version: version, emitOwnEvents: true,
    fireInitQueries: false, syncFullHistory: false,
    connectTimeoutMs: 60000, retryRequestDelayMs: 5000,
    keepAliveIntervalMs: 30000, markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true, logger: pino({ level: 'silent' }),

    browser: Browsers.ubuntu('Chrome'),
    patchMessageBeforeSending: (message) => {
        const UintArray = (numero) => Uint8Array
            .from(randomBytes(numero));
        message.messageContextInfo ||= {};
        const info = message.messageContextInfo;
        info.messageSecret ||= UintArray(32);
        info.threadId ||= null;
        return message;
    },
    transactionOpts: {
        maxCommitRetries: 5,
        delayBetweenTriesMs: 5000
    },
    appStateMacVerification: {
        patch: true,
        snapshot: true
    },
}

import eventMessage from './Library/Message.js';
import eventConnect from './Library/Connect.js';

const a0 = (raw) => {
    try {
        raw = JSON.parse(JSON.stringify(raw, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value));
    } catch { return null; }
    return raw;
}

const a1 = (raw) => {
    try { raw = v8.deserialize(v8.serialize(raw)); }
    catch { return null; }
    return raw;
}

async function StartSession() {
    const sessFolderPath = path.join(workerData.STORAGE, 'data.db')
    let { state, saveCreds, clearSession } = await SQLiteAuthState(
        sessFolderPath, workerData.INSTANCEID)

    const keyStore = makeCacheableSignalKeyStore(state.keys,
        pino({ level: "fatal" }).child({ level: "fatal" }))

    const sockConfig = { ...CONNECTION }
    sockConfig.auth = { creds: state.creds, keys: keyStore }

    if (workerData.connectType == 'qr-code') sockConfig
        .browser = Browsers.macOS('Desktop')

    const sock = makeWASocket(sockConfig);
    sock.ev.on('creds.update', saveCreds);

    if (workerData.connectType == 'pin-code') {
        let numero = workerData.phoneNumber.replace(/\D/g, '')
        await new Promise(resolve => setTimeout(resolve, 3000));
        const pairingCode = await sock.requestPairingCode(numero,
            workerData.customCode ?? null);

        parentPort.postMessage({
            event: 'connection',
            type: 'connection_pairing',
            pincode: true, data: {
                pairingCode: pairingCode
            }
        })
    }

    sock.ev.on('messages.upsert', async (raw) => {
        let sraw = a1(raw) ?? a0(raw);
        if (sraw) parentPort.postMessage({
            event: 'messages', data: sraw
        });
    });

    sock.ev.on('connection.update', async (update) => {
        try { return await eventConnect(update, sock, clearSession) }
        catch (e) { console.log('connetion:WorkerBaileys.js', e) }
    })

    parentPort.on('message', async (request) => {
        try { return await eventMessage(request, sock) }
        catch (e) { console.log('message:WorkerBaileys.js', e) }
    })
}


await StartSession();
import qrCode from 'qrcode';
import qrTerminal from 'qrcode-terminal';
import { Boom } from '@hapi/boom';

import { parentPort } from "worker_threads";
import { DisconnectReason } from '@whiskeysockets/baileys';

export default async (update, sock, clearSession) => {
    const { lastDisconnect, connection, qr } = update;

    if (connection === 'close') {
        const reason = new Boom(lastDisconnect
            ?.error)?.output?.statusCode || "error";

        if ([
            DisconnectReason.restartRequired,
            DisconnectReason.connectionLost,
            DisconnectReason.connectionClosed,
            DisconnectReason.unavailableService,
            DisconnectReason.timedOut].includes(reason)) {
            if (reason === DisconnectReason.unavailableService)
                await new Promise(resolve => setTimeout(resolve, 5000));
            parentPort.postMessage({
                event: 'connection', type: 'connection_close',
                action: 'restart', reasonCode: reason
            })
        }

        else if ([
            DisconnectReason.loggedOut,
            DisconnectReason.badSession,
            DisconnectReason.multideviceMismatch,
            DisconnectReason.forbidden
        ].includes(reason)) {
            await clearSession();

            return parentPort.postMessage({
                event: 'connection', type: 'connection_close',
                action: 'stop', reasonCode: reason
            })
        } else if (reason === DisconnectReason
            .connectionReplaced) {
            return parentPort.postMessage({
                event: 'connection', type: 'connection_close',
                action: 'stop', reasonCode: reason
            })
        } else return parentPort.postMessage({
            event: 'connection', type: 'connection_close',
            action: 'restart', reasonCode: reason
        })
    }

    if (connection === 'open') return parentPort.postMessage({
        event: 'connection', type: 'connection_open', data: {
            ...sock.user,
            lid: sock.user?.lid ? sock.user.lid
                .split(":")[0] + "@lid" : null,
            id: sock.user?.id ? sock.user.id
                .split(":")[0] + "@s.whatsapp.net" : null
        }
    })

    if (qr) {
        const qrCodeText = await new Promise((resolve) =>
            qrTerminal.generate(qr, { small: true },
                (qrCode) => resolve(qrCode)))

        return parentPort.postMessage({
            event: 'connection',
            type: 'connection_pairing',
            qrcode: true, data: {
                rawQrCode: qr,
                qrCodeImage: await qrCode
                    .toDataURL(qr),
                qrCodeText
            }
        })
    }
}
import { BaileysIPC } from "./Library/BaileysIPC.js";
import { InstanceIPC } from "./Library/InstanceIPC.js";

import {
    FileToStream,
    BufferToStream,
    StreamToFile,
    StreamToBuffer,
    generateId
} from "./Library/IPCStreams.js";

import * as baileys from "@whiskeysockets/baileys";

export {
    BaileysIPC,
    InstanceIPC,
    FileToStream,
    BufferToStream,
    StreamToFile,
    StreamToBuffer,
    generateId
};

export default baileys;
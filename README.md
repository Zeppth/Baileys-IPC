# BaileysIPC

BaileysIPC es un wrapper para `@whiskeysockets/baileys` diseñado para ejecutar cada conexión de WhatsApp en un hilo secundario independiente (`worker_threads`) de Node.js. 

El objetivo principal es aislar las sesiones: si una conexión tiene un fallo crítico, no detiene el proceso principal ni a las demás sesiones. La comunicación se realiza mediante IPC (Inter-Process Communication) y las sesiones se guardan automáticamente en una base de datos SQLite gestionada con `node:sqlite`.

---

## Requisitos

- Node.js versión 22.0.0 o superior (necesario para el soporte nativo de `node:sqlite`).

---

## Instalación e integración

1. Copia la carpeta `BaileysIPC/` dentro de tu proyecto.
2. Instala las dependencias necesarias en tu proyecto:

```bash
npm install @whiskeysockets/baileys @hapi/boom dot-prop pino qrcode qrcode-terminal
```

---

## Flujo principal de uso

### 1. Inicialización básica (Código QR)

```javascript
import { BaileysIPC } from "./BaileysIPC/index.js";

// Carpeta donde se creará data.db con las sesiones SQLite
const manager = new BaileysIPC("./storage");

// Crear una instancia
const client = manager.createInstance("sesion_ventas", {
    connectType: "qr-code"
});

// Evento de conexión y generación de QR
client.on("connection.update", (update) => {
    // Si hay un QR disponible
    if (update.qrcode) {
        console.log("Escanea este QR en la terminal:");
        console.log(update.data.qrCodeText);
    }

    // Sesión abierta exitosamente
    if (update.type === "connection_open") {
        console.log("Cliente conectado:", update.data.id);
    }
});

// Evento de mensajes entrantes
client.on("messages.upsert", (upsert) => {
    console.log("Mensajes recibidos:", upsert);
});

// Iniciar el worker de la instancia
await client.start();
```

---

### 2. Conexión mediante código de emparejamiento (Pairing Code)

Si necesitas conectar un número sin escanear QR:

```javascript
import { BaileysIPC } from "./BaileysIPC/index.js";

const manager = new BaileysIPC("./storage");

const client = manager.createInstance("sesion_soporte", {
    connectType: "pin-code",
    phoneNumber: "573001234567", // Número con código de país
    customCode: "ABC12345"       // Opcional: código de 8 caracteres
});

client.on("connection.update", (update) => {
    if (update.pincode) {
        console.log("Código de vinculación:", update.data.pairingCode);
    }
});

await client.start();
```

---

### 3. Envío de mensajes

Todas las llamadas a funciones de Baileys se realizan a través de `client.sock`. El proxy se encarga de transferir la orden al worker:

```javascript
import fs from "fs";

const jid = "1234567890@s.whatsapp.net";

// Texto plano
await client.sock.sendMessage(jid, {
    text: "Hola, mensaje de prueba."
});

// Imagen desde Buffer
const buffer = fs.readFileSync("./foto.jpg");
await client.sock.sendMessage(jid, {
    image: buffer,
    caption: "Descripción de la imagen"
});

// Audio/Nota de voz desde Stream
const stream = fs.createReadStream("./audio.mp3");
await client.sock.sendMessage(jid, {
    audio: { stream },
    mimetype: "audio/mp4",
    ptt: true
});
```

---

### 4. Múltiples instancias simultáneas

Puedes gestionar varias cuentas en paralelo bajo el mismo gestor:

```javascript
import { BaileysIPC } from "./BaileysIPC/index.js";

const manager = new BaileysIPC("./storage");

const sesion1 = manager.createInstance("cuenta_1", { connectType: "qr-code" });
const sesion2 = manager.createInstance("cuenta_2", { connectType: "qr-code" });

await sesion1.start();
await sesion2.start();

// Ver identificadores de instancias activas en memoria
console.log("Instancias corriendo:", manager.InstancesActive());

// Detener una sesión sin borrar sus credenciales
await sesion1.stop();

// Eliminar definitivamente una sesión (cierra sesión en WhatsApp y borra datos de SQLite)
await manager.destroyInstance("cuenta_1");
```

---

## Interceptores de Baileys (`InterceptBaileys`)

### ¿Qué son y por qué existen?

Los hilos de Node.js (`worker_threads`) se comunican mediante paso de mensajes serializados (`postMessage`). Esto tiene dos limitaciones técnicas con Baileys:

1. **Streams:** Un `ReadableStream` no se puede transferir directamente mediante `postMessage`.
2. **Buffers grandes:** Enviar buffers multimedia grandes por el canal IPC sin control puede degradar el rendimiento o saturar la memoria.

Para resolver esto, existen dos archivos de intercepción que actúan como puente:

- **Lado principal (`BaileysIPC/Library/InterceptBaileys.js`):** Intercepta la llamada antes de enviarla al worker. Si detecta un `Buffer` o un `Stream` en la carga multimedia, lo registra en un gestor de transmisión por fragmentos (`StreamSender`), reemplaza el objeto por un token identificador (`__ipcStreamId`), y despacha la petición al worker.
- **Lado worker (`BaileysIPC/Worker/Library/InterceptBaileys.js`):** Intercepta la petición antes de que llegue a la función real de Baileys. Al detectar el token `__ipcStreamId`, inicializa un flujo receptor (`StreamReceiver`) que reconstruye el stream en tiempo real dentro del worker y se lo entrega al socket de Baileys.

---

### ¿Cómo editar o agregar nuevos interceptores?

Si deseas dar soporte a una función de Baileys que maneje archivos binarios o que requiera transformar argumentos antes de llegar al worker, debes modificar ambos lados:

#### Paso 1: Agregar el método en el hilo principal (`Library/InterceptBaileys.js`)

Aquí capturas el método, transformas los buffers o streams en tokens IPC y envías la petición:

```javascript
// Dentro de BaileysIPC/Library/InterceptBaileys.js

customMediaMethod(jid, content) {
    if (content?.image && isBuffer(content.image)) {
        // Convierte el Buffer en stream y genera un ID de seguimiento IPC
        content.image = {
            stream: this.instance.streamSender.prepare(BufferToStream(content.image))
        };
    }

    // Envía la petición hacia el worker
    return this.instance.request({
        type: 'SOCKET',
        PATH: ['customMediaMethod'],
        ARGS: [jid, content]
    }, null);
}
```

#### Paso 2: Agregar el método en el worker (`Worker/Library/InterceptBaileys.js`)

Aquí recibes los argumentos, reconstruyes el stream a partir del ID recibido y retornas el array de argumentos con los que Baileys llamará a la función:

```javascript
// Dentro de BaileysIPC/Worker/Library/InterceptBaileys.js

customMediaMethod(jid, content) {
    if (content?.image?.stream?.__ipcStreamId) {
        const streamId = content.image.stream.__ipcStreamId;
        // Reconstruye el stream en el worker
        content.image = this.streamReceiver.init(streamId);
    }

    // Retorna los argumentos en orden tal como los espera Baileys
    return [jid, content];
}
```

Con estos dos pasos, cualquier método nuevo que agregues procesará archivos multimedia entre el proceso principal y el worker sin errores de serialización.

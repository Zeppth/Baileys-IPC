export class IPCProxy {
    /**
     * Initializes the IPC proxy wrapper.
     * @param {Function} sendCallback - Function used to dispatch IPC requests.
     * @param {Object} [Intercept={}] - Optional object containing local interceptor methods.
     */
    constructor(sendCallback, Intercept = {}) {
        this.send = sendCallback;
        this.intercept = Intercept;
        this.objects = {};
        return this.Proxy([]);
    }

    /**
     * Recursively builds the Proxy to capture property chains and method applications.
     * @param {string[]} path - The accumulated property path array.
     * @returns {Proxy} A JavaScript Proxy instance.
     */
    Proxy(path) {
        const get = (target, prop) => {
            if (typeof prop === 'symbol')
                return Reflect.get(target, prop);

            if (prop === 'then') {
                if (path.length === 0) return undefined;
                else return (resolve, reject) => {
                    const lastProp = path[path.length - 1];
                    if (this.intercept[lastProp]) return Promise.resolve(
                        this.intercept[lastProp]).then(resolve);
                    Promise.resolve(this.send({
                        ARGS: undefined, type: 'SOCKET', PATH: path
                    })).then(resolve).catch(reject);
                };
            }

            if (path.length === 0 && this
                .objects[prop] !== undefined)
                return this.objects[prop];
            return this.Proxy([...path, prop]);
        }

        return new Proxy(() => { }, {
            get, apply: (target, thisArg, args) => {
                const lastProp = path[path.length - 1];
                if (this.intercept[lastProp]) {
                    if (typeof this.intercept[lastProp] === 'function')
                        return this.intercept[lastProp](...args);
                    return this.intercept[lastProp];
                } else return this.send({
                    ARGS: args.length > 0 ? args : undefined,
                    type: 'SOCKET', PATH: path,
                });
            },

            set: (target, key, value) => {
                if (path.length === 0)
                    this.objects[key] = value;
                return true;
            },
            deleteProperty: (target, key) => {
                if (path.length === 0)
                    delete this.objects[key];
                return true;
            }
        });
    }
}


/*
import { generateId } from "./IPCStreams.js";
export class IPCProxy2 {
    constructor(sendCallback, Intercept = {}) {
        this.send = sendCallback;
        this.intercept = Intercept;
        this.map = new Map();
        this.objects = {};

        return new Proxy({}, {
            get: (target, prop) => {
                if (prop === 'then') return;
                if (typeof prop === 'symbol') return;
                if (this.objects[prop])
                    return this.objects[prop];

                const id = generateId();
                this.map.set(id, [prop]);
                return this.Proxy(id);
            },
            set: (target, key, value) => {
                this.objects[key] = value
            },
            deleteProperty: (target, key) => {
                delete this.objects[key]
            }
        });
    }

    Proxy(Id) {
        const path = this.map.get(Id);
        if (!path) return undefined;

        return new Proxy({}, {
            get: (target, prop) => {
                if (prop === 'then') return;
                if (typeof prop === 'symbol') return;
                if (prop === 'run') {
                    const array = [...path];
                    this.map.delete(Id);
                    const lastProp = array[array.length - 1]
                    if (this.intercept[lastProp])
                        return this.intercept[lastProp];
                    else return (...args) => this.send({
                        ARGS: args.length > 0 ? args : undefined,
                        type: 'SOCKET', PATH: array,
                    });
                }
                const array = [...path, prop];
                this.map.set(Id, array);
                return this.Proxy(Id);
            }
        });
    }
}*/
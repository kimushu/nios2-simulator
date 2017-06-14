import { Module } from "./module";
import { SimulatorOptions } from "./simulator";
import { Qsys } from "./qsys";
import { SopcInfoInterface } from "./sopcinfo";
import { then, Promiseable } from "./promiseable";

export interface InterfaceConstructor extends Function {
    readonly kind: string;
    new(module: Module, options: SimulatorOptions): Interface;
}

export class Interface {
    static subclasses: {[kind: string]: InterfaceConstructor} = {};

    static register(subclass: InterfaceConstructor): void {
        this.subclasses[subclass.kind] = subclass;
    }

    static search(kind: string): InterfaceConstructor {
        return this.subclasses[kind];
    }

    public system: Qsys;
    public name: string;

    constructor(public module: Module, public options: SimulatorOptions) {
        this.system = this.module.system;
        return;
    }

    load(ifdesc: SopcInfoInterface): void {
        this.name = ifdesc.name;
    }

    connect(): void {
    }
}

interface SlaveLink {
    bridge: boolean;
    module: string;
    interface: string;
    link: AvalonSlave;
    base: number;
    size: number;
    end: number;
}

export class AvalonMaster extends Interface {
    static kind = "avalon_master";
    private slaves: SlaveLink[];

    load(ifdesc: SopcInfoInterface): void {
        this.slaves = [];
        for (let blk of ifdesc.memoryBlock) {
            let slave: SlaveLink = {
                bridge: blk.isBridge === "true",
                module: blk.moduleName,
                interface: blk.slaveName,
                link: null,
                base: parseInt(blk.baseAddress),
                size: parseInt(blk.span),
                end: null
            };
            slave.end = slave.base + slave.size;
            this.slaves.push(slave);
        }
        this.slaves.sort((a, b) => a.base - b.base);
        return Interface.prototype.load.call(this, ifdesc);
    }

    connect(): void {
        var i, len, ref, s;
        ref = this.slaves;
        for (i = 0, len = ref.length; i < len; i++) {
            s = ref[i];
            let target = this.module.system.modules[s.module];
            this.options.printInfo(`Connecting: ${this.module.path}.${this.name} => ${target.path}.${s.interface}`, 3);
            s.link = target != null ? target.interfaces[s["interface"]] : void 0;
            if (s.link == null) {
                throw Error("No target slave (" + s.module + "." + s["interface"] + ") in this system");
            }
            s.link.master.link = this;
        }
    }

    private _getSlave(addr: number): SlaveLink {
        let top: number = 0;
        let btm: number = this.slaves.length;
        while (top < btm) {
            let mid = (top + btm) >>> 1;
            let slave = this.slaves[mid];
            if (addr < slave.base) {
                btm = mid;
            } else if (addr >= slave.end) {
                top = mid + 1;
            } else {
                return slave;
            }
        }
    }

    read8(addr: number, bytes?: number): Promiseable<Int8Array> {
        let s = this._getSlave(addr);
        if (s != null) {
            return s.link.read8((addr - s.base) >>> 0, bytes);
        }
    }

    read16(addr: number, bytes?: number): Promiseable<Int16Array> {
        let s = this._getSlave(addr);
        if (s != null) {
            return s.link.read16((addr - s.base) >>> 1, bytes);
        }
    }

    read32(addr: number, bytes?: number): Promiseable<Int32Array> {
        let s = this._getSlave(addr);
        if (s != null) {
            console.log(addr, s.link.name, s.link.module.name);
            return s.link.read32((addr - s.base) >>> 2, bytes);
        }
    }

    write8(addr: number, array: Int8Array) {
        let s = this._getSlave(addr);
        if (s != null) {
            return s.link.write8((addr - s.base) >>> 0, array);
        }
    }

    write16(addr: number, array: Int16Array) {
        let s = this._getSlave(addr);
        if (s != null) {
            return s.link.write16((addr - s.base) >>> 1, array);
        }
    }

    write32(addr: number, array: Int32Array) {
        let s = this._getSlave(addr);
        if (s != null) {
            return s.link.write32((addr - s.base) >>> 2, array);
        }
    }
}
Interface.register(AvalonMaster);

interface MasterLink {
    link: AvalonMaster;
}

export class AvalonSlave extends Interface {
    static kind = "avalon_slave";
    private master: MasterLink;

    load(ifc): void {
        this.master = {
            link: null
        };
        return Interface.prototype.load.call(this, ifc);
    }

    read8(offset: number, bytes?: number): Promiseable<Int8Array> {
        let boff = offset & 3;
        let off32 = offset >>> 2;
        let cnt32 = (bytes != null) ? ((boff + bytes + 3) >>> 2): null;
        return then(
            this.read32(off32, cnt32),
            (i32) => new Int8Array(i32.buffer, i32.byteOffset + boff, i32.byteLength - boff)
        );
    }

    read16(offset: number, bytes?: number): Promiseable<Int16Array> {
        let woff = offset & 1;
        let off32 = offset >> 1;
        let cnt32 = (bytes != null) ? ((woff + bytes + 1) >>> 1) : null;
        return then(
            this.read32(off32, cnt32),
            (i32) => new Int16Array(i32.buffer, i32.byteOffset + woff * 2, i32.byteLength - woff * 2)
        );
    }

    read32: (this: AvalonSlave, offset: number, bytes?: number) => Promiseable<Int32Array>;

    write8(offset: number, array: Int8Array): Promiseable<boolean> {
        return then(
            this.read8(offset, array.length),
            (i8) => i8.set(array) || true
        );
    }

    write16(offset: number, array: Int16Array): Promiseable<boolean> {
        return then(
            this.read16(offset, array.length),
            (i16) => i16.set(array) || true
        );
    }

    write32(offset: number, array: Int32Array): Promiseable<boolean> {
        return then(
            this.read32(offset, array.length),
            (i32) => i32.set(array) || true
        );
    }
}
Interface.register(AvalonSlave);

export class AvalonSink extends Interface {
    static kind = "avalon_streaming_sink";
}
Interface.register(AvalonSink);

export class AvalonSource extends Interface {
    static kind = "avalon_streaming_source";
}
Interface.register(AvalonSource);

export class ClockSink extends Interface {
    static kind = "clock_sink";
}
Interface.register(ClockSink);

export class ClockSource extends Interface {
    static kind = "clock_source";
}
Interface.register(ClockSource);

export class Conduit extends Interface {
    static kind = "conduit_end";
}
Interface.register(Conduit);

export class InterruptSender extends Interface {
    static kind = "interrupt_sender";
}
Interface.register(InterruptSender);

export class NiosCustomInstructionMaster extends Interface {
    static kind = "nios_custom_instruction_master";
}
Interface.register(NiosCustomInstructionMaster);

export class ResetSink extends Interface {
    static kind = "reset_sink";
}
Interface.register(ResetSink);

export class ResetSource extends Interface {
    static kind = "reset_source";
}
Interface.register(ResetSource);
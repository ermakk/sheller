declare module 'telnet-client' {
  import { EventEmitter } from 'node:events'

  export interface TelnetOptions {
    host?: string
    port?: number
    timeout?: number
    negotiationMandatory?: boolean
    shellPrompt?: string
  }

  export class Telnet extends EventEmitter {
    constructor(options?: TelnetOptions)
    connect(options?: TelnetOptions): Promise<void>
    write(data: string | Buffer): boolean
    destroy(): void
    end(): void
    on(event: 'data', listener: (data: Buffer) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
  }
}
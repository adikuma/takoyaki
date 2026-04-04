// tcp socket server for cli communication
// listens on a random port, writes address to ~/.mux/socket_addr
// handles both v1 text and v2 json-rpc line protocols

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { RpcHandler, RpcRequest } from './rpc'

export class SocketServer {
  private server: net.Server | null = null
  private port = 0
  private healthTimer: NodeJS.Timeout | null = null

  constructor(private rpcHandler: RpcHandler) {}

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((conn) => this.handleConnection(conn))

      this.server.on('error', reject)

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address() as net.AddressInfo
        this.port = addr.port
        this.writeAddrFile()
        resolve(this.port)
      })
    })
  }

  stop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
    this.server?.close()
    this.server = null
    this.cleanAddrFile()
  }

  getPort(): number {
    return this.port
  }

  // recreate socket_addr if missing (called by repair button and health check)
  ensureAddrFile(): void {
    if (!this.port) return
    const file = path.join(os.homedir(), '.mux', 'socket_addr')
    if (!fs.existsSync(file)) this.writeAddrFile()
  }

  // periodic check that socket_addr exists, self-heals if deleted
  startHealthCheck(): void {
    this.healthTimer = setInterval(() => this.ensureAddrFile(), 30_000)
  }

  private handleConnection(conn: net.Socket): void {
    let buffer = ''

    conn.on('data', (chunk) => {
      buffer += chunk.toString()
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, idx).trim()
        buffer = buffer.substring(idx + 1)
        if (!line) continue

        const response = this.processLine(line)
        conn.write(response + '\n')
      }
    })

    conn.on('error', () => {
      // client disconnected
    })
  }

  private processLine(line: string): string {
    // try json-rpc first
    try {
      const req = JSON.parse(line) as RpcRequest
      if (req.method) {
        return JSON.stringify(this.rpcHandler.handleV2(req))
      }
    } catch {
      // not json, treat as v1 text
    }
    return this.rpcHandler.handleV1(line)
  }

  private writeAddrFile(): void {
    try {
      const dir = path.join(os.homedir(), '.mux')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'socket_addr'), `127.0.0.1:${this.port}`, 'utf-8')
    } catch (error) {
      console.error('failed to write socket_addr:', error)
    }
  }

  private cleanAddrFile(): void {
    try {
      const file = path.join(os.homedir(), '.mux', 'socket_addr')
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch {
      // non-fatal
    }
  }
}

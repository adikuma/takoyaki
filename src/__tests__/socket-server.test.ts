import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { version as appVersion } from '../../package.json'
import * as net from 'net'
import { SocketServer } from '../main/socket-server'
import { RpcHandler } from '../main/rpc'
import { WorkspaceManager } from '../main/workspace'
import { TerminalManager } from '../main/terminal'

// helper: connect to server and send a line, return the response
function sendLine(port: number, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
      client.write(line + '\n')
    })
    let data = ''
    client.on('data', (chunk) => {
      data += chunk.toString()
      if (data.includes('\n')) {
        client.end()
        resolve(data.trim())
      }
    })
    client.on('error', reject)
    // timeout after 2 seconds
    setTimeout(() => {
      client.destroy()
      reject(new Error('timeout'))
    }, 2000)
  })
}

describe('SocketServer', () => {
  let server: SocketServer
  let port: number

  beforeEach(async () => {
    const terminals = new TerminalManager()
    const workspaces = new WorkspaceManager(terminals)
    const rpc = new RpcHandler(workspaces, terminals, appVersion)
    server = new SocketServer(rpc)
    port = await server.start()
  })

  afterEach(() => {
    server.stop()
  })

  it('responds to v1 ping', async () => {
    const response = await sendLine(port, 'ping')
    expect(response).toBe('PONG')
  })

  it('responds to v2 json-rpc ping', async () => {
    const req = JSON.stringify({ id: 1, method: 'system.capabilities', params: {} })
    const response = await sendLine(port, req)
    const parsed = JSON.parse(response)
    expect(parsed.ok).toBe(true)
    expect(parsed.result.name).toBe('takoyaki')
  })

  it('handles multiple sequential requests on same connection', async () => {
    // this test sends two requests on one connection
    const result = await new Promise<string[]>((resolve, reject) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        client.write('ping\n')
        client.write(JSON.stringify({ id: 1, method: 'system.capabilities', params: {} }) + '\n')
      })
      const responses: string[] = []
      let buffer = ''
      client.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop()! // keep incomplete line
        for (const line of lines) {
          if (line.trim()) responses.push(line.trim())
        }
        if (responses.length >= 2) {
          client.end()
          resolve(responses)
        }
      })
      client.on('error', reject)
      setTimeout(() => {
        client.destroy()
        reject(new Error('timeout'))
      }, 2000)
    })

    expect(result[0]).toBe('PONG')
    expect(JSON.parse(result[1]).ok).toBe(true)
  })

  it('returns error for unknown v2 method', async () => {
    const req = JSON.stringify({ id: 1, method: 'nope.nope', params: {} })
    const response = await sendLine(port, req)
    const parsed = JSON.parse(response)
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('method_not_found')
  })
})

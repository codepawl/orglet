import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { connect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { BrowserPolicy } from '../shared/browser-host';
import { requestRefusal, type ResolveAddresses } from '../core/tools/browser-policy';

/**
 * The network gate of Orglet's browser (COD-261). Every connection the browser makes goes through this proxy on
 * 127.0.0.1, loopback included (Playwright sends loopback through a proxy on Chromium), so every hop is checked: the
 * first request, each redirect, frames, workers and web sockets. A request-level hook in the browser sees only the
 * first address of a redirect chain; this sees them all.
 *
 * The proxy resolves each name itself, refuses one that points into a private network unless the chat listed it, and
 * connects to the address it checked, so a name cannot resolve to something else between the check and the
 * connection. It never reads or changes what flows through a tunnel.
 */
export class PolicyProxy {
  private server: Server;
  private sockets = new Set<Socket | Duplex>();

  /** `policy` is read for every connection, so a narrowed site list applies to the next one. */
  constructor(private policy: () => BrowserPolicy, private resolve: ResolveAddresses) {
    this.server = createServer((request, response) => void this.forward(request, response));
    this.server.on('connect', (request: IncomingMessage, socket: Duplex, head: Buffer) => void this.tunnel(request, socket, head));
    this.server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => void this.upgrade(request, socket, head));
    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Không mở được cổng mạng cho trình duyệt.');
    return `http://127.0.0.1:${address.port}`;
  }

  close() {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server.close();
  }

  /** The address to connect to for host:port, or the reason it is refused. */
  private async target(url: string, host: string): Promise<{ address: string } | { refusal: string }> {
    const refusal = await requestRefusal(url, this.policy(), false, this.resolve);
    if (refusal) return { refusal };
    const bare = host.replace(/^\[|\]$/g, '');
    if (isIP(bare)) return { address: bare };
    try {
      const addresses = await this.resolve(bare);
      if (!addresses.length) return { refusal: 'Không tìm thấy trang này (tên miền không tồn tại).' };
      // The check above looked at every address; connect only to one of those.
      const second = await requestRefusal(url, this.policy(), false, async () => addresses);
      if (second) return { refusal: second };
      return { address: addresses[0] };
    } catch {
      return { refusal: 'Không tìm thấy trang này (tên miền không tồn tại).' };
    }
  }

  /** HTTPS and secure web sockets: `CONNECT host:port`, then a byte tunnel the proxy never looks into. */
  private async tunnel(request: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => socket.destroy());
    const hostPort = request.url ?? '';
    const separator = hostPort.lastIndexOf(':');
    const host = separator > 0 ? hostPort.slice(0, separator) : hostPort;
    const port = Number(separator > 0 ? hostPort.slice(separator + 1) : '443');
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const scheme = port === 80 ? 'http' : 'https';
    const decided = await this.target(`${scheme}://${hostPort}/`, host);
    if ('refusal' in decided) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstream = connect(port, decided.address, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    this.sockets.add(upstream);
    upstream.on('close', () => this.sockets.delete(upstream));
    upstream.on('error', () => {
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
    socket.on('close', () => upstream.destroy());
  }

  /** Plain HTTP: the browser sends the whole address, and the proxy makes the request to the address it checked. */
  private async forward(request: IncomingMessage, response: import('node:http').ServerResponse) {
    let url: URL;
    try {
      url = new URL(request.url ?? '');
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (url.protocol !== 'http:') {
      response.writeHead(400).end();
      return;
    }
    const decided = await this.target(url.href, url.hostname);
    if ('refusal' in decided) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end(decided.refusal);
      return;
    }
    const headers = { ...request.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = httpRequest({
      host: decided.address, port: url.port || 80, method: request.method, path: `${url.pathname}${url.search}`, headers, setHost: false,
    }, answer => {
      response.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.headers);
      answer.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502).end();
      else response.destroy();
    });
    request.pipe(upstream);
  }

  /** A plain web socket asked through the proxy: checked like any address, then tunnelled with its first bytes. */
  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => socket.destroy());
    let url: URL;
    try {
      url = new URL(request.url ?? '');
    } catch {
      socket.destroy();
      return;
    }
    const decided = await this.target(url.href.replace(/^ws:/, 'http:'), url.hostname);
    if ('refusal' in decided) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const port = Number(url.port || 80);
    const upstream = connect(port, decided.address, () => {
      const lines = [`${request.method} ${url.pathname}${url.search} HTTP/1.1`];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index];
        if (/^proxy-/i.test(name)) continue;
        lines.push(`${name}: ${request.rawHeaders[index + 1]}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    this.sockets.add(upstream);
    upstream.on('close', () => this.sockets.delete(upstream));
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  }
}

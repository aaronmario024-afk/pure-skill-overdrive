import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 1024 * 1024; // 1 MB guard

function encodeFrame(opcode, payloadBuf) {
  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuf]);
}

export function createWsServer(httpServer, opts = {}) {
  const path = opts.path || '/ws';
  const onConnection = opts.onConnection || (() => {});
  const sockets = new Set();
  let nextConnId = 1;

  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.isOpen) continue;
      ws._sendRawFrame(0x9, Buffer.alloc(0));
    }
  }, 20_000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  const onUpgrade = (req, socket, head) => {
    const reqPath = (req.url || '/').split('?')[0];
    // Crucial: leave Vite HMR or any unrelated upgrade path untouched
    if (reqPath !== path) return;

    const key = req.headers['sec-websocket-key'];
    if (!key || typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    socket.setNoDelay(true);

    const connId = `ws_${nextConnId++}`;
    const msgListeners = new Set();
    const closeListeners = new Set();
    let closed = false;
    let rxBuf = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
    let fragChunks = [];
    let fragOpcode = 0;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      sockets.delete(ws);
      for (const fn of closeListeners) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
    };

    const ws = {
      id: connId,
      isAlive: true,
      get isOpen() {
        return !closed && socket.writable && !socket.destroyed;
      },
      _sendRawFrame(opcode, buf) {
        if (closed || !socket.writable || socket.destroyed) return false;
        try {
          socket.write(encodeFrame(opcode, buf));
          return true;
        } catch {
          cleanup();
          return false;
        }
      },
      send(str) {
        return ws._sendRawFrame(0x1, Buffer.from(String(str), 'utf8'));
      },
      sendJson(obj) {
        return ws.send(JSON.stringify(obj));
      },
      close(code = 1000) {
        if (closed) return;
        const p = Buffer.allocUnsafe(2);
        p.writeUInt16BE(code, 0);
        ws._sendRawFrame(0x8, p);
        try {
          socket.end();
        } catch {
          // ignore
        }
        cleanup();
      },
      onMessage(fn) {
        msgListeners.add(fn);
        return () => msgListeners.delete(fn);
      },
      onClose(fn) {
        closeListeners.add(fn);
        return () => closeListeners.delete(fn);
      },
    };

    const processBuffer = () => {
      while (rxBuf.length >= 2 && !closed) {
        const b0 = rxBuf[0];
        const b1 = rxBuf[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (rxBuf.length < offset + 2) break;
          payloadLen = rxBuf.readUInt16BE(offset);
          offset += 2;
        } else if (payloadLen === 127) {
          if (rxBuf.length < offset + 8) break;
          const bigLen = rxBuf.readBigUInt64BE(offset);
          if (bigLen > BigInt(MAX_FRAME_BYTES)) {
            ws.close(1009);
            socket.destroy();
            return;
          }
          payloadLen = Number(bigLen);
          offset += 8;
        }

        if (payloadLen > MAX_FRAME_BYTES) {
          ws.close(1009);
          socket.destroy();
          return;
        }

        const totalNeeded = offset + (masked ? 4 : 0) + payloadLen;
        if (rxBuf.length < totalNeeded) break;

        let payload = rxBuf.subarray(offset + (masked ? 4 : 0), totalNeeded);
        if (masked) {
          const maskKey = rxBuf.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ maskKey[i & 3];
          }
          payload = unmasked;
        } else {
          payload = Buffer.from(payload);
        }

        rxBuf = rxBuf.subarray(totalNeeded);

        if (opcode === 0x8) {
          ws.close(1000);
          return;
        }
        if (opcode === 0x9) {
          ws._sendRawFrame(0xA, payload);
          continue;
        }
        if (opcode === 0xA) {
          ws.isAlive = true;
          continue;
        }

        if (opcode === 0x1 || opcode === 0x2) {
          fragOpcode = opcode;
          fragChunks = [payload];
        } else if (opcode === 0x0) {
          if (!fragOpcode) continue;
          fragChunks.push(payload);
        } else {
          continue;
        }

        if (fin) {
          const full = fragChunks.length === 1 ? fragChunks[0] : Buffer.concat(fragChunks);
          const text = full.toString('utf8');
          fragChunks = [];
          fragOpcode = 0;
          for (const fn of msgListeners) {
            try {
              fn(text);
            } catch {
              // ignore handler exception
            }
          }
        }
      }
    };

    sockets.add(ws);
    socket.on('data', (chunk) => {
      rxBuf = rxBuf.length ? Buffer.concat([rxBuf, chunk]) : Buffer.from(chunk);
      processBuffer();
    });
    socket.on('close', cleanup);
    socket.on('end', cleanup);
    socket.on('error', cleanup);

    onConnection(ws, req);
    if (rxBuf.length > 0) processBuffer();
  };

  httpServer.on('upgrade', onUpgrade);
  httpServer.on('close', () => {
    clearInterval(heartbeat);
    for (const ws of sockets) ws.close(1001);
    sockets.clear();
  });

  return {
    close() {
      clearInterval(heartbeat);
      httpServer.off('upgrade', onUpgrade);
      for (const ws of sockets) ws.close(1001);
      sockets.clear();
    },
  };
}

#!/usr/bin/env node
'use strict';
import net from 'net';
import crypto from 'crypto';

/** Send one JSON line to TCP:4028, return parsed JSON */
function sendTcpJson(ip: string, obj: any, timeoutMs = 4000): Promise<any> {
  const line = JSON.stringify(obj) + '\n';
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks: Buffer[] = [];
    let done = false;
    const fail = (e: Error) => { if (!done) { done = true; socket.destroy(); reject(e); } };

    const t = setTimeout(() => fail(new Error(`TCP timeout after ${timeoutMs}ms`)), timeoutMs);

    socket.connect(4028, ip, () => socket.write(line));
    socket.on('data', (buf) => chunks.push(buf));
    socket.on('error', fail);
    socket.on('end', () => {
      if (done) return;
      clearTimeout(t);
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      try { resolve(JSON.parse(raw || '{}')); }
      catch (e) { reject(new Error(`Bad JSON from ${ip}: ${raw.slice(0, 200)}`)); }
    });
  });
}

/** Pure Node.js md5-crypt implementation (compatible with OpenSSL's -1 mode) */
function md5CryptHashOnly(pass: string, salt: string): string {
  // MD5-crypt algorithm (used by OpenSSL passwd -1)
  const passBytes = Buffer.from(pass, 'utf8');
  const saltBytes = Buffer.from(salt, 'utf8');
  
  // Initial hash: MD5(password + salt + password)
  let hash = crypto.createHash('md5');
  hash.update(passBytes);
  hash.update(Buffer.from('$1$', 'utf8'));
  hash.update(saltBytes);
  
  let alt = crypto.createHash('md5');
  alt.update(passBytes);
  alt.update(saltBytes);
  alt.update(passBytes);
  let altResult = alt.digest();
  
  // Add altResult to hash based on password length
  for (let i = passBytes.length; i > 0; i -= 16) {
    hash.update(altResult.slice(0, Math.min(16, i)));
  }
  
  // Add password or null bytes based on password bits
  for (let i = passBytes.length; i > 0; i >>= 1) {
    if (i & 1) {
      hash.update(Buffer.from([0]));
    } else {
      hash.update(passBytes.slice(0, 1));
    }
  }
  
  let result = hash.digest();
  
  // 1000 rounds of MD5
  for (let i = 0; i < 1000; i++) {
    let ctx = crypto.createHash('md5');
    if (i & 1) {
      ctx.update(passBytes);
    } else {
      ctx.update(result);
    }
    if (i % 3) {
      ctx.update(saltBytes);
    }
    if (i % 7) {
      ctx.update(passBytes);
    }
    if (i & 1) {
      ctx.update(result);
    } else {
      ctx.update(passBytes);
    }
    result = ctx.digest();
  }
  
  // Base64 encode (custom alphabet for crypt)
  const b64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const encode = (a: number, b: number, c: number, n: number): string => {
    let w = (a << 16) | (b << 8) | c;
    let out = '';
    for (let i = 0; i < n; i++) {
      out += b64[w & 0x3f];
      w >>= 6;
    }
    return out;
  };
  
  return encode(result[0], result[6], result[12], 4) +
         encode(result[1], result[7], result[13], 4) +
         encode(result[2], result[8], result[14], 4) +
         encode(result[3], result[9], result[15], 4) +
         encode(result[4], result[10], result[5], 4) +
         encode(0, 0, result[11], 2);
}

/** WhatsMiner tokened client */
export class WhatsMiner {
  private ip: string;
  private pw: string;
  private timeoutMs: number;
  private key: string | null = null;       // token
  private sign: string | null = null;
  private aesKey: Buffer | null = null;    // sha256(key)
  private t0 = 0;

  constructor(ip: string, adminPassword: string, timeoutMs = 4000) {
    this.ip = ip;
    this.pw = adminPassword;
    this.timeoutMs = timeoutMs;
  }

  private async _fetchToken(): Promise<void> {
    const tok = await sendTcpJson(this.ip, { cmd: 'get_token' }, this.timeoutMs);
    const msg = tok.Msg || tok; // some firmwares wrap it
    const timeStr = msg.time;
    const salt = msg.salt;
    const newsalt = msg.newsalt;
    if (!timeStr || !salt || !newsalt) throw new Error(`get_token missing fields: ${JSON.stringify(tok)}`);

    const key = md5CryptHashOnly(this.pw, salt);                    // token
    const time4 = String(timeStr).slice(-4);
    const sign = md5CryptHashOnly(key + time4, newsalt);            // sign
    const aesKey = crypto.createHash('sha256').update(key).digest();// 32 bytes

    this.key = key; this.sign = sign; this.aesKey = aesKey; this.t0 = Date.now();
  }

  private async _ensureTokenFresh(): Promise<void> {
    if (!this.key || Date.now() - this.t0 > 20 * 60 * 1000) {
      await this._fetchToken();
    }
  }

  /** Encrypted write call: {"enc":1,"data": base64(AES-ECB("token,sign|<api_str>"))} */
  private async _encCall(apiObj: any): Promise<any> {
    await this._ensureTokenFresh();

    const apiStr = JSON.stringify(apiObj);
    const plain = Buffer.from(`${this.key},${this.sign}|${apiStr}`, 'utf8');

    // AES-256-ECB with PKCS#7 padding (Node applies padding when setAutoPadding(true))
    const cipher = crypto.createCipheriv('aes-256-ecb', this.aesKey!, null);
    cipher.setAutoPadding(true);
    const b64 = Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64');

    const resp = await sendTcpJson(this.ip, { enc: 1, data: b64 }, this.timeoutMs);

    // Optional: decrypt enc reply for readability
    if (resp && resp.enc === 1 && typeof resp.data === 'string') {
      try {
        const raw = Buffer.from(resp.data, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-ecb', this.aesKey!, null);
        decipher.setAutoPadding(true);
        const dec = Buffer.concat([decipher.update(raw), decipher.final()]);
        const text = dec.toString('utf8');
        // decrypted form is usually "<token,sign>|{...json...}"
        const jsonPart = text.includes('|') ? text.split('|').pop() : text;
        return JSON.parse(jsonPart!);
      } catch { /* fall through */ }
    }
    return resp;
  }

  reboot(): Promise<any> { return this._encCall({ cmd: 'reboot' }); }                 // control-board reboot
  restartBtminer(): Promise<any> { return this._encCall({ cmd: 'restart_btminer' }); } // daemon restart
}

/** Antminer (cgminer/bmminer) process restart on 4028 */
export async function antminerRestart(ip: string, timeoutMs = 4000): Promise<any> {
  return sendTcpJson(ip, { command: 'restart' }, timeoutMs);
}

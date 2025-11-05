#!/usr/bin/env node
'use strict';
import net from 'net';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

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

/** md5-crypt via system OpenSSL (matches `openssl passwd -1 -salt <salt> <pass>`) */
function md5CryptHashOnly(pass: string, salt: string): string {
  // Output format: $1$<salt>$<hash>
  const out = execFileSync('openssl', ['passwd', '-1', '-salt', String(salt), String(pass)], { encoding: 'utf8' }).trim();
  const parts = out.split('$');
  if (parts.length < 4) throw new Error(`Unexpected openssl output: ${out}`);
  return parts[3]; // the <hash> part after $1$<salt>$
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

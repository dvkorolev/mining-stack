const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKEND_ROOT = path.join(__dirname, '..');
const PORT = '5599';
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const POLL_INTERVAL_MS = 300;
const READY_TIMEOUT_MS = 25000;
const STDERR_TAIL_LINES = 30;

test('built server boots and serves GET /health with HTTP 200', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-smoke-'));

  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT,
    USE_REAL_DATA: 'false',
    PROMETHEUS_ENABLED: 'false',
    JWT_ACCESS_SECRET: 'test-access-secret-not-default',
    JWT_REFRESH_SECRET: 'test-refresh-secret-not-default',
    DATA_DIR: tmpDir,
  };

  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: BACKEND_ROOT,
    env: childEnv,
  });

  const stderrChunks = [];
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

  let ready = false;
  let exitCode = null;
  let exitedEarly = false;

  child.on('exit', (code) => {
    exitCode = code;
    if (!ready) {
      exitedEarly = true;
    }
  });

  const getStderrTail = () =>
    Buffer.concat(stderrChunks)
      .toString('utf8')
      .split('\n')
      .slice(-STDERR_TAIL_LINES)
      .join('\n');

  const cleanup = () => {
    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  after(() => {
    cleanup();
  });

  const healthCheck = () =>
    new Promise((resolve, reject) => {
      const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('health request timed out'));
      });
    });

  await new Promise((resolve, reject) => {
    const startTime = Date.now();

    const poll = setInterval(async () => {
      if (exitedEarly) {
        clearInterval(poll);
        reject(
          new Error(
            `Server exited early with code ${exitCode}.\n\nStderr tail:\n${getStderrTail()}`
          )
        );
        return;
      }

      if (Date.now() - startTime > READY_TIMEOUT_MS) {
        clearInterval(poll);
        reject(
          new Error(
            `Server did not respond on ${HEALTH_URL} within ${READY_TIMEOUT_MS}ms.\n\nStderr tail:\n${getStderrTail()}`
          )
        );
        return;
      }

      try {
        const statusCode = await healthCheck();
        if (statusCode === 200) {
          clearInterval(poll);
          ready = true;
          resolve();
        }
      } catch {
        // keep polling
      }
    }, POLL_INTERVAL_MS);
  });

  assert.strictEqual(ready, true, 'server should be ready and return HTTP 200');
});

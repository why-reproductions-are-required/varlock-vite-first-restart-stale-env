// Starts the Vite dev server, changes GREETING in app/.env.local two times,
// and reads ENV.GREETING from the transformed /main.js after each restart.
//
//   node repro.mjs                 runs `vite app` from the repository root
//   node repro.mjs --root-dir      the same, with `rootDir` set and _VARLOCK_ENV_KEY preset
//   node repro.mjs --cwd-is-root   runs `vite` from app/ (control)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const cwdIsRoot = process.argv.includes('--cwd-is-root');
const rootDir = process.argv.includes('--root-dir');
const appDir = path.resolve('app');
const envLocal = path.join(appDir, '.env.local');
const viteBin = path.resolve('node_modules/vite/bin/vite.js');
const port = 5199;

fs.writeFileSync(envLocal, 'GREETING=first\n');

const args = [
  viteBin,
  ...(cwdIsRoot ? [] : ['app']),
  ...(rootDir ? ['--config', 'app/vite.config.root-dir.js'] : []),
  '--port',
  String(port),
  '--strictPort',
];
// Any value works. The integration only checks that the variable is set.
const env = rootDir ? { _VARLOCK_ENV_KEY: randomBytes(32).toString('hex') } : {};
const envPrefix = Object.keys(env).map((key) => `${key}=<random> `).join('');
console.log(`$ cd ${cwdIsRoot ? 'app' : '.'} && ${envPrefix}vite ${args.slice(1).join(' ')}\n`);
const vite = spawn(process.execPath, args, {
  cwd: cwdIsRoot ? appDir : process.cwd(),
  env: { ...process.env, ...env, NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
const waiters = [];
function onOutput(chunk) {
  process.stdout.write(chunk);
  output += chunk;
  for (const waiter of [...waiters]) waiter();
}
vite.stdout.setEncoding('utf8').on('data', onOutput);
vite.stderr.setEncoding('utf8').on('data', onOutput);

function waitForOutput(pattern, count) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}`)), 30_000);
    const check = () => {
      if ((output.match(pattern) ?? []).length >= count) {
        clearTimeout(timer);
        waiters.splice(waiters.indexOf(check), 1);
        resolve();
      }
    };
    waiters.push(check);
    check();
  });
}

async function readGreeting() {
  const res = await fetch(`http://localhost:${port}/main.js`);
  const code = await res.text();
  return code.match(/greeting = "(.*?)"/)?.[1] ?? `<not inlined: ${code.split('\n')[2]}>`;
}

const results = [];
try {
  await waitForOutput(/ready in/g, 1);
  results.push(['start', 'first', await readGreeting()]);

  for (const [step, value] of [['restart 1', 'second'], ['restart 2', 'third']]) {
    // Vite watches the env files and restarts the server when one changes.
    fs.writeFileSync(envLocal, `GREETING=${value}\n`);
    await waitForOutput(/server restarted/g, results.length);
    results.push([step, value, await readGreeting()]);
  }
} finally {
  vite.kill();
  fs.rmSync(envLocal, { force: true });
}

console.log('\nENV.GREETING in /main.js after each app/.env.local change:');
console.table(results.map(([step, expected, actual]) => ({
  step,
  expected,
  actual,
  result: expected === actual ? 'ok' : 'STALE',
})));
if (results.some(([, expected, actual]) => expected !== actual)) {
  console.error('FAIL: the dev server kept a stale env value after a restart.');
  process.exit(1);
}
console.log('PASS: every restart picked up the new value.');

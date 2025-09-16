import 'dotenv/config';
import { spawn } from 'node:child_process';

/** ------------ CONFIG ------------- */
const MONGO_BASE = process.env.NEXT_PUBLIC_MONGO_BASE || ''; 
const NC_BASE    = process.env.NEXT_PUBLIC_NC_BASE || '';    
const SMTP_BASE  = process.env.NEXT_PUBLIC_SMTP_BASE || '';  
const CHECK_INTERVAL_MS   = 30_000;
const STARTUP_GRACE_MS    = 5_000;
const TIMEOUT_MS          = 5_000;
const FAIL_THRESHOLD = {
  mongo: 1,
  nc: 1,
  smtp: 1,
};
const COOLDOWN_MS = 5_000;

/** ------------ STATE ------------- */
const procs = {
  mongo: { child: null, fails: 0, cooldownUntil: 0, name: 'mongo',     base: MONGO_BASE, path: '/api/health' },
  nc:    { child: null, fails: 0, cooldownUntil: 0, name: 'nextcloud', base: NC_BASE,    path: '/api/health' },
  smtp:  { child: null, fails: 0, cooldownUntil: 0, name: 'smtp',      base: SMTP_BASE,  path: '/' },
};

/** ------------ UTILS ------------- */
function log(tag, msg, color = '') {
  const map = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', magenta: '\x1b[35m' };
  const c = map[color] || '';
  const r = '\x1b[0m';
  console.log(`${c}[${tag}]${r} ${msg}`);
}

function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    const pid = String(child.pid);
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore', shell: true });
      killer.on('close', () => resolve());
    } else {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 800);
    }
  });
}

async function ping(base, path = '/api/health', timeout = TIMEOUT_MS) {
  if (!base) return false;
  const url = `${base.replace(/\/$/, '')}${path}`;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    return r.ok;
  } catch {
    try {
      const r2 = await fetch(base, { signal: ac.signal, cache: 'no-store' });
      return r2.ok;
    } catch {
      return false;
    }
  } finally { clearTimeout(id); }
}

/** ------------ STARTERS ------------- */
function startMongo() {
  if (procs.mongo.child) return;
  log('mongo', 'starting...', 'green');
  procs.mongo.child = spawn('node', ['--env-file=.env', 'photobootAPI/mongo-api/mongoAPI.js'], { stdio: 'inherit', shell: true });
  procs.mongo.child.on('exit', (code, sig) => {
    log('mongo', `exited (code=${code} sig=${sig})`, 'yellow');
    procs.mongo.child = null;
  });
}

function startNC() {
  if (procs.nc.child) return;
  log('nextcloud', 'starting...', 'green');
  procs.nc.child = spawn('node', ['--env-file=.env', 'photobootAPI/nextcloud-api/nextcloudAPI.js'], { stdio: 'inherit', shell: true });
  procs.nc.child.on('exit', (code, sig) => {
    log('nextcloud', `exited (code=${code} sig=${sig})`, 'yellow');
    procs.nc.child = null;
  });
}

function startSMTP() {
  if (procs.smtp.child) return;
  log('smtp', 'starting...', 'green');
  procs.smtp.child = spawn('node', ['--env-file=.env', 'photobootAPI/smtp-api/smtpAPI.js'], { stdio: 'inherit', shell: true });
  procs.smtp.child.on('exit', (code, sig) => {
    log('smtp', `exited (code=${code} sig=${sig})`, 'yellow');
    procs.smtp.child = null;
  });
}

async function restart(which) {
  const p = procs[which];
  if (!p) return;
  if (Date.now() < p.cooldownUntil) return;

  log(which, 'restarting...', 'magenta');
  const child = p.child;
  p.child = null;
  p.fails = 0;
  p.cooldownUntil = Date.now() + COOLDOWN_MS;
  await killTree(child);

  if (which === 'mongo') startMongo();
  if (which === 'nc')    startNC();
  if (which === 'smtp')  startSMTP();
}

/** ------------ HEALTH LOOP ------------- */
async function checkOne(which) {
  const p = procs[which];
  if (!p) return;

  if (!p.child) {
    if (which === 'mongo') startMongo();
    else if (which === 'nc') startNC();
    else if (which === 'smtp') startSMTP();
    await new Promise(r => setTimeout(r, STARTUP_GRACE_MS));
  }

  const ok = await ping(p.base, p.path);
  if (ok) {
    if (p.fails > 0) log(which, 'healthy again', 'green');
    p.fails = 0;
    return;
  }

  p.fails++;
  log(which, `health FAIL (${p.fails})`, 'red');
  const need = FAIL_THRESHOLD[which];
  if (p.fails >= need) await restart(which);
}

async function healthLoop() {
  await checkOne('mongo');
  await checkOne('nc');
  await checkOne('smtp');
}

/** ------------ MAIN ------------- */
function main() {
  startMongo();
  startNC();
  startSMTP();

  setTimeout(healthLoop, STARTUP_GRACE_MS);
  setInterval(healthLoop, CHECK_INTERVAL_MS);

  const shutdown = async () => {
    log('supervisor', 'shutting down...', 'yellow');
    await killTree(procs.mongo.child);
    await killTree(procs.nc.child);
    await killTree(procs.smtp.child);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from 'webdav';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import https from 'https';
import mime from 'mime-types';

const app = express()
const port = process.env.NEXTCLOUD_PORT;

const raw = process.env.CORS_ALLOW_ORIGINS || "";
const allowlist = raw.split(",").map(s => s.trim()).filter(Boolean);
const allowNoOrigin = true;

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return allowNoOrigin ? cb(null, true) : cb(new Error("CORS: Origin required"), false);
    if (allowlist.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`), false);
  },
  methods: ["GET","HEAD","POST","PATCH","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: false,
};

app.use(express.json());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ==== Nextcloud config ====
const username   = process.env.NEXTCLOUD_Username;
const ncPassword = process.env.NEXTCLOUD_Password;
const webdavUrl  = process.env.NEXTCLOUD_webdavUrl;
const ocsApiUrl  = process.env.NEXTCLOUD_ocsApiUrl;

if (!username || !ncPassword || !webdavUrl || !ocsApiUrl) {
  console.warn('⚠️ Missing some NEXTCLOUD_* envs. Check .env file.');
}
console.log('[ENV]', { port, webdavUrl, ocsApiUrl });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// WebDAV client
const webdavClient = createClient(webdavUrl, {
  username,
  password: ncPassword,
  httpsAgent
});

// ===== Helpers =====
async function getExistingPublicShare(cleanPath) {
  const resp = await axios.get(`${ocsApiUrl}/shares`, {
    params: { format: 'json', path: cleanPath },
    auth: { username, password: ncPassword },
    headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
    httpsAgent
  });

  const list = resp.data?.ocs?.data || [];
  return list.find(s => String(s.share_type) === '3' && s.path === cleanPath) || null;
}

async function maybeUpdateShare(shareId, { note, linkPassword, expiration, permissions, publicUpload }) {
  const params = new URLSearchParams();
  if (note) params.set('note', note);
  if (linkPassword) params.set('password', linkPassword);
  if (expiration) params.set('expireDate', new Date(expiration).toISOString().split('T')[0]);
  if (typeof permissions !== 'undefined') params.set('permissions', String(permissions));
  if (typeof publicUpload !== 'undefined') {
    params.set('publicUpload', (publicUpload === true || String(publicUpload) === 'true') ? 'true' : 'false');
  }
  if ([...params.keys()].length === 0) return;

  await axios.put(`${ocsApiUrl}/shares/${shareId}?format=json`, params.toString(), {
    auth: { username, password: ncPassword },
    headers: {
      'OCS-APIRequest': 'true',
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    httpsAgent
  });
}

function pickFirstPath({ filePath, filePaths }) {
  if (Array.isArray(filePaths) && filePaths.length) return String(filePaths[0]).trim();
  if (Array.isArray(filePath) && filePath.length)   return String(filePath[0]).trim();
  if (typeof filePath === 'string') {
    const s = filePath.trim();
    if (!s) return '';
    const parts = s.split(/[,|\r?\n]+/).map(t => t.trim()).filter(Boolean);
    return parts[0] || '';
  }
  return '';
}


// ==== Upload + Share (no QR) with de-dup ====
app.post('/api/nextcloud/upload-and-share', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Content-Type must be application/json' });
    }

    const {
      folderName,
      filePath,        // string | string[] | string คั่น comma/newline
      filePaths,       // string[]
      targetName,      // << ตั้งชื่อไฟล์ปลายทาง (ออปชัน)
      permissions = 1,
      publicUpload,
      note,
      linkPassword,
      expiration,      // YYYY-MM-DD
      forceNew
    } = req.body || {};

    const firstPath = pickFirstPath({ filePath, filePaths });
    if (!folderName || !firstPath) {
      return res.status(400).json({ error: 'Missing folderName or filePath' });
    }
    if (expiration && isNaN(Date.parse(expiration))) {
      return res.status(400).json({ error: 'Invalid expiration date format' });
    }

    // 1) Upload via WebDAV
    await fs.access(firstPath).catch(() => { throw new Error(`File not found: ${firstPath}`); });

    const folderPath = `files/${username}/${folderName}`;
    try { await webdavClient.createDirectory(folderPath); }
    catch (err) { if (err.response?.status !== 405) throw err; } // 405 = exists

    const baseName = (typeof targetName === 'string' && targetName.trim())
      ? targetName.trim()
      : path.basename(firstPath);

    const davRemotePath = `${folderPath}/${baseName}`;
    await webdavClient.putFileContents(davRemotePath, await fs.readFile(firstPath));

    // 2) Share path (folder root)
    const cleanPath = `/${folderName}`;

    // 3) Reuse existing link if present (unless forceNew)
    let existed = false;
    let shareId, shareLink;

    if (!forceNew) {
      const current = await getExistingPublicShare(cleanPath);
      if (current) {
        existed = true;
        shareId = current.id;
        shareLink = current.url;
        try {
          await maybeUpdateShare(shareId, { note, linkPassword, expiration, permissions, publicUpload });
        } catch (e) {
          console.warn('Failed to update existing share:', e.response?.data || e.message);
        }
      }
    }

    // 4) Create new link if none exists or forceNew
    if (!existed) {
      const form = new URLSearchParams();
      form.set('path', cleanPath);
      form.set('shareType', '3');
      form.set('permissions', String(permissions));
      if (linkPassword) form.set('password', linkPassword);
      if (expiration) form.set('expireDate', new Date(expiration).toISOString().split('T')[0]);
      if (typeof publicUpload !== 'undefined') {
        form.set('publicUpload', (publicUpload === true || String(publicUpload) === 'true') ? 'true' : 'false');
      }

      const createResp = await axios.post(`${ocsApiUrl}/shares?format=json`, form.toString(), {
        auth: { username, password: ncPassword },
        headers: {
          'OCS-APIRequest': 'true',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent
      });

      const meta = createResp.data?.ocs?.meta;
      const data = createResp.data?.ocs?.data;
      if (!meta || ![100, 200].includes(meta.statuscode)) {
        return res.status(500).json({ error: meta?.message || 'OCS create error', raw: createResp.data });
      }

      shareId = data?.id;
      shareLink = data?.url;

      if (note && shareId) {
        try { await maybeUpdateShare(shareId, { note }); }
        catch (e) { console.warn('Failed to set note on new share:', e.response?.data || e.message); }
      }
    }

    return res.json({
      message: existed ? 'Uploaded and reused existing public link' : 'Uploaded and created new public link',
      uploaded: {
        folder: `/${folderName}`,
        file: baseName,
        remotePath: `/${folderName}/${baseName}`
      },
      share: {
        id: shareId,
        url: shareLink,
        existed,
        protected: Boolean(linkPassword),
        expiration: expiration || null
      }
    });

  } catch (error) {
    console.error('Upload+Share error:', { message: error.message, status: error.response?.status, data: error.response?.data });
    return res.status(500).json({ error: `Upload+Share failed: ${error.message}`, raw: error.response?.data });
  }
});


// (Optional) upload only
app.post('/api/nextcloud/upload', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Content-Type must be application/json' });
    }
    const {
      folderName,
      filePath,        // string | string[] | string คั่น comma/newline
      filePaths,       // string[]
      targetName       // << ตั้งชื่อไฟล์ปลายทาง (ออปชัน)
    } = (req.body && typeof req.body === 'object') ? req.body : {};

    const firstPath = pickFirstPath({ filePath, filePaths });
    if (!folderName || !firstPath) {
      return res.status(400).json({ error: 'Missing folderName or filePath' });
    }

    await fs.access(firstPath).catch(() => { throw new Error(`File not found: ${firstPath}`); });

    const folderPath = `files/${username}/${folderName}`;
    try { await webdavClient.createDirectory(folderPath); }
    catch (err) { if (err.response?.status !== 405) throw err; }

    const baseName = (typeof targetName === 'string' && targetName.trim())
      ? targetName.trim()
      : path.basename(firstPath);

    const davRemotePath = `${folderPath}/${baseName}`;
    await webdavClient.putFileContents(davRemotePath, await fs.readFile(firstPath));

    res.json({
      message: 'Uploaded',
      uploaded: {
        folder: `/${folderName}`,
        file: baseName,
        remotePath: `/${folderName}/${baseName}`
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Normalize path ให้เป็น relative ต่อ WebDAV root ของ user เสมอ ---
function normRelPath(input) {
  if (!input) return "";
  let s = decodeURIComponent(String(input)).replace(/^https?:\/\/[^/]+/i, "");
  const escUser = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  s = s
    .replace(new RegExp(`^/?remote\\.php/dav/files/${escUser}/`, "i"), "")
    .replace(new RegExp(`^/?files/${escUser}/`, "i"), "")
    .replace(/^\/+/, "");
  return s;
}

// ---------- Robust image preview via WebDAV client ----------
app.get("/api/nextcloud/preview", async (req, res) => {
  try {
    if (!webdavUrl || !username || !ncPassword) {
      return res.status(500).json({ ok: false, message: "NEXTCLOUD_NOT_CONFIGURED" });
    }
    const rel = normRelPath(req.query.path || "");
    if (!rel) return res.status(400).json({ ok: false, message: "path required" });

    let data;
    try {
      data = await webdavClient.getFileContents(rel, { format: "binary" });
    } catch {
      const enc = rel.split("/").map(encodeURIComponent).join("/");
      data = await webdavClient.getFileContents(enc, { format: "binary" });
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const contentType = mime.lookup(rel) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.end(buf);
  } catch (e) {
    const status = e?.response?.status || 404;
    console.error("preview failed:", {
      status,
      msg: e?.message,
      path: req?.query?.path,
    });
    res.status(status).json({ ok: false, message: "PREVIEW_FAILED", status });
  }
});

// ---------- Debug: list directory ----------
app.get("/api/nextcloud/list", async (req, res) => {
  try {
    const rel = normRelPath(req.query.path || "");
    const dir = rel || "";
    const items = await webdavClient.getDirectoryContents(dir);
    res.json({
      ok: true,
      path: `/${dir}`,
      items: items.map((it) => ({
        type: it.type,          
        filename: it.filename,  
        basename: it.basename,
        size: it.size,
        lastmod: it.lastmod,
      })),
    });
  } catch (e) {
    console.error("list failed:", e?.message);
    res.status(500).json({ ok: false, message: "LIST_FAILED" });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.head('/api/health', (_req, res) => res.status(200).end());



app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

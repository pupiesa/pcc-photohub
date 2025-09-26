// nextcloudAPI.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from 'webdav';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import https from 'https';
import multer from 'multer';
import mime from 'mime-types';
import sharp from 'sharp';

const app = express();
const port = process.env.NEXTCLOUD_PORT;

// ----- CORS -----
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
const webdavUrl  = process.env.NEXTCLOUD_webdavUrl;   // e.g. http(s)://host/remote.php/dav/files/<user>
const ocsApiUrl  = process.env.NEXTCLOUD_ocsApiUrl;   // e.g. http(s)://host/ocs/v2.php/apps/files_sharing/api/v1

// (optional) direct preview base, used as 2nd attempt if webdav client getFileContents fails
const previewBase = process.env.NEXTCLOUD_PREVIEW
  ? process.env.NEXTCLOUD_PREVIEW.replace(/\/$/, "")
  : null;

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

////////////////////////////////////////////////////////////
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg','image/png','image/webp','image/gif','image/bmp','image/avif','image/heif','image/heic'
]);
const ALLOWED_IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.webp','.gif','.bmp','.avif','.heif','.heic']);

function isAllowedImage(name = '', mimetype = '') {
  const ext = '.' + String(name).split('.').pop()?.toLowerCase();
  return ALLOWED_IMAGE_MIMES.has(String(mimetype).toLowerCase()) || ALLOWED_IMAGE_EXTS.has(ext);
}

const uploadImagesOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB ปรับได้
  fileFilter(req, file, cb) {
    if (isAllowedImage(file.originalname, file.mimetype)) return cb(null, true);
    const err = new Error('ONLY_IMAGE_ALLOWED');
    err.status = 415; // Unsupported Media Type
    return cb(err);
  },
});
////////////////////////////////////////////////////////////

// ===== Helpers =====
async function getExistingPublicShare(cleanPath) {
  // cleanPath: "/<folderName>"
  const resp = await axios.get(`${ocsApiUrl}/shares`, {
    params: { format: 'json', path: cleanPath },
    auth: { username, password: ncPassword },
    headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
    httpsAgent
  });

  const list = resp.data?.ocs?.data || [];
  return list.find(s => String(s.share_type) === '3' && s.path === cleanPath) || null;
}

//Updated: รองรับการ "ลบรหัส" (ส่ง newPassword = ""), และ "ลบวันหมดอายุ" (expiration = ""/null)
async function maybeUpdateShare(shareId, { note, linkPassword, expiration, permissions, publicUpload }) {
  const params = new URLSearchParams();

  // note: ตั้งค่าแม้เป็น "" (ลบก็ได้)
  if (note !== undefined) params.set('note', note);

  // password:
  // - undefined => ไม่แก้
  // - "" (สตริงว่าง) => ลบรหัส
  // - ปกติ => ตั้งรหัสใหม่
  if (linkPassword !== undefined) params.set('password', linkPassword);

  // expireDate:
  // - undefined => ไม่แก้
  // - "" หรือ null => ลบวันหมดอายุ
  // - "YYYY-MM-DD" => ตั้งวันหมดอายุ
  if (expiration !== undefined) {
    if (expiration) {
      params.set('expireDate', new Date(expiration).toISOString().split('T')[0]);
    } else {
      params.set('expireDate', '');
    }
  }

  if (permissions !== undefined) params.set('permissions', String(permissions));
  if (publicUpload !== undefined) params.set('publicUpload', publicUpload ? 'true' : 'false');

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
          console.warn('Failed to update existing share:', e?.response?.data || e?.message);
        }
      }
    }

    // 4) Create new link if none exists or forceNew
    if (!existed) {
      const form = new URLSearchParams();
      form.set('path', cleanPath);
      form.set('shareType', '3');
      form.set('permissions', String(permissions));
      if (linkPassword !== undefined) form.set('password', linkPassword || "");
      if (expiration) form.set('expireDate', new Date(expiration).toISOString().split('T')[0]);
      if (publicUpload !== undefined) {
        form.set('publicUpload', publicUpload ? 'true' : 'false');
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

      if (note !== undefined && shareId) {
        try { await maybeUpdateShare(shareId, { note }); }
        catch (e) { console.warn('Failed to set note on new share:', e?.response?.data || e?.message); }
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

/**Share-only: สร้าง/รีใช้ลิงก์สาธารณะ (ไม่อัปโหลดไฟล์) และ ensure โฟลเดอร์มีอยู่จริง */
app.post('/api/nextcloud/share-only', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ ok:false, message:'Content-Type must be application/json' });
    }

    const {
      folderName,
      sharePath,                 // ถ้ามี จะใช้แทน folderName
      permissions = 1,           // read-only
      publicUpload,
      note,
      linkPassword,
      expiration,                // YYYY-MM-DD
      forceNew
    } = req.body || {};

    if (expiration && isNaN(Date.parse(expiration))) {
      return res.status(400).json({ ok:false, message:'Invalid expiration date format' });
    }

    // สร้าง path สำหรับแชร์
    let cleanPath = null;
    if (typeof sharePath === 'string' && sharePath.trim()) {
      cleanPath = sharePath.trim().startsWith('/') ? sharePath.trim() : '/' + sharePath.trim();
    } else if (typeof folderName === 'string' && folderName.trim()) {
      cleanPath = '/' + folderName.trim().replace(/^\/+/, '');
    }
    if (!cleanPath) {
      return res.status(400).json({ ok:false, message:'Missing folderName or sharePath' });
    }

    //Ensure โฟลเดอร์มีอยู่ใน WebDAV (เช่น /files/<username>/<cleanPath>)
    const davRel = cleanPath.replace(/^\/+/, '');
    const davFolderPath = `files/${username}/${davRel}`;
    try {
      await webdavClient.createDirectory(davFolderPath);
    } catch (err) {
      // 405 = already exists
      if (err?.response?.status !== 405) throw err;
    }

    // ===== Reuse link ถ้าไม่ forceNew =====
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
          console.warn('share-only: update existing share failed:', e?.response?.data || e?.message);
        }
      }
    }

    // ===== Create ใหม่ถ้าไม่มีของเดิม หรือ forceNew =====
    if (!existed) {
      const form = new URLSearchParams();
      form.set('path', cleanPath);
      form.set('shareType', '3'); // public link
      form.set('permissions', String(permissions));
      if (typeof linkPassword !== 'undefined') form.set('password', linkPassword || '');
      if (expiration) {
        const iso = new Date(expiration).toISOString().split('T')[0];
        form.set('expireDate', iso);
      }
      if (typeof publicUpload !== 'undefined') form.set('publicUpload', publicUpload ? 'true' : 'false');

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
      if (!meta || ![100,200].includes(meta.statuscode)) {
        return res.status(500).json({ ok:false, message: meta?.message || 'OCS create error', raw: createResp.data });
      }

      shareId = data?.id;
      shareLink = data?.url;

      if (typeof note !== 'undefined' && shareId) {
        try { await maybeUpdateShare(shareId, { note }); } catch (e) {
          console.warn('share-only: set note failed:', e?.response?.data || e?.message);
        }
      }
    }

    return res.json({
      ok: true,
      message: existed ? 'Reused existing public link' : 'Created new public link',
      share: {
        id: shareId,
        url: shareLink,
        path: cleanPath,
        existed,
        protected: Boolean(linkPassword),
        expiration: expiration || null,
        permissions,
        publicUpload: Boolean(publicUpload),
      }
    });

  } catch (error) {
    console.error('Share-only error:', { message: error.message, status: error.response?.status, data: error.response?.data });
    return res.status(error?.response?.status || 500).json({ ok:false, message:'SHARE_ONLY_FAILED', raw: error?.response?.data });
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

    // ดึงพารามิเตอร์ขนาดภาพ
    const width = parseInt(req.query.width) || 300; // ค่า default 300px
    const height = parseInt(req.query.height) || 300;
    const quality = parseInt(req.query.quality) || 80; // คุณภาพ WebP
    const isLQIP = req.query.lqip === "true"; // สำหรับสร้าง LQIP

    const tryWebdav = async () => {
      try {
        const data = await webdavClient.getFileContents(rel, { format: "binary" });
        return Buffer.isBuffer(data) ? data : Buffer.from(data);
      } catch {
        const enc = rel.split("/").map(encodeURIComponent).join("/");
        const data2 = await webdavClient.getFileContents(enc, { format: "binary" });
        return Buffer.isBuffer(data2) ? data2 : Buffer.from(data2);
      }
    };

    let buf = null;
    try {
      buf = await tryWebdav();
    } catch (errWebdav) {
      if (!previewBase) throw errWebdav;
      const enc = rel.split("/").map(encodeURIComponent).join("/");
      const url = `${previewBase}/${enc}`;
      const r = await axios.get(url, {
        responseType: "arraybuffer",
        auth: { username, password: ncPassword },
        httpsAgent,
      });
      buf = Buffer.from(r.data);
    }

    // ประมวลผลภาพด้วย sharp
    let image = sharp(buf);
    if (isLQIP) {
      // สร้าง LQIP (ภาพขนาดเล็กมากสำหรับ placeholder)
      image = image.resize(20, 20, { fit: "cover" }).webp({ quality: 20 });
    } else {
      // ปรับขนาดภาพตาม width และ height
      image = image.resize(width, height, { fit: "cover" }).webp({ quality });
    }

    // ดึง buffer ของภาพที่ประมวลผลแล้ว
    const outputBuffer = await image.toBuffer();

    // ตั้งค่า Content-Type และ Cache-Control
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // แคช 1 ปี
    res.end(outputBuffer);
  } catch (e) {
    const status = e?.response?.status || 404;
    console.error("preview failed:", { status, msg: e?.message, path: req?.query?.path });
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

app.post("/api/nextcloud/upload-bytes", uploadImagesOnly.single('file'), async (req, res) => {
  try {
    const folderName = (req.body?.folderName || '').trim();
    const targetName = (req.body?.targetName || '').trim();
    const f = req.file;

    if (!folderName) return res.status(400).json({ ok:false, message:'folderName required' });
    if (!f)          return res.status(400).json({ ok:false, message:'file required (image only)' });

    // สร้างโฟลเดอร์ถ้ายังไม่มี
    const folderPath = `files/${username}/${folderName}`;
    try { await webdavClient.createDirectory(folderPath); }
    catch (err) { if (err?.response?.status !== 405) throw err; }

    const name = targetName || f.originalname || `upload-${Date.now()}`;
    const davRemotePath = `${folderPath}/${name}`;

    await webdavClient.putFileContents(davRemotePath, f.buffer, {
      overwrite: true,
      contentType: ALLOWED_IMAGE_MIMES.has(f.mimetype) ? f.mimetype : (mime.lookup(name) || 'application/octet-stream')
    });

    return res.json({
      ok: true,
      message: 'Uploaded',
      uploaded: { folder: `/${folderName}`, file: name, remotePath: `/${folderName}/${name}` }
    });
  } catch (e) {
    const status = e?.status || (e?.message === 'ONLY_IMAGE_ALLOWED' ? 415 : 500);
    const msg = e?.message === 'ONLY_IMAGE_ALLOWED' ? 'ONLY_IMAGE_ALLOWED' : 'UPLOAD_BYTES_FAILED';
    console.error('upload-bytes error:', e?.response?.data || e);
    return res.status(status).json({ ok:false, message: msg, error: e?.message || String(e) });
  }
});

/**NEW: เปลี่ยน/ลบรหัสผ่านของ public share ของโฟลเดอร์ (ใช้ folderName = เบอร์ผู้ใช้) */
app.post('/api/nextcloud/change-share-password', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ ok: false, message: 'Content-Type must be application/json' });
    }

    const { folderName, newPassword, expiration, note, publicUpload, permissions } = req.body || {};
    if (!folderName) return res.status(400).json({ ok: false, message: 'folderName is required' });

    const cleanPath = `/${String(folderName).replace(/^\/+/, '')}`;
    const share = await getExistingPublicShare(cleanPath);
    if (!share) return res.status(404).json({ ok: false, message: 'PUBLIC_SHARE_NOT_FOUND' });

    await maybeUpdateShare(share.id, {
      linkPassword: newPassword !== undefined ? String(newPassword) : undefined,
      expiration,
      note,
      publicUpload,
      permissions,
    });

    // อ่านใหม่หลังอัปเดต
    const updated = await getExistingPublicShare(cleanPath);

    res.json({
      ok: true,
      message:
        newPassword === '' || newPassword === null
          ? 'PASSWORD_CLEARED'
          : (newPassword === undefined ? 'UPDATED' : 'PASSWORD_UPDATED'),
      share: {
        id: updated?.id ?? share.id,
        url: updated?.url ?? share.url,
        path: updated?.path ?? cleanPath,
      },
    });
  } catch (e) {
    console.error('change-share-password error:', e?.response?.data || e?.message);
    res.status(e?.response?.status || 500).json({ ok: false, message: 'CHANGE_PASSWORD_FAILED' });
  }
});

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.head('/api/health', (_req, res) => res.status(200).end());

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
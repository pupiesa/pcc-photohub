// server.js (ESM)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from 'webdav';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import QRCode from 'qrcode';
import { createCanvas } from 'canvas';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==== Nextcloud config ====
const nextcloudUrl = process.env.NEXTCLOUD_URI;          
const username      = process.env.NEXTCLOUD_Username;     
const ncPassword    = process.env.NEXTCLOUD_Password;    
const webdavUrl     = process.env.NEXTCLOUD_webdavUrl;    
const ocsApiUrl     = process.env.NEXTCLOUD_ocsApiUrl; 

if (!username || !ncPassword || !webdavUrl || !ocsApiUrl) {
  console.warn('⚠️ Missing some NEXTCLOUD_* envs. Check .env file.');
}

// WebDAV client
const webdavClient = createClient(webdavUrl, {
  username,
  password: ncPassword,
  // ถ้าต้องข้าม cert self-signed:
  httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false })
});

// (optional) log body ที่เข้า มา—ช่วย debug เวลา body ว่าง
app.use((req, _res, next) => {
  // console.log(`[${req.method}] ${req.originalUrl}`, req.body);
  next();
});

// ==== Upload + Share + QR(with header text) ====
app.post('/api/nextcloud/upload-and-share', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Content-Type must be application/json' });
    }

    const {
      folderName,
      filePath,
      permissions = 1,    // 1 = read
      publicUpload,       // true/false for folder public upload
      note,
      linkPassword,       // protect public link with password
      expiration          // YYYY-MM-DD
    } = req.body || {};

    if (!folderName || !filePath) {
      return res.status(400).json({ error: 'Missing folderName or filePath' });
    }
    if (expiration && isNaN(Date.parse(expiration))) {
      return res.status(400).json({ error: 'Invalid expiration date format' });
    }

    // 1) Upload file via WebDAV
    await fs.access(filePath).catch(() => { throw new Error(`File not found: ${filePath}`); });

    const folderPath = `files/${username}/${folderName}`;
    try {
      await webdavClient.createDirectory(folderPath);
    } catch (err) {
      if (err.response?.status !== 405) throw err; // 405 = already exists
    }

    const baseName = path.basename(filePath);
    const remotePath = `${folderPath}/${baseName}`;
    const buf = await fs.readFile(filePath);
    await webdavClient.putFileContents(remotePath, buf);

    // 2) Create share via OCS
    const cleanPath = `/${folderName}`; // share folder root (adjust if you want file-only link)
    const form = new URLSearchParams();
    form.set('path', cleanPath);
    form.set('shareType', '3'); // 3 = public link
    form.set('permissions', String(permissions));
    if (linkPassword) form.set('password', linkPassword);
    if (expiration)   form.set('expireDate', new Date(expiration).toISOString().split('T')[0]);
    if (typeof publicUpload !== 'undefined') {
      form.set('publicUpload', (publicUpload === true || String(publicUpload) === 'true') ? 'true' : 'false');
    }

    const createResp = await axios.post(
      `${ocsApiUrl}/shares?format=json`,
      form.toString(),
      {
        auth: { username, password: ncPassword },
        headers: {
          'OCS-APIRequest': 'true',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false })
      }
    );

    const meta = createResp.data?.ocs?.meta;
    const data = createResp.data?.ocs?.data;
    if (!meta || ![100, 200].includes(meta.statuscode)) {
      return res.status(500).json({ error: meta?.message || 'OCS create error', raw: createResp.data });
    }

    const shareId   = data?.id;
    const shareLink = data?.url;

    // 3) Update note (optional)
    if (note && shareId) {
      const nf = new URLSearchParams(); nf.set('note', note);
      try {
        await axios.put(
          `${ocsApiUrl}/shares/${shareId}?format=json`,
          nf.toString(),
          {
            auth: { username, password: ncPassword },
            headers: {
              'OCS-APIRequest': 'true',
              'Accept': 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false })
          }
        );
      } catch (e) {
        console.warn('Failed to set note:', e.response?.data || e.message);
      }
    }

    // 4) QR with header text
    const qrSize = 300;
    const titleH = 52;
    const canvas = createCanvas(qrSize, qrSize + titleH);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const qrCanvas = createCanvas(qrSize, qrSize);
    await QRCode.toCanvas(qrCanvas, shareLink, {
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#2b6cb0', light: '#f0f4f8' }
    });
    ctx.drawImage(qrCanvas, 0, titleH);

    ctx.fillStyle = '#2b6cb0';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ProjectPhoto_PCC', qrSize / 2, Math.floor(titleH / 2));

    const qrBuffer = canvas.toBuffer('image/png');
    const qrDataUrl = `data:image/png;base64,${qrBuffer.toString('base64')}`;

    return res.json({
      message: 'Uploaded, shared, and QR generated successfully',
      uploaded: { folder: `/${folderName}`, file: baseName, remotePath: cleanPath },
      share: {
        id: shareId,
        url: shareLink,
        protected: Boolean(linkPassword),
        expiration: expiration || null
      },
      qr: { dataUrl: qrDataUrl, title: 'ProjectPhoto_PCC' }
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
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const { folderName, filePath } = body;
    if (!folderName || !filePath) {
      return res.status(400).json({ error: 'Missing folderName or filePath' });
    }

    await fs.access(filePath).catch(() => { throw new Error(`File not found: ${filePath}`); });

    const folderPath = `files/${username}/${folderName}`;
    try { await webdavClient.createDirectory(folderPath); }
    catch (err) { if (err.response?.status !== 405) throw err; }

    const baseName = path.basename(filePath);
    const remotePath = `${folderPath}/${baseName}`;
    await webdavClient.putFileContents(remotePath, await fs.readFile(filePath));

    res.json({ message: 'Uploaded', folderPath: `/${folderName}`, fileName: baseName });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// server.js
const express = require('express');
const { createClient } = require('webdav');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
const { createCanvas } = require('canvas');

const app = express();
const port = 3000;

app.use(express.json());

// ==== Nextcloud config ====
const nextcloudUrl = 'http://s2pid.3bbddns.com:59080';
const username = 'ProjectPhoto';
const ncPassword = 'ZbStr-WCq4C-d8cBf-2xDfp-RDLHE';
const webdavUrl = `${nextcloudUrl}/remote.php/dav`;
const ocsApiUrl = `${nextcloudUrl}/ocs/v2.php/apps/files_sharing/api/v1`;

// WebDAV client
const webdavClient = createClient(webdavUrl, {
  username,
  password: ncPassword,
  rejectUnauthorized: false
});

// ==== Upload + Share + QR(with header text) ====
app.post('/api/nextcloud/upload-and-share', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Content-Type must be application/json' });
    }

    // รับพารามิเตอร์
    const {
      folderName,
      filePath,
      permissions = 1,         // READ only
      publicUpload,            // true/false (เฉพาะแชร์โฟลเดอร์)
      note,                    // ข้อความโน้ต
      linkPassword,            // << ตั้งรหัสลิงก์ตรงนี้
      expiration               // YYYY-MM-DD
    } = req.body || {};

    if (!folderName || !filePath) {
      return res.status(400).json({ error: 'Missing folderName or filePath' });
    }
    if (expiration && isNaN(Date.parse(expiration))) {
      return res.status(400).json({ error: 'Invalid expiration date format' });
    }

    // 1) อัปโหลดไฟล์ขึ้น Nextcloud
    await fs.access(filePath).catch(() => { throw new Error(`File not found: ${filePath}`); });

    const folderPath = `files/${username}/${folderName}`;
    try { await webdavClient.createDirectory(folderPath); }
    catch (err) { if (err.response?.status !== 405) throw err; }

    const baseName = path.basename(filePath);
    const remotePath = `${folderPath}/${baseName}`;
    await webdavClient.putFileContents(remotePath, await fs.readFile(filePath));

    // 2) สร้างลิงก์แชร์ผ่าน OCS
    const cleanPath = `/${folderName}`;
    const form = new URLSearchParams();
    form.set('path', cleanPath);
    form.set('shareType', '3'); // public link
    form.set('permissions', String(permissions));
    if (linkPassword) form.set('password', linkPassword);              // << ตั้งรหัส
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
        }
      }
    );

    const meta = createResp.data?.ocs?.meta;
    const data = createResp.data?.ocs?.data;
    if (!meta || ![100, 200].includes(meta.statuscode)) {
      return res.status(500).json({ error: meta?.message || 'OCS create error', raw: createResp.data });
    }

    const shareId   = data?.id;
    const shareLink = data?.url;

    // 3) อัปเดต note (ถ้ามี)
    if (note && shareId) {
      const nf = new URLSearchParams(); nf.set('note', note);
      try {
        await axios.put(`${ocsApiUrl}/shares/${shareId}?format=json`, nf.toString(), {
          auth: { username, password: ncPassword },
          headers: {
            'OCS-APIRequest': 'true',
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } catch (e) { console.warn('Failed to set note:', e.response?.data || e.message); }
    }

    // 4) สร้าง QR (PNG base64)
    const qrSize = 300;
    const titleH = 52; // ความสูงส่วนหัวตัวอักษร
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

    // ตอบกลับ
    return res.json({
      message: 'Uploaded, shared, and QR generated successfully',
      uploaded: { folder: `/${folderName}`, file: baseName, remotePath: cleanPath },
      share: {
        id: shareId,
        url: shareLink,
        // ถ้าตั้งรหัสไว้ จะใช้ร่วมกับหน้าแชร์ของ Nextcloud
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

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));


// (Optional) อัปโหลดอย่างเดียว
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
    const buf = await fs.readFile(filePath);
    await webdavClient.putFileContents(remotePath, buf);

    res.json({ message: 'Uploaded', folderPath: `/${folderName}`, fileName: baseName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

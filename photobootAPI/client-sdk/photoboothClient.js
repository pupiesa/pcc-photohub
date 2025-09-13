// client-sdk/photoboothClient.js (fixed, keep all parts + remove duplicate email-only OTP)
export class PhotoboothClient {
  /**
   * @param {object} cfg
   * @param {string} cfg.mongoBase - origin ของ mongo-api 
   * @param {string} cfg.ncBase    - origin ของ nextcloud-api
   * @param {string} [cfg.smtpBase] - origin ของ email-otp-api (เช่น http://localhost:3301)
   *
   * @param {object} args
   * @param {string} args.number
   * @param {string} [args.filePath]        // ใช้ไฟล์เดียว (compat เดิม)
   * @param {string[]} [args.filePaths]     // หลายไฟล์
   * @param {string} args.folderName
   * @param {string} [args.linkPassword]
   * @param {string} [args.note]
   * @param {string} [args.expiration]      // YYYY-MM-DD
   */
  constructor({ mongoBase, ncBase, smtpBase } = {}) {
    this.mongo = String(mongoBase || '').replace(/\/$/, '');
    this.nc    = String(ncBase    || '').replace(/\/$/, '');
    this.smtp  = smtpBase ? String(smtpBase).replace(/\/$/, '') : null;
  }

  // ---------- USER ----------
  getUserByNumber(number) {
    return this._get(`${this.mongo}/api/user/by-number/${encodeURIComponent(number)}`);
  }

  createUser({ number, pin, file_address = [], nextcloud_link = null, gmail } = {}) {
    const body = { number, pin, file_address, nextcloud_link };
    if (typeof gmail === 'string') body.gmail = gmail;
    return this._post(`${this.mongo}/api/user`, body);
  }

  checkPin({ number, pin }) {
    return this._post(`${this.mongo}/api/user/check-pin`, { number, pin });
  }

  setNextcloudLink(number, nextcloud_link) {
    return this._patch(`${this.mongo}/api/user/${encodeURIComponent(number)}/nextcloud-link`, { nextcloud_link });
  }

  appendFileAddress(number, file_address) {
    return this._post(`${this.mongo}/api/user/${encodeURIComponent(number)}/file-address`, { file_address });
  }

  changePin(number, pin) {
    return this._patch(`${this.mongo}/api/user/${encodeURIComponent(number)}/pin`, { pin });
  }

  setGmail(number, gmail /* string|null */) {
    return this._put(`${this.mongo}/api/user/${encodeURIComponent(number)}/gmail`, { gmail });
  }

  setConsentedTrue(number) {
    return this._put(`${this.mongo}/api/user/${encodeURIComponent(number)}/consented/true`);
  }

  // ---------- PROMO ----------
  listPromos({ active } = {}) {
    const q = active === true ? '?active=true' : '';
    return this._get(`${this.mongo}/api/promos${q}`);
  }
  createPromo(promoBody) {
    return this._post(`${this.mongo}/api/promos`, promoBody);
  }
  getPromo(code) {
    return this._get(`${this.mongo}/api/promos/${encodeURIComponent(code)}`);
  }
  updatePromo(code, body) {
    return this._patch(`${this.mongo}/api/promos/${encodeURIComponent(code)}`, body);
  }
  deactivatePromo(code) {
    return this._post(`${this.mongo}/api/promos/${encodeURIComponent(code)}/deactivate`);
  }
  validatePromo(code, { userNumber, orderAmount }) {
    return this._post(`${this.mongo}/api/promos/${encodeURIComponent(code)}/validate`, { userNumber, orderAmount });
  }
  redeemPromo(code, { userNumber, orderAmount }) {
    return this._post(`${this.mongo}/api/promos/${encodeURIComponent(code)}/redeem`, { userNumber, orderAmount });
  }

  // ---------- NEXTCLOUD ----------
  uploadAndShare({ folderName, filePath, permissions = 1, publicUpload, note, linkPassword, expiration, forceNew }) {
    return this._post(`${this.nc}/api/nextcloud/upload-and-share`, { folderName, filePath, permissions, publicUpload, note, linkPassword, expiration, forceNew });
  }
  uploadOnly({ folderName, filePath }) {
    return this._post(`${this.nc}/api/nextcloud/upload`, { folderName, filePath });
  }

  // --------- GALLERY ----------
  getUserGallery(number) {
    return this._get(`${this.mongo}/api/user/${encodeURIComponent(number)}/gallery`);
  }

  // --------- SHARE PASSWORD ----------
  /**
   * เปลี่ยน/ลบรหัสผ่านของ public share link (ลิงก์แชร์) ของโฟลเดอร์บน Nextcloud
   * - newPassword = "" (สตริงว่าง) -> ลบรหัส
   * - expiration: "YYYY-MM-DD" | "" (ลบวันหมดอายุ) | undefined (ไม่แตะต้อง)
   */
  changeSharePassword({ folderName, newPassword, expiration, note, publicUpload, permissions }) {
    return this._post(`${this.nc}/api/nextcloud/change-share-password`, {
      folderName, newPassword, expiration, note, publicUpload, permissions,
    });
  }

  // สะดวกสำหรับกรณีชื่อโฟลเดอร์ = เบอร์ผู้ใช้
  changeSharePasswordForUser({ number, newPassword, expiration, note, publicUpload, permissions }) {
    return this.changeSharePassword({ folderName: number, newPassword, expiration, note, publicUpload, permissions });
  }

  // ---------- EMAIL OTP (CORRECT ONLY) ----------
  /**
   * ขอ OTP เพื่อยืนยันอีเมลของผู้ใช้ (จะส่งอีเมลจริง)
   * @param {{number:string, email:string}} params
   * @returns {Promise<{ok:boolean, otpPlain?:string}>}
   */
  requestEmailOTP({ number, email }) {
    this._requireSMTP('requestEmailOTP');
    return this._post(`${this.smtp}/email/verify/request`, { number, email });
  }

  /**
   * ยืนยัน OTP ที่ได้รับทางอีเมล — server จะอัปเดต user.gmail / emailVerified ให้เอง
   * @param {{number:string, email:string, otp:string}} params
   */
  confirmEmailOTP({ number, email, otp }) {
    this._requireSMTP('confirmEmailOTP');
    return this._post(`${this.smtp}/email/verify/confirm`, { number, email, otp });
  }

  /**
   * Orchestration: ขอ OTP แล้วบอก UI ว่าต้องกรอกโค้ด
   */
  async startEmailVerification({ number, email }) {
    const r = await this.requestEmailOTP({ number, email });
    return { ok: true, hint: 'Check your email for the 6-digit code.', ...r };
  }

  /**
   * Orchestration: confirm OTP แล้ว refresh โปรไฟล์ผู้ใช้
   */
  async confirmEmailAndReloadUser({ number, email, otp }) {
    await this.confirmEmailOTP({ number, email, otp });
    const u = await this.getUserByNumber(number);
    return { ok: true, user: u.data };
  }

  // ---------- ORCHESTRATIONS ----------
  /**
   * 1) รับเบอร์/พินจาก UI -> หา user; ไม่มีให้สร้าง -> เช็คพิน
   */
  async ensureUserAndPin({ number, pin, gmail } = {}) {
    let user = null;
    try {
      const r = await this.getUserByNumber(number);
      user = r.data;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (!user) {
      await this.createUser({ number, pin, gmail });
      user = (await this.getUserByNumber(number)).data;
    }
    const { match } = await this.checkPin({ number, pin });
    if (!match) throw this._err(401, 'PIN_NOT_MATCH');
    return user; // {number, file_address, nextcloud_link, ...}
  }

  /**
   * 2) อัปโหลดรูปครั้งแรกหรือครั้งถัดไป (รองรับหลายไฟล์)
   */
  async uploadImageForUser({ number, filePath, filePaths, folderName, linkPassword, note, expiration }) {
    // --- normalize input ---
    let files = [];
    if (Array.isArray(filePaths)) {
      files = filePaths;
    } else if (typeof filePath === 'string' && filePath.trim()) {
      const s = filePath.trim();
      files = s.includes(',') || /\r?\n/.test(s)
        ? s.split(/[,|\r?\n]+/).map(t => t.trim()).filter(Boolean)
        : [s];
    }
    if (files.length === 0) throw this._err(400, 'filePath or filePaths is required');

    // --- get user ---
    const found = await this.getUserByNumber(number);
    const user  = found.data;

    const toCloudPath = (resp) => {
      const up     = resp?.uploaded || resp || {};
      const remote = up.remotePath || up.remote || '';
      const folder = up.folder || up.folderPath || '';
      const file   = up.file || up.fileName || '';
      if (remote) {
        if (file && !remote.endsWith(file)) return `${remote.replace(/\/$/, '')}/${file}`;
        return remote;
      }
      if (folder && file) return `${String(folder).replace(/\/$/, '')}/${file}`;
      return file || folder || null;
    };

    const uploadedCloudPaths = [];

    if (!user.nextcloud_link) {
      const first = files[0];
      const up1 = await this.uploadAndShare({ folderName, filePath: first, linkPassword, note, expiration });
      if (up1?.share?.url) await this.setNextcloudLink(number, up1.share.url);
      uploadedCloudPaths.push(toCloudPath(up1) || first);

      for (const fp of files.slice(1)) {
        const up = await this.uploadOnly({ folderName, filePath: fp });
        uploadedCloudPaths.push(toCloudPath(up) || fp);
      }
    } else {
      for (const fp of files) {
        const up = await this.uploadOnly({ folderName, filePath: fp });
        uploadedCloudPaths.push(toCloudPath(up) || fp);
      }
    }

    await this.appendFileAddress(number, uploadedCloudPaths);

    const latest = await this.getUserByNumber(number);
    return {
      nextcloud_link: latest.data.nextcloud_link,
      file_count: latest.file_summary?.count ?? (latest.data.file_address?.length ?? 0),
      last_files: uploadedCloudPaths
    };
  }

  /**
   * 3) Orchestration: เปลี่ยน PIN แล้ว sync รหัสลิงก์ Cloud ให้เป็นค่าเดียวกัน
   */
  async changePinAndSyncCloud({ number, newPin, expiration, note, publicUpload, permissions, throwOnCloudFail = false }) {
    await this.changePin(number, newPin);
    try {
      const cloudRes = await this.changeSharePasswordForUser({
        number,
        newPassword: newPin,
        expiration,
        note,
        publicUpload,
        permissions,
      });
      return { ok: true, cloud: cloudRes };
    } catch (e) {
      if (throwOnCloudFail) {
        const err = new Error(`PIN updated, but cloud password update failed: ${e?.message || 'CLOUD_SYNC_FAILED'}`);
        err.status = e?.status || e?.payload?.status || 500;
        err.cause = e;
        throw err;
      }
      return {
        ok: true,
        cloud: null,
        warning: {
          message: 'PIN updated, but failed to update cloud link password.',
          error: e?.message || String(e),
        },
      };
    }
  }

  // ---------- fetch helpers ----------
  _requireSMTP(fnName) {
    if (!this.smtp) {
      const e = new Error(`smtpBase is not configured. Set it in new PhotoboothClient({ smtpBase: "http://localhost:3301", ... }) before calling ${fnName}().`);
      e.status = 500;
      throw e;
    }
  }

  async _get(url) {
    const r = await fetch(url);
    return this._handle(r);
  }
  async _post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : null });
    return this._handle(r);
  }
  async _patch(url, body) {
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return this._handle(r);
  }
  async _put(url, body) {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : null });
    return this._handle(r);
  }

  async _handle(r) {
    const ct = r.headers.get('content-type') || '';
    let data = {};
    let text = '';
    if (ct.includes('application/json')) {
      data = await r.json().catch(() => ({}));
    } else {
      text = await r.text().catch(() => '');
      try { data = JSON.parse(text || '{}'); } catch { data = {}; }
    }
    if (!r.ok || data.ok === false) {
      const status = r.status || data.status || 500;
      const message = data.message || data.error || (text && text.slice(0, 200)) || r.statusText || 'REQUEST_FAILED';
      const err = new Error(message); err.status = status; err.payload = data; throw err;
    }
    return data;
  }

  _err(status, message) { const e = new Error(message); e.status = status; return e; }
}

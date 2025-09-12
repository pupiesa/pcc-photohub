// client-sdk/photoboothClient.js
export class PhotoboothClient {
  /**
   * @param {object} cfg
   * @param {string} cfg.mongoBase - origin ของ mongo-api 
   * @param {string} cfg.ncBase    - origin ของ nextcloud-api
   * @param {object} args
   * @param {string} args.number
   * @param {string} [args.filePath]        // ใช้ไฟล์เดียว (compat เดิม)
   * @param {string[]} [args.filePaths]     // หลายไฟล์
   * @param {string} args.folderName
   * @param {string} [args.linkPassword]
   * @param {string} [args.note]
   * @param {string} [args.expiration]      // YYYY-MM-DD
   */
  constructor({ mongoBase, ncBase }) {
    this.mongo = mongoBase.replace(/\/$/, '');
    this.nc = ncBase.replace(/\/$/, '');
  }

  // ---------- USER ----------
  getUserByNumber(number) {
    return this._get(`${this.mongo}/api/user/by-number/${encodeURIComponent(number)}`);
  }
  createUser({ number, pin, file_address = [], nextcloud_link = null }) {
    return this._post(`${this.mongo}/api/user`, { number, pin, file_address, nextcloud_link });
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

  // --------- SHARE PASSWORD (NEW) ----------
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

  // ---------- ORCHESTRATIONS ----------
  /**
   * 1) รับเบอร์/พินจาก UI -> หา user; ไม่มีให้สร้าง -> เช็คพิน
   */
  async ensureUserAndPin({ number, pin }) {
    let user = null;
    try {
      const r = await this.getUserByNumber(number);
      user = r.data;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (!user) {
      await this.createUser({ number, pin });
      user = (await this.getUserByNumber(number)).data;
    }
    const { match } = await this.checkPin({ number, pin });
    if (!match) throw this._err(401, 'PIN_NOT_MATCH');
    return user; // {number, file_address, nextcloud_link, ...}
  }

  /**
   * 2) อัปโหลดรูปครั้งแรกหรือครั้งถัดไป (รองรับหลายไฟล์)
   *    - ถ้า user ยังไม่มี nextcloud_link -> upload-and-share (ไฟล์แรก) แล้ว patch link จากนั้นที่เหลือ upload only
   *    - ถ้ามี link แล้ว -> upload only ทุกไฟล์
   *    - ทุกครั้ง append file_address ลง DB (แบบอาเรย์ครั้งเดียว)
   */
  async uploadImageForUser({ number, filePath, filePaths, folderName, linkPassword, note, expiration }) {
    // --- normalize input: รองรับ filePaths[] หรือ filePath ที่คั่น comma/newline ---
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

    // ช่วยสกัด "พาธบนคลาวด์" จากรีสปอนส์ nextcloud-api
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
      // ไฟล์แรก: แชร์ลิงก์
      const first = files[0];
      const up1 = await this.uploadAndShare({ folderName, filePath: first, linkPassword, note, expiration });
      if (up1?.share?.url) await this.setNextcloudLink(number, up1.share.url);
      uploadedCloudPaths.push(toCloudPath(up1) || first);

      // ไฟล์ถัดไป: upload only
      for (const fp of files.slice(1)) {
        const up = await this.uploadOnly({ folderName, filePath: fp });
        uploadedCloudPaths.push(toCloudPath(up) || fp);
      }
    } else {
      // มีลิงก์อยู่แล้ว: upload only ทุกไฟล์
      for (const fp of files) {
        const up = await this.uploadOnly({ folderName, filePath: fp });
        uploadedCloudPaths.push(toCloudPath(up) || fp);
      }
    }

    // บันทึกลง DB ทีเดียวแบบ array
    await this.appendFileAddress(number, uploadedCloudPaths);

    // ส่งสรุปกลับให้ UI
    const latest = await this.getUserByNumber(number);
    return {
      nextcloud_link: latest.data.nextcloud_link,
      file_count: latest.file_summary?.count ?? (latest.data.file_address?.length ?? 0),
      last_files: uploadedCloudPaths
    };
  }

  /**
   * 3) Orchestration: เปลี่ยน PIN แล้ว sync รหัสลิงก์ Cloud ให้เป็นค่าเดียวกัน
   *    - ตั้งค่า throwOnCloudFail=true ถ้าต้องการให้ล้มทันทีเมื่ออัปเดต Cloud ไม่สำเร็จ
   *    - ค่า default จะสำเร็จแบบมี warning (ไม่ throw)
   * @returns {Promise<{ok:true, cloud:any|null, warning?:{message:string,error:string}}>}
   */
  async changePinAndSyncCloud({ number, newPin, expiration, note, publicUpload, permissions, throwOnCloudFail = false }) {
    // 1) เปลี่ยน PIN ใน DB
    await this.changePin(number, newPin);

    // 2) เปลี่ยนรหัสลิงก์แชร์ Nextcloud ให้ตรงกับ PIN ใหม่
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
  async _handle(r) {
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) {
      const status = r.status || data.status || 500;
      const message = data.message || data.error || 'REQUEST_FAILED';
      const err = new Error(message); err.status = status; err.payload = data; throw err;
    }
    return data;
  }
  _err(status, message) { const e = new Error(message); e.status = status; return e; }
}

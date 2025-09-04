// client-sdk/photoboothClient.js
export class PhotoboothClient {
  /**
   * @param {object} cfg
   * @param {string} cfg.mongoBase - origin ของ mongo-api เช่น 'http://localhost:2000'
   * @param {string} cfg.ncBase    - origin ของ nextcloud-api เช่น 'http://localhost:3000'
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

  // ---------- PROMO (มีอยู่ใน API แล้ว) ----------
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

  // ---------- ORCHESTRATIONS (Flow ที่ UI ขอ) ----------
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
   * 2) อัปโหลดรูปครั้งแรกหรือครั้งถัดไป:
   *    - ถ้า user ยังไม่มี nextcloud_link -> upload-and-share แล้ว patch link
   *    - ถ้ามี link แล้ว -> upload only
   *    - ทุกครั้ง append file_address ลง DB
   */
  async uploadImageForUser({ number, filePath, folderName, linkPassword, note, expiration }) {
    const found = await this.getUserByNumber(number);
    const user = found.data;

    if (!user.nextcloud_link) {
      const up = await this.uploadAndShare({ folderName, filePath, linkPassword, note, expiration });
      await this.setNextcloudLink(number, up.share.url);
    } else {
      await this.uploadOnly({ folderName, filePath });
    }

    await this.appendFileAddress(number, filePath);
    // ส่งสรุปกลับให้ UI
    const latest = await this.getUserByNumber(number);
    return {
      nextcloud_link: latest.data.nextcloud_link,
      file_count: latest.file_summary?.count ?? (latest.data.file_address?.length ?? 0),
      last_file: filePath
    };
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

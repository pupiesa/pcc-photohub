// photoboothClient.js
export class PhotoboothClient {
  constructor({ mongoBase, ncBase, smtpBase } = {}) {
    this.mongo = String(mongoBase || '').replace(/\/$/, '');
    this.nc    = String(ncBase    || '').replace(/\/$/, '');
    this.smtp  = smtpBase ? String(smtpBase).replace(/\/$/, '') : null;
  }

  // ---------- USER ----------
  getUserByNumber(number) {
    return this._get(`${this.mongo}/api/user/by-number/${encodeURIComponent(number)}`)
      .then(res => {
        if (res?.data) res.data.hasEmail = Boolean(res.data.gmail);
        return res;
      });
  }
  createUser({ number, pin, file_address = [], nextcloud_link = null, gmail } = {}) {
    const body = { number, pin, file_address, nextcloud_link };
    if (typeof gmail === 'string') body.gmail = gmail;
    return this._post(`${this.mongo}/api/user`, body);
  }
  checkPin({ number, pin }) { return this._post(`${this.mongo}/api/user/check-pin`, { number, pin }); }
  setNextcloudLink(number, nextcloud_link) { return this._patch(`${this.mongo}/api/user/${encodeURIComponent(number)}/nextcloud-link`, { nextcloud_link }); }
  appendFileAddress(number, file_address) { return this._post(`${this.mongo}/api/user/${encodeURIComponent(number)}/file-address`, { file_address }); }
  changePin(number, pin) { return this._patch(`${this.mongo}/api/user/${encodeURIComponent(number)}/pin`, { pin }); }
  setGmail(number, gmail /* string|null */) { return this._put(`${this.mongo}/api/user/${encodeURIComponent(number)}/gmail`, { gmail }); }
  setConsentedTrue(number) { return this._put(`${this.mongo}/api/user/${encodeURIComponent(number)}/consented/true`); }

  // ---------- PROMO ----------
  listPromos({ active } = {}) { const q = active === true ? '?active=true' : ''; return this._get(`${this.mongo}/api/promos${q}`); }
  createPromo(promoBody) { return this._post(`${this.mongo}/api/promos`, promoBody); }
  getPromo(code) { return this._get(`${this.mongo}/api/promos/${encodeURIComponent(code)}`); }
  updatePromo(code, body) { return this._patch(`${this.mongo}/api/promos/${encodeURIComponent(code)}`, body); }
  deactivatePromo(code) { return this._post(`${this.mongo}/api/promos/${encodeURIComponent(code)}/deactivate`); }
  validatePromo(code, { userNumber, orderAmount }) { return this._post(`${this.mongo}/api/promos/${encodeURIComponent(code)}/validate`, { userNumber, orderAmount }); }
  redeemPromo(code, { userNumber, orderAmount }) { return this._post(`${this.mongo}/api/promos/${encodeURIComponent(code)}/redeem`, { userNumber, orderAmount }); }

  // ---------- NEXTCLOUD (server-path mode) ----------
  uploadAndShare({ folderName, filePath, permissions = 1, publicUpload, note, linkPassword, expiration, forceNew }) {
    return this._post(`${this.nc}/api/nextcloud/upload-and-share`, { folderName, filePath, permissions, publicUpload, note, linkPassword, expiration, forceNew });
  }
  uploadOnly({ folderName, filePath }) {
    return this._post(`${this.nc}/api/nextcloud/upload`, { folderName, filePath });
  }

  /** Share-only (สร้าง/รีใช้ลิงก์สาธารณะ ไม่อัปโหลดไฟล์) */
  shareOnly({ folderName, sharePath, permissions = 1, publicUpload, note, linkPassword, expiration, forceNew } = {}) {
    return this._post(`${this.nc}/api/nextcloud/share-only`, { folderName, sharePath, permissions, publicUpload, note, linkPassword, expiration, forceNew });
  }
  /** โฟลเดอร์ = เบอร์โทร */
  shareOnlyForUser({ number, linkPassword, expiration, note, publicUpload, permissions = 1, forceNew } = {}) {
    return this.shareOnly({ folderName: number, permissions, publicUpload, note, linkPassword, expiration, forceNew });
  }

  // ---------- NEXTCLOUD (bytes mode สำหรับ UI picker) ----------
  async uploadBytes({ folderName, file, targetName, share = false, note, linkPassword, expiration, forceNew }) {
    // ต้องมี endpoint ใน nextcloud-api: /api/nextcloud/upload-bytes, /api/nextcloud/upload-bytes-share
    const ep = share ? '/api/nextcloud/upload-bytes-share' : '/api/nextcloud/upload-bytes';
    const url = `${this.nc}${ep}`;
    const fd = new FormData();
    fd.append('folderName', folderName);
    fd.append('file', file, targetName || file.name);
    if (targetName) fd.append('targetName', targetName);
    if (share) {
      if (note) fd.append('note', note);
      if (linkPassword) fd.append('linkPassword', linkPassword);
      if (expiration) fd.append('expiration', expiration);
      if (forceNew) fd.append('forceNew', 'true');
    }
    const r = await fetch(url, { method: 'POST', body: fd });
    return this._handle(r);
  }

  // --------- GALLERY ----------
  getUserGallery(number) { return this._get(`${this.mongo}/api/user/${encodeURIComponent(number)}/gallery`); }

  // --------- SHARE PASSWORD ----------
  changeSharePassword({ folderName, newPassword, expiration, note, publicUpload, permissions }) {
    return this._post(`${this.nc}/api/nextcloud/change-share-password`, { folderName, newPassword, expiration, note, publicUpload, permissions });
  }
  changeSharePasswordForUser({ number, newPassword, expiration, note, publicUpload, permissions }) {
    return this.changeSharePassword({ folderName: number, newPassword, expiration, note, publicUpload, permissions });
  }

  // ---------- EMAIL OTP ----------
  requestEmailOTP({ number, email, heading }) { this._requireSMTP('requestEmailOTP'); return this._post(`${this.smtp}/email/verify/request`, { number, email, heading }); }
  confirmEmailOTP({ number, email, otp }) { this._requireSMTP('confirmEmailOTP'); return this._post(`${this.smtp}/email/verify/confirm`, { number, email, otp }); }
  async startEmailVerification({ number, email }) { const r = await this.requestEmailOTP({ number, email }); return { ok: true, hint: 'Check your email for the 6-digit code.', ...r }; }
  async confirmEmailAndReloadUser({ number, email, otp }) {
    await this.confirmEmailOTP({ number, email, otp });
    const u = await this.getUserByNumber(number);
    const user = u.data || {};
    user.hasEmail = Boolean(user.gmail);
    return { ok: true, user };
  }

  // ---------- ORCHESTRATION ----------
  async ensureUserAndPin({ number, pin, gmail } = {}) {
    let user = null;
    try { user = (await this.getUserByNumber(number)).data; }
    catch (e) { if (e.status !== 404) throw e; }
    if (!user) {
      await this.createUser({ number, pin, gmail });
      user = (await this.getUserByNumber(number)).data;
    }
    const { match } = await this.checkPin({ number, pin });
    if (!match) throw this._err(401, 'PIN_NOT_MATCH');
    return user;
  }

  // ---------- helpers ----------
  _requireSMTP(fnName) { if (!this.smtp) { const e = new Error(`smtpBase is not configured. Set it before calling ${fnName}().`); e.status = 500; throw e; } }

  async _get(url) { const r = await fetch(url); return this._handle(r); }
  async _post(url, body) {
    const isFD = (typeof FormData !== 'undefined') && body instanceof FormData;
    const opts = isFD ? { method: 'POST', body } : { method:'POST', headers:{'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : null };
    const r = await fetch(url, opts);
    return this._handle(r);
  }
  async _patch(url, body) { const r = await fetch(url, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); return this._handle(r); }
  async _put(url, body) { const r = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : null }); return this._handle(r); }

  async _handle(r) {
    const ct = r.headers.get('content-type') || '';
    let data = {};
    let text = '';
    if (ct.includes('application/json')) data = await r.json().catch(() => ({}));
    else { text = await r.text().catch(() => ''); try { data = JSON.parse(text || '{}'); } catch { data = {}; } }
    if (!r.ok || data.ok === false) {
      const status = r.status || data.status || 500;
      const message = data.message || data.error || (text && text.slice(0,200)) || r.statusText || 'REQUEST_FAILED';
      const err = new Error(message); err.status = status; err.payload = data; throw err;
    }
    return data;
  }

  _err(status, message) { const e = new Error(message); e.status = status; return e; }
}

/* VBG Verwalter – API-Client mit CSRF-Schutz */
const API = {
  csrf: '',
  getCsrf() {
    const m = document.cookie.match(/(?:^|; )vbg_csrf=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  },
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = this.getCsrf() || this.csrf;
      if (csrf) opts.headers['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* leere Antwort */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Fehler ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b === undefined ? {} : b),
  put: (u, b) => API.req('PUT', u, b === undefined ? {} : b),
  del: (u) => API.req('DELETE', u)
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function roleLabel(role) {
  return { busfahrer: 'Busfahrer', senior: 'Senior Busfahrer', admin: 'Admin' }[role] || role || '';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(dt) {
  if (!dt) return '';
  const d = new Date((dt.length === 16 ? dt + ':00' : dt));
  if (isNaN(d)) return dt;
  return d.toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtTime(dt) {
  if (!dt) return '';
  if (String(dt).length <= 5) return dt;
  const d = new Date(dt.length === 16 ? dt + ':00' : dt);
  if (isNaN(d)) return dt;
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function dtToInput(s) {
  if (!s) return '';
  return String(s).slice(0, 16).replace('T', 'T');
}

function parseCSV(s) {
  return String(s || '').split(',').filter(Boolean).map((x) => parseInt(x, 10));
}

function avatarHtml(user, sizeClass) {
  const name = user.display_name || user.username || '?';
  const ch = esc(name.trim().charAt(0).toUpperCase() || '?');
  if (user.avatar) {
    return `<span class="avatar ${sizeClass || ''}" style="background:transparent"><img src="${esc(user.avatar)}" alt=""/></span>`;
  }
  return `<span class="avatar ${sizeClass || ''}">${ch}</span>`;
}

function fileToDataURL(file, maxSide) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.onload = () => {
      if (!maxSide || !/^image\//i.test(file.type)) { resolve(reader.result); return; }
      const img = new Image();
      img.onerror = () => reject(new Error('Keine gültige Bilddatei.'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale === 1) { resolve(reader.result); return; }
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
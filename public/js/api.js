/* VBG – einfacher API-Client */
const API = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
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

/* Gemeinsame Helfer */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDateISO(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDateTime(dt) {
  if (!dt) return '';
  const d = new Date(dt + 'Z');
  if (isNaN(d)) return dt;
  return d.toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function avatarHtml(user, sizeClass) {
  if (user && user.avatar) {
    return `<img class="avatar ${sizeClass || ''}" src="${esc(user.avatar)}" alt=""/>`;
  }
  const name = (user && user.username) || '?';
  const ch = esc(name.trim().charAt(0).toUpperCase() || '?');
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
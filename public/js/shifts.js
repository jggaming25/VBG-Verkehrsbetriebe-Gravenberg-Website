/* VBG – Shifts */
VBG.shifts = (function () {
  let shifts = [];
  let galleryImages = [];
  let selectedGallery = '/IMGs/Bild1.png';
  let uploadImage = null;

  function clockIcon() {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  }

  function shiftCard(s) {
    const time = [s.time_start, s.time_end].filter(Boolean).join(' – ');
    return `<article class="shift-card">
      <div class="shift-image" data-viewimage="${esc(s.image)}" title="Bild ansehen">
        <img src="${esc(s.image)}" alt="${esc(s.title)}" loading="lazy"/>
        <span class="shift-date-badge">${esc(fmtDateISO(s.date))}</span>
      </div>
      <div class="shift-body">
        <h3>${esc(s.title)}</h3>
        <div class="shift-time">${clockIcon()} <span>${esc(time)} Uhr</span></div>
        ${s.description ? `<p class="shift-desc">${esc(s.description)}</p>` : ''}
        <div class="shift-footer">
          <span>${s.host_name ? `🎤 Shifthost: ${esc(s.host_name)} · ` : ''}Angesetzt von ${esc(s.created_by)}</span>
          ${VBG.state && VBG.state.user && VBG.state.user.role === 'inhaber'
            ? `<button class="btn btn-danger btn-sm" data-del-shift="${s.id}">Löschen</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  function showSub(name) {
    document.querySelectorAll('#shifts-subnav .chip').forEach((c) => c.classList.toggle('active', c.dataset.shiftsub === name));
    document.getElementById('shifts-list-panel').classList.toggle('hidden', name !== 'list');
    document.getElementById('shifts-create-panel').classList.toggle('hidden', name !== 'create');
  }

  async function load() {
    const data = await API.get('/api/shifts');
    shifts = data.shifts || [];
    const createChip = document.querySelector('#shifts-subnav .chip[data-shiftsub="create"]');
    if (createChip) createChip.classList.toggle('hidden', !(VBG.state && VBG.state.user && VBG.state.user.role === 'inhaber'));
    render();
  }

  function render() {
    const wrap = document.getElementById('shifts-list');
    const q = (document.getElementById('shift-search').value || '').toLowerCase().trim();
    let list = shifts;
    if (q) list = list.filter((s) => (s.title + ' ' + (s.description || '')).toLowerCase().includes(q));
    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">🚌</div><p>Keine Shifts gefunden${q ? ' für "' + esc(q) + '"' : ''}.</p><p class="muted">Schau später wieder vorbei – es kommen täglich neue dazu.</p></div>`;
      return;
    }
    wrap.innerHTML = list.map(shiftCard).join('');
  }

async function loadHosts() {
  const sel = document.getElementById('shift-host');
  sel.innerHTML = '<option value="">— Ohne Shifthost —</option>';
  try {
    const data = await API.get('/api/users');
    const hosts = (data.users || []).filter((u) => u.role === 'inhaber');
    for (const h of hosts) {
      const opt = document.createElement('option');
      opt.value = h.id;
      opt.textContent = (h.verified ? '✓ ' : '') + h.username;
      sel.appendChild(opt);
    }
  } catch (e) { /* Shifthost-Auswahl ist optional */ }
}

function showCreate() {
  uploadImage = null;
  selectedGallery = '/IMGs/Bild1.png';
  document.getElementById('shift-title').value = '';
  document.getElementById('shift-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('shift-time-start').value = '14:00';
  document.getElementById('shift-time-end').value = '18:00';
  document.getElementById('shift-desc').value = '';
  loadHosts();
  document.getElementById('shift-file-input').value = '';
    setGalleryMode('gallery');
    const prev = document.getElementById('shift-upload-preview');
    prev.src = '';
    prev.classList.add('hidden');
    resetDropzone();
    loadGallery();
    showSub('create');
  }

  async function loadGallery() {
    try {
      const data = await API.get('/api/images');
      galleryImages = data.images || [];
      renderGallery();
    } catch (e) {
      galleryImages = [];
      renderGallery();
    }
  }

  function renderGallery() {
    const wrap = document.getElementById('shift-img-gallery');
    wrap.innerHTML = galleryImages.map((f) => {
      const src = '/IMGs/' + encodeURIComponent(f);
      const sel = src === selectedGallery;
      return `<button type="button" class="img-opt ${sel ? 'selected' : ''}" data-imgsrc="${esc(src)}" title="${esc(f)}">
        <img src="${esc(src)}" alt=""/> <span class="check">✓</span>
      </button>`;
    }).join('');
  }

  function setGalleryMode(mode) {
    document.querySelectorAll('[data-imgmode]').forEach((b) => b.classList.toggle('active', b.dataset.imgmode === mode));
    document.getElementById('imgmode-gallery').classList.toggle('hidden', mode !== 'gallery');
    document.getElementById('imgmode-upload').classList.toggle('hidden', mode !== 'upload');
    if (mode === 'gallery') renderGallery();
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 1440;
          const scale = Math.min(1, maxW / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.74));
        };
        img.onerror = () => reject(new Error('Keine gültige Bilddatei.'));
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function submit(e) {
    e.preventDefault();
    const s = {
      title: document.getElementById('shift-title').value.trim(),
      date: document.getElementById('shift-date').value,
      time_start: document.getElementById('shift-time-start').value,
      time_end: document.getElementById('shift-time-end').value || null,
      description: document.getElementById('shift-desc').value.trim(),
      image: uploadImage || selectedGallery,
      host_id: Number(document.getElementById('shift-host').value) || null
    };
    if (!uploadImage && !document.querySelector('#imgmode-gallery .img-opt.selected')) {
      toast('Bitte wähle ein Bild aus der Galerie oder lade eins hoch.', 'err');
      return;
    }
    if (!s.title || !s.date || !s.time_start) { toast('Bitte Titel, Datum und Startzeit angeben.', 'err'); return; }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await API.post('/api/shifts', s);
      toast('Schicht veröffentlicht!', 'ok');
      showSub('list');
      load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function remove(id) {
    if (!confirm('Schicht wirklich löschen?')) return;
    try {
      await API.del('/api/shifts/' + id);
      toast('Schicht gelöscht.', 'ok');
      load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-shiftsub]');
      if (!chip) return;
      if (chip.dataset.shiftsub === 'create') showCreate();
      else showSub('list');
    });
    document.getElementById('shift-form').addEventListener('submit', submit);
    document.getElementById('shift-search').addEventListener('input', render);
    document.getElementById('shifts-list').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-shift]');
      if (del) { e.stopPropagation(); remove(Number(del.dataset.delShift)); return; }
      const img = e.target.closest('.shift-image[data-viewimage]');
      if (img) openImageView(img.dataset.viewimage);
    });
    document.getElementById('shift-img-gallery').addEventListener('click', (e) => {
      const opt = e.target.closest('.img-opt');
      if (!opt) return;
      selectedGallery = opt.dataset.imgsrc;
      renderGallery();
    });
    document.querySelectorAll('[data-imgmode]').forEach((b) => {
      b.addEventListener('click', () => setGalleryMode(b.dataset.imgmode));
    });
    const fileInput = document.getElementById('shift-file-input');
    const dropzone = document.querySelector('.dropzone');
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files || !fileInput.files[0]) return;
      try {
        setClearSave(dropzone, true, 'Bild wird bearbeitet …');
        uploadImage = await fileToDataURL(fileInput.files[0]);
        const prev = document.getElementById('shift-upload-preview');
        prev.src = uploadImage;
        prev.classList.remove('hidden');
        document.getElementById('dz-text').innerHTML = '✓ Bild ausgewählt – wird zusammen mit der Schicht gespeichert.';
      } catch (err) {
        toast(err.message, 'err');
        resetDropzone();
      } finally {
        setClearSave(dropzone, false, null);
      }
    });
    ['dragover', 'dragleave', 'drop'].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.toggle('dragover', ev === 'dragover' || ev === 'drop');
        if (ev === 'drop' && e.dataTransfer.files && e.dataTransfer.files[0]) {
          const dt = new DataTransfer();
          dt.items.add(e.dataTransfer.files[0]);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change'));
        }
      });
    });
  }

  function setClearSave(el, busy, text) {
    if (busy) { el.dataset.busy = '1'; el.classList.add('dragover'); if (text) document.getElementById('dz-text').innerHTML = text; }
    else { delete el.dataset.busy; el.classList.remove('dragover'); }
  }
  function resetDropzone() { document.getElementById('dz-text').innerHTML = 'Klick oder Datei hierher ziehen<br/><small>Wird automatisch komprimiert und in der Datenbank gespeichert.</small>'; }

  return { load, render, bind };
})();
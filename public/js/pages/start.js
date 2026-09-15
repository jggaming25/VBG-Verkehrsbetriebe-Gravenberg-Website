/* VBG – Startseite: Hinweise/News oben, Bilder weiter unten */
const StartPage = {
  title: 'Start',

  async render(container) {
    const [newsRes, imgRes] = await Promise.all([
      API.get('/api/news').catch(() => ({ news: [] })),
      API.get('/api/images').catch(() => ({ images: [] }))
    ]);
    const news = newsRes.news || [];
    const images = imgRes.images || [];

    container.innerHTML = `
      <div class="page-head">
        <h1>Willkommen</h1>
        <p>Neuigkeiten und Hinweise rund um die Verkehrsbetriebe Gravenberg.</p>
      </div>

      <div class="section-head"><h2>Hinweise</h2></div>
      ${news.length ? `
        <div class="news-grid">
          ${news.map((n) => `
            <article class="card news-card ${n.pinned ? 'pinned' : ''}">
              <div class="news-title">
                <span>${esc(n.title)}</span>
                ${n.pinned ? '<span class="badge badge-green">Angepinnt</span>' : ''}
              </div>
              <div class="news-body">${esc(n.body)}</div>
              <div class="news-meta">${esc(n.author || 'Verwaltung')} · ${esc(fmtDate(n.created_at))}</div>
            </article>`).join('')}
        </div>` : '<div class="empty">Zurzeit keine Hinweise.</div>'}

      <div class="section-head" style="margin-top:30px"><h2>Impressionen</h2><p>Ein kleiner Blick auf unsere Welt</p></div>
      ${images.length ? `
        <div class="gallery-grid">
          ${images.map((f) => `<div class="gallery-item" data-src="/IMGs/${encodeURIComponent(f)}">
            <img src="/IMGs/${encodeURIComponent(f)}" alt="Impression" loading="lazy"/></div>`).join('')}
        </div>` : '<div class="empty">Keine Bilder vorhanden.</div>'}
    `;

    container.querySelectorAll('.gallery-item').forEach((it) => {
      it.addEventListener('click', () => App.openImage(it.dataset.src));
    });
  }
};
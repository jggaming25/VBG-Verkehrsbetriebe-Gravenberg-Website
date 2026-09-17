/* VBG – Dienstplan (Schichtplan-Ansicht) */
const DienstplanPage = {
  title: 'Dienstplan',
  state: { shiftId: null },

  desc(d) {
    if (d.type === 'bus') return d.linie || d.code;
    if (d.type === 'wechsel') return 'Linienwechsel ' + d.wechsel_from_name + ' → ' + d.wechsel_to_name;
    return d.standort || 'Kundenservice Strafe';
  },

  linieLabel(l) {
    const s = String(l || '');
    return /^\d+$/.test(s) ? 'L' + s : s;
  },

  /* Einzelne Fahrt für die Übersicht (Zeit, Linie, Richtung, Strecke) */
  fahrtHtml(d, f, i) {
    const prev = i > 0 ? (d.fahrten || [])[i - 1] : null;
    const wechsel = prev && String(prev.linie) !== String(f.linie)
      ? `<div class="plan-wechsel">Linienwechsel ${this.linieLabel(prev.linie)} → ${this.linieLabel(f.linie)}</div>`
      : '';
    const kolort = f.color ? esc(f.color) : '#555';
    return wechsel + `
      <div class="plan-fahrt">
        <span class="plan-fahrt-zeit">${f.start ? esc(fmtTime(f.start)) + '–' + esc(fmtTime(f.end)) : '–'}</span>
        <span class="plan-fahrt-badge" style="--lc:${kolort}">${esc(this.linieLabel(f.linie))}</span>
        <span class="plan-fahrt-richt ${String(f.richtung) === 'zurück' ? 'zurueck' : ''}" title="${esc(f.richtung)}">${String(f.richtung) === 'zurück' ? '←' : '→'}</span>
        <span class="plan-fahrt-strecke"><span class="muted">${esc(f.von)}</span> → <span class="muted">${esc(f.nach)}</span></span>
      </div>`;
  },

  /* Zusammenfassung eines bus-Dienstes: Linien-Umläufe + reine Fahrzeit */
  summary(d) {
    const list = d.fahrten || [];
    if (!list.length) return '';
    const umlaeufe = [];
    const seen = new Set();
    let fzMin = 0;
    for (const f of list) {
      if (f.start && f.end) {
        const a = new Date(String(f.start).length === 16 ? f.start + ':00' : f.start);
        const b = new Date(String(f.end).length === 16 ? f.end + ':00' : f.end);
        if (!isNaN(a) && !isNaN(b) && b > a) fzMin += (b - a) / 60000;
      }
      const key = String(f.linie);
      if (!seen.has(key)) { seen.add(key); umlaeufe.push(this.linieLabel(f.linie)); }
    }
    return `${list.length} Fahrten · ${Math.round(fzMin)} min Fahrtzeit` + (umlaeufe.length ? ' · Umläufe: ' + umlaeufe.join(' ⟶ ') : '');
  },

  dutyRow(d, data, bySlot) {
    const haupt = bySlot[d.id + ':haupt'];
    const reserve = bySlot[d.id + ':reserve'];
    const canManage = data.canManage;
    const sig = (data.settings && data.settings.strafe_name) || 'Kundenservice Strafe';
    const accent = d.color || (d.type === 'wechsel' ? 'var(--warning)' : (d.type === 'strafe' ? 'var(--danger)' : 'var(--primary)'));
    const eligible = (data.users || []).filter((u) => !d.license_id || (u.licenses || []).includes(d.license_id));
    const selected = haupt ? haupt.user_id : (reserve ? reserve.user_id : '');

    const label = d.type === 'bus'
      ? '🚌 <b>' + esc(this.linieLabel(d.linie)) + '</b>'
      : d.type === 'wechsel'
        ? '🔄 Linienwechsel ' + esc(d.wechsel_from_name) + ' → ' + esc(d.wechsel_to_name)
        : '🛍️ ' + (d.standort || sig);
    const metaBits = [d.fahrzeug ? 'Fahrzeug ' + d.fahrzeug : '', d.license ? 'Lizenz ' + d.license : ''].filter(Boolean);
    const sum = d.type === 'bus' ? this.summary(d) : '';
    if (sum) metaBits.push(sum);

    const fahrten = d.type === 'bus' && (d.fahrten || []).length
      ? `<div class="plan-fahrten-block">${d.fahrten.map((f, i) => this.fahrtHtml(d, f, i)).join('')}</div>`
      : (d.note ? `<div class="plan-desc-note">${esc(d.note)}</div>` : '');

    return `
      <div class="plan-row" style="border-left:3px solid ${accent}" data-duty="${d.id}">
        <div class="plan-code">${esc(d.code)}</div>
        <div class="plan-time">${d.start ? esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) : '–'}</div>
        <div class="plan-main">
          <b>${label}</b>
          <div class="plan-desc">${metaBits.join(' · ')}</div>
        </div>
        <div class="plan-license">${d.license ? `<span class="badge badge-blue">${esc(d.license)}</span>` : ''}</div>
        <div class="plan-assign">
          ${haupt
            ? `${avatarHtml({ display_name: haupt.display_name || haupt.username, avatar: '' })}
               <span>${esc(haupt.display_name || haupt.username)}</span>
               ${haupt.status !== 'bestaetigt' ? ' <span class="badge badge-amber">Vorschlag</span>' : ''}
               ${reserve ? `<div class="plan-reserve">Reserve: ${esc(reserve.display_name || reserve.username)}</div>` : ''}`
            : '<span class="unbesetzt">UNBESETZT – keine Person zugeteilt</span>'}
          ${canManage ? `
            <div class="plan-assign-actions">
              <select class="input ${d.license_id && !selected ? 'warn' : ''}" data-user="${d.id}" style="padding:5px 8px;font-size:.8rem">
                <option value="">– nicht zugeteilt –</option>
                ${eligible.map((u) => `<option value="${u.id}" ${String(u.id) === String(selected) ? 'selected' : ''}>${esc(u.display_name || u.username)}</option>`).join('')}
              </select>
              <button class="btn btn-dark btn-xs" data-role="save">Zuweisen</button>
              <button class="btn btn-danger btn-xs" data-unassign="${d.id}">Leeren</button>
            </div>` : ''}
        </div>
      </div>
      ${fahrten ? `<div class="plan-fahrten-wrap" data-trips-of="${d.id}">${fahrten}</div>` : ''}`;
  },

  async render(container) {
    const query = new URLSearchParams(location.hash.split('?')[1] || '');
    this.state.shiftId = parseInt(query.get('shift') || localStorage.getItem('vbg_plan_shift') || '0', 10) || null;

    const data = await API.get('/api/dienstplan?shift_id=' + (this.state.shiftId || ''));
    if (data.shift) {
      this.state.shiftId = data.shift.id;
      localStorage.setItem('vbg_plan_shift', String(data.shift.id));
    }
    const duties = data.duties || [];
    const assignments = data.assignments || [];
    const bySlot = {};
    for (const a of assignments) bySlot[a.duty_id + ':' + a.kind] = a;
    const canManage = data.canManage;
    const reserves = assignments.filter((a) => a.kind === 'reserve');
    const sig = (data.settings && data.settings.strafe_name) || 'Kundenservice Strafe';

    const busDuties = duties.filter((d) => d.type !== 'strafe').sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    const strafeDuties = duties.filter((d) => d.type === 'strafe').sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    container.innerHTML = `
      <div class="page-head"><h1>Dienstplan</h1><p>Der Schichtplan mit allen Diensten und einzelnen Fahrten.</p></div>

      <div class="panel">
        <div class="panel-head"><h2>Shift auswählen</h2></div>
        ${data.shifts.length ? `
          <div class="seg">
            ${data.shifts.map((s) => `
              <label class="seg-label" data-shift="${s.id}">
                <input type="radio" name="plan-shift" value="${s.id}" ${s.id === this.state.shiftId ? 'checked' : ''}/>
                <span>${esc(s.title)} · ${esc(fmtDate(s.date))} ${esc(fmtTime(s.time_start))}${s.status !== 'published' ? ' <span class="badge badge-gray">Entwurf</span>' : ''}</span>
              </label>`).join('')}
          </div>` : '<div class="empty">Noch keine Shifts vorhanden.</div>'}
      </div>

      ${data.shift ? `
        <div class="plan-sheet">
          <div class="plan-sheet-head">
            <h2>Dienstplan · ${esc(data.shift.title)}</h2>
            <div class="plan-legend">
              <span><span class="dot" style="background:var(--primary)"></span>Busdienst</span>
              <span><span class="dot" style="background:var(--warning)"></span>Linienwechsel</span>
              <span><span class="dot" style="background:var(--danger)"></span>${esc(sig)}</span>
            </div>
          </div>

          ${canManage ? `
            <div class="plan-section-head" style="gap:12px;flex-wrap:wrap">
              <span>Leitung</span>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-left:auto">
                <span class="muted" style="font-weight:600;align-self:center;font-size:.8rem">Sign-Up: ${data.signup_state === 'offen' ? 'offen' : data.signup_state === 'geschlossen' ? 'geschlossen' : data.signup_state === 'vorbei' ? 'vorbei' : 'Entwurf'}</span>
                <button class="btn btn-primary btn-sm" id="btn-confirm">Alle Vorschläge bestätigen</button>
              </div>
            </div>` : ''}

          <div class="plan-section">
            <div class="plan-section-head">BUSDIENSTE <small>${busDuties.length} Dienste · ganztägige Abdeckung</small></div>
            ${busDuties.length ? busDuties.map((d) => this.dutyRow(d, data, bySlot)).join('') : '<div class="empty">Keine Busdienste eingeplant.</div>'}
          </div>

          ${strafeDuties.length ? `
            <div class="plan-section">
              <div class="plan-section-head">${esc(sig.toUpperCase())} <small>${strafeDuties.length} Dienste · Standorte</small></div>
              ${strafeDuties.map((d) => this.dutyRow(d, data, bySlot)).join('')}
            </div>` : ''}

          <div class="plan-section">
            <div class="plan-section-head">RESERVE <small>${reserves.length} zugeteilt</small></div>
            ${reserves.length ? `
              <div class="table-wrap" style="border:0;border-radius:0">
                <table class="table">
                  <thead><tr><th>Dienst</th><th>Zeit</th><th>Beschreibung</th><th>Reserve</th>${canManage ? '<th></th>' : ''}</tr></thead>
                  <tbody>
                    ${reserves.map((a) => {
                      const d = duties.find((x) => x.id === a.duty_id) || {};
                      return `<tr>
                        <td><b>${esc(d.code || '')}</b></td>
                        <td class="muted-sm">${d.start ? esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) : '–'}</td>
                        <td class="muted-sm">${esc(this.desc(d))}</td>
                        <td>${esc(a.display_name || a.username)}</td>
                        ${canManage ? `<td><button class="btn btn-danger btn-xs" data-unassign="${a.duty_id}">Leeren</button></td>` : ''}
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>` : '<div class="empty">Keine Reservezuweisungen.</div>'}
          </div>

          <div class="plan-section">
            <div class="plan-section-head">PAUSEN <small>Information</small></div>
            <p class="muted" style="padding:14px 20px;margin:0;font-size:.85rem">Pausen werden derzeit nicht automatisch eingeplant. Die Einteilung beachtet Überschneidungen und verfügbare Zeitfenster.</p>
          </div>
        </div>` : '<div class="empty">Kein Dienstplan vorhanden.</div>'}
    `;

    container.querySelectorAll('.seg-label input[name="plan-shift"]').forEach((r) => {
      r.addEventListener('change', () => {
        localStorage.setItem('vbg_plan_shift', String(r.value));
        location.hash = '#/dienstplan?shift=' + r.value + '&t=' + Date.now();
      });
    });

    if (canManage) {
      const btnConfirm = container.querySelector('#btn-confirm');
      if (btnConfirm) btnConfirm.addEventListener('click', async () => {
        try {
          await API.post('/api/admin/confirm-plan', { shift_id: this.state.shiftId });
          App.toast('Alle Vorschläge bestätigt.');
          App.reload();
        } catch (e) { App.toast(e.message, 'error'); }
      });

      container.querySelectorAll('[data-role="save"]').forEach((b) => {
        b.addEventListener('click', async () => {
          const row = b.closest('.plan-row');
          const dutyId = parseInt(row.dataset.duty, 10);
          const sel = row.querySelector('select[data-user]');
          const payload = { duty_id: dutyId, user_id: parseInt(sel.value, 10) || null, kind: 'haupt', status: 'bestaetigt' };
          try {
            await API.post('/api/admin/assignments', payload);
            App.toast('Einteilung gesetzt.');
            App.reload();
          } catch (e) { App.toast(e.message, 'error'); }
        });
      });

      container.querySelectorAll('[data-unassign]').forEach((b) => {
        b.addEventListener('click', async () => {
          const dutyId = parseInt(b.dataset.unassign, 10);
          try {
            await API.post('/api/admin/assignments', { duty_id: dutyId, user_id: null, kind: 'haupt', status: 'bestaetigt' });
            App.toast('Einteilung entfernt.');
            App.reload();
          } catch (e) { App.toast(e.message, 'error'); }
        });
      });
    }
  }
};

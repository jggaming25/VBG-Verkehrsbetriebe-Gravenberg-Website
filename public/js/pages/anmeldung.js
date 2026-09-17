/* VBG – Personalanmeldung (Staff Sign-Up) */
const AnmeldungPage = {
  title: 'Anmeldung',
  state: { shiftId: null },

  dutyLabel(d) {
    let name = d.code;
    if (d.type === 'bus') name = d.linie || d.code;
    else if (d.type === 'wechsel') name = (d.wechsel_from_name || '?') + ' → ' + (d.wechsel_to_name || '?');
    else if (d.type === 'strafe') name = d.standort || 'Kundenservice Strafe';
    const t = d.start ? ' · ' + fmtTime(d.start) + '–' + fmtTime(d.end) : '';
    return d.code + ' · ' + name + t;
  },

  async render(container) {
    const data = await API.get('/api/anmeldung');
    const settings = data.settings || {};
    const closeMin = settings.signup_close_minutes || 60;
    const startMin = settings.staff_start_minutes || 30;
    const maxWish = settings.max_duty_wishes || 5;

    this.state.shiftId = parseInt(localStorage.getItem('vbg_signup_shift') || '0', 10) || null;
    if (!data.open_shifts.some((s) => s.id === this.state.shiftId)) {
      this.state.shiftId = data.open_shifts.length ? data.open_shifts[0].id : null;
    }

    const selShift = this.state.shiftId ? data.open_shifts.find((s) => s.id === this.state.shiftId) : null;
    const mySignup = selShift ? data.signups.find((s) => s.shift_id === selShift.id) : null;
    const duties = selShift ? (data.duties_by_shift[selShift.id] || []) : [];
    const strafeDuties = duties.filter((d) => d.type === 'strafe');

    container.innerHTML = `
      <div class="page-head">
        <h1>Staff Sign-Up</h1>
        <p>Melde dich für kommende Shifts an und wünsche dir deine Dienste.</p>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Shift auswählen</h2></div>
        <p class="panel-sub">Das Sign-Up schließt automatisch ${closeMin} Minuten vor Shiftbeginn. Danach startet die automatische Einteilung (Autoshift). Dienstbeginn ist ${startMin} Minuten vor dem offiziellen Shiftstart.</p>
        ${data.open_shifts.length ? `
          <div class="seg">
            ${data.open_shifts.map((s) => `
              <label class="seg-label" data-shift="${s.id}">
                <input type="radio" name="signup-shift" value="${s.id}" ${s.id === this.state.shiftId ? 'checked' : ''}/>
                <span>${esc(s.title)} · ${esc(fmtDate(s.date))} ${esc(fmtTime(s.time_start))}</span>
              </label>`).join('')}
          </div>` : '<div class="empty">Zurzeit ist keine Anmeldung geöffnet.</div>'}
      </div>

      ${selShift ? `
        <div class="panel">
          <div class="panel-head">
            <h2>${esc(selShift.title)}</h2>
            <span class="badge badge-green">Anmeldung offen</span>
          </div>
          <div class="kv mb">
            <dt>Termin</dt><dd>${esc(fmtDate(selShift.date))} · ${esc(fmtTime(selShift.time_start))} – ${esc(fmtTime(selShift.time_end))}</dd>
            <dt>Sign-Up bis</dt><dd>${esc(fmtDateTime(selShift.date + 'T' + selShift.time_start))} (${closeMin} Min. vor Beginn)</dd>
          </div>
          <form id="signup-form">
            <h2 style="margin-top:14px">Duty-Wünsche</h2>
            <p class="panel-sub">Du kannst bis zu ${maxWish} Dienste in deiner Reihenfolge wünschen. Der Autoshift behandelt zuerst alle 1. Wünsche, danach die 2., 3. usw. Harte Regeln wie Lizenz, Verfügbarkeit, Inactivity und Überschneidungen bleiben wichtiger.</p>
            <div class="form-grid">
              ${Array.from({ length: maxWish }, (_, i) => `
                <label class="field">
                  <span class="field-label">${i + 1}. Duty-Wunsch</span>
                  <select class="input" name="duty_wish" data-wish="${i + 1}">
                    <option value="">Keine Präferenz</option>
                    ${duties.filter((d) => d.type !== 'strafe').map((d) => `
                      <option value="${d.id}" ${mySignup && mySignup.preferred_duty_ids[i] === d.id ? 'selected' : ''}>${esc(this.dutyLabel(d))}</option>`).join('')}
                  </select>
                </label>`).join('')}
            </div>

            ${strafeDuties.length ? `
              <div class="panel" style="background:var(--bg)">
                <div class="panel-head"><h3>Kundenservice Strafe – freiwillig</h3>
                  <span class="badge badge-amber">${strafeDuties.length} vorhanden</span></div>
                <label class="check-line">
                  <input type="checkbox" id="volunteer-strafe" ${mySignup && mySignup.volunteer_strafe ? 'checked' : ''}/>
                  <span>Freiwillig für eine Einteilung in den Kundenservice Strafe anmelden</span>
                </label>
                <div id="strafe-prefs" class="${mySignup && mySignup.volunteer_strafe ? '' : 'hidden'}">
                  <span class="field-label">Bevorzugter Standort</span>
                  <div class="seg">
                    <label class="seg-label"><input type="radio" name="strafe_standort" value="0" ${!mySignup || !mySignup.preferred_standort_id ? 'checked' : ''}/><span>Posten egal</span></label>
                    ${data.standorte.map((st) => `
                      <label class="seg-label"><input type="radio" name="strafe_standort" value="${st.id}" ${mySignup && mySignup.preferred_standort_id === st.id ? 'checked' : ''}/><span>${esc(st.name)}</span></label>`).join('')}
                  </div>
                </div>
              </div>` : ''}

            <div class="form-row">
              <label class="field">
                <span class="field-label">Verfügbar ab</span>
                <input class="input" type="datetime-local" id="avail-start" value="${esc(mySignup ? mySignup.available_start : '')}"/>
              </label>
              <label class="field">
                <span class="field-label">Verfügbar bis</span>
                <input class="input" type="datetime-local" id="avail-end" value="${esc(mySignup ? mySignup.available_end : '')}"/>
              </label>
            </div>
            <label class="check-line">
              <input type="checkbox" id="needs-senior" ${mySignup && mySignup.needs_senior ? 'checked' : ''}/>
              <span>Senior-Begleitung benötigt</span>
            </label>
            <label class="check-line">
              <input type="checkbox" id="strafe-abarbeitung" ${mySignup && mySignup.strafe_abarbeitung ? 'checked' : ''}/>
              <span>Diesen Dienst als Strafe-Abarbeitung werten</span>
            </label>
            <label class="field">
              <span class="field-label">Anmerkung</span>
              <textarea class="input" id="signup-note" placeholder="Optionale Anmerkung zur Shift …">${esc(mySignup ? mySignup.note : '')}</textarea>
            </label>
            <button class="btn btn-primary" type="submit">${mySignup ? 'Anmeldung aktualisieren' : 'Anmelden'}</button>
          </form>
        </div>` : ''}

      <div class="panel">
        <div class="panel-head"><h2>Meine Staff Sign-Ups</h2></div>
        ${data.signups.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Shift</th><th>Datum / Zeit</th><th>Wunsch</th><th>Verfügbar</th><th>Strafe</th><th>Abarbeitung</th><th>Senior</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${data.signups.map((s) => {
                  const duties = data.duties_by_shift[s.shift_id] || [];
                  const wishNames = s.preferred_duty_ids.map((id) => {
                    const d = duties.find((x) => x.id === id);
                    return d ? this.dutyLabel(d) : '?';
                  });
                  return `
                  <tr>
                    <td><b>${esc(s.shift_title)}</b></td>
                    <td>${esc(fmtDate(s.shift_date))} ${esc(fmtTime(s.shift_start))} – ${esc(fmtTime(s.shift_end))}</td>
                    <td class="muted-sm">${wishNames.length ? wishNames.map((w, i) => (i + 1) + '. ' + esc(w)).join('<br/>') : 'Keine Präferenz'}</td>
                    <td class="muted-sm">${s.available_start ? esc(fmtTime(s.available_start)) + ' – ' + esc(fmtTime(s.available_end)) : 'Ganztags'}</td>
                    <td class="muted-sm">${s.volunteer_strafe ? 'Ja' : 'Nein'}</td>
                    <td class="muted-sm">${s.strafe_abarbeitung ? 'Ja' : 'Nein'}</td>
                    <td class="muted-sm">${s.needs_senior ? 'Ja' : 'Nein'}</td>
                    <td><span class="badge badge-green">Angemeldet</span></td>
                    <td>${s.shift_status === 'published' ? `<button class="btn btn-danger btn-xs" data-unregister="${s.shift_id}">Abmelden</button>` : ''}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>` : '<div class="empty">Du bist noch zu keiner Shift angemeldet.</div>'}
      </div>
    `;

    container.querySelectorAll('.seg-label input[name="signup-shift"]').forEach((r) => {
      r.addEventListener('change', () => {
        localStorage.setItem('vbg_signup_shift', String(r.value));
        this.state.shiftId = parseInt(r.value, 10);
        App.reload();
      });
    });

    const volCheck = container.querySelector('#volunteer-strafe');
    if (volCheck) {
      volCheck.addEventListener('change', () => {
        container.querySelector('#strafe-prefs').classList.toggle('hidden', !volCheck.checked);
      });
    }

    const form = container.querySelector('#signup-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const wishes = Array.from(form.querySelectorAll('select[name="duty_wish"]')).map((s) => s.value ? parseInt(s.value, 10) : 0);
        const standort = form.querySelector('input[name="strafe_standort"]:checked');
        const payload = {
          shift_id: this.state.shiftId,
          preferred_duty_ids: wishes.filter((v) => v > 0),
          volunteer_strafe: volCheck ? volCheck.checked : false,
          preferred_standort_id: standort ? parseInt(standort.value, 10) : null,
          available_start: form.querySelector('#avail-start').value,
          available_end: form.querySelector('#avail-end').value,
          strafe_abarbeitung: form.querySelector('#strafe-abarbeitung').checked,
          needs_senior: form.querySelector('#needs-senior').checked,
          note: form.querySelector('#signup-note').value
        };
        try {
          await API.post('/api/anmeldung', payload);
          App.toast('Anmeldung gespeichert.');
          App.reload();
        } catch (err) {
          App.toast(err.message, 'error');
        }
      });
    }

    container.querySelectorAll('[data-unregister]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Anmeldung für diese Shift wirklich zurückziehen?')) return;
        try {
          await API.del('/api/anmeldung/' + b.dataset.unregister);
          App.toast('Abgemeldet.');
          App.reload();
        } catch (err) {
          App.toast(err.message, 'error');
        }
      });
    });
  }
};

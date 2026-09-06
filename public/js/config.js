/* ============================================================
   VBG – Konfiguration
   Hier trägst du deine EmailJS-Schlüssel ein (siehe README).
   ============================================================ */
window.VBG = window.VBG || {};

Object.assign(window.VBG, {
  emailjs: {
    publicKey: 'svngJ-3wcQIv00tES',
    serviceId: 'service_be1j40a',
    verifyTemplateId: 'template_qk1hnlt',
    ticketTemplateId: 'template_ndghtcm'
  },
  isStaff: function (role) {
    return role === 'inhaber' || role === 'bearbeiter';
  },
  categories: ['frage', 'problem', 'vorschlag', 'bewerbung', 'sonstiges'],
  labels: {
    categories: { frage: 'Frage', problem: 'Problem / Bug', vorschlag: 'Vorschlag', bewerbung: 'Bewerbung', sonstiges: 'Sonstiges' },
    priorities: { niedrig: 'Niedrig', normal: 'Normal', hoch: 'Hoch' },
    status: { offen: 'Offen', in_arbeit: 'In Arbeit', geschlossen: 'Geschlossen' },
    roles: { besucher: 'Besucher', bearbeiter: 'Bearbeiter', inhaber: 'Inhaber' }
  }
});
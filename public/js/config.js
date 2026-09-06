/* ============================================================
   VBG – Konfiguration
   Hier trägst du deine EmailJS-Schlüssel ein (siehe README).
   ============================================================ */
window.VBG = window.VBG || {};

Object.assign(window.VBG, {
  emailjs: {
    publicKey: 'FLX9q6hpQStPk_UId',
    serviceId: 'service_be1j40a',
    verifyTemplateId: 'template_qk1hnlt',
    ticketTemplateId: 'template_ndghtcm'
  },
  isStaff: function (role) {
    return role === 'inhaber' || role === 'bearbeiter';
  },
  isOwner: function (role) {
    return role === 'inhaber';
  },
  categories: ['frage', 'problem', 'vorschlag', 'bewerbung', 'sonstiges'],
  discordRoles: {
    '1544008757447757965': 'Trainee Busfahrer',
    '1544007506475614308': 'Busfahrer',
    '1545071119000805447': 'Trainee Leitstelle',
    '1544007146751139880': 'Leitstelle',
    '1544007001489809579': 'Trainee Notfallmanager',
    '1544006432892911616': 'Notfallmanager',
    '1544009575550947418': 'Trainee Kundenservice',
    '1544008876020596786': 'Kundenservice'
  },
  labels: {
    categories: { frage: 'Frage', problem: 'Problem / Bug', vorschlag: 'Vorschlag', bewerbung: 'Bewerbung', sonstiges: 'Sonstiges' },
    priorities: { niedrig: 'Niedrig', normal: 'Normal', hoch: 'Hoch' },
    status: { offen: 'Offen', in_arbeit: 'In Arbeit', geschlossen: 'Geschlossen' },
    roles: { besucher: 'Besucher', bearbeiter: 'Bearbeiter', inhaber: 'Inhaber' }
  }
});
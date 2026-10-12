'use strict';
const subjectsJson = require('../seed/subjects.json');
const materialsJson = require('../seed/materials.json');

function subjects(examType = 'written') {
  return subjectsJson
    .filter((s) => s.examType === examType)
    .map((s) => ({ ...s, units: s.units.map((u) => ({ ...u, subjectId: s.id })) }));
}
function materials() {
  return materialsJson.map((m) => ({ ...m, visible: true, linkStatus: 'ok' }));
}
module.exports = { subjects, materials };

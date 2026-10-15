'use strict';
const plan = { examType: 'written', examDate: '2027-03-20', dday: 156, capacityMinutes: 120, studyDays: [1, 2, 3, 4, 5], createdDate: '2026-09-01', reviewStartDate: '2027-03-13', warnings: [] };
const materials = [{ id: 'qa-uml', type: 'doc', title: 'UML 다이어그램 정리', sourceName: 'uml-diagrams.org', url: 'https://www.uml-diagrams.org/' }];
const task = (id, date, title, minutes, done = false) => ({ id, date, title, minutes, done, type: 'study', subjectName: '소프트웨어 설계', subjectId: 'w1', unitId: 'w1-u1', checklist: [], materials, actualMinutes: done ? minutes : null, understanding: done ? 2 : null });
const tasks = [
  task('past-done', '2026-10-13', '완료한 학습 주제', 60, true),
  task('past-pending', '2026-10-14', '이전 미완료 학습 주제', 60),
  task('today-done', '2026-10-15', '요구사항 확인', 45, true),
  task('today-pending', '2026-10-15', '애플리케이션 설계', 75),
  task('future-one', '2026-10-16', '인터페이스 설계', 45),
  task('future-two', '2026-10-16', '데이터 입출력 구현', 45),
  task('october-last', '2026-10-30', '10월 말 학습 주제', 90),
  task('november-last', '2026-11-30', '11월 말 학습 주제', 50),
  task('year-end', '2026-12-31', '연말 복습', 60),
  task('year-start', '2027-01-01', '새해 학습', 60),
];
function fixture(name = 'default') {
  const auth = { user: name.startsWith('guest') ? null : { uid: 'frontend-schedule-qa' }, loading: false };
  const today = name === 'year' ? '2026-12-31' : name === 'leap' ? '2024-01-31' : '2026-10-15';
  const selectedPlan = ['no-plan', 'no-profile', 'guest-empty'].includes(name) ? null : { ...plan, createdDate: name === 'leap' ? '2024-01-01' : plan.createdDate };
  const items = name === 'all-done' ? tasks.map((t) => ({ ...t, done: true, actualMinutes: t.minutes })) : name === 'empty' ? [] : tasks;
  return { name, today, auth, plan: selectedPlan, hasProfile: name !== 'no-profile', tasks: items, guest: auth.user || !selectedPlan ? null : { plan: selectedPlan, tasks: items } };
}
module.exports = { fixture, plan, tasks };

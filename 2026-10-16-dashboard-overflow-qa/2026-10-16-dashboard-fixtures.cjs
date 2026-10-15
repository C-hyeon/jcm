'use strict';
function fixture(period = '4w') {
  const weeks = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];
  if (period === 'all') weeks.unshift('2026-09-07', '2026-09-14');
  return {
    empty: false,
    summary: { overall: 42.5, remainingHours: 100.6, doneTasks: 3, scheduledTasks: 10 },
    subjects: [
      { name: '소프트웨어 설계', rate: 10 }, { name: '소프트웨어 개발', rate: 35 },
      { name: '데이터베이스 구축', rate: 60 }, { name: '프로그래밍 언어 활용', rate: 80 },
      { name: '정보시스템 구축관리', rate: 100 },
    ],
    weakness: [
      { label: 'SQL 응용', subjectName: '데이터베이스 구축', count: 20, score: 72.5 },
      { label: '소프트웨어 개발 보안 구축', subjectName: '정보시스템 구축관리', count: 10, score: 27.5 },
    ],
    remaining: weeks.map((week, i) => ({ week, plannedHours: 100 - i * 12, actualHours: 105 - i * 10 })),
    weekly: weeks.map((week, i) => ({ week, rate: i * 20, done: i, scheduled: 5 })),
  };
}
module.exports = { fixture };

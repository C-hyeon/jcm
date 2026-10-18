'use strict';

function fixture(empty = false) {
  if (empty) return { overall: 0, remainingMinutes: 0, expected: null, gap: null, suggestRegenerate: false, subjects: [] };
  return {
    overall: 20, remainingMinutes: 960, expected: 45, gap: -25, suggestRegenerate: true,
    subjects: [
      {
        id: 'qa-s1', name: '소프트웨어 설계', rate: 20, remainingMinutes: 540,
        units: [
          { id: 'qa-u1', name: '요구사항 확인', core: true, standardHours: 6, rate: 25 },
          { id: 'qa-u2', name: '화면 설계', standardHours: 3, rate: 0 },
          { id: 'qa-u3', name: '애플리케이션 설계', core: true, standardHours: 6, rate: 0 },
          { id: 'qa-u4', name: '인터페이스 설계', standardHours: 4, rate: 0 },
        ],
      },
      {
        id: 'qa-s2', name: '정보시스템 구축관리', rate: 30, remainingMinutes: 420,
        units: [
          { id: 'qa-u5', name: '소프트웨어 개발 보안 구축', core: true, needsReview: true, understanding: 1, standardHours: 8, rate: 25 },
          { id: 'qa-u6', name: '응용 소프트웨어 기초 기술 활용', standardHours: 5, rate: 0 },
        ],
      },
    ],
  };
}

module.exports = { fixture };

'use strict';
// 가입 직후 레벨테스트 — 문항·채점은 서버에서만 처리하고 정답은 응답하지 않는다.
// 문항은 기출 문제 본문을 옮기지 않고 필기 5과목의 기본 개념을 직접 작성한 것이다.

// 필기 5과목 15문항(과목당 3문항) + 실기 5문항(과목당 1문항), 총 20문항.
// 필기 과목 자신감은 필기 문항으로만 정한다. 실기 과목은 내용이 가까운 필기 과목 결과를 따르고,
// 실기 문항이 있는 과목은 그 문항을 2문항 몫으로 더해 함께 판단한다(PRACTICAL_WEIGHT).
const PRACTICAL_DOMAIN = {
  p01: 'w1', // 요구사항 확인 ← 소프트웨어 설계
  p02: 'w3', // 데이터 입출력 구현 ← 데이터베이스 구축
  p03: 'w2', // 통합 구현 ← 소프트웨어 개발
  p04: 'w2', // 서버 프로그램 구현
  p05: 'w1', // 인터페이스 구현
  p06: 'w1', // 화면 설계
  p07: 'w2', // 애플리케이션 테스트 관리
  p08: 'w3', // SQL 응용
  p09: 'w5', // 소프트웨어 개발 보안 구축 ← 정보시스템 구축관리
  p10: 'w4', // 프로그래밍 언어 활용
  p11: 'w4', // 응용 SW 기초 기술 활용(운영체제·네트워크)
  p12: 'w2', // 제품소프트웨어 패키징
};

const QUESTIONS = [
  { id: 'lt01', subjectId: 'w1', text: '다음 중 애자일(Agile) 방법론에 해당하지 않는 것은?', choices: ['XP(eXtreme Programming)', '스크럼(Scrum)', '칸반(Kanban)', '폭포수 모델'], answer: 3, explain: '폭포수 모델은 단계를 순차적으로 진행하는 전통적 방법론입니다.' },
  { id: 'lt02', subjectId: 'w1', text: 'UML 다이어그램 중 클래스와 클래스 사이의 관계 등 시스템의 정적 구조를 표현하는 것은?', choices: ['시퀀스 다이어그램', '클래스 다이어그램', '활동 다이어그램', '상태 다이어그램'], answer: 1, explain: '클래스 다이어그램은 구조(정적) 다이어그램입니다. 나머지는 행위(동적) 다이어그램입니다.' },
  { id: 'lt03', subjectId: 'w1', text: '모듈 설계에서 결합도(Coupling)에 대한 설명으로 옳은 것은?', choices: ['모듈 간 결합도는 높을수록 좋다', '모듈 간 결합도는 낮을수록 좋다', '결합도는 한 모듈 내부 요소들의 관련 정도이다', '결합도와 독립성은 서로 관계가 없다'], answer: 1, explain: '결합도는 낮고 응집도는 높을수록 모듈 독립성이 좋습니다. 모듈 내부 요소의 관련 정도는 응집도입니다.' },

  { id: 'lt04', subjectId: 'w2', text: '스택(Stack) 자료구조의 특징으로 옳은 것은?', choices: ['먼저 넣은 것이 먼저 나온다(FIFO)', '나중에 넣은 것이 먼저 나온다(LIFO)', '우선순위가 높은 것이 먼저 나온다', '양쪽 끝에서만 삽입과 삭제가 가능하다'], answer: 1, explain: '스택은 LIFO 구조입니다. FIFO는 큐, 양쪽 끝 삽입·삭제는 데크의 특징입니다.' },
  { id: 'lt05', subjectId: 'w2', text: '다음 중 화이트박스 테스트 기법에 해당하는 것은?', choices: ['동등 분할', '경계값 분석', '기초 경로 검사', '원인-결과 그래프'], answer: 2, explain: '기초 경로 검사는 내부 논리 구조를 보는 화이트박스 기법입니다. 나머지는 블랙박스 기법입니다.' },
  { id: 'lt06', subjectId: 'w2', text: '소프트웨어 형상 관리(SCM)의 주된 목적은?', choices: ['소프트웨어 변경 사항을 체계적으로 추적하고 통제한다', '개발 인력의 채용 일정을 관리한다', '서버 하드웨어의 성능을 측정한다', '사용자 화면의 디자인을 통일한다'], answer: 0, explain: '형상 관리는 산출물의 변경을 식별·통제·기록해 일관성을 유지하는 활동입니다.' },

  { id: 'lt07', subjectId: 'w3', text: '트랜잭션의 특성(ACID)에 포함되지 않는 것은?', choices: ['원자성(Atomicity)', '일관성(Consistency)', '독립성(Isolation)', '확장성(Scalability)'], answer: 3, explain: 'ACID는 원자성, 일관성, 독립성(격리성), 영속성(지속성)입니다.' },
  { id: 'lt08', subjectId: 'w3', text: '제1정규형을 만족하는 릴레이션에서 제2정규형으로 정규화할 때 제거하는 것은?', choices: ['부분 함수 종속', '이행 함수 종속', '다치 종속', '조인 종속'], answer: 0, explain: '2NF는 부분 함수 종속, 3NF는 이행 함수 종속, 4NF는 다치 종속, 5NF는 조인 종속을 제거합니다.' },
  { id: 'lt09', subjectId: 'w3', text: 'SQL 명령어 중 CREATE, ALTER, DROP이 속하는 분류는?', choices: ['DML(데이터 조작어)', 'DDL(데이터 정의어)', 'DCL(데이터 제어어)', 'TCL(트랜잭션 제어어)'], answer: 1, explain: '테이블 등 구조를 정의·변경·삭제하는 명령은 DDL입니다.' },

  { id: 'lt10', subjectId: 'w4', text: 'C 언어에서 int a = 7 / 2; 를 실행한 뒤 a의 값은?', choices: ['3.5', '3', '4', '0'], answer: 1, explain: '정수끼리의 나눗셈은 소수점 이하를 버린 정수 결과(3)가 됩니다.' },
  { id: 'lt11', subjectId: 'w4', text: '객체지향에서 상위 클래스의 메서드를 하위 클래스에서 같은 이름·매개변수로 다시 정의하는 것은?', choices: ['오버로딩(Overloading)', '오버라이딩(Overriding)', '캡슐화(Encapsulation)', '추상화(Abstraction)'], answer: 1, explain: '오버라이딩은 재정의, 오버로딩은 같은 이름에 매개변수를 달리해 여러 개 정의하는 것입니다.' },
  { id: 'lt12', subjectId: 'w4', text: 'OSI 7계층 중 IP 주소를 이용해 데이터의 전달 경로를 결정(라우팅)하는 계층은?', choices: ['데이터 링크 계층', '네트워크 계층', '전송 계층', '세션 계층'], answer: 1, explain: '라우팅과 논리 주소(IP)는 3계층인 네트워크 계층의 역할입니다.' },

  { id: 'lt13', subjectId: 'w5', text: '원시 코드 라인 수(LOC)를 기반으로 개발 비용을 산정하는 모형은?', choices: ['COCOMO', '기능 점수(FP)', '델파이 기법', 'PERT'], answer: 0, explain: 'COCOMO는 LOC 기반 비용 산정 모형입니다. 델파이는 전문가 판단, PERT는 일정 관리 기법입니다.' },
  { id: 'lt14', subjectId: 'w5', text: '여러 대의 감염된 시스템이 한 서버에 대량의 트래픽을 보내 서비스를 마비시키는 공격은?', choices: ['SQL 삽입', 'DDoS', '피싱', '스니핑'], answer: 1, explain: 'DDoS는 분산 서비스 거부 공격입니다.' },
  { id: 'lt15', subjectId: 'w5', text: '다음 중 대칭키 암호화 알고리즘은?', choices: ['RSA', 'AES', 'ECC', 'DSA'], answer: 1, explain: 'AES는 대칭키 블록 암호입니다. RSA·ECC는 공개키 암호, DSA는 전자서명 알고리즘입니다.' },
  // 실기 — 실기에서 자주 묻는 영역을 1문항씩 직접 묻는다.
  { id: 'lt16', subjectId: 'p08', text: 'SQL의 SELECT 문에서 GROUP BY로 묶은 그룹에 조건을 걸 때 사용하는 절은?', choices: ['WHERE', 'GROUP BY', 'ORDER BY', 'HAVING'], answer: 3, explain: 'HAVING은 그룹으로 묶은 결과에 조건을 겁니다. WHERE는 그룹으로 묶기 전 개별 행에 조건을 겁니다.' },
  { id: 'lt17', subjectId: 'p10', text: 'Python에서 a = [1, 2, 3, 4, 5] 일 때 print(a[1:4])의 출력 결과는?', choices: ['[1, 2, 3]', '[2, 3, 4]', '[2, 3, 4, 5]', '[1, 2, 3, 4]'], answer: 1, explain: '슬라이싱 a[1:4]는 인덱스 1부터 3까지(4는 제외) 가져오므로 [2, 3, 4]입니다.' },
  { id: 'lt18', subjectId: 'p09', text: '게시판 등의 입력값에 악성 스크립트를 넣어, 그 글을 본 다른 사용자의 브라우저에서 스크립트가 실행되게 하는 공격은?', choices: ['SQL 삽입(SQL Injection)', 'CSRF(크로스 사이트 요청 위조)', 'XSS(크로스 사이트 스크립팅)', '스니핑(Sniffing)'], answer: 2, explain: 'XSS는 검증되지 않은 입력의 스크립트가 다른 사용자의 브라우저에서 실행되는 공격입니다. 입력값 검증과 출력 시 이스케이프로 막습니다.' },
  { id: 'lt19', subjectId: 'p11', text: 'IPv4 네트워크 192.168.10.0/24에서 호스트에 할당할 수 있는 IP 주소의 개수는?', choices: ['254개', '255개', '256개', '128개'], answer: 0, explain: '/24는 호스트 부분이 8비트라 256개 주소가 있고, 네트워크 주소와 브로드캐스트 주소 2개를 빼면 254개입니다.' },
  { id: 'lt20', subjectId: 'p07', text: '개발자의 환경에서 사용자가 직접 사용해 보고 개발자가 함께 지켜보며 문제를 기록하는 인수 테스트는?', choices: ['알파 테스트', '베타 테스트', '회귀 테스트', '스모크 테스트'], answer: 0, explain: '알파 테스트는 개발자 환경에서 개발자와 함께, 베타 테스트는 사용자 환경에서 개발자 없이 수행합니다.' },
];

const LEVELS = [
  { min: 0.7, level: 'advanced', label: '상급', stage: 'practice', message: '기본 개념이 잡혀 있어요. 기출·문제 풀이 위주로 계획을 잡는 것을 추천해요.' },
  { min: 0.4, level: 'intermediate', label: '중급', stage: 'concept', message: '일부 과목은 개념이 잡혀 있어요. 약한 과목부터 개념을 정리하는 것을 추천해요.' },
  { min: 0, level: 'beginner', label: '기초', stage: 'intro', message: '처음 공부하는 단계예요. 용어와 기본 개념부터 넉넉하게 시간을 잡는 것을 추천해요.' },
];

// 실기 문항 1개는 해당 실기 과목을 직접 묻기 때문에 필기 문항 2개 몫으로 계산한다.
// 예) 필기 3/3 + 실기 오답 → 3/5 = 60% 보통, 필기 1/3 + 실기 정답 → 3/5 보통, 필기 2/3 + 실기 오답 → 2/5 낮음
const PRACTICAL_WEIGHT = 2;

// 과목 정답률 → 자신감(1 낮음, 2 보통, 3 높음). 3문항 기준 0~1개 낮음, 2개 보통, 3개 높음
function confidenceFor(rate) {
  if (rate >= 1) return 3;
  if (rate >= 0.6) return 2;
  return 1;
}

function publicQuestions() {
  return QUESTIONS.map(({ id, subjectId, text, choices }) => ({ id, subjectId, text, choices }));
}

// answers: { [questionId]: 선택지 번호(0~3) | null(잘 모르겠어요) }
function gradeLevelTest(answers) {
  const bySubject = {};
  let correct = 0;
  const review = QUESTIONS.map((q) => {
    const chosen = answers[q.id] ?? null;
    const ok = chosen === q.answer;
    if (ok) correct++;
    const s = (bySubject[q.subjectId] ||= { correct: 0, total: 0 });
    s.total++;
    if (ok) s.correct++;
    return { id: q.id, chosen, answer: q.answer, correct: ok, explain: q.explain };
  });
  const total = QUESTIONS.length;
  const rate = correct / total;
  const lv = LEVELS.find((l) => rate >= l.min);
  const subjectConfidence = {};
  for (const [sid, s] of Object.entries(bySubject)) subjectConfidence[sid] = confidenceFor(s.correct / s.total);
  for (const [pid, domain] of Object.entries(PRACTICAL_DOMAIN)) {
    const base = bySubject[domain];
    const own = bySubject[pid];
    if (!base) subjectConfidence[pid] = 2;
    else if (!own) subjectConfidence[pid] = subjectConfidence[domain];
    else subjectConfidence[pid] = confidenceFor((base.correct + own.correct * PRACTICAL_WEIGHT) / (base.total + own.total * PRACTICAL_WEIGHT));
  }
  return {
    result: {
      correct,
      total,
      rate: Math.round(rate * 1000) / 10,
      level: lv.level,
      levelLabel: lv.label,
      message: lv.message,
      recommendedStage: lv.stage,
      bySubject,
      subjectConfidence,
    },
    review,
  };
}

module.exports = { QUESTIONS, PRACTICAL_DOMAIN, PRACTICAL_WEIGHT, publicQuestions, gradeLevelTest, confidenceFor };

# 정처기메이트

정보처리기사 수험생을 위한 AI 기반 학습 관리 웹 플랫폼
시험일을 입력하면 남은 기간에 맞춘 학습 스케줄을 만들고, 매일 할 일과 참고 자료를 한 화면에 제시합니다.

| 구분 | 기술 |
|---|---|
| 프론트엔드 | React 18 + Vite, React Router, Recharts |
| 백엔드 | Node.js 20+ / Express (REST, JSON) |
| 데이터베이스 | Firebase Cloud Firestore (Admin SDK로만 접근) |
| 인증 | Firebase Authentication (이메일/비밀번호, Google) |
| AI | Gemini · Claude · OpenAI 중 1종 (어댑터 교체식, 기본 `mock`) |

---

## 0. 팀원 빠른 시작 (공유 Firebase 프로젝트 `jcm-1125`)

팀은 Firebase 프로젝트 **`jcm-1125`** 하나를 같이 씁니다. DB와 로그인 계정이 모두 공유되므로 아래 **주의 사항**을 꼭 읽어 주세요.

### 1) 공유받은 파일 넣기

| 파일 | 넣을 위치 |
|---|---|
| 서버 환경변수 | `server/.env` |
| 클라이언트 환경변수 | `client/.env` |
| 서비스 계정 키 | `server/service-account.json` |

`server/.env`의 `GOOGLE_APPLICATION_CREDENTIALS`는 키 파일의 **절대 경로**입니다. 본인 PC 경로로 바꿔 주세요.
```env
GOOGLE_APPLICATION_CREDENTIALS=C:/Users/<본인>/<저장 위치>/jcm/server/service-account.json
```

### 2) 설치·실행 (Node.js 20 이상, 터미널 2개)
```bash
cd server && npm install && npm run dev     # http://localhost:8787
cd client && npm install && npm run dev     # http://localhost:5173
```
- 서버 로그에 `Firestore 에뮬레이터 사용`이 **나오지 않아야** 실제 `jcm-1125`에 연결된 것입니다.
- 회원가입하면 레벨테스트 → 학습 계획 만들기 순서로 진행됩니다.

### 3) 주의 사항 (공유 DB)
- **데이터는 팀 전체가 같이 쓰는 실제 데이터**입니다. 테스트는 각자 가입한 계정으로 하고, 다른 사람 계정·데이터는 건드리지 않습니다.
- `npm run seed -- --prod`는 시험 일정·과목·학습 자료를 시드 파일 내용으로 **덮어씁니다**(관리자 화면에서 고친 내용도 되돌아감). 실행 전에 팀에 먼저 알려 주세요.
- `firestore.rules`·`firestore.indexes.json`을 바꾼 경우에만 저장소 루트에서 `firebase deploy --only firestore:rules,firestore:indexes`를 실행합니다. 배포 후 몇 분 동안은 인덱스 생성 중이라 일부 화면이 "일시적인 서버 오류"를 낼 수 있습니다.
- 관리자 권한은 `cd server && npm run set-admin -- 이메일`로 부여합니다(해당 계정 재로그인 후 적용).
- `.env`, `service-account.json`, `.firebaserc`는 git에 올라가지 않도록 설정돼 있습니다. **키 내용을 메신저·이슈·커밋에 붙여 넣지 마세요.** 유출이 의심되면 콘솔(프로젝트 설정 → 서비스 계정)에서 키를 삭제하고 새로 발급합니다.
- AI 추천은 현재 `AI_PROVIDER=mock`(실제 AI 호출 없음)입니다. 실제 AI 키는 사용량만큼 과금되므로 쓸지 팀에서 정한 뒤 넣습니다.

### 4) 작업 후 확인
```bash
cd server && npx jest       # 서버 테스트 82개 (Windows에서는 npm test 대신 npx jest)
```
- 화면 회귀 스크립트는 저장소 루트에서 `node 2026-10-17-auth-tests/2026-10-17-auth-regression.cjs`처럼 파일별로 실행합니다(`client`에서 `npm install` 필요). 일부 스크립트는 특정 화면 코드가 바뀌지 않았는지 검사하므로, 의도적으로 바꿨다면 스크립트도 함께 고칩니다. `2026-10-16-dashboard-regression.cjs`의 캐시 경로 항목 1개는 Windows 경로 구분자 차이로 실패합니다(기능 문제 아님).
- 오류가 나면 서버 터미널의 `"event":"server.error"` 줄에 실제 원인이 찍힙니다. 화면에는 "일시적인 서버 오류"만 보입니다.

---

## 1. 폴더 구조

```
jcm/
├─ firebase.json             # Hosting(클라이언트), Firestore, 에뮬레이터 설정
├─ firestore.rules           # 클라이언트 직접 읽기·쓰기 전면 거부
├─ firestore.indexes.json    # 복합 인덱스 + 추천 이력 TTL(expireAt)
├─ server/
│  ├─ src/
│  │  ├─ app.js              # 보안 헤더·CORS·본문 100KB 제한·라우터 조립
│  │  ├─ config/firebase.js  # Admin SDK 초기화(환경변수/에뮬레이터)
│  │  ├─ middleware/         # 토큰 검증, 관리자 권한, 재인증, 입력 검증, 호출 제한, 오류 형식
│  │  ├─ routes/             # public · me · study · insights · wrongNotes · personal · admin
│  │  ├─ services/
│  │  │  ├─ scheduler.js     # ★ 스케줄 배분·재배분 알고리즘(순수 함수)
│  │  │  ├─ weakness.js      # ★ 취약도 계산(순수 함수) + 누적 집계
│  │  │  ├─ progressCalc.js  # 진도율·잔여 학습량
│  │  │  ├─ materialLogic.js # 과제 자료 연결, 후보 선택, 규칙 기반 추천, 학습 경로
│  │  │  ├─ planService.js   # 스케줄 생성/재생성/재배분/조정(Firestore)
│  │  │  ├─ recommendService.js  # AI 추천 + 검증 + 대체 추천
│  │  │  ├─ levelTest.js     # 가입 직후 레벨테스트 문항·채점(정답은 서버에만)
│  │  │  └─ ai/providers.js  # Gemini·Claude·OpenAI·mock 어댑터
│  │  └─ lib/                # 날짜(Asia/Seoul), 스키마(zod), URL 검사, 로거
│  ├─ seed/                  # 시험 일정·과목/단원·학습 자료 초기 데이터(JSON)
│  ├─ scripts/               # seed.js, setAdmin.js, exportMasters.js
│  ├─ tests/                 # Jest + Supertest (82개)
│  └─ api/index.js, vercel.json   # Vercel Serverless 진입점
├─ 2026-??-??-*/             # 화면별 회귀 스크립트(node로 실행)
└─ client/
   └─ src/
      ├─ pages/              # Home, Auth, LevelTest, Onboarding, Schedule, Progress, WrongNotes,
      │                      # Materials, LearningPath, Recommend, Dashboard, Profile, Admin
      ├─ components/         # Layout(내비게이션·동의·권한), StudyCards(과제·추천 카드), ui
      ├─ context/AuthContext.jsx  # 로그인 상태 + 비회원 데이터 계정 이전
      └─ api/client.js       # Bearer 토큰 자동 첨부, {code,message} 오류 처리
```

## 2. 에뮬레이터로 혼자 실행 (선택)

공유 프로젝트 대신 내 PC 안의 가짜 Firebase(에뮬레이터)로 실행하는 방법입니다. 공유 DB를 건드리지 않고 테스트 계정 5개로 시험해 볼 때 씁니다. 이때는 `server/.env`의 `FIRESTORE_EMULATOR_HOST`·`FIREBASE_AUTH_EMULATOR_HOST` 주석을 풀고 `client/.env`의 `VITE_USE_EMULATOR=true`로 바꿉니다.

### 준비
```bash
npm i -g firebase-tools          # Firebase CLI (에뮬레이터는 Java 21 이상 필요 — firebase-tools v15부터)
java -version                    # 21 이상인지 확인. 없으면 JDK 21 설치(아래 "Java 설치" 참고)
cd server && npm install
cd ../client && npm install
cp server/.env.example server/.env
cp client/.env.example client/.env
```
기본 프로젝트 ID `demo-jcm`처럼 `demo-`로 시작하는 ID는 에뮬레이터 전용이라, Firebase 계정·실제 프로젝트 없이 바로 실행됩니다. (`.firebaserc`는 실제 프로젝트에 배포할 때만 필요)

### Java 설치 (에뮬레이터용)
Firestore 에뮬레이터는 Java로 동작하며, firebase-tools v15부터 **Java 21 이상**이 필요합니다.
- Windows: [Eclipse Temurin JDK 21](https://adoptium.net/temurin/releases/?version=21) `.msi` 설치 시 **Set JAVA_HOME**, **Add to PATH**를 켜고, 설치 후 터미널(VS Code 포함)을 완전히 껐다 켭니다. 또는 `winget install EclipseAdoptium.Temurin.21.JDK`
- macOS: `brew install --cask temurin@21`
- 확인: `java -version` 이 `21.x` 이상이면 됩니다.
- `You are not currently authenticated` 경고는 에뮬레이터만 쓸 때는 무시해도 됩니다(`firebase login`으로 없앨 수 있음).

### 실행 (터미널 3개)
```bash
# ① 에뮬레이터(Auth 9099, Firestore 8080, UI 4400) — 저장소 루트(jcm/)에서
firebase emulators:start --only auth,firestore --project demo-jcm

# ② 서버: 마스터 데이터 + 테스트 계정 5개 시드 후 실행
cd server
npm run seed:test-users
npm run dev                      # http://localhost:8787

# ③ 클라이언트
cd client
npm run dev                      # http://localhost:5173
```

테스트 계정(비밀번호 `Test1234!`): `test1@jcm.test`(필기 D-30, 오답 0) ~ `test5@jcm.test`(실기 D-21, 오답 100) — 명세 3.7의 30·90·180일, 오답 0·20·100건 시나리오.

관리자 권한 부여: `npm run set-admin -- test1@jcm.test` (재로그인 후 적용)

**재배분 테스트**: `server/.env`에 `ALLOW_DEBUG_TODAY=true`를 두고, 브라우저 콘솔에서
`sessionStorage.setItem('jcm.debugToday','2026-10-15')` 후 새로고침하면 그 날짜를 ‘오늘’로 보고 미완료 과제를 재배분합니다. (개발 모드에서만 동작, 운영에서는 무시)

### 테스트
```bash
cd server && npx jest --coverage   # 단위·통합·시나리오 82개 + 커버리지 (macOS·Linux는 npm test도 가능)
```
- `scheduler.test.js` — 시험일까지 30/90/180일: 일별 배정 ≤ 가용 시간, 시험 전날까지 종료, 미학습 단원 누락 0건, 재배분 3건
- `weakness-progress.test.js` — 취약도 상위 3개가 수작업 계산과 일치, 진도율 오차 0, 대체 추천 자료가 모두 허브 자료
- `e2e.test.js` — 가입 → 조건 입력 → 스케줄 → 완료 기록 → 오답 → 재배분 → AI/대체 추천 → 타 사용자 접근 차단 → 관리자 권한 → 탈퇴 후 데이터 0건
- `api.test.js` — 401/400 오류 형식, 경곗값(0.5h·12h·30분 단위), 100KB 제한, CORS, 보안 헤더
- `level-estimate.test.js` — 최소 준비 기간 30일, 하루 필요 학습 시간 추천(예: 복습 포함 60시간 ÷ 20일 = 3시간), 레벨테스트 채점·저장
- `me-race.test.js` — 가입 직후 사용자 정보 조회와 가입 정보 저장이 겹쳐도 닉네임·동의가 유지됨

`e2e.test.js`는 에뮬레이터 없이도 돌도록 인메모리 Firestore 대역(`tests/fakeFirebase.js`)을 씁니다. 실제 인덱스·보안 규칙 동작은 에뮬레이터와 테스트용 Firebase 프로젝트에서 한 번 더 확인하세요.

## 3. 배포

1. Firebase 콘솔에서 **개발용·운영용 프로젝트를 분리**해 만들고 Authentication(이메일/비밀번호, Google)과 Firestore(위치 `asia-northeast3` 서울, 프로덕션 모드)를 켭니다. `.firebaserc.example`을 `.firebaserc`로 복사해 실제 프로젝트 ID를 넣습니다.
2. 규칙·인덱스 배포: `firebase deploy --only firestore:rules,firestore:indexes --project prod`
3. 마스터 데이터: `cd server && node scripts/seed.js --prod` (Q-Net 공고로 시험 일정 확인 후)
4. **백엔드(Vercel 예시)**: `server/` 폴더를 프로젝트로 연결 → 환경변수 등록
   - `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_BASE64`(서비스 계정 JSON을 base64로), `CORS_ORIGINS`(클라이언트 도메인), `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `NODE_ENV=production`
5. **프론트엔드**: `client/.env`에 운영 Firebase 웹 설정과 `VITE_API_BASE=https://<백엔드 도메인>`, `VITE_USE_EMULATOR=false` → `npm run build` → 루트에서 `firebase deploy --only hosting`
6. 추천 이력 TTL: 인덱스 파일의 `expireAt` TTL 설정이 적용되지 않으면 콘솔 Firestore > TTL에서 `recommendations.expireAt`을 등록합니다(서버도 요청 시 180일 지난 이력을 정리함).

> Firebase 무료(Spark) 플랜에서는 Cloud Functions를 쓸 수 없어 Express 서버를 외부 호스팅에 둡니다(명세 3.10). 플랫폼 종속 코드는 `server/api/index.js`·`vercel.json`에만 있습니다.

## 4. 명세서 요구사항 ↔ 구현 위치

| 요구사항 | 구현 |
|---|---|
| UC-01 회원 관리 | `pages/Auth.jsx`, `pages/Profile.jsx`, `routes/me.js` (5회 실패 시 재설정 안내, 탈퇴 재인증·`recursiveDelete`) |
| UC-01 확장: 가입 직후 레벨테스트 | `pages/LevelTest.jsx`, `services/levelTest.js`, `routes/study.js` `/level-test` (15문항 서버 채점 → 수준·추천 학습 단계·과목별 자신감, 학습 계획 기본값으로 사용) |
| UC-02 시험 정보·학습 조건 | `pages/Onboarding.jsx`, `routes/study.js` (회차 선택 시 시험일 자동, **새 시험일은 최소 30일 전**, `POST /api/plans/estimate`로 하루 필요 학습 시간 추천·부족 시 시간/요일 조정 안내) |
| UC-03 스케줄 생성·조회 | `services/scheduler.js` `buildPlan` (T_i 공식, 학습 단계별 총정리 비율 10/15/25/40%, 60% 미만 핵심 단원 우선), `pages/Schedule.jsx` |
| UC-04 오늘 할 일·재배분 | `routes/study.js` `/today`, `scheduler.redistribute` (빈 학습일 → 넘치면 총정리 기간 대체) |
| UC-05 진도 체크 | `routes/insights.js` `/progress`, `pages/Progress.jsx` (선행 학습 시 오늘 이후 과제 축소·삭제, 차이 20%p 이상 재생성 제안) |
| UC-06 오답·취약 유형 | `routes/wrongNotes.js`, `services/weakness.js` (r = 1.5/1.0/0.5, 1,000자 제한) |
| UC-07 학습 자료 조회 | `pages/Materials.jsx`, `routes/public.js` (필터·검색·새 탭·북마크, 점검 실패 자료 숨김) |
| UC-08 자료·마스터 관리 | `pages/Admin.jsx`, `routes/admin.js` (https·중복 URL 거부, 1초 간격 링크 점검, 비관리자 403) |
| UC-09 AI 추천 | `services/recommendService.js` (비식별 요약, 후보 ≤20, JSON 검증, 허브 외 ID 폐기, 20초·실패 시 규칙 기반 대체, 일 10회) |
| UC-10 학습 현황 시각화 | `pages/Dashboard.jsx`, `/api/stats` (수치 라벨 병기) |
| 3.5 API 목록·오류 형식 | `app.js`, `middleware/common.js` — `{code, message}`, 400/401/403/404/409/429/500 |
| 3.8 보안 | 토큰 서명·만료·폐기 검증, admin custom claim, Firestore 규칙 전면 거부, helmet·HSTS, CORS 화이트리스트, 사용자당 분당 60회 |
| 3.6 데이터 | `users/{uid}` 하위 컬렉션, 마스터 분리(코드 수정 없이 과목 교체), 날짜 `YYYY-MM-DD`(Asia/Seoul) |

UC-11 스터디 관리(확장)는 명세상 7단계 종료 시점에 개발 여부를 정하도록 되어 있어 이번 범위에서 제외했습니다. 데이터 모델(`studyGroups` 최상위 컬렉션)은 명세대로 추가하면 됩니다.

## 5. 벤치마킹 반영

| 출처 | 반영 내용 | 위치 |
|---|---|---|
| 정처랩 ① 학습 시작 | 홈에서 **오늘 계획대로 학습 / 자료 찾아보기** 두 갈래로 바로 시작 | `StudyCards.jsx` `StartChoice` |
| 정처랩 ② 학습 기록 | 완료 체크 시 **실제 시간·이해도(어려움/보통/잘 이해)·복습 필요** 기록 → 진도·취약 주제에 반영 | `TaskCard` 학습 기록 대화상자, `PATCH /api/tasks/:id` |
| 정처랩 ③ 취약 주제 | 과목별 진도와 오답 취약 유형·복습 필요 단원을 연결해 **다음에 복습할 주제** 목록 제공 | `GET /api/weakness` `nextReview`, 홈 |
| 파워 CBT ① 첫 화면 | 시험까지 남은 기간 → 오늘 할 일 → 과목별 진도 → 취약 주제 → 다음 추천 순서, 비회원 첫 화면에 시험 정보·학습 가이드·CBT 링크 | `pages/Home.jsx` |
| 파워 CBT ② 학습 카드 | 과제 카드에서 공개 자료 링크를 바로 열기(1클릭) | `MaterialLinks` |
| 파워 CBT ③ 로그인 시점 | 스케줄 미리보기·자료 탐색은 **가입 없이** 사용, 기록 저장·북마크 순간에 가입 제안, 가입 시 비회원 데이터 자동 이전 | `POST /api/plans/preview`, `SignupPrompt`, `AuthContext` |
| EBS 단추 ① 온보딩 | 시험 단계·남은 기간·**과목별 자신감** 입력 → 자신감 낮은 과목에 가중치(w) | `Onboarding.jsx`, `scheduler.subjectWeight` |
| EBS 단추 ② 추천 카드 | 추천 주제·추천 이유·연결 자료 출처를 한 카드에 | `RecommendationCards` |
| EBS 단추 ③ 학습 경로 | 취약 과목을 고르고 관련 자료를 입문 → 개념 → 문제 풀이 → 총정리 순서로 안내 | `pages/LearningPath.jsx`, `/api/learning-path` |

## 6. 명세서와 달라진 점·팀 확인 필요

- **비회원 권한**: 명세 3.8 권한 표는 비회원의 자료 허브 조회를 ‘불가’로 두었지만, 벤치마킹(파워 CBT)을 반영해 자료 허브 조회와 스케줄 미리보기(저장 안 함)를 비회원에게 열었습니다. 표를 갱신하거나, 원래대로 막으려면 `routes/public.js`의 `/materials`·`/plans/preview`를 인증 라우터로 옮기면 됩니다.
- **오답 메모 1건 = 문서 1건, 취약도는 누적 집계 문서**(`users/{uid}/meta/wrongStats`)로 계산합니다. 일일 읽기 한도(사용자당 100건)를 지키기 위한 설계이며, 어긋나면 `POST /api/weakness/rebuild`로 재계산합니다.
- **AI 호출은 SDK 대신 `fetch`**로 각 제공사 REST API를 부릅니다(의존성 최소화). 명세의 ‘공식 Node.js SDK’를 쓰려면 `ai/providers.js`의 해당 어댑터만 바꾸면 됩니다. `AI_MODEL`은 선정 시점의 공식 문서에서 확인해 넣으세요.
- **시드 시험 일정은 예시 날짜**입니다. 반드시 Q-Net 공고를 확인해 관리자 화면에서 수정하세요.
- **시드 학습 자료 14건**은 실제 공개 사이트(Q-Net, W3Schools, Python 공식 문서 등)의 대표 주소입니다. 등록 전 링크 점검을 돌리고, 명세 목표(초기 50건)만큼 관리자 화면에서 추가하세요. 크롤링·본문 저장은 하지 않습니다.
- 호출 제한(분당 60회)은 서버 메모리 기준이라 서버리스 인스턴스가 여러 개면 인스턴스별로 집계됩니다. 엄격히 지켜야 하면 Firestore/Redis 저장소로 바꾸세요.
- React 컴포넌트 단위 테스트(React Testing Library)는 포함하지 않았습니다. 테스트 계획서의 ‘React 컴포넌트’ 항목은 추가 작업이 필요합니다.
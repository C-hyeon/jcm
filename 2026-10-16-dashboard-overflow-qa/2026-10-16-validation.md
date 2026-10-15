# 대시보드·스케줄 프론트 회귀 검증

클라이언트 의존성을 설치한 뒤 저장소 루트에서 실행한다. 별도 패키지 설치나 Firebase 설정 변경은 필요 없다.

## 자동 검사

```sh
node --test 2026-10-15-schedule-qa/2026-10-15-schedule-regression.cjs 2026-10-16-dashboard-overflow-qa/2026-10-16-dashboard-regression.cjs
```

스케줄 43개와 대시보드·캐시 10개를 검사한다. 이 명령은 실제 API나 계정 기록을 변경하지 않는다. CSS 검사는 현재 커밋의 전체 CSS와 비교하지 않고 스케줄의 선택자 범위·필수 상태를 검사하므로, 다른 화면의 정당한 CSS 변경이나 커밋 때문에 실패하지 않는다.

## 브라우저 검증

```sh
node 2026-10-16-dashboard-overflow-qa/2026-10-16-browser-server.cjs
```

`http://localhost:5220/__qa`에서 실제 Dashboard 컴포넌트와 CSS를 읽기 전용 예시 데이터로 렌더링한다. 네 차트가 모두 채워져 있으며, 실제 Express·Firebase·AI에 연결하지 않는다. 실제 `/api/` 호출은 차단한다.

확인 항목:
- 데스크톱에서 툴팁을 표시한 뒤 제목 영역으로 이동하고 390px·320px로 전환해 가로 스크롤이 생기지 않는지 확인한다.
- 네 차트의 좌우 끝과 긴 취약 유형의 툴팁을 눌러 내용이 잘리지 않는지 확인한다.
- 최근 4주·전체 전환 후에도 차트와 툴팁이 유지되는지 확인한다.

검증 서버 종료:

```sh
curl -X POST http://localhost:5220/__qa/stop
```

검증 서버는 이 폴더의 날짜별 캐시만 사용한다. 다른 QA 서버를 추가할 때도 `JCM_VITE_CACHE_DIR` 환경 변수 또는 Vite의 `cacheDir` 옵션으로 별도 캐시를 지정한다. 실행 중인 본 서버와 `client/node_modules/.vite`를 공유하지 않는다.

`.env`, 캐시, 로그, 화면 캡처, 계정 정보는 커밋하지 않는다.

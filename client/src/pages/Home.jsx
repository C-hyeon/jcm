// 홈 — 로그인 후 1회 클릭 이내 오늘 할 일 확인 / 화면 순서 : 시험일까지 남은 기간 → 학습 시작 분기 → 오늘 할 일 → 과목별 진도 → 취약 주제 → 다음 추천
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import { loadGuest } from '../lib/guest';
import { addDays, EXAM_TYPE, formatDate, minutesLabel, todayKST, ddayLabel, diffDays } from '../lib/format';
import { EmptyState, ErrorBox, Loading, Notice, ExternalLink } from '../components/ui';
import { DdayHero, RecommendationCards, StartChoice, SubjectBars, TaskList } from '../components/StudyCards';
import SignupPrompt from '../components/SignupPrompt';
import Icon from '../components/Icon';

export default function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <MemberHome /> : <GuestHome />;
}

function useScrollTo() {
  const ref = useRef(null);
  return [ref, () => ref.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })];
}

function MemberHome() {
  const navigate = useNavigate();
  const { migrated, clearMigrated } = useAuth();
  const [todayRef, scrollToToday] = useScrollTo();
  const today = useApi(() => api('/api/today'), []);
  const ready = today.data && !today.data.needsOnboarding && !today.data.needsPlan;
  const progress = useApi(ready ? () => api('/api/progress') : null, [ready]);
  const weakness = useApi(ready ? () => api('/api/weakness') : null, [ready]);
  const recs = useApi(ready ? () => api('/api/recommendations?limit=1') : null, [ready]);
  const [recBusy, setRecBusy] = useState(false);
  const [recErr, setRecErr] = useState(null);

  if (today.loading) return <Loading lines={5} />;
  if (today.error) return <ErrorBox error={today.error} onRetry={today.reload} />;
  const d = today.data;

  if (d.needsOnboarding) {
    return (
      <div className="stack">
        <section className="hero">
          <h1>시험일만 알려 주세요.</h1>
          <p>남은 기간과 하루 학습 시간에 맞춰 과목별 스케줄과 오늘 할 일을 만들어 드려요.</p>
          <Link className="btn btn-primary btn-lg" to="/onboarding">
            시험 정보 입력하기 (약 1분)
          </Link>
        </section>
        <StartChoice planLabel="학습 계획 만들기" onPlan={() => navigate('/onboarding')} />
      </div>
    );
  }
  if (d.needsPlan) {
    return (
      <div className="stack">
        <DdayHero exam={d.exam} today={d.today} />
        <EmptyState title="아직 스케줄이 없어요" action={<Link className="btn btn-primary" to="/schedule">스케줄 만들기</Link>}>
          저장한 학습 조건으로 스케줄을 생성해 주세요.
        </EmptyState>
      </div>
    );
  }

  const updateTask = (t) => today.setData((prev) => ({ ...prev, tasks: prev.tasks.map((x) => (x.id === t.id ? t : x)) }));
  const latestRec = recs.data?.items?.[0];
  const doneCount = d.tasks.filter((t) => t.done).length;
  const totalMin = d.tasks.reduce((a, t) => a + t.minutes, 0);

  async function requestRec() {
    setRecBusy(true);
    setRecErr(null);
    try {
      const rec = await api('/api/recommendations', { method: 'POST' });
      recs.setData({ items: [rec] });
    } catch (e) {
      setRecErr(e);
    } finally {
      setRecBusy(false);
    }
  }
  async function feedback(value) {
    await api(`/api/recommendations/${latestRec.id}`, { method: 'PATCH', body: { feedback: value } });
    recs.setData({ items: [{ ...latestRec, feedback: value }] });
  }

  return (
    <div className="stack">
      {migrated && (
        <Notice tone="success" icon="check">
          비회원으로 입력한 시험 정보와 스케줄을 계정에 저장했어요.{' '}
          <button type="button" className="link-btn" onClick={clearMigrated}>
            닫기
          </button>
        </Notice>
      )}
      <DdayHero exam={d.exam} today={d.today} extra={d.inReviewPeriod && <p className="tag tag-amber inline">총정리 기간</p>} />
      <StartChoice onPlan={scrollToToday} />

      <section ref={todayRef} aria-labelledby="today-h" className="section" tabIndex={-1}>
        <div className="section-head">
          <h2 id="today-h">오늘 할 일</h2>
          {d.tasks.length > 0 && (
            <span className="muted">
              {doneCount}/{d.tasks.length} 완료 · 총 {minutesLabel(totalMin)}
            </span>
          )}
        </div>
        {d.redistribution && (d.redistribution.movedCount > 0 || d.redistribution.mergedReviewCount > 0) && (
          <Notice tone="info" icon="calendar">
            지난 미완료 과제 {d.redistribution.movedCount}건을 남은 학습일에 다시 배분했어요.
            {d.redistribution.replacedReviewCount > 0 && ' 학습일이 가득 차 총정리 기간 일부를 대체했습니다.'}
            {d.redistribution.mergedReviewCount > 0 && ` 지난 총정리 과제 ${d.redistribution.mergedReviewCount}건은 남은 총정리 일정에 합쳤어요.`}
          </Notice>
        )}
        {!d.isStudyDay && d.tasks.length === 0 ? (
          <EmptyState title="오늘은 쉬는 날이에요">
            다음 학습일은 {formatDate(d.nextStudyDate)}입니다. 여유가 있다면 <Link to="/progress">원하는 단원을 골라</Link> 추가 학습할 수 있어요.
          </EmptyState>
        ) : d.tasks.length === 0 ? (
          <EmptyState title="오늘 배정된 과제가 없어요">스케줄을 다시 만들거나, 진도 화면에서 원하는 단원을 골라 학습해 보세요.</EmptyState>
        ) : (
          <TaskList tasks={d.tasks} onChange={updateTask} />
        )}
        <p className="muted small">
          배정된 과제 외에 다른 단원을 공부했다면 <Link to="/progress">진도 화면에서 단원을 선택해 기록</Link>하세요. 이후 스케줄과 추천에 반영됩니다.
        </p>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="prog-h">
          <div className="section-head">
            <h2 id="prog-h">과목별 진도</h2>
            <Link to="/progress" className="link-more">
              진도 입력
            </Link>
          </div>
          {progress.loading && <Loading />}
          {progress.error && <ErrorBox error={progress.error} onRetry={progress.reload} />}
          {progress.data && (
            <>
              <p className="big-num">
                {progress.data.overall.toFixed(1)}%<span className="muted small"> 전체 · 남은 학습 {minutesLabel(progress.data.remainingMinutes)}</span>
              </p>
              <SubjectBars subjects={progress.data.subjects} compact />
              {progress.data.suggestRegenerate && (
                <Notice tone="warn">
                  계획 대비 진도 차이가 {Math.abs(progress.data.gap).toFixed(1)}%p예요. <Link to="/schedule">스케줄을 다시 만들어 보세요.</Link>
                </Notice>
              )}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="weak-h">
          <div className="section-head">
            <h2 id="weak-h">다음에 복습할 취약 주제</h2>
            <Link to="/path" className="link-more">
              학습 경로
            </Link>
          </div>
          {weakness.loading && <Loading />}
          {weakness.error && <ErrorBox error={weakness.error} onRetry={weakness.reload} />}
          {weakness.data &&
            (weakness.data.nextReview.length ? (
              <ol className="weak-list">
                {weakness.data.nextReview.map((n, i) => (
                  <li key={i}>
                    <Link to={`/path?subjectId=${n.subjectId}`}>
                      <strong>{n.label}</strong>
                      <span className="muted">{n.reason}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="아직 취약 주제가 없어요">
                <Link to="/wrong-notes">오답을 기록</Link>하거나 학습 기록에서 이해도를 남기면 복습할 주제를 알려 드려요.
              </EmptyState>
            ))}
        </section>
      </div>

      <section className="card" aria-labelledby="rec-h">
        <div className="section-head">
          <h2 id="rec-h">다음 추천</h2>
          <button type="button" className="btn btn-sm btn-primary" onClick={requestRec} disabled={recBusy}>
            <Icon name="spark" size={16} /> {recBusy ? '추천 생성 중… (최대 20초)' : latestRec ? '새로 추천 받기' : '추천 받기'}
          </button>
        </div>
        <ErrorBox error={recErr} />
        {recs.loading && <Loading />}
        {latestRec ? (
          <RecommendationCards rec={latestRec} onFeedback={feedback} />
        ) : (
          !recs.loading && <p className="muted">남은 기간, 진도, 취약 유형을 바탕으로 다음 학습 주제와 자료를 추천해 드려요.</p>
        )}
      </section>
    </div>
  );
}

// 비회원
function GuestHome() {
  const navigate = useNavigate();
  const guest = loadGuest();
  const [prompt, setPrompt] = useState(false);
  const [todayRef, scrollToToday] = useScrollTo();
  const exams = useApi(() => api('/api/exams'), []);
  const cbt = useApi(() => api('/api/materials?type=cbt'), []);
  const today = todayKST();
  const todayTasks = guest?.tasks?.filter((t) => t.date === today) || [];
  const upcoming = guest?.tasks?.filter((t) => t.date > today && t.date <= addDays(today, 6)) || [];

  return (
    <div className="stack">
      {guest?.plan ? (
        <DdayHero exam={{ type: guest.plan.examType, date: guest.plan.examDate, dday: diffDays(today, guest.plan.examDate) }} today={today} extra={<p className="muted small">비회원 미리보기 · 이 브라우저에만 저장돼 있어요</p>} />
      ) : (
        <section className="hero">
          <p className="eyebrow">정보처리기사 필기·실기 학습 관리</p>
          <h1>시험일만 입력하면, 오늘 할 일이 정해집니다.</h1>
          <p>남은 기간·하루 학습 시간·과목별 자신감을 반영해 스케줄을 만들고, 매일 볼 공개 자료까지 한 화면에 모아 드려요. 가입 없이 먼저 써 보세요.</p>
        </section>
      )}

      <StartChoice planLabel={guest?.plan ? '오늘 계획대로 학습' : '내 학습 계획 만들기'} onPlan={() => (guest?.plan ? scrollToToday() : navigate('/onboarding'))} />

      {guest?.plan && (
        <section ref={todayRef} className="section" aria-labelledby="g-today" tabIndex={-1}>
          <div className="section-head">
            <h2 id="g-today">오늘 할 일</h2>
            <Link to="/schedule" className="link-more">
              전체 스케줄
            </Link>
          </div>
          {todayTasks.length ? (
            <TaskList tasks={todayTasks} onRequireLogin={() => setPrompt(true)} />
          ) : (
            <EmptyState title="오늘은 배정된 과제가 없어요">
              {upcoming[0] ? `다음 과제는 ${formatDate(upcoming[0].date)}에 있어요.` : '학습 요일을 확인해 보세요.'}
            </EmptyState>
          )}
          <Notice tone="info" icon="bookmark">
            완료 체크·오답 기록·추천은 가입 후 저장돼요.{' '}
            <button type="button" className="link-btn" onClick={() => setPrompt(true)}>
              지금 저장하기
            </button>
          </Notice>
        </section>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="exam-h">
          <h2 id="exam-h">다가오는 시험</h2>
          {exams.loading && <Loading />}
          {exams.error && <ErrorBox error={exams.error} onRetry={exams.reload} />}
          {exams.data && (
            <ul className="exam-list">
              {exams.data.items.slice(0, 4).map((e) => (
                <li key={e.id}>
                  <span>
                    {e.year}년 {e.round}회 {EXAM_TYPE[e.type]}
                  </span>
                  <span className="muted">{formatDate(e.examDate)}</span>
                  <strong>{ddayLabel(diffDays(today, e.examDate))}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            시험 일정은 <ExternalLink href="https://www.q-net.or.kr/">Q-Net</ExternalLink> 공고를 기준으로 관리자가 등록합니다. 접수 전 공식 공고를 꼭 확인하세요.
          </p>
        </section>

        <section className="card" aria-labelledby="guide-h">
          <h2 id="guide-h">학습 가이드</h2>
          <ol className="guide-steps">
            <li>
              <strong>시험 정보 입력</strong>
              <span className="muted">시험 단계·남은 기간·과목별 자신감</span>
            </li>
            <li>
              <strong>오늘 할 일 확인</strong>
              <span className="muted">과제 카드의 자료 링크로 바로 학습</span>
            </li>
            <li>
              <strong>기록하고 복습</strong>
              <span className="muted">이해도·오답 기록이 다음 추천에 반영</span>
            </li>
          </ol>
          {cbt.data?.items?.length > 0 && (
            <div className="cbt-box">
              <p className="small muted">공개 기출 CBT 바로가기</p>
              {cbt.data.items.slice(0, 2).map((m) => (
                <ExternalLink key={m.id} href={m.url} className="btn btn-outline btn-sm">
                  {m.title}
                </ExternalLink>
              ))}
            </div>
          )}
        </section>
      </div>
      <SignupPrompt open={prompt} onClose={() => setPrompt(false)} />
    </div>
  );
}

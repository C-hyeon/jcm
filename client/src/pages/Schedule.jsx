// UC-03 학습 스케줄 조회(월간·주간 캘린더)·조건 수정·재생성
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, apiWithConfirm } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { loadGuest } from '../lib/guest';
import { DAYS, ddayLabel, formatDate, minutesLabel, monthGrid, todayKST, weekRange, addDays, EXAM_TYPE, diffDays } from '../lib/format';
import { EmptyState, ErrorBox, Loading, Notice, PageHeader } from '../components/ui';
import { TaskList } from '../components/StudyCards';
import SignupPrompt from '../components/SignupPrompt';

export default function Schedule() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const today = todayKST();
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState(null);
  const [prompt, setPrompt] = useState(false);

  const range = useMemo(() => (view === 'month' ? monthGrid(anchor) : weekRange(anchor)), [view, anchor]);
  const planQ = useApi(user ? () => api('/api/plans/current') : null, [user]);
  const tasksQ = useApi(user ? () => api(`/api/plans/tasks?from=${range.from}&to=${range.to}`) : null, [user, range.from, range.to]);

  const guest = !user ? loadGuest() : null;
  const plan = user ? planQ.data?.plan : guest?.plan && { ...guest.plan, dday: diffDays(today, guest.plan.examDate) };
  const tasks = user ? tasksQ.data?.items || [] : (guest?.tasks || []).filter((t) => t.date >= range.from && t.date <= range.to);

  const byDate = useMemo(() => {
    const m = {};
    tasks.forEach((t) => (m[t.date] ||= []).push(t));
    return m;
  }, [tasks]);

  if (loading || planQ.loading) return <Loading lines={6} />;
  if (planQ.error) return <ErrorBox error={planQ.error} onRetry={planQ.reload} />;

  if (!plan) {
    const hasProfile = planQ.data?.hasProfile;
    return (
      <div>
        <PageHeader title="학습 스케줄" />
        <EmptyState
          title="아직 스케줄이 없어요"
          action={
            hasProfile ? (
              <button type="button" className="btn btn-primary" onClick={regenerate} disabled={busy}>
                저장한 조건으로 스케줄 만들기
              </button>
            ) : (
              <Link className="btn btn-primary" to="/onboarding">
                시험 정보 입력하기
              </Link>
            )
          }
        >
          시험일과 하루 학습 시간을 입력하면 과목별 스케줄을 자동으로 만들어 드려요.
        </EmptyState>
        <ErrorBox error={actionErr} />
      </div>
    );
  }

  async function regenerate() {
    if (!user) return setPrompt(true);
    setBusy(true);
    setActionErr(null);
    try {
      await apiWithConfirm('/api/plans', { body: {}, confirmKey: 'confirmOverwrite' });
      planQ.reload();
      tasksQ.reload();
    } catch (e) {
      if (e.status !== 409) setActionErr(e);
    } finally {
      setBusy(false);
    }
  }

  const move = (dir) => setAnchor(view === 'month' ? addDays(range.days[15], dir * 31).slice(0, 8) + '01' : addDays(anchor, dir * 7));
  const selectedTasks = byDate[selected] || [];
  const isReview = (d) => plan.reviewStartDate && d >= plan.reviewStartDate && d < plan.examDate;
  const updateTask = (t) => tasksQ.setData((prev) => ({ ...prev, items: prev.items.map((x) => (x.id === t.id ? t : x)) }));

  return (
    <div className="stack">
      <PageHeader
        title="학습 스케줄"
        desc={`정보처리기사 ${EXAM_TYPE[plan.examType]} · ${formatDate(plan.examDate)} (${ddayLabel(plan.dday)}) · 하루 최대 ${minutesLabel(plan.capacityMinutes)}`}
        actions={
          <>
            <Link className="btn btn-ghost" to="/onboarding">
              조건 수정
            </Link>
            <button type="button" className="btn btn-outline" onClick={regenerate} disabled={busy}>
              {busy ? '다시 만드는 중…' : '오늘 이후 다시 만들기'}
            </button>
          </>
        }
      />
      {location.state?.created && <Notice tone="success" icon="check">스케줄을 만들었어요. 홈에서 오늘 할 일을 확인하세요.</Notice>}
      {!user && (
        <Notice tone="info" icon="bookmark">
          비회원 미리보기예요. 완료 기록과 재배분을 쓰려면{' '}
          <button type="button" className="link-btn" onClick={() => setPrompt(true)}>
            가입하고 저장
          </button>
          하세요.
        </Notice>
      )}
      {(plan.warnings || []).map((w) => (
        <Notice key={w.code} tone={w.code === 'TIME_SHORTAGE' || w.code === 'UNSCHEDULED_UNITS' ? 'warn' : 'info'}>
          {w.message}
        </Notice>
      ))}
      <ErrorBox error={actionErr} />

      <div className="cal-toolbar">
        <div className="seg seg-sm" role="radiogroup" aria-label="보기 방식">
          {[
            ['month', '월간'],
            ['week', '주간'],
          ].map(([v, l]) => (
            <label key={v} className={`seg-item ${view === v ? 'on' : ''}`}>
              <input type="radio" name="view" checked={view === v} onChange={() => setView(v)} />
              {l}
            </label>
          ))}
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="이전">
            ‹
          </button>
          <strong aria-live="polite">{view === 'month' ? `${range.year}년 ${range.month}월` : `${formatDate(range.from, false)} ~ ${formatDate(range.to, false)}`}</strong>
          <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="다음">
            ›
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setAnchor(today); setSelected(today); }}>
            오늘
          </button>
        </div>
        <span className="legend">
          <i className="lg lg-review" /> 총정리 기간
        </span>
      </div>

      {tasksQ.loading && <Loading />}
      <div className={`calendar ${view}`} role="grid" aria-label="학습 캘린더">
        <div className="cal-row cal-head" role="row">
          {DAYS.map((d) => (
            <div key={d} role="columnheader">
              {d}
            </div>
          ))}
        </div>
        <div className="cal-body">
          {range.days.map((d) => {
            const list = byDate[d] || [];
            const minutes = list.reduce((a, t) => a + t.minutes, 0);
            const done = list.filter((t) => t.done).length;
            const outMonth = view === 'month' && Number(d.slice(5, 7)) !== range.month;
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-selected={selected === d}
                className={`cal-cell ${outMonth ? 'out' : ''} ${d === today ? 'today' : ''} ${selected === d ? 'sel' : ''} ${isReview(d) ? 'review' : ''} ${d === plan.examDate ? 'exam' : ''}`}
                onClick={() => setSelected(d)}
                aria-label={`${formatDate(d)}${list.length ? `, 과제 ${list.length}건 ${minutesLabel(minutes)}, 완료 ${done}건` : ', 과제 없음'}${d === plan.examDate ? ', 시험일' : ''}`}
              >
                <span className="cal-date">{Number(d.slice(8))}</span>
                {d === plan.examDate && <span className="cal-exam">시험</span>}
                {list.length > 0 && (
                  <>
                    <span className="cal-min">{minutes < 60 ? `${minutes}분` : `${Math.round((minutes / 60) * 10) / 10}h`}</span>
                    <span className="cal-items">
                      {list.slice(0, view === 'week' ? 6 : 2).map((t) => (
                        <span key={t.id} className={`cal-item ${t.done ? 'done' : ''} ${t.type}`}>
                          {t.title}
                        </span>
                      ))}
                      {list.length > (view === 'week' ? 6 : 2) && <span className="cal-more">+{list.length - (view === 'week' ? 6 : 2)}</span>}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="section" aria-labelledby="day-h">
        <div className="section-head">
          <h2 id="day-h">{formatDate(selected)} 과제</h2>
          {selectedTasks.length > 0 && <span className="muted">{minutesLabel(selectedTasks.reduce((a, t) => a + t.minutes, 0))}</span>}
        </div>
        {selectedTasks.length ? (
          <TaskList tasks={selectedTasks} readOnly={selected < today} onChange={updateTask} onRequireLogin={!user ? () => setPrompt(true) : undefined} />
        ) : (
          <p className="muted">이 날은 배정된 과제가 없어요.</p>
        )}
        {selected < today && selectedTasks.length > 0 && <p className="muted small">지난 날짜의 과제는 수정할 수 없어요. 미완료 과제는 다음 접속 때 남은 학습일로 옮겨집니다.</p>}
      </section>
      <SignupPrompt open={prompt} onClose={() => setPrompt(false)} />
    </div>
  );
}

// UC-03 학습 스케줄 조회(월간·주간 캘린더)·조건 수정·재생성
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, apiWithConfirm } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { loadGuest } from '../lib/guest';
import { DAYS, dayOfWeek, ddayLabel, formatDate, minutesLabel, monthGrid, todayKST, weekRange, addDays, EXAM_TYPE, diffDays } from '../lib/format';
import { EmptyState, ErrorBox, Loading, Notice, PageHeader } from '../components/ui';
import { TaskList } from '../components/StudyCards';
import SignupPrompt from '../components/SignupPrompt';

function moveCalendarDate(date, direction, view) {
  if (view === 'week') return addDays(date, direction * 7);
  const [year, month, day] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + direction, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(year, month + direction, 0)).getUTCDate();
  return `${first.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
}

function dayStatus(date, tasks, plan, today) {
  if (tasks.length) {
    const done = tasks.filter((task) => task.done).length;
    if (done === tasks.length) return `완료 ${done}건`;
    const state = date < today ? '미완료' : date > today ? '예정' : '남음';
    return `완료 ${done}/${tasks.length} · ${state} ${tasks.length - done}건`;
  }
  if (date === plan.examDate) return '시험일';
  if (date < plan.createdDate || date > plan.examDate) return '계획 범위 밖';
  if (Array.isArray(plan.studyDays) && !plan.studyDays.includes(dayOfWeek(date))) return '휴식일';
  return '과제 없음';
}

function calendarKeyDate(key, date, view) {
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (Object.hasOwn(offsets, key)) return addDays(date, offsets[key]);
  if (key === 'Home') return addDays(date, -dayOfWeek(date));
  if (key === 'End') return addDays(date, 6 - dayOfWeek(date));
  if (key === 'PageUp' || key === 'PageDown') return moveCalendarDate(date, key === 'PageUp' ? -1 : 1, view);
  return null;
}

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
  const dateButtons = useRef(new Map());
  const focusDate = useRef(null);

  useEffect(() => {
    if (focusDate.current) {
      dateButtons.current.get(focusDate.current)?.focus();
      focusDate.current = null;
    }
  }, [selected, anchor, view]);

  const range = useMemo(() => (view === 'month' ? monthGrid(anchor) : weekRange(anchor)), [view, anchor]);
  const planQ = useApi(user ? () => api('/api/plans/current') : null, [user]);
  const rangeKey = `${user?.uid || ''}:${range.from}:${range.to}`;
  const tasksQ = useApi(user ? async () => {
    try {
      const data = await api(`/api/plans/tasks?from=${range.from}&to=${range.to}`);
      return { ...data, rangeKey };
    } catch (error) {
      error.rangeKey = rangeKey;
      throw error;
    }
  } : null, [user, range.from, range.to]);

  const guest = !user ? loadGuest() : null;
  const plan = user ? planQ.data?.plan : guest?.plan && { ...guest.plan, dday: diffDays(today, guest.plan.examDate) };
  const taskError = tasksQ.error?.rangeKey === rangeKey ? tasksQ.error : null;
  const tasksLoading = !!user && !taskError && (tasksQ.loading || tasksQ.data?.rangeKey !== rangeKey);
  const tasksReady = !user || (!tasksLoading && !taskError);
  const tasks = user ? tasksReady ? tasksQ.data?.items || [] : [] : (guest?.tasks || []).filter((t) => t.date >= range.from && t.date <= range.to);

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
      <div className="schedule-page">
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

  function selectDate(date) {
    setSelected(date);
    setAnchor(date);
  }
  const move = (dir) => selectDate(moveCalendarDate(selected, dir, view));
  function changeView(value) {
    setView(value);
    setAnchor(selected);
  }
  function handleDateKey(event, date) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = calendarKeyDate(event.key, date, view);
    if (!next) return;
    event.preventDefault();
    if (next !== date) focusDate.current = next;
    selectDate(next);
  }
  const selectedTasks = byDate[selected] || [];
  const selectedStatus = tasksReady ? dayStatus(selected, selectedTasks, plan, today) : '';
  const emptyMessage = selectedStatus === '휴식일' ? '설정한 학습 요일이 아닌 휴식일이에요.'
    : selectedStatus === '계획 범위 밖' ? '학습 계획 기간에 포함되지 않은 날짜예요.'
      : selected === plan.examDate ? '시험일이에요. 시험 준비 사항을 확인하세요.' : '이 날은 배정된 과제가 없어요.';
  const isReview = (d) => plan.reviewStartDate && d >= plan.reviewStartDate && d < plan.examDate;
  const updateTask = (t) => tasksQ.setData((prev) => ({ ...prev, items: prev.items.map((x) => (x.id === t.id ? t : x)) }));

  return (
    <div className="stack schedule-page">
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
              <input type="radio" name="view" checked={view === v} onChange={() => changeView(v)} />
              {l}
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-ghost cal-today" onClick={() => selectDate(today)}>
          오늘로
        </button>
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label={view === 'month' ? '이전 달' : '이전 주'}>
            ‹
          </button>
          <strong id="calendar-period" aria-live="polite">
            {view === 'month' ? `${range.year}년 ${range.month}월` : (
              <>
                <span className="cal-year">{range.from.slice(0, 4)}{range.from.slice(0, 4) !== range.to.slice(0, 4) && ` ~ ${range.to.slice(0, 4)}`}년</span>
                <span>{formatDate(range.from, false)} ~ {formatDate(range.to, false)}</span>
              </>
            )}
          </strong>
          <button type="button" className="icon-btn" onClick={() => move(1)} aria-label={view === 'month' ? '다음 달' : '다음 주'}>
            ›
          </button>
        </div>
      </div>
      <div className="cal-legend">
        <span className="legend"><i className="lg lg-today" /> 오늘</span>
        <span className="legend"><i className="lg lg-selected" /> 선택 날짜</span>
        <span className="legend">완료/전체</span>
        <span className="legend">
          <i className="lg lg-review" /> 총정리 기간
        </span>
      </div>

      <ErrorBox error={taskError} onRetry={tasksQ.reload} />
      {tasksLoading && <p className="muted small" role="status">과제를 불러오는 중이에요.</p>}
      <div className={`calendar ${view}`} role="grid" aria-label="학습 캘린더" aria-describedby="calendar-period" aria-busy={tasksLoading}>
        <div className="cal-row cal-head" role="row">
          {DAYS.map((d) => (
            <div key={d} role="columnheader">
              {d}
            </div>
          ))}
        </div>
        <div className="cal-body" role="rowgroup">
          {Array.from({ length: range.days.length / 7 }, (_, week) => (
            <div key={range.days[week * 7]} className="cal-week-row" role="row">
              {range.days.slice(week * 7, week * 7 + 7).map((d) => {
                const list = byDate[d] || [];
                const minutes = list.reduce((a, t) => a + t.minutes, 0);
                const done = list.filter((t) => t.done).length;
                const outMonth = view === 'month' && Number(d.slice(5, 7)) !== range.month;
                const status = tasksReady ? dayStatus(d, list, plan, today) : taskError ? '과제 조회 실패' : '과제 조회 중';
                const state = done === list.length ? '완료' : d < today ? '미완료' : d > today ? '' : '남음';
                return (
                  <div key={d} className="cal-day" role="gridcell" aria-selected={selected === d}>
                    <button
                      type="button"
                      ref={(element) => { if (element) dateButtons.current.set(d, element); else dateButtons.current.delete(d); }}
                      tabIndex={selected === d ? 0 : -1}
                      aria-pressed={selected === d}
                      aria-current={d === today ? 'date' : undefined}
                      className={`cal-cell ${outMonth ? 'out' : ''} ${d === today ? 'today' : ''} ${selected === d ? 'sel' : ''} ${isReview(d) ? 'review' : ''} ${d === plan.examDate ? 'exam' : ''}`}
                      onClick={() => { if (d !== selected) focusDate.current = d; selectDate(d); }}
                      onKeyDown={(event) => handleDateKey(event, d)}
                      aria-label={`${d.slice(0, 4)}년 ${formatDate(d)}${d === today ? ', 오늘' : ''}, ${status}${list.length ? `, ${minutesLabel(minutes)}` : ''}${d === plan.examDate && list.length ? ', 시험일' : ''}`}
                    >
                      <span className="cal-date">{Number(d.slice(8))}</span>
                      {d === plan.examDate && <span className="cal-exam">시험</span>}
                      {list.length > 0 && (
                        <>
                          <span className="cal-min">{minutes < 60 ? `${minutes}분` : `${Math.round((minutes / 60) * 10) / 10}h`}</span>
                          <span className="cal-count" aria-hidden="true">{done}/{list.length}</span>
                          {state && <span className={`cal-state ${done === list.length ? 'complete' : ''}`} aria-hidden="true">{state}</span>}
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
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <section className="section" aria-labelledby="day-h">
        <div className="section-head">
          <h2 id="day-h">{selected.slice(0, 4)}년 {formatDate(selected)} 과제{selected === today && <span className="tag tag-teal">오늘</span>}</h2>
          {tasksReady && <span className="muted" aria-live="polite">{selectedStatus}{selectedTasks.length > 0 && ` · ${minutesLabel(selectedTasks.reduce((a, t) => a + t.minutes, 0))}`}</span>}
        </div>
        {tasksLoading ? <Loading lines={3} /> : taskError ? <p className="muted">과제 조회 실패</p> : selectedTasks.length ? (
          <TaskList tasks={selectedTasks} readOnly={selected < today} onChange={updateTask} onRequireLogin={!user ? () => setPrompt(true) : undefined} />
        ) : (
          <p className="muted">{emptyMessage}</p>
        )}
        {selected < today && selectedTasks.length > 0 && <p className="muted small">지난 날짜의 과제는 수정할 수 없어요. 미완료 과제는 다음 접속 때 남은 학습일로 옮겨집니다.</p>}
      </section>
      <SignupPrompt open={prompt} onClose={() => setPrompt(false)} />
    </div>
  );
}

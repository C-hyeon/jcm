// UC-02 시험 정보 및 학습 조건 입력
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiWithConfirm } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { loadGuest, saveGuest } from '../lib/guest';
import { CONFIDENCE, DAYS, ddayLabel, diffDays, EXAM_TYPE, formatDate, minutesLabel, STAGE, STAGE_DESC, todayKST, addDays } from '../lib/format';
import { ErrorBox, Loading, Notice, PageHeader } from '../components/ui';

const STEPS = ['시험 정보', '학습 시간', '학습 단계', '과목별 진도·자신감'];
const MIN_PREP_DAYS = 30; // 새 시험일의 최소 준비 기간 (서버에서도 같은 기준으로 검증)
const hoursLabel = (m) => `${Math.round(m / 6) / 10}시간`;

export default function Onboarding() {
  const { user, me, refreshMe } = useAuth();
  // 레벨테스트 결과(추천 단계·과목별 자신감)는 새 학습 계획의 기본값으로 쓴다
  const levelTest = me && me.uid === user?.uid ? me.levelTest : null;
  const navigate = useNavigate();
  const today = todayKST();
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState(null);
  const pending = useRef(false);
  const attempt = useRef(null);
  const mounted = useRef(true);
  const owner = useRef(user?.uid || null);
  const levelPrefilled = useRef(false);
  owner.current = user?.uid || null;
  const [form, setForm] = useState({
    examType: 'written',
    examId: '',
    customDate: '',
    dailyHours: 2,
    studyDays: [1, 2, 3, 4, 5],
    stage: 'intro',
    subjectProgress: {},
    subjectConfidence: {},
  });
  const exams = useApi(() => api('/api/exams'), []);
  const subjects = useApi(() => api(`/api/subjects?examType=${form.examType}`), [form.examType]);
  const existing = useApi(user ? () => api('/api/study-profile') : null, [user]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const p = existing.data?.profile;
    if (!p) {
      if (levelTest && existing.data && !levelPrefilled.current) {
        levelPrefilled.current = true;
        setForm((f) => ({ ...f, stage: levelTest.recommendedStage, subjectConfidence: { ...levelTest.subjectConfidence } }));
      }
      return;
    }
    setForm({
      examType: p.examType,
      examId: p.examId || '',
      customDate: p.examId ? '' : p.examDate,
      dailyHours: p.dailyHours,
      studyDays: p.studyDays,
      stage: p.stage,
      subjectProgress: p.subjectProgress || {},
      subjectConfidence: p.subjectConfidence || {},
    });
  }, [existing.data, levelTest]);

  const examOptions = useMemo(() => (exams.data?.items || []).filter((e) => e.type === form.examType), [exams.data, form.examType]);
  const examDate = form.examId ? examOptions.find((e) => e.id === form.examId)?.examDate : form.customDate;
  const dday = examDate ? diffDays(today, examDate) : null;
  const subjectItems = !subjects.loading && !subjects.error ? subjects.data?.items || [] : [];
  const subjectError = subjects.error || (!subjects.loading && !subjectItems.length ? { message: '과목 정보가 없어요. 다시 불러와 주세요.' } : null);
  const refreshOnly = saveStage === 'refresh' && !!attempt.current?.planCreated && attempt.current.owner === (user?.uid || null);
  const fieldsLocked = saving || refreshOnly;
  const submitDisabled = saving || (!refreshOnly && (!subjectItems.length || (form.examId && (exams.loading || !!exams.error))));
  const savedExamDate = existing.data?.profile?.examDate;
  const tooSoon = dday != null && dday > 0 && dday < MIN_PREP_DAYS && examDate !== savedExamDate;

  // 하루 필요 학습 시간: 남은 학습량·학습일 계산은 서버(단원 표준 시간·진도 반영)에서 한다.
  // 학습 시간 단계와 마지막 단계에서만, 입력이 잠시 멈췄을 때 계산한다.
  const hoursValid = Number.isInteger(Number(form.dailyHours) * 2) && form.dailyHours >= 0.5 && form.dailyHours <= 12;
  const estimateBody =
    (step === 1 || step === 3) && dday > 0 && !tooSoon && hoursValid && form.studyDays.length > 0 && subjectItems.length > 0 ? JSON.stringify(buildProfile()) : null;
  const estimateLatest = useRef(null);
  estimateLatest.current = estimateBody;
  const estimate = useApi(
    estimateBody
      ? async () => {
          await new Promise((r) => setTimeout(r, 350));
          if (estimateLatest.current !== estimateBody) throw new Error('stale');
          return api('/api/plans/estimate', { method: 'POST', body: JSON.parse(estimateBody) });
        }
      : null,
    [estimateBody],
  );

  // 서버로 보내는 학습 조건 (저장·미리보기·하루 필요 시간 계산에 같이 사용)
  function buildProfile() {
    return {
      examType: form.examType,
      examId: form.examId || null,
      examDate,
      dailyHours: Number(form.dailyHours),
      studyDays: [...form.studyDays],
      stage: form.stage,
      subjectProgress: Object.fromEntries(subjectItems.map((s) => [s.id, Number(form.subjectProgress[s.id] ?? 0)])),
      subjectConfidence: Object.fromEntries(subjectItems.map((s) => [s.id, Number(form.subjectConfidence[s.id] ?? 2)])),
    };
  }

  function set(patch) {
    if (pending.current || refreshOnly) return;
    attempt.current = null;
    setSaveStage(null);
    setError(null);
    setForm((f) => ({ ...f, ...patch }));
  }

  function validateStep(at = step) {
    if (at === 0) {
      if (!EXAM_TYPE[form.examType]) return '시험 구분을 선택해 주세요.';
      if (form.examId && (exams.loading || exams.error)) return '시험 회차 정보를 불러온 뒤 다시 시도해 주세요.';
      if (!examDate) return '시험 회차를 선택하거나 시험일을 입력해 주세요.';
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || addDays(examDate, 0) !== examDate) return '올바른 시험일을 입력해 주세요.';
      } catch {
        return '올바른 시험일을 입력해 주세요.';
      }
      if (examDate <= today) return '시험일은 내일 이후 날짜여야 합니다.';
      // 최소 30일 준비 기간. 이미 저장한 시험일을 그대로 두고 다른 조건만 바꿀 때는 허용
      if (examDate < addDays(today, 30) && examDate !== existing.data?.profile?.examDate) {
        return '시험일까지 최소 30일의 준비 기간이 필요해요. 다음 회차를 선택하거나 시험일을 다시 입력해 주세요.';
      }
    }
    if (at === 1) {
      const hours = Number(form.dailyHours);
      if (!Number.isFinite(hours) || hours < 0.5 || hours > 12 || !Number.isInteger(hours * 2)) return '하루 학습 시간은 30분부터 12시간까지, 30분 단위로 선택해 주세요.';
      if (!form.studyDays.length) return '학습 요일을 하루 이상 선택해 주세요.';
      if (form.studyDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return '학습 요일을 다시 선택해 주세요.';
    }
    if (at === 2 && !STAGE[form.stage]) return '현재 학습 단계를 선택해 주세요.';
    if (at === 3) {
      if (!subjectItems.length) return '과목 정보를 불러온 뒤 다시 시도해 주세요.';
      for (const subject of subjectItems) {
        const progress = Number(form.subjectProgress[subject.id] ?? 0);
        const confidence = Number(form.subjectConfidence[subject.id] ?? 2);
        if (!Number.isFinite(progress) || progress < 0 || progress > 100) return '과목별 진도를 0%부터 100% 사이로 선택해 주세요.';
        if (![1, 2, 3].includes(confidence)) return '과목별 자신감을 다시 선택해 주세요.';
      }
    }
    return null;
  }
  function nextStep() {
    if (pending.current || refreshOnly) return;
    const v = validateStep();
    if (v) return setError({ message: v });
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function previousStep() {
    if (pending.current || refreshOnly) return;
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    if (pending.current || existing.loading || existing.error) return;
    if (!refreshOnly) {
      for (let i = 0; i < STEPS.length; i++) {
        const message = validateStep(i);
        if (message) {
          setStep(i);
          setError({ message });
          return;
        }
      }
    }
    if (!attempt.current || attempt.current.owner !== (user?.uid || null)) {
      attempt.current = {
        owner: user?.uid || null,
        profile: buildProfile(),
        profileSaved: false,
        planCreated: false,
        preview: null,
      };
    }
    const current = attempt.current;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      // 응답으로 성공을 확인한 단계는 재시도할 때 다시 실행하지 않는다.
      if (user) {
        if (!current.profileSaved) {
          setSaveStage('profile');
          await api('/api/study-profile', { method: 'PUT', body: current.profile });
          current.profileSaved = true;
          if (!mounted.current || owner.current !== current.owner) return;
        }
        if (!current.planCreated) {
          setSaveStage('plan');
          await apiWithConfirm('/api/plans', { body: {}, confirmKey: 'confirmOverwrite' });
          current.planCreated = true;
          if (!mounted.current || owner.current !== current.owner) return;
        }
        setSaveStage('refresh');
        await refreshMe();
      } else {
        if (!current.preview) {
          setSaveStage('preview');
          current.preview = await api('/api/plans/preview', { method: 'POST', body: current.profile });
          if (!mounted.current || owner.current !== current.owner) return;
        }
        setSaveStage('guest');
        const data = { profile: current.profile, plan: current.preview.plan, tasks: current.preview.tasks };
        saveGuest(data);
        const stored = loadGuest();
        if (!stored || JSON.stringify({ profile: stored.profile, plan: stored.plan, tasks: stored.tasks }) !== JSON.stringify(data)) {
          throw new Error('미리보기를 브라우저에 보관하지 못했어요. 브라우저의 저장 공간 설정을 확인한 뒤 다시 시도해 주세요.');
        }
      }
      if (mounted.current && owner.current === current.owner) navigate('/schedule', { state: { created: true } });
    } catch (e) {
      if (mounted.current && owner.current === current.owner && !(e.status === 409 && e.code === 'PLAN_EXISTS')) setError(e);
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  if (existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={{ ...existing.error, message: '기존 학습 조건을 불러오지 못했어요. 다시 시도해 주세요.' }} onRetry={existing.reload} />;

  return (
    <div className="onboarding">
      <PageHeader title="학습 계획 만들기" desc="4단계, 약 1분이면 끝나요. 입력한 조건은 언제든 바꿀 수 있어요." />
      <ol className="stepper" aria-label="진행 단계">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{s}</span>
          </li>
        ))}
      </ol>

      <div className="card">
        <fieldset className="onboarding-fields" disabled={fieldsLocked} aria-label="학습 조건 입력" aria-busy={saving}>
        {step === 0 && (
          <fieldset className="form">
            <legend className="h2">어떤 시험을 준비하나요?</legend>
            {exams.loading && <Loading lines={1} label="시험 회차를 불러오는 중" />}
            <ErrorBox error={exams.error} onRetry={exams.reload} />
            <div className="seg" role="radiogroup" aria-label="시험 구분">
              {['written', 'practical'].map((t) => (
                <label key={t} className={`seg-item ${form.examType === t ? 'on' : ''}`}>
                  <input type="radio" name="examType" checked={form.examType === t} onChange={() => set({ examType: t, examId: '', subjectProgress: {}, subjectConfidence: { ...(levelTest?.subjectConfidence || {}) } })} />
                  {EXAM_TYPE[t]}
                </label>
              ))}
            </div>
            <label className="field">
              <span>시험 회차</span>
              <select value={form.examId} disabled={exams.loading || !!exams.error} onChange={(e) => set({ examId: e.target.value, customDate: '' })}>
                <option value="">목록에 없음 (시험일 직접 입력)</option>
                {form.examId && !examOptions.some((e) => e.id === form.examId) && <option value={form.examId} disabled>이전 시험 회차 (다시 선택해 주세요)</option>}
                {examOptions.map((e) => {
                  const short = e.examDate < addDays(today, MIN_PREP_DAYS) && e.examDate !== savedExamDate;
                  return (
                    <option key={e.id} value={e.id} disabled={short}>
                      {e.year}년 {e.round}회 {EXAM_TYPE[e.type]} — {formatDate(e.examDate)}
                      {short ? ' (준비 기간 30일 미만)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            {!form.examId && (
              <label className="field">
                <span>시험일</span>
                <input type="date" min={addDays(today, MIN_PREP_DAYS)} value={form.customDate} onChange={(e) => set({ customDate: e.target.value })} />
              </label>
            )}
            {dday != null && dday > 0 && (
              <p className="dday-inline">
                시험까지 <strong>{ddayLabel(dday)}</strong> ({formatDate(examDate)})
              </p>
            )}
            <p className="muted small">최소 {MIN_PREP_DAYS}일의 준비 기간을 두고 계획을 만들어요.</p>
            {tooSoon && <Notice tone="warn">시험까지 {dday}일 남았어요. 최소 {MIN_PREP_DAYS}일의 준비 기간이 필요해서 다음 회차를 선택하거나 시험일을 다시 입력해 주세요.</Notice>}
            {!tooSoon && dday != null && dday > 0 && dday < 7 && <Notice tone="warn">남은 기간이 7일 미만이에요. 핵심 단원과 기출 위주의 총정리 모드로 계획을 만듭니다.</Notice>}
          </fieldset>
        )}

        {step === 1 && (
          <div className="form">
            <h2>하루에 얼마나 공부할 수 있나요?</h2>
            <label className="field">
              <span>
                하루 학습 가능 시간: <strong>{Number(form.dailyHours).toFixed(1)}시간</strong>
              </span>
              <input type="range" min="0.5" max="12" step="0.5" value={form.dailyHours} onChange={(e) => set({ dailyHours: Number(e.target.value) })} aria-valuetext={`${form.dailyHours}시간`} />
            </label>
            <fieldset className="field">
              <legend>학습 요일</legend>
              <div className="day-picker">
                {DAYS.map((d, i) => (
                  <label key={d} className={`day ${form.studyDays.includes(i) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={form.studyDays.includes(i)}
                      onChange={(e) => set({ studyDays: e.target.checked ? [...form.studyDays, i].sort() : form.studyDays.filter((x) => x !== i) })}
                    />
                    {d}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="muted small">
              주 {form.studyDays.length}일 × {form.dailyHours}시간 = 주당 {(form.studyDays.length * form.dailyHours).toFixed(1)}시간
            </p>
            <EstimatePanel
              estimate={estimate}
              dailyHours={form.dailyHours}
              onHours={(h) => set({ dailyHours: h })}
              onDays={(days) => set({ studyDays: days })}
              note="다음 단계에서 학습 단계·과목별 진도를 입력하면 마지막 단계에서 다시 계산해요."
            />
          </div>
        )}

        {step === 2 && (
          <fieldset className="form">
            <legend className="h2">지금 어느 단계인가요?</legend>
            {levelTest ? (
              <Notice tone="info" icon="spark">
                레벨테스트 결과 <strong>{levelTest.levelLabel}</strong>(정답률 {levelTest.rate}%) 기준으로 <strong>{STAGE[levelTest.recommendedStage]}</strong> 단계를 추천해요.
                {form.stage !== levelTest.recommendedStage && (
                  <div className="alert-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => set({ stage: levelTest.recommendedStage, subjectConfidence: { ...form.subjectConfidence, ...levelTest.subjectConfidence } })}
                    >
                      추천 단계·자신감 적용
                    </button>
                  </div>
                )}
              </Notice>
            ) : (
              user && (
                <p className="muted small">
                  어느 단계인지 모르겠다면 <Link to="/level-test?next=%2Fonboarding">레벨테스트</Link>로 확인해 보세요.
                </p>
              )
            )}
            <div className="option-list">
              {Object.keys(STAGE).map((s) => (
                <label key={s} className={`option ${form.stage === s ? 'on' : ''}`}>
                  <input type="radio" name="stage" checked={form.stage === s} onChange={() => set({ stage: s })} />
                  <span>
                    <strong>{STAGE[s]}</strong>
                    <small>{STAGE_DESC[s]}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {step === 3 && (
          <div className="form">
            <h2>과목별로 얼마나 해 두었나요?</h2>
            <p className="muted small">진도는 이미 공부한 비율, 자신감은 체감 이해도예요. 자신감이 낮은 과목에 시간을 더 배분합니다.</p>
            {levelTest && <p className="muted small">자신감 기본값은 레벨테스트 과목별 정답률로 채웠어요. 직접 바꿀 수 있어요.</p>}
            {subjects.loading && <Loading />}
            <ErrorBox error={subjectError} onRetry={subjects.reload} />
            <ul className="subject-inputs">
              {subjectItems.map((s) => {
                const p = form.subjectProgress[s.id] ?? 0;
                const c = form.subjectConfidence[s.id] ?? 2;
                return (
                  <li key={s.id}>
                    <div className="si-head">
                      <strong>{s.name}</strong>
                      <span className="sb-val">{p}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={p}
                      aria-label={`${s.name} 진도`}
                      onChange={(e) => set({ subjectProgress: { ...form.subjectProgress, [s.id]: Number(e.target.value) } })}
                    />
                    <div className="conf-row">
                      <span className="muted small" aria-hidden>
                        자신감
                      </span>
                      <div className="seg seg-sm" role="radiogroup" aria-label={`${s.name} 자신감`}>
                        {[1, 2, 3].map((v) => (
                          <label key={v} className={`seg-item ${c === v ? 'on' : ''}`}>
                            <input type="radio" name={`conf-${s.id}`} checked={c === v} onChange={() => set({ subjectConfidence: { ...form.subjectConfidence, [s.id]: v } })} />
                            {CONFIDENCE[v]}
                          </label>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <EstimatePanel
              estimate={estimate}
              dailyHours={form.dailyHours}
              onHours={(h) => set({ dailyHours: h })}
              onDays={(days) => set({ studyDays: days })}
              onEditDays={() => setStep(1)}
            />
          </div>
        )}

        </fieldset>
        {saving && <p className="muted small" role="status">{saveStage === 'profile' ? '학습 조건 저장 중…' : saveStage === 'refresh' ? '사용자 정보 확인 중…' : saveStage === 'guest' ? '미리보기 보관 중…' : '스케줄 만드는 중…'}</p>}
        {!saving && saveStage === 'plan' && attempt.current?.profileSaved && <Notice tone="warn">학습 조건은 저장됐어요. 스케줄 생성은 아직 완료 여부를 확인하지 못했어요. 다시 시도하면 기존 일정 변경 확인이 나올 수 있어요.</Notice>}
        {!saving && refreshOnly && <Notice tone="info">스케줄은 만들어졌어요. 사용자 정보를 다시 불러오면 스케줄로 이동해요.</Notice>}
        <ErrorBox error={error} onRetry={!saving && saveStage ? submit : undefined} />
        <div className="row-between">
          <button type="button" className="btn btn-ghost" onClick={previousStep} disabled={step === 0 || fieldsLocked}>
            이전
          </button>
          {step < STEPS.length - 1 ? (
            <button key={`next-${step}`} type="button" className="btn btn-primary" onClick={nextStep} disabled={fieldsLocked}>
              다음
            </button>
          ) : (
            <button key="submit" type="button" className="btn btn-primary" onClick={submit} disabled={submitDisabled}>
              {saving ? '스케줄 만드는 중…' : refreshOnly ? '사용자 정보 다시 불러오기' : saveStage === 'plan' && attempt.current?.profileSaved ? '스케줄 생성 다시 시도' : user ? '저장하고 스케줄 만들기' : '스케줄 미리보기'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 하루 필요 학습 시간 안내 — 서버 계산 결과(/api/plans/estimate)를 보여 주고, 부족하면 시간·요일 조정을 제안한다.
function EstimatePanel({ estimate, dailyHours, onHours, onDays, onEditDays, note }) {
  const e = estimate.data;
  if (estimate.loading) return <p className="muted small" role="status">남은 학습량으로 하루 필요 시간을 계산하는 중…</p>;
  if (estimate.error) {
    return (
      <p className="muted small">
        하루 필요 시간을 계산하지 못했어요.{' '}
        <button type="button" className="link-btn" onClick={estimate.reload}>
          다시 계산
        </button>
      </p>
    );
  }
  if (!e || typeof e.studyDayCount !== 'number') return null;
  if (e.recommendedDailyHours === 0) {
    return (
      <Notice tone="success" icon="check">
        모든 단원을 마쳐 남은 기간은 총정리로 배정돼요.
      </Notice>
    );
  }

  const summary = (
    <p>
      남은 학습량 <strong>{hoursLabel(e.learnMinutes)}</strong>
      {e.reviewMinutes != null && (
        <>
          {' '}+ 총정리 {hoursLabel(e.reviewMinutes)} = 총 <strong>{hoursLabel(e.totalMinutes)}</strong>
        </>
      )}{' '}
      · 학습일 <strong>{e.studyDayCount}일</strong>(총정리 {e.reviewDayCount}일 포함)
      <br />
      {e.recommendedDailyHours != null ? (
        <>
          → 하루 <strong>{e.recommendedDailyHours}시간</strong> 학습을 권장해요.
        </>
      ) : (
        '→ 선택한 요일로는 하루 12시간을 넘게 공부해야 해요.'
      )}
    </p>
  );

  if (e.enough) {
    return (
      <Notice tone="success" icon="check">
        {summary}
        선택한 하루 {dailyHours}시간이면 충분해요.
        {note && <span className="muted small"> {note}</span>}
      </Notice>
    );
  }

  const sh = e.shortage;
  return (
    <Notice tone="warn" icon="clock">
      {summary}
      선택한 하루 {dailyHours}시간으로는
      {sh.dailyMinutes != null ? (
        <>
          {' '}하루 {minutesLabel(sh.dailyMinutes)}, 시험일까지 총 <strong>{hoursLabel(sh.totalMinutes)}</strong>이 부족해요.
        </>
      ) : (
        ' 시간이 부족해요.'
      )}{' '}
      하루 학습 시간이나 학습 요일을 조정해 주세요.
      {!sh.byDays && sh.everyDay && <> 학습 요일을 모두 써도 하루 {sh.everyDay}시간이 필요해요.</>}
      <div className="alert-actions">
        {sh.byHours != null && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => onHours(sh.byHours)}>
            하루 {sh.byHours}시간으로 맞추기
          </button>
        )}
        {sh.byDays && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => onDays(sh.byDays.studyDays)}>
            {sh.byDays.addedDays.map((d) => DAYS[d]).join('·')}요일 추가하기
          </button>
        )}
        {!sh.byDays && sh.everyDay && (
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => {
              onDays([0, 1, 2, 3, 4, 5, 6]);
              onHours(sh.everyDay);
            }}
          >
            매일 {sh.everyDay}시간으로 맞추기
          </button>
        )}
        {onEditDays && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onEditDays}>
            학습 시간 단계로 이동
          </button>
        )}
      </div>
      {note && <span className="muted small">{note}</span>}
    </Notice>
  );
}

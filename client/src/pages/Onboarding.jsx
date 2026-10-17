// UC-02 시험 정보 및 학습 조건 입력
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiWithConfirm } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { loadGuest, saveGuest } from '../lib/guest';
import { CONFIDENCE, DAYS, ddayLabel, diffDays, EXAM_TYPE, formatDate, STAGE, STAGE_DESC, todayKST, addDays } from '../lib/format';
import { ErrorBox, Loading, Notice, PageHeader } from '../components/ui';

const STEPS = ['시험 정보', '학습 시간', '학습 단계', '과목별 진도·자신감'];

export default function Onboarding() {
  const { user, refreshMe } = useAuth();
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
    if (!p) return;
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
  }, [existing.data]);

  const examOptions = useMemo(() => (exams.data?.items || []).filter((e) => e.type === form.examType), [exams.data, form.examType]);
  const examDate = form.examId ? examOptions.find((e) => e.id === form.examId)?.examDate : form.customDate;
  const dday = examDate ? diffDays(today, examDate) : null;
  const subjectItems = !subjects.loading && !subjects.error ? subjects.data?.items || [] : [];
  const subjectError = subjects.error || (!subjects.loading && !subjectItems.length ? { message: '과목 정보가 없어요. 다시 불러와 주세요.' } : null);
  const refreshOnly = saveStage === 'refresh' && !!attempt.current?.planCreated && attempt.current.owner === (user?.uid || null);
  const fieldsLocked = saving || refreshOnly;
  const submitDisabled = saving || (!refreshOnly && (!subjectItems.length || (form.examId && (exams.loading || !!exams.error))));

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
        profile: {
          examType: form.examType,
          examId: form.examId || null,
          examDate,
          dailyHours: Number(form.dailyHours),
          studyDays: [...form.studyDays],
          stage: form.stage,
          subjectProgress: Object.fromEntries(subjectItems.map((s) => [s.id, Number(form.subjectProgress[s.id] ?? 0)])),
          subjectConfidence: Object.fromEntries(subjectItems.map((s) => [s.id, Number(form.subjectConfidence[s.id] ?? 2)])),
        },
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
                  <input type="radio" name="examType" checked={form.examType === t} onChange={() => set({ examType: t, examId: '', subjectProgress: {}, subjectConfidence: {} })} />
                  {EXAM_TYPE[t]}
                </label>
              ))}
            </div>
            <label className="field">
              <span>시험 회차</span>
              <select value={form.examId} disabled={exams.loading || !!exams.error} onChange={(e) => set({ examId: e.target.value, customDate: '' })}>
                <option value="">목록에 없음 (시험일 직접 입력)</option>
                {form.examId && !examOptions.some((e) => e.id === form.examId) && <option value={form.examId} disabled>이전 시험 회차 (다시 선택해 주세요)</option>}
                {examOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.year}년 {e.round}회 {EXAM_TYPE[e.type]} — {formatDate(e.examDate)}
                  </option>
                ))}
              </select>
            </label>
            {!form.examId && (
              <label className="field">
                <span>시험일</span>
                <input type="date" min={addDays(today, 1)} value={form.customDate} onChange={(e) => set({ customDate: e.target.value })} />
              </label>
            )}
            {dday != null && dday > 0 && (
              <p className="dday-inline">
                시험까지 <strong>{ddayLabel(dday)}</strong> ({formatDate(examDate)})
              </p>
            )}
            {dday != null && dday > 0 && dday < 7 && <Notice tone="warn">남은 기간이 7일 미만이에요. 핵심 단원과 기출 위주의 총정리 모드로 계획을 만듭니다.</Notice>}
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
          </div>
        )}

        {step === 2 && (
          <fieldset className="form">
            <legend className="h2">지금 어느 단계인가요?</legend>
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

// UC-02 시험 정보 및 학습 조건 입력
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiWithConfirm } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { saveGuest } from '../lib/guest';
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
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function validateStep() {
    if (step === 0) {
      if (!examDate) return '시험 회차를 선택하거나 시험일을 입력해 주세요.';
      if (examDate <= today) return '시험일은 내일 이후 날짜여야 합니다.';
    }
    if (step === 1 && !form.studyDays.length) return '학습 요일을 하루 이상 선택해 주세요.';
    return null;
  }
  function nextStep() {
    const v = validateStep();
    if (v) return setError({ message: v });
    setError(null);
    setStep((s) => s + 1);
  }

  async function submit() {
    const v = validateStep();
    if (v) return setError({ message: v });
    setSaving(true);
    setError(null);
    const subs = subjects.data?.items || [];
    const profile = {
      examType: form.examType,
      examId: form.examId || null,
      examDate,
      dailyHours: Number(form.dailyHours),
      studyDays: form.studyDays,
      stage: form.stage,
      subjectProgress: Object.fromEntries(subs.map((s) => [s.id, Number(form.subjectProgress[s.id] ?? 0)])),
      subjectConfidence: Object.fromEntries(subs.map((s) => [s.id, Number(form.subjectConfidence[s.id] ?? 2)])),
    };
    try {
      if (user) {
        await api('/api/study-profile', { method: 'PUT', body: profile });
        await apiWithConfirm('/api/plans', { body: {}, confirmKey: 'confirmOverwrite' });
        await refreshMe();
      } else {
        const preview = await api('/api/plans/preview', { method: 'POST', body: profile });
        saveGuest({ profile, plan: preview.plan, tasks: preview.tasks });
      }
      navigate('/schedule', { state: { created: true } });
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }

  if (existing.loading) return <Loading />;

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
        {step === 0 && (
          <fieldset className="form">
            <legend className="h2">어떤 시험을 준비하나요?</legend>
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
              <select value={form.examId} onChange={(e) => set({ examId: e.target.value, customDate: '' })}>
                <option value="">목록에 없음 (시험일 직접 입력)</option>
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
            <ul className="subject-inputs">
              {(subjects.data?.items || []).map((s) => {
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

        <ErrorBox error={error} />
        <div className="row-between">
          <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || saving}>
            이전
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={nextStep}>
              다음
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? '스케줄 만드는 중…' : user ? '저장하고 스케줄 만들기' : '스케줄 미리보기'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

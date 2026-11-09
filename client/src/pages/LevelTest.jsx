// 가입 직후 레벨테스트 — 문항 조회·채점은 서버에서 처리하고, 결과는 학습 계획(단계·과목별 자신감)에 반영한다.
import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { STAGE, CONFIDENCE } from '../lib/format';
import { ErrorBox, Loading, Notice, PageHeader, ProgressBar } from '../components/ui';
import { safeNext } from './Auth';

const UNSURE = 'unsure'; // "잘 모르겠어요" (서버에는 null로 전송)

export default function LevelTest() {
  const { me, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const q = useApi(() => api('/api/level-test'), []);
  const [answers, setAnswers] = useState({});
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const pending = useRef(false);

  const questions = q.data?.questions || [];
  const subjects = q.data?.subjects || [];
  const answered = questions.filter((x) => answers[x.id] !== undefined).length;
  const firstTime = !!me?.levelTestPending;

  // 응시·건너뛰기 후 사용자 정보를 새로 받아 레벨테스트 안내(가입 직후 이동)를 끝낸다
  async function leave(to) {
    try {
      await refreshMe();
    } catch {
      // 다음 화면에서 다시 불러온다
    }
    navigate(to, { replace: true });
  }

  async function submit(e) {
    e.preventDefault();
    if (pending.current) return;
    if (answered < questions.length) return setError({ message: `아직 답하지 않은 문항이 ${questions.length - answered}개 있어요. 모르는 문항은 "잘 모르겠어요"를 선택해 주세요.` });
    pending.current = true;
    setBusy('submit');
    setError(null);
    try {
      const body = { answers: Object.fromEntries(questions.map((x) => [x.id, answers[x.id] === UNSURE ? null : answers[x.id]])) };
      setOutcome(await api('/api/level-test', { method: 'POST', body }));
      window.scrollTo(0, 0);
      refreshMe().catch(() => {});
    } catch (err) {
      setError(err);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function skip() {
    if (pending.current) return;
    pending.current = true;
    setBusy('skip');
    setError(null);
    try {
      if (firstTime) await api('/api/level-test/skip', { method: 'POST' });
      await leave(next);
    } catch (err) {
      setError(err);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  if (q.loading) return <Loading label="레벨테스트를 불러오는 중" />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;

  if (outcome) {
    const r = outcome.result;
    const byId = new Map(questions.map((x) => [x.id, x]));
    return (
      <div className="stack narrow">
        <PageHeader title="레벨테스트 결과" desc={`${r.total}문항 중 ${r.correct}문항 정답 · 정답률 ${r.rate}%`} />
        <section className="card" aria-labelledby="lt-level">
          <p className="eyebrow">내 수준</p>
          <h2 id="lt-level">{r.levelLabel}</h2>
          <p>{r.message}</p>
          <Notice tone="info" icon="spark">
            추천 학습 단계는 <strong>{STAGE[r.recommendedStage]}</strong>예요. 학습 계획을 만들 때 단계와 과목별 자신감이 이 결과로 미리 채워지고, 하루 필요 학습 시간 계산에도 반영돼요.
          </Notice>
          <ul className="subject-bars">
            {subjects.map((s) => {
              const b = r.bySubject[s.id];
              if (!b) return null;
              const rate = (b.correct / b.total) * 100;
              return (
                <li key={s.id}>
                  <div className="sb-row">
                    <span className="sb-name">{s.name}</span>
                    <span className="sb-val">
                      {b.correct}/{b.total} · 자신감 {CONFIDENCE[r.subjectConfidence[s.id]]}
                    </span>
                  </div>
                  <ProgressBar value={rate} label={`${s.name} 정답률`} />
                </li>
              );
            })}
          </ul>
          <div className="row-end">
            <button type="button" className="btn btn-ghost" onClick={() => leave(next)}>
              나중에 할게요
            </button>
            <button type="button" className="btn btn-primary" onClick={() => leave('/onboarding')}>
              이 결과로 학습 계획 만들기
            </button>
          </div>
        </section>
        <details className="card">
          <summary>문항별 정답 확인</summary>
          <ol className="bullets">
            {outcome.review.map((rv) => {
              const item = byId.get(rv.id);
              return (
                <li key={rv.id}>
                  <strong>{rv.correct ? '정답' : '오답'}</strong> · {item?.text}
                  <br />
                  <span className="muted small">
                    정답: {item?.choices[rv.answer]}
                    {!rv.correct && ` · 내 답: ${rv.chosen == null ? '잘 모르겠어요' : item?.choices[rv.chosen]}`} — {rv.explain}
                  </span>
                </li>
              );
            })}
          </ol>
        </details>
      </div>
    );
  }

  return (
    <form className="stack narrow" onSubmit={submit} noValidate aria-busy={!!busy}>
      <PageHeader
        title="레벨테스트"
        desc={`필기 5과목 기본 개념 ${questions.length}문항, 약 5분이면 끝나요. 결과로 내 수준을 확인하고 학습 단계·과목별 시간 배분에 반영해요.`}
      />
      {firstTime ? (
        <Notice tone="info" icon="check">가입을 환영해요! 먼저 지금 수준을 확인해 볼까요? 모르는 문항은 "잘 모르겠어요"를 고르면 더 정확해요.</Notice>
      ) : (
        q.data?.result && (
          <Notice tone="info">
            이전 결과: {q.data.result.levelLabel} (정답률 {q.data.result.rate}%). 다시 응시하면 결과가 새로 저장돼요.
          </Notice>
        )
      )}
      <div className="card">
        <div className="sb-row">
          <span className="sb-name">진행</span>
          <span className="sb-val">
            {answered}/{questions.length}
          </span>
        </div>
        <ProgressBar value={questions.length ? (answered / questions.length) * 100 : 0} label="레벨테스트 진행률" />
      </div>
      <fieldset className="stack" disabled={!!busy} aria-label="레벨테스트 문항">
        {questions.map((item, i) => {
          const subject = subjects.find((s) => s.id === item.subjectId);
          return (
            <fieldset key={item.id} className="form">
              <legend className="h3">
                {i + 1}. {item.text}
              </legend>
              {subject && <p className="muted small">{subject.name}</p>}
              <div className="option-list">
                {[...item.choices.map((c, k) => [k, c]), [UNSURE, '잘 모르겠어요']].map(([value, label]) => (
                  <label key={value} className={`option ${answers[item.id] === value ? 'on' : ''}`}>
                    <input type="radio" name={item.id} checked={answers[item.id] === value} onChange={() => setAnswers((a) => ({ ...a, [item.id]: value }))} />
                    <span>{value === UNSURE ? <small>{label}</small> : label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </fieldset>
      <ErrorBox error={error} />
      <div className="row-between">
        <button type="button" className="btn btn-ghost" onClick={skip} disabled={!!busy}>
          {busy === 'skip' ? '이동 중…' : firstTime ? '건너뛰고 나중에 하기' : '그만하기'}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!!busy}>
          {busy === 'submit' ? '채점 중…' : '제출하고 결과 보기'}
        </button>
      </div>
      {!firstTime && (
        <p className="muted small">
          <Link to="/profile">내 정보</Link>에서 언제든 다시 응시할 수 있어요.
        </p>
      )}
    </form>
  );
}

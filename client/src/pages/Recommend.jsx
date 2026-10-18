// UC-09 AI 학습 추천 — 추천 요청, 피드백, 이력
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { ErrorBox, Loading, PageHeader, EmptyState } from '../components/ui';
import { RecommendationCards } from '../components/StudyCards';
import Icon from '../components/Icon';

export default function Recommend() {
  const history = useApi(() => api('/api/recommendations?limit=10'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [feedbackStates, setFeedbackStates] = useState({});
  const pending = useRef(false);
  const feedbackPending = useRef(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function request() {
    if (pending.current || history.loading || history.error) return;
    pending.current = true;
    setBusy(true);
    setErr(null);
    try {
      const rec = await api('/api/recommendations', { method: 'POST' });
      if (!mounted.current) return;
      setRemaining(rec.remainingToday);
      history.setData((d) => ({ ...d, items: [rec, ...(d?.items || [])] }));
    } catch (e) {
      if (mounted.current) setErr(e);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function feedback(rec, value) {
    if (feedbackPending.current.has(rec.id) || history.loading || history.error) return;
    feedbackPending.current.add(rec.id);
    setFeedbackStates((s) => ({ ...s, [rec.id]: { busy: true, error: null, value } }));
    try {
      await api(`/api/recommendations/${rec.id}`, { method: 'PATCH', body: { feedback: value } });
      if (!mounted.current) return;
      history.setData((d) => d && ({ ...d, items: d.items.map((x) => (x.id === rec.id ? { ...x, feedback: value } : x)) }));
    } catch (error) {
      if (mounted.current) setFeedbackStates((s) => ({ ...s, [rec.id]: { busy: true, error, value } }));
    } finally {
      feedbackPending.current.delete(rec.id);
      if (mounted.current) setFeedbackStates((s) => ({ ...s, [rec.id]: { ...s[rec.id], busy: false } }));
    }
  }

  function recommendationCard(rec) {
    const state = feedbackStates[rec.id];
    return (
      <RecommendationCards
        rec={rec}
        onFeedback={(v) => feedback(rec, v)}
        feedbackBusy={!!state?.busy}
        feedbackError={state?.error}
        onRetryFeedback={state?.error ? () => feedback(rec, state.value) : undefined}
      />
    );
  }

  const [latest, ...older] = history.loading || history.error ? [] : history.data?.items || [];
  return (
    <div className="stack">
      <PageHeader
        title="AI 학습 추천"
        desc="남은 기간·과목별 진도·취약 유형 상위 3개를 요약해(개인정보 제외) 다음 학습 주제와 허브에 등록된 자료를 추천해요. 문제를 새로 만들지는 않아요."
        actions={
          <button type="button" className="btn btn-primary" onClick={request} disabled={busy || history.loading || !!history.error} aria-busy={busy}>
            <Icon name="spark" size={18} /> {busy ? '추천 생성 중… (최대 20초)' : '새 추천 받기'}
          </button>
        }
      />
      {remaining != null && <p className="muted small">오늘 남은 추천 횟수: {remaining}회</p>}
      <div aria-live="polite">
        <ErrorBox error={err} onRetry={busy || history.loading || history.error ? undefined : request} />
      </div>
      {history.loading && <Loading lines={4} />}
      <ErrorBox error={history.error} onRetry={history.loading ? undefined : history.reload} />
      {latest ? (
        <section className="card">
          <h2>최근 추천</h2>
          {recommendationCard(latest)}
        </section>
      ) : (
        !history.loading && !history.error && !busy && <EmptyState title="아직 받은 추천이 없어요">위의 ‘새 추천 받기’를 눌러 보세요. 진도나 오답 기록이 있을수록 정확해져요.</EmptyState>
      )}
      {older.length > 0 && (
        <section className="section">
          <h2>이전 추천</h2>
          {older.map((r) => (
            <details key={r.id} className="acc-item">
              <summary>
                <span className="acc-title">{r.topics.map((t) => t.title).join(' · ')}</span>
              </summary>
              {recommendationCard(r)}
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

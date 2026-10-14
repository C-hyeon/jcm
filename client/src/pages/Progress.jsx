// UC-05 진도 체크
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiWithConfirm } from '../api/client';
import { useApi } from '../hooks/useApi';
import { minutesLabel, pct, UNDERSTANDING } from '../lib/format';
import { ErrorBox, Loading, Notice, PageHeader, ProgressBar } from '../components/ui';

const STEPS = [0, 25, 50, 75, 100];

export default function Progress() {
  const q = useApi(() => api('/api/progress'), []);
  const [busyUnit, setBusyUnit] = useState(null);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState('');
  const [regen, setRegen] = useState(false);

  if (q.loading) return <Loading lines={6} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;

  async function setRate(unit, rate) {
    setBusyUnit(unit.id);
    setErr(null);
    setToast('');
    try {
      const res = await apiWithConfirm('/api/progress', { method: 'PUT', body: { unitId: unit.id, rate }, confirmKey: 'confirmDecrease' });
      const adj = res.adjustment;
      setToast(
        `${unit.name} 진도를 ${rate}%로 저장했어요.` +
          (adj.deleted || adj.adjusted ? ` 오늘 이후 이 단원 과제 ${adj.deleted}건을 빼고 ${adj.adjusted}건의 시간을 줄였어요.` : ''),
      );
      q.reload();
    } catch (e) {
      if (e.status !== 409) setErr(e);
    } finally {
      setBusyUnit(null);
    }
  }

  async function regenerate() {
    setRegen(true);
    try {
      await api('/api/plans', { method: 'POST', body: { confirmOverwrite: true } });
      setToast('현재 진도를 반영해 오늘 이후 스케줄을 다시 만들었어요.');
      q.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setRegen(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader title="진도 체크" desc="스케줄 순서와 상관없이 공부한 단원을 골라 진행률을 기록하세요. 오늘 할 일 완료 체크도 여기에 함께 반영됩니다." />
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">전체 진도율</span>
          <span className="stat-val">{pct(d.overall)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">남은 학습량</span>
          <span className="stat-val">{minutesLabel(d.remainingMinutes)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">계획상 기대 진도</span>
          <span className="stat-val">{d.expected == null ? '-' : pct(d.expected)}</span>
        </div>
      </div>
      {d.suggestRegenerate && (
        <Notice tone="warn">
          스케줄과 실제 진도 차이가 {Math.abs(d.gap).toFixed(1)}%p입니다. 현재 진도에 맞춰 스케줄을 다시 만들까요?{' '}
          <button type="button" className="btn btn-sm btn-primary" onClick={regenerate} disabled={regen}>
            {regen ? '만드는 중…' : '스케줄 재생성'}
          </button>
        </Notice>
      )}
      {toast && (
        <Notice tone="success" icon="check">
          {toast}
        </Notice>
      )}
      <ErrorBox error={err} />

      <div className="accordion">
        {d.subjects.map((s, i) => (
          <details key={s.id} className="acc-item" open={i === 0}>
            <summary>
              <span className="acc-title">{s.name}</span>
              <span className="acc-meta">
                <span className="sb-val">{pct(s.rate)}</span>
                <span className="muted small">남은 {minutesLabel(s.remainingMinutes)}</span>
              </span>
              <ProgressBar value={s.rate} label={`${s.name} 진도율`} />
            </summary>
            <ul className="unit-list">
              {s.units.map((u) => (
                <li key={u.id} className="unit">
                  <div className="unit-head">
                    <strong>{u.name}</strong>
                    {u.core && <span className="tag tag-soft">핵심</span>}
                    {u.needsReview && <span className="tag tag-amber">복습 필요</span>}
                    {u.understanding && <span className="muted small">이해도 {UNDERSTANDING[u.understanding]}</span>}
                    <span className="muted small unit-hours">표준 {u.standardHours}시간 · 현재 {pct(u.rate)}</span>
                  </div>
                  <div className="seg seg-sm unit-steps" role="radiogroup" aria-label={`${u.name} 진행률`}>
                    {STEPS.map((v) => {
                      const on = Math.round(u.rate) === v;
                      return (
                        <label key={v} className={`seg-item ${on ? 'on' : ''}`}>
                          <input type="radio" name={`rate-${u.id}`} checked={on} disabled={busyUnit === u.id} onChange={() => setRate(u, v)} />
                          {v === 100 ? '완료' : `${v}%`}
                        </label>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
            <p className="small">
              <Link to={`/path?subjectId=${s.id}`}>이 과목 학습 경로 보기</Link>
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}

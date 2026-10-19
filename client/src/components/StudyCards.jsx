import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { Dialog, ErrorBox, ExternalLink, ProgressBar } from './ui';
import { api } from '../api/client';
import { ddayLabel, EXAM_TYPE, formatDate, MATERIAL_TYPE, minutesLabel, UNDERSTANDING } from '../lib/format';

// 시험일까지 남은 기간
export function DdayHero({ exam, today, extra }) {
  if (!exam) return null;
  return (
    <section className="dday-hero" aria-label="시험까지 남은 기간">
      <div className="dday-num">{ddayLabel(exam.dday)}</div>
      <div>
        <p className="dday-title">
          정보처리기사 {EXAM_TYPE[exam.type]} · {formatDate(exam.date)}
        </p>
        <p className="dday-sub">오늘은 {formatDate(today)}입니다.</p>
        {extra}
      </div>
    </section>
  );
}

// 벤치마킹 : 오늘 계획대로 학습 / 자료 탐색으로 바로 시작
export function StartChoice({ onPlan, planLabel = '오늘 계획대로 학습', planDescription = '배정된 과제와 추천 자료로 바로 시작' }) {
  return (
    <section className="start-choice" aria-label="학습 시작 방법">
      <button type="button" className="choice choice-primary" onClick={onPlan}>
        <Icon name="play" size={22} />
        <span>
          <strong>{planLabel}</strong>
          <small>{planDescription}</small>
        </span>
      </button>
      <Link className="choice" to="/materials">
        <Icon name="search" size={22} />
        <span>
          <strong>원하는 자료 찾아 학습</strong>
          <small>과목·유형·단계별 공개 자료 탐색</small>
        </span>
      </Link>
    </section>
  );
}

export function MaterialLinks({ materials }) {
  if (!materials?.length) return null;
  return (
    <ul className="mat-links" aria-label="추천 자료">
      {materials.map((m) => (
        <li key={m.id}>
          <ExternalLink href={m.url}>
            <span className="tag tag-soft">{MATERIAL_TYPE[m.type] || m.type}</span>
            <span className="mat-title">{m.title}</span>
          </ExternalLink>
          <span className="mat-src">출처: {m.sourceName}</span>
        </li>
      ))}
    </ul>
  );
}

// 오늘 할 일 카드
export function TaskCard({ task, onChange, onRequireLogin, readOnly = false }) {
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pending = useRef(false);

  async function patch(body) {
    if (onRequireLogin) {
      onRequireLogin();
      return false;
    }
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setErr(null);
    try {
      const res = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body });
      onChange?.(res.task, res.progress);
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function openLog() {
    setErr(null);
    setLogOpen(true);
  }
  function closeLog(e) {
    if (pending.current) {
      e?.preventDefault();
      return;
    }
    setLogOpen(false);
  }
  async function saveLog(body) {
    if (await patch(body)) setLogOpen(false);
  }

  const toggleCheck = (i) => patch({ checklist: task.checklist.map((c, k) => (k === i ? { ...c, done: !c.done } : c)) });

  return (
    <article className={`task-card ${task.done ? 'is-done' : ''} ${task.type === 'review' ? 'is-review' : ''}`}>
      <header className="task-head">
        <span className="tag">{task.subjectName}</span>
        {task.type === 'review' && <span className="tag tag-amber">총정리</span>}
        {task.carriedOver && <span className="tag tag-soft" title={`원래 ${formatDate(task.originalDate)} 과제`}>이월</span>}
        <span className="task-time">
          <Icon name="clock" size={16} /> {minutesLabel(task.minutes)}
        </span>
      </header>
      <h3 className="task-title">{task.title}</h3>

      {task.checklist?.length > 0 && (
        <ul className="checklist">
          {task.checklist.map((c, i) => (
            <li key={i}>
              <label>
                <input type="checkbox" checked={c.done} disabled={busy || readOnly} onChange={() => toggleCheck(i)} />
                <span>{c.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <MaterialLinks materials={task.materials} />

      {task.done && (
        <p className="task-log muted">
          완료 · {task.actualMinutes != null ? `실제 ${minutesLabel(task.actualMinutes)}` : ''}
          {task.understanding ? ` · 이해도 ${UNDERSTANDING[task.understanding]}` : ''}
          {task.needsReview ? ' · 복습 필요' : ''}
        </p>
      )}
      {err && !logOpen && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
      {!readOnly && (
        <div className="task-actions">
          {!task.done ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => (onRequireLogin ? onRequireLogin() : openLog())}>
              <Icon name="check" /> 완료하고 기록
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={openLog}>
                기록 수정
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => patch({ done: false })}>
                완료 취소
              </button>
            </>
          )}
        </div>
      )}
      <StudyLogDialog open={logOpen} busy={busy} task={task} error={err} onClose={closeLog} onSave={saveLog} />
    </article>
  );
}

// 벤치마킹 : 완료 여부와 함께 이해도·복습 필요 여부 기록
function StudyLogDialog({ open, busy, task, error, onClose, onSave }) {
  return (
    <Dialog open={open} dismissible={!busy} onClose={onClose} title="학습 기록">
      <StudyLogForm task={task} error={error} onClose={onClose} onSave={onSave} />
    </Dialog>
  );
}

function StudyLogForm({ task, error, onClose, onSave }) {
  const [minutes, setMinutes] = useState(task.actualMinutes ?? task.minutes);
  const [understanding, setUnderstanding] = useState(task.understanding ?? 2);
  const [needsReview, setNeedsReview] = useState(task.needsReview ?? false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const saveButton = useRef(null);
  useEffect(() => {
    if (error && !saving) saveButton.current?.focus();
  }, [error, saving]);

  async function submit(e) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await onSave({ done: true, actualMinutes: Number(minutes) || 0, understanding, needsReview });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
        <p className="muted">{task.title}</p>
        <label className="field">
          <span>실제 학습 시간(분)</span>
          <input type="number" min="0" max="720" step="5" value={minutes} disabled={saving} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <fieldset className="field" disabled={saving}>
          <legend>이해도</legend>
          <div className="seg">
            {[1, 2, 3].map((v) => (
              <label key={v} className={`seg-item ${understanding === v ? 'on' : ''}`}>
                <input
                  type="radio"
                  name="understanding"
                  value={v}
                  checked={understanding === v}
                  onChange={() => {
                    setUnderstanding(v);
                    if (v === 1) setNeedsReview(true);
                  }}
                />
                {UNDERSTANDING[v]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check-row">
          <input type="checkbox" checked={needsReview} disabled={saving} onChange={(e) => setNeedsReview(e.target.checked)} />
          <span>복습이 필요해요 (취약 주제와 추천에 반영됩니다)</span>
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="row-end">
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>
            취소
          </button>
          <button ref={saveButton} type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? '저장 중…' : '완료로 저장'}
          </button>
        </div>
      </form>
  );
}

// 과목별 진도 막대
export function SubjectBars({ subjects, compact = false }) {
  return (
    <ul className={`subject-bars ${compact ? 'compact' : ''}`}>
      {subjects.map((s) => (
        <li key={s.id}>
          <div className="sb-row">
            <span className="sb-name">{s.name}</span>
            <span className="sb-val">{s.rate.toFixed(1)}%</span>
          </div>
          <ProgressBar value={s.rate} label={`${s.name} 진도율`} />
        </li>
      ))}
    </ul>
  );
}

// 벤치마킹 : 추천 주제·추천 이유·연결된 자료 출처를 한 카드에
export function RecommendationCards({ rec, onFeedback, feedbackBusy = false, feedbackError = null, onRetryFeedback }) {
  if (!rec) return null;
  return (
    <div className="rec-wrap">
      <p className="rec-meta">
        <span className={`tag ${rec.engine === 'ai' ? 'tag-teal' : 'tag-soft'}`}>{rec.engine === 'ai' ? 'AI 추천' : '규칙 기반 추천'}</span>
        <span className="muted">{formatDate(rec.createdDate)}</span>
        {rec.engine === 'rule' && rec.fallbackReason && <span className="muted">AI 응답이 지연·실패해 학습 기록 기반으로 추천했어요.</span>}
      </p>
      <ol className="rec-list">
        {rec.topics.map((t, i) => (
          <li key={i} className="rec-card">
            <div className="rec-num" aria-hidden>
              {i + 1}
            </div>
            <div>
              <h3>{t.title}</h3>
              {t.subjectName && <p className="tag tag-soft inline">{t.subjectName}</p>}
              <p className="rec-reason">{t.reason}</p>
              <MaterialLinks materials={t.materials} />
            </div>
          </li>
        ))}
      </ol>
      {onFeedback && (
        <div className="rec-feedback" role="group" aria-label="추천 피드백" aria-busy={feedbackBusy || undefined}>
          <span className="muted">이 추천이 도움이 됐나요?</span>
          <button type="button" className={`btn btn-sm ${rec.feedback === 'helpful' ? 'btn-primary' : 'btn-ghost'}`} disabled={feedbackBusy} onClick={() => onFeedback('helpful')} aria-pressed={rec.feedback === 'helpful'}>
            도움 됨
          </button>
          <button type="button" className={`btn btn-sm ${rec.feedback === 'not_helpful' ? 'btn-primary' : 'btn-ghost'}`} disabled={feedbackBusy} onClick={() => onFeedback('not_helpful')} aria-pressed={rec.feedback === 'not_helpful'}>
            도움 안 됨
          </button>
        </div>
      )}
      {onFeedback && feedbackBusy && <p className="muted small" role="status">피드백 저장 중이에요.</p>}
      {onFeedback && <ErrorBox error={feedbackError} onRetry={feedbackBusy ? undefined : onRetryFeedback} />}
    </div>
  );
}

export function TaskList({ tasks, ...rest }) {
  return (
    <div className="task-grid">
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} {...rest} />
      ))}
    </div>
  );
}

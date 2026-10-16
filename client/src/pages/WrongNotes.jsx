// UC-06 오답·취약 유형 기록
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { DIFFICULTY, EXAM_TYPE, formatDate } from '../lib/format';
import { EmptyState, ErrorBox, ExternalLink, Loading, Notice, PageHeader } from '../components/ui';

const EMPTY = { subjectId: '', unitId: '', typeTag: '', difficulty: 'mid', round: '', number: '', url: '', memo: '' };

export default function WrongNotes() {
  const { me } = useAuth();
  const [examType, setExamType] = useState(me?.profile?.examType || 'written');
  const subjectsQ = useApi(() => api(`/api/subjects?examType=${examType}`), [examType]);
  const subjects = !subjectsQ.loading && !subjectsQ.error ? subjectsQ.data?.items || [] : [];
  const weak = useApi(() => api('/api/weakness'), []);
  const [filter, setFilter] = useState({ subjectId: '', typeTag: '', reviewed: '' });
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [formErr, setFormErr] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const readPending = useRef(false);
  const controller = useRef(null);
  const retryReset = useRef(true);
  const formRef = useRef(null);
  const busy = !!pendingAction;
  const saving = pendingAction?.kind === 'save';
  const subjectsUnavailable = subjectsQ.loading || !!subjectsQ.error;

  const subjectOf = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s])), [subjects]);
  const formSubject = subjectOf[form.subjectId];
  const filterSubject = subjectOf[filter.subjectId];

  async function load(reset = true) {
    if (!reset && (readPending.current || !cursor)) return;
    const id = ++requestId.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    readPending.current = true;
    retryReset.current = reset;
    setListLoading(true);
    setListErr(null);
    const p = new URLSearchParams();
    if (filter.subjectId) p.set('subjectId', filter.subjectId);
    if (filter.subjectId && filter.typeTag) p.set('typeTag', filter.typeTag);
    if (filter.reviewed) p.set('reviewed', filter.reviewed);
    if (!reset && cursor) p.set('cursor', cursor);
    try {
      const res = await api(`/api/wrong-notes?${p}`, { signal: request.signal });
      if (!mounted.current || id !== requestId.current) return;
      setItems((prev) => reset ? res.items : [...new Map([...prev, ...res.items].map((n) => [n.id, n])).values()]);
      setCursor(res.nextCursor);
    } catch (e) {
      if (mounted.current && id === requestId.current && e.name !== 'AbortError') setListErr(e);
    } finally {
      if (mounted.current && id === requestId.current) {
        readPending.current = false;
        setListLoading(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++requestId.current;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    load(true);
    return () => {
      ++requestId.current;
      controller.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.subjectId, filter.typeTag, filter.reviewed]);

  function changeFilter(next) {
    if (pending.current) return;
    if (next.subjectId === filter.subjectId && next.typeTag === filter.typeTag && next.reviewed === filter.reviewed) return;
    ++requestId.current;
    controller.current?.abort();
    setItems([]);
    setCursor(null);
    setListErr(null);
    setListLoading(true);
    setActionErr(null);
    setFilter(next);
  }

  function changeExam(t) {
    if (pending.current || t === examType) return;
    setExamType(t);
    setEditing(null);
    setForm(EMPTY);
    setFormErr(null);
    setNotice('');
    changeFilter({ subjectId: '', typeTag: '', reviewed: '' });
  }

  function cancelEdit() {
    if (pending.current) return;
    setEditing(null);
    setForm(EMPTY);
    setFormErr(null);
  }

  const setF = (k) => (e) => {
    if (pending.current) return;
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value, ...(k === 'subjectId' ? { typeTag: '', unitId: '' } : {}) }));
  };

  function matchesFilter(n) {
    return (!filter.subjectId || n.subjectId === filter.subjectId)
      && (!filter.subjectId || !filter.typeTag || n.typeTag === filter.typeTag)
      && (!filter.reviewed || String(n.reviewed) === filter.reviewed);
  }

  async function submit(e) {
    e.preventDefault();
    if (pending.current || subjectsUnavailable) return;
    if (!form.subjectId || !form.typeTag) return setFormErr({ message: '과목과 유형 태그는 필수예요.' });
    pending.current = true;
    setPendingAction({ kind: 'save', id: editing });
    setFormErr(null);
    setActionErr(null);
    setNotice('');
    const body = {
      typeTag: form.typeTag,
      unitId: form.unitId || null,
      difficulty: form.difficulty,
      sourceRef: { round: form.round, number: form.number, url: form.url },
      memo: form.memo,
    };
    try {
      const saved = editing
        ? await api(`/api/wrong-notes/${editing}`, { method: 'PATCH', body })
        : await api('/api/wrong-notes', { method: 'POST', body: { ...body, subjectId: form.subjectId } });
      if (!mounted.current) return;
      setItems((list) => {
        const rest = list.filter((n) => n.id !== saved.id);
        return matchesFilter(saved) ? [saved, ...rest] : rest;
      });
      setForm((f) => ({ ...EMPTY, subjectId: f.subjectId }));
      setEditing(null);
      setNotice(editing ? '오답 기록을 수정했어요.' : '오답을 기록했어요.');
      weak.reload();
      await load(true);
    } catch (err) {
      if (mounted.current) setFormErr(err);
    } finally {
      pending.current = false;
      if (mounted.current) setPendingAction(null);
    }
  }

  function startEdit(n) {
    if (pending.current || listLoading || subjectsUnavailable) return;
    if (!subjectOf[n.subjectId]) {
      setActionErr({ error: { message: '이 기록의 시험 구분을 선택한 뒤 다시 수정해 주세요.' } });
      return;
    }
    setFormErr(null);
    setActionErr(null);
    setNotice('');
    setEditing(n.id);
    setForm({ subjectId: n.subjectId, unitId: n.unitId || '', typeTag: n.typeTag, difficulty: n.difficulty, round: n.sourceRef.round || '', number: n.sourceRef.number || '', url: n.sourceRef.url || '', memo: n.memo });
    document.getElementById('wn-form')?.scrollIntoView({ block: 'start' });
  }
  async function toggleReviewed(n) {
    await runNoteAction(n, 'review');
  }
  async function remove(n) {
    if (pending.current || listLoading) return;
    if (!window.confirm('이 오답 기록을 삭제할까요?')) return;
    await runNoteAction(n, 'delete');
  }

  async function runNoteAction(n, kind) {
    if (pending.current || listLoading) return;
    pending.current = true;
    setPendingAction({ kind, id: n.id });
    setActionErr(null);
    setNotice('');
    try {
      const updated = await api(`/api/wrong-notes/${n.id}`, kind === 'delete'
        ? { method: 'DELETE' }
        : { method: 'PATCH', body: { reviewed: !n.reviewed } });
      if (!mounted.current) return;
      setItems((list) => list.flatMap((x) => {
        if (x.id !== n.id) return [x];
        if (kind === 'delete' || (filter.reviewed && String(updated.reviewed) !== filter.reviewed)) return [];
        return [updated];
      }));
      if (kind === 'delete' && editing === n.id) {
        setEditing(null);
        setForm(EMPTY);
        setFormErr(null);
      }
      setNotice(kind === 'delete' ? '오답 기록을 삭제했어요.' : updated.reviewed ? '복습 완료로 표시했어요.' : '복습 전으로 변경했어요.');
      weak.reload();
      await load(true);
    } catch (error) {
      if (mounted.current) setActionErr({ error, note: n, kind });
    } finally {
      pending.current = false;
      if (mounted.current) setPendingAction(null);
    }
  }

  function retryAction() {
    if (!actionErr?.note) return;
    if (actionErr.kind === 'delete') return remove(actionErr.note);
    return toggleReviewed(actionErr.note);
  }

  return (
    <div className="stack wrong-notes-page">
      <PageHeader
        title="오답노트"
        desc="틀린 문제의 과목·유형·난이도를 기록하면 취약 유형을 계산해 다음 학습 추천에 반영해요."
        actions={
          <div className="seg seg-sm" role="radiogroup" aria-label="시험 구분">
            {['written', 'practical'].map((t) => (
              <label key={t} className={`seg-item ${examType === t ? 'on' : ''}`}>
                <input type="radio" name="wn-exam" checked={examType === t} disabled={busy} onChange={() => changeExam(t)} />
                {EXAM_TYPE[t]}
              </label>
            ))}
          </div>
        }
      />
      {notice && <Notice tone="success" icon="check">{notice}</Notice>}

      <section className="card" aria-labelledby="top3-h">
        <h2 id="top3-h">취약 유형 TOP 3</h2>
        {weak.loading && <Loading />}
        <ErrorBox error={weak.error} onRetry={weak.reload} />
        {!weak.loading && weak.data &&
          (weak.data.topTypes.length ? (
            <ol className="top3">
              {weak.data.topTypes.map((t, i) => (
                <li key={t.subjectId + t.typeTag}>
                  <span className="rank">{i + 1}</span>
                  <span>
                    <strong>{t.typeTag}</strong> <span className="muted small">{t.subjectName}</span>
                  </span>
                  <span className="score">{t.score.toFixed(1)}%</span>
                  <span className="muted small">{t.count}건</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">최근 2주 동안의 오답은 더 중요하게 반영하고, 복습을 마친 오답은 덜 반영해 취약 유형을 알려드려요.</p>
          ))}
      </section>

      <section className="card" id="wn-form" aria-labelledby="form-h">
        <h2 id="form-h">{editing ? '오답 기록 수정' : '오답 기록'}</h2>
        {subjectsQ.loading && <Loading label="과목을 불러오는 중" />}
        <ErrorBox error={subjectsQ.error} onRetry={subjectsQ.reload} />
        <form ref={formRef} onSubmit={submit} className="form grid-form" aria-busy={saving}>
          <label className="field">
            <span>과목 *</span>
            <select value={form.subjectId} onChange={setF('subjectId')} disabled={!!editing || busy || subjectsUnavailable} required>
              <option value="">선택</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>단원 (선택)</span>
            <select value={form.unitId} onChange={setF('unitId')} disabled={!formSubject || busy}>
              <option value="">선택 안 함</option>
              {formSubject?.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="field span-2" disabled={busy || subjectsUnavailable}>
            <legend>유형 태그 *</legend>
            {formSubject ? (
              <div className="tag-picker">
                {formSubject.tags.map((t) => (
                  <label key={t} className={`chip ${form.typeTag === t ? 'on' : ''}`}>
                    <input type="radio" name="typeTag" checked={form.typeTag === t} onChange={() => setForm((f) => ({ ...f, typeTag: t }))} />
                    {t}
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted small">과목을 먼저 선택하세요.</p>
            )}
          </fieldset>
          <fieldset className="field" disabled={busy}>
            <legend>난이도</legend>
            <div className="seg seg-sm">
              {['high', 'mid', 'low'].map((v) => (
                <label key={v} className={`seg-item ${form.difficulty === v ? 'on' : ''}`}>
                  <input type="radio" name="difficulty" checked={form.difficulty === v} onChange={() => setForm((f) => ({ ...f, difficulty: v }))} />
                  {DIFFICULTY[v]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field-row">
            <label className="field">
              <span>회차</span>
              <input value={form.round} onChange={setF('round')} disabled={busy} placeholder="예: 2025년 2회" maxLength={30} />
            </label>
            <label className="field">
              <span>문항 번호</span>
              <input value={form.number} onChange={setF('number')} disabled={busy} placeholder="예: 37" maxLength={20} />
            </label>
          </div>
          <label className="field span-2">
            <span>문제 출처 링크 (공개 페이지, https)</span>
            <input type="url" value={form.url} onChange={setF('url')} disabled={busy} placeholder="https://" maxLength={500} />
          </label>
          <label className="field span-2">
            <span>
              내 메모 <span className="muted small">({form.memo.length}/1,000)</span>
            </span>
            <textarea value={form.memo} onChange={setF('memo')} disabled={busy} maxLength={1000} rows={3} placeholder="헷갈린 개념, 다음에 기억할 점" />
            <small className="muted">저작권 보호를 위해 문제 전문이나 캡처는 넣지 말고, 핵심만 메모해 주세요.</small>
          </label>
          <div className="span-2">
            <ErrorBox error={formErr} onRetry={!busy && !subjectsUnavailable ? () => formRef.current?.requestSubmit() : undefined} />
            <div className="row-end">
              {editing && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancelEdit}>
                  취소
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy || subjectsUnavailable}>
                {saving ? '저장 중…' : editing ? '수정 저장' : '기록하기'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="section" aria-labelledby="list-h">
        <div className="section-head">
          <h2 id="list-h">오답 목록</h2>
        </div>
        <div className="filters">
          <label className="field">
            <span className="sr-only">과목 필터</span>
            <select value={filter.subjectId} disabled={busy || subjectsUnavailable} onChange={(e) => changeFilter({ ...filter, subjectId: e.target.value, typeTag: '' })}>
              <option value="">전체 과목</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="sr-only">유형 필터</span>
            <select value={filter.typeTag} onChange={(e) => changeFilter({ ...filter, typeTag: e.target.value })} disabled={!filterSubject || busy}>
              <option value="">전체 유형</option>
              {filterSubject?.tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="sr-only">복습 여부 필터</span>
            <select value={filter.reviewed} disabled={busy} onChange={(e) => changeFilter({ ...filter, reviewed: e.target.value })}>
              <option value="">복습 전체</option>
              <option value="false">복습 전</option>
              <option value="true">복습 완료</option>
            </select>
          </label>
        </div>
        <ErrorBox error={actionErr?.error} onRetry={!busy && !listLoading && actionErr?.note ? retryAction : undefined} />
        <ErrorBox error={listErr} onRetry={!busy ? () => load(retryReset.current) : undefined} />
        {!listLoading && !listErr && !items.length && !cursor && (
          <EmptyState title={filter.subjectId || filter.reviewed ? '조건에 맞는 오답이 없어요' : '기록된 오답이 없어요'}>
            {filter.subjectId || filter.reviewed ? '다른 과목이나 복습 조건을 선택해 보세요.' : '문제를 풀다 틀리면 위에서 바로 기록해 보세요.'}
          </EmptyState>
        )}
        <ul className="note-list" aria-busy={listLoading}>
          {items.map((n) => (
            <li key={n.id} className={`note ${n.reviewed ? 'is-reviewed' : ''}`} aria-busy={pendingAction?.id === n.id}>
              <div className="note-head">
                <span className="tag">{subjectOf[n.subjectId]?.name || n.subjectId}</span>
                <span className="tag tag-teal">{n.typeTag}</span>
                <span className="tag tag-soft">난이도 {DIFFICULTY[n.difficulty]}</span>
                <span className="muted small">{formatDate(n.createdDate)}</span>
              </div>
              {(n.sourceRef.round || n.sourceRef.number || n.sourceRef.url) && (
                <p className="small">
                  출처: {n.sourceRef.round} {n.sourceRef.number && `${n.sourceRef.number}번`}{' '}
                  {n.sourceRef.url && <ExternalLink href={n.sourceRef.url}>링크</ExternalLink>}
                </p>
              )}
              {n.memo && <p className="note-memo">{n.memo}</p>}
              <div className="note-actions">
                <label className="check-row">
                  <input type="checkbox" checked={n.reviewed} disabled={busy || listLoading} onChange={() => toggleReviewed(n)} />
                  <span>복습 완료</span>
                </label>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy || listLoading || subjectsUnavailable} onClick={() => startEdit(n)}>
                  수정
                </button>
                <button type="button" className="btn btn-sm btn-ghost danger" disabled={busy || listLoading} onClick={() => remove(n)}>
                  삭제
                </button>
              </div>
              {pendingAction?.id === n.id && <p className="muted small" role="status">{pendingAction.kind === 'delete' ? '삭제 중…' : '저장 중…'}</p>}
            </li>
          ))}
        </ul>
        {listLoading && <Loading />}
        {cursor && !listLoading && !listErr && (
          <button type="button" className="btn btn-outline btn-block" disabled={busy} onClick={() => load(false)}>
            더 보기
          </button>
        )}
      </section>
    </div>
  );
}

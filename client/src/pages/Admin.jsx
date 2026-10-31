// UC-08 학습 자료·마스터 관리
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { EXAM_TYPE, MATERIAL_TYPE, STAGE, formatDate } from '../lib/format';
import { ErrorBox, ExternalLink, Loading, Notice, PageHeader } from '../components/ui';

const TABS = [
  ['materials', '학습 자료'],
  ['links', '링크 점검'],
  ['exams', '시험 일정'],
  ['subjects', '과목·단원'],
];

export default function Admin() {
  const [tab, setTab] = useState('materials');
  return (
    <div className="stack">
      <PageHeader title="관리자" desc="자료는 크롤링하지 않고 공개 여부·출처를 확인한 뒤 직접 등록합니다. 본문·문제 원문은 저장하지 않습니다." />
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'materials' && <MaterialsAdmin />}
        {tab === 'links' && <LinkCheck />}
        {tab === 'exams' && <ExamsAdmin />}
        {tab === 'subjects' && <SubjectsAdmin />}
      </div>
    </div>
  );
}

const EMPTY = { title: '', sourceName: '', author: '', url: '', subjectId: '', unitIds: [], type: 'doc', stage: 'concept', reason: '', tags: '', visible: true };

function MaterialsAdmin() {
  const list = useApi(() => api('/api/admin/materials'), []);
  const subjects = useApi(() => api('/api/subjects'), []);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const formRef = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const controlsDisabled = !!busy || list.loading || !!list.error || !!refreshError;
  const subject = subjects.data?.items.find((s) => s.id === form.subjectId);
  const set = (k) => (e) => {
    setErr(null);
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, ...(k === 'subjectId' ? { unitIds: [] } : {}) }));
  };

  function actionError(error, message) {
    const detail = error?.status >= 400 && error.status < 500 && error.message
      ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.';
    return { status: error?.status, code: error?.code, message: `${message} ${detail}` };
  }

  async function refreshMaterials() {
    try {
      const data = await api('/api/admin/materials');
      if (!mounted.current) return;
      list.setData(data);
      setRefreshError(null);
    } catch (error) {
      if (mounted.current) setRefreshError(actionError(error, '변경은 완료됐지만 최신 자료 목록을 불러오지 못했어요. 이전 목록이 표시될 수 있어요.'));
    }
  }

  async function runAction(action) {
    if (pending.current || controlsDisabled || !mounted.current) return;
    pending.current = true;
    setBusy({ ...action, phase: 'write' });
    setErr(null);
    setRowError(null);
    setOk(null);
    try {
      await api(action.path, { method: action.method, ...(action.body ? { body: action.body } : {}) });
      if (!mounted.current) return;
      if (action.kind === 'save' || (action.kind === 'delete' && editing === action.id)) {
        setForm(EMPTY);
        setEditing(null);
      } else if (action.kind === 'visibility' && editing === action.id) {
        setForm((f) => ({ ...f, visible: action.desired }));
      }
      setOk({ kind: action.kind, message: action.success });
      setBusy({ ...action, phase: 'refresh' });
      // A successful write must not be repeated when only the follow-up read fails.
      await refreshMaterials();
    } catch (error) {
      if (!mounted.current) return;
      const failure = actionError(error, action.failure);
      if (action.kind === 'save') setErr(failure);
      else setRowError({ ...failure, action });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function submit(e) {
    e.preventDefault();
    const body = { ...form, subjectId: form.subjectId || null, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    return runAction({ kind: 'save', id: editing, path: editing ? `/api/admin/materials/${editing}` : '/api/admin/materials', method: editing ? 'PUT' : 'POST', body,
      success: editing ? '수정했어요.' : '등록했어요.', failure: editing ? '자료를 수정하지 못했어요.' : '자료를 등록하지 못했어요.' });
  }
  function edit(m) {
    if (pending.current || controlsDisabled || !mounted.current) return;
    setErr(null);
    setRowError(null);
    setOk(null);
    setEditing(m.id);
    setForm({ ...m, subjectId: m.subjectId || '', tags: (m.tags || []).join(', ') });
    window.scrollTo({ top: 0 });
  }
  function cancelEdit() {
    if (pending.current || controlsDisabled || !mounted.current) return;
    setEditing(null);
    setForm(EMPTY);
    setErr(null);
  }
  function remove(m) {
    if (pending.current || controlsDisabled || !mounted.current) return;
    if (!window.confirm(`'${m.title}' 자료를 삭제할까요?`)) return;
    return runAction({ kind: 'delete', id: m.id, material: m, path: `/api/admin/materials/${m.id}`, method: 'DELETE',
      success: `'${m.title}' 자료를 삭제했어요.`, failure: `'${m.title}' 자료를 삭제하지 못했어요.` });
  }
  function toggleVisible(m, desired = !m.visible) {
    const { id, linkStatus, linkCheckedAt, ...rest } = m;
    return runAction({ kind: 'visibility', id, material: m, desired, path: `/api/admin/materials/${id}`, method: 'PUT', body: { ...rest, visible: desired },
      success: `'${m.title}' 자료를 ${desired ? '공개' : '비공개'}로 변경했어요.`, failure: `'${m.title}' 자료의 공개 상태를 변경하지 못했어요.` });
  }
  function retryRowAction() {
    if (!rowError) return;
    const action = rowError.action;
    return action.kind === 'delete' ? remove(action.material) : toggleVisible(action.material, action.desired);
  }
  async function retryRefresh() {
    if (pending.current || !mounted.current) return;
    pending.current = true;
    setBusy({ kind: 'refresh', phase: 'refresh' });
    try {
      await refreshMaterials();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>{editing ? '자료 수정' : '자료 등록'}</h2>
        <form className="form" ref={formRef} onSubmit={submit} aria-busy={busy?.kind === 'save'}>
          <fieldset className="form grid-form" disabled={controlsDisabled}>
            <label className="field span-2">
              <span>제목 *</span>
              <input value={form.title} onChange={set('title')} required maxLength={100} />
            </label>
            <label className="field">
              <span>출처(사이트·채널) *</span>
              <input value={form.sourceName} onChange={set('sourceName')} required maxLength={60} />
            </label>
            <label className="field">
              <span>원저작자 *</span>
              <input value={form.author} onChange={set('author')} required maxLength={60} />
            </label>
            <label className="field span-2">
              <span>URL (https만) *</span>
              <input type="url" value={form.url} onChange={set('url')} required placeholder="https://" />
            </label>
            <label className="field">
              <span>과목</span>
              <select value={form.subjectId} onChange={set('subjectId')}>
                <option value="">공통</option>
                {(subjects.data?.items || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    [{EXAM_TYPE[s.examType]}] {s.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="field">
              <legend>연결 단원</legend>
              <div className="tag-picker">
                {subject?.units.map((u) => (
                  <label key={u.id} className={`chip ${form.unitIds.includes(u.id) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={form.unitIds.includes(u.id)}
                      onChange={(e) => setForm((f) => ({ ...f, unitIds: e.target.checked ? [...f.unitIds, u.id] : f.unitIds.filter((x) => x !== u.id) }))}
                    />
                    {u.name}
                  </label>
                )) || <span className="muted small">과목을 선택하면 단원을 고를 수 있어요.</span>}
              </div>
            </fieldset>
            <label className="field">
              <span>유형</span>
              <select value={form.type} onChange={set('type')}>
                {Object.entries(MATERIAL_TYPE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>학습 단계</span>
              <select value={form.stage} onChange={set('stage')}>
                {Object.entries(STAGE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field span-2">
              <span>추천 이유 * (본문 요약·복제 금지, 왜 추천하는지만)</span>
              <textarea value={form.reason} onChange={set('reason')} required maxLength={300} rows={2} />
            </label>
            <label className="field">
              <span>태그 (쉼표 구분, 오답 유형과 같은 이름 권장)</span>
              <input value={form.tags} onChange={set('tags')} placeholder="SQL, 정규화" />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.visible} onChange={set('visible')} />
              <span>공개</span>
            </label>
            <div className="span-2">
              <ErrorBox error={err} onRetry={busy ? undefined : () => formRef.current?.requestSubmit()} />
              {ok?.kind === 'save' && <Notice tone="success" icon="check">{ok.message}</Notice>}
              <div className="row-end">
                {editing && (
                  <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                    취소
                  </button>
                )}
                <button type="submit" className="btn btn-primary">
                  {busy?.kind === 'save' ? busy.phase === 'refresh' ? '목록 확인 중…' : busy.id ? '수정 저장 중…' : '등록 중…' : editing ? '수정 저장' : '등록'}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </section>

      <section className="card" style={{ minWidth: 0 }}>
        <h2>등록된 자료 {list.data ? `(${list.data.items.length})` : ''}</h2>
        {busy && <p className="muted small" role="status">{busy.phase === 'refresh' ? '최신 자료 목록을 확인하는 중이에요.' : busy.kind === 'save' ? '자료를 저장하는 중이에요.' : busy.kind === 'delete' ? '자료를 삭제하는 중이에요.' : '공개 상태를 변경하는 중이에요.'}</p>}
        {ok && ok.kind !== 'save' && <Notice tone="success" icon="check">{ok.message}</Notice>}
        {list.loading && <Loading />}
        <ErrorBox error={list.error} onRetry={busy ? undefined : list.reload} />
        <ErrorBox error={rowError} onRetry={busy ? undefined : retryRowAction} />
        <ErrorBox error={refreshError} onRetry={busy ? undefined : retryRefresh} />
        {list.data && !list.data.items.length && <p className="muted">등록된 자료가 없어요.</p>}
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th scope="col">제목</th>
                <th scope="col">출처</th>
                <th scope="col">유형·단계</th>
                <th scope="col">링크</th>
                <th scope="col">공개</th>
                <th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items || []).map((m) => (
                <tr key={m.id} aria-busy={busy?.id === m.id}>
                  <td>
                    <ExternalLink href={m.url}>{m.title}</ExternalLink>
                  </td>
                  <td>{m.sourceName}</td>
                  <td>
                    {MATERIAL_TYPE[m.type]} · {STAGE[m.stage]}
                  </td>
                  <td>
                    <span className={`status st-${m.linkStatus}`}>{{ ok: '정상', broken: '실패', warn: '확인 필요', unknown: '미점검' }[m.linkStatus]}</span>
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggleVisible(m)} disabled={controlsDisabled}>
                      {busy?.kind === 'visibility' && busy.id === m.id ? '변경 중…' : m.visible ? '공개' : '비공개'}
                    </button>
                  </td>
                  <td className="nowrap">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit(m)} disabled={controlsDisabled}>
                      수정
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => remove(m)} disabled={controlsDisabled}>
                      {busy?.kind === 'delete' && busy.id === m.id ? '삭제 중…' : '삭제'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LinkCheck() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [err, setErr] = useState(null);
  const [completed, setCompleted] = useState(false);
  const pending = useRef(false);
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function run() {
    if (pending.current || !mounted.current) return;
    if (started.current && !window.confirm('처음부터 모든 자료를 다시 점검할까요? 이전 결과는 지워지고 이미 점검한 URL에도 다시 요청합니다.')) return;
    pending.current = true;
    started.current = true;
    setRunning(true);
    setErr(null);
    setResults([]);
    setProgress(null);
    setCompleted(false);
    let offset = 0;
    try {
      for (;;) {
        if (!mounted.current) return;
        const res = await api('/api/admin/link-check', { method: 'POST', body: { offset, limit: 10 } });
        if (!mounted.current) return;
        // Stop on an invalid cursor rather than repeatedly checking the same batch.
        if (!res || !Array.isArray(res.results) || res.results.length > 10 ||
          !Number.isSafeInteger(res.nextOffset) || !Number.isSafeInteger(res.total) || res.total < 0 ||
          res.nextOffset !== offset + res.results.length || res.nextOffset > res.total ||
          typeof res.done !== 'boolean' || res.done !== (res.nextOffset >= res.total) ||
          (!res.done && res.nextOffset <= offset) ||
          !res.results.every((r) => r && typeof r.id === 'string' && typeof r.title === 'string' && typeof r.url === 'string' && ['ok', 'warn', 'broken'].includes(r.status))) {
          throw Object.assign(new Error('점검 응답을 확인해 주세요.'), { code: 'INVALID_CHECK_RESPONSE' });
        }
        setResults((r) => [...r, ...res.results]);
        setProgress({ done: res.nextOffset, total: res.total });
        if (res.done) {
          setCompleted(true);
          break;
        }
        offset = res.nextOffset;
      }
    } catch (e) {
      if (!mounted.current) return;
      const detail = e?.code === 'INVALID_CHECK_RESPONSE'
        ? '자료 목록이 바뀌었거나 점검 응답이 올바르지 않아 중단했어요.'
        : e?.status >= 400 && e.status < 500 && e.message ? e.message : '연결 상태를 확인해 주세요.';
      setErr({ status: e?.status, code: e?.code, message: `점검을 완료하지 못했어요. ${detail} 중단된 요청도 일부 처리됐을 수 있어요. 전체 다시 점검을 누르면 처음부터 점검해요.` });
    } finally {
      pending.current = false;
      if (mounted.current) setRunning(false);
    }
  }
  const failed = results.filter((r) => r.status !== 'ok');
  const brokenCount = results.filter((r) => r.status === 'broken').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  return (
    <section className="card" aria-busy={running}>
      <h2>링크 점검</h2>
      <p className="muted">등록된 URL의 응답 상태만 확인합니다. 대상 사이트 부하를 줄이기 위해 요청 사이에 1초씩 기다려요. 점검 실패 자료는 사용자 목록에서 자동으로 숨겨집니다.</p>
      <button type="button" className="btn btn-primary" onClick={run} disabled={running}>
        {running ? '점검 중…' : started.current ? '전체 다시 점검' : '전체 점검 실행'}
      </button>
      {running && <p className="muted small">이미 요청한 묶음은 화면을 떠나도 서버에서 처리될 수 있어요.</p>}
      {progress ? (
        <p role="status">
          {completed && progress.total === 0 ? '점검할 자료가 없어요.' : <>
            {completed ? '전체 점검을 마쳤어요.' : err ? '점검 중단 · 마지막으로 확인된 결과:' : '점검 중:'}{' '}
            {progress.done}/{progress.total}건 점검 · 실패 {brokenCount}건 · 확인 필요 {warnCount}건
          </>}
        </p>
      ) : running ? <p role="status">점검을 시작하는 중이에요.</p> : err ? <p role="status">점검이 중단됐어요. 확인된 결과가 아직 없어요.</p> : null}
      <ErrorBox error={err} />
      {failed.length > 0 && (
        <ul className="note-list">
          {failed.map((r, i) => (
            <li key={`${r.id}-${i}`} className="note">
              <div>
                <strong>{r.title}</strong>{' '}
                <span className={`status st-${r.status}`}>{r.status === 'warn' ? '확인 필요' : '실패'}</span>{' '}
                {r.httpStatus ? `(HTTP ${r.httpStatus})` : r.error ? `(${{ timeout: '응답 시간 초과', network: '연결 실패' }[r.error] || '오류 확인 필요'})` : ''}
              </div>
              <div>
                <ExternalLink href={r.url}>{r.url}</ExternalLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExamsAdmin() {
  const q = useApi(() => api('/api/exams?all=1'), []);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const dirtyIds = useRef(new Set());
  const refreshContext = useRef(null);
  const controlsDisabled = !!busy || q.loading || !!q.error || !!refreshError;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (q.data) {
      dirtyIds.current.clear();
      setRows(q.data.items.map((e) => ({ ...e })));
    }
  }, [q.data]);

  function actionError(error, message) {
    const detail = error?.status >= 400 && error.status < 500 && error.message
      ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.';
    return { status: error?.status, code: error?.code, message: `${message} ${detail}` };
  }
  function canChange() {
    return mounted.current && !pending.current && !controlsDisabled;
  }
  function upd(i, k, v) {
    if (!canChange() || !rows[i]) return;
    if (rows[i].id) dirtyIds.current.add(rows[i].id);
    setErr(null);
    setOk('');
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  }
  function add() {
    if (!canChange()) return;
    setErr(null);
    setOk('');
    setRows((r) => [...r, { id: '', year: new Date().getFullYear() + 1, round: 1, type: 'written', examDate: '', source: 'Q-Net 공고' }]);
  }
  async function refreshExams(context) {
    try {
      const data = await api('/api/exams?all=1');
      if (!mounted.current) return;
      let next = data.items.map((r) => ({ ...r }));
      if (context.kind === 'delete') {
        // Keep unsaved edits and new rows while refreshing the other server records.
        const drafts = context.rows.filter((r) => !r.id || context.dirtyIds.has(r.id));
        const byId = new Map(drafts.filter((r) => r.id).map((r) => [r.id, r]));
        const serverIds = new Set(next.map((r) => r.id));
        next = next.map((r) => byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r);
        next.push(...drafts.filter((r) => !r.id || !serverIds.has(r.id)));
      }
      setRows(next);
      setRefreshError(null);
      refreshContext.current = null;
    } catch (error) {
      if (mounted.current) setRefreshError(actionError(error, '변경은 완료됐지만 최신 시험 일정을 불러오지 못했어요. 저장·삭제는 반복하지 않고 목록만 다시 확인해 주세요.'));
    }
  }
  async function runAction(action) {
    if (!canChange()) return;
    pending.current = true;
    setBusy({ ...action, phase: 'write' });
    setErr(null);
    setOk('');
    try {
      await api(action.kind === 'save' ? '/api/admin/masters' : `/api/admin/exams/${action.id}`, {
        method: action.kind === 'save' ? 'PUT' : 'DELETE', ...(action.kind === 'save' ? { body: { exams: action.exams } } : {}),
      });
      if (!mounted.current) return;
      const remaining = action.kind === 'save' ? action.exams : rows.filter((r) => r.id !== action.id);
      if (action.kind === 'save') dirtyIds.current.clear();
      else dirtyIds.current.delete(action.id);
      setRows(remaining);
      setOk(action.kind === 'save' ? '시험 일정을 저장했어요.' : '시험 일정을 삭제했어요. 다른 행의 미저장 입력은 유지돼요.');
      const context = { kind: action.kind, rows: remaining, dirtyIds: new Set(dirtyIds.current) };
      refreshContext.current = context;
      setBusy({ ...action, phase: 'refresh' });
      await refreshExams(context);
    } catch (error) {
      if (mounted.current) setErr({ ...actionError(error, action.kind === 'save' ? '시험 일정을 저장하지 못했어요.' : '시험 일정을 삭제하지 못했어요.'), action });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function save() {
    const exams = rows.map((r) => ({ ...r, id: r.id || `${r.year}-${r.round}-${r.type}`, year: Number(r.year), round: Number(r.round) }));
    return runAction({ kind: 'save', exams });
  }
  function remove(row, index) {
    if (!canChange()) return;
    if (!row.id) {
      setRows((r) => r.filter((_, i) => i !== index));
      setErr(null);
      setOk('아직 저장하지 않은 행을 지웠어요.');
      return;
    }
    if (!window.confirm(`${row.year}년 ${row.round}회 ${EXAM_TYPE[row.type]} 일정을 삭제할까요?`)) return;
    return runAction({ kind: 'delete', id: row.id });
  }
  function retryAction() {
    if (!err) return;
    if (err.action.kind === 'save') return save();
    const index = rows.findIndex((r) => r.id === err.action.id);
    if (index >= 0) return remove(rows[index], index);
  }
  async function retryRefresh() {
    if (!mounted.current || pending.current || !refreshContext.current) return;
    pending.current = true;
    setBusy({ kind: 'refresh', phase: 'refresh' });
    try {
      await refreshExams(refreshContext.current);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <div className="stack">
      <section className="card" style={{ minWidth: 0 }} aria-busy={!!busy}>
        <h2>시험 일정 마스터</h2>
        <p className="muted small">Q-Net 공고를 확인해 회차별 필기·실기 시험일을 입력하세요. 필기 CBT처럼 기간으로 공고되면 시작일을 시험일로 입력합니다.</p>
        {q.loading && <Loading />}
        <ErrorBox error={q.error ? actionError(q.error, '시험 일정을 불러오지 못했어요.') : null} onRetry={busy ? undefined : q.reload} />
        <ErrorBox error={refreshError} onRetry={busy ? undefined : retryRefresh} />
        {busy && <p className="muted small" role="status">{busy.phase === 'refresh' ? '최신 시험 일정을 확인하는 중이에요.' : busy.kind === 'save' ? '시험 일정을 저장하는 중이에요.' : '시험 일정을 삭제하는 중이에요.'}</p>}
        {q.data && !rows.length && <p className="muted">등록된 시험 일정이 없어요.</p>}
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th scope="col">연도</th>
                <th scope="col">회차</th>
                <th scope="col">구분</th>
                <th scope="col">시험일</th>
                <th scope="col">근거</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || `new-${i}`}>
                  <td>
                    <input type="number" value={r.year} onChange={(e) => upd(i, 'year', e.target.value)} aria-label="연도" className="in-sm" disabled={controlsDisabled} />
                  </td>
                  <td>
                    <input type="number" min="1" max="5" value={r.round} onChange={(e) => upd(i, 'round', e.target.value)} aria-label="회차" className="in-xs" disabled={controlsDisabled} />
                  </td>
                  <td>
                    <select value={r.type} onChange={(e) => upd(i, 'type', e.target.value)} aria-label="구분" disabled={controlsDisabled}>
                      <option value="written">필기</option>
                      <option value="practical">실기</option>
                    </select>
                  </td>
                  <td>
                    <input type="date" value={r.examDate} onChange={(e) => upd(i, 'examDate', e.target.value)} aria-label="시험일" disabled={controlsDisabled} />
                    <span className="muted small"> {r.examDate && formatDate(r.examDate)}</span>
                  </td>
                  <td>
                    <input value={r.source || ''} onChange={(e) => upd(i, 'source', e.target.value)} aria-label="근거" disabled={controlsDisabled} />
                  </td>
                  <td className="nowrap">
                    <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => remove(r, i)} disabled={controlsDisabled}>
                      {busy?.kind === 'delete' && busy.id === r.id ? '삭제 중…' : '삭제'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ErrorBox error={err} onRetry={busy ? undefined : retryAction} />
        {ok && <Notice tone="success" icon="check">{ok}</Notice>}
        <div className="row-between">
          <button type="button" className="btn btn-ghost" onClick={add} disabled={controlsDisabled}>
            + 일정 추가
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={controlsDisabled}>
            {busy?.kind === 'save' ? busy.phase === 'refresh' ? '목록 확인 중…' : '저장 중…' : '저장'}
          </button>
        </div>
      </section>
    </div>
  );
}

function SubjectsAdmin() {
  const q = useApi(() => api('/api/subjects'), []);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState('');
  const [phase, setPhase] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const controlsDisabled = !!phase || q.loading || !!q.error || !!refreshError;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function editorText(items) {
    return JSON.stringify(items.map(({ units, ...s }) => ({ ...s, units: units.map(({ subjectId, ...u }) => u) })), null, 2);
  }
  useEffect(() => {
    if (q.data) setText(editorText(q.data.items));
  }, [q.data]);
  function actionError(error, message) {
    const detail = error?.status >= 400 && error.status < 500 && error.message
      ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.';
    return { status: error?.status, code: error?.code, message: `${message} ${detail}` };
  }
  function change(e) {
    if (pending.current || controlsDisabled || !mounted.current) return;
    setText(e.target.value);
    setErr(null);
    setOk('');
  }
  async function refreshSubjects() {
    try {
      const data = await api('/api/subjects');
      if (!mounted.current) return;
      setText(editorText(data.items));
      setRefreshError(null);
    } catch (error) {
      if (mounted.current) setRefreshError(actionError(error, '저장은 완료됐지만 최신 과목·단원을 불러오지 못했어요. 다시 시도를 누르면 목록만 불러와요.'));
    }
  }
  async function save() {
    if (pending.current || controlsDisabled || !mounted.current) return;
    setErr(null);
    setOk('');
    let subjects;
    try {
      subjects = JSON.parse(text);
    } catch {
      return setErr({ syntax: true, message: 'JSON 형식이 올바르지 않아요.' });
    }
    pending.current = true;
    setPhase('save');
    try {
      await api('/api/admin/masters', { method: 'PUT', body: { subjects } });
      if (!mounted.current) return;
      setOk('과목·단원 마스터를 저장했어요. 코드 수정 없이 바로 반영됩니다.');
      setPhase('refresh');
      // Retry the read, not the committed master update, if refreshing fails.
      await refreshSubjects();
    } catch (error) {
      if (mounted.current) setErr(actionError(error, '과목·단원을 저장하지 못했어요.'));
    } finally {
      pending.current = false;
      if (mounted.current) setPhase(null);
    }
  }
  async function retryRefresh() {
    if (pending.current || !mounted.current || !refreshError) return;
    pending.current = true;
    setPhase('refresh');
    try {
      await refreshSubjects();
    } finally {
      pending.current = false;
      if (mounted.current) setPhase(null);
    }
  }
  return (
    <section className="card" aria-busy={!!phase || q.loading}>
      <h2>과목·단원 마스터</h2>
      <p className="muted small">
        과목(id, name, examType, order, tags[])과 단원(id, name, order, standardHours, core, tags[])을 수정합니다. 출제기준이 바뀌거나 다른 자격증을 추가할 때 코드 변경 없이 여기서 교체해요. 목록에서 뺀 단원은 삭제됩니다.
      </p>
      {q.loading && <Loading />}
      <ErrorBox error={q.error ? actionError(q.error, '과목·단원을 불러오지 못했어요.') : null} onRetry={phase ? undefined : q.reload} />
      <ErrorBox error={refreshError} onRetry={phase ? undefined : retryRefresh} />
      {phase && <p className="muted small" role="status">{phase === 'save' ? '과목·단원을 저장하는 중이에요.' : '최신 과목·단원을 확인하는 중이에요.'}</p>}
      <textarea className="code-area" value={text} onChange={change} rows={22} spellCheck={false} aria-label="과목·단원 JSON" disabled={controlsDisabled} />
      <ErrorBox error={err} onRetry={phase || err?.syntax ? undefined : save} />
      {ok && <Notice tone="success" icon="check">{ok}</Notice>}
      <div className="row-end">
        <button type="button" className="btn btn-primary" onClick={save} disabled={controlsDisabled}>
          {phase === 'save' ? '저장 중…' : phase === 'refresh' ? '목록 확인 중…' : '저장'}
        </button>
      </div>
    </section>
  );
}

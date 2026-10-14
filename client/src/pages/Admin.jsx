// UC-08 학습 자료·마스터 관리
import { useEffect, useState } from 'react';
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
  const [ok, setOk] = useState('');
  const subject = subjects.data?.items.find((s) => s.id === form.subjectId);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, ...(k === 'subjectId' ? { unitIds: [] } : {}) }));

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setOk('');
    const body = { ...form, subjectId: form.subjectId || null, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    try {
      if (editing) await api(`/api/admin/materials/${editing}`, { method: 'PUT', body });
      else await api('/api/admin/materials', { method: 'POST', body });
      setOk(editing ? '수정했어요.' : '등록했어요.');
      setForm(EMPTY);
      setEditing(null);
      list.reload();
    } catch (e2) {
      setErr(e2);
    }
  }
  function edit(m) {
    setEditing(m.id);
    setForm({ ...m, subjectId: m.subjectId || '', tags: (m.tags || []).join(', ') });
    window.scrollTo({ top: 0 });
  }
  async function remove(m) {
    if (!window.confirm(`'${m.title}' 자료를 삭제할까요?`)) return;
    await api(`/api/admin/materials/${m.id}`, { method: 'DELETE' });
    list.reload();
  }
  async function toggleVisible(m) {
    const { id, linkStatus, linkCheckedAt, ...rest } = m;
    await api(`/api/admin/materials/${id}`, { method: 'PUT', body: { ...rest, visible: !m.visible } });
    list.reload();
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>{editing ? '자료 수정' : '자료 등록'}</h2>
        <form className="form grid-form" onSubmit={submit}>
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
            <ErrorBox error={err} />
            {ok && <Notice tone="success" icon="check">{ok}</Notice>}
            <div className="row-end">
              {editing && (
                <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setForm(EMPTY); }}>
                  취소
                </button>
              )}
              <button type="submit" className="btn btn-primary">
                {editing ? '수정 저장' : '등록'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>등록된 자료 {list.data ? `(${list.data.items.length})` : ''}</h2>
        {list.loading && <Loading />}
        <ErrorBox error={list.error} onRetry={list.reload} />
        <div className="table-wrap">
          <table className="table">
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
                <tr key={m.id}>
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
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggleVisible(m)}>
                      {m.visible ? '공개' : '비공개'}
                    </button>
                  </td>
                  <td className="nowrap">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit(m)}>
                      수정
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => remove(m)}>
                      삭제
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

  async function run() {
    setRunning(true);
    setErr(null);
    setResults([]);
    let offset = 0;
    try {
      for (;;) {
        const res = await api('/api/admin/link-check', { method: 'POST', body: { offset, limit: 10 } });
        setResults((r) => [...r, ...res.results]);
        setProgress({ done: res.nextOffset, total: res.total });
        if (res.done) break;
        offset = res.nextOffset;
      }
    } catch (e) {
      setErr(e);
    } finally {
      setRunning(false);
    }
  }
  const failed = results.filter((r) => r.status !== 'ok');
  return (
    <section className="card">
      <h2>링크 점검</h2>
      <p className="muted">등록된 URL의 응답 상태만 확인합니다. 대상 사이트 부하를 줄이기 위해 요청 사이에 1초씩 기다려요. 점검 실패 자료는 사용자 목록에서 자동으로 숨겨집니다.</p>
      <button type="button" className="btn btn-primary" onClick={run} disabled={running}>
        {running ? '점검 중…' : '전체 점검 실행'}
      </button>
      {progress && (
        <p aria-live="polite">
          {progress.done}/{progress.total}건 점검 · 문제 {failed.length}건
        </p>
      )}
      <ErrorBox error={err} />
      {failed.length > 0 && (
        <ul className="note-list">
          {failed.map((r) => (
            <li key={r.id} className="note">
              <strong>{r.title}</strong> — <span className={`status st-${r.status}`}>{r.status === 'warn' ? '확인 필요' : '실패'}</span> {r.httpStatus ? `(HTTP ${r.httpStatus})` : r.error ? `(${r.error})` : ''}
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
  useEffect(() => {
    if (q.data) setRows(q.data.items.map((e) => ({ ...e })));
  }, [q.data]);

  const upd = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function save() {
    setErr(null);
    setOk('');
    try {
      const exams = rows.map((r) => ({ ...r, id: r.id || `${r.year}-${r.round}-${r.type}`, year: Number(r.year), round: Number(r.round) }));
      await api('/api/admin/masters', { method: 'PUT', body: { exams } });
      setOk('시험 일정을 저장했어요.');
      q.reload();
    } catch (e) {
      setErr(e);
    }
  }
  async function remove(row) {
    if (!row.id || !window.confirm(`${row.year}년 ${row.round}회 ${EXAM_TYPE[row.type]} 일정을 삭제할까요?`)) return;
    await api(`/api/admin/exams/${row.id}`, { method: 'DELETE' });
    q.reload();
  }

  return (
    <section className="card">
      <h2>시험 일정 마스터</h2>
      <p className="muted small">Q-Net 공고를 확인해 회차별 필기·실기 시험일을 입력하세요. 필기 CBT처럼 기간으로 공고되면 시작일을 시험일로 입력합니다.</p>
      {q.loading && <Loading />}
      <div className="table-wrap">
        <table className="table">
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
                  <input type="number" value={r.year} onChange={(e) => upd(i, 'year', e.target.value)} aria-label="연도" className="in-sm" />
                </td>
                <td>
                  <input type="number" min="1" max="5" value={r.round} onChange={(e) => upd(i, 'round', e.target.value)} aria-label="회차" className="in-xs" />
                </td>
                <td>
                  <select value={r.type} onChange={(e) => upd(i, 'type', e.target.value)} aria-label="구분">
                    <option value="written">필기</option>
                    <option value="practical">실기</option>
                  </select>
                </td>
                <td>
                  <input type="date" value={r.examDate} onChange={(e) => upd(i, 'examDate', e.target.value)} aria-label="시험일" />
                  <span className="muted small"> {r.examDate && formatDate(r.examDate)}</span>
                </td>
                <td>
                  <input value={r.source || ''} onChange={(e) => upd(i, 'source', e.target.value)} aria-label="근거" />
                </td>
                <td>
                  <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => remove(r)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorBox error={err} />
      {ok && <Notice tone="success" icon="check">{ok}</Notice>}
      <div className="row-between">
        <button type="button" className="btn btn-ghost" onClick={() => setRows((r) => [...r, { id: '', year: new Date().getFullYear() + 1, round: 1, type: 'written', examDate: '', source: 'Q-Net 공고' }])}>
          + 일정 추가
        </button>
        <button type="button" className="btn btn-primary" onClick={save}>
          저장
        </button>
      </div>
    </section>
  );
}

function SubjectsAdmin() {
  const q = useApi(() => api('/api/subjects'), []);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState('');
  useEffect(() => {
    if (q.data) setText(JSON.stringify(q.data.items.map(({ units, ...s }) => ({ ...s, units: units.map(({ subjectId, ...u }) => u) })), null, 2));
  }, [q.data]);
  async function save() {
    setErr(null);
    setOk('');
    let subjects;
    try {
      subjects = JSON.parse(text);
    } catch {
      return setErr({ message: 'JSON 형식이 올바르지 않아요.' });
    }
    try {
      await api('/api/admin/masters', { method: 'PUT', body: { subjects } });
      setOk('과목·단원 마스터를 저장했어요. 코드 수정 없이 바로 반영됩니다.');
      q.reload();
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <section className="card">
      <h2>과목·단원 마스터</h2>
      <p className="muted small">
        과목(id, name, examType, order, tags[])과 단원(id, name, order, standardHours, core, tags[])을 수정합니다. 출제기준이 바뀌거나 다른 자격증을 추가할 때 코드 변경 없이 여기서 교체해요. 목록에서 뺀 단원은 삭제됩니다.
      </p>
      {q.loading && <Loading />}
      <textarea className="code-area" value={text} onChange={(e) => setText(e.target.value)} rows={22} spellCheck={false} aria-label="과목·단원 JSON" />
      <ErrorBox error={err} />
      {ok && <Notice tone="success" icon="check">{ok}</Notice>}
      <div className="row-end">
        <button type="button" className="btn btn-primary" onClick={save}>
          저장
        </button>
      </div>
    </section>
  );
}

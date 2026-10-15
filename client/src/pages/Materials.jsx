// UC-07 학습 자료 허브
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { EXAM_TYPE, MATERIAL_TYPE, STAGE } from '../lib/format';
import { EmptyState, ErrorBox, ExternalLink, Loading, PageHeader } from '../components/ui';
import SignupPrompt from '../components/SignupPrompt';
import Icon from '../components/Icon';

const FILTER_STORAGE_KEY = 'jcm.materials.filters';
const FILTER_KEYS = ['q', 'subjectId', 'type', 'stage', 'bookmarked'];

function readFilters(search) {
  const params = new URLSearchParams(search);
  const type = params.get('type') || '';
  const stage = params.get('stage') || '';
  return {
    q: (params.get('q') || '').trim().slice(0, 50),
    subjectId: params.get('subjectId') || '',
    type: Object.hasOwn(MATERIAL_TYPE, type) ? type : '',
    stage: Object.hasOwn(STAGE, stage) ? stage : '',
    bookmarked: params.get('bookmarked') === '1',
  };
}

function filterSearch(filters) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, key === 'bookmarked' ? '1' : value);
  }
  return params.toString();
}

function initialSearch(location) {
  const params = new URLSearchParams(location.search);
  if (FILTER_KEYS.some((key) => params.has(key)) || location.state?.materialsFilters) return location.search;
  try {
    return sessionStorage.getItem(FILTER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function rememberFilters(search) {
  try {
    if (search) sessionStorage.setItem(FILTER_STORAGE_KEY, search);
    else sessionStorage.removeItem(FILTER_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted browsers; the URL still works.
  }
}

function useMaterialFilters() {
  const location = useLocation();
  const navigate = useNavigate();
  const [entry] = useState(() => ({ key: location.key, search: initialSearch(location) }));
  const filters = readFilters(location.key === entry.key ? entry.search : location.search);
  const search = filterSearch(filters);
  const [qInput, setQInput] = useState(filters.q);

  function updateFilters(next, replace = false) {
    const nextSearch = filterSearch(next);
    rememberFilters(nextSearch);
    navigate({ pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '', hash: location.hash }, {
      replace,
      state: { ...location.state, materialsFilters: true },
    });
  }

  useLayoutEffect(() => {
    // Mark even an empty history entry so Back does not restore newer session filters.
    if (location.key === entry.key && !location.state?.materialsFilters) updateFilters(filters, true);
    setQInput(filters.q);
  }, [location.key]);

  useEffect(() => rememberFilters(search), [search]);

  useEffect(() => {
    if (qInput.trim() === filters.q) return undefined;
    const t = setTimeout(() => updateFilters({ ...filters, q: qInput.trim() }), 300);
    return () => clearTimeout(t);
  }, [qInput, location.key]);

  const set = (key) => (e) => updateFilters({
    ...filters,
    q: qInput.trim(),
    [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  });
  function reset() {
    setQInput('');
    updateFilters(readFilters(''));
  }
  return { filters, qInput, setQInput, set, reset };
}

function applyBookmarkChanges(data, changes, onlyBookmarked) {
  const items = data.items
    .map((item) => changes.has(item.id) ? { ...item, bookmarked: changes.get(item.id) } : item)
    .filter((item) => !onlyBookmarked || item.bookmarked);
  return { ...data, items, total: items.length };
}

export default function Materials() {
  const { user } = useAuth();
  const uid = user?.uid || '';
  const { filters, qInput, setQInput, set, reset } = useMaterialFilters();
  const [prompt, setPrompt] = useState(false);
  const [open, setOpen] = useState(null);
  const [actions, setActions] = useState({});
  const mounted = useRef(false);
  const bookmarks = useRef({ uid, revision: 0, changes: new Map(), pending: new Set() });
  if (bookmarks.current.uid !== uid) bookmarks.current = { uid, revision: 0, changes: new Map(), pending: new Set() };
  const subjects = useApi(() => api('/api/subjects'), []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => setActions({}), [uid]);

  const params = new URLSearchParams();
  if (filters.subjectId) params.set('subjectId', filters.subjectId);
  if (filters.type) params.set('type', filters.type);
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.q) params.set('q', filters.q);
  if (filters.bookmarked && user) params.set('bookmarked', '1');
  const query = params.toString();
  const onlyBookmarked = !!(filters.bookmarked && user);

  async function loadMaterials() {
    const context = bookmarks.current;
    const revision = context.revision;
    const result = await api(`/api/materials?${query}`);
    // A read started before a successful write must not put the old bookmark back.
    const changes = new Map([...context.changes]
      .filter(([, change]) => change.revision > revision)
      .map(([id, change]) => [id, change.bookmarked]));
    return { ...applyBookmarkChanges(result, changes, onlyBookmarked), query, uid, onlyBookmarked };
  }
  const list = useApi(loadMaterials, [query, uid]);
  const data = list.data?.query === query && list.data?.uid === uid ? list.data : null;

  async function toggleBookmark(m, desired = !m.bookmarked) {
    if (!user) return setPrompt(true);
    const context = bookmarks.current;
    if (context.pending.has(m.id)) return;
    context.pending.add(m.id);
    setActions((a) => ({ ...a, [m.id]: { uid, pending: true, desired, error: null } }));
    const isCurrent = () => mounted.current && bookmarks.current === context;
    try {
      if (desired) await api('/api/bookmarks', { method: 'POST', body: { materialId: m.id } });
      else await api(`/api/bookmarks/${m.id}`, { method: 'DELETE' });
      if (!isCurrent()) return;
      context.changes.set(m.id, { bookmarked: desired, revision: ++context.revision });
      list.setData((d) => !d || d.uid !== uid ? d : applyBookmarkChanges(d, new Map([[m.id, desired]]), d.onlyBookmarked));
      list.reload();
      setActions((a) => ({ ...a, [m.id]: { uid, pending: false, error: null } }));
    } catch (error) {
      if (!isCurrent()) return;
      const message = `북마크 ${desired ? '저장' : '해제'}에 실패했어요. ${error.status === 401
        ? '다시 로그인한 뒤 시도해 주세요.'
        : '연결 상태를 확인한 뒤 다시 시도를 눌러 주세요.'}`;
      setActions((a) => ({ ...a, [m.id]: { uid, pending: false, desired, error: { status: error.status, message } } }));
    } finally {
      context.pending.delete(m.id);
    }
  }

  const subjectName = (id) => subjects.data?.items.find((s) => s.id === id)?.name || '공통';
  const groups = ['written', 'practical'].map((t) => ({ t, items: (subjects.data?.items || []).filter((s) => s.examType === t) }));

  return (
    <div className="stack">
      <PageHeader title="학습 자료 허브" desc="유튜브·블로그·CBT·공식 문서에 흩어진 공개 자료를 과목·유형·학습 단계별로 모았어요. 자료는 원저작자 사이트에서 열립니다." />
      <div className="filters filters-wide" role="search">
        <label className="field search-field">
          <span className="sr-only">검색어</span>
          <Icon name="search" size={18} />
          <input type="search" placeholder="제목·태그 검색 (예: SQL, 디자인 패턴)" value={qInput} onChange={(e) => setQInput(e.target.value)} maxLength={50} />
        </label>
        <label className="field">
          <span className="sr-only">과목</span>
          <select value={filters.subjectId} onChange={set('subjectId')}>
            <option value="">전체 과목</option>
            <option value="common">공통</option>
            {groups.map((g) => (
              <optgroup key={g.t} label={EXAM_TYPE[g.t]}>
                {g.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">유형</span>
          <select value={filters.type} onChange={set('type')}>
            <option value="">전체 유형</option>
            {Object.entries(MATERIAL_TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">학습 단계</span>
          <select value={filters.stage} onChange={set('stage')}>
            <option value="">전체 단계</option>
            {Object.entries(STAGE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {user && (
          <label className="check-row">
            <input type="checkbox" checked={filters.bookmarked} onChange={set('bookmarked')} />
            <span>북마크만</span>
          </label>
        )}
        <button type="button" className="icon-btn" onClick={reset} aria-label="필터 초기화" title="필터 초기화">
          <Icon name="close" />
        </button>
      </div>

      {list.loading && <Loading lines={4} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      {data && (
        <>
          <p className="muted small" aria-live="polite">
            자료 {data.total}건
          </p>
          {data.items.length === 0 ? (
            <EmptyState title="조건에 맞는 자료가 없어요">검색어를 바꾸거나 필터를 줄여 보세요.</EmptyState>
          ) : (
            <ul className="material-grid">
              {data.items.map((m) => {
                const action = actions[m.id]?.uid === uid ? actions[m.id] : null;
                const pendingLabel = `북마크 ${action?.desired ? '저장' : '해제'} 중`;
                return (
                  <li key={m.id} className="material-card">
                    <div className="mc-head">
                      <span className="tag tag-teal">{MATERIAL_TYPE[m.type]}</span>
                      <span className="tag tag-soft">{STAGE[m.stage]}</span>
                      <span className="tag">{subjectName(m.subjectId)}</span>
                      <button
                        type="button"
                        className={`icon-btn bm ${m.bookmarked ? 'on' : ''}`}
                        onClick={() => toggleBookmark(m)}
                        disabled={action?.pending}
                        aria-busy={!!action?.pending}
                        aria-pressed={m.bookmarked}
                        aria-label={action?.pending ? pendingLabel : m.bookmarked ? '북마크 해제' : '북마크'}
                        title={action?.pending ? pendingLabel : m.bookmarked ? '북마크 해제' : '북마크'}
                      >
                        <Icon name="bookmark" />
                      </button>
                    </div>
                    <h3>{m.title}</h3>
                    <p className="mc-src">
                      출처 {m.sourceName} · {m.author}
                    </p>
                    {action?.pending && <p className="muted small" role="status">{pendingLabel}…</p>}
                    <ErrorBox error={action?.error} onRetry={() => toggleBookmark(m, action.desired)} />
                    <button type="button" className="link-btn small" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                      {open === m.id ? '상세 닫기' : '추천 이유 보기'}
                    </button>
                    {open === m.id && (
                      <div className="mc-detail">
                        <p>{m.reason}</p>
                        {m.tags?.length > 0 && <p className="muted small">태그: {m.tags.join(', ')}</p>}
                      </div>
                    )}
                    <ExternalLink href={m.url} className="btn btn-outline btn-sm mc-open">
                      자료 열기
                    </ExternalLink>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <SignupPrompt open={prompt} onClose={() => setPrompt(false)} reason="자료를 북마크하려면" />
    </div>
  );
}

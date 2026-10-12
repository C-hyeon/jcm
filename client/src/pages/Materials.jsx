// UC-07 학습 자료 허브 — 메타데이터·출처·링크만 제공, 원문은 새 탭에서 원저작자 사이트로 이동
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { EXAM_TYPE, MATERIAL_TYPE, STAGE } from '../lib/format';
import { EmptyState, ErrorBox, ExternalLink, Loading, PageHeader } from '../components/ui';
import SignupPrompt from '../components/SignupPrompt';
import Icon from '../components/Icon';

export default function Materials() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ subjectId: '', type: '', stage: '', bookmarked: false });
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [prompt, setPrompt] = useState(false);
  const [open, setOpen] = useState(null);
  const subjects = useApi(() => api('/api/subjects'), []);

  // 입력 후 300ms 뒤 검색
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = new URLSearchParams();
  if (filters.subjectId) params.set('subjectId', filters.subjectId);
  if (filters.type) params.set('type', filters.type);
  if (filters.stage) params.set('stage', filters.stage);
  if (q) params.set('q', q);
  if (filters.bookmarked && user) params.set('bookmarked', '1');
  const list = useApi(() => api(`/api/materials?${params}`), [params.toString(), !!user]);

  async function toggleBookmark(m) {
    if (!user) return setPrompt(true);
    if (m.bookmarked) await api(`/api/bookmarks/${m.id}`, { method: 'DELETE' });
    else await api('/api/bookmarks', { method: 'POST', body: { materialId: m.id } });
    list.setData((d) => ({ ...d, items: d.items.map((x) => (x.id === m.id ? { ...x, bookmarked: !m.bookmarked } : x)) }));
  }

  const subjectName = (id) => subjects.data?.items.find((s) => s.id === id)?.name || '공통';
  const groups = ['written', 'practical'].map((t) => ({ t, items: (subjects.data?.items || []).filter((s) => s.examType === t) }));
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

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
      </div>

      {list.loading && <Loading lines={4} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.data && (
        <>
          <p className="muted small" aria-live="polite">
            자료 {list.data.total}건
          </p>
          {list.data.items.length === 0 ? (
            <EmptyState title="조건에 맞는 자료가 없어요">검색어를 바꾸거나 필터를 줄여 보세요.</EmptyState>
          ) : (
            <ul className="material-grid">
              {list.data.items.map((m) => (
                <li key={m.id} className="material-card">
                  <div className="mc-head">
                    <span className="tag tag-teal">{MATERIAL_TYPE[m.type]}</span>
                    <span className="tag tag-soft">{STAGE[m.stage]}</span>
                    <span className="tag">{subjectName(m.subjectId)}</span>
                    <button
                      type="button"
                      className={`icon-btn bm ${m.bookmarked ? 'on' : ''}`}
                      onClick={() => toggleBookmark(m)}
                      aria-pressed={m.bookmarked}
                      aria-label={m.bookmarked ? '북마크 해제' : '북마크'}
                    >
                      <Icon name="bookmark" />
                    </button>
                  </div>
                  <h3>{m.title}</h3>
                  <p className="mc-src">
                    출처 {m.sourceName} · {m.author}
                  </p>
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
              ))}
            </ul>
          )}
        </>
      )}
      <SignupPrompt open={prompt} onClose={() => setPrompt(false)} reason="자료를 북마크하려면" />
    </div>
  );
}

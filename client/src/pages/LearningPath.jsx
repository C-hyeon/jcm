// 학습 경로 : 취약 과목을 확인하고 관련 자료를 학습 단계 순서대로 안내
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { MATERIAL_TYPE, pct } from '../lib/format';
import { EmptyState, ErrorBox, ExternalLink, Loading, PageHeader, ProgressBar } from '../components/ui';

function materialsLink(subjectId, stage, type) {
  const params = new URLSearchParams({ subjectId });
  if (stage) params.set('stage', stage);
  if (type) params.set('type', type);
  return `/materials?${params}`;
}

export default function LearningPath() {
  const [params, setParams] = useSearchParams();
  const subjectId = params.get('subjectId') || '';
  const q = useApi(() => api(`/api/learning-path${subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ''}`), [subjectId]);

  const d = q.loading || q.error ? null : q.data;

  return (
    <div className="stack">
      <PageHeader
        title="학습 경로"
        desc="취약 비중과 진도를 함께 보고 지금 보강할 과목을 고른 뒤, 자료를 입문 → 개념 → 문제 풀이 → 총정리 순서로 안내해요."
        actions={d && (
          <label className="field">
            <span className="sr-only">과목 선택</span>
            <select value={d.subject.id} onChange={(e) => setParams({ subjectId: e.target.value })}>
              {d.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (진도 {s.rate}%{s.weakShare ? ` · 취약 ${s.weakShare}%` : ''})
                </option>
              ))}
            </select>
          </label>
        )}
      />

      {q.loading && <Loading lines={6} />}
      {q.error && (
        <>
          <ErrorBox error={q.error} onRetry={q.reload} />
          {subjectId && q.error.status !== 401 && (
            <div className="row-end">
              <Link to="/path" className="btn btn-outline">추천 과목으로 돌아가기</Link>
            </div>
          )}
        </>
      )}
      {d && (
        <>
          <section className="card focus-card">
            <p className="eyebrow">{subjectId ? '선택한 과목' : '지금 보강할 과목'}</p>
            <h2>{d.subject.name}</h2>
            <p>{d.reason}</p>
            <ProgressBar value={d.subject.rate} label={`${d.subject.name} 진도율`} />
            <p className="muted small">진도율 {pct(d.subject.rate)}</p>
            {d.focusUnits.length > 0 && (
              <>
                <h3 className="h3">먼저 볼 단원</h3>
                <ul className="chips">
                  {d.focusUnits.map((u) => (
                    <li key={u.id} className={`chip ${u.needsReview ? 'warn' : ''}`}>
                      {u.name} · {u.rate}%{u.needsReview ? ' · 복습 필요' : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {d.steps.length === 0 ? (
            <EmptyState title="이 과목에 등록된 자료가 아직 없어요" action={<Link to={materialsLink(d.subject.id)} className="btn btn-outline">자료 허브 둘러보기</Link>} />
          ) : (
            <ol className="path-steps">
              {d.steps.map((st) => {
                const hasCommonCbt = st.materials.some((m) => !m.subjectId && m.type === 'cbt');
                const hasSubjectMaterials = st.materials.some((m) => m.subjectId === d.subject.id);
                return (
                  <li key={st.stage} className="path-step">
                    <div className="ps-num" aria-hidden>
                      {st.step}
                    </div>
                    <div className="ps-body">
                      <h3>
                        {st.step}단계 · {st.label}
                      </h3>
                      <ul className="mat-links">
                        {st.materials.map((m) => (
                          <li key={m.id} className={m.highlight ? 'hl' : ''}>
                            <ExternalLink href={m.url}>
                              <span className="tag tag-soft">{MATERIAL_TYPE[m.type]}</span>
                              <span className="mat-title">{m.title}</span>
                            </ExternalLink>
                            <span className="mat-src">출처: {m.sourceName}</span>
                            {m.highlight && <span className="tag tag-amber">취약 유형 관련</span>}
                            <p className="muted small">{m.reason}</p>
                          </li>
                        ))}
                      </ul>
                      <div className="row-end">
                        {(!hasCommonCbt || hasSubjectMaterials) && (
                          <Link to={materialsLink(d.subject.id, st.stage)} className="btn btn-ghost">
                            {hasCommonCbt ? '과목 자료 더 보기' : '이 단계 자료 더 보기'}
                          </Link>
                        )}
                        {hasCommonCbt && (
                          <Link to={materialsLink('common', st.stage, 'cbt')} className="btn btn-ghost">공통 CBT 자료 보기</Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

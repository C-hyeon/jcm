// UC-10 학습 현황 시각화
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { formatDate, pct } from '../lib/format';
import { EmptyState, ErrorBox, Loading, PageHeader } from '../components/ui';

const C = { primary: '#0f5c55', accent: '#c2410c', soft: '#94a3b8', grid: '#e7e5df', ink: '#334155' };
const shortDate = (d) => formatDate(d, false).replace('월 ', '/').replace('일', '');

export default function Dashboard() {
  const [period, setPeriod] = useState('4w');
  const q = useApi(() => api(`/api/stats?period=${period}`), [period]);

  return (
    <div className="stack">
      <PageHeader
        title="학습 현황"
        desc="진도율, 잔여 학습량, 과목별 취약도, 주간 달성률로 남은 준비 상태를 확인하세요."
        actions={
          <div className="seg seg-sm" role="radiogroup" aria-label="기간">
            {[
              ['4w', '최근 4주'],
              ['all', '전체'],
            ].map(([v, l]) => (
              <label key={v} className={`seg-item ${period === v ? 'on' : ''}`}>
                <input type="radio" name="period" checked={period === v} onChange={() => setPeriod(v)} />
                {l}
              </label>
            ))}
          </div>
        }
      />
      {q.loading && <Loading lines={6} />}
      <ErrorBox error={q.error} onRetry={q.reload} />
      {q.data && (q.data.empty ? <Empty /> : <Charts d={q.data} />)}
    </div>
  );
}

function Empty() {
  return (
    <EmptyState
      title="아직 표시할 학습 데이터가 없어요"
      action={
        <div className="row-center">
          <Link className="btn btn-primary" to="/progress">
            진도 입력하기
          </Link>
          <Link className="btn btn-outline" to="/wrong-notes">
            오답 기록하기
          </Link>
        </div>
      }
    >
      진도를 체크하거나 오답을 기록하면 차트가 채워져요.
    </EmptyState>
  );
}

function ChartCard({ title, children, summary }) {
  return (
    <section className="card chart-card">
      <h2>{title}</h2>
      {summary && <p className="muted small">{summary}</p>}
      <div className="chart-box">{children}</div>
    </section>
  );
}

function Charts({ d }) {
  const weekly = d.weekly.map((w) => ({ ...w, label: shortDate(w.week), rateVal: w.rate ?? 0 }));
  const remaining = d.remaining.map((r) => ({ ...r, label: shortDate(r.week) }));
  const subjH = Math.max(220, d.subjects.length * 34);
  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">전체 진도율</span>
          <span className="stat-val">{pct(d.summary.overall)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">잔여 학습량</span>
          <span className="stat-val">{d.summary.remainingHours}시간</span>
        </div>
        <div className="stat">
          <span className="stat-label">기간 내 완료 과제</span>
          <span className="stat-val">
            {d.summary.doneTasks}/{d.summary.scheduledTasks}
          </span>
        </div>
      </div>

      <div className="grid-2">
        <ChartCard title="과목별 진도율">
          <ResponsiveContainer width="100%" height={subjH}>
            <BarChart data={d.subjects} layout="vertical" margin={{ left: 8, right: 48 }}>
              <CartesianGrid horizontal={false} stroke={C.grid} />
              <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => [`${v}%`, '진도율']} cursor={{ fill: 'rgba(15,92,85,0.06)' }} />
              <Bar dataKey="rate" fill={C.primary} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList dataKey="rate" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 12, fill: C.ink }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="유형별 취약도" summary="최근 2주 동안의 오답은 더 중요하게 반영하고, 복습을 마친 오답은 덜 반영해 취약 유형을 알려드려요.">
          {d.weakness.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, d.weakness.length * 34)}>
              <BarChart data={d.weakness} layout="vertical" margin={{ left: 8, right: 56 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v, _n, p) => [`${v}% (${p.payload.count}건)`, p.payload.subjectName]} />
                <Bar dataKey="score" fill={C.accent} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  <LabelList dataKey="score" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 12, fill: C.ink }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">오답 기록이 없어요.</p>
          )}
        </ChartCard>
      </div>

      {remaining.length > 0 && (
        <ChartCard title="남은 배정 학습 시간 추이" summary="스케줄에 배정된 학습 시간 중 남은 양 — 계획대로 진행했을 때(점선)와 실제 완료 기준(실선)">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={remaining} margin={{ top: 16, right: 24, left: 0 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => `${v}h`} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v, n) => [`${v}시간`, n]} />
              <Legend />
              <Line type="monotone" dataKey="plannedHours" name="계획" stroke={C.soft} strokeDasharray="5 4" strokeWidth={2} dot isAnimationActive={false} />
              <Line type="monotone" dataKey="actualHours" name="실제" stroke={C.primary} strokeWidth={2.5} dot isAnimationActive={false}>
                <LabelList dataKey="actualHours" position="top" formatter={(v) => `${v}h`} style={{ fontSize: 11, fill: C.ink }} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <ChartCard title="주간 달성률" summary="주별 배정 과제 중 완료한 비율">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={weekly} margin={{ top: 20, right: 16, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v, _n, p) => [p.payload.rate == null ? '배정 없음' : `${v}% (${p.payload.done}/${p.payload.scheduled})`, '달성률']} />
            <Bar dataKey="rateVal" fill={C.primary} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="rate" position="top" formatter={(v) => (v == null ? '-' : `${v}%`)} style={{ fontSize: 12, fill: C.ink }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </>
  );
}

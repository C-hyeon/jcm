// UC-01 프로필 관리·로그아웃·회원 탈퇴
import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { EXAM_TYPE, formatDate } from '../lib/format';
import { ErrorBox, Loading, Notice, PageHeader } from '../components/ui';

function ProfileForm({ user, me, refreshMe, exams }) {
  const initial = me?.uid === user?.uid && typeof me?.nickname === 'string' ? me : null;
  const [draft, setDraft] = useState({ nickname: initial?.nickname || '', targetExamId: initial?.targetExamId || '' });
  const [ready, setReady] = useState(!!initial);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle');
  const pending = useRef(false);
  const mounted = useRef(true);
  const dirty = useRef(false);
  const written = useRef(false);
  const items = exams.data?.items || [];
  const missingExam = draft.targetExamId && !items.some((x) => x.id === draft.targetExamId);
  const refreshOnly = phase === 'refreshFailed';
  const locked = busy || refreshOnly || !ready;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (me?.uid === user?.uid && typeof me?.nickname === 'string' && !dirty.current && !pending.current) applyProfile(me);
  }, [me, user?.uid]);

  function applyProfile(data) {
    if (!data || data.uid !== user?.uid || typeof data.nickname !== 'string') {
      throw new Error('프로필 정보를 확인하지 못했어요. 다시 불러와 주세요.');
    }
    setDraft({ nickname: data.nickname, targetExamId: data.targetExamId || '' });
    setReady(true);
    dirty.current = false;
  }

  function edit(field, value) {
    if (pending.current || written.current || !ready) return;
    dirty.current = true;
    setDraft((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
    setErr(null);
  }

  async function readProfile() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setErr(null);
    try {
      const data = await refreshMe();
      if (mounted.current) applyProfile(data);
    } catch (error) {
      if (mounted.current) setErr(error);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function save(e) {
    e?.preventDefault();
    if (pending.current || !ready) return;
    const nickname = draft.nickname.trim();
    if (!written.current) {
      if (nickname.length < 2 || nickname.length > 20) {
        setSaved(false);
        setErr({ message: '닉네임은 공백을 제외하고 2~20자로 입력해 주세요.' });
        return;
      }
      if (draft.targetExamId && (exams.loading || exams.error || missingExam)) {
        setSaved(false);
        setErr({ message: '시험 회차 목록을 확인한 뒤 목표 회차를 다시 선택해 주세요.' });
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      if (!written.current) {
        setPhase('writing');
        await api('/api/me', { method: 'PUT', body: { nickname, targetExamId: draft.targetExamId || null } });
        if (!mounted.current) return;
        // A confirmed write is never repeated when only the follow-up read failed.
        written.current = true;
      }
      setPhase('refreshing');
      const data = await refreshMe();
      if (!mounted.current) return;
      applyProfile(data);
      written.current = false;
      setPhase('idle');
      setSaved(true);
    } catch (error) {
      if (mounted.current) {
        setErr(error);
        setPhase(written.current ? 'refreshFailed' : 'idle');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="form" aria-busy={busy}>
      <p className="muted">이메일: {initial?.email || user?.email}</p>
      <fieldset className="form" disabled={locked} aria-label="프로필 정보">
        <label className="field">
          <span>닉네임</span>
          <input value={draft.nickname} onChange={(e) => edit('nickname', e.target.value)} minLength={2} maxLength={20} required />
        </label>
        <label className="field">
          <span>목표 회차</span>
          <select value={draft.targetExamId} onChange={(e) => edit('targetExamId', e.target.value)} disabled={exams.loading || !!exams.error}>
            <option value="">선택 안 함</option>
            {missingExam && <option value={draft.targetExamId} disabled>저장된 목표 회차 ({exams.loading ? '불러오는 중' : exams.error ? '조회 실패' : '목록에 없음'})</option>}
            {items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.year}년 {x.round}회 {EXAM_TYPE[x.type]} — {formatDate(x.examDate)}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {exams.loading && <Loading lines={1} label="시험 회차 불러오는 중" />}
      <ErrorBox error={exams.error} onRetry={exams.loading ? undefined : exams.reload} />
      {!exams.loading && !exams.error && !items.length && <Notice>등록된 시험 회차가 없어요.</Notice>}
      {missingExam && !exams.loading && !exams.error && <Notice>저장된 목표 회차가 목록에 없어요. 다른 회차를 선택하거나 선택을 해제해 주세요.</Notice>}
      {refreshOnly && <Notice>저장은 완료됐어요. 프로필 정보를 다시 불러와 주세요.</Notice>}
      <ErrorBox error={err || (!ready && !busy ? { message: '프로필 정보를 불러오지 못했어요. 다시 시도해 주세요.' } : null)} onRetry={busy ? undefined : ready ? save : readProfile} />
      {busy && <Notice>{phase === 'writing' ? '저장 중이에요.' : '프로필 정보를 불러오는 중이에요.'}</Notice>}
      {saved && <Notice tone="success" icon="check">저장했어요.</Notice>}
      <div className="row-between">
        <Link to="/onboarding" className="btn btn-ghost" aria-disabled={locked} tabIndex={locked ? -1 : undefined} onClick={(e) => { if (locked) e.preventDefault(); }}>
          학습 조건 수정
        </Link>
        <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
          {busy ? phase === 'writing' ? '저장 중…' : '불러오는 중…' : refreshOnly ? '정보 다시 불러오기' : '저장'}
        </button>
      </div>
    </form>
  );
}

export default function Profile() {
  const { user, me, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const exams = useApi(() => api('/api/exams'), []);
  const [password, setPassword] = useState('');
  const [delErr, setDelErr] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const isPassword = user?.providerData.some((p) => p.providerId === 'password');

  async function withdraw(e) {
    e.preventDefault();
    if (!window.confirm('탈퇴하면 계정과 모든 학습 데이터(스케줄·진도·오답·추천 이력)가 즉시 삭제되고 되돌릴 수 없어요. 탈퇴할까요?')) return;
    setDeleting(true);
    setDelErr(null);
    try {
      if (isPassword) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      else await reauthenticateWithPopup(user, googleProvider);
      await user.getIdToken(true); // 재인증 시각이 담긴 새 토큰
      await api('/api/me', { method: 'DELETE' });
      await signOut(auth).catch(() => {});
      navigate('/', { replace: true });
    } catch (e2) {
      setDelErr(e2.code ? { message: '본인 확인에 실패했어요. 비밀번호를 다시 확인해 주세요.' } : e2);
      setDeleting(false);
    }
  }

  return (
    <div className="stack narrow">
      <PageHeader title="내 정보" />
      <section className="card">
        <h2>프로필</h2>
        <ProfileForm key={user?.uid} user={user} me={me} refreshMe={refreshMe} exams={exams} />
      </section>

      <section className="card">
        <h2>로그아웃</h2>
        <button type="button" className="btn btn-outline" onClick={() => logout().then(() => navigate('/'))}>
          로그아웃
        </button>
      </section>

      <section className="card danger-zone">
        <h2>회원 탈퇴</h2>
        <p className="muted">계정과 users 하위의 모든 학습 데이터가 즉시 삭제됩니다.</p>
        <form onSubmit={withdraw} className="form">
          {isPassword ? (
            <label className="field">
              <span>본인 확인을 위해 비밀번호를 입력하세요</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          ) : (
            <p className="small">탈퇴 시 Google 계정으로 한 번 더 확인합니다.</p>
          )}
          <ErrorBox error={delErr} />
          <button type="submit" className="btn btn-danger" disabled={deleting}>
            {deleting ? '처리 중…' : '탈퇴하기'}
          </button>
        </form>
      </section>
    </div>
  );
}

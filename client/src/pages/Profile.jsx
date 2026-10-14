// UC-01 프로필 관리·로그아웃·회원 탈퇴
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { EXAM_TYPE, formatDate } from '../lib/format';
import { ErrorBox, Notice, PageHeader } from '../components/ui';

export default function Profile() {
  const { user, me, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const exams = useApi(() => api('/api/exams'), []);
  const [nickname, setNickname] = useState(me?.nickname || '');
  const [targetExamId, setTargetExamId] = useState(me?.targetExamId || '');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);
  const [password, setPassword] = useState('');
  const [delErr, setDelErr] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const isPassword = user?.providerData.some((p) => p.providerId === 'password');

  async function save(e) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    try {
      await api('/api/me', { method: 'PUT', body: { nickname: nickname.trim(), targetExamId: targetExamId || null } });
      await refreshMe();
      setSaved(true);
    } catch (e2) {
      setErr(e2);
    }
  }

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
        <form onSubmit={save} className="form">
          <p className="muted">이메일: {me?.email || user?.email}</p>
          <label className="field">
            <span>닉네임</span>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} minLength={2} maxLength={20} required />
          </label>
          <label className="field">
            <span>목표 회차</span>
            <select value={targetExamId} onChange={(e) => setTargetExamId(e.target.value)}>
              <option value="">선택 안 함</option>
              {(exams.data?.items || []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.year}년 {x.round}회 {EXAM_TYPE[x.type]} — {formatDate(x.examDate)}
                </option>
              ))}
            </select>
          </label>
          <ErrorBox error={err} />
          {saved && <Notice tone="success" icon="check">저장했어요.</Notice>}
          <div className="row-between">
            <Link to="/onboarding" className="btn btn-ghost">
              학습 조건 수정
            </Link>
            <button type="submit" className="btn btn-primary">
              저장
            </button>
          </div>
        </form>
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

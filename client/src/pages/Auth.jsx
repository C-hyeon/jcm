// UC-01 로그인 / 회원가입 / 비밀번호 재설정
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PrivacyNotice } from '../components/Layout';
import Icon from '../components/Icon';

const ERR = {
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/wrong-password': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/user-not-found': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
  'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해 주세요.',
  'auth/weak-password': '비밀번호는 8자 이상, 영문과 숫자를 섞어 주세요.',
  'auth/too-many-requests': '로그인 시도가 너무 많아 잠시 차단됐어요. 잠시 후 다시 시도하거나 비밀번호를 재설정해 주세요.',
  'auth/popup-closed-by-user': 'Google 로그인 창이 닫혔어요. 다시 시도해 주세요.',
  'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
};
const msg = (e) => ERR[e.code] || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
const NEXT_PATHS = new Set(['/', '/onboarding', '/schedule', '/materials', '/more', '/progress', '/wrong-notes', '/path', '/recommend', '/dashboard', '/profile', '/admin']);

function safeNext(n) {
  if (typeof n !== 'string' || !n.startsWith('/') || n.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(n)) return '/';
  try {
    const target = new URL(n, window.location.origin);
    const pathname = target.pathname.replace(/\/+$/, '') || '/';
    if (target.origin !== window.location.origin || !NEXT_PATHS.has(pathname)) return '/';
    return `${pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function AuthShell({ title, children }) {
  return (
    <div className="auth-page">
      <Link to="/" className="brand auth-brand">
        <span className="brand-mark" aria-hidden>
          <Icon name="check" size={18} />
        </span>
        정처기메이트
      </Link>
      <main className="auth-card" id="main">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

function GoogleButton({ next, onError }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="btn btn-outline btn-block"
      onClick={async () => {
        try {
          await signInWithPopup(auth, googleProvider);
          navigate(next, { replace: true });
        } catch (e) {
          onError(msg(e));
        }
      }}
    >
      Google 계정으로 계속하기
    </button>
  );
}

export function Login() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={next} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setFails((f) => f + 1);
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="로그인">
      <form onSubmit={submit} className="form" noValidate>
        <label className="field">
          <span>이메일</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {fails >= 5 && (
          <p className="alert alert-warn" role="alert">
            비밀번호를 5회 이상 틀렸어요. <Link to={`/reset-password?email=${encodeURIComponent(email)}`}>비밀번호 재설정 메일 받기</Link>
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
      <div className="divider">
        <span>또는</span>
      </div>
      <GoogleButton next={next} onError={setError} />
      <p className="auth-links">
        <Link to="/reset-password">비밀번호 재설정</Link> · <Link to={`/signup?next=${encodeURIComponent(next)}`}>회원가입</Link>
      </p>
    </AuthShell>
  );
}

export function Signup() {
  const { user, refreshMe } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', password2: '', nickname: '', consent: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user && !busy) return <Navigate to={next} replace />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  function check() {
    if (form.nickname.trim().length < 2 || form.nickname.trim().length > 20) return '닉네임은 2~20자로 입력해 주세요.';
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) return '비밀번호는 8자 이상, 영문과 숫자를 섞어 주세요.';
    if (form.password !== form.password2) return '비밀번호 확인이 일치하지 않습니다.';
    if (!form.consent) return '개인정보 수집·이용에 동의해야 가입할 수 있어요.';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    const v = check();
    if (v) return setError(v);
    setBusy(true);
    setError('');
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password);
      await updateProfile(cred.user, { displayName: form.nickname.trim() });
      await api('/api/me', { method: 'PUT', body: { nickname: form.nickname.trim(), consent: true } });
      await refreshMe();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.code ? msg(err) : err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="회원가입">
      <form onSubmit={submit} className="form" noValidate>
        <label className="field">
          <span>이메일</span>
          <input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </label>
        <label className="field">
          <span>닉네임 (2~20자)</span>
          <input autoComplete="nickname" required value={form.nickname} onChange={set('nickname')} maxLength={20} />
        </label>
        <label className="field">
          <span>비밀번호 (8자 이상, 영문+숫자)</span>
          <input type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />
        </label>
        <label className="field">
          <span>비밀번호 확인</span>
          <input type="password" autoComplete="new-password" required value={form.password2} onChange={set('password2')} />
        </label>
        <details className="privacy-box">
          <summary>개인정보 수집·이용 안내 보기</summary>
          <PrivacyNotice />
        </details>
        <label className="check-row">
          <input type="checkbox" checked={form.consent} onChange={set('consent')} />
          <span>개인정보 수집·이용에 동의합니다 (필수)</span>
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '가입 중…' : '가입하기'}
        </button>
      </form>
      <div className="divider">
        <span>또는</span>
      </div>
      <GoogleButton next={next} onError={setError} />
      <p className="auth-links">
        이미 계정이 있나요? <Link to={`/login?next=${encodeURIComponent(next)}`}>로그인</Link>
      </p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err) {
      setError(msg(err));
    }
  }
  return (
    <AuthShell title="비밀번호 재설정">
      {sent ? (
        <p role="status">
          {email}로 재설정 링크를 보냈어요. 메일이 보이지 않으면 스팸함을 확인해 주세요. <Link to="/login">로그인으로 돌아가기</Link>
        </p>
      ) : (
        <form onSubmit={submit} className="form">
          <label className="field">
            <span>가입한 이메일</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block">
            재설정 메일 보내기
          </button>
          <p className="auth-links">
            <Link to="/login">로그인으로 돌아가기</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

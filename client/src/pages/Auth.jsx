// UC-01 로그인 / 회원가입 / 비밀번호 재설정
import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PrivacyNotice } from '../components/Layout';
import Icon from '../components/Icon';
import './2026-10-17-auth.css';

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

function emailError(value) {
  const email = value.trim();
  if (!email) return '이메일을 입력해 주세요.';
  const input = document.createElement('input');
  input.type = 'email';
  input.value = email;
  return input.validity.typeMismatch ? '이메일 형식이 올바르지 않습니다.' : '';
}

function useAuthAction() {
  const [busy, setBusy] = useState(null);
  const pending = useRef(false);
  function begin(kind) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(kind);
    return true;
  }
  function end() {
    pending.current = false;
    setBusy(null);
  }
  return { busy, pending, begin, end };
}

function useAuthFields(error, setError) {
  const [field, setField] = useState('');
  const formRef = useRef(null);
  const errorId = useId();
  const focusField = (name) => formRef.current?.elements.namedItem(name)?.focus();
  useEffect(() => {
    if (error && field) focusField(field);
  }, [error, field]);
  function reject(name, message) {
    if (field === name && error === message) focusField(name);
    setField(name);
    setError(message);
  }
  function setFormError(message) {
    setField('');
    setError(message);
  }
  function inputProps(name) {
    const invalid = !!error && field === name;
    return { name, 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? errorId : undefined };
  }
  return { formRef, errorId, field, reject, setFormError, clear: () => setFormError(''), inputProps };
}

function AuthLink({ action, ...props }) {
  return (
    <Link
      {...props}
      aria-disabled={action.busy ? true : undefined}
      tabIndex={action.busy ? -1 : undefined}
      onClick={(e) => { if (action.pending.current) e.preventDefault(); }}
    />
  );
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

function PasswordField({ label, toggleLabel = label, autoComplete, value, onChange, inputProps = {} }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const toggleName = `${toggleLabel} ${visible ? '숨기기' : '보기'}`;
  return (
    <div className="field">
      <label className="auth-field-label" htmlFor={id}>{label}</label>
      <div className="auth-password">
        <input {...inputProps} id={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} required value={value} onChange={onChange} />
        <button type="button" className="auth-password-toggle" aria-label={toggleName} aria-pressed={visible} aria-controls={id} title={toggleName} onClick={() => setVisible((v) => !v)}>
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
    </div>
  );
}

function GoogleButton({ next, onError, action }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="btn btn-outline btn-block"
      disabled={!!action.busy}
      aria-busy={action.busy === 'google'}
      onClick={async () => {
        if (!action.begin('google')) return;
        onError('');
        try {
          await signInWithPopup(auth, googleProvider);
          navigate(next, { replace: true });
        } catch (e) {
          onError(msg(e));
        } finally {
          action.end();
        }
      }}
    >
      {action.busy === 'google' ? 'Google 로그인 중…' : 'Google 계정으로 계속하기'}
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
  const action = useAuthAction();
  const fields = useAuthFields(error, setError);
  if (user) return <Navigate to={next} replace />;

  async function submit(e) {
    e.preventDefault();
    if (action.pending.current) return;
    const emailValidation = emailError(email);
    const validation = emailValidation || (!password ? '비밀번호를 입력해 주세요.' : '');
    if (validation) return fields.reject(emailValidation ? 'email' : 'password', validation);
    if (!action.begin('email')) return;
    fields.clear();
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setFails((f) => f + 1);
      fields.setFormError(msg(err));
    } finally {
      action.end();
    }
  }

  return (
    <AuthShell title="로그인">
      <form ref={fields.formRef} onSubmit={submit} className="form" noValidate aria-busy={!!action.busy} aria-describedby={error && !fields.field ? fields.errorId : undefined}>
        <fieldset className="auth-fields" disabled={!!action.busy} aria-label="로그인 정보">
          <label className="field">
            <span>이메일</span>
            <input {...fields.inputProps('email')} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => { setEmail(e.target.value); fields.clear(); }} />
          </label>
          <PasswordField inputProps={fields.inputProps('password')} label="비밀번호" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); fields.clear(); }} />
        </fieldset>
        {error && (
          <p id={fields.errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
        {fails >= 5 && (
          <p className="alert alert-warn" role="alert">
            로그인에 여러 번 실패했어요. 입력한 정보와 네트워크 연결을 확인해 주세요. <AuthLink action={action} to={`/reset-password?next=${encodeURIComponent(next)}&email=${encodeURIComponent(email.trim())}`}>비밀번호 재설정 메일 받기</AuthLink>
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!!action.busy}>
          {action.busy === 'email' ? '로그인 중…' : '로그인'}
        </button>
      </form>
      <div className="divider">
        <span>또는</span>
      </div>
      <GoogleButton next={next} onError={fields.setFormError} action={action} />
      <p className="auth-links">
        <AuthLink action={action} to={`/reset-password?next=${encodeURIComponent(next)}`}>비밀번호 재설정</AuthLink> · <AuthLink action={action} to={`/signup?next=${encodeURIComponent(next)}`}>회원가입</AuthLink>
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
  const action = useAuthAction();
  const fields = useAuthFields(error, setError);
  const busy = !!action.busy;
  if (user && !busy) return <Navigate to={next} replace />;
  const set = (k) => (e) => {
    if (action.pending.current) return;
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    fields.clear();
  };

  function check() {
    const validation = emailError(form.email);
    if (validation) return { field: 'email', message: validation };
    if (form.nickname.trim().length < 2 || form.nickname.trim().length > 20) return { field: 'nickname', message: '닉네임은 2~20자로 입력해 주세요.' };
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) return { field: 'password', message: '비밀번호는 8자 이상, 영문과 숫자를 섞어 주세요.' };
    if (form.password !== form.password2) return { field: 'password2', message: '비밀번호 확인이 일치하지 않습니다.' };
    if (!form.consent) return { field: 'consent', message: '개인정보 수집·이용에 동의해야 가입할 수 있어요.' };
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    if (action.pending.current) return;
    const v = check();
    if (v) return fields.reject(v.field, v.message);
    if (!action.begin('email')) return;
    fields.clear();
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password);
      await updateProfile(cred.user, { displayName: form.nickname.trim() });
      await api('/api/me', { method: 'PUT', body: { nickname: form.nickname.trim(), consent: true } });
      await refreshMe();
      navigate(next, { replace: true });
    } catch (err) {
      fields.setFormError(err.code ? msg(err) : err.message);
      action.end();
    }
  }

  return (
    <AuthShell title="회원가입">
      <form ref={fields.formRef} onSubmit={submit} className="form" noValidate aria-busy={busy} aria-describedby={error && !fields.field ? fields.errorId : undefined}>
        <fieldset className="auth-fields" disabled={busy} aria-label="회원가입 정보">
        <label className="field">
          <span>이메일</span>
          <input {...fields.inputProps('email')} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={form.email} onChange={set('email')} />
        </label>
        <label className="field">
          <span>닉네임 (2~20자)</span>
          <input {...fields.inputProps('nickname')} autoComplete="nickname" required value={form.nickname} onChange={set('nickname')} maxLength={20} />
        </label>
        <PasswordField inputProps={fields.inputProps('password')} label="비밀번호 (8자 이상, 영문+숫자)" toggleLabel="비밀번호" autoComplete="new-password" value={form.password} onChange={set('password')} />
        <PasswordField inputProps={fields.inputProps('password2')} label="비밀번호 확인" autoComplete="new-password" value={form.password2} onChange={set('password2')} />
        <details className="privacy-box">
          <summary>개인정보 수집·이용 안내 보기</summary>
          <PrivacyNotice />
        </details>
        <label className="check-row">
          <input {...fields.inputProps('consent')} type="checkbox" checked={form.consent} onChange={set('consent')} />
          <span>개인정보 수집·이용에 동의합니다 (필수)</span>
        </label>
        </fieldset>
        {error && (
          <p id={fields.errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {action.busy === 'email' ? '가입 중…' : '가입하기'}
        </button>
      </form>
      <div className="divider">
        <span>또는</span>
      </div>
      <GoogleButton next={next} onError={fields.setFormError} action={action} />
      <p className="auth-links">
        이미 계정이 있나요? <AuthLink action={action} to={`/login?next=${encodeURIComponent(next)}`}>로그인</AuthLink>
      </p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const loginPath = `/login?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState(params.get('email') || '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const action = useAuthAction();
  const fields = useAuthFields(error, setError);
  async function submit(e) {
    e.preventDefault();
    if (action.pending.current) return;
    const validation = emailError(email);
    if (validation) return fields.reject('email', validation);
    if (!action.begin('reset')) return;
    fields.clear();
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err) {
      fields.setFormError(msg(err));
    } finally {
      action.end();
    }
  }
  return (
    <AuthShell title="비밀번호 재설정">
      {sent ? (
        <p role="status">
          {email.trim()}로 재설정 링크를 보냈어요. 메일이 보이지 않으면 스팸함을 확인해 주세요. <Link to={loginPath}>로그인으로 돌아가기</Link>
        </p>
      ) : (
        <form ref={fields.formRef} onSubmit={submit} className="form" noValidate aria-busy={!!action.busy} aria-describedby={error && !fields.field ? fields.errorId : undefined}>
          <fieldset className="auth-fields" disabled={!!action.busy} aria-label="비밀번호 재설정 정보">
            <label className="field">
              <span>가입한 이메일</span>
              <input {...fields.inputProps('email')} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => { setEmail(e.target.value); fields.clear(); }} />
            </label>
          </fieldset>
          {error && (
            <p id={fields.errorId} className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={!!action.busy}>
            {action.busy ? '메일 보내는 중…' : '재설정 메일 보내기'}
          </button>
          <p className="auth-links">
            <AuthLink action={action} to={loginPath}>로그인으로 돌아가기</AuthLink>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

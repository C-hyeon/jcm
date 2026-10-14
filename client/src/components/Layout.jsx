import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import Icon from './Icon';
import { Dialog, Loading } from './ui';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const NAV = [
  { to: '/', label: '홈', icon: 'home', end: true },
  { to: '/schedule', label: '스케줄', icon: 'calendar' },
  { to: '/progress', label: '진도', icon: 'progress' },
  { to: '/wrong-notes', label: '오답노트', icon: 'note' },
  { to: '/materials', label: '자료 허브', icon: 'book' },
  { to: '/path', label: '학습 경로', icon: 'route' },
  { to: '/recommend', label: 'AI 추천', icon: 'spark' },
  { to: '/dashboard', label: '대시보드', icon: 'chart' },
];

const BOTTOM = ['/', '/schedule', '/progress', '/wrong-notes', '/materials'];

export default function Layout() {
  const { user, me, isAdmin } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        본문 바로가기
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="정처기메이트 홈">
          <span className="brand-mark" aria-hidden>
            <Icon name="check" size={18} />
          </span>
          정처기메이트
        </Link>
        <div className="topbar-right">
          {user ? (
            <Link to="/profile" className="user-chip">
              <Icon name="user" size={18} />
              <span>{me?.nickname || '내 정보'}</span>
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-sm btn-ghost">
                로그인
              </Link>
              <Link to="/signup" className="btn btn-sm btn-primary">
                가입
              </Link>
            </>
          )}
        </div>
      </header>

      <nav className="sidenav" aria-label="주요 메뉴">
        <ul>
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end} className="nav-item">
                <Icon name={n.icon} />
                {n.label}
              </NavLink>
            </li>
          ))}
          {isAdmin && (
            <li>
              <NavLink to="/admin" className="nav-item">
                <Icon name="shield" />
                관리자
              </NavLink>
            </li>
          )}
        </ul>
      </nav>

      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="bottomnav" aria-label="하단 메뉴">
        {NAV.filter((n) => BOTTOM.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="bn-item">
            <Icon name={n.icon} />
            <span>{n.label.replace(' 허브', '')}</span>
          </NavLink>
        ))}
        <NavLink to="/more" className="bn-item">
          <Icon name="more" />
          <span>더보기</span>
        </NavLink>
      </nav>
      {user && me && !me.consentAgreedAt && <ConsentGate />}
    </div>
  );
}

// Google 로그인 등으로 가입한 경우 개인정보 수집·이용 동의
function ConsentGate() {
  const { refreshMe, logout } = useAuth();
  const [saving, setSaving] = useState(false);
  async function agree() {
    setSaving(true);
    await api('/api/me', { method: 'PUT', body: { consent: true } });
    await refreshMe();
  }
  return (
    <Dialog open onClose={() => {}} title="개인정보 수집·이용 동의">
      <PrivacyNotice />
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={logout}>
          동의하지 않고 로그아웃
        </button>
        <button type="button" className="btn btn-primary" onClick={agree} disabled={saving}>
          동의하고 시작
        </button>
      </div>
    </Dialog>
  );
}

export function PrivacyNotice() {
  return (
    <div className="privacy">
      <dl>
        <dt>수집 항목</dt>
        <dd>이메일, 닉네임, 학습 데이터(시험 정보·학습 조건·진도·오답 기록·북마크·추천 이력)</dd>
        <dt>이용 목적</dt>
        <dd>학습 스케줄 생성, 진도·취약 유형 분석, 학습 자료 추천</dd>
        <dt>보유 기간</dt>
        <dd>회원 탈퇴 시 즉시 삭제 (AI 추천 이력은 생성 후 180일 보관)</dd>
      </dl>
      <p className="muted small">AI 추천에는 D-day·진도율·취약 유형 같은 비식별 요약만 전송하며 이메일·닉네임·메모는 보내지 않습니다.</p>
    </div>
  );
}

export function RequireAuth({ children, admin = false }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (admin && !isAdmin) {
    return (
      <div className="card">
        <h1>접근 권한이 없습니다</h1>
        <p className="muted">관리자 권한이 있는 계정만 사용할 수 있습니다.</p>
      </div>
    );
  }
  return children;
}

export function MorePage() {
  const { user, isAdmin } = useAuth();
  return (
    <div>
      <h1 className="page-title">더보기</h1>
      <ul className="more-list">
        {NAV.filter((n) => !BOTTOM.includes(n.to)).map((n) => (
          <li key={n.to}>
            <Link to={n.to}>
              <Icon name={n.icon} /> {n.label}
            </Link>
          </li>
        ))}
        <li>
          <Link to={user ? '/profile' : '/login'}>
            <Icon name="user" /> {user ? '내 정보' : '로그인'}
          </Link>
        </li>
        {isAdmin && (
          <li>
            <Link to="/admin">
              <Icon name="shield" /> 관리자
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

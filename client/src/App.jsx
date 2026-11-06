import { lazy, Suspense } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Layout, { MorePage, RequireAuth } from './components/Layout';
import { Loading } from './components/ui';
import PageErrorBoundary from './components/2026-10-30-PageErrorBoundary';
import { useAuth } from './context/AuthContext';
import Home from './pages/Home';
import { Login, ResetPassword, Signup } from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Schedule from './pages/Schedule';
import Materials from './pages/Materials';

const Progress = lazy(() => import('./pages/Progress'));
const WrongNotes = lazy(() => import('./pages/WrongNotes'));
const LearningPath = lazy(() => import('./pages/LearningPath'));
const Recommend = lazy(() => import('./pages/Recommend'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));
const LevelTest = lazy(() => import('./pages/LevelTest'));

const guard = (el, admin = false) => (
  <RequireAuth admin={admin}>
    <PageErrorBoundary>
      <Suspense fallback={<Loading />}>{el}</Suspense>
    </PageErrorBoundary>
  </RequireAuth>
);

// 가입 직후(레벨테스트 대기 중)에는 어느 화면으로 가든 먼저 레벨테스트로 안내한다.
function LevelTestGate() {
  const { user, me } = useAuth();
  const location = useLocation();
  if (user && me?.uid === user.uid && me.levelTestPending) {
    return <Navigate to={`/level-test?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="level-test" element={guard(<LevelTest />)} />
        <Route element={<LevelTestGate />}>
          <Route index element={<Home />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="materials" element={<Materials />} />
          <Route path="more" element={<MorePage />} />
          <Route path="progress" element={guard(<Progress />)} />
          <Route path="wrong-notes" element={guard(<WrongNotes />)} />
          <Route path="path" element={guard(<LearningPath />)} />
          <Route path="recommend" element={guard(<Recommend />)} />
          <Route path="dashboard" element={guard(<Dashboard />)} />
          <Route path="profile" element={guard(<Profile />)} />
          <Route path="admin" element={guard(<Admin />, true)} />
        </Route>
        <Route
          path="*"
          element={
            <div className="empty">
              <p className="empty-title">페이지를 찾을 수 없어요</p>
              <Link to="/" className="btn btn-primary">
                홈으로
              </Link>
            </div>
          }
        />
      </Route>
      <Route path="login" element={<Login />} />
      <Route path="signup" element={<Signup />} />
      <Route path="reset-password" element={<ResetPassword />} />
    </Routes>
  );
}

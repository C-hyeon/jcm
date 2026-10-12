import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Layout, { MorePage, RequireAuth } from './components/Layout';
import { Loading } from './components/ui';
import Home from './pages/Home';
import { Login, ResetPassword, Signup } from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Schedule from './pages/Schedule';
import Materials from './pages/Materials';

// 자주 쓰지 않거나 무거운 화면은 지연 로딩(초기 번들 축소)
const Progress = lazy(() => import('./pages/Progress'));
const WrongNotes = lazy(() => import('./pages/WrongNotes'));
const LearningPath = lazy(() => import('./pages/LearningPath'));
const Recommend = lazy(() => import('./pages/Recommend'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));

const guard = (el, admin = false) => (
  <RequireAuth admin={admin}>
    <Suspense fallback={<Loading />}>{el}</Suspense>
  </RequireAuth>
);

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
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

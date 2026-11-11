import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { loadGuest } from '../lib/guest';
import { ddayLabel, diffDays, EXAM_TYPE, formatDate, todayKST } from '../lib/format';

// 홈의 D-day 카드 대신, 나머지 학습 화면 상단에 시험일 D-day만 간단히 보여 준다.
const PATHS = ['/schedule', '/progress', '/wrong-notes', '/materials', '/path', '/recommend', '/dashboard'];

function examOf(user, me) {
  if (user) return me?.profile?.examDate ? { date: me.profile.examDate, type: me.profile.examType } : null;
  const plan = loadGuest()?.plan;
  return plan?.examDate ? { date: plan.examDate, type: plan.examType } : null;
}

export default function DdayChip() {
  const { user, me, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading || !PATHS.includes(pathname)) return null;
  const exam = examOf(user, me);
  if (!exam) return null;
  const dday = diffDays(todayKST(), exam.date);
  return (
    <p className="dday-chip" aria-label={`정보처리기사 ${EXAM_TYPE[exam.type] || ''} 시험까지 ${ddayLabel(dday)}`}>
      <strong>{ddayLabel(dday)}</strong>
      <span>
        {EXAM_TYPE[exam.type] ? `${EXAM_TYPE[exam.type]} · ` : ''}
        {formatDate(exam.date)}
      </span>
    </p>
  );
}

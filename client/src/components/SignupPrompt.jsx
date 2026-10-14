import { Link, useLocation } from 'react-router-dom';
import { Dialog } from './ui';

// 벤치마킹 : 계획 확인·자료 탐색은 비회원도 가능하고, 학습 기록 저장이나 기기 간 동기화가 필요한 순간에 가입 제안.
export default function SignupPrompt({ open, onClose, reason = '학습 기록을 저장하려면' }) {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname);
  return (
    <Dialog open={open} onClose={onClose} title="기록을 저장할까요?">
      <p>{reason} 로그인이 필요해요. 가입하면 지금까지 입력한 시험 정보와 스케줄이 그대로 계정으로 옮겨집니다.</p>
      <ul className="bullets">
        <li>완료 체크·이해도·복습 필요 여부 저장</li>
        <li>오답 기록과 취약 유형 분석, AI 추천</li>
        <li>PC·휴대폰 어디서나 같은 스케줄</li>
      </ul>
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          나중에
        </button>
        <Link className="btn btn-outline" to={`/login?next=${next}`}>
          로그인
        </Link>
        <Link className="btn btn-primary" to={`/signup?next=${next}`}>
          무료로 가입
        </Link>
      </div>
    </Dialog>
  );
}

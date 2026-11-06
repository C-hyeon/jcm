import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { api } from '../api/client';
import { loadGuest, clearGuest } from '../lib/guest';

const AuthContext = createContext(null);

// 비회원 때 입력한 시험 정보를 가입 직후 계정으로 옮기기.
async function migrateGuest(me) {
  const guest = loadGuest();
  if (!guest?.profile || me.hasProfile) return false;
  try {
    await api('/api/study-profile', { method: 'PUT', body: guest.profile });
    await api('/api/plans', { method: 'POST', body: {} });
    clearGuest();
    return true;
  } catch (e) {
    console.warn('비회원 데이터 이전 실패', e);
    return false;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [me, setMe] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [migrated, setMigrated] = useState(false);

  // 가입 직후에는 onAuthStateChanged의 GET과 가입 화면의 PUT→GET이 동시에 진행된다.
  // 먼저 보낸(가입 정보 저장 전) 응답이 늦게 도착해 최신 정보를 덮어쓰지 않도록
  // 이미 반영된 요청보다 오래된 응답은 버린다.
  const seq = useRef({ issued: 0, applied: 0 });
  const refreshMe = useCallback(async () => {
    const id = ++seq.current.issued;
    const data = await api('/api/me');
    if (id > seq.current.applied) {
      seq.current.applied = id;
      setMe(data);
    }
    return data;
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (u) {
          try {
            const token = await u.getIdTokenResult();
            setIsAdmin(token.claims.admin === true);
            let data = await refreshMe();
            if (await migrateGuest(data)) {
              data = await refreshMe();
              setMigrated(true);
            }
          } catch (e) {
            console.warn(e);
          }
        } else {
          // 로그아웃 이전에 보낸 요청의 응답이 뒤늦게 반영되지 않도록 무효화
          seq.current.applied = ++seq.current.issued;
          setMe(null);
          setIsAdmin(false);
        }
        setLoading(false);
      }),
    [refreshMe],
  );

  const value = useMemo(
    () => ({
      user,
      me,
      isAdmin,
      loading,
      migrated,
      clearMigrated: () => setMigrated(false),
      refreshMe,
      logout: () => signOut(auth),
    }),
    [user, me, isAdmin, loading, migrated, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

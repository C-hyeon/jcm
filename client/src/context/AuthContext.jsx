import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

  const refreshMe = useCallback(async () => {
    const data = await api('/api/me');
    setMe(data);
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

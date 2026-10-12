import { useCallback, useEffect, useState } from 'react';

/**
 * 데이터 조회 훅. fetcher가 null이면 아무것도 하지 않는다(비회원 등).
 * deps가 바뀌면 다시 불러온다.
 */
export function useApi(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: !!fetcher });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!fetcher) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, !!fetcher]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload, setData };
}

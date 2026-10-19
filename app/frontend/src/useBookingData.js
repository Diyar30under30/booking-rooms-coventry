import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from './api.js';

// An empty successful response is different from data we could not retrieve.
// Tag each result with its account, query and revision so old requests cannot
// repopulate the UI after a date change, refresh or sign-out.
export default function useBookingData(userId, path, revision = 0) {
  const key = userId != null && path ? `${userId}:${path}:${revision}` : null;
  const currentKey = useRef(key);
  currentKey.current = key;
  const sequence = useRef(0);
  const [result, setResult] = useState({ key: null, status: 'unknown', entries: [], error: '' });

  const refresh = useCallback(async () => {
    if (!key) return true;
    const version = ++sequence.current;
    setResult({ key, status: 'loading', entries: [], error: '' });
    try {
      const entries = await request(path);
      if (version !== sequence.current || currentKey.current !== key) return false;
      setResult({ key, status: 'ready', entries, error: '' });
      return true;
    } catch (failure) {
      if (version !== sequence.current || currentKey.current !== key) return false;
      setResult({ key, status: 'error', entries: [], error: failure.message });
      return false;
    }
  }, [key, path]);

  useEffect(() => {
    refresh();
    return () => { sequence.current += 1; };
  }, [refresh]);

  const current = key && result.key === key
    ? result
    : { status: key ? 'loading' : 'unknown', entries: [], error: '' };
  return { ...current, refresh };
}

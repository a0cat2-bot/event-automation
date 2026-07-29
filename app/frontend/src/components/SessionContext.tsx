import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { getSession, sessionAllows, type Session, type UserRole } from '../api/session';

type SessionState = {
  session: Session | null;
  isLoading: boolean;
  loadError: string | null;
  /** Whether the current user may perform an action requiring at least `minimum`. */
  allows: (minimum: UserRole) => boolean;
};

const SessionContext = createContext<SessionState>({
  session: null,
  isLoading: true,
  loadError: null,
  allows: () => false,
});

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    getSession(controller.signal)
      .then((next) => {
        if (!isCurrent) return;
        setSession(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '로그인 정보를 확인하지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      isLoading,
      loadError,
      allows: (minimum: UserRole) => sessionAllows(session, minimum),
    }),
    [session, isLoading, loadError],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

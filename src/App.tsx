import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ApiError, api } from './lib/api';
import { AppProvider, useApp } from './lib/store';
import type { Me } from './lib/types';
import { Album } from './pages/Album';
import { Settings } from './pages/Admin';
import { Invite, Login, Setup } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { ExerciseEditor } from './pages/ExerciseEditor';
import { Library } from './pages/Library';
import { Live } from './pages/Live';
import { PlayerPage } from './pages/PlayerPage';
import { Players } from './pages/Players';
import { PublicTraining } from './pages/PublicTraining';
import { TrainingPage } from './pages/TrainingPage';

type Boot = { state: 'loading' } | { state: 'setup' } | { state: 'login'; clubName: string | null } | { state: 'ready'; me: Me };

export function App() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/s/')) {
    return (
      <Routes>
        <Route path="/s/:token" element={<PublicTraining />} />
      </Routes>
    );
  }
  if (loc.pathname.startsWith('/invitation/')) {
    return (
      <Routes>
        <Route path="/invitation/:token" element={<Invite />} />
      </Routes>
    );
  }
  return <Authenticated />;
}

function Authenticated() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });

  const load = async () => {
    try {
      const me = await api.get<Me>('/me');
      setBoot({ state: 'ready', me });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const b = await api.get<{ setupNeeded: boolean; clubName: string | null }>('/bootstrap').catch(() => null);
        setBoot(b?.setupNeeded ? { state: 'setup' } : { state: 'login', clubName: b?.clubName ?? null });
      } else {
        setBoot({ state: 'login', clubName: null });
      }
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (boot.state === 'loading') return <Spinner fill />;
  if (boot.state === 'setup') return <Setup onDone={load} />;
  if (boot.state === 'login') return <Login clubName={boot.clubName} onDone={load} />;
  return (
    <AppProvider initial={boot.me}>
      <AppRoutes />
    </AppProvider>
  );
}

function AppRoutes() {
  const { isStaff } = useApp();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="seances" element={<Navigate to="/" replace />} />
        <Route path="album" element={<Album />} />
        <Route path="seances/:id" element={<TrainingPage />} />
        <Route path="parametres" element={<Settings />} />
        <Route path="compte" element={<Navigate to="/parametres" replace />} />
        <Route path="exercices" element={<Library />} />
        {isStaff && (
          <>
            <Route path="joueurs" element={<Players />} />
            <Route path="admin" element={<Navigate to="/parametres?tab=membres" replace />} />
          </>
        )}
        <Route path="joueurs/:id" element={<PlayerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="exercices/:id" element={<ExerciseEditor />} />
      {isStaff && <Route path="seances/:id/live" element={<Live />} />}
    </Routes>
  );
}

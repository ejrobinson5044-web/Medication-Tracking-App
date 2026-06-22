import { NavLink, Route, Routes } from 'react-router-dom';
import TodayPage from './pages/TodayPage';
import MedsPage from './pages/MedsPage';
import MedFormPage from './pages/MedFormPage';
import LoginPage from './pages/LoginPage';
import { useAuth } from './lib/auth';
import { supabaseEnabled } from './lib/supabase';

export default function App() {
  const { session, loading, signOut } = useAuth();

  if (supabaseEnabled && loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (supabaseEnabled && !session) {
    return <LoginPage />;
  }

  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/meds" element={<MedsPage />} />
          <Route path="/meds/new" element={<MedFormPage />} />
          <Route path="/meds/:id/edit" element={<MedFormPage />} />
        </Routes>
      </main>
      <nav className="tab-bar">
        <NavLink to="/" className={({ isActive }) => (isActive ? 'tab active' : 'tab')} end>
          Today
        </NavLink>
        <NavLink to="/meds" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          Medications
        </NavLink>
        {supabaseEnabled && (
          <button className="tab tab-signout" onClick={() => void signOut()}>
            Sign Out
          </button>
        )}
      </nav>
    </div>
  );
}

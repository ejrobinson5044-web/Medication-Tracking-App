import { NavLink, Route, Routes } from 'react-router-dom';
import TodayPage from './pages/TodayPage';
import MedsPage from './pages/MedsPage';
import MedFormPage from './pages/MedFormPage';

export default function App() {
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
      </nav>
    </div>
  );
}

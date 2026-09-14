import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import LobbyPage from './pages/LobbyPage.jsx';
import RoomsPage from './pages/RoomsPage.jsx';
import PokerTablePage from './pages/PokerTablePage.jsx';
import { LatticeBackground } from './components/LatticeBackground.jsx';

export default function App() {
  return (
    <>
      <LatticeBackground />
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/lobby.html" element={<Navigate to="/lobby" replace />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/rooms.html" element={<Navigate to="/rooms" replace />} />
        <Route path="/poker-table" element={<PokerTablePage />} />
        <Route path="/poker-table.html" element={<Navigate to="/poker-table" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

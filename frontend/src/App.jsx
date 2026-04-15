import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import Chat from './pages/Chat';
import Dashboard from './pages/Dashboard';
import Finance from './pages/Finance';
import Review from './pages/Review';
import PdfUpload from './pages/PdfUpload';
import Settings from './pages/Settings';

export default function App() {
  return (
    <div className="flex h-screen bg-alec-900 text-white overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/review" element={<Review />} />
            <Route path="/pdf" element={<PdfUpload />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

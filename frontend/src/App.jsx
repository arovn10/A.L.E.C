import { Routes, Route, Navigate } from 'react-router-dom';

// Page stubs — replaced in Tasks 3–9
function Chat() { return <div className="p-8 text-white">Chat Panel (Task 4)</div>; }
function Dashboard() { return <div className="p-8 text-white">Dashboard (Task 8)</div>; }
function Finance() { return <div className="p-8 text-white">Finance Panel (Task 5)</div>; }
function Review() { return <div className="p-8 text-white">Review Panel (Task 6)</div>; }
function PdfUpload() { return <div className="p-8 text-white">PDF Upload (Task 7)</div>; }
function Settings() { return <div className="p-8 text-white">Settings (Task 9)</div>; }

export default function App() {
  return (
    <div className="flex h-screen bg-alec-900 text-white overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
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

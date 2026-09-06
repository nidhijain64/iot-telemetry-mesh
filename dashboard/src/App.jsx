import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MobileNode from './pages/MobileNode';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="/mobile-node" element={<MobileNode />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

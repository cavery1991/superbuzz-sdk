import { Routes, Route } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';
import OverviewPage from '@/pages/OverviewPage';
import BrandNonbrandPage from '@/pages/BrandNonbrandPage';
import IncrementalityPage from '@/pages/IncrementalityPage';
import CausationPage from '@/pages/CausationPage';
import PatternsPage from '@/pages/PatternsPage';
import RecommendationsPage from '@/pages/RecommendationsPage';
import ExperimentsPage from '@/pages/ExperimentsPage';
import SimulatorPage from '@/pages/SimulatorPage';
import AdminPage from '@/pages/AdminPage';

export default function App() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 flex-1 p-8">
        <div className="mx-auto max-w-7xl">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/brand-nonbrand" element={<BrandNonbrandPage />} />
            <Route path="/incrementality" element={<IncrementalityPage />} />
            <Route path="/causation" element={<CausationPage />} />
            <Route path="/patterns" element={<PatternsPage />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="/experiments" element={<ExperimentsPage />} />
            <Route path="/simulator" element={<SimulatorPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

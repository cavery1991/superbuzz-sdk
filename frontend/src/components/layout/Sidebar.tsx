import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  GitBranch,
  TrendingUp,
  Microscope,
  Brain,
  Lightbulb,
  FlaskConical,
  SlidersHorizontal,
  Settings,
  BarChart3,
} from 'lucide-react';
import clsx from 'clsx';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  { to: '/brand-nonbrand', label: 'Brand vs Non-brand', icon: <GitBranch size={20} /> },
  { to: '/incrementality', label: 'Incrementality', icon: <TrendingUp size={20} /> },
  { to: '/causation', label: 'Causation Lab', icon: <Microscope size={20} /> },
  { to: '/patterns', label: 'Pattern Memory', icon: <Brain size={20} /> },
  { to: '/recommendations', label: 'Recommendations', icon: <Lightbulb size={20} /> },
  { to: '/experiments', label: 'Experiments', icon: <FlaskConical size={20} /> },
  { to: '/simulator', label: 'Scenario Simulator', icon: <SlidersHorizontal size={20} /> },
  { to: '/admin', label: 'Admin', icon: <Settings size={20} /> },
];

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-slate-900 text-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-slate-700 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
          <BarChart3 size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wide text-white">SuperBuzz</h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            PPC Analytics
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-brand-600 text-white shadow-md shadow-brand-900/30'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-700 px-6 py-4">
        <p className="text-xs text-slate-500">v1.0.0</p>
      </div>
    </aside>
  );
}

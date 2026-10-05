import { Search, CalendarDays, Heart, CircleHelp, ClipboardList, ShieldCheck, LogIn } from 'lucide-react';

export default function Sidebar({ page, setPage, onHelp, user, onLogout }) {
  const initials = user?.name.split(' ').map(part => part[0]).slice(0, 2).join('') || '?';
  return (
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('find'); }} aria-label="Coventry University Classroom Booking home">
        <img src="/brand/coventry-university.svg" alt="Coventry University"/><span className="brand-caption">Classroom Booking</span>
      </a>
      <nav aria-label="Main navigation">
        {[['find', 'Find a classroom', Search], ['schedule', 'Schedule', CalendarDays], ['bookings', 'My bookings', ClipboardList], ['favorites', 'Favorites', Heart], ['rules', 'Booking rules', CircleHelp], ...(user?.role === 'admin' ? [['admin', 'Administration', ShieldCheck]] : []), ...(!user ? [['account', 'Sign in / Register', LogIn]] : [])].map(([key, label, Icon]) => <button key={key} className={page === key ? 'nav-item active' : 'nav-item'} onClick={() => setPage(key)} aria-current={page === key ? 'page' : undefined}><Icon size={23}/>{label}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item help" onClick={onHelp} aria-label="Help and support"><CircleHelp size={22}/>Help & support</button>
        {user && <div className="profile account-identity"><span className="avatar" aria-hidden="true">{initials}</span><div><strong>{user.name}</strong><span>{user.role === 'staff' ? 'University staff' : user.role} · {user.status}</span><button className="text-button" onClick={onLogout}>Sign out</button></div></div>}
      </div>
    </aside>
  );
}

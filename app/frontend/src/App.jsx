import { useEffect, useState } from 'react';
import { Armchair, CalendarDays, Building2, Search, Clock3, Map, List, Heart, Check, ArrowRight, Loader2, AlertCircle, Users } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import FloorPlan from './components/FloorPlan.jsx';
import Modal from './components/Modal.jsx';
import SpaceDetail, { resourceScope } from './components/SpaceDetail.jsx';
import BookingDialogs from './components/BookingDialogs.jsx';
import AccountPanel from './components/AccountPanel.jsx';
import BookingRules from './components/BookingRules.jsx';
import Schedule from './components/Schedule.jsx';
import Administration from './components/Administration.jsx';
import { request, mutate, setCsrfToken, previewMode } from './api.js';
import { compareLabels, compareRooms } from '../../shared/rooms.mjs';

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function initialDate() {
  const date = new Date();
  if (date.getHours() >= 9) date.setDate(date.getDate() + 1);
  return localDate(date);
}
function niceDate(date, full = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: full ? 'long' : 'short', month: full ? 'long' : 'short', day: 'numeric' });
}
const times = Array.from({ length: 29 }, (_, index) => `${String(8 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
const isBookableClassroom = space => space.active && space.type === 'classroom' && space.bookingScope === 'whole-room';
function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const dayEntries = date => request(`/api/bookings?from=${date}&to=${date}`);

export default function App() {
  const [page, setPage] = useState('find');
  const [spaces, setSpaces] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [user, setUser] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [mine, setMine] = useState([]);
  const [scheduleDate, setScheduleDate] = useState(initialDate);
  const [scheduleFloor, setScheduleFloor] = useState('all');
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('11:00');
  const [searched, setSearched] = useState(() => ({ date: initialDate(), start: '09:00', end: '11:00' }));
  const [building, setBuilding] = useState('Coventry');
  const [floor, setFloor] = useState('Floor 2');
  const [view, setView] = useState('map');
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [attendees, setAttendees] = useState(1);
  const [notification, setNotification] = useState('disabled');
  const [feedback, setFeedback] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    const stored = readStorage('campus-favorites-v2', []);
    return Array.isArray(stored) ? stored.map(String) : [];
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [nextSpaces, session] = await Promise.all([request('/api/spaces'), request('/api/auth/session')]);
      setSpaces(nextSpaces);
      setUser(session.user); setCsrfToken(session.csrfToken); setSetupRequired(session.setupRequired);
      if (session.user) {
        const [nextBookings, nextMine] = await Promise.all([dayEntries(searched.date), request('/api/bookings/mine')]);
        setBookings(nextBookings); setMine(nextMine);
      } else { setBookings([]); setMine([]); }
      const preferred = nextSpaces.find(space => isBookableClassroom(space) && space.building === 'Coventry') || nextSpaces.find(isBookableClassroom);
      setSelectedId(preferred?.id ?? null);
      if (preferred) { setBuilding(preferred.building); setFloor(preferred.floor); }
      const validIds = new Set(nextSpaces.filter(isBookableClassroom).map(space => String(space.id)));
      setFavorites(current => current.filter(id => validIds.has(id)));
    } catch (failure) { setError(failure.message); } finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const changed = () => { load(); };
    window.addEventListener('auth-changed', changed);
    return () => window.removeEventListener('auth-changed', changed);
  }, []);
  useEffect(() => {
    const expired = () => { setUser(null); setMine([]); setBookings([]); setScheduleEntries([]); setModal(null); setFeedback('Please sign in again to continue.'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  useEffect(() => {
    let current = true;
    if (page !== 'schedule' || !user || !scheduleDate) return;
    setScheduleLoading(true); setScheduleEntries([]);
    dayEntries(scheduleDate).then(entries => { if (current) setScheduleEntries(entries); }).catch(failure => { if (current) setError(failure.message); }).finally(() => { if (current) setScheduleLoading(false); });
    return () => { current = false; };
  }, [page, scheduleDate, user?.id]);
  useEffect(() => { try { localStorage.setItem('campus-favorites-v2', JSON.stringify(favorites)); } catch {} }, [favorites]);

  const activeSpaces = spaces.filter(isBookableClassroom).sort(compareRooms);
  const buildings = [...new Set(activeSpaces.map(space => space.building))].sort(compareLabels);
  const floors = [...new Set(activeSpaces.filter(space => space.building === building).map(space => space.floor))].sort(compareLabels);
  const isBooked = space => bookings.some(booking => String(booking.spaceId) === String(space.id) && booking.date === searched.date && booking.start < searched.end && booking.end > searched.start);
  const floorSpaces = activeSpaces.filter(space => space.building === building && space.floor === floor);
  const filtered = floorSpaces;
  const selected = filtered.find(space => String(space.id) === String(selectedId));
  const available = activeSpaces.filter(space => !isBooked(space)).length;
  const upcoming = mine.filter(booking => new Date(`${booking.date}T${booking.end}`) > new Date()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const savedSpaces = activeSpaces.filter(space => favorites.includes(String(space.id)));
  const toggleFavorite = id => setFavorites(current => current.includes(String(id)) ? current.filter(item => item !== String(id)) : [...current, String(id)]);
  const canBook = !!user && user.status === 'approved';

  async function refreshReservations(nextDate = searched.date, nextScheduleDate = scheduleDate || nextDate) {
    const results = await Promise.allSettled([dayEntries(nextDate), request('/api/bookings/mine'), dayEntries(nextScheduleDate)]);
    const setters = [setBookings, setMine, setScheduleEntries];
    results.forEach((result, index) => { if (result.status === 'fulfilled') setters[index](result.value); });
    return results.every(result => result.status === 'fulfilled');
  }
  async function refreshSession() {
    try { const session = await request('/api/auth/session'); setUser(session.user); setCsrfToken(session.csrfToken); setSetupRequired(session.setupRequired); }
    catch (failure) { setError(failure.message); }
  }
  async function onSession(session) {
    setUser(session.user); setCsrfToken(session.csrfToken); setFeedback(`Welcome, ${session.user.name}.`); setError('');
    await refreshSession();
    await refreshReservations(); setPage('find');
  }
  async function logout() {
    try { await mutate('/api/auth/logout', 'POST', {}); setCsrfToken(null); setUser(null); setMine([]); setBookings([]); setScheduleEntries([]); setModal(null); setPage('find'); await refreshSession(); }
    catch (failure) { setError(failure.message); }
  }
  async function imported(eventDate, showSchedule) {
    const nextDate = eventDate || searched.date;
    setDate(nextDate); setSearched(current => ({ ...current, date: nextDate })); setScheduleDate(nextDate);
    if (!await refreshReservations(nextDate, nextDate)) setError('Events were imported, but the latest schedule could not be loaded. Retry to refresh it.');
    if (showSchedule) setPage('schedule');
  }

  function selectSpace(space) { setSelectedId(space.id); setBuilding(space.building); setFloor(space.floor); }
  function selectFloor(nextBuilding, nextFloor) {
    setBuilding(nextBuilding);
    setFloor(nextFloor);
    setSelectedId(activeSpaces.find(space => space.building === nextBuilding && space.floor === nextFloor)?.id ?? null);
  }
  async function search(event) {
    event.preventDefault();
    setFeedback('');
    if (date < localDate()) return setFeedback('Choose today or a future date.');
    if (end <= start) return setFeedback('End time must be later than start time.');
    if ((new Date(`${date}T${end}`) - new Date(`${date}T${start}`)) / 3600000 > 8) return setFeedback('Bookings can be up to 8 hours. Choose a shorter time.');
    if (new Date(`${date}T${start}`) <= new Date()) return setFeedback('Choose a start time in the future.');
    setRefreshing(true);
    setError('');
    try {
      if (user) setBookings(await dayEntries(date));
      setSearched({ date, start, end });
      setFeedback(user ? `Showing availability for ${niceDate(date)}, ${start}–${end}.` : 'Sign in to view availability and reserve a classroom.');
    } catch (failure) { setError(failure.message); } finally { setRefreshing(false); }
  }
  async function book(event) {
    event.preventDefault();
    if (!selected || !canBook) return;
    if (title.trim().length < 3 || title.trim().length > 120) return setError('Give a booking purpose of 3–120 characters.');
    setSaving(true);
    setError('');
    try {
      const saved = await mutate('/api/bookings', 'POST', { spaceId: selected.id, ...searched, title: title.trim(), attendees: Number(attendees) });
      setNotification(saved.notification || 'disabled');
      const refreshed = await refreshReservations();
      setModal('success');
      setTitle('');
      if (!refreshed) setError('Your booking was saved, but the latest schedule could not be loaded. Retry to refresh it.');
    } catch (failure) {
      setError(failure.message);
      try { await refreshReservations(); } catch {}
    } finally { setSaving(false); }
  }
  async function cancelBooking(id) {
    setSaving(true);
    setError('');
    try {
      await mutate(`/api/bookings/${id}`, 'DELETE', {});
      const refreshed = await refreshReservations();
      setModal(null);
      setFeedback('Booking cancelled. The space is available again.');
      if (!refreshed) setError('The reservation was cancelled, but the latest schedule could not be loaded. Retry to refresh it.');
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  return (
    <div className="app">
      <Sidebar page={page} setPage={next => { setPage(next); setFeedback(''); setError(''); }} onHelp={() => setModal('help')} user={user} onLogout={logout}/>
      <main>
        {previewMode && <div className="approval-banner" role="note"><p><strong>Booking Club Project — visual preview.</strong> Explore the classrooms and layout. Sign-in and bookings are not enabled.</p></div>}
        <header className="page-heading"><div><h1>{{ find: 'Find a classroom', bookings: 'My bookings', favorites: 'Your favorite classrooms', schedule: 'Schedule', rules: 'Booking rules', admin: 'Administration', account: 'Your university account' }[page]}</h1><p>{page === 'find' ? 'Book a classroom for your next lecture, seminar, or group session.' : page === 'bookings' ? `Manage your reservations, ${user?.name || 'on campus'}.` : page === 'schedule' ? 'One schedule for classroom bookings and university events.' : page === 'admin' ? 'Approve accounts and manage university events.' : page === 'account' ? 'Register, sign in, and get ready for your next session.' : page === 'rules' ? 'Plan a useful session and make room for others.' : 'Save classrooms you want to book again.'}</p></div><span className="campus-tag"><span/>Coventry University</span></header>
        <div className="summary-grid">
          {[[Armchair, user ? 'Classrooms available' : 'Classrooms to explore', user ? available : activeSpaces.length], [CalendarDays, 'Your upcoming bookings', upcoming.length], [Building2, 'Campus buildings', buildings.length]].map(([Icon, label, value]) => <div className="summary-card" key={label}><span className="summary-icon"><Icon size={28} strokeWidth={1.7}/></span><div><p>{label}</p><strong>{loading ? '–' : value}</strong></div></div>)}
        </div>
        {(page === 'find' || page === 'favorites') && (
          <form className="search-bar" onSubmit={search}>
            <label className="date-field">Date<div className="input-wrap"><CalendarDays size={21}/><input aria-label="Booking date" type="date" min={localDate()} value={date} onChange={event => setDate(event.target.value)} required/></div></label>
            <div className="time-field"><label htmlFor="start-time">Time</label><div className="time-inputs"><div className="input-wrap"><Clock3 size={21}/><select id="start-time" value={start} onChange={event => setStart(event.target.value)}>{times.map(time => <option key={time}>{time}</option>)}</select></div><span>to</span><div className="input-wrap"><select aria-label="End time" value={end} onChange={event => setEnd(event.target.value)}>{times.map(time => <option key={time}>{time}</option>)}</select></div></div></div>
            <button className="primary find-button" type="submit" disabled={refreshing}>{refreshing ? <Loader2 className="spin" size={21}/> : <Search size={21}/>}Find a classroom</button>
          </form>
        )}
        {feedback && <p className="feedback" role="status">{feedback}</p>}
        {user?.status === 'pending' && <div className="approval-banner" role="status"><div><strong>Awaiting administrator approval</strong><p>You can browse classrooms and the schedule. Booking becomes available after approval.</p></div><button className="secondary" onClick={refreshSession}>Check approval status</button></div>}
        {user?.status === 'rejected' && <div className="approval-banner rejected" role="status"><div><strong>Account approval declined</strong><p>Booking is disabled. Contact your university administrator to review your account.</p></div><button className="secondary" onClick={refreshSession}>Check approval status</button></div>}
        {!user && page !== 'account' && page !== 'rules' && <div className="approval-banner"><p>Sign in to view availability and reserve classrooms. New accounts need administrator approval.</p><button className="secondary" onClick={() => setPage('account')}>Sign in / Create account</button></div>}
        {error && <div className="error" role="alert"><AlertCircle size={19}/><span>{error}</span>{!loading && <button onClick={load}>Retry</button>}</div>}
        {loading ? <div className="loading"><Loader2 className="spin" size={28}/><p>Finding your classrooms…</p></div> : page === 'account' ? user ? <div className="collection"><h2>Signed in as {user.name}</h2><p className="panel-description">{user.email} · {user.status}</p><button className="secondary" onClick={logout}>Sign out</button></div> : <AccountPanel setupRequired={setupRequired} onSession={onSession}/> : page === 'rules' ? <BookingRules/> : page === 'admin' ? user?.role === 'admin' ? <Administration onImported={imported}/> : <div className="collection"><p>Administrator access is required.</p></div> : page === 'schedule' ? <Schedule user={user} date={scheduleDate} onDate={setScheduleDate} floor={scheduleFloor} onFloor={setScheduleFloor} spaces={activeSpaces} entries={scheduleEntries} loading={scheduleLoading} onCancel={entry => { setError(''); setModal({ cancel: entry }); }}/> : page === 'find' ? (
          <>
            <h2 className="explore-heading">Explore classrooms</h2>
            <div className="campus-panel">
              <div className="panel-header">
                <label className="building-select"><span className="sr-only">Building</span><select aria-label="Building" value={building} onChange={event => selectFloor(event.target.value, activeSpaces.find(space => space.building === event.target.value)?.floor || '')}>{buildings.map(item => <option key={item}>{item}</option>)}</select></label>
                <label className="floor-select"><span className="sr-only">Floor</span><select aria-label="Floor" value={floor} onChange={event => selectFloor(building, event.target.value)}>{floors.map(item => <option key={item}>{item}</option>)}</select></label>
                <div className="view-toggle" aria-label="Display mode"><button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')} aria-pressed={view === 'map'}><Map size={21}/>Map</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'}><List size={20}/>List</button></div>
              </div>
              <div className="panel-body">
                <div className="map-area">
                  {view === 'map' ? <><div className="plan-viewport" tabIndex={0} aria-label="Classroom floor plan"><FloorPlan spaces={floorSpaces} selected={selected} onSelect={selectSpace} isBooked={isBooked} availabilityKnown={!!user}/></div><p className="map-caption">Illustrative classroom floor plan</p></> : <div className="space-list">{filtered.map(space => <button key={space.id} className={`space-list-item ${selected?.id === space.id ? 'selected' : ''}`} onClick={() => selectSpace(space)}><span className="space-type-icon"><Users/></span><span><strong>{space.name}</strong><small>{resourceScope(space)}</small></span><span className={`list-status ${isBooked(space) ? 'unavailable' : ''}`}>{!user ? 'Sign in for availability' : isBooked(space) ? 'Booked' : 'Available'}</span><ArrowRight size={18}/></button>)}</div>}
                  {!filtered.length && <div className="empty-state"><p>No classrooms on this floor.</p></div>}
                  {!!user && <div className="map-legend"><span><i/>Available</span><span><i className="booked"/>Booked</span><span><i className="selected"/>Selected</span></div>}
                </div>
                <SpaceDetail space={selected} {...searched} niceDate={niceDate} isBooked={selected && isBooked(selected)} isFavorite={selected && favorites.includes(String(selected.id))} toggleFavorite={toggleFavorite} canBook={canBook} availabilityKnown={!!user} onBook={() => { setError(''); setTitle(''); setAttendees(1); setModal('book'); }}/>
              </div>
            </div>
          </>
        ) : page === 'bookings' ? (
          <div className="collection"><div className="collection-heading"><h2>Upcoming reservations</h2><span>{upcoming.length} {upcoming.length === 1 ? 'booking' : 'bookings'}</span></div>
            {upcoming.length ? upcoming.map(booking => { const space = spaces.find(item => String(item.id) === String(booking.spaceId)); return (
              <article className="reservation" key={booking.id}><span className="reservation-icon"><CalendarDays size={25}/></span><div><h3>{space?.name || 'Campus space'}</h3><p>{space?.building} · {space?.floor}</p><p>{niceDate(booking.date, true)} · {booking.start} – {booking.end}</p><small>{booking.title} · {booking.attendees || 1} {(booking.attendees || 1) === 1 ? 'attendee' : 'attendees'}</small></div><span className="confirmed"><Check size={15}/>Confirmed</span>{booking.canCancel && <button className="secondary" onClick={() => { setError(''); setModal({ cancel: booking }); }}>Cancel booking</button>}</article>
            ); }) : <div className="empty-state"><CalendarDays size={40}/><h3>Your next great idea starts here.</h3><p>You don’t have any upcoming bookings yet.</p><button className="primary" onClick={() => setPage('find')}>Find a classroom<ArrowRight size={18}/></button></div>}
          </div>
        ) : (
          <div className="collection"><div className="collection-heading"><h2>Saved for you</h2><span>{savedSpaces.length} classrooms</span></div>
            {savedSpaces.length ? <div className="favorite-grid">{savedSpaces.map(space => <article className="favorite-card" key={space.id}><div className="favorite-card-top"><Armchair size={25}/><button className="icon-button saved" onClick={() => toggleFavorite(space.id)} aria-label={`Remove ${space.name} from favorites`}><Heart size={20} fill="currentColor"/></button></div><h3>{space.name}</h3><p>{space.building} · {space.floor}</p><p>{resourceScope(space)}</p><p className={`availability ${isBooked(space) ? 'unavailable' : ''}`}><span/>{!user ? 'Sign in for availability' : isBooked(space) ? 'Booked for this time' : 'Available'}</p><button className="secondary" onClick={() => { selectSpace(space); setPage('find'); }}>View classroom<ArrowRight size={17}/></button></article>)}</div> : <div className="empty-state"><Heart size={40}/><h3>Keep your favorites close.</h3><p>Tap the heart beside a classroom to save it here.</p><button className="primary" onClick={() => setPage('find')}>Explore classrooms</button></div>}
          </div>
        )}
      </main>
      <BookingDialogs modal={modal} setModal={setModal} selected={selected} profile={user} searched={searched} niceDate={niceDate} title={title} setTitle={setTitle} attendees={attendees} setAttendees={setAttendees} saving={saving} error={error} isBooked={isBooked} book={book} cancelBooking={cancelBooking} setPage={setPage} notification={notification}/>
      {modal === 'help' && <Modal title="A little help finding your classroom" onClose={() => setModal(null)}><div className="help-content"><p>Approved students, teachers and university staff can reserve an entire classroom.</p><ol><li>Create an account, sign in and wait for administrator approval.</li><li>Choose a future date and time, then select <strong>Find a classroom</strong>.</li><li>Enter a reason for this booking and the number of attendees. Respect any listed room capacity.</li><li>Manage your reservations in <strong>My bookings</strong>. University events appear in the shared <strong>Schedule</strong>.</li></ol><div className="help-note"><strong>Illustrative inventory</strong><p>The classroom inventory and floor plans are illustrative and are not an official Coventry University campus map. Favorites are saved in this browser. Booking rules are provisional rules for this application.</p></div></div><button className="primary modal-full" onClick={() => { setModal(null); setPage('rules'); }}>Read booking rules</button></Modal>}
    </div>
  );
}

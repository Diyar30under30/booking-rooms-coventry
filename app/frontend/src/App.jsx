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
import LocationSelect from './components/LocationSelect.jsx';
import { request, mutate, setCsrfToken, previewMode } from './api.js';
import useBookingData from './useBookingData.js';
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
const baseTimes = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
const isBookableRoom = space => space.active && space.bookingScope === 'whole-room';
const roleCanBook = (user, space) => !!user && !!space && (['admin', 'room_admin'].includes(user.role) || (space.bookableBy?.includes(user.role) && (user.role !== 'student' || space.type === 'study-room')));
function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const dayPath = date => `/api/bookings?from=${date}&to=${date}`;

export default function App() {
  const [page, setPage] = useState('find');
  const [spaces, setSpaces] = useState([]);
  const [user, setUser] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(initialDate);
  const [scheduleFloor, setScheduleFloor] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('11:00');
  const [searched, setSearched] = useState(() => ({ date: initialDate(), start: '09:00', end: '11:00' }));
  const [building, setBuilding] = useState('All buildings');
  const [floor, setFloor] = useState('All floors');
  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({ campuses: [], roomTypes: [] });
  const [filters, setFilters] = useState({ campus: '', type: '', capacity: '', equipment: '', accessible: false });
  const [availableOnly, setAvailableOnly] = useState(false);
  const [history, setHistory] = useState(false);
  const [moduleCode, setModuleCode] = useState('');
  const [bookingStatus, setBookingStatus] = useState('requested');
  const [title, setTitle] = useState('');
  const [attendees, setAttendees] = useState(1);
  const [notification, setNotification] = useState('disabled');
  const [feedback, setFeedback] = useState('');
  const [searchRequested, setSearchRequested] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const [favorites, setFavorites] = useState(() => {
    const stored = readStorage('campus-favorites-v2', []);
    return Array.isArray(stored) ? stored.map(String) : [];
  });
  const availability = useBookingData(user?.id, dayPath(searched.date), dataRevision);
  const personalBookings = useBookingData(user?.id, '/api/bookings/mine', dataRevision);
  const schedule = useBookingData(user?.id, page === 'schedule' && scheduleDate ? dayPath(scheduleDate) : null, dataRevision);
  const bookings = availability.entries;
  const mine = personalBookings.entries;
  const availabilityKnown = !!user && availability.status === 'ready';
  const availabilityMessage = !user ? 'Sign in for availability' : availability.status === 'loading' ? 'Checking availability…' : 'Availability unknown';
  const refreshing = availability.status === 'loading';

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [nextSpaces, session, nextConfig] = await Promise.all([request('/api/spaces'), request('/api/auth/session'), previewMode ? Promise.resolve({ campuses: [], roomTypes: [] }) : request('/api/config')]);
      setConfig(nextConfig);
      setSpaces(nextSpaces);
      setUser(session.user); setCsrfToken(session.csrfToken); setSetupRequired(session.setupRequired);
      setDataRevision(current => current + 1);
      const preferred = nextSpaces.find(space => isBookableRoom(space) && space.building === 'Coventry') || nextSpaces.find(isBookableRoom);
      setSelectedId(preferred?.id ?? null);

      const validIds = new Set(nextSpaces.filter(isBookableRoom).map(space => String(space.id)));
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
    const expired = () => { setUser(null); setModal(null); setSearchRequested(false); setFeedback('Please sign in again to continue.'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  useEffect(() => { try { localStorage.setItem('campus-favorites-v2', JSON.stringify(favorites)); } catch {} }, [favorites]);

  const times = [...new Set([...baseTimes, ...config.campuses.flatMap(campus => [campus.opens, campus.closes])])].sort();
  async function refreshCatalogue() { const [nextSpaces, nextConfig] = await Promise.all([request('/api/spaces'), request('/api/config')]); setSpaces(nextSpaces); setConfig(nextConfig); setDataRevision(value => value + 1); }
  const activeSpaces = spaces.filter(isBookableRoom).sort(compareRooms);
  const buildings = [...new Set(activeSpaces.map(space => space.building))].sort(compareLabels);
  const floors = [...new Set(activeSpaces.filter(space => building === 'All buildings' || space.building === building).map(space => space.floor))].sort(compareLabels);
  const isOpen = space => { const campus = config.campuses.find(item => item.name === space?.campus); return !campus || (searched.start >= campus.opens && searched.end <= campus.closes); };
  const isBooked = space => bookings.some(booking => String(booking.spaceId) === String(space.id) && booking.date === searched.date && booking.start < searched.end && booking.end > searched.start);
  const floorSpaces = activeSpaces.filter(space => (building === 'All buildings' || space.building === building) && (floor === 'All floors' || space.floor === floor) && (!filters.campus || space.campus === filters.campus) && (!filters.type || space.type === filters.type) && (!filters.capacity || (space.capacity != null && space.capacity >= Number(filters.capacity))) && (!filters.equipment || space.amenities.some(item => item.toLowerCase().includes(filters.equipment.toLowerCase()))) && (!filters.accessible || space.accessible) && (!availableOnly || !availabilityKnown || (isOpen(space) && !isBooked(space))));
  const filtered = floorSpaces;
  const selected = filtered.find(space => String(space.id) === String(selectedId)) || filtered[0];
  const available = activeSpaces.filter(space => isOpen(space) && !isBooked(space)).length;
  const upcoming = mine.filter(booking => !['declined', 'cancelled'].includes(booking.status) && new Date(`${booking.date}T${booking.end}`) > new Date()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const displayedBookings = history ? mine.filter(booking => !upcoming.includes(booking)).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)) : upcoming;
  const savedSpaces = activeSpaces.filter(space => favorites.includes(String(space.id)));
  const toggleFavorite = id => setFavorites(current => current.includes(String(id)) ? current.filter(item => item !== String(id)) : [...current, String(id)]);
  const canBook = !!user && user.status === 'approved' && availabilityKnown && roleCanBook(user, selected) && isOpen(selected);
  const searchFeedback = !searchRequested ? '' : !user ? 'Sign in to view availability and reserve a room.' : availabilityKnown ? `Showing availability for ${niceDate(searched.date)}, ${searched.start}–${searched.end}.` : refreshing ? 'Checking room availability…' : '';

  async function refreshReservations() {
    const results = await Promise.all([availability.refresh(), personalBookings.refresh(), schedule.refresh()]);
    return results.every(Boolean);
  }
  async function refreshSession() {
    try { const session = await request('/api/auth/session'); setUser(session.user); setCsrfToken(session.csrfToken); setSetupRequired(session.setupRequired); }
    catch (failure) { setError(failure.message); }
  }
  async function onSession(session) {
    setUser(session.user); setCsrfToken(session.csrfToken); setFeedback(`Welcome, ${session.user.name}.`); setError(''); setPage('find');
    await refreshSession();
  }
  async function logout() {
    try { await mutate('/api/auth/logout', 'POST', {}); setCsrfToken(null); setUser(null); setModal(null); setSearchRequested(false); setPage('find'); await refreshSession(); }
    catch (failure) { setError(failure.message); }
  }
  function imported(eventDate, showSchedule) {
    const nextDate = eventDate || searched.date;
    setDate(nextDate); setSearched(current => ({ ...current, date: nextDate })); setScheduleDate(nextDate);
    setDataRevision(current => current + 1);
    if (showSchedule) setPage('schedule');
  }

  function selectSpace(space) { setSelectedId(space.id); }
  function selectFloor(nextBuilding, nextFloor) {
    setBuilding(nextBuilding);
    setFloor(nextFloor);
    setSelectedId(activeSpaces.find(space => space.building === nextBuilding && space.floor === nextFloor)?.id ?? null);
  }
  async function search(event) {
    event.preventDefault();
    setFeedback('');
    setSearchRequested(false);
    if (date < localDate()) return setFeedback('Choose today or a future date.');
    if (end <= start) return setFeedback('End time must be later than start time.');
    if ((new Date(`${date}T${end}`) - new Date(`${date}T${start}`)) / 3600000 > 8) return setFeedback('Bookings can be up to 8 hours. Choose a shorter time.');
    if (new Date(`${date}T${start}`) <= new Date()) return setFeedback('Choose a start time in the future.');
    setError('');
    setSearched({ date, start, end });
    setSearchRequested(true);
    if (date === searched.date && user) await availability.refresh();
  }
  async function book(event) {
    event.preventDefault();
    if (!selected || !canBook) return;
    if (title.trim().length < 3 || title.trim().length > 120) return setError('Give a booking purpose of 3–120 characters.');
    setSaving(true);
    setError('');
    try {
      const saved = await mutate('/api/bookings', 'POST', { spaceId: selected.id, ...searched, title: title.trim(), attendees: Number(attendees), moduleCode: moduleCode.trim() });
      setBookingStatus(saved.status || saved.booking?.status || (selected.type === 'study-room' ? 'approved' : 'requested'));
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
      setFeedback('Booking cancelled.');
      if (!refreshed) setError('The reservation was cancelled, but the latest schedule could not be loaded. Retry to refresh it.');
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  return (
    <div className="app">
      <Sidebar page={page} setPage={next => { setPage(next); setFeedback(''); setSearchRequested(false); setError(''); }} onHelp={() => setModal('help')} user={user} onLogout={logout}/>
      <main>
        {previewMode && <div className="approval-banner" role="note"><p><strong>Booking Club Project — visual preview.</strong> Explore the rooms and layout. Sign-in and bookings are not enabled.</p></div>}
        <header className="page-heading"><div><h1>{{ find: 'Find a room', bookings: 'My bookings', favorites: 'Your favorite rooms', schedule: 'Schedule', rules: 'Booking rules', admin: 'Administration', account: 'Your university account' }[page]}</h1><p>{page === 'find' ? 'Book a room for your next lecture, seminar, or group session.' : page === 'bookings' ? `Manage your reservations, ${user?.name || 'on campus'}.` : page === 'schedule' ? 'One schedule for room bookings and university events.' : page === 'admin' ? 'Review booking requests and manage the room catalogue.' : page === 'account' ? 'Register, sign in, and get ready for your next session.' : page === 'rules' ? 'Plan a useful session and make room for others.' : 'Save rooms you want to book again.'}</p></div><span className="campus-tag"><span/>Coventry University</span></header>
        <div className="summary-grid">
          {[[Armchair, !user ? 'Rooms to explore' : availabilityKnown ? 'Rooms available' : 'Room availability', !user ? activeSpaces.length : availabilityKnown ? available : '–'], [CalendarDays, 'Your upcoming bookings', !user ? 0 : personalBookings.status === 'ready' ? upcoming.length : '–'], [Building2, 'Campus buildings', buildings.length]].map(([Icon, label, value]) => <div className="summary-card" key={label}><span className="summary-icon"><Icon size={28} strokeWidth={1.7}/></span><div><p>{label}</p><strong>{loading ? '–' : value}</strong></div></div>)}
        </div>
        {(page === 'find' || page === 'favorites') && (
          <form className="search-bar" onSubmit={search}>
            <label className="date-field">Date<span className="input-wrap"><CalendarDays size={21}/><input aria-label="Booking date" type="date" min={localDate()} value={date} onChange={event => setDate(event.target.value)} required/></span></label>
            <div className="time-field"><label htmlFor="start-time">Time</label><div className="time-inputs"><div className="input-wrap"><Clock3 size={21}/><select id="start-time" value={start} onChange={event => setStart(event.target.value)}>{times.map(time => <option key={time}>{time}</option>)}</select></div><span>to</span><div className="input-wrap"><select aria-label="End time" value={end} onChange={event => setEnd(event.target.value)}>{times.map(time => <option key={time}>{time}</option>)}</select></div></div></div>
            <button className="primary find-button" type="submit" disabled={refreshing}>{refreshing ? <Loader2 className="spin" size={21}/> : <Search size={21}/>}Find a room</button>
          </form>
        )}
        {(feedback || searchFeedback) && <p className="feedback" role="status">{feedback || searchFeedback}</p>}
        {user && availability.status === 'error' && (page === 'find' || page === 'favorites') && <div className="error" role="alert"><AlertCircle size={19}/><span>Availability could not be loaded. Rooms are not confirmed free. {availability.error}</span><button onClick={() => availability.refresh()}>Retry availability</button></div>}
        {user?.status === 'pending' && <div className="approval-banner" role="status"><div><strong>Awaiting administrator approval</strong><p>You can browse rooms and the schedule. Booking becomes available after approval.</p></div><button className="secondary" onClick={refreshSession}>Check approval status</button></div>}
        {user?.status === 'rejected' && <div className="approval-banner rejected" role="status"><div><strong>Account approval declined</strong><p>Booking is disabled. Contact your university administrator to review your account.</p></div><button className="secondary" onClick={refreshSession}>Check approval status</button></div>}
        {!user && page !== 'account' && page !== 'rules' && <div className="approval-banner"><p>Sign in to view availability and reserve rooms. New accounts need administrator approval.</p><button className="secondary" onClick={() => setPage('account')}>Sign in / Create account</button></div>}
        {error && <div className="error" role="alert"><AlertCircle size={19}/><span>{error}</span>{!loading && <button onClick={load}>Retry</button>}</div>}
        {loading ? <div className="loading"><Loader2 className="spin" size={28}/><p>Finding your rooms…</p></div> : page === 'account' ? user ? <div className="collection"><h2>Signed in as {user.name}</h2><p className="panel-description">{user.email} · {user.status}</p><button className="secondary" onClick={logout}>Sign out</button></div> : <AccountPanel setupRequired={setupRequired} onSession={onSession}/> : page === 'rules' ? <BookingRules/> : page === 'admin' ? ['admin', 'room_admin'].includes(user?.role) ? <Administration user={user} onImported={imported} onCatalogueChanged={refreshCatalogue}/> : <div className="collection"><p>Administrator access is required.</p></div> : page === 'schedule' ? <Schedule user={user} date={scheduleDate} onDate={setScheduleDate} floor={scheduleFloor} onFloor={setScheduleFloor} spaces={spaces.filter(space => space.bookingScope === 'whole-room')} campuses={config.campuses} entries={schedule.entries} status={schedule.status} error={schedule.error} onRetry={() => schedule.refresh()} onCancel={entry => { setError(''); setModal({ cancel: entry }); }}/> : page === 'find' ? (
          <>
            <h2 className="explore-heading">Explore rooms</h2>
            <div className="campus-panel">
              <div className="panel-header">
                <LocationSelect value={building} options={['All buildings', ...buildings]} onChange={value => selectFloor(value, 'All floors')}/>
                <LocationSelect label="Floor" compact value={floor} options={['All floors', ...floors]} onChange={value => selectFloor(building, value)}/>
                <div className="view-toggle" aria-label="Display mode"><button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')} aria-pressed={view === 'map'}><Map size={21}/>Map</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'}><List size={20}/>List</button></div>
              </div>
              <div className="room-filters"><label>Campus<select aria-label="Campus" value={filters.campus} onChange={e => setFilters({...filters, campus:e.target.value})}><option value="">All campuses</option>{[...new Set([...config.campuses.map(campus => campus.name), ...activeSpaces.map(s => s.campus).filter(Boolean)])].map(name => <option key={name}>{name}</option>)}</select></label><label>Room type<select aria-label="Room type" value={filters.type} onChange={e => setFilters({...filters, type:e.target.value})}><option value="">All room types</option>{config.roomTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label>Minimum capacity<input type="number" min="1" value={filters.capacity} onChange={e => setFilters({...filters, capacity:e.target.value})}/></label><label>Equipment<input placeholder="e.g. projector" value={filters.equipment} onChange={e => setFilters({...filters, equipment:e.target.value})}/></label><label className="check-field"><input type="checkbox" checked={filters.accessible} onChange={e => setFilters({...filters, accessible:e.target.checked})}/>Accessible rooms only</label><label className="check-field"><input type="checkbox" checked={availableOnly} disabled={!availabilityKnown} onChange={e => setAvailableOnly(e.target.checked)}/>Available only</label>{!availabilityKnown && <small>{user ? 'Availability filter requires a successful availability check.' : 'Sign in to filter by availability.'}</small>}</div><p className="filter-summary">{filtered.length} rooms match your filters. Capacity filtering excludes rooms with unlisted capacity.</p><div className="panel-body">
                <div className="map-area">
                  {view === 'map' ? <><div className="plan-viewport" tabIndex={0} aria-label="Room floor plan"><FloorPlan spaces={floorSpaces} selected={selected} onSelect={selectSpace} isBooked={isBooked} isOpen={isOpen} availabilityKnown={availabilityKnown} availabilityMessage={availabilityMessage}/></div><p className="map-caption">Illustrative room floor plan</p></> : <div className="space-list">{filtered.map(space => <button key={space.id} className={`space-list-item ${selected?.id === space.id ? 'selected' : ''}`} onClick={() => selectSpace(space)}><span className="space-type-icon"><Users/></span><span><strong>{space.name}</strong><small>{resourceScope(space)}</small></span><span className={`list-status ${!availabilityKnown ? 'unknown' : isBooked(space) ? 'unavailable' : ''}`}>{!availabilityKnown ? availabilityMessage : !isOpen(space) ? 'Outside opening hours' : isBooked(space) ? 'Booked' : 'Available'}</span><ArrowRight size={18}/></button>)}</div>}
                  {!filtered.length && <div className="empty-state"><p>No rooms match these filters. Try a different campus, type, capacity or equipment.</p></div>}
                  {availabilityKnown && <div className="map-legend"><span><i/>Available</span><span><i className="booked"/>Booked</span><span><i className="selected"/>Selected</span></div>}
                </div>
                <SpaceDetail space={selected} {...searched} niceDate={niceDate} isBooked={selected && isBooked(selected)} isFavorite={selected && favorites.includes(String(selected.id))} toggleFavorite={toggleFavorite} canBook={canBook} signedIn={!!user} roleAllowed={roleCanBook(user, selected)} withinHours={isOpen(selected)} openingHours={config.campuses.find(campus => campus.name === selected?.campus)} availabilityKnown={availabilityKnown} availabilityMessage={availabilityMessage} onBook={() => { setError(''); setTitle(''); setModuleCode(''); setAttendees(1); setModal('book'); }}/>
              </div>
            </div>
          </>
        ) : page === 'bookings' ? (
          <div className="collection"><div className="collection-heading"><h2>{history ? 'Booking history' : 'Upcoming reservations'}</h2><div className="tab-row"><button className={`secondary ${!history ? 'selected-tab' : ''}`} onClick={() => setHistory(false)}>Upcoming</button><button className={`secondary ${history ? 'selected-tab' : ''}`} onClick={() => setHistory(true)}>History</button></div><span>{personalBookings.status === 'ready' ? displayedBookings.length : '–'} {displayedBookings.length === 1 ? 'booking' : 'bookings'}</span></div>
            {!user ? <div className="empty-state"><h3>Sign in to view your bookings</h3><p>Your reservations are only shown after you sign in.</p><button className="primary" onClick={() => setPage('account')}>Sign in</button></div> : personalBookings.status === 'loading' ? <p role="status">Loading your bookings…</p> : personalBookings.status !== 'ready' ? <div className="empty-state" role="alert"><h3>Bookings unavailable</h3><p>{personalBookings.error || 'Your bookings could not be loaded.'}</p><button className="secondary" onClick={() => personalBookings.refresh()}>Retry my bookings</button></div> : displayedBookings.length ? displayedBookings.map(booking => { const space = spaces.find(item => String(item.id) === String(booking.spaceId)); return (
              <article className="reservation" key={booking.id}><span className="reservation-icon"><CalendarDays size={25}/></span><div><h3>{space?.name || 'Campus space'}</h3><p>{space?.building} · {space?.floor}</p><p>{niceDate(booking.date, true)} · {booking.start} – {booking.end}</p><small>{booking.title} · {booking.attendees || 1} {(booking.attendees || 1) === 1 ? 'attendee' : 'attendees'}</small>{booking.moduleCode && <p>Module: {booking.moduleCode}</p>}{booking.approvalNote && <p>Review note: {booking.approvalNote}</p>}</div><span className={`booking-status status-${booking.status || 'approved'}`}>{booking.status || 'approved'}</span>{booking.canCancel && <button className="secondary" onClick={() => { setError(''); setModal({ cancel: booking }); }}>Cancel booking</button>}</article>
            ); }) : <div className="empty-state"><CalendarDays size={40}/><h3>Your next great idea starts here.</h3><p>{history ? 'No past, cancelled or declined bookings.' : 'You don’t have any upcoming bookings yet.'}</p><button className="primary" onClick={() => setPage('find')}>Find a room<ArrowRight size={18}/></button></div>}
          </div>
        ) : (
          <div className="collection"><div className="collection-heading"><h2>Saved for you</h2><span>{savedSpaces.length} rooms</span></div>
            {savedSpaces.length ? <div className="favorite-grid">{savedSpaces.map(space => <article className="favorite-card" key={space.id}><div className="favorite-card-top"><Armchair size={25}/><button className="icon-button saved" onClick={() => toggleFavorite(space.id)} aria-label={`Remove ${space.name} from favorites`}><Heart size={20} fill="currentColor"/></button></div><h3>{space.name}</h3><p>{space.building} · {space.floor}</p><p>{resourceScope(space)}</p><p className={`availability ${!availabilityKnown ? 'unknown' : isBooked(space) ? 'unavailable' : ''}`}><span/>{!availabilityKnown ? availabilityMessage : !isOpen(space) ? 'Outside opening hours' : isBooked(space) ? 'Booked for this time' : 'Available'}</p><button className="secondary" onClick={() => { selectSpace(space); setBuilding('All buildings'); setFloor('All floors'); setFilters({campus:'',type:'',capacity:'',equipment:'',accessible:false}); setPage('find'); }}>View room<ArrowRight size={17}/></button></article>)}</div> : <div className="empty-state"><Heart size={40}/><h3>Keep your favorites close.</h3><p>Tap the heart beside a room to save it here.</p><button className="primary" onClick={() => setPage('find')}>Explore rooms</button></div>}
          </div>
        )}
      </main>
      <BookingDialogs modal={modal} setModal={setModal} selected={selected} profile={user} searched={searched} niceDate={niceDate} title={title} setTitle={setTitle} attendees={attendees} setAttendees={setAttendees} saving={saving} error={error} isBooked={isBooked} book={book} cancelBooking={cancelBooking} setPage={setPage} notification={notification} moduleCode={moduleCode} setModuleCode={setModuleCode} bookingStatus={bookingStatus} canBook={canBook} availabilityKnown={availabilityKnown}/>
      {modal === 'help' && <Modal title="A little help finding your room" onClose={() => setModal(null)}><div className="help-content"><p>Students can reserve student-bookable study rooms. Teachers and staff can request rooms allowed for their role. Study rooms are approved automatically; other rooms require review.</p><ol><li>Create an account, sign in and wait for administrator approval.</li><li>Choose a future date and time, then select <strong>Find a room</strong>.</li><li>Enter a reason for this booking and the number of attendees. Respect any listed room capacity.</li><li>Manage your reservations in <strong>My bookings</strong>. University events appear in the shared <strong>Schedule</strong>.</li></ol><div className="help-note"><strong>Illustrative inventory</strong><p>The room inventory and floor plans are illustrative and are not an official Coventry University campus map. Favorites are saved in this browser. Booking rules are provisional rules for this application.</p></div></div><button className="primary modal-full" onClick={() => { setModal(null); setPage('rules'); }}>Read booking rules</button></Modal>}
    </div>
  );
}

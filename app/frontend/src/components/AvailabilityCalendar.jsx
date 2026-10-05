import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { request, previewMode } from '../api.js';
import './AvailabilityCalendar.css';

const formatDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const timeAt = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export default function AvailabilityCalendar({ date, onDate, spaces, entries, loading, user }) {
  const [roomId, setRoomId] = useState('');
  const [monthEntries, setMonthEntries] = useState([]);
  const [state, setState] = useState('unknown');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const month = date.slice(0, 7);
  const first = new Date(`${month}-01T12:00:00`);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  const selectedRoom = spaces.find(space => String(space.id) === roomId) || spaces[0];
  const known = !!user && !previewMode && state === 'ready' && !loading;
  useEffect(() => {
    let current = true;
    setMonthEntries([]); setError('');
    if (!user || previewMode) { setState('unknown'); return; }
    setState('loading');
    const end = formatDate(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0, 12));
    request(`/api/bookings?from=${month}-01&to=${end}`).then(rows => {
      if (current) { setMonthEntries(rows); setState('ready'); }
    }).catch(failure => { if (current) { setError(failure.message); setState('error'); } });
    return () => { current = false; };
  }, [month, user?.id, revision, entries]);
  const roomEntries = monthEntries.filter(entry => String(entry.spaceId) === String(selectedRoom?.id));
  const dayEntries = roomEntries.filter(entry => entry.date === date);
  const days = Array.from({ length: last.getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const offset = (first.getDay() + 6) % 7;
  function moveMonth(delta) { onDate(formatDate(new Date(first.getFullYear(), first.getMonth() + delta, 1, 12))); }
  return <div className="availability-calendar">
    <div className="calendar-toolbar"><div><span className="calendar-eyebrow">ROOM AVAILABILITY</span><h3><CalendarDays size={20}/>Booking calendar</h3></div><label>Room<select aria-label="Calendar room" value={selectedRoom?.id || ''} onChange={event => setRoomId(event.target.value)}>{spaces.map(space => <option key={space.id} value={space.id}>{space.name} · {space.building}</option>)}</select></label><button className="secondary" onClick={() => setRevision(value => value + 1)} disabled={!user || previewMode || state === 'loading'}>Refresh calendar</button></div>
    {(!user || previewMode) && <p className="calendar-notice">{previewMode ? 'Calendar preview — live booking data is not connected yet. Availability is shown as unknown.' : 'Sign in to load live bookings. Grey times mean availability has not been checked.'}</p>}
    {error && <p className="error" role="alert">Could not load availability: {error}</p>}
    <div className="calendar-layout"><div className="month-calendar">
      <div className="calendar-month"><button className="icon-button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={20}/></button><h4>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h4><button className="icon-button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={20}/></button></div>
      <div className="calendar-weekdays">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendar-days">{Array.from({length:offset},(_,index)=><span key={`blank-${index}`}/>)}{days.map(day => {
        const count = (day === date ? dayEntries : roomEntries.filter(entry => entry.date === day)).length;
        const status = known ? count ? 'has-bookings' : 'free' : 'unknown';
        return <button key={day} className={`calendar-day ${status} ${day === date ? 'chosen' : ''}`} aria-label={`${day}, ${known ? count ? `${count} bookings` : 'no bookings' : 'availability unknown'}`} aria-pressed={day === date} onClick={() => onDate(day)}><span>{Number(day.slice(-2))}</span><i/><small>{known && count ? count : ''}</small></button>;
      })}</div>
      <div className="calendar-key"><span><i className="free"/>No bookings</span><span><i className="has-bookings"/>Has bookings</span><span><i className="unknown"/>Unknown</span></div>
    </div><div className="calendar-day-detail"><div className="calendar-day-heading"><h4>{selectedRoom?.name || 'Select a room'}</h4><p>{new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p></div><p className="slot-explanation">{state === 'loading' || loading ? 'Loading bookings…' : '30-minute slots · 08:00–22:00. A booking marks every time slot it overlaps.'}</p>
      <div className="calendar-slots">{Array.from({length:28},(_,index)=>{
        const start=timeAt(480+index*30), end=timeAt(510+index*30);
        const booked=dayEntries.some(entry=>entry.start<end && entry.end>start);
        const label=known ? booked ? 'Booked' : 'Free' : 'Unknown';
        return <div key={start} className={`calendar-slot ${known ? booked ? 'occupied' : 'free' : 'unknown'}`} aria-label={`${start} to ${end}: ${label}`}><time>{start}</time><span>{label}</span></div>;
      })}</div>
      {known && <p className="calendar-footnote">Free means no recorded reservation; opening hours and approval rules still apply. Availability is checked again when you book.</p>}
    </div></div>
  </div>;
}

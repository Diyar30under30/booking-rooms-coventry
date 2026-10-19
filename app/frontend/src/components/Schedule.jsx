import { useState } from 'react';
import { compareLabels, compareRooms } from '../../../shared/rooms.mjs';
import AvailabilityCalendar from './AvailabilityCalendar.jsx';

export default function Schedule({ date, onDate, floor, onFloor, spaces, entries, status, error, onRetry, onCancel, user, campuses }) {
  const [roomId, setRoomId] = useState('');
  const loading = status === 'loading';
  const known = !!user && status === 'ready';
  const floors = [...new Set(spaces.map(space => space.floor))].sort(compareLabels);
  const visible = entries.filter(entry => entry.date === date && (!roomId || String(entry.spaceId) === roomId) && (floor === 'all' || spaces.find(space => space.id === entry.spaceId)?.floor === floor));
  return <section className="collection"><AvailabilityCalendar date={date} onDate={onDate} spaces={spaces} entries={entries} loading={loading} user={user} campuses={campuses}/><div className="collection-heading"><h2>Daily room schedule</h2><span>{known ? `${visible.length} entries` : 'Entries unavailable'}</span></div>
    <div className="schedule-filters"><label>Schedule date<input type="date" value={date} onChange={event => { if (event.target.value) onDate(event.target.value); }} required/></label><label>Floor<select aria-label="Floor" value={floor} onChange={event => onFloor(event.target.value)}><option value="all">All floors</option>{floors.map(item => <option key={item}>{item}</option>)}</select></label><label>Room<select aria-label="Room" value={roomId} onChange={event => setRoomId(event.target.value)}><option value="">All rooms</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name} · {space.building}</option>)}</select></label></div>
    <p className="panel-description">University events and room bookings both reserve the room and appear in availability.</p>
    {!user ? <div className="empty-state"><h3>Sign in to view the schedule</h3><p>Sign in to check recorded bookings and university events.</p></div> : loading ? <p role="status">Loading schedule…</p> : !known ? <div className="empty-state" role="alert"><h3>Schedule unavailable</h3><p>{error || 'The schedule has not been loaded. Please try again.'}</p><button className="secondary" onClick={onRetry}>Retry schedule</button></div> : visible.length ? visible.sort((a, b) => a.start.localeCompare(b.start) || compareRooms(spaces.find(space => space.id === a.spaceId) || { name: '', building: '', floor: '', id: a.spaceId }, spaces.find(space => space.id === b.spaceId) || { name: '', building: '', floor: '', id: b.spaceId }) || a.id - b.id).map(entry => {
      const space = spaces.find(item => item.id === entry.spaceId);
      return <article className="reservation schedule-entry" key={entry.id}><div className="schedule-time">{entry.start}<span>– {entry.end}</span></div><div><span className={`entry-badge ${entry.source === 'event' ? 'event-badge' : ''}`}>{entry.source === 'event' ? 'University event' : 'Room booking'}</span><h3>{entry.title}</h3><p>{space?.name || 'Room'} · {space?.building} · {space?.floor}</p><small>{entry.attendees} attendees</small><span className={`booking-status status-${entry.status || 'approved'}`}>{entry.status || 'approved'}</span></div>{entry.canCancel && <button className="secondary" onClick={() => onCancel(entry)}>{entry.source === 'event' ? 'Cancel event' : 'Cancel booking'}</button>}</article>;
    }) : <div className="empty-state"><h3>No scheduled entries</h3><p>This date and floor have no bookings or university events.</p></div>}
  </section>;
}

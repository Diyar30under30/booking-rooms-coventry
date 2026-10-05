import { compareLabels, compareRooms } from '../../../shared/rooms.mjs';
import AvailabilityCalendar from './AvailabilityCalendar.jsx';

export default function Schedule({ date, onDate, floor, onFloor, spaces, entries, loading, onCancel, user }) {
  const floors = [...new Set(spaces.map(space => space.floor))].sort(compareLabels);
  const visible = entries.filter(entry => entry.date === date && (floor === 'all' || spaces.find(space => space.id === entry.spaceId)?.floor === floor));
  return <section className="collection"><AvailabilityCalendar date={date} onDate={onDate} spaces={spaces} entries={entries} loading={loading} user={user}/><div className="collection-heading"><h2>Daily classroom schedule</h2><span>{visible.length} entries</span></div>
    <div className="schedule-filters"><label>Schedule date<input type="date" value={date} onChange={event => { if (event.target.value) onDate(event.target.value); }} required/></label><label>Floor<select aria-label="Floor" value={floor} onChange={event => onFloor(event.target.value)}><option value="all">All floors</option>{floors.map(item => <option key={item}>{item}</option>)}</select></label></div>
    <p className="panel-description">University events and classroom bookings both reserve the classroom and appear in availability.</p>
    {loading ? <p role="status">Loading schedule…</p> : visible.length ? visible.sort((a, b) => a.start.localeCompare(b.start) || compareRooms(spaces.find(space => space.id === a.spaceId) || { name: '', building: '', floor: '', id: a.spaceId }, spaces.find(space => space.id === b.spaceId) || { name: '', building: '', floor: '', id: b.spaceId }) || a.id - b.id).map(entry => {
      const space = spaces.find(item => item.id === entry.spaceId);
      return <article className="reservation schedule-entry" key={entry.id}><div className="schedule-time">{entry.start}<span>– {entry.end}</span></div><div><span className={`entry-badge ${entry.source === 'event' ? 'event-badge' : ''}`}>{entry.source === 'event' ? 'University event' : 'Classroom booking'}</span><h3>{entry.title}</h3><p>{space?.name || 'Classroom'} · {space?.building} · {space?.floor}</p><small>{entry.attendees} attendees</small></div>{entry.canCancel && <button className="secondary" onClick={() => onCancel(entry)}>{entry.source === 'event' ? 'Cancel event' : 'Cancel booking'}</button>}</article>;
    }) : <div className="empty-state"><h3>No scheduled entries</h3><p>This date and floor have no bookings or university events.</p></div>}
  </section>;
}

import { Armchair, CalendarDays, Clock3, Heart, Plug, Wifi, Sun, Users, VolumeX, Monitor } from 'lucide-react';

import { resourceScope, roomTypeLabel } from '../../../shared/rooms.mjs';
import RoomVisual, { roomStyle } from './RoomVisual.jsx';
export { resourceScope };
const amenityIcon = name => /wi.?fi/i.test(name) ? Wifi : /workstation/i.test(name) ? Monitor : /light/i.test(name) ? Sun : /power|outlet/i.test(name) ? Plug : /quiet/i.test(name) ? VolumeX : Users;

export default function SpaceDetail({ space, date, start, end, niceDate, isBooked, isFavorite, toggleFavorite, onBook, canBook, availabilityKnown, availabilityMessage, signedIn, roleAllowed, openingHours, withinHours }) {
  if (!space) return <div className="space-detail empty-detail"><Armchair size={32}/><h3>A room for your next idea</h3><p>Select a room to see its amenities and reserve it.</p></div>;
  const { kind, Icon } = roomStyle(space);
  return (
    <div className="space-detail">
      <div className={`room-preview room-${kind}`}><span className="room-preview-label"><Icon size={17}/>{roomTypeLabel(space)}</span><RoomVisual kind={kind}/>{space.photo && <img className="room-photo" src={space.photo} alt={space.name}/>}<small>Illustrative layout</small></div>
      <div className="detail-title"><h3>{space.name}</h3><button className={`icon-button favorite-button ${isFavorite ? 'saved' : ''}`} onClick={() => toggleFavorite(space.id)} aria-label={isFavorite ? 'Remove from favorites' : 'Save to favorites'} aria-pressed={isFavorite}><Heart size={20} fill={isFavorite ? 'currentColor' : 'none'}/></button></div>
      <p className="space-location">{space.building} · {space.floor}</p><p className="resource-scope">{resourceScope(space)}</p><p>{space.campus}</p><p>{space.accessible ? 'Accessible room' : 'Accessibility not confirmed'}</p><p>Bookable by: {(space.bookableBy || []).join(', ') || 'Administrators'}</p>{openingHours && <p>Opening hours: {openingHours.opens}–{openingHours.closes}</p>}
      <p className={`availability ${!availabilityKnown ? 'unknown' : isBooked ? 'unavailable' : ''}`}><span/>{!availabilityKnown ? availabilityMessage : !withinHours ? 'Outside opening hours' : isBooked ? 'Booked for this time' : 'Available'}</p>
      {space.amenities.length > 0 && <section><h4>Amenities</h4><ul className="amenities">{space.amenities.map(name => { const Icon = amenityIcon(name); return <li key={name}><Icon size={20}/>{name}</li>; })}</ul></section>}
      <section className="booking-info"><h4>Your booking</h4><p><CalendarDays size={20}/>{niceDate(date)}</p><p><Clock3 size={20}/>{start} – {end}</p></section>
      <button className="primary book-button" disabled={isBooked || !canBook || !availabilityKnown} onClick={onBook}>{!signedIn ? 'Sign in to book' : !availabilityKnown ? 'Availability unconfirmed' : !withinHours ? 'Outside opening hours' : !roleAllowed ? 'Your role cannot book this room' : !canBook ? 'Account approval required' : isBooked ? 'Choose another time' : 'Book this room'}</button>
    </div>
  );
}

import { Armchair, CalendarDays, Clock3, Check, ArrowRight, Loader2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { resourceScope } from './SpaceDetail.jsx';

export default function BookingDialogs({ modal, setModal, selected, profile, searched, niceDate, title, setTitle, attendees, setAttendees, saving, error, isBooked, book, cancelBooking, setPage, notification }) {
  const close = () => { if (!saving) setModal(null); };
  if (modal === 'book' && selected) return (
    <Modal title="Reserve your classroom" onClose={close}>
      <form onSubmit={book}>
        <div className="confirmation-space"><Armchair size={28}/><div><h3>{selected.name}</h3><p>{selected.building} · {selected.floor}</p><p>{resourceScope(selected)}</p></div></div>
        <div className="confirmation-time"><p><CalendarDays size={20}/>{niceDate(searched.date, true)}</p><p><Clock3 size={20}/>{searched.start} – {searched.end}</p></div>
        <label className="title-field">Booking purpose <span>(required, 3–120 characters)</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Group study for research methods" minLength={3} maxLength={120} required/></label>
        <label className="title-field attendee-field">Attendees {selected.capacity != null && <span>{`(up to ${selected.capacity})`}</span>}<input aria-label="Attendees" type="number" min="1" max={selected.capacity ?? undefined} value={attendees} onChange={event => setAttendees(event.target.value)} required/></label>
        <p className="modal-note">Reserved for {profile?.name} ({profile?.role}). You can cancel from My bookings.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary modal-full" type="submit" disabled={saving || isBooked(selected)}>{saving ? <><Loader2 className="spin" size={18}/>Reserving your classroom…</> : isBooked(selected) ? 'This classroom is no longer available' : 'Confirm booking'}</button>
      </form>
    </Modal>
  );
  if (modal === 'success') return (
    <Modal title="Your classroom is reserved." onClose={close}><div className="success-icon"><Check size={35}/></div><p className="success-text">{selected?.name} is reserved for {profile?.name} on {niceDate(searched.date)}, from {searched.start} to {searched.end}.</p>{notification === 'sent' && <p className="modal-note" role="status">The booking details and reason were sent to the Telegram recipient.</p>}{notification === 'failed' && <p className="modal-note" role="status">Your booking is saved, but the Telegram notification could not be delivered. Contact the booking administrator; you do not need to book again.</p>}<button className="primary modal-full" onClick={() => { setModal(null); setPage('bookings'); }}>View my bookings<ArrowRight size={18}/></button><button className="text-button modal-full" onClick={close}>Keep exploring</button></Modal>
  );
  if (modal?.cancel) return (
    <Modal title={modal.cancel.source === 'event' ? 'Cancel this university event?' : 'Cancel this booking?'} onClose={close}><p className="success-text">{modal.cancel.source === 'event' ? 'The university event' : 'Your reservation'} on {niceDate(modal.cancel.date)} at {modal.cancel.start} will be cancelled, and the space will become available to others.</p>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={close} disabled={saving}>Keep {modal.cancel.source === 'event' ? 'event' : 'booking'}</button><button className="primary" onClick={() => cancelBooking(modal.cancel.id)} disabled={saving}>{saving ? 'Cancelling…' : modal.cancel.source === 'event' ? 'Cancel event' : 'Cancel booking'}</button></div></Modal>
  );
  return null;
}

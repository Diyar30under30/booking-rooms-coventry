import { resourceScope, roomTypeLabel } from '../../../shared/rooms.mjs';
import RoomVisual, { roomStyle } from './RoomVisual.jsx';

export default function FloorPlan({ spaces, selected, onSelect, isBooked, availabilityKnown }) {
  return (
    <div className="campus-floorplan" aria-label="Illustrative classroom floor plan">
      <div className={`floorplan-rooms ${spaces.some(space => roomStyle(space).kind === 'library') ? 'community-floor' : ''}`}>
        {spaces.map(space => {
          const booked = isBooked(space);
          const chosen = selected?.id === space.id;
          const { kind, Icon } = roomStyle(space);
          return (
            <button key={space.id} className={`plan-whole-room room-${kind} ${booked ? 'booked' : ''} ${chosen ? 'selected' : ''}`} onClick={() => onSelect(space)} aria-label={`${space.name}, ${resourceScope(space)}, ${!availabilityKnown ? 'sign in for availability' : booked ? 'booked' : 'available'}`} aria-pressed={chosen}>
              <span className="room-type"><Icon size={14}/>{roomTypeLabel(space)}</span>
              <strong>{space.name}</strong>
              <span className="room-capacity">{resourceScope(space)}</span>
              <RoomVisual kind={kind}/>
              <span className="room-plan-status">{!availabilityKnown ? 'Sign in for availability' : booked ? 'Booked' : 'Available'}</span>
            </button>
          );
        })}
      </div>
      <div className="floorplan-corridor">Corridor <span>Entrance →</span></div>
    </div>
  );
}

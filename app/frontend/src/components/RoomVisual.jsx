import { BookOpen, Users, Presentation, Armchair } from 'lucide-react';
import { roomTypeLabel } from '../../../shared/rooms.mjs';
import './RoomVisual.css';

const styles = {
  Library: { kind: 'library', Icon: BookOpen },
  'Club room': { kind: 'club', Icon: Users },
  'Large lecture room': { kind: 'lecture', Icon: Presentation },
  Classroom: { kind: 'classroom', Icon: Armchair },
};
export const roomStyle = space => styles[roomTypeLabel(space)];

// Decorative sketches communicate room use, not measured furniture or capacity.
export default function RoomVisual({ kind }) {
  return <svg className={`room-sketch sketch-${kind}`} viewBox="0 0 240 120" aria-hidden="true" focusable="false">
    {kind === 'library' ? <>
      {[12, 190].map(x => <g key={x}><rect className="sketch-solid" x={x} y="12" width="38" height="96" rx="3"/>{[28, 52, 76].map(y => <path key={y} d={`M${x + 4} ${y}h30 M${x + 11} ${y - 11}v10 M${x + 21} ${y - 9}v8 M${x + 29} ${y - 12}v11`} className="sketch-books"/>)}</g>)}
      {[38, 84].map(y => <g key={y}><rect className="sketch-table" x="80" y={y - 14} width="80" height="26" rx="6"/><rect className="sketch-seat" x="96" y={y - 23} width="17" height="7" rx="2"/><rect className="sketch-seat" x="129" y={y + 15} width="17" height="7" rx="2"/><path className="sketch-line" d={`M112 ${y - 6}l8 2 8-2v12l-8 2-8-2z M120 ${y - 4}v12`}/></g>)}
    </> : kind === 'club' ? <>
      <rect className="sketch-solid" x="18" y="17" width="54" height="25" rx="8"/><rect className="sketch-seat" x="16" y="35" width="58" height="10" rx="4"/>
      <rect className="sketch-solid" x="166" y="75" width="54" height="25" rx="8"/><rect className="sketch-seat" x="164" y="95" width="58" height="10" rx="4"/>
      <circle className="sketch-table" cx="123" cy="59" r="29"/>
      {[[119,18],[119,93],[82,55],[153,55]].map(([x,y]) => <rect key={`${x}-${y}`} className="sketch-seat" x={x} y={y} width="10" height="10" rx="4"/>)}
      <path className="sketch-line" d="M114 53h17v14h-17z M119 57h7 M119 61h7"/>
      <circle className="sketch-solid" cx="203" cy="25" r="12"/><path className="sketch-books" d="M198 25h10 M203 20v10"/>
    </> : kind === 'lecture' ? <>
      <rect className="sketch-solid" x="52" y="6" width="136" height="13" rx="3"/>
      <rect className="sketch-table" x="106" y="24" width="28" height="13" rx="3"/>
      {[48, 71, 94].map(y => <g key={y}>{[20, 50, 80, 143, 173, 203].map(x => <g key={x}><rect className="sketch-table" x={x} y={y} width="18" height="13" rx="3"/><path className="sketch-line" d={`M${x + 2} ${y + 16}h14`}/></g>)}</g>)}
      <path className="sketch-aisle" d="M120 46v65"/>
    </> : <>
      <rect className="sketch-solid" x="70" y="8" width="100" height="8" rx="2"/>
      {[35, 77].map(y => <g key={y}>{[44, 142].map(x => <g key={x}><rect className="sketch-table" x={x} y={y} width="54" height="24" rx="4"/><path className="sketch-line" d={`M${x + 9} ${y + 29}h36`}/></g>)}</g>)}
    </>}
  </svg>;
}

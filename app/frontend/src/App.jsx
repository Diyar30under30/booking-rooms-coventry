import { useState, useEffect } from 'react';
import sampleRooms from './sample-rooms.js';

export default function App(){
const [rooms,setRooms]=useState(sampleRooms); const [error,setError]=useState('');
const visible=rooms;
return <main><header><small>University Room Booking</small><h1>Find your campus room</h1><p>A shared place for teaching, study and meetings.</p></header>{error&&<p className="error" role="alert">{error}</p>}<div className="grid">{visible.map(room=><article key={room.id}><h2>{room.name}</h2><p>{room.building} · {room.type}</p><p>{room.capacity==null?"Capacity unrecorded":`${room.capacity} people`}</p><p>{room.amenities.join(" · ")}</p></article>)}</div>{!visible.length&&!error&&<p>No rooms match.</p>}</main>;
}

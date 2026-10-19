import EstatesAdministration from './EstatesAdministration.jsx';
export default function Administration({user,onImported}) {
 return user.role==='admin' ? <EstatesAdministration onImported={onImported}/> : <section className="collection"><h2>Room administration</h2><p>The room review and catalogue editor arrive in milestone v08. Existing requests remain recorded in the database.</p></section>;
}

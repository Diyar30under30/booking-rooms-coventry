import { useEffect, useState } from 'react';
import { mutate, request } from '../api.js';

export default function Administration({ onImported }) {
  const [tab, setTab] = useState('accounts');
  const [status, setStatus] = useState('pending');
  const [users, setUsers] = useState([]);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function loadUsers() {
    setBusy(true); setError('');
    try { setUsers(await request(`/api/admin/users?status=${status}`)); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  useEffect(() => { if (tab === 'accounts') loadUsers(); }, [tab, status]);
  async function approve(id, nextStatus) {
    setBusy(true); setError('');
    try { await mutate(`/api/admin/users/${id}`, 'PATCH', { status: nextStatus }); await loadUsers(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function chooseFile(event) {
    setPreview(null); setResult(null); setCsv(''); setFilename(''); setError('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) return setError('Choose a CSV file smaller than 256 KB with no more than 500 event rows.');
    try { setCsv(await file.text()); setFilename(file.name); }
    catch { setError('Could not read this file. Select it again.'); }
  }
  async function validate() {
    setBusy(true); setError(''); setResult(null); setPreview(null);
    try { setPreview(await mutate('/api/admin/events/preview', 'POST', { csv })); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function importEvents() {
    setBusy(true); setError('');
    try {
      const imported = await mutate('/api/admin/events/import', 'POST', { csv });
      setResult(imported); setPreview(null);
      await onImported(imported.entries?.[0]?.date, false);
    } catch (failure) {
      if (failure.status === 409) { setPreview(null); setError('Availability changed since the preview. Preview the CSV again and resolve conflicts before importing.'); }
      else setError(failure.message);
    } finally { setBusy(false); }
  }
  function downloadTemplate() {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const url = URL.createObjectURL(new Blob([`classroom,date,start,end,title,attendees\nClassroom 102,${date},09:00,10:00,Research seminar,20\n`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'university-events-template.csv'; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="collection administration"><div className="tab-row">{[['accounts', 'Accounts'], ['events', 'Event schedule']].map(([key, label]) => <button key={key} className={`secondary ${tab === key ? 'selected-tab' : ''}`} onClick={() => { setTab(key); setError(''); }}>{label}</button>)}</div>
    {error && <p className="error" role="alert">{error}</p>}
    {tab === 'accounts' ? <><div className="collection-heading"><h2>Account approvals</h2><label className="compact-filter">Show<select value={status} onChange={event => setStatus(event.target.value)}><option value="pending">Pending</option><option value="all">All accounts</option></select></label></div>
      <div className="table-scroll" tabIndex={0} aria-label="Account approvals table"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.role === 'staff' ? 'University staff' : user.role}</td><td>{user.status}</td><td>{user.role === 'admin' ? 'Administrator' : <div className="table-actions">{user.status !== 'approved' && <button className="secondary" disabled={busy} onClick={() => approve(user.id, 'approved')}>Approve</button>}{user.status !== 'rejected' && <button className="secondary" disabled={busy} onClick={() => approve(user.id, 'rejected')}>Reject</button>}</div>}</td></tr>)}</tbody></table></div>{!users.length && <p className="panel-description" role="status">{busy ? 'Loading accounts…' : 'No accounts match this filter.'}</p>}
    </> : <><h2>Import university events</h2><p className="panel-description">Upload up to 500 rows in a CSV file, maximum 256 KB. Every row must be valid and available before the complete file can be imported. Imported events immediately block classroom availability.</p>
      <button className="secondary" onClick={downloadTemplate}>Download CSV template</button>
      <label className="csv-upload">Event CSV file<input type="file" accept=".csv,text/csv" onChange={chooseFile} disabled={busy}/></label><p className="panel-description">Required columns: classroom, date, start, end, title. The attendees column is optional and defaults to 1. Use the classroom's exact name, YYYY-MM-DD dates and HH:mm times.</p>
      <button className="secondary" disabled={!csv || busy} onClick={validate}>{busy ? 'Please wait…' : 'Preview events'}</button>
      {preview && <><p className="account-notice" role="status">{preview.valid ? `${filename}: all rows are valid and ready to import.` : 'This file has errors. Correct the CSV and upload it again.'}</p><div className="table-scroll" tabIndex={0} aria-label="CSV event preview"><table><thead><tr><th>Row</th><th>Classroom</th><th>Date</th><th>Time</th><th>Purpose</th><th>Attendees</th><th>Validation</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.row}><td>{row.row}</td><td>{row.classroom}</td><td>{row.date}</td><td>{row.start}–{row.end}</td><td>{row.title}</td><td>{row.attendees}</td><td>{row.errors.length ? <span className="validation-error">{row.errors.join('; ')}</span> : 'Ready'}</td></tr>)}</tbody></table></div><button className="primary import-button" disabled={!preview.valid || busy} onClick={importEvents}>Import {preview.rows.length} events</button></>}
      {result && <div className="account-notice" role="status"><p>{result.imported} university events imported.</p><button className="secondary" onClick={() => onImported(result.entries?.[0]?.date, true)}>View schedule</button></div>}
    </>}
  </section>;
}

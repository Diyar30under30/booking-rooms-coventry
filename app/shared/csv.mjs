const fail = (status, message) => Object.assign(new Error(message), { status });

/** Strict RFC-style CSV: quoted commas, escaped quotes, CRLF and quoted newlines. */
export function parseCsv(csv) {
  if (typeof csv !== 'string') throw fail(400, 'CSV must be text.');
  if (new TextEncoder().encode(csv).length > 256 * 1024) throw fail(413, 'CSV must be at most 256 KB.');
  const text = csv.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], value = '', quoted = false, closed = false, atStart = true;
  const field = () => { row.push(value); value = ''; closed = false; atStart = true; };
  const record = () => { field(); rows.push(row); row = []; if (rows.length > 501) throw fail(400, 'CSV may contain at most 500 event rows.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === '"') {
      if (!atStart || closed) throw fail(400, 'Malformed CSV quoting.');
      quoted = true; atStart = false;
    } else if (char === ',') field();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; record(); }
    else {
      if (closed) throw fail(400, 'Unexpected text after a quoted CSV field.');
      value += char; atStart = false;
    }
  }
  if (quoted) throw fail(400, 'Unclosed CSV quote.');
  if (value || row.length || closed || !atStart) record();
  if (!rows.length) throw fail(400, 'CSV needs a header and at least one event.');
  const headers = rows.shift().map(header => header.trim());
  const required = ['classroom', 'date', 'start', 'end', 'title'];
  const allowed = [...required, 'attendees'];
  if (new Set(headers).size !== headers.length || headers.some(header => !allowed.includes(header)) || required.some(header => !headers.includes(header))) throw fail(400, 'Use CSV headers classroom,date,start,end,title and optional attendees.');
  if (!rows.length) throw fail(400, 'CSV needs at least one event.');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw fail(400, `CSV row ${index + 2} has the wrong number of fields.`);
    return { row: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()])) };
  });
}

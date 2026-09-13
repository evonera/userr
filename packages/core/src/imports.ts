/** Delimited-text import utilities. Parsing is intentionally dependency-free
 * and never performs I/O; hosts preview, validate, and persist rows using
 * their own authorization and transaction boundary. */
export interface ImportedFeedback { title: string; body: string; state?: string; voteCount?: number; externalId?: string; }

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) { const char = text[i]; const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ""; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  row.push(cell); if (row.some(Boolean)) rows.push(row); return rows;
}

export function mapFeedbackCsv(text: string): ImportedFeedback[] {
  const [header, ...rows] = parseCsv(text); if (!header) return [];
  const index = Object.fromEntries(header.map((value, i) => [value.trim().toLowerCase(), i]));
  const take = (row: string[], ...names: string[]) => names.map((name) => row[index[name]]?.trim()).find(Boolean) ?? "";
  if (index.title === undefined && index.name === undefined) throw new Error("CSV must include a title or name column.");
  return rows.map((row) => { const votes = take(row, "votes", "vote_count"); return {
    title: take(row, "title", "name"), body: take(row, "description", "body", "details"),
    state: take(row, "status", "state") || undefined, voteCount: votes && /^\d+$/.test(votes) ? Number(votes) : undefined,
    externalId: take(row, "id", "external_id") || undefined,
  }; }).filter((row) => row.title.length > 0);
}

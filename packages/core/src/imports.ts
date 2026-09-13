/** Delimited-text import utilities. Parsing is intentionally dependency-free
 * and never performs I/O; hosts preview, validate, and persist rows using
 * their own authorization and transaction boundary. */
export interface ImportedFeedback { title: string; body: string; state?: string; voteCount?: number; externalId?: string; }
export interface ImportPreviewRow { sourceRow: number; item?: ImportedFeedback; errors: readonly string[]; }

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) { const char = text[i]; const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (char === '"' && !quoted) { if (cell.length) throw new Error("CSV quote must begin a field."); quoted = true; }
    else if (char === '"' && quoted) { if (next && next !== ',' && next !== '\n' && next !== '\r') throw new Error("CSV quote must end a field."); quoted = false; }
    else if (char === ',' && !quoted) { row.push(cell); cell = ""; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  row.push(cell); if (row.some(Boolean)) rows.push(row); return rows;
}

export function mapFeedbackCsv(text: string): ImportedFeedback[] {
  const preview = previewFeedbackCsv(text); const invalid = preview.filter((row) => row.errors.length);
  if (invalid.length) throw new Error(`CSV has validation errors in source rows: ${invalid.map((row) => row.sourceRow).join(", ")}.`);
  return preview.flatMap((row) => row.item ? [row.item] : []);
}
export function previewFeedbackCsv(text: string): ImportPreviewRow[] {
  const [header, ...rows] = parseCsv(text); if (!header) return [];
  const index = Object.fromEntries(header.map((value, i) => [value.trim().toLowerCase(), i]));
  const take = (row: string[], ...names: string[]) => names.map((name) => row[index[name]]?.trim()).find(Boolean) ?? "";
  if (index.title === undefined && index.name === undefined) throw new Error("CSV must include a title or name column.");
  return rows.map((row, offset) => { const votes = take(row, "votes", "vote_count"); const title = take(row, "title", "name"); const errors: string[] = [];
    if (!title) errors.push("title is required"); if (votes && (!/^\d+$/.test(votes) || !Number.isSafeInteger(Number(votes)))) errors.push("vote count must be a safe integer");
    const item = {
    title, body: take(row, "description", "body", "details"),
    state: take(row, "status", "state") || undefined, voteCount: votes && /^\d+$/.test(votes) ? Number(votes) : undefined,
    externalId: take(row, "id", "external_id") || undefined,
  }; return { sourceRow: offset + 2, item: errors.length ? undefined : item, errors }; });
}

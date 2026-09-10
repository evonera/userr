export const normalizeTitle = (title: string) => title.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ");

export function itemPublicId(id: string): string {
  return id.slice(-8).toUpperCase();
}

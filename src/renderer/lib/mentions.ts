/**
 * Extract @-mention agent ids from free-form chat text.
 * Mirrors the original implementation from ChatInput (kept there untouched);
 * shared so other surfaces (e.g. message retry) can parse mentions too.
 */
export function extractMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /@(\S+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].replace(/[,.\s)]*$/, '');
    if (name) mentions.push(name);
  }
  return [...new Set(mentions)];
}

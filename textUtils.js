/** Splits long text into WhatsApp-friendly chunks, preferring clean breaks. */
export function chunkText(text, maxLen = 3500) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function formatModelList(models) {
  return models.map((m, i) => `${i + 1}. ${m.displayName} (${m.name})`).join('\n');
}

/**
 * Convert Markdown-formatted text into WhatsApp-compatible plain text.
 *
 * WhatsApp supports only: *bold*, _italic_, ~strikethrough~, `code`, ```block```
 * Everything else (headers, tables, horizontal rules, links) must be
 * converted to plain-text equivalents.
 *
 * Processing order matters: handle code blocks first to protect their
 * contents, then headings, bold/italic, then structural elements.
 */
export function markdownToWhatsApp(text) {
  if (!text) return text;

  // ── 1. Protect fenced code blocks ───────────────────────────────────────
  // WhatsApp renders ```block``` natively, so we preserve them as-is.
  const codeBlocks = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // ── 2. Protect inline code ───────────────────────────────────────────────
  // WhatsApp renders `code` natively.
  const inlineCodes = [];
  text = text.replace(/`[^`\n]+`/g, (match) => {
    inlineCodes.push(match);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // ── 3. Headers: # Heading → *Heading* ───────────────────────────────────
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '\n*$1*');

  // ── 4. Bold + italic: ***text*** → *_text_* ─────────────────────────────
  text = text.replace(/\*{3}([^*\n]+)\*{3}/g, '*_$1_*');

  // ── 5. Bold: **text** → BOLD_OPEN text BOLD_CLOSE (placeholder) ─────────
  // Use a placeholder so step 6 doesn't re-match the * we emit for bold.
  text = text.replace(/\*{2}([^*\n]+)\*{2}/g, '\x01$1\x01');

  // ── 6. Italic (asterisks): *text* → _text_ ──────────────────────────────
  // Now that **bold** is replaced with placeholders, any remaining *text* is
  // genuine Markdown italic. Avoid matching at the very start of a line
  // followed by a space (which are unordered list items, handled later).
  text = text.replace(/(?<!\n)\*([^*\n]+)\*/g, '_$1_');
  // Also handle italic at start of line that isn't a list bullet
  text = text.replace(/^\*([^*\n ][^*\n]*)\*/gm, '_$1_');

  // ── 7. Restore bold placeholders → *text* ───────────────────────────────
  text = text.replace(/\x01([^\x01\n]+)\x01/g, '*$1*');

  // ── 8. Bold (underscores): __text__ → *text* ────────────────────────────
  text = text.replace(/_{2}([^_\n]+)_{2}/g, '*$1*');

  // ── 9. Strikethrough: ~~text~~ → ~text~ ─────────────────────────────────
  text = text.replace(/~~([^~\n]+)~~/g, '~$1~');

  // ── 10. Horizontal rules → remove ───────────────────────────────────────
  text = text.replace(/^[ \t]*(?:-{3,}|_{3,}|\*{3,})[ \t]*$/gm, '');

  // ── 11. Tables ───────────────────────────────────────────────────────────
  text = convertMarkdownTables(text);

  // ── 12. Unordered list items: - item / * item → • item ──────────────────
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '• ');

  // ── 13. Blockquotes: > text → indented ──────────────────────────────────
  text = text.replace(/^>[ \t]*/gm, '  ');

  // ── 14. Links: [label](url) → label (url) ───────────────────────────────
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // ── 15. Collapse excess blank lines ─────────────────────────────────────
  text = text.replace(/\n{3,}/g, '\n\n');

  // ── 16. Restore protected blocks ────────────────────────────────────────
  text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[i]);
  text = text.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[i]);

  return text.trim();
}

/**
 * Convert a Markdown table into readable plain text.
 *
 * 2-column tables:   *Header A:* Value A   (one line per row)
 * Wider tables:      tab-separated with bold header row
 */
function convertMarkdownTables(text) {
  // A table is a run of lines that all start and end with '|'
  return text.replace(/(?:(?:^|\n)\|.+\|)+/g, (tableBlock) => {
    const lines = tableBlock
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Drop separator rows like |---|:---|
    const dataLines = lines.filter((l) => !/^\|[-:\s|]+\|$/.test(l));
    if (dataLines.length === 0) return '';

    const parseRow = (line) =>
      line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);

    const headers = parseRow(dataLines[0]);
    const rows = dataLines.slice(1).map(parseRow);

    let result = '\n';
    if (headers.length === 2) {
      // Compact key-value format for 2-column tables
      // Include header row if it looks like real headers (not data)
      for (const row of rows) {
        const key = row[0] ?? '';
        const val = row[1] ?? '';
        result += `*${key}:* ${val}\n`;
      }
    } else {
      // Multi-column: bold header line + rows separated by ·
      result += `*${headers.join('  •  ')}*\n`;
      for (const row of rows) {
        result += row.join('  •  ') + '\n';
      }
    }
    return result;
  });
}

/**
 * Zero-dependency browser file reader supporting `.md`, `.txt`, `.html`, `.json`,
 * and Microsoft Word `.docx` (via native browser `DecompressionStream('deflate-raw')`
 * reading `word/document.xml` — zero external CDN dependencies or server uploads!).
 */

export async function extractMarkdownFromFile(file) {
  const name = file.name || 'Uploaded Document';
  const ext = name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'docx') {
    return extractDocxToMarkdown(await file.arrayBuffer(), name);
  }

  const rawText = await file.text();
  if (ext === 'html' || ext === 'htm') {
    return htmlToCleanMarkdown(rawText);
  }

  return rawText.replace(/\r\n/g, '\n');
}

export function htmlToCleanMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines = [];

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return '';

    const childrenText = Array.from(node.childNodes).map(walk).join('');
    if (tag === 'h1') return `\n# ${childrenText.trim()}\n`;
    if (tag === 'h2') return `\n## ${childrenText.trim()}\n`;
    if (tag === 'h3') return `\n### ${childrenText.trim()}\n`;
    if (tag === 'h4') return `\n#### ${childrenText.trim()}\n`;
    if (tag === 'strong' || tag === 'b') return `**${childrenText.trim()}**`;
    if (tag === 'em' || tag === 'i') return `*${childrenText.trim()}*`;
    if (tag === 'li') return `\n- ${childrenText.trim()}`;
    if (tag === 'p' || tag === 'div') return `\n${childrenText.trim()}\n`;
    if (tag === 'br') return '\n';
    if (tag === 'tr') {
      const cells = Array.from(node.querySelectorAll(':scope > th, :scope > td')).map((c) =>
        c.textContent.trim().replace(/\|/g, '\\|'),
      );
      return cells.length ? `\n| ${cells.join(' | ')} |` : '';
    }
    return childrenText;
  }

  lines.push(walk(doc.body));
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocxToMarkdown(arrayBuffer, fallbackTitle) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Could not read .docx archive structure. Please export as Markdown (.md) or Plain Text (.txt).');
  }

  const cdEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  let ptr = cdOffset;
  let docXmlBytes = null;
  const decoder = new TextDecoder('utf-8');

  for (let e = 0; e < cdEntries; e++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const fileNameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const entryName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + fileNameLen));

    if (entryName === 'word/document.xml') {
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const slice = bytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        docXmlBytes = slice;
      } else if (compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(slice);
        writer.close();
        const outBuf = await new Response(ds.readable).arrayBuffer();
        docXmlBytes = new Uint8Array(outBuf);
      }
      break;
    }
    ptr += 46 + fileNameLen + extraLen + commentLen;
  }

  if (!docXmlBytes) {
    throw new Error('Could not extract word/document.xml from .docx file.');
  }

  const xmlText = decoder.decode(docXmlBytes);
  const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));
  const mdLines = [];

  for (const p of paragraphs) {
    const pStyle = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    const isList = p.getElementsByTagName('w:numPr').length > 0;
    const runs = Array.from(p.getElementsByTagName('w:t'))
      .map((t) => t.textContent || '')
      .join('');
    const trimmed = runs.trim();
    if (!trimmed) continue;

    if (/Heading1|Title/i.test(pStyle)) {
      mdLines.push(`# ${trimmed}`);
    } else if (/Heading2/i.test(pStyle)) {
      mdLines.push(`## ${trimmed}`);
    } else if (/Heading3/i.test(pStyle)) {
      mdLines.push(`### ${trimmed}`);
    } else if (isList) {
      mdLines.push(`- ${trimmed}`);
    } else {
      mdLines.push(trimmed);
    }
  }

  return mdLines.length > 0
    ? mdLines.join('\n\n')
    : `# ${fallbackTitle.replace(/\.docx$/i, '')}\n`;
}

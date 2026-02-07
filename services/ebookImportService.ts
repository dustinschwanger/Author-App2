
interface ImportedBookData {
  title: string;
  author: string;
  highlights: {
    text: string;
    page?: string;
    location?: string;
    createdAt?: string;
  }[];
}

/**
 * Parses Kindle's My Clippings.txt format.
 */
export const parseKindleClippings = (text: string): ImportedBookData[] => {
  const sections = text.split('==========').filter(s => s.trim().length > 0);
  const bookMap = new Map<string, ImportedBookData>();

  sections.forEach(section => {
    const lines = section.trim().split(/\r?\n/);
    if (lines.length < 2) return;

    const titleLine = lines[0].trim();
    const lastParenIndex = titleLine.lastIndexOf('(');
    let title = titleLine;
    let author = "Unknown Author";

    if (lastParenIndex > 0) {
      title = titleLine.substring(0, lastParenIndex).trim();
      const rawAuthor = titleLine.substring(lastParenIndex + 1, titleLine.length - 1).trim();
      if (rawAuthor.includes(',')) {
        const parts = rawAuthor.split(',').map(s => s.trim());
        author = parts.length === 2 ? `${parts[1]} ${parts[0]}` : rawAuthor;
      } else {
        author = rawAuthor;
      }
    }

    const metaLine = lines[1].trim();
    let page = undefined;
    const pageMatch = metaLine.match(/page (\d+)/i);
    if (pageMatch) page = pageMatch[1];
    
    let contentStartIndex = 2;
    while (lines[contentStartIndex] !== undefined && lines[contentStartIndex].trim() === '') {
        contentStartIndex++;
    }
    
    const content = lines.slice(contentStartIndex).join('\n').trim();
    if (!content || content.toLowerCase().startsWith('bookmark')) return;

    const key = `${title}-${author}`.toLowerCase();
    if (!bookMap.has(key)) {
      bookMap.set(key, { title, author, highlights: [] });
    }

    bookMap.get(key)!.highlights.push({ 
      text: content, 
      page,
      createdAt: new Date().toISOString()
    });
  });

  return Array.from(bookMap.values());
};

/**
 * Parses Nook or Kindle HTML export formats.
 */
export const parseHtmlHighlights = (htmlContent: string): ImportedBookData[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const bookMap = new Map<string, ImportedBookData>();

  // Attempt to find title/author (Platform specific logic)
  let title = doc.querySelector('h1, .bookTitle, .title, .metadata h1')?.textContent?.trim() || "Imported Ebook";
  let author = doc.querySelector('h2, .authors, .author, .metadata h2')?.textContent?.trim() || "Unknown Author";

  // Different platforms use different classes
  // Nook: .bm-item
  // Kindle HTML: .noteHeading / .noteText
  // General: blockquote
  const highlights: any[] = [];
  
  // Strategy 1: Kindle HTML Export
  const kindleNotes = doc.querySelectorAll('.noteText');
  if (kindleNotes.length > 0) {
    kindleNotes.forEach(el => {
      const text = el.textContent?.trim();
      if (text) highlights.push({ text });
    });
  } else {
    // Strategy 2: Nook and General
    const highlightElements = doc.querySelectorAll('.bm-item, .highlight, .annotation, blockquote, .item');
    highlightElements.forEach(el => {
      const text = el.querySelector('.bm-text, .text, p')?.textContent?.trim() || el.textContent?.trim();
      if (text && text.length > 5) {
        const pageMatch = el.textContent?.match(/page\s*(\d+)/i);
        highlights.push({
          text,
          page: pageMatch ? pageMatch[1] : undefined
        });
      }
    });
  }

  if (highlights.length > 0) {
    bookMap.set(`${title}-${author}`.toLowerCase(), { title, author, highlights });
  }

  return Array.from(bookMap.values());
};

export const parseImportText = (text: string): ImportedBookData[] => {
  const trimmed = text.trim();
  if (trimmed.includes('==========')) {
    return parseKindleClippings(trimmed);
  }
  if (trimmed.startsWith('<') || trimmed.includes('<!DOCTYPE html>') || trimmed.includes('<html>')) {
    return parseHtmlHighlights(trimmed);
  }
  
  return [];
};


export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  totalHighlights: number;
  lastRead?: string;
}

export interface Thought {
  id: string;
  text: string;
  createdAt: string;
}

export interface Highlight {
  id: string;
  bookId: string;
  text: string;
  pageNumber?: number;
  thoughts: Thought[];
  createdAt: string;
  imageUrl?: string; // The captured snippet
  source: 'scanned' | 'digital'; // Smart Categorization
}

export interface ExtractionResult {
  text: string;
  pageNumber: number | null;
}

export type ViewState = 'LIBRARY' | 'BOOK_DETAILS';

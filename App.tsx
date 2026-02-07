
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { HashRouter, Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  Book as BookIcon, 
  ChevronLeft, 
  Camera, 
  Save, 
  Edit3, 
  Share2, 
  Trash2, 
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  X,
  RefreshCw,
  Mic,
  Square,
  Download,
  Upload,
  FileText,
  Settings,
  MoreVertical,
  ChevronRight,
  TrendingUp,
  Award,
  LayoutGrid,
  Clock,
  Zap,
  Smartphone,
  Scan,
  CheckCircle2
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Book, Highlight, Thought, ViewState } from './types';
import { searchForBook, analyzeHighlightImage, identifyBookFromCover, synthesizeBook, transcribeAudio } from './services/geminiService';
import { parseImportText } from './services/ebookImportService';
import CameraModal from './components/CameraModal';

// --- Local Storage Helpers ---
const STORAGE_KEY_BOOKS = 'lumina_books';
const STORAGE_KEY_HIGHLIGHTS = 'lumina_highlights';

const getStoredBooks = (): Book[] => {
  const stored = localStorage.getItem(STORAGE_KEY_BOOKS);
  return stored ? JSON.parse(stored) : [];
};

const saveBooks = (books: Book[]) => {
  localStorage.setItem(STORAGE_KEY_BOOKS, JSON.stringify(books));
};

const getStoredHighlights = (bookId: string): Highlight[] => {
  const stored = localStorage.getItem(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights: any[] = stored ? JSON.parse(stored) : [];
  
  return allHighlights
    .filter((h: any) => h.bookId === bookId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

const getAllHighlightsWithBooks = (): { highlight: Highlight, book: Book }[] => {
  const storedHighlights = localStorage.getItem(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights: any[] = storedHighlights ? JSON.parse(storedHighlights) : [];
  const books = getStoredBooks();
  const bookMap = new Map(books.map(b => [b.id, b]));

  return allHighlights
    .filter(h => bookMap.has(h.bookId))
    .map(h => ({
      highlight: h,
      book: bookMap.get(h.bookId)!
    }));
};

const updateStoredHighlight = (updatedHighlight: Highlight) => {
  const stored = localStorage.getItem(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights: Highlight[] = stored ? JSON.parse(stored) : [];
  const index = allHighlights.findIndex(h => h.id === updatedHighlight.id);
  
  if (index !== -1) {
    allHighlights[index] = updatedHighlight;
    localStorage.setItem(STORAGE_KEY_HIGHLIGHTS, JSON.stringify(allHighlights));
  }
};

const deleteStoredHighlight = (highlightId: string) => {
  const stored = localStorage.getItem(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights: Highlight[] = stored ? JSON.parse(stored) : [];
  const filtered = allHighlights.filter(h => h.id !== highlightId);
  localStorage.setItem(STORAGE_KEY_HIGHLIGHTS, JSON.stringify(filtered));
};

// --- Components ---

const LoadingSpinner = () => <Loader2 className="animate-spin text-accent" size={24} />;

const VoiceInput = ({ onTranscriptionComplete, className = "" }: { onTranscriptionComplete: (text: string) => void, className?: string }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          setIsProcessing(true);
          try {
            const text = await transcribeAudio(base64Audio, audioBlob.type);
            onTranscriptionComplete(text);
          } catch (error) {
            console.error(error);
          } finally {
            setIsProcessing(false);
          }
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone error. Check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <button
      onClick={isRecording ? stopRecording : startRecording}
      disabled={isProcessing}
      className={`p-2 rounded-full transition-all duration-200 ${className} ${
        isRecording ? 'bg-red-50 text-red-500 animate-pulse' : isProcessing ? 'bg-gray-50 text-gray-400 cursor-wait' : 'hover:bg-gray-100 text-gray-400 hover:text-accent'
      }`}
    >
      {isProcessing ? <Loader2 size={18} className="animate-spin" /> : isRecording ? <Square size={18} fill="currentColor" /> : <Mic size={18} />}
    </button>
  );
};

// --- Share Card Helpers ---
const fetchFontCss = async () => {
  try {
    const res = await fetch('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;1,400&display=swap');
    return res.ok ? await res.text() : '';
  } catch (e) { return ''; }
};

const getSafeImageBase64 = async (url: string): Promise<string | null> => {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  const fetchAsDataUrl = async (targetUrl: string) => {
    const response = await fetch(targetUrl, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error('Fetch failed');
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  try {
    return await fetchAsDataUrl(url);
  } catch (e) {
    try {
      const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=400&output=jpg`;
      return await fetchAsDataUrl(proxyUrl);
    } catch (proxyError) {
      console.warn("Lumina: Image capture failed for URL", url);
      return `https://placehold.co/400x600/2d2a2e/ffffff?text=No+Cover`;
    }
  }
};

const ShareCardModal = ({ highlight, book, onClose }: { highlight: Highlight, book: Book, onClose: () => void }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);
  const [safeCoverUrl, setSafeCoverUrl] = useState<string | null>(null);
  const [fontCss, setFontCss] = useState<string | null>(null);

  useEffect(() => {
    const prepare = async () => {
      try {
        const [fontData, coverData] = await Promise.all([
          fetchFontCss(), 
          getSafeImageBase64(book.coverUrl)
        ]);
        setFontCss(fontData);
        setSafeCoverUrl(coverData);
      } catch (err) {
        console.error("Lumina: Preparation failed", err);
        setIsGenerating(false);
      }
    };
    prepare();
  }, [book.coverUrl]);

  useEffect(() => {
    if (fontCss === null || safeCoverUrl === null) return;
    
    const generate = async () => {
      if (cardRef.current) {
        try {
          await new Promise(r => setTimeout(r, 500));
          const dataUrl = await toPng(cardRef.current, { 
            cacheBust: true, 
            pixelRatio: 2,
            backgroundColor: '#fdfbf7',
            skipAutoScale: true,
          });
          setGeneratedImage(dataUrl);
        } catch (err) { 
          console.error("Lumina: Rendering failed", err); 
        } finally { 
          setIsGenerating(false); 
        }
      }
    };
    generate();
  }, [fontCss, safeCoverUrl]);

  const handleShare = async () => {
    if (!generatedImage) return;
    try {
      const blob = await (await fetch(generatedImage)).blob();
      const file = new File([blob], 'lumina-highlight.png', { type: 'image/png' });
      if (navigator.share) {
        try { await navigator.share({ files: [file], title: 'Highlight: ' + book.title }); } catch (e) {}
      } else {
        const link = document.createElement('a');
        link.href = generatedImage;
        link.download = 'lumina-highlight.png';
        link.click();
      }
    } catch (e) {}
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
       <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition">
         <X size={24} />
       </button>
       <div className="absolute top-0 left-0 -z-50 opacity-0 pointer-events-none overflow-hidden">
          <div ref={cardRef} className="w-[600px] min-h-[750px] bg-[#fdfbf7] p-12 flex flex-col relative" style={{ fontFamily: 'Merriweather, serif' }}>
             <style dangerouslySetInnerHTML={{ __html: fontCss || '' }} />
             <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-accent via-yellow-400 to-accent opacity-80" />
             <div className="flex-1 flex flex-col justify-center py-8">
                <blockquote className="text-4xl text-[#2d2a2e] leading-snug font-serif italic">"{highlight.text}"</blockquote>
                {highlight.pageNumber && <p className="mt-6 text-gray-400 font-sans text-sm font-bold uppercase tracking-widest">Page {highlight.pageNumber}</p>}
             </div>
             <div className="pt-8 border-t-2 border-gray-100 flex items-center gap-6">
                <div className="w-20 h-32 bg-gray-200 shadow-md flex-shrink-0 overflow-hidden">
                   {safeCoverUrl ? (
                     <img src={safeCoverUrl} crossOrigin="anonymous" className="w-full h-full object-cover" alt="Cover" />
                   ) : (
                     <div className="w-full h-full bg-ink flex items-center justify-center text-white/20"><BookIcon size={24} /></div>
                   )}
                </div>
                <div className="flex-1">
                   <h3 className="text-2xl font-bold text-[#2d2a2e] leading-tight mb-1 font-serif">{book.title}</h3>
                   <p className="text-lg text-gray-500 font-sans">{book.author}</p>
                </div>
             </div>
             <div className="absolute bottom-6 right-8 text-gray-300 font-sans text-[10px] font-bold tracking-widest uppercase">Lumina Read</div>
          </div>
       </div>
       <div className="max-w-full max-h-[70vh] flex items-center justify-center overflow-hidden rounded-2xl shadow-2xl mb-8">
          {isGenerating ? (
            <div className="w-64 h-80 bg-white flex flex-col items-center justify-center gap-4 text-gray-400 rounded-2xl">
              <LoadingSpinner />
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">Synthesizing Visual...</span>
            </div>
          ) : (
            generatedImage && <img src={generatedImage} alt="Share Card" className="max-w-full max-h-[70vh] object-contain" />
          )}
       </div>
       {!isGenerating && generatedImage && (
         <div className="flex gap-4">
            <button onClick={handleShare} className="bg-accent text-white px-8 py-3 rounded-full font-bold shadow-lg hover:bg-accent/90 transition-all flex items-center gap-2"><Share2 size={18} />Share</button>
            <button onClick={handleShare} className="bg-white text-ink px-8 py-3 rounded-full font-bold shadow-lg hover:bg-gray-100 transition-all flex items-center gap-2"><Download size={18} />Download</button>
         </div>
       )}
    </div>
  );
};

const ReadingDashboard = ({ books, highlights }: { books: Book[], highlights: { highlight: Highlight, book: Book }[] }) => {
  const streakCount = useMemo(() => {
    if (highlights.length === 0) return 0;
    const dates = highlights.map(h => new Date(h.highlight.createdAt).toDateString());
    const uniqueDates = Array.from(new Set(dates)).map(d => new Date(d));
    uniqueDates.sort((a, b) => b.getTime() - a.getTime());
    let streak = 0;
    const today = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    const hasToday = dates.includes(today);
    const hasYesterday = dates.includes(yesterdayStr);
    if (!hasToday && !hasYesterday) return 0;
    let checkDate = hasToday ? new Date() : yesterday;
    checkDate.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const dStr = checkDate.toDateString();
      if (dates.includes(dStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
        checkDate.setHours(0, 0, 0, 0);
      } else { break; }
    }
    return streak;
  }, [highlights]);

  return (
    <div className="mb-12">
      <div className="flex items-center gap-2 mb-4 px-1">
        <TrendingUp size={16} className="text-accent" />
        <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Reading Pulse</h2>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white p-5 rounded-[28px] shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
          <div className="p-2 bg-indigo-50 text-indigo-500 rounded-xl mb-3"><BookIcon size={18} /></div>
          <span className="text-xl font-bold text-ink leading-none mb-1 tracking-tight">{books.length}</span>
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none">Books</span>
        </div>
        <div className="bg-white p-5 rounded-[28px] shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
          <div className="p-2 bg-orange-50 text-orange-500 rounded-xl mb-3"><Award size={18} /></div>
          <span className="text-xl font-bold text-ink leading-none mb-1 tracking-tight">{highlights.length}</span>
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none">Ideas</span>
        </div>
        <div className="bg-accent/5 p-5 rounded-[28px] border border-accent/10 flex flex-col items-center justify-center text-center">
          <div className={`p-2 rounded-xl mb-3 ${streakCount > 0 ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'bg-gray-100 text-gray-400'}`}>
            <Zap size={18} fill={streakCount > 0 ? "currentColor" : "none"} />
          </div>
          <span className="text-xl font-bold text-accent leading-none mb-1 tracking-tight">{streakCount}d</span>
          <span className="text-[9px] font-bold text-accent/60 uppercase tracking-widest leading-none">Streak</span>
        </div>
      </div>
    </div>
  );
};

const BookSettingsModal = ({ book, isOpen, onClose, onUpdate, onDelete }: { book: Book, isOpen: boolean, onClose: () => void, onUpdate: (title: string, author: string) => void, onDelete: () => void }) => {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl">
        <h2 className="text-lg font-bold mb-6 font-serif">Book Settings</h2>
        <div className="space-y-4 mb-8">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl focus:ring-2 focus:ring-accent/20 outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Author</label>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl focus:ring-2 focus:ring-accent/20 outline-none" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
           <button onClick={() => onUpdate(title, author)} className="w-full py-3 bg-accent text-white font-bold rounded-xl hover:bg-accent/90 transition">Save Changes</button>
           <button onClick={onDelete} className="w-full py-3 text-red-500 font-bold hover:bg-red-50 rounded-xl transition flex items-center justify-center gap-2"><Trash2 size={18} /> Delete Book</button>
           <button onClick={onClose} className="w-full py-3 text-gray-400 font-medium">Cancel</button>
        </div>
      </div>
    </div>
  );
};

const ImportModal = ({ isOpen, onClose, onImport }: { isOpen: boolean, onClose: () => void, onImport: (text: string) => Promise<any> }) => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'KINDLE' | 'NOOK'>('KINDLE');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    if ('files' in e.target && (e.target as HTMLInputElement).files) {
      file = (e.target as HTMLInputElement).files![0];
    } else if ('dataTransfer' in e && (e as React.DragEvent).dataTransfer.files) {
      file = (e as React.DragEvent).dataTransfer.files[0];
    }
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) setText(event.target.result as string);
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e);
  };

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await onImport(text);
      setText('');
      onClose();
    } catch (e: any) { alert(e.message); } finally { setLoading(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[32px] w-full max-w-xl p-8 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-serif font-bold text-ink">Sync Ebook Highlights</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400"><X size={24} /></button>
        </div>
        
        <div className="flex gap-2 p-1 bg-gray-100 rounded-2xl mb-8">
           <button onClick={() => setActiveTab('KINDLE')} className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${activeTab === 'KINDLE' ? 'bg-white shadow-sm text-ink' : 'text-gray-400'}`}>Kindle (USB)</button>
           <button onClick={() => setActiveTab('NOOK')} className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${activeTab === 'NOOK' ? 'bg-white shadow-sm text-ink' : 'text-gray-400'}`}>Nook / Mobile HTML</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-8 pb-4 hide-scrollbar">
          <div className="bg-accent/5 p-5 rounded-[24px] border border-accent/10">
            <h3 className="text-[10px] font-bold text-accent mb-2 uppercase tracking-widest">Guide</h3>
            <p className="text-xs text-ink/70 leading-relaxed font-medium">
              {activeTab === 'KINDLE' 
                ? "Connect your Kindle device. Navigate to 'documents' and drag 'My Clippings.txt' into the box below."
                : "Export your highlights as HTML from the mobile app (Kindle or Nook) and upload the file below."}
            </p>
          </div>

          <div 
             onDragOver={handleDragOver}
             onDragLeave={handleDragLeave}
             onDrop={handleDrop}
             onClick={() => fileInputRef.current?.click()}
             className={`border-2 border-dashed rounded-[32px] p-12 flex flex-col items-center justify-center cursor-pointer transition-all group ${
               isDragging ? 'border-accent bg-accent/5 scale-[1.02]' : 'border-gray-200 hover:border-accent/40 hover:bg-accent/5'
             }`}
          >
             <div className="w-16 h-16 rounded-3xl bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-accent group-hover:text-white transition-all mb-4 shadow-sm">
                <Upload size={28} />
             </div>
             <p className="text-sm font-bold text-ink">Drop your export file here</p>
             <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2">or click to browse files</p>
             <input ref={fileInputRef} type="file" accept=".txt,.html" onChange={handleFileUpload} className="hidden" />
          </div>

          {text && (
            <div className="relative animate-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center mb-2 px-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Content Loaded</span>
                <button onClick={() => setText('')} className="text-xs text-red-500 font-bold hover:underline">Clear</button>
              </div>
              <textarea
                value={text}
                readOnly
                className="w-full h-32 p-4 bg-gray-50 border border-gray-200 rounded-2xl font-mono text-[10px] focus:outline-none resize-none opacity-60"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t border-gray-100">
          <button onClick={onClose} className="px-6 py-2.5 text-gray-400 font-bold text-xs uppercase tracking-widest hover:text-ink transition">Cancel</button>
          <button 
            onClick={handleSubmit} 
            disabled={!text.trim() || loading} 
            className="px-8 py-2.5 bg-accent text-white font-bold text-xs uppercase tracking-widest rounded-2xl hover:bg-accent/90 disabled:opacity-50 shadow-lg shadow-accent/20 transition flex items-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {loading ? 'Processing...' : 'Sync Highlights'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ImportSummary {
  totalBooksProcessed: number;
  totalHighlightsAdded: number;
  updates: { title: string; newCount: number }[];
}

const ImportSummaryModal = ({ summary, onClose }: { summary: ImportSummary, onClose: () => void }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-300">
       <div className="bg-white rounded-[32px] w-full max-w-md p-8 shadow-2xl overflow-hidden flex flex-col">
          <div className="flex flex-col items-center text-center mb-8">
             <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 size={32} />
             </div>
             <h2 className="text-2xl font-serif font-bold text-ink">Sync Complete</h2>
             <p className="text-sm text-gray-500 mt-1">Your library is up to date.</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
             <div className="bg-gray-50 p-4 rounded-2xl text-center">
                <div className="text-2xl font-bold text-ink mb-1">{summary.totalBooksProcessed}</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Books Scanned</div>
             </div>
             <div className="bg-indigo-50 p-4 rounded-2xl text-center">
                <div className="text-2xl font-bold text-indigo-600 mb-1">+{summary.totalHighlightsAdded}</div>
                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">New Ideas</div>
             </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[250px] mb-8 pr-2 hide-scrollbar">
             <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 sticky top-0 bg-white py-1">Recent Updates</h3>
             <div className="space-y-3">
                {summary.updates.length > 0 ? summary.updates.map((up, i) => (
                   <div key={i} className="flex justify-between items-center bg-gray-50/50 p-3 rounded-xl border border-gray-100">
                      <span className="text-xs font-serif font-bold text-ink/80 truncate pr-4">{up.title}</span>
                      <span className="text-[10px] font-bold px-2 py-1 bg-white rounded-lg text-accent shadow-sm border border-accent/5">+{up.newCount}</span>
                   </div>
                )) : (
                   <div className="text-center py-6 text-gray-400 text-xs italic">No new highlights found in this batch.</div>
                )}
             </div>
          </div>

          <button onClick={onClose} className="w-full py-4 bg-ink text-white rounded-2xl font-bold shadow-xl hover:bg-slate-800 transition-all active:scale-[0.98]">Got it</button>
       </div>
    </div>
  );
};

const Library = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [isAddingBook, setIsAddingBook] = useState(false);
  const [addBookQuery, setAddBookQuery] = useState('');
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [dailyPick, setDailyPick] = useState<{ highlight: Highlight, book: Book } | null>(null);
  const navigate = useNavigate();

  const allHighlightsWithBooks = useMemo(() => getAllHighlightsWithBooks(), [books]);

  useEffect(() => {
    setBooks(getStoredBooks());
    refreshDailyPick();
  }, []);

  const refreshDailyPick = () => {
    const all = getAllHighlightsWithBooks();
    if (all.length > 0) setDailyPick(all[Math.floor(Math.random() * all.length)]);
  };

  const filteredLibrary = useMemo(() => {
    if (!globalSearchQuery.trim()) return null;
    const lower = globalSearchQuery.toLowerCase();
    const matchingBooks = books.filter(b => b.title.toLowerCase().includes(lower) || b.author.toLowerCase().includes(lower));
    const matchingHighlights = allHighlightsWithBooks.filter(({ highlight }) => highlight.text.toLowerCase().includes(lower) || highlight.thoughts.some(t => t.text.toLowerCase().includes(lower)));
    return { books: matchingBooks, highlights: matchingHighlights };
  }, [globalSearchQuery, books, allHighlightsWithBooks]);

  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addBookQuery.trim()) return;
    setIsAdding(true);
    const newBook = await searchForBook(addBookQuery);
    setIsAdding(false);
    if (newBook) {
      const updatedBooks = [newBook, ...books];
      setBooks(updatedBooks);
      saveBooks(updatedBooks);
      setAddBookQuery('');
      setIsAddingBook(false);
    } else { alert("Book not found. You can try snapping a photo of the cover."); }
  };

  const handleCoverScan = async (imageSrc: string) => {
    setIsScannerOpen(false);
    setIsAdding(true);
    const result = await identifyBookFromCover(imageSrc);
    if (result && result.title) {
      const query = result.isbn ? `isbn:${result.isbn}` : `${result.title} ${result.author}`;
      const newBook = await searchForBook(query);
      const finalBook: Book = newBook || { id: crypto.randomUUID(), title: result.title, author: result.author || "Unknown", coverUrl: imageSrc, totalHighlights: 0 };
      if (finalBook.coverUrl.includes('placehold.co')) finalBook.coverUrl = imageSrc;
      const updatedBooks = [finalBook, ...books];
      setBooks(updatedBooks);
      saveBooks(updatedBooks);
      setIsAddingBook(false);
    } else { alert("Could not identify book. Try searching by title."); }
    setIsAdding(false);
  };

  const handleBulkImport = async (importText: string) => {
    const importedBooksData = parseImportText(importText);
    if (importedBooksData.length === 0) throw new Error("No highlights detected in that file.");

    const currentBooks = [...getStoredBooks()];
    const allHighlights = JSON.parse(localStorage.getItem(STORAGE_KEY_HIGHLIGHTS) || '[]');
    let addedCount = 0;
    const updates: { title: string; newCount: number }[] = [];

    for (const iBook of importedBooksData) {
       let bookObj = currentBooks.find(b => b.title.toLowerCase() === iBook.title.toLowerCase());
       let newHighlightsInBook = 0;

       if (!bookObj) {
         const meta = await searchForBook(`${iBook.title} ${iBook.author}`);
         bookObj = meta || { id: crypto.randomUUID(), title: iBook.title, author: iBook.author, coverUrl: `https://placehold.co/400x600?text=${encodeURIComponent(iBook.title)}`, totalHighlights: 0 };
         currentBooks.unshift(bookObj);
       }
       
       iBook.highlights.forEach(h => {
         const exists = allHighlights.some((eh: any) => eh.bookId === bookObj!.id && eh.text === h.text);
         if (!exists) {
           allHighlights.push({ 
             id: crypto.randomUUID(), 
             bookId: bookObj!.id, 
             text: h.text, 
             pageNumber: h.page ? parseInt(h.page) : undefined, 
             thoughts: [], 
             createdAt: new Date().toISOString(),
             source: 'digital'
           });
           addedCount++;
           newHighlightsInBook++;
           bookObj!.totalHighlights++;
         }
       });

       if (newHighlightsInBook > 0) {
          updates.push({ title: iBook.title, newCount: newHighlightsInBook });
       }
    }

    setBooks(currentBooks);
    saveBooks(currentBooks);
    localStorage.setItem(STORAGE_KEY_HIGHLIGHTS, JSON.stringify(allHighlights));
    
    setImportSummary({
       totalBooksProcessed: importedBooksData.length,
       totalHighlightsAdded: addedCount,
       updates
    });
  };

  return (
    <div className="min-h-screen bg-paper pb-20">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur-md border-b border-gray-100 px-6 py-4">
        <div className="flex justify-between items-center max-w-2xl mx-auto">
          <h1 className="text-2xl font-serif font-bold text-ink">Lumina</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsImportModalOpen(true)} title="Bulk Sync" className="p-2 rounded-full text-gray-500 hover:bg-gray-100 transition"><Upload size={22} /></button>
            <button onClick={() => setIsGlobalSearchOpen(!isGlobalSearchOpen)} title="Search" className="p-2 rounded-full text-gray-500 hover:bg-gray-100 transition"><Search size={22} /></button>
            <button onClick={() => setIsAddingBook(!isAddingBook)} title="Add Book" className="p-2 rounded-full text-accent hover:bg-gray-100 transition"><Plus size={22} /></button>
          </div>
        </div>
        
        {isGlobalSearchOpen && (
           <div className="max-w-2xl mx-auto mt-4 animate-in fade-in slide-in-from-top-2 duration-200"><input type="text" placeholder="Search across your library..." className="w-full px-10 py-3 rounded-2xl bg-white border border-gray-200 shadow-sm outline-none focus:ring-2 focus:ring-accent/20" value={globalSearchQuery} onChange={(e) => setGlobalSearchQuery(e.target.value)} autoFocus /></div>
        )}
        {isAddingBook && (
          <div className="max-w-2xl mx-auto mt-4 flex gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <input type="text" placeholder="Book title or Author..." className="flex-1 px-4 py-3 rounded-2xl bg-white border border-accent/20 shadow-sm outline-none" value={addBookQuery} onChange={(e) => setAddBookQuery(e.target.value)} autoFocus />
            <button onClick={() => setIsScannerOpen(true)} className="p-3 bg-white border border-gray-200 rounded-2xl text-gray-400 hover:text-accent transition shadow-sm"><Camera size={20} /></button>
            <button onClick={handleAddBook} disabled={isAdding} className="bg-accent text-white px-6 py-3 rounded-2xl font-bold shadow-md active:scale-95 transition-all">{isAdding ? <Loader2 size={18} className="animate-spin" /> : 'Add'}</button>
          </div>
        )}
      </header>

      <main className="px-6 py-8 max-w-2xl mx-auto">
        {filteredLibrary ? (
          <div className="space-y-6">
             <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">Search Results</h2>
             {filteredLibrary.books.map(book => <div key={book.id} onClick={() => navigate(`/book/${book.id}`)} className="bg-white p-3 rounded-2xl flex gap-4 cursor-pointer hover:shadow-md transition shadow-sm border border-gray-100"><img src={book.coverUrl} className="w-12 h-16 object-cover rounded-lg" /><div className="flex-1"><h3 className="font-bold text-sm leading-tight mb-1">{book.title}</h3><p className="text-xs text-gray-400">{book.author}</p></div></div>)}
             {filteredLibrary.highlights.map(({ highlight, book }) => <div key={highlight.id} onClick={() => navigate(`/book/${book.id}`)} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 cursor-pointer group hover:border-accent/30 transition-all"><blockquote className="italic font-serif leading-relaxed text-ink/80 group-hover:text-ink">"{highlight.text}"</blockquote><div className="mt-3 flex items-center justify-between text-[9px] font-bold text-gray-400 uppercase tracking-widest"><span>— {book.title}</span><ChevronRight size={14} /></div></div>)}
          </div>
        ) : (
          <>
            <ReadingDashboard books={books} highlights={allHighlightsWithBooks} />
            {books.length > 0 && dailyPick && (
              <div className="mb-10 group">
                <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 px-2">Moment of Reflection</h2>
                <div onClick={() => navigate(`/book/${dailyPick.book.id}`)} className="p-8 bg-gradient-to-br from-ink to-slate-800 rounded-[32px] text-white shadow-xl relative overflow-hidden cursor-pointer active:scale-[0.98] transition-all">
                  <Sparkles className="absolute -top-6 -right-6 w-32 h-32 opacity-10 group-hover:rotate-12 transition-transform duration-700" />
                  <div className="relative z-10 font-serif text-xl italic mb-8 leading-relaxed opacity-90">"{dailyPick.highlight.text}"</div>
                  <div className="flex items-center gap-4 border-t border-white/10 pt-6">
                    <img src={dailyPick.book.coverUrl} className="w-10 h-14 object-cover rounded-lg shadow-lg" />
                    <div className="text-xs">
                      <strong className="block mb-1 text-sm font-serif">{dailyPick.book.title}</strong>
                      <p className="opacity-50 uppercase tracking-widest text-[9px] font-bold">{dailyPick.book.author}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex justify-between items-center mb-6 px-2">
              <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Your Collection</h2>
              <div className="flex gap-2 text-[10px] font-bold text-accent uppercase tracking-widest">
                <button className="flex items-center gap-1 opacity-50 hover:opacity-100 transition"><LayoutGrid size={12} /> Grid</button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
              {books.map(book => (
                <div key={book.id} onClick={() => navigate(`/book/${book.id}`)} className="group cursor-pointer">
                  <div className="relative aspect-[2/3] rounded-[32px] overflow-hidden shadow-lg transition-all duration-300 group-hover:-translate-y-2 group-hover:shadow-2xl bg-gray-200">
                    <img src={book.coverUrl} className="w-full h-full object-cover" />
                    <div className="absolute top-4 right-4 px-2 py-1 bg-black/50 backdrop-blur-md rounded-xl text-[10px] font-bold text-white ring-1 ring-white/10">{book.totalHighlights}</div>
                  </div>
                  <h3 className="mt-5 font-serif font-bold text-sm leading-[1.3] line-clamp-2 group-hover:text-accent transition-colors">{book.title}</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.1em] mt-2 opacity-70 leading-none">{book.author}</p>
                </div>
              ))}
              {books.length === 0 && (
                <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-[32px] text-gray-400">
                  <BookIcon size={48} className="mb-4 opacity-20" />
                  <p className="text-sm font-medium">Your library is currently empty</p>
                  <button onClick={() => setIsAddingBook(true)} className="mt-4 text-accent font-bold text-xs uppercase tracking-widest">Add your first book</button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
      <CameraModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onCapture={handleCoverScan} />
      <ImportModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onImport={handleBulkImport} />
      {importSummary && <ImportSummaryModal summary={importSummary} onClose={() => setImportSummary(null)} />}
    </div>
  );
};

const HighlightThreadView = ({ highlight, book, onClose, onAddThought, onDelete, onShare }: { highlight: Highlight, book: Book, onClose: () => void, onAddThought: (text: string) => void, onDelete: () => void, onShare: () => void }) => {
  const [newThought, setNewThought] = useState('');
  return (
    <div className="fixed inset-0 z-50 bg-paper flex flex-col animate-in slide-in-from-right duration-300">
      <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-paper/95 backdrop-blur-sm">
        <button onClick={onClose} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors"><ChevronLeft size={24} /></button>
        <div className="flex flex-col items-center">
          <span className="font-serif font-bold text-sm leading-none mb-1">Conversation</span>
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{book.title}</span>
        </div>
        <div className="flex gap-1"><button onClick={onShare} title="Share" className="p-2 text-gray-400 hover:text-accent transition-colors"><Share2 size={20} /></button><button onClick={onDelete} title="Delete" className="p-2 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={20} /></button></div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-10 hide-scrollbar">
        <blockquote className="font-serif text-2xl italic leading-relaxed text-ink border-l-[6px] border-accent/20 pl-8">"{highlight.text}"</blockquote>
        <div className="space-y-8">
           {highlight.thoughts.map(thought => (
             <div key={thought.id} className="flex gap-4 group">
                <div className="w-10 h-10 rounded-2xl bg-yellow-50 flex items-center justify-center text-yellow-600 flex-shrink-0 group-hover:scale-110 transition-transform shadow-sm"><MessageCircle size={18} /></div>
                <div className="bg-white p-5 rounded-3xl rounded-tl-none shadow-sm border border-gray-100 flex-1 text-sm leading-relaxed text-ink/80">{thought.text}</div>
             </div>
           ))}
           {highlight.thoughts.length === 0 && (
             <div className="text-center py-10 opacity-30 flex flex-col items-center">
                <Sparkles size={32} className="mb-4" />
                <p className="text-xs font-bold uppercase tracking-widest">Add your first reflection below</p>
             </div>
           )}
        </div>
      </div>
      <div className="p-4 bg-white border-t border-gray-100 pb-10 flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea 
            value={newThought} 
            onChange={(e) => setNewThought(e.target.value)} 
            placeholder="Share an insight..." 
            className="w-full bg-gray-50 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none min-h-[56px] max-h-32 text-sm leading-relaxed" 
          />
          <div className="absolute right-2 bottom-2 flex gap-1">
             <VoiceInput onTranscriptionComplete={(t) => setNewThought(prev => prev ? prev + ' ' + t : t)} />
          </div>
        </div>
        <button onClick={() => { if(!newThought.trim()) return; onAddThought(newThought); setNewThought(''); }} className="p-4 bg-accent text-white rounded-2xl shadow-xl active:scale-95 transition-all"><Send size={20} /></button>
      </div>
    </div>
  );
};

const BookDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftPage, setDraftPage] = useState<number | string>('');
  const [draftNote, setDraftNote] = useState('');
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(null);
  const [synthesisResult, setSynthesisResult] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ highlight: Highlight, book: Book } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const found = getStoredBooks().find(b => b.id === id);
    if (found) { setBook(found); setHighlights(getStoredHighlights(id)); } else navigate('/');
  }, [id, navigate]);

  const handleCapture = async (imageSrc: string) => {
    setIsCameraOpen(false); setIsCreating(true);
    const result = await analyzeHighlightImage(imageSrc);
    setDraftText(result.text); setDraftPage(result.pageNumber || '');
  };

  const saveNewHighlight = () => {
    if (!book || !draftText.trim()) return;
    const newH: Highlight = { 
      id: crypto.randomUUID(), 
      bookId: book.id, 
      text: draftText, 
      pageNumber: parseInt(String(draftPage)) || undefined, 
      thoughts: draftNote ? [{ id: crypto.randomUUID(), text: draftNote, createdAt: new Date().toISOString() }] : [], 
      createdAt: new Date().toISOString(),
      source: 'scanned'
    };
    const allH = JSON.parse(localStorage.getItem(STORAGE_KEY_HIGHLIGHTS) || '[]');
    localStorage.setItem(STORAGE_KEY_HIGHLIGHTS, JSON.stringify([...allH, newH]));
    setHighlights([newH, ...highlights]);
    const allB = getStoredBooks();
    const bIndex = allB.findIndex(b => b.id === book.id);
    if (bIndex >= 0) { allB[bIndex].totalHighlights++; saveBooks(allB); setBook({ ...allB[bIndex] }); }
    setIsCreating(false); setDraftText(''); setDraftPage(''); setDraftNote('');
  };

  const updateBookDetails = (title: string, author: string) => {
    if (!book) return;
    const allB = getStoredBooks();
    const bIndex = allB.findIndex(b => b.id === book.id);
    if (bIndex >= 0) {
      allB[bIndex].title = title;
      allB[bIndex].author = author;
      saveBooks(allB);
      setBook({ ...allB[bIndex] });
    }
    setIsSettingsOpen(false);
  };

  const deleteBook = () => {
    if (!book) return;
    if (!confirm("Are you sure? This will remove the book and all associated highlights forever.")) return;
    const allB = getStoredBooks().filter(b => b.id !== book.id);
    saveBooks(allB);
    const allH = JSON.parse(localStorage.getItem(STORAGE_KEY_HIGHLIGHTS) || '[]').filter((h: any) => h.bookId !== book.id);
    localStorage.setItem(STORAGE_KEY_HIGHLIGHTS, JSON.stringify(allH));
    navigate('/');
  };

  if (!book) return null;

  return (
    <div className="min-h-screen bg-paper pb-32">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur-md border-b border-gray-100 flex items-center p-4 gap-4">
        <button onClick={() => navigate('/')} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ChevronLeft size={24} /></button>
        <div className="flex-1 min-w-0"><h1 className="font-serif font-bold truncate text-sm">{book.title}</h1></div>
        <button onClick={() => setIsSettingsOpen(true)} title="Book Settings" className="p-2 text-gray-400 hover:text-ink transition-colors"><Settings size={22} /></button>
      </header>
      
      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex gap-8 mb-16 items-end">
          <div className="relative group">
            <img src={book.coverUrl} className="w-32 h-48 object-cover rounded-[24px] shadow-2xl border-4 border-white transition-transform duration-500 group-hover:scale-105" />
            <div className="absolute -bottom-2 -right-2 bg-accent text-white p-2 rounded-xl shadow-lg group-hover:rotate-12 transition-all"><Award size={18} /></div>
          </div>
          <div className="flex-1 pb-2">
            <h2 className="font-serif text-3xl font-bold leading-tight mb-2 tracking-tight">{book.title}</h2>
            <p className="text-gray-400 font-bold uppercase tracking-[0.2em] text-[10px] leading-none">{book.author}</p>
            {highlights.length >= 3 && (
              <button 
                onClick={async () => { setIsSynthesizing(true); try { setSynthesisResult(await synthesizeBook(book, highlights)); } catch(e) { alert("Synthesis failed."); } finally { setIsSynthesizing(false); } }} 
                className="mt-8 flex items-center gap-2 bg-ink text-white px-5 py-2.5 rounded-full font-bold text-[10px] uppercase tracking-widest hover:bg-slate-800 active:scale-95 transition-all shadow-lg shadow-ink/20"
              >
                {isSynthesizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} 
                {isSynthesizing ? 'Synthesizing...' : 'Generate Essay'}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-12 relative">
          <div className="absolute left-0 top-0 bottom-0 w-px bg-gray-100 ml-0" />
          {highlights.map(h => (
            <div key={h.id} onClick={() => setSelectedHighlight(h)} className="group relative border-l-2 border-transparent hover:border-accent pl-8 transition-all cursor-pointer">
              <div className="flex justify-between items-start gap-4">
                <blockquote className="font-serif italic text-xl leading-[1.6] text-ink/80 group-hover:text-ink transition-colors line-clamp-4">"{h.text}"</blockquote>
                <div className="flex flex-col items-center gap-2">
                   <button onClick={(e) => { e.stopPropagation(); setShareTarget({ highlight: h, book }); }} className="p-2 text-gray-300 hover:text-accent opacity-0 group-hover:opacity-100 transition"><Share2 size={16} /></button>
                   <div className="opacity-0 group-hover:opacity-100 transition">
                      {h.source === 'digital' ? <Smartphone size={14} className="text-indigo-400" /> : <Scan size={14} className="text-orange-400" />}
                   </div>
                </div>
              </div>
              <div className="mt-5 flex items-center gap-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                <span className="flex items-center gap-1">
                   {h.source === 'digital' ? <Smartphone size={10} className="text-indigo-400" /> : <Scan size={10} className="text-orange-400" />}
                   {h.source === 'digital' ? 'Digital' : 'Scanned'}
                </span>
                {h.pageNumber && <span className="flex items-center gap-1"><FileText size={10} /> Page {h.pageNumber}</span>}
                <span className="flex items-center gap-1"><Clock size={10} /> {new Date(h.createdAt).toLocaleDateString()}</span>
                {h.thoughts.length > 0 && <span className="text-accent flex items-center gap-1"><MessageCircle size={10} /> {h.thoughts.length} Thoughts</span>}
              </div>
            </div>
          ))}
          {highlights.length === 0 && (
            <div className="py-20 flex flex-col items-center justify-center text-gray-400">
               <Camera size={48} className="mb-4 opacity-20" />
               <p className="text-sm">No highlights yet. Tap the camera to start.</p>
            </div>
          )}
        </div>
      </main>

      <div className="fixed bottom-8 right-8 z-40 flex flex-col gap-4">
         <button onClick={() => setIsCreating(true)} title="Manual Entry" className="bg-white text-ink p-4 rounded-full shadow-xl hover:scale-105 active:scale-95 transition-all border border-gray-100"><Edit3 size={24} /></button>
         <button onClick={() => setIsCameraOpen(true)} title="Scan Highlight" className="bg-accent text-white p-5 rounded-[24px] shadow-2xl hover:scale-105 active:scale-95 transition-all ring-4 ring-white"><Camera size={32} /></button>
      </div>

      <CameraModal isOpen={isCameraOpen} onClose={() => setIsCameraOpen(false)} onCapture={handleCapture} />
      
      {isCreating && (
        <div className="fixed inset-0 z-[80] bg-paper p-6 animate-in slide-in-from-bottom duration-300 flex flex-col">
          <div className="flex justify-between items-center mb-10 max-w-2xl mx-auto w-full">
            <button onClick={() => setIsCreating(false)} className="text-gray-400 font-bold text-xs uppercase tracking-widest">Cancel</button>
            <h2 className="font-serif font-bold text-lg">New Highlight</h2>
            <button onClick={saveNewHighlight} className="text-accent font-bold text-xs uppercase tracking-widest">Save</button>
          </div>
          <div className="flex-1 space-y-8 max-w-2xl mx-auto w-full overflow-y-auto hide-scrollbar">
            <div className="relative">
               <textarea 
                  value={draftText} 
                  onChange={(e) => setDraftText(e.target.value)} 
                  placeholder="The author's words..." 
                  className="w-full h-48 bg-white border border-gray-100 rounded-[32px] p-8 font-serif italic text-2xl shadow-inner focus:outline-none focus:ring-2 focus:ring-accent/10" 
               />
               <div className="absolute -bottom-4 right-8 flex gap-4 bg-paper px-4">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold uppercase text-gray-300 tracking-widest">Page</label>
                    <input type="number" value={draftPage} onChange={(e) => setDraftPage(e.target.value)} className="w-16 p-2 bg-gray-50 border border-gray-100 rounded-xl text-center text-xs font-bold" />
                  </div>
               </div>
            </div>
            <textarea 
               value={draftNote} 
               onChange={(e) => setDraftNote(e.target.value)} 
               placeholder="Why does this matter? Your initial thought..." 
               className="w-full flex-1 bg-gray-50 border-0 rounded-[32px] p-8 text-ink/80 focus:outline-none focus:bg-white transition-colors" 
            />
          </div>
        </div>
      )}

      {selectedHighlight && <HighlightThreadView highlight={selectedHighlight} book={book} onClose={() => setSelectedHighlight(null)} onAddThought={(t) => { const nT: Thought = { id: crypto.randomUUID(), text: t, createdAt: new Date().toISOString() }; const uH = { ...selectedHighlight, thoughts: [...selectedHighlight.thoughts, nT] }; setSelectedHighlight(uH); updateStoredHighlight(uH); setHighlights(hls => hls.map(h => h.id === uH.id ? uH : h)); }} onDelete={() => { if(confirm("Remove highlight?")) { deleteStoredHighlight(selectedHighlight.id); setHighlights(hls => hls.filter(h => h.id !== selectedHighlight.id)); setSelectedHighlight(null); } }} onShare={() => setShareTarget({ highlight: selectedHighlight, book })} />}
      {shareTarget && <ShareCardModal highlight={shareTarget.highlight} book={shareTarget.book} onClose={() => setShareTarget(null)} />}
      
      {synthesisResult && (
        <div className="fixed inset-0 z-[100] bg-paper p-8 overflow-y-auto animate-in slide-in-from-bottom duration-500 hide-scrollbar">
          <div className="max-w-2xl mx-auto py-12">
            <button onClick={() => setSynthesisResult(null)} className="mb-12 p-3 rounded-full hover:bg-gray-100 transition-colors"><ChevronLeft size={28} /></button>
            <div className="prose prose-paper font-serif leading-relaxed text-ink space-y-8 pb-20">
               {synthesisResult.split('\n').map((line, i) => {
                 if (line.startsWith('##')) return <h2 key={i} className="text-2xl font-bold mt-12 mb-6 text-accent">{line.replace('##', '').trim()}</h2>;
                 if (line.trim() === '') return null;
                 return <p key={i} className="text-lg opacity-90 leading-loose">{line}</p>;
               })}
            </div>
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2">
               <button onClick={() => window.print()} className="bg-ink text-white px-8 py-3 rounded-full font-bold shadow-2xl flex items-center gap-2 hover:bg-slate-800 transition-all"><Download size={18} /> Export as PDF</button>
            </div>
          </div>
        </div>
      )}

      <BookSettingsModal 
        book={book} 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        onUpdate={updateBookDetails} 
        onDelete={deleteBook} 
      />
    </div>
  );
};

const App = () => (
  <HashRouter>
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/book/:id" element={<BookDetail />} />
    </Routes>
  </HashRouter>
);

export default App;

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen, Upload, ArrowLeft, CaretLeft, CaretRight, Check,
  DownloadSimple, Eye, Trash, Books, Target, Lightning, X,
  Plus, FilePdf, PencilSimple, Highlighter, Eraser,
  TextT, Palette, FloppyDisk, Note,
} from '@phosphor-icons/react';
import {
  loadData, saveData, uid,
  scorePriority, getPriorityLevel, getPriorityLabel,
  RESEARCH_KEYWORDS,
  getPageAnnotations, savePageAnnotations,
} from './utils';
import {
  loadPdf, extractOutline, extractTextFromPages,
  renderPage, extractChapterPdf,
} from './pdfEngine';

// ── VIEWS ──
const VIEW = { HOME: 'home', CHAPTERS: 'chapters', READER: 'reader' };

export default function App() {
  const [data, setData] = useState(() => loadData());
  const [view, setView] = useState(VIEW.HOME);
  const [activeBookId, setActiveBookId] = useState(null);
  const [readerState, setReaderState] = useState(null);
  const [pdfCache, setPdfCache] = useState({}); // bookId -> { arrayBuffer, pdfDoc }
  const [processing, setProcessing] = useState(false);

  // Persist
  useEffect(() => { saveData(data); }, [data]);

  const activeBook = data.books.find(b => b.id === activeBookId);

  // ── Stats ──
  const totalChapters = data.books.reduce((s, b) => s + (b.chapters?.length || 0), 0);
  const doneChapters = data.books.reduce(
    (s, b) => s + (b.chapters?.filter(c => c.done).length || 0), 0
  );
  const priorityChapters = data.books.reduce(
    (s, b) => s + (b.chapters?.filter(c => c.priority === 'high').length || 0), 0
  );

  // ── Upload handler ──
  const handleUpload = useCallback(async (file) => {
    if (!file || !file.name.endsWith('.pdf')) return;
    setProcessing(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await loadPdf(arrayBuffer.slice(0));

      // Try extracting chapters from bookmarks
      let chapters = await extractOutline(pdfDoc);
      const hasBookmarks = chapters && chapters.length > 0;

      if (!hasBookmarks) {
        // Fallback: create one chapter per ~30 pages
        const total = pdfDoc.numPages;
        const chunkSize = 30;
        chapters = [];
        for (let i = 1; i <= total; i += chunkSize) {
          const end = Math.min(i + chunkSize - 1, total);
          chapters.push({
            title: `Seção ${chapters.length + 1} (p. ${i}–${end})`,
            startPage: i,
            endPage: end,
          });
        }
      }

      // Score each chapter
      const scoredChapters = [];
      for (const ch of chapters) {
        const text = await extractTextFromPages(pdfDoc, ch.startPage, Math.min(ch.startPage + 4, ch.endPage));
        const { score, matches } = scorePriority(text);
        const priority = getPriorityLevel(score);
        scoredChapters.push({
          id: uid(),
          title: ch.title,
          startPage: ch.startPage,
          endPage: ch.endPage,
          pageCount: ch.endPage - ch.startPage + 1,
          score,
          priority,
          topKeywords: matches.sort((a, b) => b.count - a.count).slice(0, 5).map(m => m.keyword),
          done: false,
        });
      }

      const bookId = uid();
      const book = {
        id: bookId,
        title: file.name.replace('.pdf', ''),
        fileName: file.name,
        totalPages: pdfDoc.numPages,
        chapterCount: scoredChapters.length,
        hasBookmarks,
        chapters: scoredChapters,
        addedAt: new Date().toISOString(),
      };

      // Cache the PDF data
      setPdfCache(prev => ({
        ...prev,
        [bookId]: { arrayBuffer, pdfDoc }
      }));

      setData(prev => ({ ...prev, books: [...prev.books, book] }));
      setActiveBookId(bookId);
      setView(VIEW.CHAPTERS);
    } catch (err) {
      console.error('Erro ao processar PDF:', err);
      alert('Erro ao processar o PDF. Verifique se o arquivo é válido.');
    } finally {
      setProcessing(false);
    }
  }, []);

  // ── Ensure PDF is loaded for a book ──
  const ensurePdfLoaded = useCallback(async (bookId) => {
    if (pdfCache[bookId]) return pdfCache[bookId];
    // PDF not in cache — user needs to re-upload
    alert('PDF não está mais no cache. Por favor, faça upload novamente.');
    return null;
  }, [pdfCache]);

  // ── Toggle chapter done ──
  const toggleChapter = (bookId, chapterId) => {
    setData(prev => ({
      ...prev,
      books: prev.books.map(b =>
        b.id === bookId
          ? {
            ...b,
            chapters: b.chapters.map(c =>
              c.id === chapterId ? { ...c, done: !c.done } : c
            )
          }
          : b
      ),
    }));
  };

  // ── Delete book ──
  const deleteBook = (bookId) => {
    if (!confirm('Remover este livro do acervo?')) return;
    setData(prev => ({ ...prev, books: prev.books.filter(b => b.id !== bookId) }));
    setPdfCache(prev => { const n = { ...prev }; delete n[bookId]; return n; });
    if (activeBookId === bookId) {
      setActiveBookId(null);
      setView(VIEW.HOME);
    }
  };

  // ── Open reader ──
  const openReader = async (bookId, chapter) => {
    const cached = await ensurePdfLoaded(bookId);
    if (!cached) return;
    setReaderState({
      bookId,
      chapter,
      pdfDoc: cached.pdfDoc,
      arrayBuffer: cached.arrayBuffer,
      currentPage: chapter.startPage,
    });
    setView(VIEW.READER);
  };

  // ── Download chapter ──
  const downloadChapter = async (bookId, chapter) => {
    const cached = await ensurePdfLoaded(bookId);
    if (!cached) return;
    try {
      const blob = await extractChapterPdf(cached.arrayBuffer, chapter.startPage, chapter.endPage);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const book = data.books.find(b => b.id === bookId);
      const safeName = chapter.title.replace(/[^a-zA-Z0-9À-ú\s-]/g, '').trim().replace(/\s+/g, '-');
      a.download = `${book?.title || 'chapter'}_${safeName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao exportar capítulo:', err);
    }
  };

  // ── Cycle priority ──
  const cyclePriority = (bookId, chapterId) => {
    const order = ['high', 'medium', 'low', 'skip'];
    setData(prev => ({
      ...prev,
      books: prev.books.map(b =>
        b.id === bookId
          ? {
            ...b,
            chapters: b.chapters.map(c => {
              if (c.id !== chapterId) return c;
              const idx = order.indexOf(c.priority);
              return { ...c, priority: order[(idx + 1) % order.length] };
            })
          }
          : b
      ),
    }));
  };

  // ── Render ──
  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-brand">
          <Books size={22} weight="duotone" />
          Acervo<span className="dot">.sh</span>
        </div>
        <div className="topbar-stats">
          <div className="topbar-stat">
            <BookOpen size={14} />
            <strong>{doneChapters}</strong>/{totalChapters} caps
          </div>
          <div className="topbar-stat">
            <Target size={14} />
            <strong>{priorityChapters}</strong> prioritários
          </div>
        </div>
      </div>

      <div className="main-content">
        {view === VIEW.HOME && (
          <HomeView
            books={data.books}
            onUpload={handleUpload}
            onOpenBook={(id) => { setActiveBookId(id); setView(VIEW.CHAPTERS); }}
            onDeleteBook={deleteBook}
            processing={processing}
          />
        )}

        {view === VIEW.CHAPTERS && activeBook && (
          <ChapterView
            book={activeBook}
            onBack={() => { setView(VIEW.HOME); setActiveBookId(null); }}
            onToggle={(cid) => toggleChapter(activeBook.id, cid)}
            onRead={(ch) => openReader(activeBook.id, ch)}
            onDownload={(ch) => downloadChapter(activeBook.id, ch)}
            onCyclePriority={(cid) => cyclePriority(activeBook.id, cid)}
            hasPdf={!!pdfCache[activeBook.id]}
          />
        )}

        {view === VIEW.READER && readerState && (
          <ReaderView
            state={readerState}
            onClose={() => setView(VIEW.CHAPTERS)}
            onPageChange={(p) => setReaderState(s => ({ ...s, currentPage: p }))}
          />
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════
//  HOME VIEW
// ═══════════════════════════════════════════
function HomeView({ books, onUpload, onOpenBook, onDeleteBook, processing }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <>
      <div
        className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files[0]) onUpload(e.target.files[0]); }}
        />
        <div className="upload-zone-icon">
          {processing
            ? <Lightning size={40} weight="duotone" />
            : <Upload size={40} weight="duotone" />
          }
        </div>
        <h3>{processing ? 'Processando PDF...' : 'Adicionar livro'}</h3>
        <p>{processing
          ? 'Detectando capítulos e analisando relevância...'
          : 'Arraste um PDF ou clique para selecionar'
        }</p>
      </div>

      {/* Keywords panel */}
      <div className="keywords-panel" style={{ marginTop: 20 }}>
        <h4>Palavras-chave da pesquisa</h4>
        <div className="keywords-list">
          {['microfrontend', 'dívida técnica', 'arquitetura de software',
            'acoplamento', 'coesão', 'manutenibilidade', 'refatoração',
            'componentização', 'modularização', 'code smell',
            'decomposição', 'erosão arquitetural', 'código legado',
          ].map(kw => (
            <span key={kw} className="keyword-chip">{kw}</span>
          ))}
        </div>
      </div>

      {books.length > 0 && (
        <>
          <div className="section-header">
            <span className="section-title">Meu acervo ({books.length})</span>
          </div>
          <div className="books-grid">
            {books.map(book => {
              const done = book.chapters?.filter(c => c.done).length || 0;
              const total = book.chapters?.length || 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div className="book-card" key={book.id} onClick={() => onOpenBook(book.id)}>
                  <div className="book-card-icon">
                    <FilePdf size={24} weight="duotone" />
                  </div>
                  <div className="book-card-info">
                    <div className="book-card-title">{book.title}</div>
                    <div className="book-card-meta">
                      {book.totalPages} pgs · {total} capítulos
                      {book.chapters?.filter(c => c.priority === 'high').length > 0 &&
                        ` · ${book.chapters.filter(c => c.priority === 'high').length} prioritários`
                      }
                    </div>
                  </div>
                  <div className="book-card-progress">
                    <div className="progress-bar-wrap">
                      <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="progress-label">{pct}%</span>
                  </div>
                  <button
                    className="icon-btn"
                    title="Remover"
                    onClick={(e) => { e.stopPropagation(); onDeleteBook(book.id); }}
                  >
                    <Trash size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {books.length === 0 && (
        <div className="empty-state">
          <h3>Nenhum livro ainda</h3>
          <p>Faça upload de um PDF para começar a organizar sua leitura</p>
        </div>
      )}
    </>
  );
}


// ═══════════════════════════════════════════
//  CHAPTER VIEW
// ═══════════════════════════════════════════
function ChapterView({ book, onBack, onToggle, onRead, onDownload, onCyclePriority, hasPdf }) {
  const done = book.chapters.filter(c => c.done).length;
  const total = book.chapters.length;
  const priorityOrder = { high: 0, medium: 1, low: 2, skip: 3 };
  const sorted = [...book.chapters].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return (
    <>
      <div className="chapter-view-header">
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar
        </button>
        <div>
          <div className="chapter-view-title">{book.title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {done}/{total} capítulos concluídos · {book.totalPages} páginas
            {!book.hasBookmarks && ' · Capítulos divididos automaticamente'}
          </div>
        </div>
      </div>

      <div className="chapter-list">
        {sorted.map(ch => (
          <div className={`chapter-item ${ch.done ? 'done' : ''}`} key={ch.id}>
            <div
              className={`chapter-check ${ch.done ? 'checked' : ''}`}
              onClick={() => onToggle(ch.id)}
            >
              {ch.done && <Check size={14} weight="bold" />}
            </div>

            <div className="chapter-info" onClick={() => hasPdf && onRead(ch)}>
              <div className="chapter-title">{ch.title}</div>
              <div className="chapter-pages">
                p. {ch.startPage}–{ch.endPage} · {ch.pageCount} pgs
                {ch.topKeywords?.length > 0 && (
                  <> · <span style={{ color: 'var(--accent)' }}>{ch.topKeywords.slice(0, 3).join(', ')}</span></>
                )}
              </div>
            </div>

            <span
              className={`priority-tag ${ch.priority}`}
              onClick={() => onCyclePriority(ch.id)}
              title="Clique para mudar prioridade"
              style={{ cursor: 'pointer' }}
            >
              {getPriorityLabel(ch.priority)}
            </span>

            <div className="chapter-actions">
              {hasPdf && (
                <button className="icon-btn" title="Ler" onClick={() => onRead(ch)}>
                  <Eye size={16} />
                </button>
              )}
              {hasPdf && (
                <button className="icon-btn" title="Baixar capítulo" onClick={() => onDownload(ch)}>
                  <DownloadSimple size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}


// ═══════════════════════════════════════════
//  READER VIEW (with annotations)
// ═══════════════════════════════════════════
const TOOLS = { NONE: 'none', PEN: 'pen', HIGHLIGHT: 'highlight', NOTE: 'note', ERASER: 'eraser' };
const COLORS = ['#c43644', '#f0ad4e', '#2ecc71', '#5b9bd5', '#e2e2ea'];

function ReaderView({ state, onClose, onPageChange }) {
  const pdfCanvasRef = useRef(null);
  const annoCanvasRef = useRef(null);
  const wrapRef = useRef(null);
  const { pdfDoc, chapter, currentPage, bookId } = state;
  const [rendering, setRendering] = useState(false);
  const [tool, setTool] = useState(TOOLS.NONE);
  const [color, setColor] = useState(COLORS[0]);
  const [showColors, setShowColors] = useState(false);
  const [pageAnno, setPageAnno] = useState({ strokes: [], notes: [], highlights: [] });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [noteInput, setNoteInput] = useState(null); // { x, y }
  const [noteText, setNoteText] = useState('');
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [saved, setSaved] = useState(false);

  // Load page annotations
  useEffect(() => {
    const anno = getPageAnnotations(bookId, currentPage);
    setPageAnno(anno);
  }, [bookId, currentPage]);

  // Render PDF page
  useEffect(() => {
    if (!pdfDoc || !pdfCanvasRef.current) return;
    let cancelled = false;

    setRendering(true);
    renderPage(pdfDoc, currentPage, pdfCanvasRef.current, 1.8)
      .then(({ width, height }) => {
        if (cancelled) return;
        setCanvasSize({ w: width, h: height });
        setRendering(false);
      })
      .catch(() => { if (!cancelled) setRendering(false); });

    return () => { cancelled = true; };
  }, [pdfDoc, currentPage]);

  // Resize annotation canvas to match PDF canvas
  useEffect(() => {
    if (!annoCanvasRef.current || !canvasSize.w) return;
    annoCanvasRef.current.width = canvasSize.w;
    annoCanvasRef.current.height = canvasSize.h;
    redrawAnnotations();
  }, [canvasSize, pageAnno]);

  const redrawAnnotations = useCallback(() => {
    const canvas = annoCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw highlights
    for (const hl of pageAnno.highlights) {
      ctx.fillStyle = hl.color + '44';
      ctx.fillRect(hl.x, hl.y, hl.w, hl.h);
    }

    // Draw strokes
    for (const stroke of pageAnno.strokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.type === 'highlight' ? 16 : 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = stroke.type === 'highlight' ? 0.35 : 1;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw note markers
    for (const note of pageAnno.notes) {
      ctx.fillStyle = note.color || COLORS[0];
      ctx.beginPath();
      ctx.arc(note.x, note.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', note.x, note.y);
    }
  }, [pageAnno]);

  // Get position relative to canvas
  const getPos = (e) => {
    const canvas = annoCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e) => {
    if (tool === TOOLS.NONE) return;
    if (tool === TOOLS.NOTE) {
      const pos = getPos(e);
      setNoteInput(pos);
      setNoteText('');
      return;
    }
    if (tool === TOOLS.ERASER) {
      const pos = getPos(e);
      // Remove strokes near click
      setPageAnno(prev => ({
        ...prev,
        strokes: prev.strokes.filter(s =>
          !s.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < 20)
        ),
        notes: prev.notes.filter(n => Math.hypot(n.x - pos.x, n.y - pos.y) > 15),
      }));
      return;
    }

    setIsDrawing(true);
    const pos = getPos(e);
    setCurrentStroke({
      type: tool === TOOLS.HIGHLIGHT ? 'highlight' : 'pen',
      color,
      points: [pos],
    });
  };

  const handlePointerMove = (e) => {
    if (!isDrawing || !currentStroke) return;
    e.preventDefault();
    const pos = getPos(e);
    setCurrentStroke(prev => ({
      ...prev,
      points: [...prev.points, pos],
    }));

    // Live preview
    const canvas = annoCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pts = [...currentStroke.points, pos];
    if (pts.length < 2) return;
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.type === 'highlight' ? 16 : 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = currentStroke.type === 'highlight' ? 0.35 : 1;
    ctx.beginPath();
    const p1 = pts[pts.length - 2];
    const p2 = pts[pts.length - 1];
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const handlePointerUp = () => {
    if (!isDrawing || !currentStroke) return;
    setIsDrawing(false);
    if (currentStroke.points.length > 1) {
      setPageAnno(prev => ({
        ...prev,
        strokes: [...prev.strokes, currentStroke],
      }));
    }
    setCurrentStroke(null);
  };

  const addNote = () => {
    if (!noteInput || !noteText.trim()) { setNoteInput(null); return; }
    setPageAnno(prev => ({
      ...prev,
      notes: [...prev.notes, { x: noteInput.x, y: noteInput.y, text: noteText.trim(), color }],
    }));
    setNoteInput(null);
    setNoteText('');
  };

  const handleSave = () => {
    savePageAnnotations(bookId, currentPage, pageAnno);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  // Auto-save when changing pages
  const changePage = (newPage) => {
    savePageAnnotations(bookId, currentPage, pageAnno);
    onPageChange(newPage);
  };

  const isFirst = currentPage <= chapter.startPage;
  const isLast = currentPage >= chapter.endPage;
  const activeTool = (t) => tool === t ? 'icon-btn tool-active' : 'icon-btn';

  return (
    <div className="reader-shell">
      <div className="reader-topbar">
        <button className="back-btn" onClick={() => { handleSave(); onClose(); }}>
          <X size={16} /> <span>Fechar</span>
        </button>
        <div className="reader-title">{chapter.title}</div>

        {/* Annotation toolbar */}
        <div className="anno-toolbar">
          <button className={activeTool(TOOLS.PEN)} title="Caneta" onClick={() => setTool(tool === TOOLS.PEN ? TOOLS.NONE : TOOLS.PEN)}>
            <PencilSimple size={16} />
          </button>
          <button className={activeTool(TOOLS.HIGHLIGHT)} title="Marcador" onClick={() => setTool(tool === TOOLS.HIGHLIGHT ? TOOLS.NONE : TOOLS.HIGHLIGHT)}>
            <Highlighter size={16} />
          </button>
          <button className={activeTool(TOOLS.NOTE)} title="Nota" onClick={() => setTool(tool === TOOLS.NOTE ? TOOLS.NONE : TOOLS.NOTE)}>
            <Note size={16} />
          </button>
          <button className={activeTool(TOOLS.ERASER)} title="Apagar" onClick={() => setTool(tool === TOOLS.ERASER ? TOOLS.NONE : TOOLS.ERASER)}>
            <Eraser size={16} />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="icon-btn" title="Cor" onClick={() => setShowColors(!showColors)}
              style={{ background: color + '33', borderColor: color }}>
              <Palette size={16} style={{ color }} />
            </button>
            {showColors && (
              <div className="color-picker">
                {COLORS.map(c => (
                  <div key={c} className={`color-dot ${c === color ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setColor(c); setShowColors(false); }}
                  />
                ))}
              </div>
            )}
          </div>
          <button className="icon-btn" title="Salvar anotações" onClick={handleSave}
            style={saved ? { borderColor: 'var(--green)', color: 'var(--green)' } : {}}>
            {saved ? <Check size={16} /> : <FloppyDisk size={16} />}
          </button>
        </div>

        <div className="reader-page-nav">
          <button disabled={isFirst} onClick={() => changePage(currentPage - 1)}>
            <CaretLeft size={16} />
          </button>
          <span>{currentPage} / {chapter.endPage}</span>
          <button disabled={isLast} onClick={() => changePage(currentPage + 1)}>
            <CaretRight size={16} />
          </button>
        </div>
      </div>

      <div className="reader-canvas-wrap" ref={wrapRef}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <canvas ref={pdfCanvasRef} style={{ opacity: rendering ? 0.5 : 1, display: 'block' }} />
          <canvas
            ref={annoCanvasRef}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              cursor: tool === TOOLS.PEN ? 'crosshair'
                : tool === TOOLS.HIGHLIGHT ? 'text'
                : tool === TOOLS.NOTE ? 'cell'
                : tool === TOOLS.ERASER ? 'not-allowed'
                : 'default',
              touchAction: 'none',
            }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
        </div>

        {/* Note input popup */}
        {noteInput && (
          <div className="note-popup"
            style={{
              position: 'absolute',
              left: Math.min(noteInput.x / (canvasSize.w || 1) * 100, 70) + '%',
              top: noteInput.y / (canvasSize.h || 1) * 100 + '%',
            }}>
            <textarea
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Escreva sua nota..."
              rows={3}
            />
            <div className="note-popup-actions">
              <button onClick={addNote} className="note-save-btn">Salvar</button>
              <button onClick={() => setNoteInput(null)} className="note-cancel-btn">Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* Notes sidebar */}
      {pageAnno.notes.length > 0 && (
        <div className="notes-sidebar">
          {pageAnno.notes.map((note, i) => (
            <div key={i} className="note-card" style={{ borderLeftColor: note.color }}>
              <p>{note.text}</p>
              <button className="note-remove" onClick={() => {
                setPageAnno(prev => ({
                  ...prev,
                  notes: prev.notes.filter((_, idx) => idx !== i),
                }));
              }}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

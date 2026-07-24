import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// ── Load a PDF from ArrayBuffer ──
export async function loadPdf(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf;
}

// ── Extract outline/bookmarks (chapters) ──
export async function extractOutline(pdf) {
  const outline = await pdf.getOutline();
  if (!outline || outline.length === 0) return null;

  const chapters = [];
  for (let i = 0; i < outline.length; i++) {
    const item = outline[i];
    let pageNum = null;

    try {
      if (item.dest) {
        let dest = item.dest;
        if (typeof dest === 'string') {
          dest = await pdf.getDestination(dest);
        }
        if (dest && dest[0]) {
          const pageIndex = await pdf.getPageIndex(dest[0]);
          pageNum = pageIndex + 1;
        }
      }
    } catch (e) {
      // skip items we can't resolve
    }

    if (pageNum !== null) {
      chapters.push({
        title: item.title || `Capítulo ${i + 1}`,
        startPage: pageNum,
      });
    }
  }

  // Calculate endPage for each chapter
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endPage = i < chapters.length - 1
      ? chapters[i + 1].startPage - 1
      : pdf.numPages;
  }

  return chapters;
}

// ── Extract text from a page range ──
export async function extractTextFromPages(pdf, startPage, endPage) {
  const texts = [];
  const end = Math.min(endPage, pdf.numPages);

  for (let i = startPage; i <= end; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      texts.push(pageText);
    } catch {
      // skip unreadable pages
    }
  }

  return texts.join('\n');
}

// ── Render a page to canvas ──
export async function renderPage(pdf, pageNum, canvas, scale = 1.5) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: viewport.width, height: viewport.height };
}

// ── Split PDF: extract page range as downloadable blob ──
export async function extractChapterPdf(arrayBuffer, startPage, endPage) {
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const newDoc = await PDFDocument.create();

  // pdf-lib uses 0-based indices
  const indices = [];
  for (let i = startPage - 1; i < endPage && i < srcDoc.getPageCount(); i++) {
    indices.push(i);
  }

  const pages = await newDoc.copyPages(srcDoc, indices);
  pages.forEach(page => newDoc.addPage(page));

  const pdfBytes = await newDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

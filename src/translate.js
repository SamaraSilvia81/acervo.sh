// ── Tradução automática EN → PT-BR (API gratuita MyMemory, sem chave) ──
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const MAX_CHUNK = 480; // MyMemory limita ~500 caracteres por requisição no plano anônimo

// Divide o texto em blocos respeitando o fim de frases quando possível
function chunkText(text, maxLen = MAX_CHUNK) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen) {
      if (current) chunks.push(current.trim());
      if (sentence.length > maxLen) {
        // frase sozinha já estoura o limite — corta na força bruta
        for (let i = 0; i < sentence.length; i += maxLen) {
          chunks.push(sentence.slice(i, i + maxLen).trim());
        }
        current = '';
      } else {
        current = sentence;
      }
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function translateChunk(chunk, langpair) {
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(chunk)}&langpair=${langpair}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Falha na requisição de tradução');
  const data = await res.json();
  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error('Resposta vazia da API de tradução');
  return translated;
}

/**
 * Traduz um texto (geralmente em inglês) para português do Brasil.
 * @param {string} text - texto de origem
 * @param {(done: number, total: number) => void} [onProgress] - callback opcional de progresso
 * @returns {Promise<string>} texto traduzido
 */
export async function translateToPortuguese(text, onProgress) {
  const chunks = chunkText(text);
  if (chunks.length === 0) return '';

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const translated = await translateChunk(chunks[i], 'en|pt-BR');
      results.push(translated);
    } catch (err) {
      // Se um trecho falhar, mantém o original marcado, sem travar o resto
      results.push(`[não traduzido] ${chunks[i]}`);
    }
    if (onProgress) onProgress(i + 1, chunks.length);
    // pequena pausa entre chamadas pra não sobrecarregar a API gratuita
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 250));
  }
  return results.join(' ');
}

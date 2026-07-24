// ── Research Keywords (Sams's master's research) ──
// Bilingual: PT-BR priority, EN for international books
export const RESEARCH_KEYWORDS = [
  // Core — PT-BR
  'microfrontend', 'micro-frontend', 'micro frontend', 'microfrontends',
  'dívida técnica', 'divida tecnica', 'débito técnico',
  'arquitetura de software', 'arquitetura frontend',
  // Core — EN
  'technical debt', 'tech debt', 'software architecture',
  // Arquitetura — PT-BR
  'monolito', 'monolítico', 'modular', 'modularização', 'modularidade',
  'decomposição', 'microsserviço', 'microsserviços',
  'federação de módulos', 'componentes web',
  'camada de apresentação', 'camada de interface',
  'escalabilidade', 'extensibilidade', 'reusabilidade',
  'separação de responsabilidades', 'responsabilidade única',
  'baixo acoplamento', 'alta coesão',
  // Arquitetura — EN
  'monolith', 'modularization', 'decomposition',
  'microservice', 'module federation', 'single-spa', 'web components',
  'scalability', 'extensibility', 'reusability',
  // Qualidade — PT-BR
  'qualidade de código', 'qualidade de software', 'mau cheiro',
  'acoplamento', 'coesão', 'manutenibilidade', 'manutenção',
  'complexidade', 'refatoração', 'refatorar',
  'padrão de projeto', 'padrões de projeto', 'antipadrão', 'anti-padrão',
  'código legado', 'legado', 'evolução de software',
  'sustentabilidade', 'degradação', 'erosão arquitetural',
  'decisão arquitetural', 'trade-off', 'compromisso técnico',
  // Qualidade — EN
  'code smell', 'code quality', 'coupling', 'cohesion',
  'maintainability', 'complexity', 'refactoring',
  'design pattern', 'anti-pattern', 'legacy code',
  'architectural erosion', 'architectural decision',
  // Frontend — PT-BR
  'interface do usuário', 'experiência do usuário',
  'componente', 'componentes', 'componentização',
  'empacotador', 'dependência', 'dependências',
  'integração', 'implantação', 'entrega contínua',
  'roteamento', 'estado compartilhado', 'estado global',
  'renderização', 'carregamento dinâmico', 'lazy loading',
  // Frontend — EN
  'frontend', 'front-end', 'front end',
  'component', 'webpack', 'vite', 'bundler',
  'dependency', 'versioning', 'integration', 'deployment',
  'ci/cd', 'pipeline', 'build system', 'routing',
  'shared state', 'lazy loading',
  // Pesquisa — PT-BR
  'revisão sistemática', 'mapeamento sistemático',
  'estudo de caso', 'empírico', 'diagnóstico', 'métrica', 'métricas',
  'análise qualitativa', 'análise quantitativa',
  'revisão da literatura', 'trabalhos relacionados',
  // Pesquisa — EN
  'systematic review', 'mapping study', 'case study',
  'empirical', 'diagnostic', 'metric',
];

// ── Priority scoring ──
export function scorePriority(text) {
  if (!text) return { score: 0, matches: [] };
  const lower = text.toLowerCase();
  const matches = [];

  for (const kw of RESEARCH_KEYWORDS) {
    const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const found = lower.match(regex);
    if (found) {
      matches.push({ keyword: kw, count: found.length });
    }
  }

  const score = matches.reduce((sum, m) => sum + m.count, 0);
  return { score, matches };
}

export function getPriorityLevel(score) {
  if (score >= 8) return 'high';
  if (score >= 3) return 'medium';
  if (score >= 1) return 'low';
  return 'skip';
}

export function getPriorityLabel(level) {
  const labels = { high: 'Prioritário', medium: 'Relevante', low: 'Opcional', skip: 'Pular' };
  return labels[level] || level;
}

// ── localStorage helpers ──
const STORAGE_KEY = 'acervo-sh-data';

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { books: [] };
  } catch {
    return { books: [] };
  }
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── ID generator ──
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Annotation storage (separate key to avoid bloating main data) ──
const ANNO_KEY = 'acervo-sh-annotations';

export function loadAnnotations() {
  try {
    const raw = localStorage.getItem(ANNO_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAnnotations(annotations) {
  localStorage.setItem(ANNO_KEY, JSON.stringify(annotations));
}

// Key: bookId-pageNum → { strokes, notes, highlights }
export function getPageAnnotations(bookId, pageNum) {
  const all = loadAnnotations();
  return all[`${bookId}-${pageNum}`] || { strokes: [], notes: [], highlights: [] };
}

export function savePageAnnotations(bookId, pageNum, pageData) {
  const all = loadAnnotations();
  all[`${bookId}-${pageNum}`] = pageData;
  saveAnnotations(all);
}

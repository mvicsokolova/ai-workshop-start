// The Skill Atlas page: search, filter and read the skills of one repository.
// The state lives in the URL hash, so every view can be shared, bookmarked and navigated with Back.

const $ = (id) => document.getElementById(id);
const els = {
  repo: $('repo'), repoName: $('repo-name'), repoCommit: $('repo-commit'),
  subtitle: $('subtitle'), suggestions: $('suggestions'),
  query: $('query'), clearQuery: $('clear-query'),
  topics: $('topic-filters'), owners: $('owner-filters'), ownerSearch: $('owner-search'), contents: $('content-filters'),
  reset: $('reset'), emptyReset: $('empty-reset'), count: $('count'), active: $('active'), sort: $('sort'),
  grid: $('grid'), empty: $('empty'), warnings: $('warnings'),
  viewGrid: $('view-grid'), viewList: $('view-list'), filters: $('filters'), filtersToggle: $('filters-toggle'),
  scrim: $('scrim'), detail: $('detail'), detailScroll: $('detail-scroll'), position: $('position'),
  prev: $('prev'), next: $('next'), close: $('close'),
  detailName: $('detail-name'), detailDescription: $('detail-description'), detailTags: $('detail-tags'),
  detailActions: $('detail-actions'), toc: $('toc'), markdown: $('markdown'), detailFiles: $('detail-files'),
  rescan: $('rescan'), theme: $('theme'), help: $('help'), shortcuts: $('shortcuts'), toast: $('toast'),
};

/** What makes a skill match a content filter. */
const CONTENTS = [
  { id: 'files', label: 'Has supporting files', test: (s) => s.extraFiles.length > 0 },
  { id: 'scripts', label: 'Ships scripts', test: (s) => s.extraFiles.some((f) => isScript(f.path)) },
  { id: 'references', label: 'Has reference docs', test: (s) => s.extraFiles.some((f) => /\.mdx?$/i.test(f.path)) },
  { id: 'copies', label: 'Shared with other agents', test: (s) => s.copies.length > 0 },
  { id: 'owned', label: 'Has an owning team', test: (s) => s.owners.length > 0 },
];

/** A static export names its catalog file; the server answers it at api/catalog and can scan again. */
const CATALOG = document.querySelector('meta[name="skill-atlas-catalog"]')?.content ?? 'api/catalog';
const STATIC = CATALOG !== 'api/catalog';

let catalog;
let skills = [];
let visible = [];
let selected = 0;
let state = { q: '', topic: [], owner: [], has: [], sort: 'relevance', view: 'grid', skill: '' };
let lastRenderedSkill = '';

// ---------- Loading ----------

async function load() {
  try {
    const response = await fetch(CATALOG);
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    useCatalog(await response.json());
  } catch (error) {
    els.subtitle.textContent = `Could not load the catalog: ${error.message}`;
    els.subtitle.classList.add('error-text');
  }
}

function useCatalog(next) {
  catalog = next;
  skills = catalog.skills.map((skill) => {
    const extraFiles = skill.files.filter((f) => f.path !== 'OWNERSHIP');
    return {
      ...skill,
      extraFiles,
      nameLower: skill.name.toLowerCase(),
      nameWords: skill.name.toLowerCase().split(/[-_\s.]+/),
      descriptionLower: skill.description.toLowerCase(),
      textLower: skill.text.toLowerCase(),
      tagsLower: [...skill.owners, ...skill.topics].join(' ').toLowerCase(),
      minutes: Math.max(1, Math.round(skill.words / 220)),
    };
  });
  renderHeader();
  readHash();
  render();
}

// ---------- URL state ----------

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const list = (key) => (params.get(key) ?? '').split(',').filter(Boolean);
  state = {
    q: params.get('q') ?? '',
    topic: list('topic'),
    owner: list('owner'),
    has: list('has'),
    sort: params.get('sort') ?? 'relevance',
    view: params.get('view') === 'list' ? 'list' : 'grid',
    skill: params.get('skill') ?? '',
  };
  if (document.activeElement !== els.query) els.query.value = state.q;
}

function writeHash({ push = false } = {}) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  for (const key of ['topic', 'owner', 'has']) if (state[key].length) params.set(key, state[key].join(','));
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.view !== 'grid') params.set('view', state.view);
  if (state.skill) params.set('skill', state.skill);
  const hash = `#/${params.toString() ? `?${params}` : ''}`;
  if (hash === location.hash) return;
  if (push) history.pushState(null, '', hash);
  else history.replaceState(null, '', hash);
}

function update(changes, options) {
  state = { ...state, ...changes };
  writeHash(options);
  render();
}

window.addEventListener('hashchange', () => {
  readHash();
  render();
});
window.addEventListener('popstate', () => {
  readHash();
  render();
});

// ---------- Search ----------

const terms = (q) => q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);

function count(haystack, needle) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0 && n < 50; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Letters of the term in order, for typos and abbreviations such as "kts" or "ui dsl". */
function subsequence(haystack, needle) {
  let i = 0;
  for (const c of haystack) if (c === needle[i]) i++;
  return i === needle.length;
}

/** 0 when a term is missing; otherwise higher for a better match, the name counting most. */
function score(skill, queryTerms) {
  if (!queryTerms.length) return 1;
  let total = 0;
  for (const t of queryTerms) {
    let s = 0;
    if (skill.nameLower === t) s += 120;
    else if (skill.nameWords.includes(t)) s += 70;
    else if (skill.nameLower.startsWith(t)) s += 60;
    else if (skill.nameLower.includes(t)) s += 40;
    if (skill.descriptionLower.includes(t)) s += 22;
    if (skill.tagsLower.includes(t)) s += 14;
    const hits = count(skill.textLower, t);
    if (hits) s += 4 + Math.min(hits, 12);
    if (!s && t.length >= 3 && subsequence(skill.nameLower, t)) s += 6;
    if (!s) return 0;
    total += s;
  }
  return total;
}

function matchesFilters(skill, except) {
  if (except !== 'topic' && state.topic.length && !state.topic.some((t) => skill.topics.includes(t))) return false;
  if (except !== 'owner' && state.owner.length && !state.owner.some((o) => skill.owners.includes(o))) return false;
  if (except !== 'has' && state.has.length) {
    for (const id of state.has) {
      const content = CONTENTS.find((c) => c.id === id);
      if (content && !content.test(skill)) return false;
    }
  }
  return true;
}

function compute() {
  const queryTerms = terms(state.q);
  const scored = skills.map((skill) => ({ skill, score: score(skill, queryTerms) })).filter((r) => r.score > 0);
  const results = scored.filter((r) => matchesFilters(r.skill));
  const by = {
    relevance: (a, b) => b.score - a.score || cmp(a.skill.name, b.skill.name),
    name: (a, b) => cmp(a.skill.name, b.skill.name),
    long: (a, b) => b.skill.words - a.skill.words,
    short: (a, b) => a.skill.words - b.skill.words,
    files: (a, b) => b.skill.extraFiles.length - a.skill.extraFiles.length || cmp(a.skill.name, b.skill.name),
  }[state.sort] ?? ((a, b) => b.score - a.score);
  results.sort(by);
  // Each group's counts: what choosing it would add, given everything else that is chosen.
  const facetCounts = (group, values) => {
    const pool = scored.filter((r) => matchesFilters(r.skill, group)).map((r) => r.skill);
    return new Map(values.map((v) => [v, pool.filter((s) => (group === 'topic' ? s.topics : s.owners).includes(v)).length]));
  };
  const contentPool = scored.filter((r) => matchesFilters(r.skill, 'has')).map((r) => r.skill);
  return {
    queryTerms,
    results: results.map((r) => r.skill),
    topicCounts: facetCounts('topic', catalog.topics.map((t) => t.name)),
    ownerCounts: facetCounts('owner', catalog.owners.map((o) => o.name)),
    contentCounts: new Map(CONTENTS.map((c) => [c.id, contentPool.filter(c.test).length])),
  };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- Rendering ----------

function escape(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function termPattern(queryTerms) {
  if (!queryTerms.length) return undefined;
  const sorted = [...queryTerms].sort((a, b) => b.length - a.length);
  return new RegExp(`(${sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
}

/** Escaped text with the search terms marked. Backticks become code. */
function highlight(text, pattern) {
  const parts = pattern ? String(text).split(pattern) : [String(text)];
  const html = parts.map((part, i) => (i % 2 ? `<mark>${escape(part)}</mark>` : escape(part))).join('');
  return html.replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** A piece of the body around the first term the name and description do not show. */
function snippet(skill, queryTerms, pattern) {
  const hidden = queryTerms.filter((t) => !skill.nameLower.includes(t) && !skill.descriptionLower.includes(t));
  for (const t of hidden) {
    const at = skill.textLower.indexOf(t);
    if (at < 0) continue;
    const start = Math.max(0, skill.text.lastIndexOf(' ', Math.max(0, at - 70)) + 1);
    const end = Math.min(skill.text.length, at + t.length + 90);
    const piece = `${start > 0 ? '…' : ''}${skill.text.slice(start, end).trim()}${end < skill.text.length ? '…' : ''}`;
    return `<p class="card-snippet">${highlight(piece, pattern).replace(/<\/?code>/g, '')}</p>`;
  }
  return '';
}

function hue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hue-${h % 8}`;
}

const initials = (name) =>
  name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function renderHeader() {
  const { repository } = catalog;
  els.repo.hidden = false;
  els.repo.href = repository.url;
  els.repoName.textContent = repository.id;
  els.repoCommit.textContent = repository.commit ? repository.commit.slice(0, 7) : 'local';
  els.repo.title = repository.commit ? `Scanned at commit ${repository.commit}` : repository.url;
  document.title = `${repository.id} · Skill Atlas`;
  const files = skills.reduce((n, s) => n + s.extraFiles.length, 0);
  const words = skills.reduce((n, s) => n + s.words, 0);
  const scanned = new Date(catalog.scannedAt);
  const when = Number.isNaN(scanned.getTime())
    ? ''
    : ` <span class="scanned" title="${escape(scanned.toString())}">Scanned ${escape(
        scanned.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
      )}.</span>`;
  els.subtitle.innerHTML = `Search, filter and read the agent skills of <strong>${escape(repository.id)}</strong>.${when}`;
  const stats = [
    [skills.length, skills.length === 1 ? 'skill' : 'skills'],
    [catalog.owners.length, catalog.owners.length === 1 ? 'team' : 'teams'],
    [catalog.topics.length, 'topics'],
    [files, 'supporting files'],
    [`${Math.round(words / 1000)}k`, 'words of guidance'],
  ];
  els.suggestions.innerHTML = stats
    .filter(([value]) => value !== 0)
    .map(([value, label]) => `<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`)
    .join('');
  if (catalog.warnings.length) {
    els.warnings.hidden = false;
    els.warnings.innerHTML = `<details><summary>${catalog.warnings.length} scan ${
      catalog.warnings.length === 1 ? 'warning' : 'warnings'
    }</summary><ul>${catalog.warnings.map((w) => `<li><code>${escape(w)}</code></li>`).join('')}</ul></details>`;
  } else els.warnings.hidden = true;
}

function render() {
  if (!catalog) return;
  const { queryTerms, results, topicCounts, ownerCounts, contentCounts } = compute();
  const pattern = termPattern(queryTerms);
  visible = results;
  if (selected >= visible.length) selected = Math.max(0, visible.length - 1);

  els.clearQuery.hidden = !state.q;
  els.sort.value = state.sort;
  els.viewGrid.setAttribute('aria-pressed', String(state.view === 'grid'));
  els.viewList.setAttribute('aria-pressed', String(state.view === 'list'));
  els.grid.classList.toggle('list', state.view === 'list');

  els.topics.innerHTML = catalog.topics
    .map(({ name }) => {
      const on = state.topic.includes(name);
      const n = topicCounts.get(name);
      return `<button type="button" class="chip${on ? ' on' : ''}" data-topic="${escape(name)}" aria-pressed="${on}"${
        !n && !on ? ' disabled' : ''
      }>${escape(name)}<span class="chip-count">${n}</span></button>`;
    })
    .join('');

  const ownerQuery = els.ownerSearch.value.trim().toLowerCase();
  els.ownerSearch.hidden = catalog.owners.length < 8;
  els.owners.innerHTML = catalog.owners.length
    ? catalog.owners
        .filter(({ name }) => !ownerQuery || name.toLowerCase().includes(ownerQuery) || state.owner.includes(name))
        .map(({ name }) => {
          const on = state.owner.includes(name);
          const n = ownerCounts.get(name);
          return `<label class="check${!n && !on ? ' dim' : ''}"><input type="checkbox" data-owner="${escape(name)}"${
            on ? ' checked' : ''
          }><span class="avatar ${hue(name)}" aria-hidden="true">${escape(initials(name))}</span><span class="check-label">${escape(
            name,
          )}</span><span class="check-count">${n}</span></label>`;
        })
        .join('') || '<p class="muted small">No team by that name.</p>'
    : '<p class="muted small">No OWNERSHIP files in this repository.</p>';

  els.contents.innerHTML = CONTENTS.map(({ id, label }) => {
    const on = state.has.includes(id);
    const n = contentCounts.get(id);
    return `<label class="check${!n && !on ? ' dim' : ''}"><input type="checkbox" data-has="${id}"${
      on ? ' checked' : ''
    }><span class="check-label">${escape(label)}</span><span class="check-count">${n}</span></label>`;
  }).join('');

  const filtered = state.topic.length + state.owner.length + state.has.length;
  els.reset.hidden = !filtered && !state.q;
  const total = skills.length;
  els.count.innerHTML =
    results.length === total
      ? `<strong>${total}</strong> ${total === 1 ? 'skill' : 'skills'}`
      : `<strong>${results.length}</strong> of ${total} skills`;
  els.filtersToggle.textContent = filtered ? `Filters · ${filtered}` : 'Filters';

  const pill = (kind, value, label) =>
    `<button type="button" class="pill" data-remove-${kind}="${escape(value)}" title="Remove this filter">${label}<span aria-hidden="true">×</span></button>`;
  els.active.innerHTML = [
    ...state.topic.map((t) => pill('topic', t, escape(t))),
    ...state.owner.map((o) => pill('owner', o, escape(o))),
    ...state.has.map((h) => pill('has', h, escape(CONTENTS.find((c) => c.id === h)?.label ?? h))),
  ].join('');

  els.grid.innerHTML = results
    .map((skill, index) => {
      const tags = [
        ...skill.owners.map((o) => `<span class="tag owner ${hue(o)}">${highlight(o, pattern)}</span>`),
        ...skill.topics.map((t) => `<span class="tag">${highlight(t, pattern)}</span>`),
      ].join('');
      const meta = [
        `${skill.minutes} min read`,
        skill.extraFiles.length ? `${skill.extraFiles.length} ${skill.extraFiles.length === 1 ? 'file' : 'files'}` : '',
        skill.copies.length ? `${skill.copies.length + 1} agents` : '',
      ].filter(Boolean);
      return `<a class="card${index === selected ? ' selected' : ''}" href="${skillHref(skill.name)}" data-index="${index}" data-name="${escape(
        skill.name,
      )}">
        <div class="card-head"><h3>${highlight(skill.name, pattern)}</h3><span class="card-arrow" aria-hidden="true">→</span></div>
        <p class="card-description">${skill.description ? highlight(skill.description, pattern) : '<em class="muted">No description</em>'}</p>
        ${snippet(skill, queryTerms, pattern)}
        <div class="card-tags">${tags}</div>
        <div class="card-meta">${meta.map((m) => `<span>${escape(m)}</span>`).join('')}</div>
      </a>`;
    })
    .join('');
  els.empty.hidden = results.length > 0;

  renderDetail(pattern);
}

function skillHref(name) {
  const params = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  params.set('skill', name);
  return `#/?${params}`;
}

// ---------- Detail ----------

function renderDetail(pattern) {
  const skill = state.skill && skills.find((s) => s.name === state.skill);
  const open = Boolean(skill);
  if (!open) {
    if (!els.detail.hidden) {
      els.detail.classList.remove('open');
      els.scrim.classList.remove('open');
      setTimeout(() => {
        if (!state.skill) (els.detail.hidden = true), (els.scrim.hidden = true);
      }, 220);
      document.body.classList.remove('locked');
      const card = els.grid.querySelector(`[data-name="${CSS.escape(lastRenderedSkill)}"]`);
      card?.focus({ preventScroll: false });
    }
    lastRenderedSkill = '';
    return;
  }
  const index = visible.findIndex((s) => s.name === skill.name);
  if (index >= 0) selected = index;
  els.position.textContent = index >= 0 ? `${index + 1} / ${visible.length}` : 'not in the results';
  els.prev.disabled = index <= 0;
  els.next.disabled = index < 0 || index >= visible.length - 1;

  if (lastRenderedSkill === skill.name && els.markdown.dataset.query === state.q) return;
  const fresh = lastRenderedSkill !== skill.name;
  lastRenderedSkill = skill.name;

  els.detailName.innerHTML = highlight(skill.name, pattern);
  els.detailDescription.innerHTML = skill.description ? highlight(skill.description, pattern) : '<em class="muted">No description</em>';
  els.detailTags.innerHTML = [
    ...skill.owners.map(
      (o) => `<button type="button" class="tag owner ${hue(o)}" data-filter-owner="${escape(o)}" title="Show this team's skills">${escape(o)}</button>`,
    ),
    ...skill.topics.map((t) => `<button type="button" class="tag" data-filter-topic="${escape(t)}" title="Show skills on this topic">${escape(t)}</button>`),
    `<span class="tag plain">${skill.minutes} min read · ${skill.words.toLocaleString()} words</span>`,
  ].join('');
  els.detailActions.innerHTML = `
    <a class="button primary" href="${escape(skill.link)}" target="_blank" rel="noopener noreferrer">${
      catalog.repository.commit ? 'Open on GitHub' : 'Open the file'
    } <span aria-hidden="true">↗</span></a>
    <button class="button" type="button" data-copy="${escape(skill.link)}" data-copy-label="Link">Copy link</button>
    <button class="button" type="button" data-copy="${escape(skill.path)}" data-copy-label="Path">Copy path</button>
    <button class="button" type="button" data-copy="${escape(location.href.split('#')[0] + skillHref(skill.name))}" data-copy-label="Atlas link">Share</button>`;

  els.markdown.innerHTML = skill.html || '<p class="muted">This SKILL.md has no body.</p>';
  els.markdown.dataset.query = state.q;
  enhanceMarkdown(pattern);

  const headings = skill.headings.filter((h) => h.depth >= 2 && h.depth <= 3);
  els.toc.hidden = headings.length < 2;
  els.toc.innerHTML = headings.length >= 2
    ? `<p class="toc-title">On this page</p><ul>${headings
        .map((h) => `<li class="depth-${h.depth}"><a href="#${escape(h.id)}" data-heading="${escape(h.id)}">${escape(h.text)}</a></li>`)
        .join('')}</ul>`
    : '';

  els.detailFiles.innerHTML = filesSection(skill);

  if (els.detail.hidden) {
    els.detail.hidden = false;
    els.scrim.hidden = false;
    requestAnimationFrame(() => {
      els.detail.classList.add('open');
      els.scrim.classList.add('open');
    });
    document.body.classList.add('locked');
    els.close.focus({ preventScroll: true });
  }
  if (fresh) els.detailScroll.scrollTop = 0;
  const firstMark = !fresh || !pattern ? undefined : els.markdown.querySelector('mark');
  if (firstMark && !skill.nameLower.includes(terms(state.q)[0] ?? '')) firstMark.scrollIntoView({ block: 'center' });
  observeHeadings();
}

function filesSection(skill) {
  const related = (title, names) =>
    names.length
      ? `<div class="files-block"><h3>${title}</h3><ul class="related-list">${names
          .map((name) => {
            const other = skills.find((s) => s.name === name);
            return `<li><a href="${skillHref(name)}" data-skill="${escape(name)}"><strong>${escape(name)}</strong>${
              other?.description ? `<span>${highlight(other.description, undefined)}</span>` : ''
            }</a></li>`;
          })
          .join('')}</ul></div>`
      : '';
  const links = related('Links to', skill.links) + related('Linked from', skill.linkedFrom);
  const copies = skill.copies.length
    ? `<div class="files-block"><h3>Also installed for</h3><ul class="file-list">${skill.copies
        .map((c) => `<li><a href="${escape(c.link)}" target="_blank" rel="noopener noreferrer"><span class="file-icon">⧉</span>${escape(c.path)}</a></li>`)
        .join('')}</ul></div>`
    : '';
  const files = skill.files.length
    ? `<div class="files-block"><h3>Files in <code>${escape(skill.directory)}/</code></h3><ul class="file-list">${skill.files
        .map((f) => {
          const depth = f.path.split('/').length - 1;
          return `<li class="indent-${Math.min(depth, 4)}"><a href="${escape(f.link)}" target="_blank" rel="noopener noreferrer"><span class="file-icon">${fileIcon(
            f.path,
          )}</span>${escape(f.path)}</a></li>`;
        })
        .join('')}</ul></div>`
    : '';
  return links || copies || files
    ? `<h2 class="section-title">Around this skill</h2><div class="files-grid">${links}${copies}${files}</div>`
    : '';
}

const isScript = (path) => /\.(py|sh|mjs|cjs|js|ts|kts|kt|cmd|ps1|rb)$/i.test(path) || path.startsWith('scripts/');

function fileIcon(path) {
  if (isScript(path)) return '⚙';
  if (/\.mdx?$/i.test(path)) return '¶';
  if (/\.json$/i.test(path)) return '{}';
  if (path === 'OWNERSHIP') return '☺';
  return '·';
}

/** Copy buttons for code, and the search terms marked in the text. */
function enhanceMarkdown(pattern) {
  for (const pre of els.markdown.querySelectorAll('pre')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.textContent = 'Copy';
    button.dataset.copyCode = '';
    pre.append(button);
    const language = pre.querySelector('code')?.className.match(/language-(\S+)/)?.[1];
    if (language) pre.dataset.language = language;
  }
  if (!pattern) return;
  const walker = document.createTreeWalker(els.markdown, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = node.nodeValue.split(pattern);
    if (parts.length < 2) continue;
    const fragment = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (!part) return;
      if (i % 2) {
        const mark = document.createElement('mark');
        mark.textContent = part;
        fragment.append(mark);
      } else fragment.append(part);
    });
    node.replaceWith(fragment);
  }
}

let headingObserver;
function observeHeadings() {
  headingObserver?.disconnect();
  const links = new Map([...els.toc.querySelectorAll('a[data-heading]')].map((a) => [a.dataset.heading, a]));
  if (!links.size) return;
  headingObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const a of links.values()) a.classList.remove('current');
        links.get(entry.target.id)?.classList.add('current');
      }
    },
    { root: els.detailScroll, rootMargin: '0px 0px -70% 0px' },
  );
  for (const id of links.keys()) {
    const heading = document.getElementById(id);
    if (heading) headingObserver.observe(heading);
  }
}

function openSkill(name, { push = true } = {}) {
  update({ skill: name }, { push: push && !state.skill });
}

function closeSkill() {
  update({ skill: '' });
}

function step(delta) {
  if (!visible.length) return;
  if (state.skill) {
    const index = visible.findIndex((s) => s.name === state.skill);
    const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))];
    if (next) openSkill(next.name, { push: false });
    return;
  }
  selected = Math.min(visible.length - 1, Math.max(0, selected + delta));
  for (const card of els.grid.querySelectorAll('.card')) card.classList.toggle('selected', Number(card.dataset.index) === selected);
  els.grid.querySelector('.card.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- Small things ----------

let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => (els.toast.hidden = true), 200);
  }, 1800);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast(`${label} copied`);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('skill-atlas-theme', theme);
  } catch {}
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// ---------- Events ----------

let typing;
els.query.addEventListener('input', () => {
  clearTimeout(typing);
  els.clearQuery.hidden = !els.query.value;
  typing = setTimeout(() => {
    selected = 0;
    update({ q: els.query.value.trim() });
  }, 60);
});
els.query.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    step(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    step(-1);
  } else if (event.key === 'Enter' && visible[selected]) {
    event.preventDefault();
    openSkill(visible[selected].name);
  } else if (event.key === 'Escape') {
    if (els.query.value) {
      els.query.value = '';
      update({ q: '' });
    } else els.query.blur();
    event.stopPropagation();
  }
});
els.clearQuery.addEventListener('click', () => {
  els.query.value = '';
  update({ q: '' });
  els.query.focus();
});

els.topics.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-topic]');
  if (chip) update({ topic: toggle(state.topic, chip.dataset.topic) });
});
els.owners.addEventListener('change', (event) => {
  const box = event.target.closest('[data-owner]');
  if (box) update({ owner: toggle(state.owner, box.dataset.owner) });
});
els.ownerSearch.addEventListener('input', () => render());
els.contents.addEventListener('change', (event) => {
  const box = event.target.closest('[data-has]');
  if (box) update({ has: toggle(state.has, box.dataset.has) });
});
els.active.addEventListener('click', (event) => {
  const pill = event.target.closest('.pill');
  if (!pill) return;
  if (pill.dataset.removeTopic) update({ topic: state.topic.filter((v) => v !== pill.dataset.removeTopic) });
  if (pill.dataset.removeOwner) update({ owner: state.owner.filter((v) => v !== pill.dataset.removeOwner) });
  if (pill.dataset.removeHas) update({ has: state.has.filter((v) => v !== pill.dataset.removeHas) });
});
const resetAll = () => {
  els.query.value = '';
  els.ownerSearch.value = '';
  update({ q: '', topic: [], owner: [], has: [] });
};
els.reset.addEventListener('click', resetAll);
els.emptyReset.addEventListener('click', resetAll);
els.sort.addEventListener('change', () => update({ sort: els.sort.value }));
els.viewGrid.addEventListener('click', () => update({ view: 'grid' }));
els.viewList.addEventListener('click', () => update({ view: 'list' }));
function setFiltersOpen(open) {
  els.filters.classList.toggle('open', open);
  els.filtersToggle.setAttribute('aria-expanded', String(open));
}
els.filtersToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  setFiltersOpen(!els.filters.classList.contains('open'));
});
// On a small screen the filters are a drawer: a tap outside closes it, and does nothing else.
// The event path, not the target: choosing a filter re-renders the drawer under the tap.
document.addEventListener(
  'click',
  (event) => {
    if (!els.filters.classList.contains('open') || event.composedPath().includes(els.filters)) return;
    if (event.composedPath().includes(els.filtersToggle)) return;
    event.preventDefault();
    event.stopPropagation();
    setFiltersOpen(false);
  },
  true,
);

els.grid.addEventListener('click', (event) => {
  const card = event.target.closest('.card');
  if (!card || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  selected = Number(card.dataset.index);
  openSkill(card.dataset.name);
});

els.scrim.addEventListener('click', closeSkill);
els.close.addEventListener('click', closeSkill);
els.prev.addEventListener('click', () => step(-1));
els.next.addEventListener('click', () => step(1));

els.detail.addEventListener('click', (event) => {
  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) return copy(copyButton.dataset.copy, copyButton.dataset.copyLabel);
  const codeButton = event.target.closest('[data-copy-code]');
  if (codeButton) {
    const code = codeButton.parentElement.querySelector('code')?.innerText ?? '';
    copy(code, 'Code');
    codeButton.textContent = 'Copied';
    setTimeout(() => (codeButton.textContent = 'Copy'), 1400);
    return;
  }
  const owner = event.target.closest('[data-filter-owner]');
  if (owner) return update({ owner: [owner.dataset.filterOwner], topic: [], has: [], skill: '' }, { push: true });
  const topic = event.target.closest('[data-filter-topic]');
  if (topic) return update({ topic: [topic.dataset.filterTopic], owner: [], has: [], skill: '' }, { push: true });
  const skillLink = event.target.closest('a[data-skill]');
  if (skillLink && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    if (skills.some((s) => s.name === skillLink.dataset.skill)) update({ skill: skillLink.dataset.skill }, { push: true });
    return;
  }
  const anchor = event.target.closest('a[href^="#h-"]');
  if (anchor) {
    event.preventDefault();
    document.getElementById(anchor.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

els.rescan.addEventListener('click', async () => {
  els.rescan.classList.add('spinning');
  els.rescan.disabled = true;
  try {
    const response = await fetch('api/rescan', { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `the server answered ${response.status}`);
    const before = catalog.repository.commit;
    useCatalog(body);
    toast(before && before !== body.repository.commit ? `Updated to ${body.repository.commit.slice(0, 7)}` : 'Scanned again: up to date');
  } catch (error) {
    toast(`Scan failed: ${error.message}`);
  } finally {
    els.rescan.classList.remove('spinning');
    els.rescan.disabled = false;
  }
});

els.theme.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
els.help.addEventListener('click', () => els.shortcuts.showModal());

document.addEventListener('keydown', (event) => {
  const inField = event.target.closest?.('input, select, textarea') && event.target !== document.body;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (state.skill) closeSkill();
    els.query.focus();
    els.query.select();
    return;
  }
  if (inField || event.metaKey || event.ctrlKey || event.altKey || els.shortcuts.open) return;
  const skill = state.skill && skills.find((s) => s.name === state.skill);
  switch (event.key) {
    case '/':
      event.preventDefault();
      if (state.skill) closeSkill();
      els.query.focus();
      els.query.select();
      break;
    case 'Escape':
      if (els.filters.classList.contains('open')) setFiltersOpen(false);
      else if (state.skill) closeSkill();
      else if (state.q) {
        els.query.value = '';
        update({ q: '' });
      }
      break;
    case 'j':
    case 'ArrowDown':
    case 'ArrowRight':
      if (event.key.startsWith('Arrow') && state.skill && event.key === 'ArrowDown') return;
      event.preventDefault();
      step(1);
      break;
    case 'k':
    case 'ArrowUp':
    case 'ArrowLeft':
      if (event.key.startsWith('Arrow') && state.skill && event.key === 'ArrowUp') return;
      event.preventDefault();
      step(-1);
      break;
    case 'Enter':
      if (!state.skill && visible[selected] && !event.target.closest('a, button')) openSkill(visible[selected].name);
      break;
    case 'c':
      if (skill) copy(skill.link, 'Link');
      break;
    case 'g':
      if (skill) window.open(skill.link, '_blank', 'noopener');
      break;
    case 't':
      els.theme.click();
      break;
    case '?':
      els.shortcuts.showModal();
      break;
  }
});

// The theme the visitor chose last, else the system's.
try {
  const saved = localStorage.getItem('skill-atlas-theme');
  setTheme(saved ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
} catch {
  setTheme('dark');
}

els.rescan.hidden = STATIC;
load();

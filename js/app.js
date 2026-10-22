/*
 * Editor HTML: visual (izquierda) + código (derecha), sincronizados.
 *
 * Cómo se garantiza que no se pierde nada del HTML:
 *  - El editor visual es un <iframe sandbox="allow-same-origin"> SIN allow-scripts:
 *    los <script> y los atributos on* se cargan en el DOM pero nunca se ejecutan,
 *    así que no pueden modificar la página ni romper el editor.
 *  - Se edita con designMode, que no añade atributos (contenteditable) al documento.
 *  - Al sincronizar se serializa el documento completo (doctype, comentarios,
 *    <head> con estilos/scripts/metas y <body>) con HtmlCleaner.serialize.
 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const STORAGE = {
    autosave: 'htmleditor.autosave',
    name: 'htmleditor.filename',
    split: 'htmleditor.split',
    layout: 'htmleditor.layout',
    clean: 'htmleditor.cleanOptions',
    wrap: 'htmleditor.wrap'
  };

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* sin almacenamiento */ } }
  };

  const frame = $('#visualFrame');
  const workspace = $('#workspace');
  const paneVisual = $('#paneVisual');
  const breadcrumb = $('#breadcrumb');
  const filenameEl = $('#filename');
  const codeStats = $('#codeStats');

  const state = {
    fileHandle: null,
    fileName: store.get(STORAGE.name) || 'sin título.html',
    dirty: false,
    fragment: false,     // el código actual es un fragmento (sin <html>/<body>)
    currentEl: null,     // elemento seleccionado en el editor visual
    savedRange: null,    // última selección del editor visual
    renderTimer: 0,
    syncTimer: 0,
    autosaveTimer: 0
  };

  /* ============================ Editor de código ============================ */

  const cm = CodeMirror($('#codeWrap'), {
    mode: 'htmlmixed',
    theme: 'material-darker',
    lineNumbers: true,
    lineWrapping: store.get(STORAGE.wrap) === '1',
    tabSize: 2,
    indentUnit: 2,
    autoCloseTags: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    styleActiveLine: true,
    // Emmet: escribe p, ul>li*3, div.caja#id… y pulsa Tab para expandir.
    emmet: { mark: true, preview: true, markTagPairs: true, autoRenameTags: true },
    extraKeys: {
      'Tab': 'emmetExpandAbbreviation',
      'Esc': 'emmetResetAbbreviation',
      'Enter': 'emmetInsertLineBreak',
      'Ctrl-Space': 'emmetCaptureAbbreviation',
      'Ctrl-/': 'emmetToggleComment',
      'Shift-Ctrl-A': 'emmetWrapWithAbbreviation',
      'Shift-Ctrl-K': 'emmetRemoveTag',
      'Ctrl-S': () => save(),
      'Cmd-S': () => save(),
      'Shift-Alt-F': () => formatCode(),
      'Ctrl-J': 'toMatchingTag'
    }
  });

  cm.on('change', (_cm, change) => {
    updateStats();
    markDirty();
    // Los cambios que vienen del editor visual no deben volver a renderizarlo.
    if (change.origin === 'visual') return;
    clearTimeout(state.syncTimer);
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(renderVisual, change.origin === 'setValue' ? 0 : 400);
  });

  function updateStats() {
    const text = cm.getValue();
    codeStats.textContent = cm.lineCount() + ' líneas · ' + text.length.toLocaleString('es') + ' caracteres';
  }

  /** Sustituye el texto del editor cambiando sólo la parte que difiere (mantiene scroll y cursor). */
  function replaceCode(newText, origin) {
    const old = cm.getValue();
    if (old === newText) return;
    const min = Math.min(old.length, newText.length);
    let start = 0;
    while (start < min && old.charCodeAt(start) === newText.charCodeAt(start)) start++;
    let end = 0;
    while (end < min - start &&
           old.charCodeAt(old.length - 1 - end) === newText.charCodeAt(newText.length - 1 - end)) end++;
    cm.replaceRange(
      newText.slice(start, newText.length - end),
      cm.posFromIndex(start),
      cm.posFromIndex(old.length - end),
      origin
    );
  }

  /* ============================= Editor visual ============================= */

  // Mutaciones que sólo añaden/quitan nodos inyectados por extensiones (p. ej. un
  // <script src="moz-extension://...">) no son ediciones del usuario.
  function isInjectedMutation(m) {
    if (m.type !== 'childList') return HtmlCleaner.isInjectedNode(m.target);
    const nodes = Array.from(m.addedNodes).concat(Array.from(m.removedNodes));
    return nodes.length > 0 && nodes.every(HtmlCleaner.isInjectedNode);
  }

  const observer = new MutationObserver((mutations) => {
    const doc = visualDoc();
    if (doc) HtmlCleaner.stripInjected(doc);
    const userEdit = mutations.some((m) => !isInjectedMutation(m));
    // Si el código ya arrastra restos de una extensión, se sincroniza para eliminarlos.
    if (!userEdit && !HtmlCleaner.hasInjectedUrl(cm.getValue())) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(syncVisualToCode, 150);
  });

  function visualDoc() {
    try { return frame.contentDocument; } catch (e) { return null; }
  }

  function renderVisual() {
    const html = cm.getValue();
    state.fragment = HtmlCleaner.isFragment(html);
    const doc = visualDoc();
    const scroll = doc && doc.scrollingElement ? doc.scrollingElement.scrollTop : 0;
    observer.disconnect();
    frame.onload = () => setupVisual(scroll);
    frame.srcdoc = html;
  }

  function setupVisual(scroll) {
    const doc = visualDoc();
    if (!doc) return;
    doc.designMode = 'on';
    try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* no soportado */ }
    applyEditorDefaults(doc);
    if (doc.scrollingElement) doc.scrollingElement.scrollTop = scroll || 0;
    state.currentEl = null;
    state.savedRange = null;
    renderBreadcrumb();

    doc.addEventListener('selectionchange', onVisualSelection);
    doc.addEventListener('keydown', onShortcut);
    // Evita que los enlaces o formularios naveguen dentro del iframe.
    doc.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) e.preventDefault(); }, true);
    doc.addEventListener('submit', (e) => e.preventDefault(), true);
    doc.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    doc.addEventListener('drop', (e) => { if (hasFiles(e)) { e.preventDefault(); openDropped(e); } });

    observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  // Estilos por defecto sólo para el editor visual. Van en una hoja "adoptada"
  // (no está en el DOM, así que no se serializa ni dispara el observer) y en una
  // @layer, de modo que cualquier regla del propio documento tiene prioridad.
  const EDITOR_DEFAULT_CSS = '@layer editor-defaults { :root { font-family: Arial, sans-serif; } }';

  function applyEditorDefaults(doc) {
    try {
      const sheet = new frame.contentWindow.CSSStyleSheet();
      sheet.replaceSync(EDITOR_DEFAULT_CSS);
      doc.adoptedStyleSheets = [sheet];
    } catch (e) { /* navegador sin hojas adoptadas: se usa la fuente por defecto */ }
  }

  function syncVisualToCode() {
    const doc = visualDoc();
    if (!doc || !doc.documentElement) return;
    HtmlCleaner.stripInjected(doc);
    replaceCode(HtmlCleaner.serialize(doc, state.fragment), 'visual');
  }

  function onVisualSelection() {
    const doc = visualDoc();
    const sel = doc && doc.getSelection();
    if (!sel || !sel.rangeCount) return;
    state.savedRange = sel.getRangeAt(0).cloneRange();
    let node = sel.anchorNode;
    if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
    state.currentEl = node && node.nodeType === Node.ELEMENT_NODE ? node : null;
    renderBreadcrumb();
    updateToolbarState();
  }

  function describe(el) {
    let s = el.localName;
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) {
      s += '.' + Array.from(el.classList).slice(0, 2).join('.') + (el.classList.length > 2 ? '…' : '');
    }
    return s;
  }

  function renderBreadcrumb() {
    breadcrumb.textContent = '';
    const el = state.currentEl;
    if (!el || !el.isConnected) {
      breadcrumb.innerHTML = '<span class="muted">Haz clic en el contenido para ver la ruta del elemento</span>';
      return;
    }
    const chain = [];
    for (let n = el; n && n.nodeType === Node.ELEMENT_NODE && n.localName !== 'html'; n = n.parentElement) chain.unshift(n);
    chain.forEach((node, i) => {
      if (i) {
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = '›';
        breadcrumb.appendChild(arrow);
      }
      const a = document.createElement('a');
      a.textContent = describe(node);
      a.title = 'Seleccionar <' + node.localName + '>';
      if (node === el) a.className = 'current';
      a.addEventListener('mousedown', (e) => e.preventDefault());
      a.addEventListener('click', () => selectElement(node));
      breadcrumb.appendChild(a);
    });
  }

  function selectElement(node) {
    const doc = visualDoc();
    if (!doc || !node.isConnected) return;
    frame.contentWindow.focus();
    const range = doc.createRange();
    if (node === doc.body) range.selectNodeContents(node); else range.selectNode(node);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    state.currentEl = node;
    state.savedRange = range.cloneRange();
    renderBreadcrumb();
    if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------- Barra de herramientas ------------------------- */

  const TOGGLE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript',
    'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];

  function updateToolbarState() {
    const doc = visualDoc();
    if (!doc) return;
    TOGGLE_CMDS.forEach((cmd) => {
      const btn = $('#visualToolbar [data-cmd="' + cmd + '"]');
      let on = false;
      try { on = doc.queryCommandState(cmd); } catch (e) { /* ignorar */ }
      btn.classList.toggle('active', !!on);
    });
  }

  function restoreSelection() {
    const doc = visualDoc();
    if (!doc) return null;
    frame.contentWindow.focus();
    const sel = doc.getSelection();
    if (state.savedRange && state.savedRange.startContainer.isConnected) {
      sel.removeAllRanges();
      sel.addRange(state.savedRange);
    }
    return doc;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function runCommand(cmd, value) {
    const doc = restoreSelection();
    if (!doc) return;
    const exec = (c, v) => doc.execCommand(c, false, v);

    switch (cmd) {
      case 'createLink': {
        const url = prompt('URL del enlace:', 'https://');
        if (!url) return;
        const sel = doc.getSelection();
        if (sel.isCollapsed) exec('insertHTML', '<a href="' + escapeAttr(url) + '">' + escapeAttr(url) + '</a>');
        else exec('createLink', url);
        break;
      }
      case 'insertImage': {
        const url = prompt('URL de la imagen:', 'https://');
        if (!url) return;
        const alt = prompt('Texto alternativo (alt):', '') || '';
        exec('insertHTML', '<img src="' + escapeAttr(url) + '" alt="' + escapeAttr(alt) + '">');
        break;
      }
      case 'insertTable': {
        const dims = prompt('Tamaño de la tabla (filas x columnas):', '3x3');
        if (!dims) return;
        const m = dims.match(/(\d+)\s*[x×*,]\s*(\d+)/i);
        if (!m) return toast('Formato no válido. Usa por ejemplo 3x4');
        const rows = Math.min(+m[1], 100), cols = Math.min(+m[2], 30);
        let html = '<table>\n<tbody>\n';
        for (let r = 0; r < rows; r++) {
          html += '<tr>' + '<td>&nbsp;</td>'.repeat(cols) + '</tr>\n';
        }
        exec('insertHTML', html + '</tbody>\n</table><p><br></p>');
        break;
      }
      case 'foreColor':
      case 'hiliteColor':
        // Con styleWithCSS se generan <span style> en lugar de <font>.
        exec('styleWithCSS', true);
        exec(cmd, value);
        exec('styleWithCSS', false);
        break;
      case 'formatBlock':
        if (value) exec('formatBlock', '<' + value + '>');
        break;
      case 'deleteElement': {
        const el = state.currentEl;
        if (!el || !el.isConnected || el === doc.body || el === doc.documentElement) {
          return toast('Selecciona un elemento (haz clic en la ruta inferior)');
        }
        const parent = el.parentElement;
        selectElement(el);
        exec('delete');
        state.currentEl = parent;
        renderBreadcrumb();
        break;
      }
      default:
        exec(cmd, value);
    }
    updateToolbarState();
  }

  $$('#visualToolbar button[data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // no robar la selección
    btn.addEventListener('click', () => runCommand(btn.dataset.cmd));
  });
  $$('#visualToolbar select[data-cmd]').forEach((sel) => {
    sel.addEventListener('change', () => {
      runCommand(sel.dataset.cmd, sel.value);
      sel.value = '';
    });
  });
  $$('#visualToolbar input[type="color"]').forEach((input) => {
    input.addEventListener('change', () => runCommand(input.dataset.cmd, input.value));
  });

  /* ============================ Archivos ============================ */

  function setFileName(name) {
    state.fileName = name;
    filenameEl.textContent = name;
    filenameEl.title = name;
    document.title = name + ' · Editor HTML';
    store.set(STORAGE.name, name);
  }

  function markDirty() {
    state.dirty = true;
    filenameEl.classList.add('dirty');
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => store.set(STORAGE.autosave, cm.getValue()), 800);
  }

  function markClean() {
    state.dirty = false;
    filenameEl.classList.remove('dirty');
  }

  function loadDocument(text, name, handle) {
    state.fileHandle = handle || null;
    cm.setValue(text);
    cm.clearHistory();
    setFileName(name);
    markClean();
    store.set(STORAGE.autosave, text);
  }

  function confirmDiscard() {
    return !state.dirty || confirm('Hay cambios sin guardar. ¿Continuar y descartarlos?');
  }

  const PICKER_TYPES = [{ description: 'Documento HTML', accept: { 'text/html': ['.html', '.htm'] } }];

  async function openFile() {
    if (!confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
        const file = await handle.getFile();
        loadDocument(await file.text(), file.name, handle);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        // Si la API falla (p. ej. en file://), se usa el selector clásico.
      }
    }
    $('#fileInput').click();
  }

  $('#fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) loadDocument(await file.text(), file.name, null);
    e.target.value = '';
  });

  async function save() {
    if (state.fileHandle && state.fileHandle.createWritable) {
      try {
        const w = await state.fileHandle.createWritable();
        await w.write(cm.getValue());
        await w.close();
        markClean();
        toast('Guardado: ' + state.fileName);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    return saveAs();
  }

  async function saveAs() {
    const html = cm.getValue();
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: state.fileName, types: PICKER_TYPES });
        const w = await handle.createWritable();
        await w.write(html);
        await w.close();
        state.fileHandle = handle;
        setFileName(handle.name);
        markClean();
        toast('Guardado: ' + handle.name);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    // Alternativa: descarga.
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = /\.x?html?$/i.test(state.fileName) ? state.fileName : state.fileName + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    markClean();
    toast('Descargado: ' + a.download);
  }

  function newDocument() {
    if (!confirmDiscard()) return;
    loadDocument('<!DOCTYPE html>\n<html lang="es">\n<head>\n  <meta charset="UTF-8">\n  <title>Nuevo documento</title>\n</head>\n<body>\n  <p></p>\n</body>\n</html>\n',
      'sin título.html', null);
  }

  function hasFiles(e) {
    return e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
  }

  async function openDropped(e) {
    document.body.classList.remove('drop-hint');
    const file = e.dataTransfer.files[0];
    if (!file || !confirmDiscard()) return;
    loadDocument(await file.text(), file.name, null);
  }

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    document.body.classList.add('drop-hint');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('drop-hint');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    openDropped(e);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ======================= Formatear / vista previa ======================= */

  function formatHtml(html) {
    if (typeof html_beautify !== 'function') {
      toast('No se pudo cargar js-beautify (¿sin conexión?)');
      return html;
    }
    return html_beautify(html, {
      indent_size: 2,
      wrap_line_length: 0,
      preserve_newlines: true,
      max_preserve_newlines: 1,
      indent_inner_html: false,
      extra_liners: [],
      end_with_newline: true,
      indent_scripts: 'normal'
    });
  }

  function formatCode() {
    replaceCode(formatHtml(cm.getValue()), 'format');
    toast('Código formateado');
  }

  function preview() {
    // Vista previa real: aquí sí se ejecutan los scripts.
    const blob = new Blob([cm.getValue()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) toast('El navegador bloqueó la ventana emergente');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ============================== Limpieza ============================== */

  const cleanDialog = $('#cleanDialog');
  const cleanForm = $('#cleanForm');
  const cleanBoxes = () => $$('fieldset input[type="checkbox"]', cleanForm);

  const PRESETS = {
    all: (n) => n !== 'plainText' && n !== 'allAttrs',
    none: () => false,
    word: (n) => ['word', 'styles', 'classes', 'unwrapSpans', 'unwrapFont', 'emptyTags', 'comments'].indexOf(n) !== -1,
    semantic: (n) => ['classes', 'styles', 'ids', 'dataAttrs', 'events', 'presentational',
      'unwrapSpans', 'unwrapFont', 'emptyTags', 'comments'].indexOf(n) !== -1
  };

  function openCleanDialog() {
    let saved = {};
    try { saved = JSON.parse(store.get(STORAGE.clean) || '{}'); } catch (e) { /* ignorar */ }
    cleanBoxes().forEach((cb) => { cb.checked = !!saved[cb.name]; });
    cleanDialog.showModal();
  }

  $$('[data-preset]', cleanForm).forEach((btn) => {
    btn.addEventListener('click', () => {
      const test = PRESETS[btn.dataset.preset];
      cleanBoxes().forEach((cb) => { cb.checked = test(cb.name); });
    });
  });

  cleanDialog.addEventListener('close', () => {
    if (cleanDialog.returnValue !== 'apply') return;
    const opts = {};
    cleanBoxes().forEach((cb) => { opts[cb.name] = cb.checked; });
    store.set(STORAGE.clean, JSON.stringify(opts));
    if (!Object.values(opts).some(Boolean)) return toast('No se seleccionó ninguna opción');

    const result = HtmlCleaner.clean(cm.getValue(), opts);
    let html = result.html;
    if ($('#formatAfterClean').checked) html = formatHtml(html);
    replaceCode(html, 'clean');
    toast('Limpieza aplicada' + (result.removed > 0 ? ' · ' + result.removed + ' elementos eliminados' : ''));
  });

  /* ============================ Diseño / splitter ============================ */

  function setLayout(layout) {
    workspace.classList.remove('layout-visual', 'layout-code', 'layout-split');
    workspace.classList.add('layout-' + layout);
    $$('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));
    store.set(STORAGE.layout, layout);
    cm.refresh();
  }

  $$('[data-layout]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));

  const splitter = $('#splitter');
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    workspace.classList.add('resizing');
    const move = (ev) => {
      const rect = workspace.getBoundingClientRect();
      const pct = Math.min(85, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
      paneVisual.style.flexBasis = pct + '%';
    };
    const up = () => {
      splitter.classList.remove('dragging');
      workspace.classList.remove('resizing');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      store.set(STORAGE.split, paneVisual.style.flexBasis);
      cm.refresh();
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });

  /* ============================ Acciones / atajos ============================ */

  const ACTIONS = {
    new: newDocument,
    open: openFile,
    save: save,
    saveAs: saveAs,
    format: formatCode,
    clean: openCleanDialog,
    preview: preview
  };

  $$('[data-action]').forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.action]()));

  const CODE_ACTIONS = {
    search: () => { cm.focus(); cm.execCommand('find'); },
    replace: () => { cm.focus(); cm.execCommand('replace'); },
    fold: (() => {
      let folded = false;
      return () => { cm.execCommand(folded ? 'unfoldAll' : 'foldAll'); folded = !folded; };
    })(),
    wrap: () => {
      const on = !cm.getOption('lineWrapping');
      cm.setOption('lineWrapping', on);
      $('[data-code="wrap"]').classList.toggle('active', on);
      store.set(STORAGE.wrap, on ? '1' : '0');
    },
    copy: async () => {
      try {
        await navigator.clipboard.writeText(cm.getValue());
        toast('Código copiado al portapapeles');
      } catch (e) {
        cm.focus();
        cm.execCommand('selectAll');
        toast('Pulsa Ctrl+C para copiar');
      }
    }
  };

  $$('[data-code]').forEach((b) => b.addEventListener('click', () => CODE_ACTIONS[b.dataset.code]()));

  function onShortcut(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
    else if (k === 'o') { e.preventDefault(); openFile(); }
  }
  document.addEventListener('keydown', onShortcut);

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ================================ Inicio ================================ */

  const split = store.get(STORAGE.split);
  if (split) paneVisual.style.flexBasis = split;
  setLayout(store.get(STORAGE.layout) || 'split');
  $('[data-code="wrap"]').classList.toggle('active', cm.getOption('lineWrapping'));

  const autosaved = store.get(STORAGE.autosave);
  loadDocument(autosaved !== null ? autosaved : window.SAMPLE_HTML, state.fileName, null);
  if (autosaved !== null) toast('Se ha recuperado el último documento');
})();

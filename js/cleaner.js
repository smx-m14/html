/*
 * Utilidades de análisis, serialización y limpieza de HTML.
 * Todo funciona sobre documentos creados con DOMParser, donde los scripts
 * nunca se ejecutan, así que es seguro manipular cualquier HTML.
 */
(function (global) {
  'use strict';

  const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
    'param', 'source', 'track', 'wbr'
  ]);

  // Elementos que nunca se consideran "vacíos" aunque no tengan texto.
  const KEEP_WHEN_EMPTY = new Set([
    ...VOID_TAGS, 'html', 'head', 'body', 'script', 'style', 'noscript', 'template',
    'iframe', 'video', 'audio', 'canvas', 'svg', 'object', 'picture', 'textarea',
    'select', 'option', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'colgroup',
    'title', 'button', 'i' // <i> vacío se usa a menudo para iconos
  ]);

  const MEDIA_SELECTOR = 'img, video, audio, iframe, canvas, svg, object, embed, input, select, textarea, button, br, hr';

  const ESSENTIAL_ATTRS = new Set([
    'href', 'src', 'srcset', 'alt', 'title', 'colspan', 'rowspan', 'type', 'name',
    'value', 'content', 'charset', 'rel', 'for', 'action', 'method', 'target',
    'lang', 'dir', 'http-equiv', 'placeholder', 'checked', 'selected', 'disabled'
  ]);

  const PRESENTATIONAL_ATTRS = [
    'align', 'valign', 'bgcolor', 'background', 'border', 'cellpadding',
    'cellspacing', 'width', 'height', 'face', 'color', 'size', 'hspace',
    'vspace', 'nowrap', 'frame', 'rules', 'clear', 'link', 'vlink', 'alink', 'text'
  ];

  // URLs de extensiones del navegador: sus elementos los inyecta la extensión, no son del documento.
  const EXTENSION_URL = /^\s*(moz|chrome|safari(-web)?|ms-browser)-extension:/i;
  const EXTENSION_URL_ANYWHERE = /(moz|chrome|safari(-web)?|ms-browser)-extension:\/\//i;

  function isInjectedNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return EXTENSION_URL.test(node.getAttribute('src') || '') || EXTENSION_URL.test(node.getAttribute('href') || '');
  }

  /** Elimina los elementos inyectados por extensiones. Devuelve cuántos se quitaron. */
  function stripInjected(doc) {
    const nodes = Array.from(doc.querySelectorAll('[src], [href]')).filter(isInjectedNode);
    nodes.forEach(function (el) { el.remove(); });
    return nodes.length;
  }

  /** ¿El código es un fragmento (sin doctype/html/head/body)? */
  function isFragment(src) {
    return !/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(src);
  }

  function parse(src) {
    return new DOMParser().parseFromString(src, 'text/html');
  }

  function doctypeToString(dt) {
    let s = '<!DOCTYPE ' + dt.name;
    if (dt.publicId) s += ' PUBLIC "' + dt.publicId + '"';
    else if (dt.systemId) s += ' SYSTEM';
    if (dt.systemId) s += ' "' + dt.systemId + '"';
    return s + '>';
  }

  /**
   * Serializa un documento completo sin perder nada: doctype, comentarios
   * fuera de <html>, <head> (estilos, scripts, metas) y <body>.
   * En modo fragmento sólo devuelve el contenido de head + body.
   */
  function serialize(doc, fragment) {
    if (fragment) {
      const head = doc.head ? doc.head.innerHTML : '';
      const body = doc.body ? doc.body.innerHTML : '';
      return head && body ? head + '\n' + body : head + body;
    }
    let out = '';
    doc.childNodes.forEach(function (n) {
      if (n.nodeType === Node.DOCUMENT_TYPE_NODE) out += doctypeToString(n) + '\n';
      else if (n.nodeType === Node.COMMENT_NODE) out += '<!--' + n.data + '-->\n';
      else if (n.nodeType === Node.ELEMENT_NODE) out += n.outerHTML;
    });
    return out;
  }

  function allElements(doc) {
    return Array.from(doc.querySelectorAll('*'));
  }

  function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function removeAttrs(doc, test) {
    allElements(doc).forEach(function (el) {
      Array.from(el.attributes).forEach(function (a) {
        if (test(a.name, el)) el.removeAttribute(a.name);
      });
    });
  }

  function forEachNode(doc, whatToShow, fn) {
    const walker = doc.createTreeWalker(doc, whatToShow);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(fn);
  }

  function isEmptyElement(el) {
    if (KEEP_WHEN_EMPTY.has(el.localName)) return false;
    if (el.closest('head, svg, template')) return false;
    if (el.querySelector(MEDIA_SELECTOR)) return false;
    if (el.id || el.getAttribute('name')) return false; // posibles anclas
    return /^\s*$/.test(el.textContent);
  }

  /* --------------------------- Operaciones --------------------------- */

  const OPERATIONS = {
    classes: function (doc) { removeAttrs(doc, function (n) { return n === 'class'; }); },
    styles: function (doc) { removeAttrs(doc, function (n) { return n === 'style'; }); },
    ids: function (doc) { removeAttrs(doc, function (n) { return n === 'id'; }); },
    dataAttrs: function (doc) { removeAttrs(doc, function (n) { return n.startsWith('data-'); }); },
    ariaAttrs: function (doc) { removeAttrs(doc, function (n) { return n.startsWith('aria-') || n === 'role'; }); },
    events: function (doc) { removeAttrs(doc, function (n) { return /^on/i.test(n); }); },
    presentational: function (doc) {
      removeAttrs(doc, function (n, el) {
        // width/height en <img>, <video>, <canvas>... se conservan (evitan saltos de layout).
        if ((n === 'width' || n === 'height') && /^(img|video|canvas|iframe|svg|source)$/.test(el.localName)) return false;
        if (el.closest('svg')) return false;
        return PRESENTATIONAL_ATTRS.indexOf(n) !== -1;
      });
    },
    allAttrs: function (doc) {
      removeAttrs(doc, function (n, el) {
        if (el.closest('svg')) return false;
        return !ESSENTIAL_ATTRS.has(n);
      });
    },
    scripts: function (doc) {
      doc.querySelectorAll('script, noscript').forEach(function (el) { el.remove(); });
    },
    styleTags: function (doc) {
      doc.querySelectorAll('style, link[rel~="stylesheet" i]').forEach(function (el) { el.remove(); });
    },
    comments: function (doc) {
      forEachNode(doc, NodeFilter.SHOW_COMMENT, function (c) { c.remove(); });
    },
    word: function (doc) {
      // Etiquetas con prefijo (o:p, v:shape, w:...) generadas por Word/Office.
      allElements(doc).forEach(function (el) {
        if (el.tagName.indexOf(':') !== -1) unwrap(el);
      });
      removeAttrs(doc, function (n, el) {
        if (n.startsWith('xmlns') || n.indexOf(':') !== -1) return true;
        if (n === 'lang' && el.localName !== 'html') return true;
        return false;
      });
      allElements(doc).forEach(function (el) {
        // Clases Mso* y propiedades mso-* en style.
        if (el.classList.length) {
          Array.from(el.classList).forEach(function (c) { if (/^mso/i.test(c)) el.classList.remove(c); });
          if (!el.classList.length) el.removeAttribute('class');
        }
        const st = el.getAttribute('style');
        if (st && /mso-/i.test(st)) {
          const cleaned = st.split(';').filter(function (d) { return d.trim() && !/^\s*mso-/i.test(d); }).join(';').trim();
          if (cleaned) el.setAttribute('style', cleaned); else el.removeAttribute('style');
        }
      });
      // Comentarios condicionales <!--[if ...]> ... <![endif]-->
      forEachNode(doc, NodeFilter.SHOW_COMMENT, function (c) {
        if (/^\[if|endif\]$/i.test(c.data.trim())) c.remove();
      });
      doc.querySelectorAll('meta[name="Generator" i], meta[name="ProgId" i], meta[name="Originator" i], link[rel="File-List" i]')
        .forEach(function (el) { el.remove(); });
    },
    unwrapSpans: function (doc) {
      Array.from(doc.querySelectorAll('span')).reverse().forEach(unwrap);
    },
    unwrapFont: function (doc) {
      Array.from(doc.querySelectorAll('font')).reverse().forEach(unwrap);
    },
    nbsp: function (doc) {
      forEachNode(doc.body || doc, NodeFilter.SHOW_TEXT, function (t) {
        if (t.parentNode && t.parentNode.closest && t.parentNode.closest('pre, textarea, script, style')) return;
        if (t.data.indexOf(' ') !== -1) t.data = t.data.replace(/ +/g, ' ');
      });
    },
    emptyTags: function (doc) {
      let changed = true;
      while (changed) {
        changed = false;
        Array.from(doc.body ? doc.body.querySelectorAll('*') : []).reverse().forEach(function (el) {
          if (el.isConnected && isEmptyElement(el)) { el.remove(); changed = true; }
        });
      }
    },
    plainText: function (doc) {
      if (!doc.body) return;
      doc.querySelectorAll('script, style, noscript, template').forEach(function (el) { el.remove(); });
      doc.body.textContent = doc.body.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
  };

  // Orden en que se aplican (importa: p.ej. desenvolver spans antes de quitar vacíos).
  const ORDER = [
    'word', 'scripts', 'styleTags', 'comments', 'events', 'classes', 'styles', 'ids',
    'dataAttrs', 'ariaAttrs', 'presentational', 'allAttrs', 'unwrapFont', 'unwrapSpans',
    'nbsp', 'emptyTags', 'plainText'
  ];

  /**
   * Limpia el HTML según las opciones activas.
   * @param {string} src HTML de entrada.
   * @param {Object<string, boolean>} opts Claves de OPERATIONS a aplicar.
   * @returns {{html: string, removed: number}}
   */
  function clean(src, opts) {
    const fragment = isFragment(src);
    const doc = parse(src);
    stripInjected(doc);
    const before = doc.getElementsByTagName('*').length;
    ORDER.forEach(function (key) { if (opts[key]) OPERATIONS[key](doc); });
    const after = doc.getElementsByTagName('*').length;
    return { html: serialize(doc, fragment), removed: before - after };
  }

  global.HtmlCleaner = {
    clean: clean,
    serialize: serialize,
    isFragment: isFragment,
    parse: parse,
    isInjectedNode: isInjectedNode,
    stripInjected: stripInjected,
    hasInjectedUrl: function (src) { return EXTENSION_URL_ANYWHERE.test(src); }
  };
})(window);

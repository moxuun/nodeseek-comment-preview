import DOMPurify from 'dompurify';
import { getSafeUrlAttribute } from '../core/dom.js';

interface SanitizeOptions {
  keepCommentMenu?: boolean;
  deferImages?: boolean;
}

const forbiddenTags = ['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'option', 'button'];
const forbiddenAttributes = ['style', 'srcdoc', 'srcset', 'formaction', 'contenteditable', 'ping', 'data-xns-deferred-src'];

// DOMPurify handles untrusted markup. The following pass only applies NodeSeek's
// layout, link and image policies to the sanitized, detached copy.
export function sanitizeImportedNode(sourceNode: Element | null | undefined, options: SanitizeOptions = {}): Element | null {
  if (!sourceNode || forbiddenTags.includes(sourceNode.localName.toLowerCase())) return null;
  const fragment = DOMPurify.sanitize(sourceNode, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: forbiddenTags,
    ADD_FORBID_CONTENTS: forbiddenTags,
    FORBID_ATTR: forbiddenAttributes,
    // NodeSeek icons reference the page's SVG symbols. Below, <use> is limited
    // to local fragments; external references are never restored.
    ADD_TAGS: ['use'],
  });
  const imported = fragment.firstElementChild;
  if (!imported) return null;
  for (const node of [imported, ...imported.querySelectorAll('*')]) {
    if (node !== imported && !options.keepCommentMenu && node.matches('.comment-menu, .comment-actions')) {
      node.remove();
      continue;
    }
    // Root floor IDs are needed by replies and navigation; child IDs collide
    // with the live page and must not survive cloning.
    if (node !== imported) node.removeAttribute('id');
    for (const name of ['href', 'src', 'poster', 'xlink:href']) {
      const value = node.getAttribute(name);
      if (value === null) continue;
      const localFragment = /^#[\w:.-]+$/.test(value.trim());
      const safeValue = node.localName === 'use'
        ? (localFragment ? value.trim() : null)
        : name === 'xlink:href' && localFragment ? value.trim()
        : getSafeUrlAttribute(name === 'poster' ? 'src' : name === 'xlink:href' ? 'href' : name, value);
      if (!safeValue) node.removeAttribute(name);
      else if (options.deferImages && node.localName === 'img' && name === 'src') {
        // The input's deferred attribute was forbidden above. Only sanitized
        // image URLs can enter this internal channel and later become src.
        node.setAttribute('data-xns-deferred-src', safeValue);
        node.removeAttribute(name);
      } else node.setAttribute(name, safeValue);
    }
    if (node.localName === 'a' && (node.hasAttribute('href') || node.hasAttribute('xlink:href'))) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.localName === 'img') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
      node.setAttribute('referrerpolicy', 'origin');
    }
  }
  return document.adoptNode(imported);
}

(function () {
  'use strict';
  const messages = window.RAIL_I18N_LEGAL_MESSAGES || { en: {}, ja: {} };
  const normalize = value => {
    const v = String(value || '').toLowerCase();
    if (v === 'zh-tw' || v === 'zh-hant' || v.startsWith('zh-')) return 'zh-TW';
    if (v === 'ja' || v.startsWith('ja-')) return 'ja';
    if (v === 'en' || v.startsWith('en-')) return 'en';
    return '';
  };
  let lang = 'zh-TW';
  try {
    lang = normalize(new URLSearchParams(location.search).get('lang')) ||
      normalize(localStorage.getItem('trainmap-language')) ||
      (navigator.languages || [navigator.language]).map(normalize).find(Boolean) || 'zh-TW';
  } catch (e) {}
  document.documentElement.lang = lang;
  const t = source => lang === 'zh-TW' ? source : (messages[lang]?.[source] ?? source);
  if (lang !== 'zh-TW') {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.tagName)) continue;
      const raw = node.nodeValue || '', source = raw.trim();
      if (!source || !Object.prototype.hasOwnProperty.call(messages[lang] || {}, source)) continue;
      node.nodeValue = raw.replace(source, t(source));
    }
    document.title = t(document.title);
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = t(description.content);
  }
  for (const link of document.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('https://')) continue;
    try {
      const url = new URL(href, location.href);
      url.searchParams.set('lang', lang);
      link.href = url.href;
    } catch (e) {}
  }
})();

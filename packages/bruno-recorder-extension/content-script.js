(() => {
  if (window.__BRUNO_RECORDER_CONTENT_SCRIPT__) return;
  window.__BRUNO_RECORDER_CONTENT_SCRIPT__ = true;

  let recording = false;
  let lastInputTimer = null;
  let scrollTimer = null;
  const MASK_STYLE_ID = '__bruno-recorder-sensitive-mask';

  const sensitive = (element) => {
    const haystack = [
      element?.type,
      element?.name,
      element?.id,
      element?.autocomplete,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('data-testid')
    ].filter(Boolean).join(' ');
    return /password|passwd|secret|token|otp|one.?time|credit|card|cvv|cvc|pin/i.test(haystack);
  };

  const cleanText = (value, limit = 200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

  const selectorInfo = (element) => {
    if (!(element instanceof Element)) return {};
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy');
    const id = element.id || null;
    const name = element.getAttribute('name');
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const ariaLabel = element.getAttribute('aria-label');
    const text = cleanText(element.innerText || element.textContent || element.value, 120);
    let css = element.tagName.toLowerCase();
    if (testId) css = `[data-testid="${CSS.escape(testId)}"]`;
    else if (id) css = `#${CSS.escape(id)}`;
    else if (name) css += `[name="${CSS.escape(name)}"]`;
    else {
      const classes = [...element.classList].filter((value) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(value)).slice(0, 2);
      if (classes.length) css += `.${classes.map(CSS.escape).join('.')}`;
    }
    return { css, testId, id, name, role, ariaLabel, text, tagName: element.tagName.toLowerCase() };
  };

  const pageContext = () => ({
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    scroll: { x: scrollX, y: scrollY }
  });

  const send = (event) => {
    if (!recording) return;
    chrome.runtime.sendMessage({
      type: 'BRUNO_RECORDER_EVENT',
      event: {
        id: event.id || `${Date.now().toString(36)}-${crypto.randomUUID()}`,
        timestamp: Date.now(),
        ...event,
        data: { ...pageContext(), ...(event.data || {}) }
      }
    }).catch(() => {});
  };

  const action = (kind, element, extra = {}) => {
    const rect = element instanceof Element ? element.getBoundingClientRect() : null;
    send({
      type: 'action',
      data: {
        kind,
        target: selectorInfo(element),
        coordinates: rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null,
        ...extra
      }
    });
  };

  document.addEventListener('click', (event) => action('click', event.target, { button: event.button }), true);
  document.addEventListener('dblclick', (event) => action('double-click', event.target, { button: event.button }), true);
  document.addEventListener('submit', (event) => action('submit', event.target), true);
  document.addEventListener('change', (event) => {
    const target = event.target;
    const value = sensitive(target) ? '<redacted>' : cleanText(target?.value, 500);
    action('change', target, { value, checked: target?.checked ?? null });
  }, true);
  document.addEventListener('input', (event) => {
    const target = event.target;
    clearTimeout(lastInputTimer);
    lastInputTimer = setTimeout(() => {
      const value = sensitive(target) ? '<redacted>' : cleanText(target?.value, 500);
      action('input', target, { value });
    }, 350);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!['Enter', 'Escape', 'Tab'].includes(event.key)) return;
    action('key', event.target, { key: event.key, shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey });
  }, true);
  addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => send({ type: 'action', data: { kind: 'scroll', scroll: { x: scrollX, y: scrollY } } }), 500);
  }, { capture: true, passive: true });

  const setSensitiveMask = (enabled) => {
    document.getElementById(MASK_STYLE_ID)?.remove();
    if (!enabled || !document.documentElement) return;
    const style = document.createElement('style');
    style.id = MASK_STYLE_ID;
    style.textContent = `
      input[type="password"],
      input[autocomplete*="one-time" i],
      input[autocomplete*="cc-" i],
      input[name*="password" i], input[id*="password" i],
      input[name*="token" i], input[id*="token" i],
      input[name*="secret" i], input[id*="secret" i],
      input[name*="otp" i], input[id*="otp" i],
      input[name*="cvv" i], input[id*="cvv" i] {
        filter: blur(8px) !important;
        color: transparent !important;
        text-shadow: 0 0 8px currentColor !important;
      }
    `;
    document.documentElement.appendChild(style);
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'BRUNO_RECORDER_START') {
      recording = true;
      setSensitiveMask(true);
      send({ type: 'recorder', data: { level: 'info', message: 'Page action capture enabled' } });
      sendResponse({ ok: true });
    } else if (message?.type === 'BRUNO_RECORDER_STOP') {
      send({ type: 'recorder', data: { level: 'info', message: 'Page action capture stopped' } });
      recording = false;
      setSensitiveMask(false);
      sendResponse({ ok: true });
    } else {
      return false;
    }
    return false;
  });
})();

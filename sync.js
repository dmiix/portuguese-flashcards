/* Flashcard progress sync via a private GitHub Gist.
 *
 * Progress lives in localStorage and, when a token is set, in one secret gist
 * (file: portuguese-flashcards-progress.json) shared by every deck and device.
 * Shape: { "<deck>": { "<section>|<portuguese>": { "k": 1|0, "t": <ms timestamp> } } }
 * Merge rule: for each card the entry with the newest timestamp wins.
 */
(function () {
  const FILE = 'portuguese-flashcards-progress.json';
  const LS = { state: 'pfc-progress', token: 'pfc-gh-token', gist: 'pfc-gist-id', dirty: 'pfc-dirty', last: 'pfc-last-sync' };
  const API = 'https://api.github.com';
  const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Portuguese%20flashcards%20sync';

  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  let state = {};
  try { state = JSON.parse(get(LS.state) || '{}') || {}; } catch (e) { state = {}; }
  const saveState = () => put(LS.state, JSON.stringify(state));

  const changeFns = [], statusFns = [];
  let statusText = '';
  function setStatus(t) { statusText = t; statusFns.forEach(f => f(t)); }
  const notify = () => changeFns.forEach(f => f());

  const token = () => get(LS.token);
  const enabled = () => !!token();

  function merge(into, from) {
    let changed = false;
    for (const deck of Object.keys(from || {})) {
      const src = from[deck]; if (!src || typeof src !== 'object') continue;
      const dst = into[deck] || (into[deck] = {});
      for (const key of Object.keys(src)) {
        const e = src[key];
        if (!e || typeof e.t !== 'number') continue;
        if (!dst[key] || e.t > dst[key].t) { dst[key] = { k: e.k ? 1 : 0, t: e.t }; changed = true; }
      }
    }
    return changed;
  }

  async function api(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (r.status === 401) throw new Error('token rejected');
    if (r.status === 403 || r.status === 404) throw new Error(r.status === 404 ? 'gist not found' : 'access denied (needs gist scope)');
    if (!r.ok) throw new Error('GitHub error ' + r.status);
    return r.json();
  }

  async function findOrCreateGist() {
    let id = get(LS.gist);
    if (id) return id;
    for (let page = 1; page <= 10; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`);
      const hit = list.find(g => g.files && g.files[FILE]);
      if (hit) { put(LS.gist, hit.id); return hit.id; }
      if (list.length < 100) break;
    }
    const g = await api('/gists', { method: 'POST', body: JSON.stringify({
      description: 'Portuguese flashcards progress (written by the flashcards site)', public: false,
      files: { [FILE]: { content: JSON.stringify(state) } } }) });
    put(LS.gist, g.id);
    return g.id;
  }

  async function readRemote(id) {
    const g = await api('/gists/' + id);
    const f = g.files && g.files[FILE];
    if (!f) return {};
    let text = f.content;
    if (f.truncated) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    try { return JSON.parse(text || '{}') || {}; } catch (e) { return {}; }
  }

  let running = null, again = false;
  function syncNow() {
    if (!enabled()) { setStatus('Sync: off'); return Promise.resolve(); }
    if (running) { again = true; return running; }
    running = (async () => {
      setStatus('Syncing…');
      try {
        const id = await findOrCreateGist();
        const remote = await readRemote(id);
        if (merge(state, remote)) { saveState(); notify(); }
        // push when we have local changes, or the remote lacks something we have
        const local = JSON.stringify(state);
        const probe = JSON.parse(JSON.stringify(remote));
        if (get(LS.dirty) || merge(probe, state)) {
          await api('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: local } } }) });
        }
        put(LS.dirty, null);
        put(LS.last, String(Date.now()));
        setStatus('Synced ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        if (String(e.message).includes('gist not found')) put(LS.gist, null);
        setStatus(navigator.onLine === false ? 'Offline – will sync later' : 'Sync error: ' + e.message);
      } finally {
        running = null;
        if (again) { again = false; syncNow(); }
      }
    })();
    return running;
  }

  let pushTimer = null;
  function schedulePush() {
    clearTimeout(pushTimer);
    if (enabled()) { setStatus('Saving…'); pushTimer = setTimeout(syncNow, 1200); }
  }

  // ---- settings dialog (shared by all pages) ----
  function openSettings() {
    let d = document.getElementById('pfc-sync-dialog');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'pfc-sync-dialog';
      d.style.cssText = 'max-width:440px;width:calc(100% - 32px);border:1px solid #dce5df;border-radius:18px;padding:22px;color:#172b2a;font:15px/1.5 system-ui,-apple-system,sans-serif;box-shadow:0 20px 60px #193d3230';
      d.innerHTML = `
        <h2 style="margin:0 0 8px;font-size:1.25rem">Sync progress across devices</h2>
        <p style="margin:0 0 10px;color:#61716e">“Know it” marks are saved to a private gist on your GitHub account, so your Mac, iPhone and iPad share them.</p>
        <ol style="margin:0 0 12px;padding-left:20px;color:#61716e">
          <li><a href="${TOKEN_URL}" target="_blank" rel="noopener" style="color:#0c6958">Create a GitHub token</a> — only the <b>gist</b> box ticked; choose an expiration (or “No expiration”).</li>
          <li>Copy the token and paste it below. Do this once on each device.</li>
        </ol>
        <input id="pfc-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…" style="width:100%;min-height:44px;padding:8px 12px;border:1px solid #dce5df;border-radius:10px;font:inherit">
        <p id="pfc-state" style="margin:10px 0;color:#0c6958;font-weight:650"></p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end">
          <button id="pfc-off" type="button">Disconnect</button>
          <button id="pfc-close" type="button">Close</button>
          <button id="pfc-save" type="button" style="border-color:#0c6958;background:#0c6958;color:white">Connect &amp; sync</button>
        </div>`;
      document.body.appendChild(d);
      const st = d.querySelector('#pfc-state');
      onStatus(t => { st.textContent = t; });
      d.querySelector('#pfc-close').onclick = () => d.close();
      d.querySelector('#pfc-off').onclick = () => { put(LS.token, null); put(LS.gist, null); setStatus('Sync: off'); d.querySelector('#pfc-token').value = ''; };
      d.querySelector('#pfc-save').onclick = async () => {
        const v = d.querySelector('#pfc-token').value.trim();
        if (v) { put(LS.token, v); put(LS.gist, null); }
        if (!enabled()) { setStatus('Paste a token first'); return; }
        put(LS.dirty, '1');
        await syncNow();
        if (statusText.startsWith('Synced')) setTimeout(() => d.close(), 700);
      };
    }
    d.querySelector('#pfc-token').value = '';
    d.querySelector('#pfc-token').placeholder = enabled() ? 'Connected (paste a new token to replace)' : 'ghp_…';
    d.querySelector('#pfc-state').textContent = statusText;
    d.showModal();
  }

  function onStatus(f) { statusFns.push(f); f(statusText); }

  window.Sync = {
    isKnown(deck, key) { return !!(state[deck] && state[deck][key] && state[deck][key].k); },
    setKnown(deck, key, k) {
      const d = state[deck] || (state[deck] = {});
      d[key] = { k: k ? 1 : 0, t: Date.now() };
      saveState(); put(LS.dirty, '1'); schedulePush();
    },
    deckCount(deck) { return Object.values(state[deck] || {}).filter(e => e.k).length; },
    onChange(f) { changeFns.push(f); },
    onStatus, openSettings, syncNow,
  };

  setStatus(enabled() ? 'Syncing…' : 'Sync: off');
  // pull on open, when coming back to the page, and when the network returns
  const kick = () => { if (enabled()) syncNow(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick); else setTimeout(kick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); else if (get(LS.dirty)) kick(); });
  window.addEventListener('online', kick);
  // other tabs on the same device
  window.addEventListener('storage', e => {
    if (e.key === LS.state) { try { if (merge(state, JSON.parse(e.newValue || '{}'))) notify(); } catch (x) {} }
  });
})();

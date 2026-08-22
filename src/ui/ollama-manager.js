'use strict';

/* Framework-neutral Ollama control-plane adapter. The renderer supplies a narrow
 * privileged API; this module never performs network or process operations. */
(function factory(root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make;
  else root.OllamaManager = make;
}(typeof globalThis === 'object' ? globalThis : this, function createOllamaManager(api, options) {
  options = options || {};
  if (!api || typeof api !== 'object') throw new TypeError('api must be an injected object');
  const required = ['health', 'listModels', 'catalogPage', 'pull', 'chatStream'];
  required.forEach((name) => { if (typeof api[name] !== 'function') throw new TypeError(`api.${name} must be a function`); });
  const bounded = (value, fallback, max) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback; };
  const MAX_MODELS = bounded(options.maxModels, 2000, 10000);
  const MAX_PAGES = bounded(options.maxPages, 100, 1000);
  const MAX_PROMPT = bounded(options.maxPrompt, 32768, 131072);
  const MAX_RESPONSE = bounded(options.maxResponse, 262144, 1048576);
  const MAX_HISTORY = bounded(options.maxHistory, 500, 2000);
  const MAX_PARALLEL = Math.max(1, Math.min(8, options.maxParallel || 2));
  const state = {
    runtime: { status: 'unknown', version: null, error: null, checkedAt: null },
    installed: [], catalog: [], catalogMeta: { pages: 0, complete: false, revision: null, refreshedAt: null, error: null },
    pulls: [], chats: [], harnesses: [], filters: { query: '', regex: false, pattern: '', flags: '', family: '', capability: '', state: '', sort: 'name' },
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const subscribe = (fn) => { if (typeof fn !== 'function') throw new TypeError('listener must be a function'); listeners.add(fn); return () => listeners.delete(fn); };
  const text = (value, field, max) => { if (typeof value !== 'string') throw new TypeError(`${field} must be text`); if (value.length > (max || 4096)) throw new RangeError(`${field} exceeds limit`); return value; };
  const modelName = (value, field) => text(value, field || 'model', 256).trim() || (() => { throw new TypeError(`${field || 'model'} is required`); })();
  const cloneModel = (model) => Object.assign({}, model, { name: modelName(model.name), tags: Array.isArray(model.tags) ? model.tags.slice(0, 256) : [], capabilities: Array.isArray(model.capabilities) ? model.capabilities.slice(0, 64) : [] });
  const ensureArray = (v, field) => { if (!Array.isArray(v)) throw new TypeError(`${field} must be an array`); return v; };

  async function refreshRuntime() {
    state.runtime = { status: 'checking', version: null, error: null, checkedAt: new Date().toISOString() }; emit();
    try { const result = await api.health(); state.runtime = { status: result && result.ok === false ? 'unhealthy' : 'running', version: result && result.version || null, error: result && result.error || null, checkedAt: new Date().toISOString() }; }
    catch (error) { state.runtime = { status: 'unavailable', version: null, error: String(error && error.message || error), checkedAt: new Date().toISOString() }; }
    emit(); return state.runtime;
  }
  async function refreshInstalled() {
    if (state.runtime.status === 'unknown') await refreshRuntime();
    if (state.runtime.status === 'unavailable') return [];
    try { const result = ensureArray(await api.listModels(), 'listModels result'); state.installed = result.slice(0, MAX_MODELS).map(cloneModel); }
    catch (error) { state.runtime = Object.assign({}, state.runtime, { status: 'unhealthy', error: String(error && error.message || error) }); }
    emit(); return state.installed.slice();
  }
  async function refreshCatalog() {
    let page = 0; let cursor; const records = []; let revision = null;
    state.catalogMeta = { pages: 0, complete: false, revision: null, refreshedAt: null, error: null }; emit();
    try {
      while (page < MAX_PAGES && records.length < MAX_MODELS) {
        const result = await api.catalogPage({ cursor, page, limit: Math.min(100, MAX_MODELS - records.length) });
        if (!result || !Array.isArray(result.models)) throw new TypeError('catalogPage must return {models: []}');
        result.models.forEach((entry) => records.push(cloneModel(entry)));
        revision = result.revision || revision; page += 1; cursor = result.nextCursor;
        if (!cursor) break;
      }
      state.catalog = records.slice(0, MAX_MODELS); state.catalogMeta = { pages: page, complete: !cursor, revision, refreshedAt: new Date().toISOString(), error: null };
    } catch (error) { state.catalogMeta = Object.assign({}, state.catalogMeta, { pages: page, error: String(error && error.message || error) }); }
    emit(); return state.catalog.slice();
  }
  function regexFor(filters) {
    if (!filters.regex) return null;
    try { return new RegExp(filters.pattern || filters.query || '', filters.flags || 'i'); }
    catch (error) { return { error: String(error.message || error) }; }
  }
  function searchableModels(filters) {
    filters = Object.assign({}, state.filters, filters || {}); const rx = regexFor(filters); if (rx && rx.error) return { models: [], error: rx.error };
    const query = String(filters.query || '').toLocaleLowerCase(); let rows = state.catalog.concat(state.installed).filter((m, i, all) => all.findIndex((x) => x.name === m.name) === i);
    rows = rows.filter((m) => { const hay = [m.name, m.family, ...(m.tags || []), ...(m.capabilities || [])].join(' '); if (rx) { rx.lastIndex = 0; if (!rx.test(hay)) return false; } else if (query && !hay.toLocaleLowerCase().includes(query)) return false; if (filters.family && m.family !== filters.family) return false; if (filters.capability && !(m.capabilities || []).includes(filters.capability)) return false; if (filters.state === 'installed' && !state.installed.some((x) => x.name === m.name)) return false; return true; });
    rows.sort((a, b) => filters.sort === 'size' ? (Number(a.size || Infinity) - Number(b.size || Infinity)) : String(a.name).localeCompare(String(b.name))); return { models: rows, error: null };
  }
  function fitVerdict(model, hardware) {
    hardware = hardware || {}; const blob = Number(model.size || model.blobSize); const ram = Number(hardware.ram || hardware.ramBytes); const vram = Number(hardware.vram || hardware.vramBytes); const available = Number(hardware.freeDisk || hardware.freeDiskBytes);
    const evidence = []; if (Number.isFinite(blob)) evidence.push(`blob=${blob}`); if (Number.isFinite(ram)) evidence.push(`ram=${ram}`); if (Number.isFinite(vram)) evidence.push(`vram=${vram}`); if (Number.isFinite(available)) evidence.push(`freeDisk=${available}`);
    if (!Number.isFinite(blob) || (!Number.isFinite(ram) && !Number.isFinite(vram))) return { verdict: 'Unknown', evidence, assumptions: ['missing model size or hardware memory'] };
    if (Number.isFinite(available) && available < blob * 1.2) return { verdict: 'Unlikely', evidence, assumptions: ['requires at least 20% temporary disk headroom'] };
    const memory = Math.max(ram || 0, vram || 0); if (memory >= blob * 2.2) return { verdict: 'Runs well', evidence, assumptions: ['memory headroom >= 2.2x blob'] };
    if (memory >= blob * 1.2) return { verdict: 'Runs with limits', evidence, assumptions: ['memory headroom between 1.2x and 2.2x blob'] };
    return { verdict: 'Unlikely', evidence, assumptions: ['memory headroom below 1.2x blob'] };
  }
  async function pullModels(models, controls) {
    controls = controls || {}; const requested = ensureArray(models, 'models'); if (requested.length > MAX_MODELS) throw new RangeError(`models exceeds ${MAX_MODELS} entries`); const entries = requested.map((m) => ({ name: modelName(typeof m === 'string' ? m : m.name), status: 'queued', progress: 0, error: null })); state.pulls.push(...entries); state.pulls = state.pulls.slice(-MAX_HISTORY); emit();
    let cursor = 0; const worker = async () => { while (cursor < entries.length) { const item = entries[cursor++]; item.status = 'pulling'; emit(); try { const result = await api.pull(item.name, { onProgress: (p) => { item.progress = Math.max(0, Math.min(1, Number(p && (p.fraction === undefined ? p : p.fraction)) || 0)); emit(); }, signal: controls.signal }); item.status = result && result.cancelled ? 'cancelled' : 'complete'; item.progress = item.status === 'complete' ? 1 : item.progress; } catch (error) { item.status = controls.signal && controls.signal.aborted ? 'cancelled' : 'failed'; item.error = String(error && error.message || error); } emit(); } };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, entries.length) }, worker)); return entries;
  }
  async function retryPull(name) { const found = state.pulls.find((p) => p.name === modelName(name) && p.status === 'failed'); return found ? pullModels([found.name]) : []; }
  async function chat(model, prompt, settings) {
    model = modelName(model); prompt = text(prompt, 'prompt', MAX_PROMPT); settings = settings || {}; const parameters = Object.assign({ temperature: 0.7, top_p: 0.9 }, settings.parameters || {});
    if (!Number.isFinite(parameters.temperature) || parameters.temperature < 0 || parameters.temperature > 2) throw new RangeError('temperature must be between 0 and 2'); if (!Number.isFinite(parameters.top_p) || parameters.top_p <= 0 || parameters.top_p > 1) throw new RangeError('top_p must be between 0 and 1');
    const selected = state.catalog.concat(state.installed).find((entry) => entry.name === model); const attachments = ensureArray(settings.attachments || [], 'attachments').map((attachment) => { if (!attachment || typeof attachment !== 'object') throw new TypeError('attachment must be an object'); const kind = text(attachment.kind, 'attachment.kind', 64); if (!attachmentAllowed(selected, { kind })) throw new Error(`attachment capability not verified: ${kind}`); return { name: text(String(attachment.name || 'attachment'), 'attachment.name', 256), kind }; });
    const session = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, model, system: settings.system ? text(settings.system, 'system', MAX_PROMPT) : '', prompt, response: '', status: 'streaming', error: null, attachments }; state.chats.push(session); state.chats = state.chats.slice(-MAX_HISTORY); emit();
    try { const stream = await api.chatStream({ model, prompt, system: session.system, parameters, attachments, signal: settings.signal }); for await (const chunk of stream) { if (settings.signal && settings.signal.aborted) break; const next = typeof chunk === 'string' ? chunk : String(chunk && (chunk.response || chunk.content || '')); session.response = (session.response + next).slice(0, MAX_RESPONSE); emit(); } session.status = settings.signal && settings.signal.aborted ? 'cancelled' : 'complete'; }
    catch (error) { session.status = 'failed'; session.error = String(error && error.message || error); emit(); } return session;
  }
  function attachmentAllowed(model, attachment) { return Boolean(model && Array.isArray(model.capabilities) && model.capabilities.includes(attachment.kind)); }
  function exportChat(id) { const session = state.chats.find((x) => x.id === id); if (!session) throw new Error('chat session not found'); return JSON.stringify({ version: 1, model: session.model, system: session.system, prompt: session.prompt, response: session.response, attachments: session.attachments.map((x) => ({ name: x.name, kind: x.kind })) }, null, 2); }
  function registerHarness(profile) { if (!profile || typeof profile !== 'object' || !profile.id || !profile.executable) throw new TypeError('harness requires id and executable'); if (state.harnesses.some((entry) => entry.id === profile.id)) throw new Error('harness id already registered'); if (!Array.isArray(profile.args) || profile.args.some((x) => typeof x !== 'string')) throw new TypeError('harness args must be string array'); const clean = { id: text(profile.id, 'harness.id', 128), executable: text(profile.executable, 'harness.executable', 4096), args: profile.args.slice(0, 64), workingDirectory: profile.workingDirectory || '', environmentKeys: Object.keys(profile.environment || {}).sort(), status: 'registered' }; if (/[;&|<>`$(){}]/u.test(clean.executable) || clean.args.some((arg) => /[;&|<>`$(){}]/u.test(arg))) throw new Error('harness executable and args must not contain shell syntax'); state.harnesses.push(clean); state.harnesses = state.harnesses.slice(-MAX_HISTORY); emit(); return clean; }
  function preflightHarness(id, context) { const h = state.harnesses.find((x) => x.id === id); if (!h) throw new Error('harness not registered'); const result = { id, status: 'ready', blockers: [], preview: { executable: h.executable, args: h.args.slice(), workingDirectory: h.workingDirectory, environmentKeys: h.environmentKeys, model: context && context.model || null } }; if (context && context.fit && context.fit.verdict === 'Unlikely') { result.status = 'blocked'; result.blockers.push('hardware fit is Unlikely'); } return result; }
  const apiOut = { version: 1, state: snapshot, subscribe, refreshRuntime, refreshInstalled, refreshCatalog, searchableModels, fitVerdict, pullModels, retryPull, chat, attachmentAllowed, exportChat, registerHarness, preflightHarness, saveHarnessSnapshot: (id) => ({ id, at: new Date().toISOString(), state: snapshot() }), restoreHarnessSnapshot: (snapshotValue) => { if (!snapshotValue || typeof snapshotValue !== 'object') throw new TypeError('snapshot required'); return { restored: true, at: new Date().toISOString() }; } };
  return Object.freeze(apiOut);
}));

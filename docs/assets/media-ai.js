(function mediaAISuite(global) {
  'use strict';

  const STORE_KEY = 'material-ffmpeg.media-ai.v1';
  const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
  const MAX_CATALOG_MODELS = 25000;
  const MAX_TEXT = 200000;
  const LOOPBACK = new Set(['127.0.0.1', 'localhost']);
  const API_PATHS = new Set(['/api/version', '/api/tags', '/api/ps', '/api/pull', '/api/chat', '/api/generate', '/api/copy', '/api/delete', '/api/show']);
  const DEFAULT_STATE = Object.freeze({
    version: 1,
    loopbackEnabled: false,
    endpoint: 'http://127.0.0.1:11434',
    catalog: null,
    installed: [],
    running: [],
    cart: [],
    queue: [],
    chats: [],
    snapshots: [],
    hardware: { ramGb: '', vramGb: '', freeDiskGb: '', architecture: '', backend: 'unknown' },
    selectedModel: '',
    activeTab: 'runtime'
  });

  let state = loadState();
  let hostApi = {};
  let root = null;
  let worker = null;
  let chatController = null;
  let pullController = null;
  let harnessProfiles = [];
  const converterInputs = new Map();
  const converterOperations = new Map();
  let converterPaused = false;
  let activeConverterOperation = null;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!parsed || parsed.version !== 1) return clone(DEFAULT_STATE);
      return Object.assign(clone(DEFAULT_STATE), parsed, { version: 1 });
    } catch (_) { return clone(DEFAULT_STATE); }
  }
  function persist() {
    const safe = clone(state);
    safe.installed = safe.installed.slice(0, 2000);
    safe.running = safe.running.slice(0, 2000);
    safe.cart = safe.cart.slice(0, 5000);
    safe.queue = safe.queue.slice(0, 5000).map(item => Object.assign({}, item, { file: undefined, bytes: undefined }));
    safe.chats = safe.chats.slice(-30).map(chat => Object.assign({}, chat, { messages: chat.messages.slice(-200) }));
    safe.snapshots = safe.snapshots.slice(-20);
    localStorage.setItem(STORE_KEY, JSON.stringify(safe));
  }
  function notify(message, kind) {
    if (typeof hostApi.notify === 'function') hostApi.notify({ message, kind: kind || 'info' });
    else if (root) {
      const status = root.querySelector('[data-media-ai-global-status]');
      if (status) { status.textContent = message; status.dataset.state = kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'ok'; }
    }
  }
  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key.startsWith('data-')) node.setAttribute(key, value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setStatus(selector, message, status) {
    const node = root && root.querySelector(selector);
    if (node) { node.textContent = message; node.dataset.state = status || 'ok'; }
  }
  function boundedString(value, limit) { return typeof value === 'string' ? value.slice(0, limit || 500) : ''; }
  function validEndpoint(input) {
    const url = new URL(input);
    if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Endpoint must be http://127.0.0.1:PORT or http://localhost:PORT with no credentials or path.');
    return url.origin;
  }
  async function readBounded(response, maxBytes) {
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      const text = await response.text();
      if (text.length > maxBytes) throw new Error('Local API response exceeded the browser limit.');
      return text;
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { reader.cancel(); throw new Error('Local API response exceeded the browser limit.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
    return new TextDecoder().decode(bytes);
  }
  async function localRequest(path, options) {
    if (!state.loopbackEnabled) throw new Error('Local Ollama access is off. Enable it explicitly first.');
    if (!API_PATHS.has(path)) throw new Error('That local API route is not allowlisted.');
    const origin = validEndpoint(state.endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (options && options.timeout) || 10000);
    const external = options && options.signal;
    if (external) external.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(origin + path, {
        method: options && options.method || 'GET',
        headers: options && options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options && options.body ? JSON.stringify(options.body) : undefined,
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal
      });
      if (!response.ok) throw new Error('Local API returned HTTP ' + response.status + '.');
      return response;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The local request was cancelled or timed out.');
      throw new Error('The browser could not reach the loopback API. Ollama may be stopped, or browser mixed-content, CORS, or Private Network Access policy may have blocked it. ' + error.message);
    } finally { clearTimeout(timeout); }
  }
  async function jsonRequest(path, options, maxBytes) {
    const response = await localRequest(path, options);
    const text = await readBounded(response, maxBytes || 2 * 1024 * 1024);
    try { return JSON.parse(text); } catch (_) { throw new Error('The local API returned invalid JSON.'); }
  }

  function validateCatalog(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.models)) throw new Error('Catalog must use schemaVersion 1 and contain a models array.');
    if (!data.source || typeof data.source.identity !== 'string' || !data.source.refreshedAt || !Number.isInteger(data.source.pageCount) || typeof data.source.complete !== 'boolean') throw new Error('Catalog source identity, refreshedAt, pageCount, and completeness are required.');
    if (data.models.length > MAX_CATALOG_MODELS) throw new Error('Catalog exceeds the 25,000-model limit.');
    const ids = new Set();
    const models = data.models.map((model, index) => {
      const id = boundedString(model && model.id, 200);
      if (!id || ids.has(id)) throw new Error('Catalog model at index ' + index + ' has a missing or duplicate id.');
      ids.add(id);
      const variants = Array.isArray(model.variants) ? model.variants : [];
      if (variants.length > 500) throw new Error('Model ' + id + ' exceeds the 500-variant limit.');
      return {
        id,
        family: boundedString(model.family, 100),
        description: boundedString(model.description, 1000),
        capabilities: Array.isArray(model.capabilities) ? model.capabilities.slice(0, 30).map(v => boundedString(v, 60)) : [],
        variants: variants.map(variant => ({
          tag: boundedString(variant.tag, 240),
          bytes: Number.isSafeInteger(variant.bytes) && variant.bytes >= 0 ? variant.bytes : null,
          parameters: Number.isFinite(variant.parameters) && variant.parameters >= 0 ? variant.parameters : null,
          quantization: boundedString(variant.quantization, 80),
          context: Number.isSafeInteger(variant.context) && variant.context > 0 ? variant.context : null,
          capabilities: Array.isArray(variant.capabilities) ? variant.capabilities.slice(0, 30).map(v => boundedString(v, 60)) : []
        })).filter(v => v.tag)
      };
    });
    return { schemaVersion: 1, source: { identity: boundedString(data.source.identity, 500), revision: boundedString(data.source.revision, 200), refreshedAt: new Date(data.source.refreshedAt).toISOString(), pageCount: data.source.pageCount, complete: data.source.complete }, models };
  }
  function catalogAge() {
    if (!state.catalog) return null;
    return Math.max(0, Date.now() - new Date(state.catalog.source.refreshedAt).getTime());
  }
  function formatBytes(value) {
    if (!Number.isFinite(value)) return 'size unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let n = value; let unit = 0;
    while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1; }
    return n.toFixed(unit > 1 ? 1 : 0) + ' ' + units[unit];
  }
  function fitVerdict(variant) {
    const ram = Number(state.hardware.ramGb), vram = Number(state.hardware.vramGb), disk = Number(state.hardware.freeDiskGb);
    if (!variant || !Number.isFinite(variant.bytes) || !variant.parameters || !ram || !disk || !state.hardware.architecture || state.hardware.backend === 'unknown') return { label: 'Unknown', reason: 'Exact model size, parameters, RAM, storage, architecture, and backend evidence are all required.' };
    const sizeGb = variant.bytes / 1073741824;
    const memoryNeed = Math.max(sizeGb * 1.25, variant.parameters * 0.55);
    if (disk < sizeGb * 1.15) return { label: 'Unlikely', reason: 'Free storage is below the model size plus a 15% transfer margin.' };
    if (ram < memoryNeed * 0.75 && (!vram || vram < memoryNeed * 0.75)) return { label: 'Unlikely', reason: 'Reported RAM and VRAM are below a conservative estimate for this exact variant.' };
    if (ram >= memoryNeed * 1.5 || vram >= memoryNeed * 1.2) return { label: 'Runs well', reason: 'Reported memory exceeds the conservative estimate with headroom; this remains an estimate, not a promise.' };
    return { label: 'Runs with limits', reason: 'Reported resources meet only the conservative lower bound; context or concurrency may need reducing.' };
  }
  function installedNames() { return new Set(state.installed.map(item => item.name || item.model).filter(Boolean)); }

  function renderShell(container) {
    container.replaceChildren();
    container.classList.add('media-ai-shell');
    const toolbar = el('div', { class: 'media-ai-toolbar' });
    const intro = el('div'); intro.append(el('strong', {}, 'Local converter and Ollama suite'), el('span', { class: 'media-ai-help' }, 'Browser-local controls with explicit capability boundaries and no invented results.'));
    const tabs = el('div', { class: 'media-ai-tablist', role: 'tablist', 'aria-label': 'Media and AI tools' });
    const tabDefs = [['runtime','Runtime'],['store','Model store'],['cart','Pull cart'],['chat','Chat'],['harness','Harnesses'],['converter','Converter']];
    tabDefs.forEach(([id, label]) => {
      const button = el('button', { class: 'media-ai-tab', type: 'button', role: 'tab', id: 'media-ai-tab-' + id, ariaControls: 'media-ai-panel-' + id, ariaSelected: state.activeTab === id }, label);
      button.addEventListener('click', () => activateTab(id)); tabs.append(button);
    });
    toolbar.append(intro, tabs); container.append(toolbar, el('div', { class: 'media-ai-status', 'data-media-ai-global-status': '', role: 'status', ariaLive: 'polite' }, 'Ready. No local service has been contacted.'));
    tabDefs.forEach(([id]) => { const panel = el('section', { class: 'media-ai-panel' + (state.activeTab === id ? ' is-active' : ''), id: 'media-ai-panel-' + id, role: 'tabpanel', ariaLabelledby: 'media-ai-tab-' + id }); container.append(panel); });
    renderRuntime(); renderStore(); renderCart(); renderChat(); renderHarnesses(); renderConverter();
  }
  function activateTab(id) {
    state.activeTab = id; persist();
    root.querySelectorAll('.media-ai-tab').forEach(tab => tab.setAttribute('aria-selected', String(tab.id === 'media-ai-tab-' + id)));
    root.querySelectorAll('.media-ai-panel').forEach(panel => panel.classList.toggle('is-active', panel.id === 'media-ai-panel-' + id));
  }
  function card(title, description) { const node = el('article', { class: 'media-ai-card' }); node.append(el('h3', {}, title), el('p', {}, description)); return node; }
  function field(label, control, help) { const wrapper = el('label', { class: 'media-ai-field' }); wrapper.append(el('span', {}, label), control); if (help) wrapper.append(el('small', { class: 'media-ai-help' }, help)); return wrapper; }
  function button(label, action, primary) { const node = el('button', { class: 'media-ai-button' + (primary ? ' primary' : ''), type: 'button' }, label); node.addEventListener('click', action); return node; }

  function renderRuntime() {
    const panel = root.querySelector('#media-ai-panel-runtime'); panel.replaceChildren();
    const grid = el('div', { class: 'media-ai-grid' });
    const connection = card('Local runtime', 'Nothing is contacted until you enable loopback access and press Check runtime. Browser policy may still block the request.');
    const endpoint = el('input', { value: state.endpoint, inputMode: 'url', autocomplete: 'off' });
    endpoint.addEventListener('change', () => { try { state.endpoint = validEndpoint(endpoint.value); persist(); setStatus('[data-runtime-status]', 'Loopback endpoint validated. No request sent.', 'ok'); } catch (e) { endpoint.value = state.endpoint; setStatus('[data-runtime-status]', e.message, 'error'); } });
    const enabled = el('input', { type: 'checkbox', checked: state.loopbackEnabled });
    enabled.addEventListener('change', () => { state.loopbackEnabled = enabled.checked; persist(); setStatus('[data-runtime-status]', enabled.checked ? 'Loopback access enabled. A request is sent only when you choose an action.' : 'Loopback access is off.', enabled.checked ? 'warn' : 'ok'); });
    const enabledLabel = el('label', { class: 'media-ai-inline' }); enabledLabel.append(enabled, el('span', {}, 'Enable browser requests to this loopback endpoint'));
    const actions = el('div', { class: 'media-ai-actions' }); actions.append(button('Check runtime', refreshRuntime, true));
    connection.append(field('Ollama endpoint', endpoint, 'Only 127.0.0.1 or localhost over HTTP is accepted.'), enabledLabel, actions, el('div', { class: 'media-ai-status', 'data-runtime-status': '', role: 'status' }, 'Not checked.'));
    const recovery = card('Recovery guide', 'These checks distinguish a missing service from a browser mediation failure without claiming either one in advance.');
    const list = el('ol', { class: 'media-ai-list' });
    ['Confirm Ollama is installed and started using its official local application.', 'Confirm the local API responds on the endpoint shown above.', 'If Ollama responds outside this page, review browser mixed-content, CORS, and Private Network Access policy.', 'Return here and press Check runtime again.'].forEach(text => list.append(el('li', { class: 'media-ai-row' }, text)));
    recovery.append(list);
    const hardware = card('Hardware evidence', 'Fit labels are conservative estimates. Missing evidence always produces Unknown.');
    [['ramGb','System RAM (GB)'],['vramGb','Usable VRAM (GB)'],['freeDiskGb','Free model storage (GB)']].forEach(([key,label]) => { const input=el('input',{type:'number',min:'0',step:'0.1',value:state.hardware[key]}); input.addEventListener('change',()=>{state.hardware[key]=input.value;persist();renderStore();}); hardware.append(field(label,input)); });
    const arch=el('select'); [['','Choose architecture'],['x64','x64'],['arm64','ARM64']].forEach(([v,l])=>arch.append(el('option',{value:v,selected:state.hardware.architecture===v},l))); arch.addEventListener('change',()=>{state.hardware.architecture=arch.value;persist();renderStore();});
    const backend=el('select'); [['unknown','Unknown'],['cpu','CPU'],['cuda','CUDA'],['rocm','ROCm'],['metal','Metal'],['directml','DirectML']].forEach(([v,l])=>backend.append(el('option',{value:v,selected:state.hardware.backend===v},l))); backend.addEventListener('change',()=>{state.hardware.backend=backend.value;persist();renderStore();});
    hardware.append(field('Architecture',arch),field('Verified backend',backend)); grid.append(connection,recovery,hardware); panel.append(grid); renderInstalledModels(panel);
  }
  function renderInstalledModels(panel){const manager=card('Installed models','This list comes only from the local Ollama API. Copy uses a reviewed destination tag; delete requires the host surface\'s destructive-action confirmation contract.');const list=el('div',{class:'media-ai-list'});state.installed.forEach(entry=>{const name=boundedString(entry.name||entry.model,240);if(!name)return;const row=el('div',{class:'media-ai-row'});const info=el('div');info.append(el('strong',{},name),el('small',{},[formatBytes(entry.size),entry.modified_at?'modified '+boundedString(entry.modified_at,80):''].filter(Boolean).join(' · ')));const actions=el('div',{class:'media-ai-actions'});const target=el('input',{value:(name.replace(/:[^:]+$/,'')||name)+'-copy',maxLength:240,'aria-label':'Copy destination tag for '+name});const copy=button('Copy locally',()=>copyModel(name,target.value));const remove=button('Delete locally',()=>deleteModel(name));remove.disabled=typeof hostApi.confirmDestructiveAction!=='function';if(remove.disabled)remove.title='Unavailable until the host supplies its two-key destructive confirmation and full-range slider.';actions.append(target,copy,remove);row.append(info,actions);list.append(row);});if(!state.installed.length)list.append(el('div',{class:'media-ai-empty'},'No installed-model data is available. Run a successful local runtime check first.'));manager.append(list);panel.append(manager);}
  function validModelTag(value){const tag=boundedString(value,240).trim();if(!tag||!/^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(tag))throw new Error('Model tags may contain letters, numbers, dot, underscore, slash, hyphen, and one tag suffix.');return tag;}
  async function copyModel(source,destination){try{source=validModelTag(source);destination=validModelTag(destination);await jsonRequest('/api/copy',{method:'POST',body:{source,destination},timeout:60000});notify('Local model copy completed: '+source+' → '+destination+'.');await refreshRuntime();}catch(e){notify('Local model copy did not complete: '+e.message,'error');}}
  async function deleteModel(model){if(typeof hostApi.confirmDestructiveAction!=='function'){notify('Model deletion is unavailable because this host has not connected its two-key destructive confirmation and full-range slider.','warn');return;}try{model=validModelTag(model);const approved=await hostApi.confirmDestructiveAction({action:'Delete local Ollama model',affectedData:model,requiresTwoKeys:true,requiresFullRangeSlider:true});if(!approved){notify('Model deletion was cancelled.','warn');return;}await jsonRequest('/api/delete',{method:'DELETE',body:{model},timeout:60000});notify('The confirmed local model deletion completed.');await refreshRuntime();}catch(e){notify('Local model deletion did not complete: '+e.message,'error');}}
  async function refreshRuntime() {
    setStatus('[data-runtime-status]', 'Checking the allowlisted local API…', 'warn');
    try {
      const [version, tags, running] = await Promise.all([jsonRequest('/api/version'), jsonRequest('/api/tags'), jsonRequest('/api/ps')]);
      state.installed = Array.isArray(tags.models) ? tags.models.slice(0, 2000) : [];
      state.running = Array.isArray(running.models) ? running.models.slice(0, 2000) : [];
      persist();
      renderRuntime(); renderStore(); renderCart(); renderChat();
      setStatus('[data-runtime-status]', 'Ollama ' + boundedString(version.version, 100) + ' responded. Installed: ' + state.installed.length + '. Running: ' + state.running.length + '.', 'ok');
    } catch (e) { setStatus('[data-runtime-status]', e.message, 'error'); }
  }

  function renderStore() {
    const panel = root && root.querySelector('#media-ai-panel-store'); if (!panel) return; panel.replaceChildren();
    const importCard = card('Official catalog snapshot', 'Import a complete, versioned snapshot from a trusted source. This static site makes no remote catalog request.');
    const input = el('input', { type: 'file', accept: 'application/json,.json' }); input.addEventListener('change', () => importCatalog(input.files && input.files[0]));
    const meta = state.catalog ? 'Source: ' + state.catalog.source.identity + ' · revision ' + (state.catalog.source.revision || 'not supplied') + ' · ' + state.catalog.source.pageCount + ' pages · ' + (state.catalog.source.complete ? 'complete' : 'incomplete') + ' · age ' + Math.floor(catalogAge()/86400000) + ' days' : 'No catalog snapshot imported.';
    importCard.append(field('Catalog JSON', input, 'Maximum 5 MB and 25,000 model families.'), el('div', { class:'media-ai-status', 'data-catalog-status':'', role:'status' }, meta)); panel.append(importCard);
    if (!state.catalog) { panel.append(el('div',{class:'media-ai-empty'},'Model variants are not shown until a valid catalog snapshot is imported. Installed models remain available from Runtime after a successful local check.')); return; }
    const installed = installedNames(); const categories = el('div',{class:'media-ai-catalog-categories'});
    const search = el('input',{type:'search',placeholder:'Search model family, tag, capability, or quantization','aria-label':'Search imported model catalog'});
    const searchWrap=el('div',{class:'media-ai-search media-ai-field'}); const builder=button('Regex builder',()=>{ if(typeof hostApi.openRegexBuilder==='function') hostApi.openRegexBuilder({source:'media-ai-model-store',input:search,onApply:()=>renderModels(search.value)}); else notify('The host has not connected its anchored regex builder to this field.','warn'); }); searchWrap.append(search,builder); panel.append(searchWrap,categories);
    function renderModels(query) {
      categories.replaceChildren(); const needle=(query||'').toLowerCase(); let shown=0;
      state.catalog.models.forEach(model=>model.variants.forEach(variant=>{
        if(shown>=500)return; const hay=(model.id+' '+model.family+' '+model.capabilities.join(' ')+' '+variant.tag+' '+variant.quantization+' '+variant.capabilities.join(' ')).toLowerCase(); if(needle&&!hay.includes(needle))return;
        shown+=1; const row=el('div',{class:'media-ai-row'}); const info=el('div'); const caps=[...new Set(model.capabilities.concat(variant.capabilities))]; const fit=fitVerdict(variant);
        info.append(el('strong',{},variant.tag),el('small',{},[model.family,variant.quantization,formatBytes(variant.bytes),variant.context?'context '+variant.context:'context unknown',caps.join(', ')||'capabilities unknown'].filter(Boolean).join(' · ')),el('small',{},fit.label+': '+fit.reason));
        const actions=el('div',{class:'media-ai-actions'}); if(installed.has(variant.tag)) actions.append(el('span',{class:'media-ai-badge available'},'Installed')); else actions.append(button('Add to pull cart',()=>addToCart(model,variant),true)); row.append(info,actions); categories.append(row);
      }));
      if(!shown)categories.append(el('div',{class:'media-ai-empty'},'No imported variants match this search.'));
    }
    search.addEventListener('input',()=>renderModels(search.value)); renderModels('');
  }
  async function importCatalog(file) {
    if (!file) return;
    if (file.size > MAX_CATALOG_BYTES) { setStatus('[data-catalog-status]','Catalog exceeds the 5 MB limit.','error'); return; }
    try { const validated=validateCatalog(JSON.parse(await file.text())); state.catalog=validated;persist();renderStore();notify('Catalog snapshot imported and fully validated.'); }
    catch(e){setStatus('[data-catalog-status]','Catalog rejected without replacing the last valid snapshot: '+e.message,'error');}
  }
  function addToCart(model,variant){ if(!state.cart.some(item=>item.tag===variant.tag)) state.cart.push({tag:variant.tag,bytes:variant.bytes,fit:fitVerdict(variant),capabilities:[...new Set(model.capabilities.concat(variant.capabilities))],status:'ready',progress:0});persist();renderCart();notify(variant.tag+' added to the local pull cart.'); }

  function renderCart() {
    const panel=root&&root.querySelector('#media-ai-panel-cart');if(!panel)return;panel.replaceChildren();
    const summary=card('Payment-free batch pull','This cart schedules local Ollama pulls. It has no prices, purchases, checkout, account, subscription, or cloud entitlement.');
    const total=state.cart.reduce((sum,item)=>sum+(Number.isFinite(item.bytes)?item.bytes:0),0);summary.append(el('div',{class:'media-ai-status'},state.cart.length+' item(s) · known transfer '+formatBytes(total)+' · storage margin is assessed per imported variant.'));
    const controls=el('div',{class:'media-ai-actions'});const start=button('Start local pulls',startPulls,true);start.disabled=!state.cart.length;controls.append(start,button('Cancel active pull',()=>{if(pullController)pullController.abort();}));summary.append(controls);panel.append(summary);
    const list=el('div',{class:'media-ai-list'});state.cart.forEach((item,index)=>{const row=el('div',{class:'media-ai-row'});const info=el('div');info.append(el('strong',{},item.tag),el('small',{},formatBytes(item.bytes)+' · '+item.fit.label+' · '+item.fit.reason),el('progress',{class:'media-ai-progress',max:100,value:item.progress||0,'aria-label':'Pull progress for '+item.tag}));const remove=button('Remove',()=>{state.cart.splice(index,1);persist();renderCart();});remove.disabled=item.status==='pulling';row.append(info,remove);list.append(row);});if(!state.cart.length)list.append(el('div',{class:'media-ai-empty'},'The pull cart is empty.'));panel.append(list);
  }
  async function startPulls(){ if(pullController)return;pullController=new AbortController();for(const item of state.cart){if(pullController.signal.aborted)break;item.status='pulling';item.progress=0;persist();renderCart();try{const response=await localRequest('/api/pull',{method:'POST',body:{model:item.tag,stream:true},timeout:30*60*1000,signal:pullController.signal});await consumeNdjson(response,record=>{if(Number.isFinite(record.completed)&&Number.isFinite(record.total)&&record.total>0)item.progress=Math.min(100,Math.round(record.completed/record.total*100));item.status=boundedString(record.status,100)||'pulling';persist();renderCart();},20*1024*1024);item.status='pulled';item.progress=100;}catch(e){item.status=pullController.signal.aborted?'cancelled':'failed: '+e.message;}persist();renderCart();}pullController=null;notify('The local pull batch finished. Review each item for its exact outcome.');}
  async function consumeNdjson(response,onRecord,maxBytes){const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){reader.cancel();throw new Error('Streaming response exceeded the browser limit.');}buffer+=decoder.decode(value,{stream:true});let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split).trim();buffer=buffer.slice(split+1);if(line)onRecord(JSON.parse(line));}}if(buffer.trim())onRecord(JSON.parse(buffer));}

  function renderChat(){const panel=root&&root.querySelector('#media-ai-panel-chat');if(!panel)return;panel.replaceChildren();const chatCard=card('Local streamed chat','Messages stay in this browser. They are sent only to the selected installed local model.');const model=el('select');model.append(el('option',{value:''},'Choose an installed model'));state.installed.forEach(item=>{const name=item.name||item.model;if(name)model.append(el('option',{value:name,selected:state.selectedModel===name},name));});model.addEventListener('change',()=>{state.selectedModel=model.value;persist();renderChat();});const catalogVariant=findVariant(state.selectedModel);const caps=catalogVariant?catalogVariant.capabilities:[];const attachment=el('input',{type:'file',accept:'image/*'});attachment.disabled=!caps.includes('vision');chatCard.append(field('Installed model',model),field('Optional image attachment',attachment,caps.includes('vision')?'Imported metadata confirms image support.':'Disabled because imported capability metadata does not confirm image support.'));
    const messages=el('div',{class:'media-ai-chat','aria-label':'Local chat messages'});const active=state.chats[state.chats.length-1];(active&&active.messages||[]).forEach(msg=>messages.append(el('div',{class:'media-ai-message '+msg.role},msg.content)));if(!active||!active.messages.length)messages.append(el('div',{class:'media-ai-empty'},'No local chat messages yet.'));
    const prompt=el('textarea',{maxLength:MAX_TEXT,placeholder:'Write a message for the selected local model'});const actions=el('div',{class:'media-ai-actions'});const send=button('Send to local model',()=>sendChat(prompt.value,attachment.files&&attachment.files[0]),true);send.disabled=!state.selectedModel;actions.append(send,button('Stop response',()=>{if(chatController)chatController.abort();}));chatCard.append(messages,field('Message',prompt,'Maximum 200,000 characters.'),actions,el('div',{class:'media-ai-status','data-chat-status':'',role:'status'},'Idle.'));panel.append(chatCard);}
  function findVariant(tag){if(!state.catalog||!tag)return null;for(const model of state.catalog.models){for(const variant of model.variants){if(variant.tag===tag)return Object.assign({},variant,{capabilities:[...new Set(model.capabilities.concat(variant.capabilities))]});}}return null;}
  async function sendChat(text,file){text=boundedString(text,MAX_TEXT);if(!text||!state.selectedModel)return;let images;if(file){if(file.size>10*1024*1024){setStatus('[data-chat-status]','Attachment exceeds the 10 MB browser limit.','error');return;}images=[arrayBufferToBase64(await file.arrayBuffer())];}let chat=state.chats[state.chats.length-1];if(!chat||chat.model!==state.selectedModel){chat={id:crypto.randomUUID(),model:state.selectedModel,createdAt:new Date().toISOString(),messages:[]};state.chats.push(chat);}chat.messages.push({role:'user',content:text});chat.messages.push({role:'assistant',content:''});persist();renderChat();chatController=new AbortController();try{const response=await localRequest('/api/chat',{method:'POST',body:{model:state.selectedModel,messages:chat.messages.slice(0,-1).map(m=>({role:m.role,content:m.content})),images,stream:true},timeout:10*60*1000,signal:chatController.signal});await consumeNdjson(response,record=>{if(record.message&&typeof record.message.content==='string')chat.messages[chat.messages.length-1].content+=record.message.content.slice(0,MAX_TEXT);persist();renderChat();},10*1024*1024);setStatus('[data-chat-status]','Local response completed.','ok');}catch(e){setStatus('[data-chat-status]',e.message,'error');}finally{chatController=null;}}
  function arrayBufferToBase64(buffer){const bytes=new Uint8Array(buffer);let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(out);}

  function renderHarnesses(){const panel=root&&root.querySelector('#media-ai-panel-harness');if(!panel)return;panel.replaceChildren();const snapshotCard=card('Local snapshots and rollback','Snapshots contain browser-local metadata only. They never include model blobs, credentials, attachment bytes, or Ollama response bodies.');const actions=el('div',{class:'media-ai-actions'});actions.append(button('Create snapshot',createSnapshot,true),button('Restore latest',restoreLatest));snapshotCard.append(actions);panel.append(snapshotCard);const grid=el('div',{class:'media-ai-grid'});harnessProfiles.forEach(profile=>{const c=card(profile.name,profile.description);const variant=findVariant(state.selectedModel);const caps=variant?variant.capabilities:[];const missing=profile.requiredCapabilities.filter(cap=>!caps.includes(cap));const preview={profile:profile.id,operation:profile.operation,model:state.selectedModel||null,endpoint:state.endpoint,requiredCapabilities:profile.requiredCapabilities,mutatesHost:false,launchesProgram:false};c.append(el('pre',{class:'media-ai-output'},JSON.stringify(preview,null,2)),el('div',{class:'media-ai-status','data-state':missing.length?'warn':'ok'},missing.length?'Unavailable: selected model lacks verified '+missing.join(', ')+' capability.':'Preview ready. Static Pages cannot launch arbitrary programs; this profile maps only to an allowlisted local API operation.'));grid.append(c);});if(!harnessProfiles.length)grid.append(el('div',{class:'media-ai-empty'},'Harness profile data has not loaded.'));panel.append(grid);}
  function createSnapshot(){const snapshot={id:crypto.randomUUID(),createdAt:new Date().toISOString(),endpoint:state.endpoint,hardware:clone(state.hardware),selectedModel:state.selectedModel,cart:clone(state.cart),catalogSource:state.catalog?clone(state.catalog.source):null};state.snapshots.push(snapshot);persist();renderHarnesses();notify('Local metadata snapshot created.');}
  function restoreLatest(){const snapshot=state.snapshots[state.snapshots.length-1];if(!snapshot){notify('There is no snapshot to restore.','warn');return;}const before={endpoint:state.endpoint,hardware:clone(state.hardware),selectedModel:state.selectedModel,cart:clone(state.cart),catalogSource:state.catalog?clone(state.catalog.source):null};try{state.endpoint=validEndpoint(snapshot.endpoint);state.hardware=clone(snapshot.hardware);state.selectedModel=snapshot.selectedModel;state.cart=clone(snapshot.cart);persist();renderShell(root);notify('Latest local metadata snapshot restored.');}catch(e){state.endpoint=before.endpoint;state.hardware=before.hardware;state.selectedModel=before.selectedModel;state.cart=before.cart;persist();notify('Restore failed and the previous browser state was rolled back: '+e.message,'error');}}

  function renderConverter(){const panel=root&&root.querySelector('#media-ai-panel-converter');if(!panel)return;panel.replaceChildren();const intro=card('Browser-local file converter','Type is detected from bounded bytes. Only bundled worker adapters may run; unsupported capabilities stay visible with exact reasons.');const picker=el('input',{type:'file',multiple:true});const actions=el('div',{class:'media-ai-actions'});const inspect=button('Inspect selected files',()=>inspectFiles(picker.files),true);actions.append(inspect,button('Pause queue',()=>{converterPaused=true;setStatus('[data-converter-status]','Queue paused. The active atomic conversion may be cancelled; no new conversion starts.','warn');}),button('Resume queue',()=>{converterPaused=false;setStatus('[data-converter-status]','Queue resumed. Choose an inspected adapter to continue.','ok');}),button('Cancel active item',()=>{if(activeConverterOperation)postWorker({version:1,action:'cancel',id:activeConverterOperation});else setStatus('[data-converter-status]','No conversion is active.','warn');}));intro.append(field('Local source files',picker,'Files are read only after Inspect. Bytes are never persisted in browser storage.'),actions,el('div',{class:'media-ai-status','data-converter-status':'',role:'status'},'No files inspected.'));panel.append(intro);
    const catalog=el('div',{class:'media-ai-catalog-categories','data-converter-catalog':''});panel.append(catalog);renderConverterCatalog(catalog);const queue=el('div',{class:'media-ai-list','data-converter-queue':''});panel.append(queue);renderConverterQueue(queue);}
  function ensureWorker(){if(worker)return worker;try{worker=new Worker('workers/converter-worker.js');worker.addEventListener('message',handleWorkerMessage);worker.addEventListener('error',()=>setStatus('[data-converter-status]','The converter worker could not start. No output was created.','error'));}catch(e){setStatus('[data-converter-status]','This browser could not start the local converter worker: '+e.message,'error');}return worker;}
  function postWorker(message,transfer){const current=ensureWorker();if(current)current.postMessage(message,transfer||[]);}
  function inspectFiles(files){if(!files||!files.length)return;Array.from(files).slice(0,1000).forEach(file=>{const id=crypto.randomUUID();const item={id,name:file.name,size:file.size,status:'reading',progress:0,sourceType:'unknown',adapterIds:[]};state.queue.push(item);if(file.size>32*1024*1024){item.status='failed: source exceeds the bundled worker 32 MiB limit';return;}file.arrayBuffer().then(buffer=>{converterInputs.set(id,buffer);const operationId=id+':inspect';converterOperations.set(operationId,id);const workerInput=buffer.slice(0);postWorker({version:1,action:'inspect',id:operationId,fileName:file.name,input:workerInput},[workerInput]);}).catch(e=>{item.status='failed: '+e.message;persist();renderConverter();});});persist();renderConverter();}
  function handleWorkerMessage(event){const message=event.data||{};if(message.action==='ready')return;const itemId=converterOperations.get(message.id);const item=state.queue.find(entry=>entry.id===itemId);if(!item)return;if(message.action==='inspect'&&message.status==='complete'){const result=message.result||{};Object.assign(item,{status:'inspected',sourceType:result.detected&&result.detected.id||'unknown',adapterIds:(result.candidateAdapters||[]).filter(entry=>entry.available).map(entry=>entry.id),details:{detected:result.detected,preview:result.preview}});}else if(message.action==='convert'&&message.status==='complete'){const result=message.result||{};const metadata=result.metadata||{};const output=result.output;item.status='converted';item.progress=100;const name=outputName(item.name,metadata.targetFormat);item.result={name,mime:metadata.targetFormat||'application/octet-stream',bytes:output&&output.byteLength||0,disclosures:[metadata.disclosure,metadata.lossiness].filter(Boolean)};if(output)downloadBuffer(output,name,metadata.targetFormat);}else if(message.status==='cancelled'){item.status='cancelled';}else if(message.status==='error'){item.status='failed: '+boundedString(message.error&&message.error.message,500);}if(message.action==='convert'&&message.id===activeConverterOperation)activeConverterOperation=null;converterOperations.delete(message.id);persist();renderConverter();}
  function outputName(sourceName,targetFormat){const stem=sourceName.replace(/\.[^.]+$/,'');const map={'application/json':'json','text/csv':'csv','text/plain':'txt','text/plain;base64':'base64','text/plain;hex':'hex','application/octet-stream':'bin'};return stem+'.converted.'+(map[targetFormat]||'bin');}
  function downloadBuffer(buffer,name,mime){const blob=new Blob([buffer],{type:mime||'application/octet-stream'});const url=URL.createObjectURL(blob);const anchor=el('a',{href:url,download:name});anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function renderConverterQueue(node){node.replaceChildren();state.queue.slice(-500).forEach(item=>{const row=el('div',{class:'media-ai-row'});const hasBytes=converterInputs.has(item.id);const info=el('div');info.append(el('strong',{},item.name),el('small',{},item.sourceType+' · '+formatBytes(item.size)+' · '+item.status+(hasBytes?'':' · source bytes must be reselected after reload')),el('progress',{class:'media-ai-progress',max:100,value:item.progress||0}));if(item.result&&item.result.disclosures&&item.result.disclosures.length)info.append(el('small',{},item.result.disclosures.join(' · ')));const actions=el('div',{class:'media-ai-actions'});(item.adapterIds||[]).forEach(adapterId=>{const convert=button('Convert with '+adapterId,()=>startConversion(item,adapterId));convert.disabled=!hasBytes||converterPaused||Boolean(activeConverterOperation);actions.append(convert);});row.append(info,actions);node.append(row);});if(!state.queue.length)node.append(el('div',{class:'media-ai-empty'},'The converter queue is empty. Queue metadata can survive reload, but source bytes cannot; reselect files to resume.'));}
  function startConversion(item,adapterId){if(converterPaused){setStatus('[data-converter-status]','Queue is paused. Resume it before starting another conversion.','warn');return;}const source=converterInputs.get(item.id);if(!source){setStatus('[data-converter-status]','Reselect this source file because browser storage never retains its bytes.','warn');return;}if(activeConverterOperation){setStatus('[data-converter-status]','Another conversion is active. Wait for its atomic outcome or cancel it.','warn');return;}const operationId=item.id+':convert:'+Date.now();activeConverterOperation=operationId;converterOperations.set(operationId,item.id);item.status='converting';item.progress=5;persist();renderConverter();const workerInput=source.slice(0);postWorker({version:1,action:'convert',id:operationId,adapterId,input:workerInput,options:{}},[workerInput]);}
  function renderConverterCatalog(node){const categories=['Documents/PDF','Images','Audio','Video','Archives','Structured Data/Spreadsheets','Code/Text','Binary Encodings'];categories.forEach(category=>{const details=el('details',{class:'media-ai-category',open:category==='Code/Text'||category==='Binary Encodings'});const body=el('div',{class:'media-ai-category-body'});const search=el('input',{type:'search',placeholder:'Filter '+category,'aria-label':'Filter '+category+' adapters'});const builder=button('Regex builder',()=>{if(typeof hostApi.openRegexBuilder==='function')hostApi.openRegexBuilder({source:'media-ai-converter-'+category,input:search});else notify('The host has not connected its anchored regex builder to this category search.','warn');});const searchWrap=el('div',{class:'media-ai-search media-ai-field'});searchWrap.append(search,builder);const list=el('div',{class:'media-ai-list','data-adapter-category':category});body.append(searchWrap,list);details.append(el('summary',{},category),body);node.append(details);search.addEventListener('input',()=>filterAdapterList(list,search.value));});loadAdapterRegistry();}
  function filterAdapterList(list,query){const needle=query.toLowerCase();list.querySelectorAll('.media-ai-row').forEach(row=>row.hidden=needle&&!row.textContent.toLowerCase().includes(needle));}
  async function loadAdapterRegistry(){try{await import('../workers/converter-adapters.js');const adapterApi=global.MaterialFFmpegConverterAdapters;if(!adapterApi)throw new Error('registry global was not exposed');const labels=new Map(adapterApi.categories.map(category=>[category.id,category.label]));root.querySelectorAll('[data-adapter-category]').forEach(list=>{list.replaceChildren();adapterApi.registry.filter(adapter=>labels.get(adapter.categoryId)===list.dataset.adapterCategory).forEach(adapter=>{const row=el('div',{class:'media-ai-row'});const info=el('div');info.append(el('strong',{},adapter.label),el('small',{},adapter.sourceFormats.join(', ')+' → '+adapter.targetFormats.join(', ')),el('small',{},adapter.available?adapter.disclosure:adapter.unavailableReason));row.append(info,el('span',{class:'media-ai-badge '+(adapter.available?'available':'unavailable')},adapter.available?'Bundled':'Unavailable'));list.append(row);});});}catch(e){setStatus('[data-converter-status]','Adapter registry could not load: '+e.message,'error');}}

  async function loadHarnessProfiles(){try{const response=await fetch('assets/media-ai-data/harness-profiles.json',{cache:'no-store',credentials:'omit'});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(data.schemaVersion!==1||!Array.isArray(data.profiles))throw new Error('invalid schema');harnessProfiles=data.profiles.slice(0,50).map(p=>({id:boundedString(p.id,100),name:boundedString(p.name,150),description:boundedString(p.description,500),operation:boundedString(p.operation,50),requiredCapabilities:Array.isArray(p.requiredCapabilities)?p.requiredCapabilities.slice(0,20):[],mutable:false}));}catch(_){harnessProfiles=[];}if(root)renderHarnesses();}
  function mount(container){if(!container)throw new Error('A Media AI mount element is required.');root=container;renderShell(root);loadHarnessProfiles();return api;}
  function init(coreApi){hostApi=coreApi||{};if(typeof hostApi.registerFeature==='function'){hostApi.registerFeature({id:'media-ai',title:'Converter and Ollama',description:'Browser-local conversion and Ollama management with explicit capability boundaries.',mount});return api;}const container=hostApi.mount||document.querySelector('[data-media-ai-root]');if(container)mount(container);return api;}
  const api=Object.freeze({init,mount,refreshRuntime,getState:()=>clone(state),validateCatalog,fitVerdict});
  global.MaterialFFmpegMediaAI=api;
})(window);

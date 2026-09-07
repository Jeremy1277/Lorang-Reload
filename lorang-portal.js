/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   LORANG PORTAL â€” porte d'accÃ¨s unique des applications Lorang
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Toute application Lorang ne s'ouvre que si l'utilisateur est identifiÃ© dans
   LORANG Service Center (compte Microsoft du tenant Lorang, app Topo3PL).

   Fonctionnement
   1. L'application appelle LorangPortal.init({ app:'turnover', msal: instanceMsal? })
      avant d'afficher quoi que ce soit (une porte plein Ã©cran couvre la page).
   2. Le portail rÃ©cupÃ¨re silencieusement le passeport (jeton d'identitÃ© Microsoft) :
      compte dÃ©jÃ  connu dans ce navigateur, sinon SSO silencieux grÃ¢ce Ã  l'indice
      Â« #sso=<e-mail> Â» ajoutÃ© par le Service Center quand il lance l'application.
   3. Le passeport ET le billet de lancement (Â« #lt=â€¦ Â», dÃ©livrÃ© par le Service Center
      au moment du clic, 2 minutes) sont prÃ©sentÃ©s Ã  /api/portal/me qui les vÃ©rifie
      â†’ la porte s'efface et une session d'appli (10 h, cet onglet) est mÃ©morisÃ©e pour les F5.
      URL tapÃ©e directement (ni billet ni session) â†’ accÃ¨s coupÃ©, renvoi vers l'accueil du
      Service Center (aucune relance automatique : il faut cliquer sur l'application).
   4. LorangPortal.ai({ system, user | messages, max_tokens }) relaie vers Claude
      via Service Center (/api/portal/ai) : une seule clÃ© API, cÃ´tÃ© Service Center.

   DÃ©pendance : msal-browser 2.x chargÃ© avant ce script.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
(function (global) {
  'use strict';
  const PORTAL_URL = 'https://ambitious-flower-0eaea7810.7.azurestaticapps.net';
  const CLIENT_ID = '56ae2586-8bb0-48a9-afd5-cb7a6bf12cc3';
  const AUTHORITY = 'https://login.microsoftonline.com/08978fe5-0eb9-4b54-8f3d-dc0653f6dffa';
  const OIDC_SCOPES = ['openid', 'profile', 'email'];
  const HINT_KEY = 'lorang-portal-hint';
  const TRIED_KEY = 'lorang-portal-tried';
  const TICKET_KEY = 'lorang-portal-ticket';
  const SESSION_KEY = 'lorang-portal-session';

  const S = { app: '', msal: null, account: null, user: null, ready: false, error: null, listeners: [] };

  /* â”€â”€ porte plein Ã©cran â”€â”€ */
  const CSS = `#lpGate{position:fixed;inset:0;z-index:100000;background:#050505;display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Barlow',system-ui,sans-serif;transition:opacity .4s ease}
#lpGate.hide{opacity:0;pointer-events:none}
#lpGate .c{width:min(420px,100%);text-align:center;color:#a8bccd;animation:lpUp .6s cubic-bezier(.2,.8,.25,1) both}
@keyframes lpUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
#lpGate .t{font-family:'Barlow Condensed','Barlow',sans-serif;font-size:26px;font-weight:700;letter-spacing:.14em;color:#fff;margin-top:14px}
#lpGate .t b{color:#85BC25;font-weight:700}
#lpGate .s{font-size:12.5px;color:#7a8ca0;margin-top:8px;line-height:1.6;min-height:20px}
#lpGate .s.err{color:#e8901a}
#lpGate .spin{width:34px;height:34px;border-radius:50%;border:3px solid rgba(133,188,37,.25);border-top-color:#85BC25;margin:0 auto;animation:lpSpin 1s linear infinite}
@keyframes lpSpin{to{transform:rotate(360deg)}}
#lpGate .btns{display:flex;flex-direction:column;gap:10px;margin-top:26px}
#lpGate a.b,#lpGate button.b{border:none;cursor:pointer;border-radius:10px;padding:13px;font-family:'Barlow Condensed','Barlow',sans-serif;font-weight:700;font-size:15px;letter-spacing:.1em;text-decoration:none;transition:all .2s}
#lpGate .b.p{background:linear-gradient(135deg,#85BC25,#6a9a1d);color:#0d1b0a}
#lpGate .b.p:hover{filter:brightness(1.08);transform:translateY(-1px)}
#lpGate .b.g{background:rgba(255,255,255,.08);color:#a8bccd;border:1px solid rgba(255,255,255,.12)}
#lpGate .b.g:hover{color:#fff}
#lpGate .f{margin-top:26px;font-size:10.5px;color:#3d4854;line-height:1.7}`;

  function ensureGate() {
    let g = document.getElementById('lpGate');
    if (g) return g;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    g = document.createElement('div'); g.id = 'lpGate';
    g.innerHTML = `<div class="c"><div class="spin" id="lpSpin"></div><div class="t">LORANG <b id="lpApp"></b></div><div class="s" id="lpMsg">VÃ©rification de l'accÃ¨sâ€¦</div><div class="btns" id="lpBtns" style="display:none"><a class="b p" id="lpOpenSc" href="${PORTAL_URL}/">Ouvrir LORANG Service Center</a><button class="b g" type="button" id="lpRetry">RÃ©essayer</button></div><div class="f">AccÃ¨s rÃ©servÃ© aux comptes Microsoft Lorang â€” identification via LORANG Service Center.</div></div>`;
    (document.body || document.documentElement).appendChild(g);
    if (!document.body) document.addEventListener('DOMContentLoaded', () => { if (g.parentNode !== document.body && document.getElementById('lpGate')) document.body.appendChild(g); });
    g.querySelector('#lpRetry').onclick = () => { S.error = null; try { sessionStorage.removeItem(TRIED_KEY); } catch (e) {} setGate('VÃ©rification de lâ€™accÃ¨sâ€¦'); init(S.opts).catch(() => {}); };
    return g;
  }
  function setGate(msg, err) {
    const g = ensureGate(); g.classList.remove('hide');
    g.querySelector('#lpApp').textContent = (S.app || '').toUpperCase();
    const m = g.querySelector('#lpMsg'); m.textContent = msg || ''; m.className = 's' + (err ? ' err' : '');
    g.querySelector('#lpSpin').style.display = err ? 'none' : '';
    g.querySelector('#lpBtns').style.display = err ? '' : 'none';
    if (err) { const sc = g.querySelector('#lpOpenSc'); sc.href = PORTAL_URL + '/?from=' + encodeURIComponent(S.app || ''); }
  }
  function hideGate() { const g = document.getElementById('lpGate'); if (g) { g.classList.add('hide'); setTimeout(() => g.remove(), 500); } }

  /* â”€â”€ indice SSO transmis par le Service Center (#sso=<e-mail>) â”€â”€ */
  function takeHint() {
    let hint = null;
    try {
      let h = location.hash || '';
      const m = h.match(/[#&]sso=([^&]+)/);
      const t = h.match(/[#&]lt=([^&]+)/);
      if (m) hint = decodeURIComponent(m[1]);
      if (t) sessionStorage.setItem(TICKET_KEY, decodeURIComponent(t[1]));
      if (m || t) { const rest = h.replace(/[#&]sso=[^&]+/, '').replace(/[#&]lt=[^&]+/, '').replace(/^&/, '#'); history.replaceState(null, '', location.pathname + location.search + (rest.length > 1 ? rest : '')); }
      if (hint) sessionStorage.setItem(HINT_KEY, hint); else hint = sessionStorage.getItem(HINT_KEY);
    } catch (e) {}
    return hint;
  }
  const getStore = k => { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } };
  function goToServiceCenter(reason) {
    /* accÃ¨s coupÃ© : LORANG Service Center est le seul point d'entrÃ©e â€” aucune relance automatique de l'appli */
    setGate(reason || 'AccÃ¨s refusÃ© â€” LORANG Service Center est le seul point dâ€™entrÃ©e des applications Lorang. Redirectionâ€¦');
    const url = PORTAL_URL + '/';
    setTimeout(() => location.replace(url), 400);
    return new Promise(() => {}); /* la page part */
  }

  const decodeJwt = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; } };

  /* â”€â”€ passeport (jeton d'identitÃ©) â”€â”€ */
  async function idToken(force) {
    if (!S.msal || !S.account) throw new Error('non connectÃ©');
    const req = { scopes: OIDC_SCOPES, account: S.account, forceRefresh: !!force };
    let r = await S.msal.acquireTokenSilent(req);
    const p = r && r.idToken ? decodeJwt(r.idToken) : null;
    if (!force && (!p || !p.exp || p.exp * 1000 - Date.now() < 5 * 60e3)) { r = await S.msal.acquireTokenSilent(Object.assign({}, req, { forceRefresh: true })); }
    if (!r || !r.idToken) throw new Error('passeport indisponible');
    return r.idToken;
  }

  async function checkPortal() {
    const t = await idToken(false);
    /* requÃªte Â« simple Â» (text/plain, sans en-tÃªte personnalisÃ©) : pas de prÃ©-vol CORS, la plateforme Azure
       rÃ©pondant elle-mÃªme aux OPTIONS sans relayer nos en-tÃªtes */
    const ticket = getStore(TICKET_KEY), session = getStore(SESSION_KEY);
    const res = await fetch(PORTAL_URL + '/api/portal/me', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ token: t, app: S.app }, ticket ? { ticket } : { session })), cache: 'no-store' });
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok) { const err = new Error((j && j.error) || ('Service Center injoignable (HTTP ' + res.status + ')')); err.code = j && j.code; throw err; }
    try { sessionStorage.removeItem(TICKET_KEY); if (j.session) sessionStorage.setItem(SESSION_KEY, j.session); } catch (e) {}
    return j;
  }

  /* â”€â”€ initialisation â”€â”€ */
  async function init(opts) {
    opts = opts || {}; S.opts = opts; S.app = opts.app || S.app || 'app';
    if (typeof msal === 'undefined') { setGate('Librairie Microsoft (MSAL) non chargÃ©e.', true); throw new Error('msal absent'); }
    setGate('VÃ©rification de lâ€™accÃ¨sâ€¦');
    try {
      if (!S.msal) {
        S.msal = opts.msal || new msal.PublicClientApplication({ auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri: location.origin }, cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false } });
        if (!opts.msal) await S.msal.initialize();
        const rr = await S.msal.handleRedirectPromise().catch(() => null);
        if (rr && rr.account) S.account = rr.account;
      }
      const hint = takeHint();
      if (!getStore(TICKET_KEY) && !getStore(SESSION_KEY)) { await goToServiceCenter(); }
      if (!S.account) {
        const accs = S.msal.getAllAccounts();
        S.account = (hint && accs.find(a => (a.username || '').toLowerCase() === hint.toLowerCase())) || accs[0] || null;
      }
      if (!S.account && hint) {
        try {
          const sr = await S.msal.ssoSilent({ scopes: OIDC_SCOPES, loginHint: hint, redirectUri: location.origin + '/auth.html' });
          if (sr && sr.account) S.account = sr.account;
        } catch (e) { console.warn('[portal] SSO silencieux refusÃ© :', e && (e.errorCode || e.message)); }
      }
      if (!S.account) {
        /* dernier recours silencieux : aller-retour Microsoft sans interaction (prompt=none), une seule fois par session */
        let tried = false; try { tried = sessionStorage.getItem(TRIED_KEY) === '1'; } catch (e) {}
        if (!tried) {
          try { sessionStorage.setItem(TRIED_KEY, '1'); } catch (e) {}
          setGate('Reconnaissance de la session Microsoftâ€¦');
          await S.msal.loginRedirect({ scopes: OIDC_SCOPES, prompt: 'none', loginHint: hint || undefined, redirectUri: location.origin });
          await new Promise(() => {}); /* la page est en cours de redirection */
        }
        await goToServiceCenter();
      }
      try { sessionStorage.removeItem(TRIED_KEY); } catch (e) {}
      if (S.msal.setActiveAccount) S.msal.setActiveAccount(S.account);
      let me;
      try { me = await checkPortal(); }
      catch (e) { if (e && e.code === 'ticket') { try { sessionStorage.removeItem(SESSION_KEY); } catch (x) {} await goToServiceCenter(); } throw e; }
      S.user = me.user; S.apps = me.apps || []; S.aiAvailable = !!me.ai; S.ready = true; S.error = null;
      hideGate();
      S.listeners.forEach(fn => { try { fn(S.user); } catch (e) { console.error(e); } });
      if (opts.onReady) opts.onReady(S.user, S);
      return S.user;
    } catch (e) {
      S.error = e; S.ready = false;
      const msg = e && e.message ? e.message : String(e);
      setGate((e && e.noSession) ? msg : ('AccÃ¨s refusÃ© â€” ' + msg), true);
      console.warn('[portal] accÃ¨s refusÃ© :', msg);
      if (opts.onDenied) opts.onDenied(e);
      throw e;
    }
  }

  /* â”€â”€ relais IA (clÃ© unique cÃ´tÃ© Service Center) â”€â”€ */
  async function ai(payload) {
    if (!S.ready) throw new Error('portail non initialisÃ©');
    const t = await idToken(false);
    const body = Object.assign({}, payload || {});
    if (!body.messages && body.user) { body.messages = [{ role: 'user', content: String(body.user) }]; delete body.user; }
    const res = await fetch(PORTAL_URL + '/api/portal/ai', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: t, app: S.app, session: getStore(SESSION_KEY), payload: body }) });
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || ('relais IA indisponible (HTTP ' + res.status + ')'));
    return j.text;
  }

  /* â”€â”€ utilitaire pour le Service Center : ajoute l'indice SSO aux liens des applis â”€â”€ */
  function withSso(url, upn, ticket) {
    if (!url) return url;
    const parts = []; if (ticket) parts.push('lt=' + encodeURIComponent(ticket)); if (upn) parts.push('sso=' + encodeURIComponent(upn));
    return parts.length ? url + (url.includes('#') ? '&' : '#') + parts.join('&') : url;
  }

  /* â”€â”€ garde universelle (Ã  placer dans <head>, avant le code de l'application) â”€â”€
     Synchrone : sans billet ni session, la page est masquÃ©e et renvoyÃ©e vers le Service Center
     avant mÃªme que l'application ne dÃ©marre ; sinon la porte reste affichÃ©e jusqu'Ã  la
     vÃ©rification du passeport (init au DOMContentLoaded, quand MSAL est chargÃ©). */
  function guard(opts) {
    opts = opts || {}; S.app = opts.app || S.app || 'app';
    takeHint();
    if (!getStore(TICKET_KEY) && !getStore(SESSION_KEY)) { goToServiceCenter(); return false; }
    setGate('VÃ©rification de lâ€™accÃ¨sâ€¦');
    const run = () => { init(Object.assign({ msal: (typeof msal !== 'undefined' && opts.msal) || undefined }, opts)).catch(() => {}); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(run, 0)); else setTimeout(run, 0);
    return true;
  }

  global.LorangPortal = {
    init, ai, idToken, withSso, guard,
    get user() { return S.user; }, get account() { return S.account; }, get msal() { return S.msal; }, get ready() { return S.ready; }, get aiAvailable() { return !!S.aiAvailable; },
    onReady(fn) { if (S.ready) fn(S.user); else S.listeners.push(fn); },
    PORTAL_URL,
  };
})(window);

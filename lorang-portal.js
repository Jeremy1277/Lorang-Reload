/* ═══════════════════════════════════════════════════════════════════════════
   LORANG PORTAL — porte d'accès unique des applications Lorang
   ───────────────────────────────────────────────────────────────────────────
   Toute application Lorang ne s'ouvre que si l'utilisateur est identifié dans
   LORANG Service Center (compte Microsoft du tenant Lorang, app Topo3PL).

   Fonctionnement
   1. L'application appelle LorangPortal.init({ app:'turnover', msal: instanceMsal? })
      avant d'afficher quoi que ce soit (une porte plein écran couvre la page).
   2. Le portail récupère silencieusement le passeport (jeton d'identité Microsoft) :
      compte déjà connu dans ce navigateur, sinon SSO silencieux grâce à l'indice
      « #sso=<e-mail> » ajouté par le Service Center quand il lance l'application.
   3. Le passeport (et le billet de lancement « #lt=… » quand on vient du Service Center)
      sont présentés à /api/portal/me → la porte s'efface et une session d'appli (10 h,
      partagée entre les onglets de ce navigateur) est mémorisée.
      Sans compte Microsoft connu : aller-retour silencieux vers Microsoft (prompt=none), puis
      connexion Microsoft classique — jamais de renvoi en boucle vers le Service Center.
      (Le serveur peut réexiger le billet : variable PORTAL_STRICT=1 côté Service Center.)
   4. LorangPortal.ai({ system, user | messages, max_tokens }) relaie vers Claude
      via Service Center (/api/portal/ai) : une seule clé API, côté Service Center.

   v3.2 — septembre 2026 · Dépendance : msal-browser 2.x, chargé avant OU après ce script
   (l'ordre des balises <script> n'a plus d'importance : voir « guet MSAL » plus bas).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const PORTAL_URL = 'https://ambitious-flower-0eaea7810.7.azurestaticapps.net';
  const CLIENT_ID = '56ae2586-8bb0-48a9-afd5-cb7a6bf12cc3';
  const AUTHORITY = 'https://login.microsoftonline.com/08978fe5-0eb9-4b54-8f3d-dc0653f6dffa';
  const OIDC_SCOPES = ['openid', 'profile', 'email'];
  const HINT_KEY = 'lorang-portal-hint';        /* localStorage : e-mail du compte (indice SSO) */
  const TRIED_KEY = 'lorang-portal-tried';      /* sessionStorage : aller-retour prompt=none déjà tenté */
  const TRIED2_KEY = 'lorang-portal-tried2';    /* sessionStorage : connexion interactive déjà lancée */
  const TICKET_KEY = 'lorang-portal-ticket';    /* sessionStorage : billet de lancement (transitoire) */
  const SESSION_PFX = 'lorang-portal-session:'; /* localStorage : session d'appli, partagée entre onglets */
  const SESSION_TTL_MS = 10 * 3600e3;

  const S = { app: '', msal: null, account: null, user: null, ready: false, error: null, listeners: [], pending: null, ownMsal: false };

  /* ── porte plein écran ── */
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
    g.innerHTML = `<div class="c"><div class="spin" id="lpSpin"></div><div class="t">LORANG <b id="lpApp"></b></div><div class="s" id="lpMsg">Vérification de l'accès…</div><div class="btns" id="lpBtns" style="display:none"><button class="b p" type="button" id="lpLogin">Se connecter avec Microsoft</button><a class="b g" id="lpOpenSc" href="${PORTAL_URL}/">Ouvrir LORANG Service Center</a><button class="b g" type="button" id="lpRetry">Réessayer</button></div><div class="f">Accès réservé aux comptes Microsoft Lorang — identification via LORANG Service Center.</div></div>`;
    (document.body || document.documentElement).appendChild(g);
    if (!document.body) document.addEventListener('DOMContentLoaded', () => { if (g.parentNode !== document.body && document.getElementById('lpGate')) document.body.appendChild(g); });
    g.querySelector('#lpRetry').onclick = () => { S.error = null; S.pending = null; try { sessionStorage.removeItem(TRIED_KEY); sessionStorage.removeItem(TRIED2_KEY); } catch (e) {} setGate('Vérification de l’accès…'); init(S.opts).catch(() => {}); };
    g.querySelector('#lpLogin').onclick = () => { interactiveLogin(); };
    return g;
  }
  function setGate(msg, err) {
    const g = ensureGate(); g.classList.remove('hide');
    g.querySelector('#lpApp').textContent = (S.app || '').toUpperCase();
    const m = g.querySelector('#lpMsg'); m.textContent = msg || ''; m.className = 's' + (err ? ' err' : '');
    g.querySelector('#lpSpin').style.display = err ? 'none' : '';
    g.querySelector('#lpBtns').style.display = err ? '' : 'none';
    if (err) { const sc = g.querySelector('#lpOpenSc'); sc.href = PORTAL_URL + '/?open=' + encodeURIComponent(S.app || ''); }
  }
  function hideGate() { const g = document.getElementById('lpGate'); if (g) { g.classList.add('hide'); setTimeout(() => g.remove(), 500); } }

  /* ── indice SSO et billet transmis par le Service Center (#sso=<e-mail>&lt=<billet>) ── */
  const ls = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const ss = { get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }, del(k) { try { sessionStorage.removeItem(k); } catch (e) {} } };
  function takeHint() {
    let hint = null;
    try {
      const h = location.hash || '';
      const m = h.match(/[#&]sso=([^&]+)/);
      const t = h.match(/[#&]lt=([^&]+)/);
      if (m) hint = decodeURIComponent(m[1]);
      if (t) ss.set(TICKET_KEY, decodeURIComponent(t[1]));
      if (m || t) { const rest = h.replace(/[#&]sso=[^&]+/, '').replace(/[#&]lt=[^&]+/, '').replace(/^&/, '#'); history.replaceState(null, '', location.pathname + location.search + (rest.length > 1 ? rest : '')); }
      if (hint) ls.set(HINT_KEY, hint); else hint = ls.get(HINT_KEY);
    } catch (e) {}
    return hint;
  }
  /* session d'appli : partagée entre les onglets du navigateur, expirée localement avant le serveur */
  function sessionGet() {
    try { const o = JSON.parse(ls.get(SESSION_PFX + S.app) || 'null'); if (o && o.v && o.exp > Date.now()) return o.v; } catch (e) {}
    return '';
  }
  function sessionSet(v) { ls.set(SESSION_PFX + S.app, JSON.stringify({ v, exp: Date.now() + SESSION_TTL_MS - 5 * 60e3 })); }
  function sessionDel() { ls.del(SESSION_PFX + S.app); }
  function goToServiceCenter(reason) {
    setGate(reason || 'LORANG Service Center va vous identifier, puis rouvrir cette application…');
    const url = PORTAL_URL + '/?open=' + encodeURIComponent(S.app || '');
    setTimeout(() => location.replace(url), 400);
    return new Promise(() => {}); /* la page part */
  }
  const inIframe = () => { try { return window.top !== window.self; } catch (e) { return true; } };

  /* page de retour dédiée aux flux silencieux : l'iframe MSAL doit atterrir sur une page légère
     qui rend le hash au parent — jamais sur index.html, qui rechargerait toute l'application */
  const AUTH_URI = () => location.origin + '/auth.html';
  const decodeJwt = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; } };

  const MSAL_CFG = {
    auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri: location.origin, navigateToLoginRequestUrl: false },
    /* storeAuthStateInCookie : indispensable quand le navigateur bloque les cookies tiers */
    cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: true },
    /* iframes de renouvellement : 6 s par défaut, trop court sur un réseau d'entreprise */
    system: { iframeHashTimeout: 20000, loadFrameTimeout: 20000, windowHashTimeout: 20000, navigateFrameWait: 500 },
  };
  /* ── UNE SEULE instance MSAL par page ────────────────────────────────────────
     Chaque application crée historiquement la sienne (`new msal.PublicClientApplication(...)`).
     Deux instances sur la même page = deux `handleRedirectPromise()` concurrents : celle qui perd
     la course ne voit aucun compte et relance une connexion — d'où les « choisir un compte »
     inattendus et les portes qui restent fermées alors que la session est valide.
     On installe donc une fabrique qui renvoie toujours l'instance du portail, configurée pour le
     renouvellement silencieux, et on rend `initialize()` / `handleRedirectPromise()` idempotents. */
  function sharedMsal(Orig) {
    if (S.msal) return S.msal;
    const Ctor = Orig || msal.__lorangOriginal || msal.PublicClientApplication;
    const m = new Ctor(MSAL_CFG);
    if (typeof m.initialize === 'function') { const f = m.initialize.bind(m); m.initialize = () => (S.initP || (S.initP = f())); }
    else m.initialize = () => Promise.resolve();
    const h = m.handleRedirectPromise.bind(m);
    m.handleRedirectPromise = hash => (S.hrpP || (S.hrpP = h(hash)));
    /* les flux silencieux (iframe cachée) doivent atterrir sur /auth.html : sur la racine, l'iframe
       recharge toute l'application et MSAL abandonne au bout du délai (« timed_out ») */
    ['acquireTokenSilent', 'ssoSilent'].forEach(k => {
      if (typeof m[k] !== 'function') return;
      const f = m[k].bind(m);
      m[k] = req => f(Object.assign({ redirectUri: AUTH_URI() }, req || {}, (req && req.redirectUri) ? { redirectUri: req.redirectUri } : {}));
    });
    S.msal = m;
    return m;
  }
  function installSharedMsal() {
    if (typeof msal === 'undefined' || !msal || msal.__lorangShared) return;
    const Orig = msal.PublicClientApplication;
    if (typeof Orig !== 'function') return;
    const factory = function () { return sharedMsal(Orig); };
    factory.prototype = Orig.prototype;
    try { msal.PublicClientApplication = factory; msal.__lorangOriginal = Orig; msal.__lorangShared = true; }
    catch (e) { console.warn('[portal] instance MSAL partagée indisponible :', e && e.message); }
  }
  /* ── ordre de chargement indifférent ─────────────────────────────────────────
     Certaines applications embarquent la bibliothèque MSAL APRÈS ce script (Fleet, Order,
     Analyse : le bundle est inclus dans la page elle-même). Dans ce cas `msal` n'existe pas
     encore ici et la fabrique ne peut pas être posée ; l'application crée alors une deuxième
     instance et la porte reste fermée. On pose donc un guet sur `window.msal`, puis sur
     `msal.PublicClientApplication`, pour installer la fabrique dès que la bibliothèque arrive. */
  function watchMsal() {
    let box;
    try {
      Object.defineProperty(global, 'msal', {
        configurable: true,
        get() { return box; },
        set(v) {
          box = v;
          try {
            if (!v || v.__lorangShared) return;
            if (typeof v.PublicClientApplication === 'function') { installSharedMsal(); return; }
            let Ctor;
            Object.defineProperty(v, 'PublicClientApplication', {
              configurable: true,
              get() { return Ctor; },
              set(C) {
                Ctor = C;
                try { delete v.PublicClientApplication; v.PublicClientApplication = C; installSharedMsal(); }
                catch (e) {}
              },
            });
          } catch (e) {}
        },
      });
    } catch (e) { console.warn('[portal] guet MSAL indisponible :', e && e.message); }
  }
  try { if (typeof msal === 'undefined') watchMsal(); else installSharedMsal(); } catch (e) {}

  /* ── passeport (jeton d'identité) ── */
  const RETRYABLE = /timed_out|monitor_window_timeout|token_renewal_error|no_tokens_found|invalid_grant|interaction_required|login_required|consent_required/i;
  async function silentToken(req) {
    try { return await S.msal.acquireTokenSilent(req); }
    catch (e) {
      const code = (e && (e.errorCode || e.message)) || '';
      if (!RETRYABLE.test(code)) throw e;
      console.warn('[portal] renouvellement silencieux en échec (' + code + ') — nouvelle tentative');
      return S.msal.acquireTokenSilent(Object.assign({}, req, { forceRefresh: true }));
    }
  }
  async function idToken(force) {
    if (!S.msal || !S.account) throw new Error('non connecté');
    const req = { scopes: OIDC_SCOPES, account: S.account, forceRefresh: !!force, redirectUri: AUTH_URI() };
    let r = await silentToken(req);
    const p = r && r.idToken ? decodeJwt(r.idToken) : null;
    if (!force && (!p || !p.exp || p.exp * 1000 - Date.now() < 5 * 60e3)) r = await silentToken(Object.assign({}, req, { forceRefresh: true }));
    if (!r || !r.idToken) throw new Error('passeport indisponible');
    return r.idToken;
  }

  /* ── vérification auprès du Service Center ── */
  async function checkPortal() {
    const t = await idToken(false);
    const ticket = ss.get(TICKET_KEY), session = sessionGet();
    const body = { token: t, app: S.app };
    if (ticket) body.ticket = ticket; else if (session) body.session = session;
    /* requête « simple » (text/plain) : pas de pré-vol CORS */
    const res = await fetch(PORTAL_URL + '/api/portal/me', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), cache: 'no-store' });
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok) { const err = new Error((j && j.error) || ('Service Center injoignable (HTTP ' + res.status + ')')); err.code = j && j.code; err.status = res.status; throw err; }
    ss.del(TICKET_KEY); if (j.session) sessionSet(j.session);
    return j;
  }

  /* ── compte Microsoft : cache → retour de redirection → aller-retour silencieux ── */
  async function acquireAccount(hint) {
    let rr = null, redirectErr = null;
    try { rr = await S.msal.handleRedirectPromise(); } catch (e) { redirectErr = e; }
    if (rr && rr.account) return rr.account;
    const accs = S.msal.getAllAccounts();
    const found = (hint && accs.find(a => (a.username || '').toLowerCase() === hint.toLowerCase())) || accs[0] || null;
    if (found) return found;
    if (redirectErr) console.warn('[portal] retour Microsoft :', redirectErr.errorCode || redirectErr.message);
    /* 1er passage : aller-retour Microsoft sans interaction (redirection plein écran, fonctionne
       même quand les cookies tiers sont bloqués) */
    if (!ss.get(TRIED_KEY)) {
      ss.set(TRIED_KEY, '1');
      setGate('Reconnaissance de votre session Microsoft…');
      await S.msal.loginRedirect({ scopes: OIDC_SCOPES, prompt: 'none', loginHint: hint || undefined, redirectUri: location.origin });
      await new Promise(() => {});
    }
    /* 2e passage : Microsoft a demandé une interaction (session expirée, MFA…) → connexion
       classique, une seule fois par onglet ; avec un poste Lorang déjà connecté, elle est instantanée */
    if (!ss.get(TRIED2_KEY)) {
      ss.set(TRIED2_KEY, '1');
      setGate('Connexion Microsoft…');
      await S.msal.loginRedirect({ scopes: OIDC_SCOPES, loginHint: hint || undefined, redirectUri: location.origin });
      await new Promise(() => {});
    }
    return null;
  }
  function interactiveLogin() {
    if (!S.msal) { location.href = PORTAL_URL + '/?open=' + encodeURIComponent(S.app || ''); return; }
    setGate('Connexion Microsoft…');
    ss.del(TRIED_KEY); ss.set(TRIED2_KEY, '1');
    S.msal.loginRedirect({ scopes: OIDC_SCOPES, loginHint: ls.get(HINT_KEY) || undefined, prompt: 'select_account', redirectUri: location.origin }).catch(e => setGate('Connexion impossible — ' + (e.errorCode || e.message), true));
  }

  /* ── initialisation (idempotente : guard() et init() partagent la même promesse) ── */
  function init(opts) {
    if (inIframe()) return Promise.resolve(null);
    if (S.pending) return S.pending;
    S.pending = initOnce(opts || {}).catch(e => { S.pending = null; throw e; });
    return S.pending;
  }
  async function initOnce(opts) {
    S.opts = opts; S.app = opts.app || S.app || 'app';
    if (typeof msal === 'undefined') { setGate('Librairie Microsoft (MSAL) non chargée.', true); throw new Error('msal absent'); }
    setGate('Vérification de l’accès…');
    try {
      installSharedMsal();
      /* opts.msal est ignoré : l'instance du portail est celle que l'application a reçue elle aussi */
      if (!S.msal) sharedMsal();
      await S.msal.initialize();
      const hint = takeHint();
      S.account = await acquireAccount(hint);
      if (!S.account) {
        const err = new Error('Connexion Microsoft requise pour ouvrir cette application.'); err.noSession = true; throw err;
      }
      ss.del(TRIED_KEY); ss.del(TRIED2_KEY);
      if (S.msal.setActiveAccount) S.msal.setActiveAccount(S.account);
      if (!ls.get(HINT_KEY) && S.account.username) ls.set(HINT_KEY, S.account.username);
      let me;
      try { me = await checkPortal(); }
      catch (e) {
        if (e && e.code === 'ticket') {
          /* billet ou session refusés par le serveur : on retente une fois sans (le serveur accepte
             le passeport seul, sauf mode strict → il renvoie alors vers le Service Center) */
          sessionDel(); ss.del(TICKET_KEY);
          try { me = await checkPortal(); }
          catch (e2) { if (e2 && e2.code === 'ticket') { await goToServiceCenter(); } throw e2; }
        } else throw e;
      }
      S.user = me.user; S.apps = me.apps || []; S.aiAvailable = !!me.ai; S.ready = true; S.error = null;
      hideGate();
      S.listeners.forEach(fn => { try { fn(S.user); } catch (e) { console.error(e); } });
      if (opts.onReady) opts.onReady(S.user, S);
      return S.user;
    } catch (e) {
      S.error = e; S.ready = false;
      const msg = e && e.message ? e.message : String(e);
      const timedOut = /timed_out|monitor_window_timeout|token_renewal/i.test(msg);
      setGate(e && e.noSession ? msg
        : timedOut ? 'Session Microsoft non renouvelée à temps. Cliquez sur « Se connecter avec Microsoft ».'
        : ('Accès refusé — ' + msg), true);
      console.warn('[portal] accès refusé :', msg);
      if (opts.onDenied) opts.onDenied(e);
      throw e;
    }
  }

  /* ── relais IA (clé unique côté Service Center) ── */
  async function ai(payload) {
    if (!S.ready) throw new Error('portail non initialisé');
    const t = await idToken(false);
    const body = Object.assign({}, payload || {});
    if (!body.messages && body.user) { body.messages = [{ role: 'user', content: String(body.user) }]; delete body.user; }
    const res = await fetch(PORTAL_URL + '/api/portal/ai', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: t, app: S.app, session: sessionGet(), payload: body }) });
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || ('relais IA indisponible (HTTP ' + res.status + ')'));
    return j.text;
  }

  /* ── utilitaire pour le Service Center : ajoute billet + indice SSO aux liens des applis ── */
  function withSso(url, upn, ticket) {
    if (!url) return url;
    const parts = []; if (ticket) parts.push('lt=' + encodeURIComponent(ticket)); if (upn) parts.push('sso=' + encodeURIComponent(upn));
    return parts.length ? url + (url.includes('#') ? '&' : '#') + parts.join('&') : url;
  }

  /* ── garde universelle (à placer dans <head>, avant le code de l'application) ──
     Masque la page derrière la porte et lance la vérification dès que MSAL est chargé.
     Jamais exécutée dans une iframe (renouvellement silencieux MSAL). */
  function guard(opts) {
    if (inIframe()) return false;
    opts = opts || {}; S.app = opts.app || S.app || 'app';
    takeHint();
    setGate('Vérification de l’accès…');
    const run = () => { init(Object.assign({ msal: (typeof msal !== 'undefined' && opts.msal) || undefined }, opts)).catch(() => {}); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(run, 0)); else setTimeout(run, 0);
    return true;
  }

  global.LorangPortal = {
    init, ai, idToken, withSso, guard, login: interactiveLogin,
    get user() { return S.user; }, get account() { return S.account; }, get msal() { return S.msal; }, get ready() { return S.ready; }, get aiAvailable() { return !!S.aiAvailable; },
    onReady(fn) { if (S.ready) fn(S.user); else S.listeners.push(fn); },
    PORTAL_URL,
  };
})(window);

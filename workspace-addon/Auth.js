// Sign-in against kinsy.ai: authorization code with PKCE, no client secret.
// Tokens live in the user's own property store (per Google account, per
// script) and never reach the sidebar.

function redirectUri_() {
  return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
}

function props_() {
  return PropertiesService.getUserProperties();
}

function signedIn_() {
  return !!props_().getProperty(KINSY.P_ACCESS);
}

function clearTokens_() {
  var p = props_();
  p.deleteProperty(KINSY.P_ACCESS);
  p.deleteProperty(KINSY.P_REFRESH);
  p.deleteProperty(KINSY.P_LAST_SAVE);
}

function query_(params) {
  return Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

// The link the person follows to sign in. The state token is signed by
// Google and bound to this person and this script; the PKCE verifier waits
// in their cache under a nonce carried inside that token.
function authUrl_() {
  var nonce = Utilities.getUuid();
  var verifier = (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  CacheService.getUserCache().put('pkce:' + nonce, verifier, KINSY.SIGN_IN_SECONDS);
  var state = ScriptApp.newStateToken()
    .withMethod('authCallback')
    .withArgument('n', nonce)
    .withTimeout(KINSY.SIGN_IN_SECONDS)
    .createToken();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, verifier, Utilities.Charset.US_ASCII);
  var challenge = Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
  return KINSY.AUTHORIZE_URL + '?' + query_({
    response_type: 'code',
    client_id: KINSY.CLIENT_ID,
    redirect_uri: redirectUri_(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'decks',
    state: state
  });
}

// POST to the token or revoke endpoint. Returns {status, body}; body is {}
// when the reply is not JSON.
function oauthPost_(url, form) {
  form.client_id = KINSY.CLIENT_ID;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: form,
    muteHttpExceptions: true,
    followRedirects: false
  });
  var body = {};
  try {
    body = JSON.parse(res.getContentText()) || {};
  } catch (e) {
    body = {};
  }
  return { status: res.getResponseCode(), body: body };
}

function storeTokens_(body) {
  if (typeof body.access_token !== 'string' || !body.access_token) return false;
  var p = props_();
  p.setProperty(KINSY.P_ACCESS, body.access_token);
  if (typeof body.refresh_token === 'string' && body.refresh_token) {
    p.setProperty(KINSY.P_REFRESH, body.refresh_token);
  } else {
    p.deleteProperty(KINSY.P_REFRESH);
  }
  return true;
}

function callbackPage_(ok) {
  var t = HtmlService.createTemplateFromFile('Callback');
  t.heading = ok ? "You're signed in" : "Sign-in didn't finish";
  t.detail = ok
    ? 'You can close this tab and go back to your document.'
    : 'Close this tab, go back to your document and press Sign in again.';
  return t.evaluate().setTitle('Kinsy');
}

// Where kinsy.ai sends the person back to. Apps Script has already checked
// the state token (signature, user, expiry) before calling this.
function authCallback(e) {
  var q = (e && e.parameter) || {};
  var cache = CacheService.getUserCache();
  var key = 'pkce:' + String(q.n || '');
  var verifier = q.n ? cache.get(key) : null;
  if (verifier) cache.remove(key);
  if (q.error || !q.code || !verifier) return callbackPage_(false);
  var out;
  try {
    out = oauthPost_(KINSY.TOKEN_URL, {
      grant_type: 'authorization_code',
      code: String(q.code),
      code_verifier: verifier,
      redirect_uri: redirectUri_()
    });
  } catch (err) {
    return callbackPage_(false);
  }
  return callbackPage_(out.status === 200 && storeTokens_(out.body));
}

// Refresh tokens rotate, so two calls refreshing at once would end the
// grant. One at a time per person; whoever comes second uses the first
// one's result.
function refresh_(staleAccess) {
  var lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    throw fail_('server', 'Kinsy is busy. Try again in a moment.');
  }
  try {
    var p = props_();
    var current = p.getProperty(KINSY.P_ACCESS);
    if (current && current !== staleAccess) return current;
    var refresh = p.getProperty(KINSY.P_REFRESH);
    if (!refresh) {
      clearTokens_();
      throw fail_('auth', 'Your sign-in has expired. Sign in again.');
    }
    var out;
    try {
      out = oauthPost_(KINSY.TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refresh });
    } catch (err) {
      throw fail_('server', 'Kinsy could not be reached. Check your connection and try again.');
    }
    if (out.status === 200 && storeTokens_(out.body)) return out.body.access_token;
    if (out.status === 400 || out.status === 401) {
      clearTokens_();
      throw fail_('auth', 'Your sign-in has expired. Sign in again.');
    }
    throw fail_('server', 'Kinsy could not be reached. Check your connection and try again.');
  } finally {
    lock.releaseLock();
  }
}

// Called from the sidebar. Ends the grant at Kinsy (best effort) and
// forgets the tokens.
function signOut() {
  var refresh = props_().getProperty(KINSY.P_REFRESH);
  var access = props_().getProperty(KINSY.P_ACCESS);
  clearTokens_();
  try {
    if (refresh || access) oauthPost_(KINSY.REVOKE_URL, { token: refresh || access });
  } catch (e) {
    // The tokens are gone from here either way.
  }
  return { ok: true };
}

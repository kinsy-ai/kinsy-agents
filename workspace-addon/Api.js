// The add-on's client for Kinsy's public /v1 API. The bearer token is added
// here and nowhere else, and only for kinsy.ai.

var API_KIND_ = { 401: 'auth', 402: 'credits', 429: 'busy' };

function kindFor_(status) {
  return API_KIND_[status] || (status >= 500 ? 'server' : 'invalid');
}

function kinsyFetch_(method, url, body, access, idempotencyKey) {
  if (url.indexOf(KINSY.ORIGIN + '/') !== 0) throw fail_('invalid', 'Refusing to call an address outside kinsy.ai.');
  var params = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + access,
      'X-Kinsy-Client': 'gws-addon/' + KINSY.VERSION
    },
    muteHttpExceptions: true,
    followRedirects: false
  };
  if (idempotencyKey) params.headers['Idempotency-Key'] = idempotencyKey;
  if (body !== undefined && body !== null) {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(body);
  }
  try {
    return UrlFetchApp.fetch(url, params);
  } catch (e) {
    throw fail_('server', 'Kinsy could not be reached. Check your connection and try again.');
  }
}

// One call to /v1. A 401 gets one refresh and one retry.
function kinsy_(method, path, body, idempotencyKey) {
  var access = props_().getProperty(KINSY.P_ACCESS);
  if (!access) throw fail_('auth', 'Sign in to Kinsy to continue.');
  var url = KINSY.API + path;
  var res = kinsyFetch_(method, url, body, access, idempotencyKey);
  if (res.getResponseCode() === 401) {
    access = refresh_(access);
    res = kinsyFetch_(method, url, body, access, idempotencyKey);
  }
  var status = res.getResponseCode();
  var data = {};
  try {
    data = JSON.parse(res.getContentText()) || {};
  } catch (e) {
    data = {};
  }
  if (status >= 200 && status < 300) return data;
  if (status === 401) {
    clearTokens_();
    throw fail_('auth', 'Your sign-in has expired. Sign in again.');
  }
  var message = data && data.error && typeof data.error.message === 'string'
    ? data.error.message
    : 'Request failed (' + status + ').';
  throw fail_(kindFor_(status), message);
}

function validDeckId_(deckId) {
  if (typeof deckId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(deckId)) {
    throw fail_('invalid', 'That deck could not be found.');
  }
  return deckId;
}

// The key makes a repeated submission (a second click, a retry after a
// timeout) return the first deck instead of building and charging again.
function createDeck_(brief, slides, sources, idempotencyKey) {
  return kinsy_('post', '/decks', { brief: brief, slides: slides, sources: sources }, idempotencyKey);
}

function deckStatus_(deckId) {
  return kinsy_('get', '/decks/' + validDeckId_(deckId), null);
}

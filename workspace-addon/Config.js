// Kinsy for Google Slides and Docs: fixed addresses. The add-on is a public
// OAuth client identified by its metadata document; Kinsy fetches that
// document and holds the add-on to the one redirect listed there (this
// script's own callback).
var KINSY = {
  VERSION: '1.0.0',
  ORIGIN: 'https://kinsy.ai',
  API: 'https://kinsy.ai/v1',
  CLIENT_ID: 'https://kinsy.ai/workspace-addon/oauth-client.json',
  AUTHORIZE_URL: 'https://kinsy.ai/oauth/authorize',
  TOKEN_URL: 'https://kinsy.ai/api/oauth/token',
  REVOKE_URL: 'https://kinsy.ai/api/oauth/revoke',
  PRICING_URL: 'https://kinsy.ai/pricing?src=gws-addon',
  DOWNLOAD_PREFIX: 'https://storage.googleapis.com/',
  UPLOAD_URL: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
  UPLOAD_PREFIX: 'https://www.googleapis.com/upload/drive/v3/files',
  SLIDES_MIME: 'application/vnd.google-apps.presentation',
  PPTX_MIME: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  MAX_PPTX_BYTES: 50 * 1024 * 1024,   // UrlFetchApp's limit per call
  MAX_DOC_CHARS: 200000,
  SIGN_IN_SECONDS: 600,
  P_ACCESS: 'kinsy.access',
  P_REFRESH: 'kinsy.refresh',
  P_LAST_SAVE: 'kinsy.lastSave'
};

// An error the sidebar can act on. kind: auth | credits | busy | invalid |
// server | drive_full | drive.
function fail_(kind, message) {
  var e = new Error(message);
  e.kind = kind;
  return e;
}

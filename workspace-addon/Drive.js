// Puts a finished deck in the person's own Drive as a Google Slides file.
// The pptx comes from Kinsy's signed download link (no token sent); the
// upload uses the person's Google token with the drive.file scope, which
// reaches only files this add-on created.

function cleanTitle_(title) {
  var t = String(title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (t || 'Kinsy deck').slice(0, 200);
}

function slidesUrl_(fileId) {
  return 'https://docs.google.com/presentation/d/' + fileId + '/edit';
}

function downloadPptx_(url) {
  if (typeof url !== 'string' || url.indexOf(KINSY.DOWNLOAD_PREFIX) !== 0) {
    throw fail_('server', 'The deck could not be downloaded. Try again.');
  }
  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false });
  } catch (e) {
    // UrlFetchApp throws when a reply is over its 50 MB limit.
    throw fail_('server', 'The deck could not be downloaded. Open it in Kinsy to export it.');
  }
  if (res.getResponseCode() !== 200) throw fail_('server', 'The deck could not be downloaded. Try again.');
  var bytes = res.getContent();
  if (!bytes || !bytes.length) throw fail_('server', 'The deck could not be downloaded. Try again.');
  if (bytes.length > KINSY.MAX_PPTX_BYTES) {
    throw fail_('invalid', 'This deck is too large to save from here. Open it in Kinsy to export it.');
  }
  return bytes;
}

function driveRefusal_(res) {
  var reason = '';
  try {
    var errs = (JSON.parse(res.getContentText()).error || {}).errors || [];
    reason = errs.length ? String(errs[0].reason || '') : '';
  } catch (e) {
    reason = '';
  }
  if (reason === 'storageQuotaExceeded') {
    return fail_('drive_full', 'Your Google Drive is full. Free some space, then save again.');
  }
  return fail_('drive', "Google Drive didn't accept the file. Try again in a minute.");
}

// Resumable upload: one call with the file's name and target type, one with
// the bytes. Drive converts the pptx because the target type is Slides.
function uploadAsSlides_(bytes, title) {
  var google = 'Bearer ' + ScriptApp.getOAuthToken();
  var start;
  try {
    start = UrlFetchApp.fetch(KINSY.UPLOAD_URL, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ name: cleanTitle_(title), mimeType: KINSY.SLIDES_MIME }),
      headers: {
        Authorization: google,
        'X-Upload-Content-Type': KINSY.PPTX_MIME,
        'X-Upload-Content-Length': String(bytes.length)
      },
      muteHttpExceptions: true,
      followRedirects: false
    });
  } catch (e) {
    throw fail_('drive', "Google Drive couldn't be reached. Try again in a minute.");
  }
  if (start.getResponseCode() !== 200) throw driveRefusal_(start);
  var headers = start.getHeaders() || {};
  var session = headers.Location || headers.location;
  if (typeof session !== 'string' || session.indexOf(KINSY.UPLOAD_PREFIX) !== 0) {
    throw fail_('drive', "Google Drive didn't accept the file. Try again in a minute.");
  }
  var done;
  try {
    done = UrlFetchApp.fetch(session, {
      method: 'put',
      contentType: KINSY.PPTX_MIME,
      payload: bytes,
      headers: { Authorization: google },
      muteHttpExceptions: true,
      followRedirects: false
    });
  } catch (e) {
    throw fail_('drive', "Google Drive couldn't be reached. Try again in a minute.");
  }
  var code = done.getResponseCode();
  if (code !== 200 && code !== 201) throw driveRefusal_(done);
  var id = '';
  try {
    id = String(JSON.parse(done.getContentText()).id || '');
  } catch (e) {
    id = '';
  }
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    throw fail_('drive', "Google Drive didn't accept the file. Try again in a minute.");
  }
  return id;
}

function lastSave_() {
  try {
    return JSON.parse(props_().getProperty(KINSY.P_LAST_SAVE) || 'null');
  } catch (e) {
    return null;
  }
}

// One save at a time per person, and one file per deck: pressing the
// button again returns the file already made.
function saveToSlides_(deckId) {
  // Ask for the deck afresh (download links expire after an hour), and do
  // it before taking the lock: a token refresh takes the same lock.
  var deck = deckStatus_(deckId);
  var pptx = deck.status === 'done' && deck.artifacts && deck.artifacts.pptx;
  if (!pptx || !pptx.url) throw fail_('invalid', "The deck isn't finished yet.");
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw fail_('busy', 'Still saving. Give it a moment.');
  try {
    var last = lastSave_();
    if (last && last.deckId === deckId && /^[A-Za-z0-9_-]{10,}$/.test(String(last.fileId || ''))) {
      return { url: slidesUrl_(last.fileId), title: String(last.title || '') };
    }
    var title = cleanTitle_(deck.title);
    var fileId = uploadAsSlides_(downloadPptx_(pptx.url), title);
    props_().setProperty(KINSY.P_LAST_SAVE, JSON.stringify({ deckId: deckId, fileId: fileId, title: title }));
    return { url: slidesUrl_(fileId), title: title };
  } finally {
    lock.releaseLock();
  }
}

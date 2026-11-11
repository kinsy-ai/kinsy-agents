// Entry points: the add-on menu, the sidebar, and the functions the sidebar
// calls through google.script.run. Every sidebar function answers with
// {ok: true, ...} or {ok: false, kind, message}; tokens never leave here.

function onInstall(e) {
  onOpen(e);
}

// Runs before the person has authorised anything, so it only adds the menu.
function onOpen(e) {
  ui_().createAddonMenu().addItem('Build a deck', 'showSidebar').addToUi();
}

function ui_() {
  try {
    return SlidesApp.getUi();
  } catch (e) {
    return DocumentApp.getUi();
  }
}

function activeDocument_() {
  try {
    return DocumentApp.getActiveDocument() || null;
  } catch (e) {
    return null;
  }
}

function showSidebar() {
  ui_().showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Kinsy'));
}

function answer_(fn) {
  try {
    var out = fn() || {};
    out.ok = true;
    return out;
  } catch (e) {
    if (e && e.kind) return { ok: false, kind: e.kind, message: String(e.message || '') };
    console.error('kinsy.unexpected ' + (e && e.message));
    return { ok: false, kind: 'server', message: 'Something went wrong. Try again.' };
  }
}

function getState() {
  return answer_(function () {
    var doc = activeDocument_();
    var state = {
      signedIn: signedIn_(),
      host: doc ? 'docs' : 'slides',
      documentName: doc ? String(doc.getName() || '').slice(0, 120) : '',
      pricingUrl: KINSY.PRICING_URL
    };
    // A fresh link each time: it is good for ten minutes.
    if (!state.signedIn) state.signInUrl = authUrl_();
    return state;
  });
}

function documentSource_() {
  var doc = activeDocument_();
  if (!doc) throw fail_('invalid', 'Open a Google Doc to build from a document.');
  var text = String(doc.getBody().getText() || '').trim();
  if (!text) throw fail_('invalid', 'This document is empty. Add some text or describe the deck instead.');
  return {
    name: String(doc.getName() || 'Document').slice(0, 120) || 'Document',
    text: text.slice(0, KINSY.MAX_DOC_CHARS)
  };
}

// req: {brief, slides, useDocument}
function startBuild(req) {
  return answer_(function () {
    req = req || {};
    var brief = String(req.brief || '').trim().slice(0, 50000);
    var slides = Math.round(Number(req.slides));
    if (!(slides >= 4 && slides <= 25)) slides = 10;
    var sources = req.useDocument === true ? [documentSource_()] : [];
    if (!brief && !sources.length) throw fail_('invalid', 'Describe the deck first.');
    var out = createDeck_(brief, slides, sources);
    return { deckId: validDeckId_(out.deck_id) };
  });
}

function pollDeck(deckId) {
  return answer_(function () {
    var d = deckStatus_(deckId);
    return {
      status: String(d.status || ''),
      progress: Number(d.progress) || 0,
      slidesRendered: Number(d.slides_rendered) || 0,
      slidesTotal: d.slides_total ? Number(d.slides_total) : null,
      title: d.title ? String(d.title) : '',
      error: d.error ? String(d.error) : ''
    };
  });
}

function saveDeck(deckId) {
  return answer_(function () {
    return saveToSlides_(deckId);
  });
}

// Cheap check the sidebar repeats while the sign-in tab is open.
function checkSignIn() {
  return answer_(function () {
    return { signedIn: signedIn_() };
  });
}

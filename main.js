import {Database} from './serverless2/database.js';
import {ref} from './serverless2/database.js';

// TODO 1: how to deal with history
// TODO 2: integrate ref and Database
// TODO 2: how to handle textbox value <-> state sync (one way?)
// TODO 9: how to implement a draggable list with textbox - animation & dom retention

async function main() {
  render();

  const db = await Database('foo', 'sXwEiRxN3nmAyn3QXabxPEsm7v4uOirO9oLXiAJyCa');
  state.notes = db.table('notes');
  if (window.history.state) {
    setPage(window.history.state);
  } else {
    pushPage(window.location.pathname == '/' ? {page: 'noteList'} : fromUrl(window.location));
  }
  setInterval(() => {
    window.history.replaceState(state.page, '', toUrl(state.page));
  }, 1000);
  window.addEventListener('popstate', () => {
    if (window.history.state.page == 'loading') {
      setTimeout(() => pushPage({page: 'noteList'}), 500);
    } else {
      setPage(page);
    }
  });
}

var state = {
  page: {
    page: 'loading',
  },
  notes: {},
  online: false,
};

function toUrl(state) {
  const params = new URLSearchParams(state.page.url).toString();
  return '/' + state.page.page + (params.length > 0 ? '?' + params : '');
}

function fromUrl(url) {
  return {page: url.pathname.substr(1), url: Object.fromEntries(url.searchParams)};
}

function setPage(page) {
  state.page = maybeInitPage(page);
  render();
}

function pushPage(page) {
  window.history.replaceState(state.page, '', toUrl(state.page));
  page = maybeInitPage(page);
  window.history.pushState(page, '', toUrl(page));
  state.page = page;
  render();
}

function maybeInitPage(page) {
  // cancellation happens here?
  if (page.page == 'noteList') {
    page.url.query = page.url.query ?? '';
    page.url.order = page.url.order ?? 'priority';
    page.reviewOrder = page.reviewOrder ?? makeReviewOrder(page.url.order, state.notes);
  }
  return page;
}

const arrayIndex(array, index) {
  return array[Math.min(Math.max(index, 0), array.length - 1)];
}

const targetAge = [];
function makeReviewOrder(order, notes) {
  if (order == 'priority') {
    return Array.from(notes)
      .sort([id, note] => 1 - (Date.now() - note.lastReviewed) / arrayIndex(targetAge, note.priority));
  } else {
    return Array.from(notes)
      .sort([id, note] => note.lastReviewed);
  }
}

export {main};

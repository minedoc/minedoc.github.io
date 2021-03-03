import {Database} from './serverless2/database.js';

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

// the more assumptions to params the more optimal it can be
// map: params, {item} -> {item}
// filter: params, {item} -> {item}
// join: {item}, {local} -> {(item, local)}
//   select: selectedIds - this is a join!
//   left/right joins, sparse joins
// snapshot: {item} -> {copy(item)}
// sort: params, {item} -> [item]
// index / match: {item} -> index ; query, index -> {item}
//   implement via map keys and aggregate
// if branch: params
//   either do inside a map (applicative), or need bind (monad)
// pull vs push
//
// no use so far
//   group by
//     aggregate by commutative operator sum, min, max, count
//   limit offset: nah we are small data
//   distinct: nah
//
// how to implement a todo list that you can drag items around while textbox active
//   a: no support for animation
//   b: will not retain same text box

// textbox input <-> state keep them in sync

// immutability?
// object with key tracking
// variable (root) -> observable -> multiple can be merged with function -> observer (root)
const db = Incremental();
const a = db.Val(5);
a.update(6);
const c = db.Fn(a, b.x, (a, b) => a + b);
const c_callback = c.observe(x => console.log(x)); c_callback.ignore();
const c_focus = c.focus(); c_focus.get(); c_focus.ignore(); // focus can be forgotten

const m = db.map([['x', 6]]);
m.update('x', 7);
const n = m.map((k, v) => [k, v]);
const n_focus = n.focus(); n_focus.get('x');

export {main};

import {Database} from './serverless2/database.js';
import {ref} from './serverless2/database.js';

// TODO 1: independent pages (abstraction)
// TODO 1: how to deal with history
// TODO 2: integrate ref and Database
// TODO 2: how to handle textbox value <-> state sync (one way?)
//         react - textbox onchange, update state, render state, no dom ops
//         how to do dedup with this? computed needs rate limit?
// TODO 5: performance - cached(ref, 10s) - limited reactivity
//         search index - note - 10s, query change - instant
// TODO 9: how to implement a draggable list with textbox - animation & dom retention

// the page abstraction
//   p1, p2, p3 ..
//   have a url - can be accessed by url
//   on load can do some js
//   back button works
//   ephermeral state of eg textbox is restored
//   should pages snapshot database by default, like html get some data

async function main() {
  const db = await Database('foo', 'sXwEiRxN3nmAyn3QXabxPEsm7v4uOirO9oLXiAJyCa');
  const page = ref('loading');
  const notes = refMap(db.table('notes'));  // const notes = refMap(); db.table('notes', notes.value);
  const noteTokens = notes
    .groupBy((noteId, note) => tokenize(note.text))
    .filter((word, notes) => notes.size < 200);
  const priorityBaseTime = ref(Date.now());  // slow update
  const notesWithPriority = notes.select((noteId, note) => ({
    priorityScore: calculate(note.editDate, priorityBaseTime.value)
    ...note,
  }));
  const online = ref(false);
  const noteListPage = (function {
    const query = ref('');
    const order = ref('priority');
    const queryTokens = computed(() => tokenize(noteList.query.value));
    const matches = join([queryTokens, noteTokens], (word, query, notes) => notes)
      .groupBy((word, notes) => notes.entries().map([noteId, unused] => [noteId, notes.length]));
    const matchedNotes = join([matches, notes], (noteId, words, note) => note);
    const results = computed(() => query.value == '' ? notes.value : matchedNotes.value);
    const relevantNotes = join([matches, notes], (noteId, words, note) => {
      let matchScore = 0;
      const docCount = notes.value.length;  // maybe not update docCount so often eg every hundred
      // this seems to trigger a bug, notes will notify per key!
      for (const [word, wordCount] of words.entries()) {
        matchScore += Math.log(docCount / wordCount);
      }
      return {matchScore, ...note}
    });
    const mapping = {
      priority: computed(() => Array.from(results.value.entries()).sort(descending(x => x[1].priorityScore))),
      newest: computed(() => Array.from(results.value.entries()).sort(descending(x => x[1].editDate))),
      match: computed(() => Array.from(relevantNotes.value.entries()).sort(descending(x => x[1].matchScore))),
    };
    const listing = computed(() => mapping[order.value].value);
    const {save, load} = snapshot({query, order});
    return {query, order, listing, save, load};
  }) ();

  // priority ordering
  // search index (fuzzy, non)

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

function tokenize(text) {
  return new Map(text
    .match(/[^ ,.'"(){}\r\n\t-]+/g)
    .map(token => token.toLowerCase())
    .filter(token => !stopWords.has(token))
    .map(token => [stemmer(token), 1]));
}

function snapshot(src) {
  return {
    save: () => Object.fromEntries(Object.entries(src).map(([k,v]) => [k, v.value])),
    load: snap => Object.entries(src).map(([k,v]) => {
      if(snap[k]) {
        v.value = snap[k];
      }
    }),
  }
}

function toUrl(state) {
  const params = new URLSearchParams(state.page.url).toString();
  return '/' + state.page.page + (params.length > 0 ? '?' + params : '');
}

function fromUrl(url) {
  return {page: url.pathname.substr(1), url: Object.fromEntries(url.searchParams)};
}

function setPage(page) {
  state.page = maybeInitPage(page);
}

function pushPage(page) {
  window.history.replaceState(state.page, '', toUrl(state.page));
  page = maybeInitPage(page);
  window.history.pushState(page, '', toUrl(page));
  state.page = page;
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

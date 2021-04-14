import {Database} from './serverless2/database.js';
import {ref} from './serverless2/database.js';
import {template} from './serverless2/lib.js';

// TODO 2: integrate ref and Database
// TODO 2: how to handle textbox value <-> state sync (one way?)
//         react - textbox onchange, update state, render state, no dom ops
//         how to do dedup with this? computed needs rate limit?
// TODO 5: performance - ref.cached(10000) - limited reactivity
// TODO 8: search box uses prefix search, while text box uses full word search
// TODO 9: how to implement a draggable list with textbox - animation & dom retention

// pages - url is the entire state, everything unset is reset, on load can do some js

// url scheme
//   share=id-password : share link -> save id, open page
//   db=id/6 page=x : view page
//   db=id/6 page=x id=x : pass parameters

async function main() {
  const state = App();
  function handleState() {
    const params = new URL(document.location).searchParams;
    state.page.value = params.get('page') || 'list';
    state.pageState.value.load(Object.fromEntries(params));
  }
  handleState();
  window.addEventListener('popstate', handleState);
  setInterval(() => window.history.updateState({}, '', toUrl()), 200);

  function setPage(page, init) {
    state.page.value = page;
    state.pageState.value.load(init);
    window.history.pushState({}, '', toUrl());
  }

  function toUrl(state) {
    const url = new URLSearchParams(state.pageState.value.save());
    url.set('page', state.page.value);
    return url.toString();
  }

  function handlers
}

const templates = {
  const body = template('container', [
    // how does state get shared?
    ['search', 'change', event => state.pageState.value.search.value = event.target.value],
  ], (target, data) => {
    target.root
      .attr('page', page.value)
      .class('network', online.value);
    if (page.value == 'list') {
      target.results.repeat(templates.item, state.listState.results, state.startTime, state.listState.order);
      target.order.value();
    } else if (page.value == 'edit') {
      if (data.editState.initial) {
        data.editState.initial = false;
        target.editor.value(data.editState.baseItem.text);
        target.importance.value(data.editState.baseItem.importance);
      }
      target.id.text(data.editState.baseItem.id || 'new');
      target.related.repeat(templates.related, state.editState.related, state.itemById);
      target.root.class('showRelated', data.editState.showRelated);
      target.timer.text(dateAsAge(data.editState.editStartTime));
    } else if (data.state == pageMode.diff) {
      target.diff.unsafe_html(data.diffState.diffHtml);
    }
  }),
  item: template('item', function(target, data, startTime, order) {
    target.root.attr('data-id', data.id);
    target.text.text(shorten(data.text, 3, 200));
    target.root.class('read', startTime < data.lastReviewed && order == 'review');
  }),
  related: template('related', function(target, data, itemById) {
    target.root.attr('data-id', data.id);
    target.root.text(shorten(itemById[data.id].text, 1, 50));
  }),
};

function App() {
  const db = await Database('foo', 'sXwEiRxN3nmAyn3QXabxPEsm7v4uOirO9oLXiAJyCa');
  const notes = refMap(db.table('notes'));  // const notes = refMap(); db.table('notes', notes.value);
  const now = ref(Date.now());  // slow update - perhaps used cached non-determinstic computation

  const page = ref('');
  const pageMap = {
    list: ListPage(notes),
    edit: EditPage(),
  };
  const pageState = computed(() => pageMap[page.value]);
  const online = ref(false);
  return {now, page, pageState, online};
}

function ListPage(notes) {
  const query = ref('');
  const order = ref('priority');
  const queryTokens = computed(() => tokenize(query.value));
  const noteTokens = notes
    .groupBy((noteId, note) => tokenize(note.text))
    .filter((word, notes) => notes.size < 200);
  const matches = join([queryTokens, noteTokens], (word, query, notes) => notes)
    .groupBy((word, notes) => notes.entries().map([noteId, unused] => [noteId, notes.length]));
  const matchedNotes = join([matches, notes], (noteId, words, note) => note);
  const results = computed(() => query.value == '' ? notes.value : matchedNotes.value);
  const noteCount = cached(computed(() => notes.value.length), 60 * 1000);
  const relevantNotes = join([matches, notes], (noteId, words, note) => {
    let matchScore = 0;
    const noteCountVal = noteCount.value;
    // this seems to trigger a bug, notes will notify per key!
    for (const [word, wordCount] of words.entries()) {
      matchScore += Math.log(docCount / wordCount);
    }
    return {matchScore, ...note}
  });
  const mapping = {
    priority: computed(() => {
      const n = now.value;
      return Array.from(results.value.entries()).sort(descending(x => (n - x[1].editDate) / arrayIndex(targetAge, note.priority)))
    }),
    newest: computed(() => Array.from(results.value.entries()).sort(descending(x => x[1].editDate))),
    match: computed(() => Array.from(relevantNotes.value.entries()).sort(descending(x => x[1].matchScore))),
  };
  const listing = computed(() => mapping[order.value].value);
  const {save, load} = snapshot({query, order});
  return {query, order, listing, save, load};
}

function EditPage() {
}

function tokenize(text) {
  return new Map(text
    .match(/[^ ,.'"(){}\r\n\t-]+/g)
    .map(token => token.toLowerCase())
    .filter(token => !stopWords.has(token))
    .map(token => [stemmer(token), 1]));
}

function snapshot(src, defaults) {
  const fields = Object.entries(src);
  const save = () => Object.fromEntries(fields.map(([k,v]) => [k, v.value]));
  const load = snapshot => fields.map(([k,v]) => v.value = snapshot[k] ?? defaults[k] ?? '');
  return {save, load};
}

function descending(fn) {
  return (a, b) => {
    const av = fn(a);
    const bv = fn(b);
    return av < bv ? -1 : (av == bv ? 0 : 1);
  };
}

const arrayIndex(array, index) {
  return array[Math.min(Math.max(index, 0), array.length - 1)];
}

export {main};

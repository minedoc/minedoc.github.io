// import {Database} from './serverless2/database.js';
import {template} from './lib.js';
import {ref, refMap, computed, computedMap} from './ref.js';

// TODO 2: integrate ref and Database
// TODO 2: how to handle textbox value <-> state sync (one way?)
//         react - textbox onchange, update state, render state, no dom ops
//         how to do dedup with this? computed needs rate limit?
// TODO 5: performance - ref.cached(10000) - limited reactivity
// TODO 8: search box uses prefix search, while text box uses full word search
// TODO 9: how to implement a draggable list with textbox - animation & dom retention

// pages - url is the entire state, everything unset is reset, on load can do some js

// url scheme
//   # share=id-password : share link -> save id, open page
//   ? db=id/6 page=x : view page
//   ? db=id/6 page=x params=x : pass parameters

main();

async function main() {
  const state = State();
  window.state = state;
  function handleState() {
    const params = new URL(document.location).searchParams;
    state.page(params.get('page') || 'list');
    state.pageState().load(params);
  }
  function toUrl(state) {
    const url = new URLSearchParams(state.pageState().save());
    url.set('page', state.page());
    return '?' + url.toString();
  }
  handleState();
  window.addEventListener('popstate', handleState);
  setInterval(() => window.history.replaceState({}, '', toUrl(state)), 200);

  function setPage(page, init) {
    state.page(page);
    state.pageState().load(init);
    window.history.pushState({}, '', toUrl(state));
  }
}

/*const templates = {
  const body = template('container', [
    // how does state get shared?
    ['search', 'change', event => state.pageState().search(event.target.value)],
  ], (target, data) => {
    target.root
      .attr('page', page())
      .class('network', online());
    if (page() == 'list') {
      target.results.repeat(templates.item, state.listState.results, state.startTime, state.listState.order);
      target.order.value();
    } else if (page() == 'edit') {
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
}; */

function State() {
  // const db = await Database('foo', 'sXwEiRxN3nmAyn3QXabxPEsm7v4uOirO9oLXiAJyCa');
  const notes = refMap();  // db.table('notes')
  notes.set(334, {text: 'first document', editDate: 1000});
  notes.set(249, {text: 'second good', editDate: 5000});
  notes.set(18, {text: 'first SEO', editDate: 2000});
  notes.set(22, {text: 'second SEO', editDate: 2000});
  notes.set(30, {text: 'second bad', editDate: 2000});
  const online = ref(false);
  const page = ref('list');
  const pages = {
    list: ListPage(notes),
    edit: EditPage(),
  };
  const pageState = () => pages[page()];
  return {page, pageState, online, _notes: notes};
}

const targetAge = [0.25, 1, 4, 8, 16, 32, 64, 128, 256];
function ListPage(notes) {
  const query = ref('');
  const order = ref('priority');
  const queryTokens = computedMap(() => tokenize(query()));
  const noteTokens /* <word, <noteId, 1>> */ = notes
    .groupBy((noteId, note) => tokenize(note.text))
    .filter((word, notes) => notes.size < 200);
  const matches /* <noteId, <word, wordOccurrencesInNotes>> */ = queryTokens
    .join([noteTokens], (word, query, notes) => notes)
    .groupBy((word, notes) => {
      const entries = Array.from(notes.entries());
      return entries.map(([noteId, unused]) => [noteId, entries.length]);
    });
  const docCount = computed(() => notes().size, undefined, 2 * 60000);
  const matchedNotes /* <noteId, {matchScore, note}> */ = matches.join([notes], (noteId, match, note) => {
    const docs = docCount();
    let matchScore = 0;
    for (const [word, occurrences] of match.entries()) {
      matchScore += Math.log(docs / occurrences);
    }
    return {matchScore, ...note};
  });
  const nowDelayed = ref(Date.now());
  setInterval(() => nowDelayed.set(Date.now()), 15 * 60000);
  const listing = computed(() => {
    let sorting;
    const results = Array.from((query() == '' ? notes() : matchedNotes()).entries());
    if (order() == 'priority') {
      const n = nowDelayed();
      sorting = x => (n - x[1].editDate) / (24 * 60 * 60 * 1000 * arrayIndex(targetAge, note.priority));
    } else if (order() == 'newest') {
      sorting = x => x[1].editDate;
    } else {
      sorting = x => x[1].matchScore;
    }
    return results.sort(descending(sorting));
  });
  const {save, load} = snapshot({query, order});
  return {query, order, listing, save, load, debug: { noteTokens, matches, queryTokens } };
}

function EditPage() {
}

const stopWords = new Set(["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "it", "it's", "its", "itself", "let's", "me", "more", "most", "my", "myself", "nor", "of", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "she'd", "she'll", "she's", "should", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we", "we'd", "we'll", "we're", "we've", "were", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "would", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"]);
function tokenize(text) {
  const output = new Map();
  const words = text
    .match(/[^ ,.'"(){}\r\n\t-]+/g)
    .map(token => token.toLowerCase())
    .filter(token => !stopWords.has(token))
    .map(token => stemmer(token));
  for (const word of words) {
    output.set(word, (output.get(word) ?? 0) + 1);
  }
  return output;
}

function snapshot(src, defaults={}) {
  const fields = Object.entries(src);
  const save = () => Object.fromEntries(fields.map(([k, ref]) => [k, ref()]));
  const load = snapshot => fields.forEach(([k, ref]) => ref.set(snapshot.get(k) ?? defaults[k] ?? ''));
  return {save, load};
}

function descending(fn) {
  return (a, b) => {
    const av = fn(a);
    const bv = fn(b);
    return av < bv ? 1 : (av == bv ? 0 : -1);
  };
}

function arrayIndex(array, index) {
  return array[Math.min(Math.max(index, 0), array.length - 1)];
}

export {main};

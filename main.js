// import {Database} from './serverless2/database.js';
import {template, dateAsAge, dedup, debuggingShowErrors} from './lib.js';
import {ref, refMap, computed, computedMap, DELETE} from './ref.js';

async function main() {
  debuggingShowErrors();  // TODO: remove
  // const db = await Database('foo', 'sXwEiRxN3nmAyn3QXabxPEsm7v4uOirO9oLXiAJyCa');
  const app = window.app = App();
  const params = new URL(document.location).searchParams;
  // if list page - go there, else add a list page as backup
  if (params.get('page') == 'list') {
    app.page.set('list');
    app.state().load(params);
  } else {
    window.history.replaceState({}, '', '?' + new URLSearchParams({ page: 'list', order: 'priority', query: ''}));
    app.page.set(params.get('page') || 'list');
    app.state().load(params);
    window.history.pushState({}, '', toUrl(app));
  }

  window.addEventListener('popstate', () => {
    if (app.page() == 'edit' && app.state().note()) {
      if (app.state().note().text.length == 0) {
        app.drafts.delete(app.state().id());
      } else {
        app.notes.set(app.state().id(), app.pages.edit.note());
        app.drafts.delete(app.state().id());
      }
    }
    const params = new URL(document.location).searchParams;
    app.page.set(params.get('page'));
    app.state().load(params);
    render();
  });
  setInterval(() => window.history.replaceState({}, '', toUrl(app)), 500);

  const renderer = Template(app);
  document.body.appendChild(renderer.dom);
  window.a = Actions(app);
  return () => renderer.update(app);
}

function toUrl(app) {
  return '?' + new URLSearchParams(Object.assign({'page': app.page()}, app.state().save()));
}

function navigate(app, page, params) {
  window.history.replaceState({}, '', toUrl(app));
  app.page.set(page);
  app.state().load(new URLSearchParams(params));
  window.history.pushState({}, '', toUrl(app));
}

function Actions(app) {
  return {
    addNote() {
      const id = 'draft-' + randomChars(5);
      app.drafts.set(id, {text: '', priority: 3, editDate: Date.now()});
      app.read.set(id, true);
      navigate(app, 'edit', {
        id,
        editStartTime: Date.now(),
      });
      render();
    },
    openItem(e) {
      app.read.set(e.dataset.id, true);
      navigate(app, 'edit', {
        id: e.dataset.id,
        editStartTime: Date.now(),
      });
      render();
    },
    orderChange(e) {
      app.pages.list.order.set(e.value);
      render();
    },
    searchChange(e) {
      app.pages.list.search.set(e.value);
      if (e.value == '') {
        app.pages.list.order.set('priority');
      } else {
        app.pages.list.order.set('match');
      }
      render();
    },
    deleteNote(e) {
      app.notes.delete(app.pages.edit.id());
      app.drafts.set(app.pages.edit.id(), {text: ''});  // TODO: hack fix popstate
      history.back();
    },
    editorInput(e) {
      app.drafts.set(app.pages.edit.id(), {
        ...app.pages.edit.note(),
        text: e.value,
        editDate: Date.now(),
      });
      render();
    },
    importanceInput(e) {
      app.drafts.set(app.pages.edit.id(), {
        ...app.pages.edit.note(),
        priority: parseInt(e.value, 10),
        editDate: Date.now(),
      });
      render();
    },
    editorKeyDown(editor, event) {
      if (event.key == 'Enter') {
        event.preventDefault();
        document.execCommand('insertText', true, '\n' + editorHeader(editor, editor.selectionStart));
      } else if (event.key == 'Tab') {
        event.preventDefault();
        this.editorIndent(editor, !event.shiftKey);
      }
    },
    editorCompositionEnd(editor, event) {
      if (event.data.slice(-1) == '\n') {
        document.execCommand('insertText', true, editorHeader(editor.selectionStart - 1));
      }
    },
    editorIndent(e, indent) {
      const editor = e.closest('.page').querySelector('.editor');
      if (indent) {
        editorReplace(editor, /(^|\n)/g, '$1  ');
      } else {
        editorReplace(editor, /(^|\n)  /g, '$1');
      }
    },
    editorDash(e) {
      const editor = e.closest('.page').querySelector('.editor');
      if (editor.selectionStart == editor.selectionEnd) {
        document.execCommand('insertText', true, '-');
      } else {
        editorReplace(editor, /((^|\n)[ -]*)([^ -])/g, (x, y, z, a, b) => {
          if (y.endsWith('- ')) {
            return y.substring(0, y.length - 2) + a;
          } else {
            return y + '- ' + a;
          }
        });
      }
    },
    editorSendKey(e) {
      const editor = e.closest('.page').querySelector('.editor');
      document.execCommand('insertText', true, e.innerText.trim());
    },
    editorUndo(e) {
      const editor = e.closest('.page').querySelector('.editor');
      document.execCommand('undo', true);
    },
    editorRedo(e) {
      const editor = e.closest('.page').querySelector('.editor');
      document.execCommand('redo', true);
    },
  }
}

const Template = (() => {
  const body = template('container', (target, {page, state, network}) => {
    target.root.data('page', page()).class('network', network());
    const s = state();
    if (page() == 'list') {
      target.results.repeat(item, s.listing());
      target.search.value(s.search());
      target.order.value(s.order()).class('searchEmpty', s.search() == '');
    } else if (page() == 'edit') {
      const note = s.note();  // TODO: note not found - show error message
      target.id.text(note.draft ? 'draft' : '');
      target.editor.value(note.text);
      target.priority.value(note.priority);
      target.timer.text(dateAsAge(s.editStartTime()));
      target.related.repeat(related, s.related());
    }
  });
  const item = template('item', function(target, [id, {read, draft, note: {text}}]) {
    target.root.data('id', id).class('draft', draft).class('read', read);
    target.text.text(shorten(text, 3, 200));
  });
  const related = template('related', function(target, [id, {note: {text}}]) {
    target.root.data('id', id);
    target.root.text(shorten(text, 1, 50));
  });
  return body;
}) ();

function App() {
  const notes = refMap();  // db.table('notes')
  notes.set('bG9ONjf27mQ1', {text: 'first document oldest', editDate: 1000, priority: 0});
  notes.set('249', {text: 'second good newest', editDate: 5000, priority: 1});
  notes.set('18', {text: 'first SEO', editDate: 2000, priority: 1});
  notes.set('22', {text: 'second SEO', editDate: 2000, priority: 1});
  notes.set('30', {text: 'second bad', editDate: 2000, priority: 1});
  const drafts = refLocalStorageMap('drafts');
  Array.from(drafts().entries()).forEach(([k, v]) => v.text == '' ? drafts.delete(k) : 0);
  const read = refMap();
  const mergedNotes = notes.outerJoin([drafts, read], (id, note, draft, read) => {
    if (draft) {
      return {note: draft, draft: true, read: !!read};
    } else if (note) {
      return {note: note, draft: false, read: !!read};
    } else {
      return DELETE;
    }
  });
  const network = ref(false);  // TODO: how to show network status
  const page = ref('list');
  const pages = {
    list: ListPage(mergedNotes),
    edit: EditPage(mergedNotes),
  };
  const state = () => pages[page()];
  return {page, state, network, pages, notes, drafts, read, /* debug */ mergedNotes };
}

const targetAge = [0.25, 1, 4, 8, 16, 32, 64, 128, 256];
function ListPage(notes) {
  const search = ref('');
  const order = ref('priority');

  const searchTokens = computedMap(() => tokenize(search(), NO_PREFIX));
  const matchedNotes = noteSearch(notes, searchTokens, WITH_PREFIX);
  const listing = computed(() => {
    let sorting;
    const results = Array.from((search() == '' ? notes() : matchedNotes()).entries());
    const diffScore = x => x[1].draft ? 1000000000000 : 0;
    if (order() == 'priority') {
      const now = Date.now();
      sorting = x => diffScore(x) + (now - x[1].note.editDate) / (24 * 60 * 60 * 1000 * arrayIndex(targetAge, x[1].note.priority));
    } else if (order() == 'recent') {
      sorting = x => diffScore(x) + x[1].note.editDate;
    } else if (order() == 'match') {
      sorting = x => diffScore(x) + x[1].matchScore;
    }
    return results.sort(descending(sorting));
  });
  return {search, order, ...snapshot({search, order}), listing };
}

function EditPage(notes) {
  const id = ref('');
  const editStartTime = ref(0);
  const note = computed(() => notes().get(id())?.note);

  const query = computedMap(() => tokenize(note().text, NO_PREFIX), 500);
  const results = noteSearch(notes, query, NO_PREFIX);
  const related = computed(() => {
    const pageId = id();
    return Array.from(results())
      .filter(([noteId, unused]) => noteId != pageId)
      .slice(0, 1000)
      .sort(descending(x => x[1].matchScore))
      .slice(0, 40);
  });
  return {id, editStartTime, ...snapshot({id, editStartTime}), note, related}
}

function noteSearch(notes, searchTokens, prefix) {
  const noteTokens /* <word, <noteId, 1>> */ = notes
    .groupBy((noteId, note) => tokenize(note.note.text, prefix))
    .filter((word, notes) => notes.size < 1000);
  const matches /* <noteId, <word, wordOccurrencesInNotes>> */ = searchTokens
    .leftJoin([noteTokens], (word, search, notes) => notes)
    .filter((word, notes) => notes)
    .groupBy((word, notes) => {
      const entries = Array.from(notes.entries());
      return entries.map(([noteId, unused]) => [noteId, entries.length]);
    });
  const docCount = computed(() => notes().size, undefined, 2 * 60000);
  const matchedNotes /* <noteId, {matchScore, note}> */ = matches.leftJoin([notes], (noteId, match, note) => {
    const docs = docCount();
    let matchScore = 0;
    for (const [word, occurrences] of match.entries()) {
      matchScore += Math.log(docs / occurrences);
    }
    return {matchScore, ...note};
  });
  return matchedNotes;
}

const WITH_PREFIX = Symbol(), NO_PREFIX = Symbol();
const stopWords = new Set(["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "it", "it's", "its", "itself", "let's", "me", "more", "most", "my", "myself", "nor", "of", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "she'd", "she'll", "she's", "should", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we", "we'd", "we'll", "we're", "we've", "were", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "would", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"]);
function tokenize(text, prefix) {
  return new Map((text.match(/[^ ,.'"(){}\r\n\t-]+/g) ?? [])
    .map(token => token.toLowerCase())
    .filter(token => !stopWords.has(token))
    .flatMap(token => {
      const root = stemmer(token);
      if (prefix == WITH_PREFIX) {
        const output = [];
        for (var i=2; i<=root.length; i++) {
          output.push([root.substring(0, i), 1]);
        }
        return output;
      } else if (prefix == NO_PREFIX) {
        return [[root, 1]];
      } else {
        throw 'unknown prefix style';
      }
    }));
}

function snapshot(src) {
  const fields = Object.entries(src);
  const save = () => Object.fromEntries(fields.map(([k, ref]) => [k, ref()]).filter(([k, value]) => value));
  const load = snapshot => fields.forEach(([k, ref]) => snapshot.has(k) && ref.set(snapshot.get(k)));
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

function editorReplace(editor, search, replacement) {
  const start = editor.selectionStart, end = editor.selectionEnd;
  const prevLine = editor.value.lastIndexOf('\n', start - 1) + 1;
  const original = editor.value.substring(prevLine, end);
  const updated = original.replace(search, replacement);
  if (original != updated) {
    const offset = editor.value.substring(end, 1) == '\n' ? -1 : 0;
    editor.setSelectionRange(prevLine, end - offset);
    editor.classList.add('noHighlight');
    setTimeout(() => {
      if (updated.length == 0) {
        document.execCommand('delete', true);  // chrome bug when you insert '' into end of textarea
      } else {
        document.execCommand('insertText', true, updated);
      }
      editor.classList.remove('noHighlight');
      if (updated.indexOf('\n') > -1) {
        editor.setSelectionRange(editor.selectionEnd - updated.length, editor.selectionEnd);
      }
    }, 0);
  }
  editor.focus();
}

function shorten(text, maxLines, maxChars) {
  return text.split('\n', maxLines+1).slice(0, maxLines).join('\n').substring(0, maxChars);
}

function editorHeader(editor, start) {
  const prevLineIndex = editor.value.lastIndexOf('\n', start - 1);
  const prevLine = editor.value.substring(prevLineIndex + 1, start)
  return prevLine.split(/[^ *-]/, 1)[0];
}

function refLocalStorageMap(name) {
  const map = refMap();
  const mapSet = map.set;
  const mapDelete = map.delete;
  const saver = dedup(() => localStorage.setItem(name, mapStr));
  const save = () => {
    mapStr = JSON.stringify(Array.from(map().entries()));
    saver(500);
  }
  var mapStr = '[]';
  map.set = (k, v) => { mapSet(k, v); save() };
  map.delete = k => { mapDelete(k); save() };
  const load = str => {
    if (str != null) {
      map.clear();
      JSON.parse(str).forEach(([key, val]) => mapSet(key, val));
      mapStr = str;
    }
  };
  load(localStorage.getItem(name));
  window.addEventListener('storage', e => {
    if (e.storageArea == localStorage && e.key == name && mapStr != e.newValue) {
      load(e.newValue);
    }
    render();
  });
  return map;
}

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const randomChar = () => alphabet[Math.floor(alphabet.length * Math.random())];
function randomChars(length) {
  return Array.from({length}, randomChar).join('');
}

const render = await main();

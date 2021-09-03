import {Database, newConnectionString} from './serverless2/database.js';
import {template, dateAsAge, dedup, debuggingShowErrors} from './lib.js';
import {ref, refMap, computed, computedMap, DELETE, toggleDebug} from './ref.js';

debuggingShowErrors();  // TODO: remove
// toggleDebug();  // TODO: remove

var render;
async function main() {
  const app = window.app = App();
  handleURL(app);

  const renderer = Template(app);
  document.body.appendChild(renderer.dom);
  window.a = Actions(app);
  render = () => renderer.update(app);
  openDefaultBook(app);
}

function handleURL(app) {
  const params = new URL(document.location).searchParams;
  const hash = new URL(document.location).hash;
  const sharePrefix = '#share=';
  if (hash.startsWith(sharePrefix)) {
    const bookId = randomChars(5);
    const displayName = prompt('name of notes', 'notes');
    const connection = hash.substring(sharePrefix.length);
    app.books.set(bookId, {displayName, connection, lastOpenTime: Date.now()});
  }
  window.history.replaceState({}, '', '?' + new URLSearchParams({ page: 'open' }));
  window.history.pushState({}, '', '?' + new URLSearchParams({ page: 'list', order: 'priority' }));
  const startPage = params.get('page');
  if (startPage && startPage != 'list') {
    window.history.pushState({}, '', '?' + params);
  }
  app.page.set(params.get('page') || 'list');
  app.state().load(params);

  window.addEventListener('popstate', () => {
    if (app.page() == 'edit' && app.state().note()) {
      const note = app.state().note();
      const id = app.state().id();
      if (note.text.length != 0) {
        if (id.startsWith('draft-')) {
          app.table.insert(note);
        } else {
          app.table.update(id, note);
        }
      }
      app.drafts.delete(id);
    }
    const params = new URL(document.location).searchParams;
    app.page.set(params.get('page'));
    app.state().load(params);
    render();
  });
  setInterval(() => window.history.replaceState({}, '', toUrl(app)), 500);
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
    newBook(e) {
      const displayName = e.closest('.openPage').querySelector('.noteName').value;
      if (displayName && displayName.length > 0) {
        const bookId = randomChars(5);
        const connection = newConnectionString();
        app.books.set(bookId, {displayName, connection, lastOpenTime: Date.now()});
        openBook(bookId, app);
        navigate(app, 'list', {});
      }
    },
    openBook(e) {
      const bookId = e.closest('[data-book-id]').dataset.bookId;
      openBook(bookId, app);
      navigate(app, 'list', {});
    },
    renameBook(e) {
      const bookId = e.closest('[data-book-id]').dataset.bookId;
      const book = app.books().get(bookId);
      const displayName = prompt('rename ' + book.displayName);
      if (displayName && displayName.length > 0) {
        app.books.set(bookId, {...book, displayName});
      }
      render();
    },
    deleteBook(e) {
      const bookId = e.closest('[data-book-id]').dataset.bookId;
      app.books.delete(bookId);
      render();
    },
    shareBook(e) {
      e.closest('.book').classList.toggle('bookShowShare');
      setTimeout(() => {
      }, 500);
    },
    shareCopy(e) {
      e.setSelectionRange(0, e.value.length);
      document.execCommand('copy');
    },
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
      app.table.delete(app.pages.edit.id());
      app.drafts.delete(app.pages.edit.id());
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
  const body = template('container', (target, {bookList, page, state, network}) => {
    target.root.data('page', page()).class('network', network());
    const s = state();
    if (page() == 'open') {
      target.books.repeat(book, bookList());
    } else if (page() == 'list') {
      target.results.repeat(item, s.listing());
      target.search.value(s.search());
      target.order.value(s.order()).class('searchEmpty', s.search() == '');
    } else if (page() == 'edit') {
      const note = s.note();
      if (note != undefined) {
        target.id.text(note.draft ? 'draft' : '');
        target.editor.value(note.text);
        target.priority.value(note.priority);
        target.timer.text(dateAsAge(s.editStartTime()));
        target.related.repeat(related, s.related());
      } else {
        target.id.text('deleted');
        target.editor.value('this note has been deleted');
        target.related.repeat(related, []);
      }
    }
  });
  const item = template('item', (target, [id, {read, draft, note: {text}}]) => {
    target.root.data('id', id).class('draft', draft).class('read', read);
    target.text.text(shorten(text, 3, 200));
  });
  const related = template('related', (target, [id, {note: {text}}]) => {
    target.root.data('id', id);
    target.root.text(shorten(text, 1, 50));
  });
  const book = template('book', (target, [bookId, {displayName, connection}]) => {
    target.root.data('bookId', bookId);
    target.name.text(displayName);
    target.shareLink.value(window.location.origin + window.location.pathname + '#share=' + connection);
  });
  return body;
}) ();

function openDefaultBook(app) {
  const books = app.bookList();
  if (books.length > 0) {
    openBook(books[0][0], app);
  }
}

var closeDatabase = unused => 0;
async function openBook(bookId, app) {
  closeDatabase();
  const book = app.books().get(bookId);
  app.books.set(bookId, {...book, lastOpenDate: Date.now()});
  const db = await Database('note-' + bookId, book.connection);
  const table = db.table('notes');
  const handler = {set: render, delete: render};
  app.table = table;  // TODO: get rid of this hack
  app.notes.clear();
  table.forward(app.notes);
  table.forward(handler);
  closeDatabase = () => {
    table.unforward(app.notes);
    table.unforward(handler);
  };
  render();
}

function App() {
  const books = localStorageRefMap('books');
  const bookList = computed(() => Array.from(books().entries()).sort(descending(x => x[1].lastOpenTime)));

  const notes = refMap();
  const drafts = localStorageRefMap('drafts');
  Array.from(drafts().entries()).forEach(([k, v]) => v.text == '' ? drafts.delete(k) : 0);
  const read = refMap();
  const selectedBook = ref('foo');
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
    open: OpenPage(),
  };
  const state = () => pages[page()];
  return {books, bookList, page, state, network, pages, notes, drafts, read, table: undefined, /* debug */ mergedNotes };
}

function OpenPage() {
  return {...snapshot({})};
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
    const draftScore = x => x[1].draft ? 1000000000000 : 0;
    if (order() == 'priority') {
      const now = Date.now();
      sorting = x => draftScore(x) + (now - x[1].note.editDate) / (24 * 60 * 60 * 1000 * arrayIndex(targetAge, x[1].note.priority));
    } else if (order() == 'recent') {
      sorting = x => draftScore(x) + x[1].note.editDate;
    } else if (order() == 'match') {
      sorting = x => draftScore(x) + x[1].matchScore;
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
      return new Map(Array.from(notes.entries()).map(([noteId, unused]) => [noteId, notes.size]));
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

function localStorageVar(name, ctor, params) {
  var valStr;
  const value = ctor();
  const saver = dedup(() => localStorage.setItem(name, valStr));
  const oldMethods = {};
  params.methods.forEach(method => {
    const fn = oldMethods[method] = value[method];
    value[method] = (...val) => {
      fn(...val);
      valStr = params.saveToString(value);
      saver(500);
    };
  });
  const load = update => {
    if (valStr != update) {
      valStr = update;
      params.loadFromString(oldMethods, update);
    }
  };
  load(localStorage.getItem(name));
  window.addEventListener('storage', e => {
    if (e.storageArea == localStorage && e.key == name) {
      load(e.newValue);
      render();
    }
  });
  return value;
}

function localStorageRefMap(name) {
  return localStorageVar(name, refMap, {
    saveToString: val => JSON.stringify(Array.from(val().entries())),
    loadFromString: (refMap, str) => {
      refMap.clear();
      JSON.parse(str).forEach(([key, val]) => refMap.set(key, val));
    },
    methods: ['set', 'delete', 'clear'],
  });
}

function localStorageRef(name) {
  return localStorageVar(name, ref, {
    saveToString: val => JSON.stringify(val()),
    loadFromString: (ref, str) => ref.set(JSON.parse(str)),
    methods: ['set'],
  });
}

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const randomChar = () => alphabet[Math.floor(alphabet.length * Math.random())];
function randomChars(length) {
  return Array.from({length}, randomChar).join('');
}

await main();

import {ref, refMap, computed, localStorageRefMap} from './ref.js';
import {template, dateAsAge, descending} from './lib.js';
import {Database} from './serverless2/database.js';

var render;
async function main() {
  const app = window.app = App();

  const renderer = Template(app);
  document.body.appendChild(renderer.dom);
  render = () => renderer.update(app);
  setInterval(render, 1000);

  window.a = Actions(app);
}

function Actions(app) {
  async function writeBackups(dir, books) {
    const date = new Date();
    const datePart = [date.getFullYear(), date.getMonth()+1, date.getDate()].map(x => x.toString().padStart(2, '0')).join('');
    for (const [bookId, {displayName, db}] of books) {
      {
        const fileName = displayName + '-' + datePart + '.backup';
        const file = await dir.getFileHandle(fileName, {create: true});
        const writer = await file.createWritable();
        await writer.write(db.getBackup());
        await writer.close();
      }
      {
        const file = await dir.getFileHandle(displayName + '-' + datePart + '.json', {create: true});
        const writer = await file.createWritable();
        await writer.write(JSON.stringify(Array.from(db.table('notes').entries())));
        await writer.close();
      }
      app.backupTime.set(bookId, Date.now());
    }
  }
  return {
    downloadNow: async function downloadNow() {
      const dir = await window.showDirectoryPicker();
      await writeBackups(dir, app.bookList());
    },
    downloadDaily: async function downloadDaily() {
      const dir = await window.showDirectoryPicker();
      setInterval(() => writeBackups(dir, app.bookList()), 3*60*60*1000);
      await writeBackups(dir, app.bookList());
      app.daily.set(true);
    },
    importDump: async function() {
      const data = await (await fetch('import.json')).json();
      for (const [bookId, {db}] of app.bookList()) {
        const table = db.table('notes');
        for (const row of data) {
          table.insert(row);
        }
      }
    }
  };
}

const Template = (() => {
  const root = template('root', (target, {daily, bookList}) => {
    target.databases.repeat(databaseRow, bookList());
    target.daily.text(daily() ? 'daily started' : '');
  });
  const databaseRow = template('databaseRow', (target, [bookId, {displayName, connection, backupTime, db}]) => {
    target.name.text(displayName);
    target.backup.text(backupTime ? dateAsAge(backupTime) : 'no backup');
    if (db) {
      target.status.text(db.peerCount().connected + ' / ' + db.peerCount().total);
    }
    target.share.text(window.location.origin + '/#share=' + connection);
  });
  return root;
}) ();

function App() {
  const books = localStorageRefMap('books');
  const backupTime = refMap();
  const databases = refMap();
  const daily = ref(false);
  const booksMerged = books.leftJoin([backupTime, databases], (bookId, book, backupTime, db) => {
    if (!db) {
      once(bookId, async () => {
        const db = await Database('note-' + bookId, book.connection);
        databases.set(bookId, db);
      });
    }
    return {...book, backupTime, db};
  });
  const bookList = computed(() => Array.from(booksMerged().entries()).sort(descending(x => x[1].lastOpenTime)));
  return {daily, backupTime, bookList};
}

const onceSet = new Set();
function once(id, fn) {
  if (!onceSet.has(id)) {
    onceSet.add(id);
    fn();
  }
}

await main();

// is this a clone of vue? yes
// no early stopping
//   if you have object, equality is hard, values are easier
//   how likely is this going to be - measure in practice
// no garbage collection - all computations will remain forever
//   how likely is it that this fails
// ref(obj) is a single value, cannot mutate part of it
// refMap() is a single value for computed
//   it offers a few fine grained methods
// update mark dirty, fetch is recompute
// ref { value }
// refMap { value, map, rekey, join, sort }
// computed { value }
// computedMap { value, map, rekey, join, sort }

const usedRefs = [];

function markLate(outputs) {
  for (const output of outputs) {
    if (!output.late) {
      output.late = true;
      markLate(output.outputs);
    }
  }
}

function markLateKey(key, keyedOutputs) {
  for (const output in keyedOutputs) {
    output.lateKeys.add(key);
    markLateKey(output.keyedOutputs);
  }
}

function markUse(node) {
  if(usedRefs.length > 0) {
    const output = usedRefs[usedRefs.length - 1];
    node.outputs.add(output);
  }
}

function freeze(x) {
  if (typeof x == 'object' && x != null) {
    Object.freeze(x);
    Object.keys(x).forEach(p => freeze(x[p]));
  }
  return x;
}

function ref(init) {
  let val = init;
  const outputs = new Set();
  return {
    outputs,
    get value() {
      markUse(this);
      return val;
    },
    set value(value) {
      markLate(outputs);
      val = freeze(value);
    },
  };
}

function computed(fn) {
  const outputs = new Set();
  return {
    outputs,
    late: true,
    cache: undefined,
    get value() {
      markUse(this);
      if (this.late) {
        usedRefs.push(this);
        this.cache = fn(); console.log('call', fn, this.cache);
        usedRefs.pop();
        this.late = false;
      }
      return this.cache;
    },
    set value(value) { throw 'fail' },
  };
}

const mapMethods = {
  function map() { // k,v -> k,u
  }
  function rekey() {  // k,v -> (k,v -> Map<j,u>) -> j,Map<k,u>
  }
  function join(other, default) {  // if default left join else inner join
  }
  function sort() {
  }
}

function refMap(init) {
  const outputs = new Set();
  const keyedOutputs = new Set();
  class RefMap extends Map {
    set(key, value) { markLateKey(key, keyedOutputs); return super.set(key, value); }
    delete(key) { markLateKey(key, keyedOutputs); return super.delete(key); }
    clear(key) { markAllLate(); return super.clear(); }
  }
  const wrapper = new RefMap(init);
  return {
    outputs,
    keyedOutputs,
    get value() {
      markUse(this);
      return wrapper;
    },
    set value(value) {
      markLate(this);
      markAllLate(this);
      inner = new RefMap(value);
    },
    ...mapMethods,
  };
}

function computedMap() {
  const outputs = new Set();
  const keyedOutputs = new Set();
  class ReadOnlyRefMap extends Map {
    set(key, value) { throw 'fail' }
    delete(key) { throw 'fail' }
    clear(key) { throw 'fail' }
  }
  const wrapper = new RefMap();
  return {
    outputs, keyedOutputs,
    late: true,
    allLate: true,
    lateKeys: new Set(),
    get value() {
      markUse(this);
      if (this.late || this.allLate || this.keyLate.length > 0) {
        usedRefs.push(this);
        recompute(this.allLate ? mapParent.keys() : this.keyLate);
        usedRefs.pop();
        this.late = false;
        this.keyLate = [];
      }
      return wrapper;
    },
    set value(value) { throw 'fail' },
    ...mapMethods,
  };
}

export {ref, computed};

/*
function StateExample() {
  const db = await Database('notes');
  const page = ref('loading');
  const selection = refMap();
  const notesTable = db.table('notes');
- const notes = refMap(notesTable).map(...).join(selection);
  const listPage = (() => {
    const query = ref('');
    const order = ref('priority');
    const listOrder = computed(() => {
      if (order.value == 'priority') {
        return notes.sort((id, note) => 1 - (Date.now() - note.lastReviewed) / arrayIndex(targetAge, note.priority));
      } else {
        return notes.sort(...);
      }
    });
    return Object.freeze({query, order, listOrder});
  }) ();
  const pageMap = new Map([
    ['list', return computed(() => ({
      url: {query: query.value, order: order.value},
      listOrder: listOrder.value,
    }))],
  ]);
  const pageState = computed(() => pageMap.get(page.value).value); // this auto-unwraps?
  const url = computed(() => return page.value + '/' + urlParams(pageState.value.url));
  function setPage(newPage) {
    page.value = newPage.page;
    if (newPage.page == 'list') {
      listPage.query.value = newPage.query ?? '';
      listPage.order.value = newPage.order ?? 'priority';
    }
  }
  function setUrl(url) {
    setPage(parse(url));
  }
  return Object.assign(observe({page, pageState, selection, notes, url}), {setPage, setUrl});
}
const state = StateExample();
state.setPage({ page: 'list' });
console.log(state.page.get());
*/

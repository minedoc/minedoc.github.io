// yes this is a clone of vue
// no early stopping
//   if you have object, equality is hard, values are easier
//   how likely is this going to be - measure in practice
// no garbage collection - all computations will remain forever
//   how likely is it that this fails
//
// ref -> computed, computedMap: sync
// computedMap -> computedMap: syncKeys
// computedMap -> ref: sync (if no syncKeys, update sync)
//
// can we hook directly to UI?
// div = myData.mapDom(template, (key, value, dom) => ...)
// div.value - evaluate the 'dom'
//
// how is bind implemented in Incremental (do they regen the deps?)

const usedRefs = [];

function invalidate(input) {
  for (const output of input.outputs) {
    if (output.sync) {
      output.sync = false;
      invalidate(output);
    }
  }
  for (const output of input.keyedOutputs) {
    if (output.sync) {
      output.sync = false;
      invalidate(output);
    }
  }
}

function invalidateKey(input, key) {
  for (const output of input.outputs) {
    if (output.sync) {
      output.sync = false;
      invalidate(output);
    }
  }
  for (const output of input.keyedOutputs) {
    if (output.sync) {
      output.syncKeys.add(key);
      invalidateKey(output, key);
    }
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
  let inner = init;
  const outputs = new Set();
  return {
    outputs,
    keyedOutputs: new Set(),
    get value() {
      markUse(this);
      return inner;
    },
    set value(value) {
      invalidate(this);
      inner = freeze(value);
    },
  };
}

function computed(fn) {
  let inner = undefined;
  const outputs = new Set();
  return {
    outputs,
    sync: false,
    get value() {
      markUse(this);
      if (!this.sync) {
        usedRefs.push(this);
        inner = fn(); console.log('call', fn, inner);
        usedRefs.pop();
        this.sync = false;
      }
      return inner;
    },
    set value(value) { throw 'fail' },
  };
}

const methods = {
  get: Symbol(),
  has: Symbol(),
  set: Symbol(),
  delete: Symbol(),
  clear: Symbol(),
};
class InternalMap extends Map {
  [methods.get](key) { return super.get(key); }
  [methods.has](key) { return super.has(key); }
  [methods.set](key, value) { super.set(key, value); return value; }
  [methods.delete](key) { return super.delete(key); }
  [methods.clear]() { super.clear(); }
}
class ReadOnlyMap extends InternalMap {
  set(key, value) { throw 'fail' }
  delete(key) { throw 'fail' }
  clear(key) { throw 'fail' }
}
const deletion = Symbol();

function mapMethods(src, parent) {
  function watch(targets, map) {
    for (const target of targets) {
      target.keyedOutputs.add(map);
    }
    return map;
  }
  function map(fn) { // k,v -> k,u
    function update(dest, keys) {
      src.syncNow();
      for (const key of keys) {
        const value = src[methods.get](key);
        const result = value === undefined ? undefined : fn(key, value);
        if (result == undefined) {
          dest[methods.delete](key);
        } else {
          dest[methods.set](key, result);
        }
      }
    }
    function updateAll(dest) {
      dest[methods.clear]();
      update(dest, src.keys());
    }
    return watch([parent], computedMap(update, updateAll));
  }
  function rekey(fn) {  // k,v -> (k,v -> Map<j,u>) -> j,Map<k,u>
    const keyMap = new ReadOnlyMap();
    function insert(dest, keys) {
      src.syncNow();
      for (const key of keys) {
        if (src[methods.has](key)) {
          for (const [newKey, newValue] of keyMap[methods.set](key, fn(key, src[methods.get](key)))) {
            const outMap = dest[methods.get](newKey) ?? dest[methods.set](newKey, new Map());
            outMap.set(key, newValue);
          }
        }
      }
    }
    function update(dest, keys) {
      for (const key of keys) {
        for (const [oldKey, oldValue] of (keyMap.get(key) ?? [])) {
          dest[methods.get](oldKey).delete(key);
        }
      }
      insert(dest, keys);
    }
    function updateAll(dest) {
      keyMap[methods.clear]();
      dest[methods.clear]();
      insert(dest, src.keys());
    }
    return watch([parent], computedMap(update, updateAll, parent));
  }
  function join(other, fn) {  // k,v -> k,u -> (v,u -> w) -> k,w
    function update(dest, key) {
      src.syncNow();
      const result = fn(key, src[methods.get](key), other.value[methods.get](key));  // BUG: should not use other.value
      if (result === undefined) {
        dest[methods.delete](key);
      } else {
        dest[methods.set](key, result);
      }
    }
    function updateAll(dest) {
      dest[methods.clear]();
      update(dest, src.keys());
    }
    return watch([parent, other.keyedOutputs], computedMap(update, () => 0, parent));
  }
  function sort(fn) {
    return computed(() => Array.from(src.value.entries()).sort(fn));  // costly fn tracking
  }
  return {map, rekey, join, sort};
}

function refMap(init) {
  const outputs = new Set();
  const keyedOutputs = new Set();
  class RefMap extends InternalMap {
    set(key, value) { invalidateKey(result, key); return super.set(key, value); }
    delete(key) { invalidateKey(result, key); return super.delete(key); }
    clear() { invalidate(result); super.clear(); }
  }
  const inner = new RefMap(init);
  inner.syncNow = () => 0;
  const result = {
    outputs,
    keyedOutputs,
    get value() {
      markUse(this);
      return inner;
    },
    set value(value) {
      invalidate(this);
      inner = new RefMap(value);
    },
  };
  Object.assign(result, mapMethods(inner, result));
  return result;
}

function computedMap(update, updateAll) {
  const outputs = new Set();
  const keyedOutputs = new Set();
  const inner = new ReadOnlyMap();
  const syncKeys = new Set();
  inner.syncNow = () => {
    if (!result.sync || syncKeys.size > 0) {
      usedRefs.push(result);
      if (!result.sync) {
        updateAll(inner);
      } else {
        update(inner, syncKeys);
      }
      usedRefs.pop();
      result.sync = true;
      syncKeys.clear();
    }
  }
  const result = {
    outputs,
    keyedOutputs,
    sync: false,
    syncKeys,
    get value() {
      markUse(this);
      inner.syncNow();
      return inner;
    },
    set value(value) { throw 'fail' },
  };
  Object.assign(result, mapMethods(inner, result));
  return result;
}

export {ref, computed, refMap, computedMap};

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

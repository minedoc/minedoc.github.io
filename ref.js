// design choices
//   mark dirty, compute on demand
//   no early stopping - requires push based + equality compare
//   no manual recompute() - getting consistency is hard (cant use integer wave, would need to eager evaluation?)

const computeStack = [];
const DELETE = Symbol('DELETE');
const FULL_UPDATE = Symbol('FULL_UPDATE');
const PARTIAL_UPDATE = Symbol('PARTIAL_UPDATE');
const UP_TO_DATE = Symbol('UP_TO_DATE');
var debug = false;
var log = args => unused => 0;

function toggleDebug() {
  debug = !debug;
  log = debug ? (...args) => console.log.bind(console, ...args.map(arg => deepClone(arg))) : args => unused => 0;
}

function baseRef(constructor, extend) {
  return function(init) {
    const outputs = new NotifySet();
    let value = constructor(init);
    function getRef() {
      outputs.saveCaller();
      return value;
    }
    function setRef(val) {
      log('set', val)();
      value = constructor(val);
      outputs.notify(FULL_UPDATE);
    }
    getRef.set = setRef;
    return extend(getRef, outputs);
  };
}

const ref = baseRef(init => freeze(init), (ref, outputs) => ref);
const refMap = baseRef(init => new ReadOnlyMap(init), (ref, outputs) => Object.assign(withRefMapMethods(ref), {
  set(key, value) { log('map set', key, value)(); Map.prototype.set.call(ref(), key, freeze(value)); outputs.notify(new Set([key])); return value; },
  delete(key) { log('map delete', key)(); Map.prototype.delete.call(ref(), key); outputs.notify(new Set([key])); },
  clear() { log('map clear')(); Map.prototype.clear.call(ref()); outputs.notify(FULL_UPDATE); },
}));

function computed(update, updateKeys, period=0) {
  let value = undefined;
  let state = FULL_UPDATE;
  const modifiedKeys = new Set();
  const outputs = new NotifySet();
  const notify = debounce(period, keys => {
    if (updateKeys === undefined || keys === FULL_UPDATE) {
      state = FULL_UPDATE;
      outputs.notify(FULL_UPDATE);
    } else {
      if (state != FULL_UPDATE) {
        state = PARTIAL_UPDATE;
      }
      if (keys !== PARTIAL_UPDATE) {
        for (const key of keys) {
          modifiedKeys.add(key);
        }
      }
      outputs.notify(PARTIAL_UPDATE);
    }
  });
  return function getComputed() {
    outputs.saveCaller();
    if (state == FULL_UPDATE || state == PARTIAL_UPDATE) {
      var childKeys = undefined;
      computeStack.push(notify);
      if (debug) { console.group(); }
      try {
        if (state == FULL_UPDATE) {
          value = update();
        } else if (state == PARTIAL_UPDATE) {
          childKeys = updateKeys(value, () => modifiedKeys);
        }
      } finally {
        computeStack.pop();
        if (debug) { console.groupEnd(); }
      }
      if (childKeys) {  // childKeys may equal modifiedKeys, cannot clear modifiedKeys
        outputs.notify(childKeys);
      }
      modifiedKeys.clear();
      state = UP_TO_DATE;
    }
    return value;
  }
}

function localStorageVar(name, ctor, params) {
  var valStr;
  const value = ctor();
  const saver = debounce(500, () => localStorage.setItem(name, valStr));
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

const computedMap = fn => withRefMapMethods(computed(fn));

export {ref, refMap, computed, computedMap, DELETE, toggleDebug, localStorageRef, localStorageRefMap};

class NotifySet {
  constructor() {
    this.clients = new IterableWeakSet();
  }
  saveCaller() {
    if(computeStack.length > 0) {
      this.clients.add(computeStack[computeStack.length - 1]);
    }
  }
  notify(value) {
    for (const fn of this.clients) {
      fn(value);
    }
  }
}

const withRefMapMethods = ref => Object.assign(ref, {
  map(fn) { return leftJoin(ref, [], fn) },
  filter(fn) { return filter(ref, fn) },
  leftJoin(refs, fn) { return leftJoin(ref, refs, fn) },
  outerJoin(refs, fn) { return outerJoin([ref, ...refs], fn); },
  groupBy(fn) { return groupBy(ref, fn) },
});

function filter(srcRef, fn) {  // {k,v} -> (k, v -> bool) -> {k, v}
  function updateFilter() {
    const src = srcRef();
    const out = new ReadOnlyMap();
    insertFilter(src, out, src.keys());
    return out;
  }
  function updateFilterByKey(dest, keyFn) {
    const src = srcRef();
    const keys = keyFn();
    return insertFilter(src, dest, keys);
  }
  function insertFilter(src, dest, keys) {
    log('filter start', new Map(dest), fn)();
    for (const key of keys) {
      if (src.has(key)) {
        const value = src.get(key);
        log({key, src, inputs: [key, value], output: fn(key, value)})();
        mapPut(dest, key, fn(key, value) ? value : DELETE);
      } else {
        log({key, src, output: 'parent gone DELETE'})();
        mapPut(dest, key, DELETE);
      }
    }
    log('filter done', new Map(dest))();
    return keys;
  }
  return withRefMapMethods(computed(updateFilter, updateFilterByKey));
}

function leftJoin(srcRef, joinRefs, fn) {  // {k,v} -> [{k,u}] -> (v,...u -> w) -> k,w
  function updateLeftJoin() {
    const src = srcRef();
    const out = new ReadOnlyMap();
    insertLeftJoin(src, out, src.keys());
    return out;
  }
  function updateLeftJoinByKey(dest, keyFn) {
    const src = srcRef();
    const keys = keyFn();
    return insertLeftJoin(src, dest, keys);
  }
  function insertLeftJoin(src, dest, keys) {
    const join = [];
    for (const ref of joinRefs) {
      join.push(ref());
    }
    log('leftJoin start', new Map(dest), fn)();
    for (const key of keys) {
      if (src.has(key)) {
        log({key, inputs: [src.get(key), ...join.map(j => j.get(key))], output: fn(key, src.get(key), ...join.map(j => j.get(key)))})();
        mapPut(dest, key, fn(key, src.get(key), ...join.map(j => j.get(key))));
      } else {
        log({key, src, output: 'parent gone DELETE'})();
        mapPut(dest, key, DELETE);
      }
    }
    log('leftJoin done', new Map(dest))();
    return keys;
  }
  return withRefMapMethods(computed(updateLeftJoin, updateLeftJoinByKey));
}

function outerJoin(refs, fn) {  // [{k,u}] -> (...u -> w) -> k,w
  // Note: must deal with fully empty - fn(undefined, undefined)
  function updateOuterJoin() {
    const src = refs.map(x => x());
    const out = new ReadOnlyMap();
    insertOuterJoin(src, out, new Set(src.flatMap(x => Array.from(x.keys()))));
    return out;
  }
  function updateOuterJoinByKey(dest, keyFn) {
    const srcs = refs.map(x => x());
    const keys = keyFn();
    return insertOuterJoin(srcs, dest, keys);
  }
  function insertOuterJoin(srcs, dest, keys) {
    log('outerJoin start', new Map(dest), fn)();
    for (const key of keys) {
      log({key, inputs: srcs.map(j => j.get(key)), output: fn(key, ...srcs.map(j => j.get(key)))})();
      mapPut(dest, key, fn(key, ...srcs.map(j => j.get(key))));
    }
    log('outerJoin done', new Map(dest))();
    return keys;
  }
  return withRefMapMethods(computed(updateOuterJoin, updateOuterJoinByKey));
}

function groupBy(srcRef, fn) {  // k,v -> (k,v -> Map<j,u>) -> j,Map<k,u>
  const keyMap = new Map();
  function updateGroupBy() {
    const src = srcRef();
    const out = new ReadOnlyMap();
    keyMap.clear();
    insertGroupBy(src, out, src.keys());
    return out;
  }
  function updateGroupByByKey(dest, keyFn) {
    const src = srcRef();
    const keys = keyFn();
    return insertGroupBy(src, dest, keys);
  }
  function insertGroupBy(src, dest, keys) {
    log('groupBy start', new Map(dest), fn)();
    const difference = new Set();
    for (const key of keys) {
      const toDeleteKeys = keyMap.get(key) || new Set();
      const toAdd = src.has(key) ? fn(key, src.get(key)) : new Map();
      const toAddKeys = new Set(toAdd.keys());
      keyMap.set(key, toAddKeys);

      // TODO: optimize this to not do duplication of work
      for (const deleteKey of toDeleteKeys) {
        if (!toAddKeys.has(deleteKey)) {
          difference.add(deleteKey);
          log('delete', {key, deleteKey})();
          const inner = dest.get(deleteKey);
          if (inner.size == 1) {
            Map.prototype.delete.call(dest, deleteKey);
          } else {
            inner.delete(key);
          }
        }
      }
      for (const [addKey, addValue] of toAdd) {
        if (!toDeleteKeys.has(addKey)) {
          difference.add(addKey);
          log('add', {key, addKey, addValue})();
          if (dest.has(addKey)) {
            dest.get(addKey).set(key, addValue);
          } else {
            mapPut(dest, addKey, new Map()).set(key, addValue);
          }
        }
      }
    }
    log('groupBy done', new Map(dest), difference)();
    return difference;
  }
  return withRefMapMethods(computed(updateGroupBy, updateGroupByByKey));
}

// utility

class ReadOnlyMap extends Map {
  set(key, value) { throw 'cannot modify ReadOnlyMap' }
  delete(key) { throw 'cannot modify ReadOnlyMap' }
  clear(key) { throw 'cannot modify ReadOnlyMap' }
}

function mapPut(map, key, value) {
  if (value === DELETE) {
    Map.prototype.delete.call(map, key);
  } else {
    Map.prototype.set.call(map, key, value);
  }
  return value;
}

function freeze(x) {
  if (typeof x == 'object' && x != null) {
    Object.freeze(x);
    Object.keys(x).forEach(p => freeze(x[p]));
  }
  return x;
}

class IterableWeakSet {
  constructor() {
    this.setWeak = new Set();  // to be iterated
    this.weakSet = new WeakSet();  // prevent add() duplicates
  }
  add(item) {
    if (!this.weakSet.has(item)) {
      this.setWeak.add(new WeakRef(item));
      this.weakSet.add(item);
    }
  }
  [Symbol.iterator]() {
    const values = [];
    this.setWeak.forEach(x => {
      const value = x.deref();
      if (value) {
        values.push(value);
      } else {
        this.setWeak.delete(x);
      }
    });
    return values[Symbol.iterator]();
  }
}

function debounce(period, fn) {
  if (period == 0) {
    return fn;
  } else {
    let lastTime = 0;
    const saved = [];
    return param => {
      if (lastTime < Date.now() - period) {
        fn(param);
        setTimeout(() => lastTime = Date.now(), 50);
        setTimeout(() => {
          if (saved.length > 0) {
            saved.map(fn);
            saved.length = 0;
            setTimeout(() => lastTime = Date.now(), 50);
          }
        }, period);
      } else {
        saved.push(param);
      }
    };
  }
}

function deepClone(x) {
  if (typeof x == 'object') {
    if (x instanceof Map) {
      const out = new Map();
      for (const [key, value] of x) {
        out.set(deepClone(key), deepClone(value));
      }
      return out;
    } else if (x instanceof Set) {
      const out = new Set();
      for (const key of x) {
        out.add(deepClone(key));
      }
      return out;
    } else {
      const out = x instanceof Array ? [] : {};
      for (const [key, value] of Object.entries(x)) {
        out[key] = deepClone(value);
      }
      return out;
    }
  } else {
    return x;
  }
}

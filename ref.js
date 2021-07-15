// design choices
//   pull driven
//   no early stopping - requires push based + equality compare
//   no manual recompute() - getting consistency is hard (cant use integer wave, would need to eager evaluation?)

const computeStack = [];
const DELETE = Symbol('DELETE');
const FULL_UPDATE = Symbol('FULL_UPDATE');

function baseRef(constructor, methods) {
  return function(init) {
    const outputs = new NotifySet();
    let value = constructor(init);
    const get = () => {
      outputs.saveCaller();
      return value;
    };
    const set = val => {
      value = constructor(val);
      outputs.notify(FULL_UPDATE);
    };
    return Object.assign(get, {set}, methods(get, outputs));
  };
}

const ref = baseRef(init => freeze(init), (get, outputs) => null);
const refMap = baseRef(init => new ReadOnlyMap(init), (ref, outputs) => ({
  ...mapMethods(ref),
  set(key, value) { outputs.notify(key); return Map.prototype.set.call(ref(), key, freeze(value)); },
  delete(key) { outputs.notify(key); return Map.prototype.delete.call(ref(), key); },
  clear() { outputs.notify(FULL_UPDATE); return Map.prototype.clear.call(ref()); },
}));

function computed(update, updateKeys, period=0) {
  let value = undefined;
  let dirty = true;
  let keys = [];
  const outputs = new NotifySet();
  const notify = debounce(period, key => {  // TODO: would like to check !dirty but doesn't work
    if (updateKeys === undefined || key === FULL_UPDATE) {
      dirty = true;
      outputs.notify(FULL_UPDATE);
    } else {
      keys.push(key);
      outputs.notify(key);
    }
  });
  return () => {
    outputs.saveCaller();
    if (dirty || keys.length > 0) {
      computeStack.push(notify);
      try {
        if (dirty) {
          value = update(); // console.log('update', value);
        } else {
          updateKeys(value, keys); // console.log('updateKeys', keys, value);
        }
      } finally {
        computeStack.pop();
      }
      dirty = false;
      keys.length = 0;
    }
    return value;
  };
}

function computedMap(fn, period=0) {
  const output = computed(fn, undefined, period);
  return Object.assign(output, mapMethods(output));
}

export {ref, refMap, computed, computedMap, DELETE};

class NotifySet {
  constructor() {
    this.clients = new IterableWeakSet();
  }
  saveCaller(x) {
    if(computeStack.length > 0) {
      this.clients.add(computeStack[computeStack.length - 1]);
    }
  }
  notify(value) {
    this.clients.forEach(fn => fn(value));
  }
}

const mapMethods = ref => ({
  map(fn) { return join(ref, [], fn) },
  filter(fn) { return join(ref, [], (k, v) => fn(k, v) ? v : DELETE) },
  join(refs, fn) { return join(ref, refs, fn) },
  groupBy(fn) { return groupBy(ref, fn) },
})

function join(srcRef, joinRefs, fn) {  // {k,v} -> [{k,u}] -> (v,[u] -> w) -> k,w
  function updateJoin() {
    const src = srcRef();
    return insert(src, new ReadOnlyMap(), src.keys());
  }
  function updateJoinByKey(dest, keys) {
    insert(srcRef(), dest, keys);
  }
  function insert(src, dest, keys) {
    const join = joinRefs.map(x => x());
    for (const key of keys) {
      mapPut(dest, key, src.has(key) ? fn(key, src.get(key), ...join.map(j => j.get(key))) : DELETE);
    }
    return dest;
  }
  const output = computed(updateJoin, updateJoinByKey);
  return Object.assign(output, mapMethods(output));
}

function groupBy(srcRef, fn) {  // k,v -> (k,v -> Map<j,u>) -> j,Map<k,u>
  const keyMap = new Map();
  const keyMapDelete = key => { const a = keyMap.get(key); keyMap.delete(key); return a || []; };
  const keyMapSet = (key, value) => { keyMap.set(key, value); return value };
  function updateGroupby() {
    const src = srcRef();
    keyMap.clear();
    return insert(src, new ReadOnlyMap(), src.keys());
  }
  function updateGroupbyByKey(dest, keys) {
    insert(srcRef(), dest, keys);
  }
  function insert(src, dest, keys) {
    const get = key => dest.get(key) ?? mapPut(dest, key, new Map());
    for (const key of keys) {
      for (const newKey of keyMapDelete(key)) {
        get(newKey).delete(key);
      }
      for (const [newKey, newValue] of src.has(key) ? keyMapSet(key, fn(key, src.get(key))) : []) {
        get(newKey).set(key, newValue);
      }
    }
    return dest;
  }
  const output = computed(updateGroupby, updateGroupbyByKey);
  return Object.assign(output, mapMethods(output));
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
  forEach(fn) {
    this.setWeak.forEach(x => {
      const value = x.deref();
      if (value) {
        fn(value);
      } else {
        this.setWeak.delete(x);
      }
    });
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

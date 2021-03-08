// no early stopping
//   equality check is expensive, maybe some super heavy nodes want this
//   converts evaluation from leaf up to root down (quite difficult)
//   measure if this is common in practice
// no garbage collection yet
//   all computations will remain forever
//
// can we hook directly to UI?

const computeStack = [];

function baseRef(constructor, methods) {
  return function(init) {
    const outputs = new Set();
    let inner = constructor(init, outputs);  // old inners can still trigger change events!
    return Object.assign({
      get value() {
        saveOutputs(outputs);
        return inner;
      },
      set value(init) {
        outputs.forEach(output => output(undefined));
        inner = constructor(init, outputs);
      },
    }, methods);
  };
}

const ref = baseRef((init, outputs) => freeze(init));

const mapMethods = {
  select(fn) { return select(this, fn) },
  join(other, fn) { return join(this, other, fn) },
  groupby(fn) { return groupby(this, fn) },
};

const refMap = baseRef((init, outputs) => new RefMap(init, outputs), mapMethods);

function computed(updateAll, updateKeys) {
  let inner = new ReadOnlyMap();
  let sync = false;
  const syncKeys = new Set();
  const outputs = new Set();
  const notify = key => {
    if (sync) {
      if (updateKeys === undefined || key === undefined) {
        sync = false;
        outputs.forEach(output => output(undefined));
      } else {
        syncKeys.add(key);
        outputs.forEach(output => output(key));
      }
    }
  };
  return {
    get value() {
      saveOutputs(outputs);
      if (!sync || syncKeys.size > 0) {
        computeStack.push(notify);
        if (sync) {
          updateKeys(inner, syncKeys); console.log('updateKeys', syncKeys, inner);
        } else {
          inner = updateAll(inner); console.log('updateAll', inner);
        }
        computeStack.pop();
        sync = true;
        syncKeys.clear();
      }
      return inner;
    },
    set value(init) { throw 'cannot set computed' },
  };
}

export {ref, refMap, computed};

function select(srcRef, fn) { // k,v -> (k,v -> Maybe u) -> k,u
  function updateKeys(dest, keys) {
    const src = srcRef.value;
    for (const key of keys) {
      const value = src.get(key);
      mapSave(dest, key, value === undefined ? undefined : fn(key, value));
    }
  }
  function updateAll(dest) {
    dest[privateMethod.clear]();
    updateKeys(dest, srcRef.value.keys());
    return dest;
  }
  return Object.assign(computed(updateAll, updateKeys), mapMethods);
}

function join(leftRef, rightRef, fn) {  // k,v -> k,u -> (v,u -> Maybe w) -> k,w
  function updateKeys(dest, keys) {
    const left = leftRef.value;
    const right = rightRef.value;
    for (const key of keys) {
      const value = left.get(key);
      mapSave(dest, key, value === undefined ? undefined : fn(key, value, right.get(key)));
    }
  }
  function updateAll(dest) {
    dest[privateMethod.clear]();
    updateKeys(dest, leftRef.value.keys());
    return dest;
  }
  return Object.assign(computed(updateAll, updateKeys), mapMethods);
}

function groupby(srcRef, fn) {  // k,v -> (k,v -> Map<j,u>) -> j,Map<k,u>
  const keyMap = new Map();
  const getDef = (dest, key) => dest.get(key) ?? dest[privateMethod.set](key, new Map());
  const setMap = (dest, key, value) => { dest.set(key, value); return value };
  function insert(src, dest, key) {
    const value = src.get(key);
    if (value !== undefined) {
      for (const [newKey, newValue] of setMap(keyMap, key, fn(key, value))) {
        getDef(dest, newKey).set(key, newValue);
      }
    }
  }
  function updateKeys(dest, keys) {
    const src = srcRef.value;
    for (const key of keys) {
      const pairs = keyMap.get(key);
      if (pairs !== undefined) {
        for (const [newKey, newValue] of pairs) {
          const dmap = dest.get(newKey);
          if (dmap.size > 1) {
            dmap.delete(key);
          } else {
            dest[privateMethod.delete](newKey);
          }
        }
        pairs.clear();
      }
      insert(src, dest, key);
    }
  }
  function updateAll(dest) {
    keyMap.clear();
    dest[privateMethod.clear]();
    const src = srcRef.value;
    for (const key of src.keys()) {
      insert(src, dest, key);
    }
    return dest;
  }
  return Object.assign(computed(updateAll, updateKeys), mapMethods);
}

function saveOutputs(outputs) {
  if(computeStack.length > 0) {
    outputs.add(computeStack[computeStack.length - 1]);
  }
}

const privateMethod = { set: Symbol(), delete: Symbol(), clear: Symbol(), notify: Symbol() };

class InternalMap extends Map {
  [privateMethod.set](key, value) { super.set(key, value); return value; }
  [privateMethod.delete](key) { return super.delete(key); }
  [privateMethod.clear]() { super.clear(); }
}

class RefMap extends InternalMap {
  constructor(init, outputs) { super(init); this.outputs = outputs; }
  [privateMethod.notify](key) { if (this.outputs) { this.outputs.forEach(output => output(key)) } }
  set(key, value) { this[privateMethod.notify](key); return super.set(key, freeze(value)); }
  delete(key) { this[privateMethod.notify](key); return super.delete(key); }
  clear() { this[privateMethod.notify](undefined); super.clear(); }
}

class ReadOnlyMap extends InternalMap {
  set(key, value) { throw 'cannot modify ReadOnlyMap' }
  delete(key) { throw 'cannot modify ReadOnlyMap' }
  clear(key) { throw 'cannot modify ReadOnlyMap' }
}

function freeze(x) {
  if (typeof x == 'object' && x != null) {
    Object.freeze(x);
    Object.keys(x).forEach(p => freeze(x[p]));
  }
  return x;
}

function mapSave(dest, key, value) {
  if (value == undefined) {
    dest[privateMethod.delete](key);
  } else {
    dest[privateMethod.set](key, value);
  }
}


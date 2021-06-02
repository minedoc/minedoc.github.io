'use strict';

// terrible attempt to clone angular
var ProxyDom = function(element) {
  this.element = element;
  this.childs = [];
  this._text = '';
  this._attr = {};
  this._class = {};
}
ProxyDom.prototype.onChange = function(fn) {
  this.element.addEventListener('change', fn);
};
ProxyDom.prototype.text = function(text) {
  if (this._text !== text) {
    this.element.innerText = text;
    this._text = text;
  }
  return this;
};
ProxyDom.prototype.unsafe_html = function(html) {
  this.element.innerHTML = html;
  return this;
};
ProxyDom.prototype.value = function(value) {
  this.element.value = value;
  return this;
};
ProxyDom.prototype.attr = function(name, value) {
  if (this._attr[name] !== value) {
    this.element.setAttribute(name, value);
    this._attr[name] = value;
  }
  return this;
};
ProxyDom.prototype.class = function(name, value) {
  if (this._class[name] !== value) {
    this.element.classList.toggle(name, value);
    this._class[name] = value;
  }
  return this;
};
ProxyDom.prototype.repeat = function(template, items, ...mixin) {
  var childs = this.childs;
  var element = this.element;
  var childsBuilt = childs.length;
  var childsInDom = this.element.children.length;
  var childsBuiltNeeded = Math.min(items.length, childsBuilt);
  for(var i=0; i<childsBuiltNeeded; i++) {
    let tmp = childs[i].update(items[i], ...mixin);
    if(i >= childsInDom) {
      element.appendChild(tmp.dom);
    }
  }
  for(var i=childsBuiltNeeded, n=items.length; i<n; i++) {
    let tmp = childs[i] = template(items[i], ...mixin);
    if(i >= childsInDom) {
      element.appendChild(tmp.dom);
    }
  }
  deleteAfter(this.element.children[items.length]);
  return this;
};

function deleteAfter(cursor) {
  while (cursor) {
    var remove = cursor,
      cursor = cursor.nextSibling;
    remove.remove();
  }
}

function template(name, render) {
  var base = document.querySelector('[data-template=' + name + ']');
  base.remove();
  base.removeAttribute('data-template');
  Array.prototype.map.call(base.querySelectorAll('[data-template]'), function(element) {
    document.body.appendChild(element);
  });
  return function(data, ...mixin) {
    let clone = base.cloneNode(true);
    let elements = { root: new ProxyDom(clone) };
    let output = {
      dom: clone,
      elements: elements,
      update: function(data, ...mixin) {
        render(elements, data, ...mixin);
        return output;
      },
    };
    Array.prototype.map.call(clone.querySelectorAll('[data-bind]'), (e) => {
      elements[e.getAttribute('data-bind')] = new ProxyDom(e);
      e.removeAttribute('data-bind');
    });
    return output.update(data, ...mixin);
  };
};

function dateAsSeconds(date) {
  let now = Date.now();
  let then = Date.parse(date)
  let diff = now - then;
  return Math.floor(diff / 1000);
}

function dateAsAge(date) {
  let seconds = dateAsSeconds(date);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(seconds / 60 / 60);
  let days = Math.floor(seconds / 60 / 60 / 24);
  let months = Math.floor(seconds / 60 / 60 / 24 / 30);
  let years = Math.floor(seconds / 60 / 60 / 24 / 365 * 10) / 10;
  if (years > 1) {
    return years + 'y';
  } else if (months > 0) {
    return months + 'M';
  } else if (days > 0) {
    return days + 'd';
  } else if (hours > 0) {
    return hours + 'h';
  } else {
    return minutes + 'm';
  }
}

function getAttr(e, attribute) {
  let target = e.closest('[' + attribute + ']');
  return target ? target.getAttribute(attribute) : null;
}

function addFastTouch(fn) {
  // touchend is too slow. will stop accepting clicks if any touch happens.
  var touched = false;
  var start, startX, startY;
  document.body.addEventListener('touchstart', function(event) {
    touched = true;
    start = +new Date();
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, {capture: true, passive: true});
  document.body.addEventListener('touchend', function(event) {
    var time = (+new Date()) - start;
    var space = Math.abs(event.changedTouches[0].clientX - startX) + Math.abs(event.changedTouches[0].clientY - startY);
    var touches = event.touches.length + event.changedTouches.length;
    if(touches == 1 && time < 1000 && space < 10) {
      fn(event);
    }
  }, {capture: true, passive: true});
  document.body.addEventListener('mousedown', function(event) {
    if(!touched) {
      fn(event);
    }
  }, {capture: true, passive: true});
}

function debuggingShowErrors() {
  window.onerror = function(msg, file, line, col, error) {
     alert("Error:\nfile: " + file + "\nline: " + line + '\n' + error);
  };
}

function dedup(fn) {
  var timeout = null;
  var args = [];
  return function(duration) {
    args = Array.prototype.slice.call(arguments, 1);
    if (timeout) {
      clearTimeout(timeout);
    }
    if (duration == 0) {
      fn.apply(null, args);
    } else {
      timeout = setTimeout(function() {
        fn.apply(null, args);
      }, duration);
    }
  };
}

var wakelockVideo = undefined;
function wakelock() {
  if (!wakelockVideo) {
    wakelockVideo = document.createElement('video');
    wakelockVideo.setAttribute('playsinline', '');
    wakelockVideo.setAttribute('src', 'data:video/mp4;base64, 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');
    wakelockVideo.playbackRate = 0;
  }
  if (wakelockVideo.paused) {
    wakelockVideo.play();
  }
}

export {template};

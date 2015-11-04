/**
 * Copyright (c) 2014, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

!(function(global) {
  "use strict";

  var hasOwn = Object.prototype.hasOwnProperty;
  var undefined; // More compressible than void 0.
  var iteratorSymbol =
    typeof Symbol === "function" && Symbol.iterator || "@@iterator";

  var inModule = typeof module === "object";
  var runtime = global.regeneratorRuntime;
  if (runtime) {
    if (inModule) {
      // If regeneratorRuntime is defined globally and we're in a module,
      // make the exports object identical to regeneratorRuntime.
      module.exports = runtime;
    }
    // Don't bother evaluating the rest of this file if the runtime was
    // already defined globally.
    return;
  }

  // Define the runtime globally (as expected by generated code) as either
  // module.exports (if we're in a module) or a new, empty object.
  runtime = global.regeneratorRuntime = inModule ? module.exports : {};

  function wrap(innerFn, outerFn, self, tryLocsList) {
    // If outerFn provided, then outerFn.prototype instanceof Generator.
    var generator = Object.create((outerFn || Generator).prototype);
    var context = new Context(tryLocsList || []);

    // The ._invoke method unifies the implementations of the .next,
    // .throw, and .return methods.
    generator._invoke = makeInvokeMethod(innerFn, self, context);

    return generator;
  }
  runtime.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  var Gp = GeneratorFunctionPrototype.prototype = Generator.prototype;
  GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
  GeneratorFunctionPrototype.constructor = GeneratorFunction;
  GeneratorFunction.displayName = "GeneratorFunction";

  // Helper for defining the .next, .throw, and .return methods of the
  // Iterator interface in terms of a single ._invoke method.
  function defineIteratorMethods(prototype) {
    ["next", "throw", "return"].forEach(function(method) {
      prototype[method] = function(arg) {
        return this._invoke(method, arg);
      };
    });
  }

  runtime.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  runtime.mark = function(genFun) {
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
    } else {
      genFun.__proto__ = GeneratorFunctionPrototype;
    }
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  // Within the body of any async function, `await x` is transformed to
  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
  // `value instanceof AwaitArgument` to determine if the yielded value is
  // meant to be awaited. Some may consider the name of this method too
  // cutesy, but they are curmudgeons.
  runtime.awrap = function(arg) {
    return new AwaitArgument(arg);
  };

  function AwaitArgument(arg) {
    this.arg = arg;
  }

  function AsyncIterator(generator) {
    function invoke(method, arg, resolve, reject) {
      var record = tryCatch(generator[method], generator, arg);
      if (record.type === "throw") {
        reject(record.arg);
      } else {
        var result = record.arg;
        var value = result.value;
        if (value instanceof AwaitArgument) {
          return Promise.resolve(value.arg).then(function(value) {
            invoke("next", value, resolve, reject);
          }, function(err) {
            invoke("throw", err, resolve, reject);
          });
        }

        return Promise.resolve(value).then(function(unwrapped) {
          // When a yielded Promise is resolved, its final value becomes
          // the .value of the Promise<{value,done}> result for the
          // current iteration. If the Promise is rejected, however, the
          // result for this iteration will be rejected with the same
          // reason. Note that rejections of yielded Promises are not
          // thrown back into the generator function, as is the case
          // when an awaited Promise is rejected. This difference in
          // behavior between yield and await is important, because it
          // allows the consumer to decide what to do with the yielded
          // rejection (swallow it and continue, manually .throw it back
          // into the generator, abandon iteration, whatever). With
          // await, by contrast, there is no opportunity to examine the
          // rejection reason outside the generator function, so the
          // only option is to throw it from the await expression, and
          // let the generator function handle the exception.
          result.value = unwrapped;
          resolve(result);
        }, reject);
      }
    }

    if (typeof process === "object" && process.domain) {
      invoke = process.domain.bind(invoke);
    }

    var previousPromise;

    function enqueue(method, arg) {
      function callInvokeWithMethodAndArg() {
        return new Promise(function(resolve, reject) {
          invoke(method, arg, resolve, reject);
        });
      }

      return previousPromise =
        // If enqueue has been called before, then we want to wait until
        // all previous Promises have been resolved before calling invoke,
        // so that results are always delivered in the correct order. If
        // enqueue has not been called before, then it is important to
        // call invoke immediately, without waiting on a callback to fire,
        // so that the async generator function has the opportunity to do
        // any necessary setup in a predictable way. This predictability
        // is why the Promise constructor synchronously invokes its
        // executor callback, and why async functions synchronously
        // execute code before the first await. Since we implement simple
        // async functions in terms of async generators, it is especially
        // important to get this right, even though it requires care.
        previousPromise ? previousPromise.then(
          callInvokeWithMethodAndArg,
          // Avoid propagating failures to Promises returned by later
          // invocations of the iterator.
          callInvokeWithMethodAndArg
        ) : callInvokeWithMethodAndArg();
    }

    // Define the unified helper method that is used to implement .next,
    // .throw, and .return (see defineIteratorMethods).
    this._invoke = enqueue;
  }

  defineIteratorMethods(AsyncIterator.prototype);

  // Note that simple async functions are implemented on top of
  // AsyncIterator objects; they just return a Promise for the value of
  // the final result produced by the iterator.
  runtime.async = function(innerFn, outerFn, self, tryLocsList) {
    var iter = new AsyncIterator(
      wrap(innerFn, outerFn, self, tryLocsList)
    );

    return runtime.isGeneratorFunction(outerFn)
      ? iter // If outerFn is a generator, return the full iterator.
      : iter.next().then(function(result) {
          return result.done ? result.value : iter.next();
        });
  };

  function makeInvokeMethod(innerFn, self, context) {
    var state = GenStateSuspendedStart;

    return function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        if (method === "throw") {
          throw arg;
        }

        // Be forgiving, per 25.3.3.3.3 of the spec:
        // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
        return doneResult();
      }

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          if (method === "return" ||
              (method === "throw" && delegate.iterator[method] === undefined)) {
            // A return or throw (when the delegate iterator has no throw
            // method) always terminates the yield* loop.
            context.delegate = null;

            // If the delegate iterator has a return method, give it a
            // chance to clean up.
            var returnMethod = delegate.iterator["return"];
            if (returnMethod) {
              var record = tryCatch(returnMethod, delegate.iterator, arg);
              if (record.type === "throw") {
                // If the return method threw an exception, let that
                // exception prevail over the original return or throw.
                method = "throw";
                arg = record.arg;
                continue;
              }
            }

            if (method === "return") {
              // Continue with the outer return, now that the delegate
              // iterator has been terminated.
              continue;
            }
          }

          var record = tryCatch(
            delegate.iterator[method],
            delegate.iterator,
            arg
          );

          if (record.type === "throw") {
            context.delegate = null;

            // Like returning generator.throw(uncaught), but without the
            // overhead of an extra function call.
            method = "throw";
            arg = record.arg;
            continue;
          }

          // Delegate generator ran and handled its own exceptions so
          // regardless of what the method was, we continue as if it is
          // "next" with an undefined arg.
          method = "next";
          arg = undefined;

          var info = record.arg;
          if (info.done) {
            context[delegate.resultName] = info.value;
            context.next = delegate.nextLoc;
          } else {
            state = GenStateSuspendedYield;
            return info;
          }

          context.delegate = null;
        }

        if (method === "next") {
          if (state === GenStateSuspendedYield) {
            context.sent = arg;
          } else {
            context.sent = undefined;
          }

        } else if (method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw arg;
          }

          if (context.dispatchException(arg)) {
            // If the dispatched exception was caught by a catch block,
            // then let that catch block handle the exception normally.
            method = "next";
            arg = undefined;
          }

        } else if (method === "return") {
          context.abrupt("return", arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          var info = {
            value: record.arg,
            done: context.done
          };

          if (record.arg === ContinueSentinel) {
            if (context.delegate && method === "next") {
              // Deliberately forget the last sent value so that we don't
              // accidentally pass it on to the delegate.
              arg = undefined;
            }
          } else {
            return info;
          }

        } else if (record.type === "throw") {
          state = GenStateCompleted;
          // Dispatch the exception by looping back around to the
          // context.dispatchException(arg) call above.
          method = "throw";
          arg = record.arg;
        }
      }
    };
  }

  // Define Generator.prototype.{next,throw,return} in terms of the
  // unified ._invoke helper method.
  defineIteratorMethods(Gp);

  Gp[iteratorSymbol] = function() {
    return this;
  };

  Gp.toString = function() {
    return "[object Generator]";
  };

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset(true);
  }

  runtime.keys = function(object) {
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    // Return an iterator with no values.
    return { next: doneResult };
  }
  runtime.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function(skipTempReset) {
      this.prev = 0;
      this.next = 0;
      this.sent = undefined;
      this.done = false;
      this.delegate = null;

      this.tryEntries.forEach(resetTryEntry);

      if (!skipTempReset) {
        for (var name in this) {
          // Not sure about the optimal order of these conditions:
          if (name.charAt(0) === "t" &&
              hasOwn.call(this, name) &&
              !isNaN(+name.slice(1))) {
            this[name] = undefined;
          }
        }
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;
        return !!caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    abrupt: function(type, arg) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") &&
            this.prev < entry.finallyLoc) {
          var finallyEntry = entry;
          break;
        }
      }

      if (finallyEntry &&
          (type === "break" ||
           type === "continue") &&
          finallyEntry.tryLoc <= arg &&
          arg <= finallyEntry.finallyLoc) {
        // Ignore the finally entry if control is not jumping to a
        // location outside the try/catch block.
        finallyEntry = null;
      }

      var record = finallyEntry ? finallyEntry.completion : {};
      record.type = type;
      record.arg = arg;

      if (finallyEntry) {
        this.next = finallyEntry.finallyLoc;
      } else {
        this.complete(record);
      }

      return ContinueSentinel;
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = record.arg;
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }
    },

    finish: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.finallyLoc === finallyLoc) {
          this.complete(entry.completion, entry.afterLoc);
          resetTryEntry(entry);
          return ContinueSentinel;
        }
      }
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      return ContinueSentinel;
    }
  };
})(
  // Among the various tricks for obtaining a reference to the global
  // object, this seems to be the most reliable technique that does not
  // use indirect eval (which violates Content Security Policy).
  typeof global === "object" ? global :
  typeof window === "object" ? window :
  typeof self === "object" ? self : this
);


if (!Object.assign) {
    Object.defineProperty(Object, 'assign', {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function(target) {
            'use strict';
            if (target === undefined || target === null) {
                throw new TypeError('Cannot convert first argument to object');
            }

            var to = Object(target);
            for (var i = 1; i < arguments.length; i++) {
                var nextSource = arguments[i];
                if (nextSource === undefined || nextSource === null) {
                    continue;
                }
                nextSource = Object(nextSource);

                var keysArray = Object.keys(nextSource);
                for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
                    var nextKey = keysArray[nextIndex];
                    var desc = Object.getOwnPropertyDescriptor(nextSource, nextKey);
                    if (desc !== undefined && desc.enumerable) {
                        to[nextKey] = nextSource[nextKey];
                    }
                }
            }
            return to;
        }
    });
}
/*
 * $Id: object-clone.js,v 0.41 2013/03/27 18:29:04 dankogai Exp dankogai $
 *
 *  Licensed under the MIT license.
 *  http://www.opensource.org/licenses/mit-license.php
 *
 */

(function(global) {
    'use strict';
    if (!Object.freeze || typeof Object.freeze !== 'function') {
        throw Error('ES5 support required');
    }
    // from ES5
    var O = Object, OP = O.prototype,
    create = O.create,
    defineProperty = O.defineProperty,
    defineProperties = O.defineProperties,
    getOwnPropertyNames = O.getOwnPropertyNames,
    getOwnPropertyDescriptor = O.getOwnPropertyDescriptor,
    getPrototypeOf = O.getPrototypeOf,
    freeze = O.freeze,
    isFrozen = O.isFrozen,
    isSealed = O.isSealed,
    seal = O.seal,
    isExtensible = O.isExtensible,
    preventExtensions = O.preventExtensions,
    hasOwnProperty = OP.hasOwnProperty,
    toString = OP.toString,
    isArray = Array.isArray,
    slice = Array.prototype.slice;
    // Utility functions; some exported
    function defaults(dst, src) {
        getOwnPropertyNames(src).forEach(function(k) {
            if (!hasOwnProperty.call(dst, k)) defineProperty(
                dst, k, getOwnPropertyDescriptor(src, k)
            );
        });
        return dst;
    };
    var isObject = function(o) { return o === Object(o) };
    var isPrimitive = function(o) { return o !== Object(o) };
    var isFunction = function(f) { return typeof(f) === 'function' };
    var signatureOf = function(o) { return toString.call(o) };
    var HASWEAKMAP = (function() { // paranoia check
        try {
            var wm = new WeakMap();
            wm.set(wm, wm);
            return wm.get(wm) === wm;
        } catch(e) {
            return false;
        }
    })();
    // exported
    function is (x, y) {
        return x === y
            ? x !== 0 ? true
            : (1 / x === 1 / y) // +-0
        : (x !== x && y !== y); // NaN
    };
    function isnt (x, y) { return !is(x, y) };
    var defaultCK = {
        descriptors:true,
        extensibility:true, 
        enumerator:getOwnPropertyNames
    };
    function equals (x, y, ck) {
        var vx, vy;
        if (HASWEAKMAP) {
            vx = new WeakMap();
            vy = new WeakMap();
        }
        ck = defaults(ck || {}, defaultCK);
        return (function _equals(x, y) {
            if (isPrimitive(x)) return is(x, y);
            if (isFunction(x))  return is(x, y);
            // check deeply
            var sx = signatureOf(x), sy = signatureOf(y);
            var i, l, px, py, sx, sy, kx, ky, dx, dy, dk, flt;
            if (sx !== sy) return false;
            switch (sx) {
            case '[object Array]':
            case '[object Object]':
                if (ck.extensibility) {
                    if (isExtensible(x) !== isExtensible(y)) return false;
                    if (isSealed(x) !== isSealed(y)) return false;
                    if (isFrozen(x) !== isFrozen(y)) return false;
                }
                if (vx) {
                    if (vx.has(x)) {
                        // console.log('circular ref found');
                        return vy.has(y);
                    }
                    vx.set(x, true);
                    vy.set(y, true);
                }
                px = ck.enumerator(x);
                py = ck.enumerator(y);
                if (ck.filter) {
                    flt = function(k) {
                        var d = getOwnPropertyDescriptor(this, k);
                        return ck.filter(d, k, this);
                    };
                    px = px.filter(flt, x);
                    py = py.filter(flt, y);
                }
                if (px.length != py.length) return false;
                px.sort(); py.sort();
                for (i = 0, l = px.length; i < l; ++i) {
                    kx = px[i];
                    ky = py[i];
                    if (kx !== ky) return false;
                    dx = getOwnPropertyDescriptor(x, ky);
                    dy = getOwnPropertyDescriptor(y, ky);
                    if ('value' in dx) {
                        if (!_equals(dx.value, dy.value)) return false;
                    } else {
                        if (dx.get && dx.get !== dy.get) return false;
                        if (dx.set && dx.set !== dy.set) return false;
                    }
                    if (ck.descriptors) {
                        if (dx.enumerable !== dy.enumerable) return false;
                        if (ck.extensibility) {
                            if (dx.writable !== dy.writable)
                                return false;
                            if (dx.configurable !== dy.configurable)
                                return false;
                        }
                    }
                }
                return true;
            case '[object RegExp]':
            case '[object Date]':
            case '[object String]':
            case '[object Number]':
            case '[object Boolean]':
                return ''+x === ''+y;
            default:
                throw TypeError(sx + ' not supported');
            }
        })(x, y);
    }
    function clone(src, deep, ck) {
        var wm;
        if (deep && HASWEAKMAP) {
            wm = new WeakMap();
        }
        ck = defaults(ck || {}, defaultCK);
        return (function _clone(src) {
            // primitives and functions
            if (isPrimitive(src)) return src;
            if (isFunction(src)) return src;
            var sig = signatureOf(src);
            switch (sig) {
            case '[object Array]':
            case '[object Object]':
                if (wm) {
                    if (wm.has(src)) {
                        // console.log('circular ref found');
                        return src;
                    }
                    wm.set(src, true);
                }
                var isarray = isArray(src);
                var dst = isarray ? [] : create(getPrototypeOf(src));
                ck.enumerator(src).forEach(function(k) {
                    // Firefox forbids defineProperty(obj, 'length' desc)
                    if (isarray && k === 'length') {
                        dst.length = src.length;
                    } else {
                        if (ck.descriptors) {
                            var desc = getOwnPropertyDescriptor(src, k);
                            if (ck.filter && !ck.filter(desc, k, src)) return;
                            if (deep && 'value' in desc) 
                                desc.value = _clone(src[k]);
                            defineProperty(dst, k, desc);
                        } else {
                            dst[k] = _clone(src[k]);
                        }
                    }
                });
                if (ck.extensibility) {
                    if (!isExtensible(src)) preventExtensions(dst);
                    if (isSealed(src)) seal(dst);
                    if (isFrozen(src)) freeze(dst);
                }
                return dst;
            case '[object RegExp]':
            case '[object Date]':
            case '[object String]':
            case '[object Number]':
            case '[object Boolean]':
                return deep ? new src.constructor(src.valueOf()) : src;
            default:
                throw TypeError(sig + ' is not supported');
            }
        })(src);
    };
    //  Install
    var obj2specs = function(src) {
        var specs = create(null);
        getOwnPropertyNames(src).forEach(function(k) {
            specs[k] = {
                value: src[k],
                configurable: true,
                writable: true,
                enumerable: false
            };
        });
        return specs;
    };
    var defaultProperties = function(dst, descs) {
        getOwnPropertyNames(descs).forEach(function(k) {
            if (!hasOwnProperty.call(dst, k)) defineProperty(
                dst, k, descs[k]
            );
        });
        return dst;
    };
    (Object.installProperties || defaultProperties)(Object, obj2specs({
        clone: clone,
        is: is,
        isnt: isnt,
        equals: equals
    }));
})(this);

/*! WTFPL Style License */
/*jslint browser: true, forin: true, plusplus: true, indent: 4 */(function(e,t){"use strict";var n=e.prototype,r=n.__lookupGetter__,i=n.__lookupSetter__,s=n.__defineGetter__,o=n.__defineSetter__,u=n.hasOwnProperty,a=[],f=!0,l=function(e){try{return e&&e({},"_",{value:1})._&&e}catch(t){f=!1}}(e.defineProperty)||function(e,t,n){var r=n.get,i=n.set;r&&s&&s.call(e,t,r),i&&o&&o.call(e,t,i),!r&&!i&&(e[t]=n.value)},c=f&&e.getOwnPropertyNames||function(){var e=function(e){return e},t=[],n,r,i;for(n in{valueOf:n})t.push(n);return t.length||(i=t.push("constructor","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","toLocaleString","toString","valueOf")-1,e=function(e,s){for(r=0;r<i;r++)n=t[r],u.call(s,n)&&e.push(n);return e}),function(t){var n=[],r;for(r in t)u.call(t,r)&&n.push(r);return e(n,t)}}(),h=f&&e.getOwnPropertyDescriptor||function(e,t){var n={enumerable:!0,configurable:!0},s=r&&r.call(e,t),o=i&&i.call(e,t);return s&&(n.get=s),o&&(n.set=o),!s&&!o&&(n.writable=!0,n.value=e[t]),n};if(e[t])return;l(e,t,{enumerable:!1,writable:!0,configurable:!0,value:function(e,t,n){var r,i,s,o;if(typeof t=="function")t.apply(e,n||a);else{s=c(t),i=s.length,r=0;while(r<i)o=s[r++],l(e,o,h(t,o))}return e}})})(Object,"mixin");
(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(["exports", "module"], factory);
    } else if (typeof exports !== "undefined" && typeof module !== "undefined") {
        factory(exports, module);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.generator = mod.exports;
    }
})(this, function (exports, module) {
    "use strict";

    var generator = {};

    /**
     * lazy find from an iterable collection using es6 generators
     * @param iterable {collection}
     * @param predicate {function}
     * @yields {object}
     */
    generator.find = regeneratorRuntime.mark(function callee$0$0(iterable, predicate) {
        var _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, item;

        return regeneratorRuntime.wrap(function callee$0$0$(context$1$0) {
            while (1) switch (context$1$0.prev = context$1$0.next) {
                case 0:
                    _iteratorNormalCompletion = true;
                    _didIteratorError = false;
                    _iteratorError = undefined;
                    context$1$0.prev = 3;
                    _iterator = iterable[Symbol.iterator]();

                case 5:
                    if (_iteratorNormalCompletion = (_step = _iterator.next()).done) {
                        context$1$0.next = 13;
                        break;
                    }

                    item = _step.value;

                    if (!predicate(item)) {
                        context$1$0.next = 10;
                        break;
                    }

                    context$1$0.next = 10;
                    return item;

                case 10:
                    _iteratorNormalCompletion = true;
                    context$1$0.next = 5;
                    break;

                case 13:
                    context$1$0.next = 19;
                    break;

                case 15:
                    context$1$0.prev = 15;
                    context$1$0.t0 = context$1$0["catch"](3);
                    _didIteratorError = true;
                    _iteratorError = context$1$0.t0;

                case 19:
                    context$1$0.prev = 19;
                    context$1$0.prev = 20;

                    if (!_iteratorNormalCompletion && _iterator["return"]) {
                        _iterator["return"]();
                    }

                case 22:
                    context$1$0.prev = 22;

                    if (!_didIteratorError) {
                        context$1$0.next = 25;
                        break;
                    }

                    throw _iteratorError;

                case 25:
                    return context$1$0.finish(22);

                case 26:
                    return context$1$0.finish(19);

                case 27:
                case "end":
                    return context$1$0.stop();
            }
        }, callee$0$0, this, [[3, 15, 19, 27], [20,, 22, 26]]);
    });

    /**
     * lazy select the first <number> of items to return from an iterable collection
     * @param iterable {collection}
     * @param number {int}
     * @yields {object}
     */
    generator.top = regeneratorRuntime.mark(function callee$0$0(iterable, number) {
        var count, _iteratorNormalCompletion2, _didIteratorError2, _iteratorError2, _iterator2, _step2, item;

        return regeneratorRuntime.wrap(function callee$0$0$(context$1$0) {
            while (1) switch (context$1$0.prev = context$1$0.next) {
                case 0:
                    count = 0;

                    if (!(number < 1)) {
                        context$1$0.next = 3;
                        break;
                    }

                    return context$1$0.abrupt("return");

                case 3:
                    _iteratorNormalCompletion2 = true;
                    _didIteratorError2 = false;
                    _iteratorError2 = undefined;
                    context$1$0.prev = 6;
                    _iterator2 = iterable[Symbol.iterator]();

                case 8:
                    if (_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done) {
                        context$1$0.next = 18;
                        break;
                    }

                    item = _step2.value;
                    context$1$0.next = 12;
                    return item;

                case 12:
                    count += 1;

                    if (!(count >= number)) {
                        context$1$0.next = 15;
                        break;
                    }

                    return context$1$0.abrupt("return");

                case 15:
                    _iteratorNormalCompletion2 = true;
                    context$1$0.next = 8;
                    break;

                case 18:
                    context$1$0.next = 24;
                    break;

                case 20:
                    context$1$0.prev = 20;
                    context$1$0.t0 = context$1$0["catch"](6);
                    _didIteratorError2 = true;
                    _iteratorError2 = context$1$0.t0;

                case 24:
                    context$1$0.prev = 24;
                    context$1$0.prev = 25;

                    if (!_iteratorNormalCompletion2 && _iterator2["return"]) {
                        _iterator2["return"]();
                    }

                case 27:
                    context$1$0.prev = 27;

                    if (!_didIteratorError2) {
                        context$1$0.next = 30;
                        break;
                    }

                    throw _iteratorError2;

                case 30:
                    return context$1$0.finish(27);

                case 31:
                    return context$1$0.finish(24);

                case 32:
                case "end":
                    return context$1$0.stop();
            }
        }, callee$0$0, this, [[6, 20, 24, 32], [25,, 27, 31]]);
    });

    module.exports = generator;
});

//exits generator, sets done flag==true
(function (global, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.extensions = mod.exports;
    }
})(this, function (exports) {
    'use strict';

    (function (global) {
        String.prototype.toCamelCase = function () {
            return this.replace(/[-_]([a-z])/g, function (g) {
                return g[1].toUpperCase();
            });
        };
        String.prototype.toTitleCase = function () {
            return this.replace(/\w\S*/g, function (txt) {
                return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
            });
        };
        String.prototype.toPixel = function () {
            var val = parseInt(this, 10);
            val = val.toString() + 'px';
            return val;
        };
        Number.prototype.toPixel = function () {
            var val = parseInt(this, 10);
            val = val.toString() + 'px';
            return val;
        };
        String.prototype.toFloatPixel = function () {
            return this.toString() + 'px';
        };
        Number.prototype.toFloatPixel = function () {
            return this.toString() + 'px';
        };
        String.prototype.toInteger = function () {
            return parseInt(this.replace('px', ''), 10);
        };
        String.prototype.toMillisecond = function () {
            var val = parseInt(this, 10);
            val = val.toString() + 'ms';
            return val;
        };
        Number.prototype.toMillisecond = function () {
            var val = parseInt(this, 10);
            val = val.toString() + 'ms';
            return val;
        };
    })(undefined);
});
(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(["exports", "module"], factory);
    } else if (typeof exports !== "undefined" && typeof module !== "undefined") {
        factory(exports, module);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.random = mod.exports;
    }
})(this, function (exports, module) {
    "use strict";

    var random = {};
    random.guid = function () {
        var S4 = function S4() {
            return ((1 + Math.random()) * 65536 | 0).toString(16).substring(1);
        };
        return S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4();
    };

    random.str = function () {
        var length = arguments[0] === undefined ? 16 : arguments[0];

        var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var result = "";
        for (var i = length; i > 0; --i) result += chars[Math.round(Math.random() * (chars.length - 1))];
        return result;
    };

    random.id = function () {
        var length = arguments[0] === undefined ? 16 : arguments[0];

        var chars = "0123456789";
        var result = "";
        for (var i = length; i > 0; --i) result += chars[Math.round(Math.random() * (chars.length - 1))];
        return result;
    };

    random.emptyGuid = function () {
        return "00000000-0000-0000-0000-000000000000";
    };

    random.isEmptyGuid = function (val) {
        return Object.is(val, random.emptyGuid());
    };

    module.exports = random;
});
(function (global, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'module'], factory);
  } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
    factory(exports, module);
  } else {
    var mod = {
      exports: {}
    };
    factory(mod.exports, mod);
    global.__tmp9z=global.__tmp9z || {};
    global.__tmp9z.string = mod.exports;
  }
})(this, function (exports, module) {
  'use strict';

  var string = {};

  /**
   * get first char of string
   * @param s {string}
   * @returns {string}
   */
  string.firstChar = function (s) {
    return s.charAt(0);
  };

  /**
   * get last char of string
   * @param s {string}
   * @returns {string}
   */
  string.lastChar = function (s) {
    return s.slice(-1);
  };

  /**
   * returns first n chars of string
   * @param s {string}
   * @param n {number}
   * @returns {string}
   */
  string.firstNChars = function (s, n) {
    return s.substr(0, n);
  };

  /**
   * returns last n chars of string
   * @param s {string}
   * @param n {number}
   * @returns {string}
   */
  string.lastNChars = function (s, n) {
    return s.substr(s.length - n);
  };

  /**
   * trim first chr from string
   * @param s {String}
   * @returns {String}
   */
  string.trimFirstChar = function (s) {
    return s.substring(1);
  };

  /**
   * trim last chr from string
   * @param s {String}
   * @returns {String}
   */
  string.trimLastChar = function (s) {
    return s.substring(0, s.length - 1);
  };

  /**
   * trim first n chars from string
   * @param s {String}
   * @param n {number}
   * @returns {String}
   */
  string.trimFirstNChars = function (s, n) {
    return s.substring(n);
  };

  /**
   * trim last n chars from string
   * @param s {string}
   * @param n {number}
   * @returns {string}
   */
  string.trimLastNChars = function (s, n) {
    return s.substring(0, s.length - n);
  };

  /**
   * trims a string into ellipsis format
   * @param s {string}
   * @param maxLength {number}
   * @returns {string}
   */
  string.ellipsisTrim = function (s, maxLength) {
    var ret = s;
    if (ret.length > maxLength) {
      ret = ret.substr(0, maxLength - 4) + ' ...';
    }
    return ret;
  };

  /**
   * replaces a string with another string at index
   * @param s {string}
   * @param index {number}
   * @param replaceStr {string}
   * @returns {string}
   */
  string.replaceAt = function (s, index, replaceStr) {
    return s.substr(0, index) + replaceStr + s.substr(index + replaceStr.length);
  };

  /**
   * inserts a string value at specified index in a string
   * @param s {String}
   * @param index {Number}
   * @param insertStr {String}
   * @returns {string}
   */
  string.insertAt = function (s, index, insertStr) {
    return s.substr(0, index) + insertStr + s.substr(index);
  };

  /**
   * converts a dash delimited string to a camelCase string
   *
   * @param s {String}
   * @returns {String}
   */
  string.dashToCamelCase = function (s) {
    return s.replace(/-([a-z])/g, function (g) {
      return g[1].toUpperCase();
    });
  };

  /**
   * camel case to space separated
   * @param s {String}
   * @returns {String}
   */
  string.camelCaseToSpace = function (s) {
    var rex = /([A-Z])([A-Z])([a-z])|([a-z])([A-Z])/g;
    return s.replace(rex, '$1$4 $2$3$5');
  };

  /**
   * camel case input string
   * @param s
   * @returns {String}
   */
  string.toCamelCase = function (s) {
    return s.replace(/\s(.)/g, function ($1) {
      return $1.toUpperCase();
    }).replace(/\s/g, '').replace(/^(.)/, function ($1) {
      return $1.toLowerCase();
    });
  };

  /**
   * converts a space delimited string to a dash delimited string
   *
   * @param s {String}
   * @returns {String}
   */
  string.spaceToDash = function (s) {
    return s.replace(/\s+/g, '-').toLowerCase();
  };

  module.exports = string;
});
(function (global, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'module'], factory);
  } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
    factory(exports, module);
  } else {
    var mod = {
      exports: {}
    };
    factory(mod.exports, mod);
    global.__tmp9z=global.__tmp9z || {};
    global.__tmp9z.date = mod.exports;
  }
})(this, function (exports, module) {
  'use strict';

  var date = {};

  /**
   * return an object representing current date
   * @returns {{day: number, month: number, year: number}}
   */
  date.currentDateObj = function () {
    var currentDate = new Date();
    var day = currentDate.getDate();
    var month = currentDate.getMonth() + 1;
    var year = currentDate.getFullYear();
    return {
      day: day,
      month: month,
      year: year
    };
  };

  /**
   * returns a current date string
   * @returns {string}
   */
  date.current = function () {
    var obj = undefined.currentDateObj();
    return obj.month.toString() + '/' + obj.day.toString() + '/' + obj.year.toString();
  };

  /**
   * tests if valid date
   * @param obj {object}
   * @returns {boolean}
   */
  date.isDate = function (obj) {
    return /Date/.test(Object.prototype.toString.call(obj)) && !isNaN(obj.getTime());
  };

  /**
   * tests if year is leap year
   * @param year {number}
   * @returns {boolean}
   */
  date.isLeapYear = function (year) {
    return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
  };

  /**
   * returns days in month for given year
   * @param year {number}
   * @param month {number}
   * @returns {number}
   */
  date.getDaysInMonth = function (year, month) {
    return [31, date.isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
  };

  /**
   * sets a date to start of day
   * @param d {date}
   * @returns {void}
   */
  date.setToStartOfDay = function (d) {
    if (date.isDate(d)) d.setHours(0, 0, 0, 0);
  };

  /**
   * compares equality of two dates
   * @param a {date}
   * @param b {date}
   * @returns {boolean}
   */
  date.compareDates = function (a, b) {
    return a.getTime() === b.getTime();
  };

  module.exports = date;
});
(function (global, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['exports', 'module'], factory);
    } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
        factory(exports, module);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.network = mod.exports;
    }
})(this, function (exports, module) {
    'use strict';

    function isLocalBlock(ip) {
        var x = ip.split('.'),
            x1,
            x2,
            x3,
            x4;
        if (x.length == 4) {
            x1 = parseInt(x[0], 10);
            x2 = parseInt(x[1], 10);
            x3 = parseInt(x[2], 10);
            x4 = parseInt(x[3], 10);

            return x1 === 10 || x1 === 172 && x2 === 16 || x1 === 192 && x2 === 168;
        }
        return false;
    }

    var network = {};

    /**
     * tests for window to determine if browser environment
     * @returns {boolean}
     */
    network.isBrowser = function () {
        return typeof window != 'undefined';
    };

    /**
     * tests if string is a valid ipv4 address
     * @param ip {string}
     * @returns {boolean}
     */
    network.isIPAddress = function (ip) {
        return /^(\d\d?)|(1\d\d)|(0\d\d)|(2[0-4]\d)|(2[0-5])\.(\d\d?)|(1\d\d)|(0\d\d)|(2[0-4]\d)|(2[0-5])\.(\d\d?)|(1\d\d)|(0\d\d)|(2[0-4]\d)|(2[0-5])$/.test(ip);
    };

    /**
     * tests if a host is a valid localhost
     * @param host
     * @returns {boolean}
     */
    network.isLocalHost = function (host) {
        host = host.toLowerCase();
        if (host === 'localhost') {
            return true;
        } else if (host.indexOf('127.0.0.1') > -1) {
            return true;
        } else {
            if (network.isIPAddress(host)) {
                return isLocalBlock(host);
            } else {
                return false;
            }
        }
    };

    module.exports = network;
});
(function (global, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['exports', 'module'], factory);
    } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
        factory(exports, module);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.color = mod.exports;
    }
})(this, function (exports, module) {
    'use strict';

    var color = {};

    color.rgb2hex = function (rgb) {
        if (rgb.search('rgb') == -1) {
            return rgb;
        } else if (rgb == 'rgba(0, 0, 0, 0)') {
            return 'transparent';
        } else {
            var hex = function (x) {
                return ('0' + parseInt(x).toString(16)).slice(-2);
            };

            rgb = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+))?\)$/);

            return '#' + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
        }
    };

    module.exports = color;
});
(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(["exports", "module", "./string"], factory);
    } else if (typeof exports !== "undefined" && typeof module !== "undefined") {
        factory(exports, module, require("./string"));
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod, global.__tmp9z.string);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.url = mod.exports;
    }
})(this, function (exports, module, _string) {
    "use strict";

    function _interopRequire(obj) { return obj && obj.__esModule ? obj["default"] : obj; }

    var _string2 = _interopRequire(_string);

    var url = {};

    /**
     * returns a querystring value for query param in the window.location url
     * @param query {string}
     * @returns {string}
     */
    url.queryString = function (query) {
        var hu = window.location.search.substring(1);
        var gy = hu.split("&");
        for (i = 0; i < gy.length; i++) {
            var ft = gy[i].split("=");
            if (ft[0] == query) {
                return ft[1];
            }
        }
        return null;
    };

    /**
     * returns a querystring object array for the window.location url
     * @returns {Array}
     */
    url.queryStringArray = function () {
        var arr = [];
        var hu = window.location.search.substring(1);
        var gy = hu.split("&");
        for (i = 0; i < gy.length; i++) {
            var ft = gy[i].split("=");
            if (ft[0] == ji) {
                return ft[1];
            }
            var obj = {};
            obj.prop = ft[0];
            obj.val = ft[1];
            arr.push(obj);
        }

        return arr;
    };

    /**
     * @param url {string}
     * @param index {number}
     * @returns {string}
     */
    url.encodeURISection = function (url, index) {
        if (_string2.firstChar(url) === "/") {
            url = _string2.trimFirstChar(url);
        }
        var arr = url.split("/");
        var section = arr[index];
        section = encodeURIComponent(section);
        var length = arr.length;
        var url_ = "";
        for (var i = 0; i < length; i++) {
            url_ += i === index ? "/" + section : "/" + arr[i];
        }

        return url_;
    };

    module.exports = url;
});
(function (global, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['exports', 'module'], factory);
    } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
        factory(exports, module);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.currency = mod.exports;
    }
})(this, function (exports, module) {
    'use strict';

    var currency = {};

    /**
     *
     * @param v {string}
     * @returns {float}
     */
    currency.parse = function (v) {
        if (typeof v === 'string') {
            v = v.replace('$', '');
            v = v.replace(/,/g, '');
            v = parseFloat(v);
        }
        return v;
    };

    /**
     *
     * @param val {float}
     * @returns {float}
     */
    currency.format = function (val) {
        val = parseFloat(value);
        return val.toFixed(2);
    };

    /**
     *
     * @param v {float}
     * @param q {number}
     * @returns {float}
     */
    currency.extendedAmount = function (v, q) {
        if (typeof v === 'string') {
            v = v.replace('$', '');
            v = parseFloat(v);
        }
        return currency.format(v * q);
    };

    module.exports = currency;
});
(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(["exports", "module", "./generator"], factory);
    } else if (typeof exports !== "undefined" && typeof module !== "undefined") {
        factory(exports, module, require("./generator"));
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod, global.__tmp9z.generator);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.array = mod.exports;
    }
})(this, function (exports, module, _generator) {
    "use strict";

    function _interopRequire(obj) { return obj && obj.__esModule ? obj["default"] : obj; }

    var _generator2 = _interopRequire(_generator);

    var array = {};

    /**
     * tests if array
     * @param obj {*}
     * @retuns {boolean}
     */
    array.isArray = function (obj) {
        return /Array/.test(Object.prototype.toString.call(obj));
    };

    /**
     * is object/value in array
     * @param arr {Array}
     * @param obj {Object}
     * @returns {Boolean}
     */
    array.inArray = function (arr, obj) {
        return _generator2.find(arr, function (o) {
            return Object.is(o, obj);
        });
    };

    /**
     * remove of an array of items from an array
     * @param arr1 {Array}
     * @param arr2 {Array}
     * @returns {Array}
     */
    array.remove = function (arr1, arr2) {
        for (var i = 0; i < arr1.length; i++) {
            if (array.inArray(arr2, arr1[i])) {
                arr1.splice(i, 1);
            }
        }
        return arr1;
    };

    /**
     * merge two arrays
     * @param a {Array}
     * @param b {Array}
     * @returns {Array}
     */
    array.merge = function (a, b) {
        var i = a.length,
            j = 0;

        if (typeof b.length === "number") {
            for (var l = b.length; j < l; j++) {
                a[i++] = b[j];
            }
        } else {
            while (b[j] !== undefined) {
                a[i++] = b[j++];
            }
        }

        a.length = i;

        return a;
    };

    /**
     *
     * @returns {Array}
     */
    array.makeArray = function (arr, results) {
        var ret = results || [];

        if (arr != null) {
            var type = typeof arr;
            if (arr.length == null || type === "string" || type === "function" || type === "regexp") {
                ret.push(arr);
            } else {
                array.merge(ret, arr);
            }
        }

        return ret;
    };

    /**
     * concatenate two arguments
     * @param arr {Array}
     * @param args {Array}
     * @returns {Array}
     */
    array.concatArgs = function (arr, args) {
        return array.makeArray(arr).concat(array.makeArray(args));
    };

    /**
     * empty an array
     * @param arr {Array}
     */
    array.empty = function (arr) {
        return arr.splice(0, arr.length);
    };

    array.clone = function (arr) {
        return arr.slice(0);
    };

    /**
     * tests if valid val for an array index
     * @param val {number}
     */
    array.isValidIndex = function (val) {
        return /^[0-9]+$/.test(String(val));
    };

    /**
     * validates if the value of an object prop is an array
     * @param obj {Object}
     * @param prop {String}
     * @returns {boolean}
     */
    array.isObjectProperty = function (obj, prop) {
        return !!Array.isArray(obj[prop]);
    };

    /**
     * validates if the value of an object prop by index is an array
     * @param obj {Object}
     * @param index {Number}
     * @returns {boolean}
     */
    array.isObjectPropertyByIndex = function (obj, index) {
        try {
            var o = obj[Object.keys(obj)[index]];
            return !!Array.isArray(o);
        } catch (ex) {
            return false;
        }
    };

    array.indexById = function (arr, id) {
        var idProp = arguments[2] === undefined ? "id" : arguments[2];

        if (arr.length && arr.length > 0) {
            var len = arr.length;
            var index = undefined;
            for (var i = 0; i < len; i++) {
                if (arr[i][idProp] === id) {
                    index = i;
                    break;
                }
            }
            return index;
        } else {
            return null;
        }
    };

    /**
     * finds an object in an array by id
     * @param arr {Array}
     * @param id {String}|{Number}
     * @param propId {String}
     * @returns {Object}
     */
    array.findById = function (arr, id) {
        var propId = arguments[2] === undefined ? "id" : arguments[2];

        return _generator2.find(arr, function (obj) {
            return obj[propId] === id;
        });
    };

    module.exports = array;
});

(function (global, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['exports', 'module', './array'], factory);
    } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
        factory(exports, module, require('./array'));
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports, mod, global.__tmp9z.array);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.path = mod.exports;
    }
})(this, function (exports, module, _array) {
    'use strict';

    function _interopRequire(obj) { return obj && obj.__esModule ? obj['default'] : obj; }

    var _array2 = _interopRequire(_array);

    var isNumeric = function isNumeric(val) {
        return !isNaN(parseFloat(val)) && isFinite(val);
    };

    var path_ = {};

    /**
     * converts a delimited path into an array of props
     * 'items.0.FirstName' --> [items,0,FirstName]
     *
     * @param path {string}
     * @param separator {string}
     * @returns {array}
     */
    path_.split = function (path) {
        var separator = arguments[1] === undefined ? '.' : arguments[1];

        if (typeof path === 'undefined' || path === '') {
            return [];
        } else {
            if (_array2.isArray(path)) {
                return path.slice(0);
            } else {
                return path.toString().split(separator);
            }
        }
    };

    /**
     * resolves the value of an object path
     * obj, 'items.0.FirstName'  --> 'John','FirstName'
     * returns an array of value,prop
     *
     * @param a {object}
     * @param path {string}
     * @param options {object}
     * @returns {array}
     */
    path_.resolve = function (a, path, options) {
        var e, k, last, stack;
        if (options == null) {
            options = {};
        }
        stack = path_.split(path);
        last = [stack.pop()];
        e = a;
        while ((k = stack.shift()) !== void 0) {
            if (e[k] !== void 0) {
                e = e[k];
            } else {
                stack.unshift(k);
                break;
            }
        }
        if (options.force) {
            while ((k = stack.shift()) !== void 0) {
                if (typeof stack[0] === 'number' || stack.length === 0 && typeof last[0] === 'number') {
                    e[k] = [];
                } else {
                    e[k] = {};
                }
                e = e[k];
            }
        } else {
            while ((k = stack.pop()) !== void 0) {
                last.unshift(k);
            }
        }
        return [e, last];
    };

    /**
     * resolves the value of an object path
     * obj, 'items.0.FirstName'  --> 'John'
     *
     * @param obj {object}
     * @param path {string}
     * @returns value
     */
    path_.objectProperty = function (obj, path) {
        try {
            var _ret = (function () {
                var pathArray = path.split(path);
                var a = obj;
                pathArray.forEach(function (p) {
                    var b = a[p];
                    a = b;
                });
                return {
                    v: a
                };
            })();

            if (typeof _ret === 'object') return _ret.v;
        } catch (ex) {
            return undefined;
        }
    };

    /**
     *
     * @param obj {object}
     * @param path {string}
     * @param value {object}
     * @returns void
     */
    path_.assignValueTo = function (obj, path, value) {
        try {
            var pathArray = path_.split(path);
            var a = obj;
            var len = pathArray.length;
            var max = len - 1;
            for (var i = 0; i < len; i++) {
                if (i === max) {
                    a[pathArray[i]] = value;
                } else {
                    var b = a[pathArray[i]];
                    a = b;
                }
            }
        } catch (ex) {}
    };

    /**
     * return the length of an array property of an object by path
     * @param obj {object}
     * @param path {string}
     * @returns {number}
     */
    path_.arrayPropertyLength = function (obj, path) {
        var prop = path_.objectProperty(obj, path);
        return prop && _array2.isArray(prop) ? prop.length : null;
    };

    /**
     * tests if a value of an object path is an array
     * @param obj
     * @param path
     * @returns {boolean}
     */
    path_.isPropertyArray = function (obj, path) {
        var prop = path_.objectProperty(obj, path);
        return _array2.isArray(prop);
    };

    /**
     * returns the index of the path
     * @param path {string}
     * @returns {object}
     */
    path_.getIndexOf = function (path) {
        if (path !== undefined) {
            var parts = path.split('.');
            var _length = undefined;
            if (parts.length) {
                _length = parts.length;
                _length--;
                return parts[_length];
            } else {
                return undefined;
            }
        } else {
            return undefined;
        }
    };

    /**
     * is path part of an array
     * @param path {string}
     * @returns {boolean}
     */
    path_.isInArray = function (path) {
        var index = undefined.getIndexOf(path);
        return index !== undefined ? isNumeric(index) : undefined;
    };

    /**
     * converts an array(of contexts and indices) and a property into a path string
     * [{index:5,context:User},{index:0,context:Address}],City ---> User.5.Address.0.City
     * @param arr {array}
     * @param prop {string}
     * @returns {string}
     */
    path_.create = function (arr, prop) {
        var path = '';
        if (arr && arr.length) {
            arr.forEach(function (obj) {
                path += obj.context + '.' + obj.index + '.';
            });

            typeof prop !== 'undefined' ? path += prop : path = path.substring(0, path.length - 1);
            return path;
        }
    };

    /**
     * converts an array of object properties into a path
     * @param arr {array}
     * @returns {string} path
     */
    path_.createFromArray = function (arr) {
        var path = '';
        if (arr && arr.length) {
            var index = 0;
            arr.forEach(function (obj) {
                path += index < arr.length - 1 ? obj + '.' : obj;
                index++;
            });
            return path;
        }
    };

    /**
     * deletes an obj prop by path
     * @param obj {object}
     * @param path {string}
     */
    path_.deleteObjectProperty = function (obj, path) {
        var pathArray = path_.split(path);
        var a = obj;
        var len = pathArray.length;
        var max = len - 1;
        for (var i = 0; i < len; i++) {
            if (i === max) {
                delete a[pathArray[i]];
            } else {
                var b = a[pathArray[i]];
                a = b;
            }
        }
    };

    /**
     * tests if a prop is the last node in a path
     * @param path {string}
     * @param prop {string}
     * @returns {boolean}
     */
    path_.isProperty = function (path, prop) {
        var splitPath = path_.split(path);
        var prop_ = splitPath.pop();
        return prop_ === prop;
    };

    /**
     * deletes an object from an array by id value
     * @param obj {object}
     * @param idProp {string}
     * @param id {string}
     * @returns {number} the index of the deleted object
     */
    path_.deleteObjectByIdFromArrayProp = function (obj, idProp, id) {
        var index = null;
        if (!_array2.isObjectPropertyByIndex(obj, 0)) {
            return index;
        }
        var arr = obj[Object.keys(obj)[0]];
        for (var i = 0; i < arr.length; i++) {
            if (arr[i][idProp].toString() === id.toString()) {
                arr.splice(i, 1);
                index = i;
                break;
            }
        }

        return index;
    };

    /**
     * finds an object in a $scope model list by id
     * @param obj {object}
     * @param idProp {string}
     * @param id {string}
     * @returns {object}
     */
    path_.selectObjectByIdFromArrayProp = function (obj, idProp, id) {
        var obj_ = undefined;
        var index = null;
        if (!_array2.isObjectPropertyByIndex(obj, 0)) {
            return index;
        }
        var arr = obj[Object.keys(obj)[0]];
        for (var i = 0; i < arr.length; i++) {
            if (arr[i][idProp].toString() === id.toString()) {
                obj_ = arr[i];
                break;
            }
        }
        return obj_;
    };

    /**
     * inserts an index into a model list path(at path index=1)
     * @param path {String}
     * @param index {Number}
     * @returns {String}
     */
    path_.replaceIndex = function (path, index) {
        var arr = path_.split(path);
        arr[1] = index;
        return arr.join('.');
    };

    /**
     * returns a normalized path format for Object.observe change record reporting
     * @param path {string}
     * @returns {string}
     */
    path_.map = function (path) {
        var arr = path_.split(path);
        var num = isNumeric;
        if (arr && arr.length) {
            var mapped = arr.map(function (v) {
                return num(v) ? '[' + v.toString() + ']' : v;
            });
            return mapped.join('.').replace(/.\[/, '[');
        } else {
            return path;
        }
    };

    module.exports = path_;
});
(function (global, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['exports', 'module'], factory);
    } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
        factory(exports, module);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod.exports,mod);
        global.__tmp9z=global.__tmp9z || {};
        global.__tmp9z.object = mod.exports;
    }
})(this, function (exports, module) {
    'use strict';

    var _arguments = arguments;

    var object = {};

    var spec = {
        descriptors: false,
        extensibility: false,
        enumerator: Object.keys
    };

    /**
     * is object
     * @param obj {*}
     * @returns {boolean}
     */
    object.isObject = function (obj) {
        return typeof obj === 'object' && obj !== null;
    };

    /**
     * is function
     * @param fn {*}
     * @returns {boolean}
     */
    object.isFunction = function (fn) {
        return typeof fn === 'function';
    };

    /**
     * returns the value of an object prop by index
     * @param obj {object}
     * @param index {number}
     * @returns {object}
     */
    object.propertyByIndex = function (obj, index) {
        return obj[Object.keys(obj)[index]];
    };

    /**
     * returns the index of an element with idProp==id in an array
     * @param obj {Object}
     * @param id {String}
     * @param idProp {String}
     * @returns {Number}
     */
    object.indexById = function (obj, id) {
        var idProp = arguments[2] === undefined ? 'id' : arguments[2];

        var arr = object.propertyByIndex(obj, 0);
        if (arr.length && arr.length > 0) {
            var len = arr.length;
            var index = undefined;
            for (var i = 0; i < len; i++) {
                if (arr[i][idProp] === id) {
                    index = i;
                    break;
                }
            }
            return index;
        } else {
            return null;
        }
    };

    /**
     * tests if object is empty
     * @param obj
     * @returns {boolean}
     */
    object.isEmpty = function (obj) {
        var hasOwnProperty = Object.prototype.hasOwnProperty;
        if (obj == null) return true;

        if (obj.length > 0) return false;
        if (obj.length === 0) return true;

        for (var key in obj) {
            if (hasOwnProperty.call(obj, key)) return false;
        }

        return true;
    };

    /**
     * tests if object is a POJO
     * @param obj {object}
     * @returns {*}
     */
    object.isPlainObject = function (obj) {
        var _isObject = function _isObject(o) {
            return object.isObject(o) && Object.prototype.toString.call(o) === '[object Object]';
        };

        var ctor, prot;

        if (_isObject(obj) === false) return false;

        // if has modified constructor
        ctor = obj.constructor;
        if (typeof ctor !== 'function') return false;

        // if has modified prototype
        prot = ctor.prototype;
        if (_isObject(prot) === false) return false;

        // if constructor does not have an Object-specific method
        return prot.hasOwnProperty('isPrototypeOf') !== false;
    };

    /**
     *  equality test
     * @param x {object}
     * @param y {object}
     * @returns {*}
     */
    object.isEqual = function (x, y) {
        return Object.equals(x, y, spec);
    };

    /**
     * clone object
     * @param src
     * @returns {*}
     */
    object.clone = function (src) {
        return Object.clone(src, false, spec);
    };

    /**
     * deep clone
     * @param src
     * @returns {*}
     */
    object.deepClone = function (src) {
        return Object.clone(src, true, spec);
    };

    /**
     * returns modified target
     * @param target {object}
     * @param source {object}
     * @returns {*}
     */
    object.mixin = function (target, source) {
        return Object.mixin(target, source);
    };

    /**
     * returns modified target
     * @param target {object}
     * @param sources {object}
     * @returns {*}
     */
    object.assign = function (target) {
        for (var _len = arguments.length, sources = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
            sources[_key - 1] = arguments[_key];
        }

        return Object.assign.apply(Object, [target].concat(sources));
    };

    /**
     * @params {boolean} -optional deep
     * @params {object} target
     * @params {object} source
     * @returns {*|{}}
     */
    object.extend = function () {
        // copy reference to target object
        var target = _arguments[0] || {},
            i = 1,
            length = _arguments.length,
            deep = false,
            options,
            name,
            src,
            copy;

        // Handle a deep copy situation
        if (typeof target === 'boolean') {
            deep = target;
            target = _arguments[1] || {};
            // skip the boolean and the target
            i = 2;
        }

        // Handle case when target is a string or something (possible in deep copy)
        if (typeof target !== 'object' && ! typeof target === 'function') {
            target = {};
        }

        for (; i < length; i++) {
            // Only deal with non-null/undefined values
            if ((options = _arguments[i]) !== null) {
                // Extend the base object
                for (name in options) {
                    src = target[name];
                    copy = options[name];

                    // Prevent never-ending loop
                    if (target === copy) {
                        continue;
                    }

                    // Recurse if we're merging object literal values or arrays
                    if (deep && copy && (object.isPlainObject(copy) || Array.isArray(copy))) {
                        var clone = src && (object.isPlainObject(src) || Array.isArray(src)) ? src : Array.isArray(copy) ? [] : {};

                        // Never move original objects, clone them
                        target[name] = object.extend(deep, clone, copy);

                        // Don't bring in undefined values
                    } else if (typeof copy !== 'undefined') {
                        target[name] = copy;
                    }
                }
            }
        }

        // Return the modified object
        return target;
    };

    module.exports = object;
});

(function (global, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'module', './assign', './extensions', 'js-object-clone', 'object-mixin', './generator', './random', './string', './date', './network', './color', './url', './currency', './array', './path', './object'], factory);
  } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
    factory(exports, module, require('./assign'), require('./extensions'), require('js-object-clone'), require('object-mixin'), require('./generator'), require('./random'), require('./string'), require('./date'), require('./network'), require('./color'), require('./url'), require('./currency'), require('./array'), require('./path'), require('./object'));
  } else {
    var mod = {
      exports: {}
    };
    factory(mod.exports, mod,global.assign, global.__tmp9z.extensions, global.objectClone, global.objectMixin, global.__tmp9z.generator, global.__tmp9z.random,
        global.__tmp9z.string, global.__tmp9z.date, global.__tmp9z.network, global.__tmp9z.color, global.__tmp9z.url,
        global.__tmp9z.currency, global.__tmp9z.array, global.__tmp9z.path, global.__tmp9z.object);

    global.elliptical=global.elliptical || {};
    global.elliptical.utils = mod.exports;
  }
})(this, function (exports, module, _assign, _extensions, _jsObjectClone, _objectMixin, _generator, _random, _string, _date, _network, _color, _url, _currency, _array, _path, _object) {
  'use strict';

  function _interopRequire(obj) { return obj && obj.__esModule ? obj['default'] : obj; }

  var _generator2 = _interopRequire(_generator);

  var _random2 = _interopRequire(_random);

  var _string2 = _interopRequire(_string);

  var _date2 = _interopRequire(_date);

  var _network2 = _interopRequire(_network);

  var _color2 = _interopRequire(_color);

  var _url2 = _interopRequire(_url);

  var _currency2 = _interopRequire(_currency);

  var _array2 = _interopRequire(_array);

  var _path2 = _interopRequire(_path);

  var _object2 = _interopRequire(_object);

  var utils = {};

  var spec = {
    descriptors: false,
    extensibility: false,
    enumerator: Object.keys
  };

  /**
   * deep clones an object
   * @param src {object}
   * @param deep {boolean}
   * @returns {object}
   */
  utils.clone = function (src) {
    var deep = arguments[1] === undefined ? true : arguments[1];
    return Object.clone(src, deep, spec);
  };

  /**
   * object 'is' comparison
   * @param x {object}
   * @param y {object}
   * @returns {boolean}
   */
  utils.is = function (x, y) {
    return Object.is(x, y);
  };

  /** compares equality of two objects
   * @param x {object}
   * @param y {object}
   * @returns {boolean}
   */
  utils.isEqual = function (x, y) {
    return Object.equals(x, y, spec);
  };

  /**
   * shallow extend of src onto target
   * @param target {Object}
   * @param src {Object}
   * @returns {Object}
   */
  utils.assign = function (target, src) {
    return Object.assign(target, src);
  };

  /**
   * deep extend of src onto target
   * @param target {object}
   * @param src {object}
   * @returns {object}
   */
  utils.mixin = function (target, src) {
    return Object.mixin(target, src);
  };

  /**
   * lazy find from an iterable collection using es6 generators
   * @param iterable {collection}
   * @param predicate {function}
   * @yields {object}
   */
  utils.find = _generator2.find;

  /**
   * lazy select the first <number> of items to return from an iterable collection
   * @param iterable {collection}
   * @param number {int}
   * @yields {object}
   */
  utils.top = _generator2.top;

  /**
   * tests if value is a number
   * @param val {object}
   * @returns {boolean}
   */
  utils.isNumeric = function (val) {
    return !isNaN(parseFloat(val)) && isFinite(val);
  };

  //random functions namespace
  utils.random = _random2;

  //string functions namespace
  utils.string = _string2;

  //date functions namespace
  utils.date = _date2;

  //network functions namespace
  utils.network = _network2;

  //color function namespace
  utils.color = _color2;

  //currency function namespace
  utils.currency = _currency2;

  //url functions namespace
  utils.url = _url2;

  //array functions namespace
  utils.array = _array2;

  //path functions namespace
  utils.path = _path2;

  //object functions namespace
  utils.object = _object2;

  module.exports = utils;
});

/*! dustjs-linkedin - v2.7.2
* http://dustjs.com/
* Copyright (c) 2015 Aleksander Williams; Released under the MIT License */
(function (root, factory) {
  if (typeof define === 'function' && define.amd && define.amd.dust === true) {
    define('dust.core', [], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory();
  } else {
    root.dust = factory();
  }
}(this, function() {
  var dust = {
        "version": "2.7.2"
      },
      NONE = 'NONE', ERROR = 'ERROR', WARN = 'WARN', INFO = 'INFO', DEBUG = 'DEBUG',
      EMPTY_FUNC = function() {};

  dust.config = {
    whitespace: false,
    amd: false,
    cjs: false,
    cache: true
  };

  // Directive aliases to minify code
  dust._aliases = {
    "write": "w",
    "end": "e",
    "map": "m",
    "render": "r",
    "reference": "f",
    "section": "s",
    "exists": "x",
    "notexists": "nx",
    "block": "b",
    "partial": "p",
    "helper": "h"
  };

  (function initLogging() {
    /*global process, console*/
    var loggingLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
        consoleLog,
        log;

    if (typeof console !== 'undefined' && console.log) {
      consoleLog = console.log;
      if(typeof consoleLog === 'function') {
        log = function() {
          consoleLog.apply(console, arguments);
        };
      } else {
        log = function() {
          consoleLog(Array.prototype.slice.apply(arguments).join(' '));
        };
      }
    } else {
      log = EMPTY_FUNC;
    }

    /**
     * Filters messages based on `dust.debugLevel`.
     * This default implementation will print to the console if it exists.
     * @param {String|Error} message the message to print/throw
     * @param {String} type the severity of the message(ERROR, WARN, INFO, or DEBUG)
     * @public
     */
    dust.log = function(message, type) {
      type = type || INFO;
      if (loggingLevels[type] >= loggingLevels[dust.debugLevel]) {
        log('[DUST:' + type + ']', message);
        if (type === ERROR && dust.debugLevel === DEBUG && message instanceof Error && message.stack) {
          log('[DUST:' + type + ']', message.stack);
        }
      }
    };

    dust.debugLevel = NONE;
    if(typeof process !== 'undefined' && process.env && /\bdust\b/.test(process.env.DEBUG)) {
      dust.debugLevel = DEBUG;
    }

  }());

  dust.helpers = {};

  dust.cache = {};

  dust.register = function(name, tmpl) {
    if (!name) {
      return;
    }
    tmpl.templateName = name;
    if (dust.config.cache !== false) {
      dust.cache[name] = tmpl;
    }
  };

  dust.render = function(nameOrTemplate, context, callback) {
    var chunk = new Stub(callback).head;
    try {
      load(nameOrTemplate, chunk, context).end();
    } catch (err) {
      chunk.setError(err);
    }
  };

  dust.stream = function(nameOrTemplate, context) {
    var stream = new Stream(),
        chunk = stream.head;
    dust.nextTick(function() {
      try {
        load(nameOrTemplate, chunk, context).end();
      } catch (err) {
        chunk.setError(err);
      }
    });
    return stream;
  };

  /**
   * Extracts a template function (body_0) from whatever is passed.
   * @param nameOrTemplate {*} Could be:
   *   - the name of a template to load from cache
   *   - a CommonJS-compiled template (a function with a `template` property)
   *   - a template function
   * @param loadFromCache {Boolean} if false, don't look in the cache
   * @return {Function} a template function, if found
   */
  function getTemplate(nameOrTemplate, loadFromCache/*=true*/) {
    if(!nameOrTemplate) {
      return;
    }
    if(typeof nameOrTemplate === 'function' && nameOrTemplate.template) {
      // Sugar away CommonJS module templates
      return nameOrTemplate.template;
    }
    if(dust.isTemplateFn(nameOrTemplate)) {
      // Template functions passed directly
      return nameOrTemplate;
    }
    if(loadFromCache !== false) {
      // Try loading a template with this name from cache
      return dust.cache[nameOrTemplate];
    }
  }

  function load(nameOrTemplate, chunk, context) {
    if(!nameOrTemplate) {
      return chunk.setError(new Error('No template or template name provided to render'));
    }

    var template = getTemplate(nameOrTemplate, dust.config.cache);

    if (template) {
      return template(chunk, Context.wrap(context, template.templateName));
    } else {
      if (dust.onLoad) {
        return chunk.map(function(chunk) {
          // Alias just so it's easier to read that this would always be a name
          var name = nameOrTemplate;
          // Three possible scenarios for a successful callback:
          //   - `require(nameOrTemplate)(dust); cb()`
          //   - `src = readFile('src.dust'); cb(null, src)`
          //   - `compiledTemplate = require(nameOrTemplate)(dust); cb(null, compiledTemplate)`
          function done(err, srcOrTemplate) {
            var template;
            if (err) {
              return chunk.setError(err);
            }
            // Prefer a template that is passed via callback over the cached version.
            template = getTemplate(srcOrTemplate, false) || getTemplate(name, dust.config.cache);
            if (!template) {
              // It's a template string, compile it and register under `name`
              if(dust.compile) {
                template = dust.loadSource(dust.compile(srcOrTemplate, name));
              } else {
                return chunk.setError(new Error('Dust compiler not available'));
              }
            }
            template(chunk, Context.wrap(context, template.templateName)).end();
          }

          if(dust.onLoad.length === 3) {
            dust.onLoad(name, context.options, done);
          } else {
            dust.onLoad(name, done);
          }
        });
      }
      return chunk.setError(new Error('Template Not Found: ' + nameOrTemplate));
    }
  }

  dust.loadSource = function(source) {
    /*jshint evil:true*/
    return eval(source);
  };

  if (Array.isArray) {
    dust.isArray = Array.isArray;
  } else {
    dust.isArray = function(arr) {
      return Object.prototype.toString.call(arr) === '[object Array]';
    };
  }

  dust.nextTick = (function() {
    return function(callback) {
      setTimeout(callback, 0);
    };
  })();

  /**
   * Dust has its own rules for what is "empty"-- which is not the same as falsy.
   * Empty arrays, null, and undefined are empty
   */
  dust.isEmpty = function(value) {
    if (value === 0) {
      return false;
    }
    if (dust.isArray(value) && !value.length) {
      return true;
    }
    return !value;
  };

  dust.isEmptyObject = function(obj) {
    var key;
    if (obj === null) {
      return false;
    }
    if (obj === undefined) {
      return false;
    }
    if (obj.length > 0) {
      return false;
    }
    for (key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        return false;
      }
    }
    return true;
  };

  dust.isTemplateFn = function(elem) {
    return typeof elem === 'function' &&
           elem.__dustBody;
  };

  /**
   * Decide somewhat-naively if something is a Thenable.
   * @param elem {*} object to inspect
   * @return {Boolean} is `elem` a Thenable?
   */
  dust.isThenable = function(elem) {
    return elem &&
           typeof elem === 'object' &&
           typeof elem.then === 'function';
  };

  /**
   * Decide very naively if something is a Stream.
   * @param elem {*} object to inspect
   * @return {Boolean} is `elem` a Stream?
   */
  dust.isStreamable = function(elem) {
    return elem &&
           typeof elem.on === 'function' &&
           typeof elem.pipe === 'function';
  };

  // apply the filter chain and return the output string
  dust.filter = function(string, auto, filters, context) {
    var i, len, name, filter;
    if (filters) {
      for (i = 0, len = filters.length; i < len; i++) {
        name = filters[i];
        if (!name.length) {
          continue;
        }
        filter = dust.filters[name];
        if (name === 's') {
          auto = null;
        } else if (typeof filter === 'function') {
          string = filter(string, context);
        } else {
          dust.log('Invalid filter `' + name + '`', WARN);
        }
      }
    }
    // by default always apply the h filter, unless asked to unescape with |s
    if (auto) {
      string = dust.filters[auto](string, context);
    }
    return string;
  };

  dust.filters = {
    h: function(value) { return dust.escapeHtml(value); },
    j: function(value) { return dust.escapeJs(value); },
    u: encodeURI,
    uc: encodeURIComponent,
    js: function(value) { return dust.escapeJSON(value); },
    jp: function(value) {
      if (!JSON) {dust.log('JSON is undefined; could not parse `' + value + '`', WARN);
        return value;
      } else {
        return JSON.parse(value);
      }
    }
  };

  function Context(stack, global, options, blocks, templateName) {
    if(stack !== undefined && !(stack instanceof Stack)) {
      stack = new Stack(stack);
    }
    this.stack = stack;
    this.global = global;
    this.options = options;
    this.blocks = blocks;
    this.templateName = templateName;
  }

  dust.makeBase = dust.context = function(global, options) {
    return new Context(undefined, global, options);
  };

  /**
   * Factory function that creates a closure scope around a Thenable-callback.
   * Returns a function that can be passed to a Thenable that will resume a
   * Context lookup once the Thenable resolves with new data, adding that new
   * data to the lookup stack.
   */
  function getWithResolvedData(ctx, cur, down) {
    return function(data) {
      return ctx.push(data)._get(cur, down);
    };
  }

  Context.wrap = function(context, name) {
    if (context instanceof Context) {
      context.templateName = name;
      return context;
    }
    return new Context(context, {}, {}, null, name);
  };

  /**
   * Public API for getting a value from the context.
   * @method get
   * @param {string|array} path The path to the value. Supported formats are:
   * 'key'
   * 'path.to.key'
   * '.path.to.key'
   * ['path', 'to', 'key']
   * ['key']
   * @param {boolean} [cur=false] Boolean which determines if the search should be limited to the
   * current context (true), or if get should search in parent contexts as well (false).
   * @public
   * @returns {string|object}
   */
  Context.prototype.get = function(path, cur) {
    if (typeof path === 'string') {
      if (path[0] === '.') {
        cur = true;
        path = path.substr(1);
      }
      path = path.split('.');
    }
    return this._get(cur, path);
  };

  /**
   * Get a value from the context
   * @method _get
   * @param {boolean} cur Get only from the current context
   * @param {array} down An array of each step in the path
   * @private
   * @return {string | object}
   */
  Context.prototype._get = function(cur, down) {
    var ctx = this.stack || {},
        i = 1,
        value, first, len, ctxThis, fn;

    first = down[0];
    len = down.length;

    if (cur && len === 0) {
      ctxThis = ctx;
      ctx = ctx.head;
    } else {
      if (!cur) {
        // Search up the stack for the first value
        while (ctx) {
          if (ctx.isObject) {
            ctxThis = ctx.head;
            value = ctx.head[first];
            if (value !== undefined) {
              break;
            }
          }
          ctx = ctx.tail;
        }

        // Try looking in the global context if we haven't found anything yet
        if (value !== undefined) {
          ctx = value;
        } else {
          ctx = this.global && this.global[first];
        }
      } else if (ctx) {
        // if scope is limited by a leading dot, don't search up the tree
        if(ctx.head) {
          ctx = ctx.head[first];
        } else {
          // context's head is empty, value we are searching for is not defined
          ctx = undefined;
        }
      }

      while (ctx && i < len) {
        if (dust.isThenable(ctx)) {
          // Bail early by returning a Thenable for the remainder of the search tree
          return ctx.then(getWithResolvedData(this, cur, down.slice(i)));
        }
        ctxThis = ctx;
        ctx = ctx[down[i]];
        i++;
      }
    }

    if (typeof ctx === 'function') {
      fn = function() {
        try {
          return ctx.apply(ctxThis, arguments);
        } catch (err) {
          dust.log(err, ERROR);
          throw err;
        }
      };
      fn.__dustBody = !!ctx.__dustBody;
      return fn;
    } else {
      if (ctx === undefined) {
        dust.log('Cannot find reference `{' + down.join('.') + '}` in template `' + this.getTemplateName() + '`', INFO);
      }
      return ctx;
    }
  };

  Context.prototype.getPath = function(cur, down) {
    return this._get(cur, down);
  };

  Context.prototype.push = function(head, idx, len) {
    if(head === undefined) {
      dust.log("Not pushing an undefined variable onto the context", INFO);
      return this;
    }
    return this.rebase(new Stack(head, this.stack, idx, len));
  };

  Context.prototype.pop = function() {
    var head = this.current();
    this.stack = this.stack && this.stack.tail;
    return head;
  };

  Context.prototype.rebase = function(head) {
    return new Context(head, this.global, this.options, this.blocks, this.getTemplateName());
  };

  Context.prototype.clone = function() {
    var context = this.rebase();
    context.stack = this.stack;
    return context;
  };

  Context.prototype.current = function() {
    return this.stack && this.stack.head;
  };

  Context.prototype.getBlock = function(key) {
    var blocks, len, fn;

    if (typeof key === 'function') {
      key = key(new Chunk(), this).data.join('');
    }

    blocks = this.blocks;

    if (!blocks) {
      dust.log('No blocks for context `' + key + '` in template `' + this.getTemplateName() + '`', DEBUG);
      return false;
    }

    len = blocks.length;
    while (len--) {
      fn = blocks[len][key];
      if (fn) {
        return fn;
      }
    }

    dust.log('Malformed template `' + this.getTemplateName() + '` was missing one or more blocks.');
    return false;
  };

  Context.prototype.shiftBlocks = function(locals) {
    var blocks = this.blocks,
        newBlocks;

    if (locals) {
      if (!blocks) {
        newBlocks = [locals];
      } else {
        newBlocks = blocks.concat([locals]);
      }
      return new Context(this.stack, this.global, this.options, newBlocks, this.getTemplateName());
    }
    return this;
  };

  Context.prototype.resolve = function(body) {
    var chunk;

    if(typeof body !== 'function') {
      return body;
    }
    chunk = new Chunk().render(body, this);
    if(chunk instanceof Chunk) {
      return chunk.data.join(''); // ie7 perf
    }
    return chunk;
  };

  Context.prototype.getTemplateName = function() {
    return this.templateName;
  };

  function Stack(head, tail, idx, len) {
    this.tail = tail;
    this.isObject = head && typeof head === 'object';
    this.head = head;
    this.index = idx;
    this.of = len;
  }

  function Stub(callback) {
    this.head = new Chunk(this);
    this.callback = callback;
    this.out = '';
  }

  Stub.prototype.flush = function() {
    var chunk = this.head;

    while (chunk) {
      if (chunk.flushable) {
        this.out += chunk.data.join(''); //ie7 perf
      } else if (chunk.error) {
        this.callback(chunk.error);
        dust.log('Rendering failed with error `' + chunk.error + '`', ERROR);
        this.flush = EMPTY_FUNC;
        return;
      } else {
        return;
      }
      chunk = chunk.next;
      this.head = chunk;
    }
    this.callback(null, this.out);
  };

  /**
   * Creates an interface sort of like a Streams2 ReadableStream.
   */
  function Stream() {
    this.head = new Chunk(this);
  }

  Stream.prototype.flush = function() {
    var chunk = this.head;

    while(chunk) {
      if (chunk.flushable) {
        this.emit('data', chunk.data.join('')); //ie7 perf
      } else if (chunk.error) {
        this.emit('error', chunk.error);
        this.emit('end');
        dust.log('Streaming failed with error `' + chunk.error + '`', ERROR);
        this.flush = EMPTY_FUNC;
        return;
      } else {
        return;
      }
      chunk = chunk.next;
      this.head = chunk;
    }
    this.emit('end');
  };

  /**
   * Executes listeners for `type` by passing data. Note that this is different from a
   * Node stream, which can pass an arbitrary number of arguments
   * @return `true` if event had listeners, `false` otherwise
   */
  Stream.prototype.emit = function(type, data) {
    var events = this.events || {},
        handlers = events[type] || [],
        i, l;

    if (!handlers.length) {
      dust.log('Stream broadcasting, but no listeners for `' + type + '`', DEBUG);
      return false;
    }

    handlers = handlers.slice(0);
    for (i = 0, l = handlers.length; i < l; i++) {
      handlers[i](data);
    }
    return true;
  };

  Stream.prototype.on = function(type, callback) {
    var events = this.events = this.events || {},
        handlers = events[type] = events[type] || [];

    if(typeof callback !== 'function') {
      dust.log('No callback function provided for `' + type + '` event listener', WARN);
    } else {
      handlers.push(callback);
    }
    return this;
  };

  /**
   * Pipes to a WritableStream. Note that backpressure isn't implemented,
   * so we just write as fast as we can.
   * @param stream {WritableStream}
   * @return self
   */
  Stream.prototype.pipe = function(stream) {
    if(typeof stream.write !== 'function' ||
       typeof stream.end !== 'function') {
      dust.log('Incompatible stream passed to `pipe`', WARN);
      return this;
    }

    var destEnded = false;

    if(typeof stream.emit === 'function') {
      stream.emit('pipe', this);
    }

    if(typeof stream.on === 'function') {
      stream.on('error', function() {
        destEnded = true;
      });
    }

    return this
    .on('data', function(data) {
      if(destEnded) {
        return;
      }
      try {
        stream.write(data, 'utf8');
      } catch (err) {
        dust.log(err, ERROR);
      }
    })
    .on('end', function() {
      if(destEnded) {
        return;
      }
      try {
        stream.end();
        destEnded = true;
      } catch (err) {
        dust.log(err, ERROR);
      }
    });
  };

  ///************************** Stack Index **************************************
  // build section context depth indices
  // $idx gives only the current iteration at the current context depth
  // {$0}...{$n} to give current iterations for the current path in nested n contexts
  //  we can recurse the stack object to build an array of context indices

  function StackIndex(stack) {
    this.stack = stack;
    this.index = null;
  }

  StackIndex.prototype.indices = function () {
    var stack=this.stack;
    var arr=[];
    var recurse=function(obj) { //recurse stack.tail for indices
      for (var prop in obj) {
        if (obj.hasOwnProperty(prop)) {
          if (prop === 'tail' && typeof obj[prop] === 'object') {
            var subObject = obj[prop];
            var index = subObject.index;
            if (index !== undefined) {
              arr.push(index);
              recurse(subObject);
            }
          }
        }
      }
    };

    if (stack.index !== undefined) {
      arr.push(stack.index);
      recurse(stack);
      var length = arr.length;
      arr = arr.reverse(); //the way dustjs works, pushing recursed section index values into an array will result in a inside-out sort order(inner-most section first, outermost last). reverse to sort via outside-in order
      var indexArray = [];
      for (var i = 0; i < length; i++) { //transform to an object array
        var obj = { index: '$' + i.toString(), value: arr[i] };
        indexArray.push(obj);
      }
      this.index = '$' + length.toString(); //set the index prop for the stack current depth
      return indexArray;
    } else {
      return null;
    }

  };

  ///********************* END **********************************************




  function Chunk(root, next, taps) {
    this.root = root;
    this.next = next;
    this.data = []; //ie7 perf
    this.flushable = false;
    this.taps = taps;
  }

  Chunk.prototype.write = function(data) {
    var taps = this.taps;

    if (taps) {
      data = taps.go(data);
    }
    this.data.push(data);
    return this;
  };

  Chunk.prototype.end = function(data) {
    if (data) {
      this.write(data);
    }
    this.flushable = true;
    this.root.flush();
    return this;
  };

  Chunk.prototype.map = function(callback) {
    var cursor = new Chunk(this.root, this.next, this.taps),
        branch = new Chunk(this.root, cursor, this.taps);

    this.next = branch;
    this.flushable = true;
    try {
      callback(branch);
    } catch(err) {
      dust.log(err, ERROR);
      branch.setError(err);
    }
    return cursor;
  };

  Chunk.prototype.tap = function(tap) {
    var taps = this.taps;

    if (taps) {
      this.taps = taps.push(tap);
    } else {
      this.taps = new Tap(tap);
    }
    return this;
  };

  Chunk.prototype.untap = function() {
    this.taps = this.taps.tail;
    return this;
  };

  Chunk.prototype.render = function(body, context) {
    return body(this, context);
  };

  Chunk.prototype.reference = function(elem, context, auto, filters) {
    if (typeof elem === 'function') {
      elem = elem.apply(context.current(), [this, context, null, {auto: auto, filters: filters}]);
      if (elem instanceof Chunk) {
        return elem;
      } else {
        return this.reference(elem, context, auto, filters);
      }
    }
    if (dust.isThenable(elem)) {
      return this.await(elem, context, null, auto, filters);
    } else if (dust.isStreamable(elem)) {
      return this.stream(elem, context, null, auto, filters);
    } else if (!dust.isEmpty(elem)) {
      return this.write(dust.filter(elem, auto, filters, context));
    } else {
      return this;
    }
  };

  Chunk.prototype.section = function(elem, context, bodies, params) {
    var body = bodies.block,
        skip = bodies['else'],
        chunk = this,
        i, len, head;

    if (typeof elem === 'function' && !dust.isTemplateFn(elem)) {
      try {
        elem = elem.apply(context.current(), [this, context, bodies, params]);
      } catch(err) {
        dust.log(err, ERROR);
        return this.setError(err);
      }
      // Functions that return chunks are assumed to have handled the chunk manually.
      // Make that chunk the current one and go to the next method in the chain.
      if (elem instanceof Chunk) {
        return elem;
      }
    }

    if (dust.isEmptyObject(bodies)) {
      // No bodies to render, and we've already invoked any function that was available in
      // hopes of returning a Chunk.
      return chunk;
    }

    if (!dust.isEmptyObject(params)) {
      context = context.push(params);
    }

    /*
    Dust's default behavior is to enumerate over the array elem, passing each object in the array to the block.
    When elem resolves to a value or object instead of an array, Dust sets the current context to the value
    and renders the block one time.
    */
    if (dust.isArray(elem)) {
      if (body) {
        len = elem.length;
        if (len > 0) {
          head = context.stack && context.stack.head || {};
          head.$len = len;

          /* MODIFICATION
           mixin section context depth indice helpers
           {$n} will give the current index for the context nth section depth
           ex: accounts.billingAddresses.phoneNumbers
           $0 =the current index at the accounts depth (e.g: 89)
           $1 =the current index at the billingAddresses depth (e.g: 1)
           $2 = the current index at the phoneNumbers depth (e.g: 0)

           why?: data-attribute paths for two-way data-binding
           e.g., <input type=text value={phone} data-bind="value:accounts.{$0}.billingAddresses.{$1}.phoneNumbers.{$2}.phone" />
           */
          var stackIndex = new StackIndex(context.stack);
          var indices = stackIndex.indices();
          var index_ = stackIndex.index;
          if (indices) {
            for (var j = 0; j < indices.length; j++) {
              head[indices[j].index] = indices[j].value;
            }
          }
          //*** END MODIFICATION **/


          for (i = 0; i < len; i++) {
            head.$idx = i;

            /**MODIFICATION **/
            if (index_) {
              head[index_] = i;
            } else {
              head.$0 = i;
            }
            /** END MODIFICATION **/

            chunk = body(chunk, context.push(elem[i], i, len));
          }

          /**MODIFICATION **/
          delete head.$idx;
          delete head.$len;
          if (index_) {
            delete head[index_];
            if (indices) {
              indices.forEach(function (obj) {
                delete head[obj.index];
              });
            }
          } else {
            if (head.$0) {
              delete head.$0;
            }
          }
          /** END MODIFICATION **/

          return chunk;

        } else if (skip) {
          return skip(this, context);
        }
      }
    } else if (dust.isThenable(elem)) {
      return this.await(elem, context, bodies);
    } else if (dust.isStreamable(elem)) {
      return this.stream(elem, context, bodies);
    } else if (elem === true) {
     // true is truthy but does not change context
      if (body) {
        return body(this, context);
      }
    } else if (elem || elem === 0) {
       // everything that evaluates to true are truthy ( e.g. Non-empty strings and Empty objects are truthy. )
       // zero is truthy
       // for anonymous functions that did not returns a chunk, truthiness is evaluated based on the return value
      if (body) {
        return body(this, context.push(elem));
      }
     // nonexistent, scalar false value, scalar empty string, null,
     // undefined are all falsy
    } else if (skip) {
      return skip(this, context);
    }
    dust.log('Section without corresponding key in template `' + context.getTemplateName() + '`', DEBUG);
    return this;
  };

  Chunk.prototype.exists = function(elem, context, bodies) {
    var body = bodies.block,
        skip = bodies['else'];

    if (!dust.isEmpty(elem)) {
      if (body) {
        return body(this, context);
      }
      dust.log('No block for exists check in template `' + context.getTemplateName() + '`', DEBUG);
    } else if (skip) {
      return skip(this, context);
    }
    return this;
  };

  Chunk.prototype.notexists = function(elem, context, bodies) {
    var body = bodies.block,
        skip = bodies['else'];

    if (dust.isEmpty(elem)) {
      if (body) {
        return body(this, context);
      }
      dust.log('No block for not-exists check in template `' + context.getTemplateName() + '`', DEBUG);
    } else if (skip) {
      return skip(this, context);
    }
    return this;
  };

  Chunk.prototype.block = function(elem, context, bodies) {
    var body = elem || bodies.block;

    if (body) {
      return body(this, context);
    }
    return this;
  };

  Chunk.prototype.partial = function(elem, context, partialContext, params) {
    var head;

    if(params === undefined) {
      // Compatibility for < 2.7.0 where `partialContext` did not exist
      params = partialContext;
      partialContext = context;
    }

    if (!dust.isEmptyObject(params)) {
      partialContext = partialContext.clone();
      head = partialContext.pop();
      partialContext = partialContext.push(params)
                                     .push(head);
    }

    if (dust.isTemplateFn(elem)) {
      // The eventual result of evaluating `elem` is a partial name
      // Load the partial after getting its name and end the async chunk
      return this.capture(elem, context, function(name, chunk) {
        load(name, chunk, partialContext).end();
      });
    } else {
      return load(elem, this, partialContext);
    }
  };

  Chunk.prototype.helper = function(name, context, bodies, params, auto) {
    var chunk = this,
        filters = params.filters,
        ret;

    // Pre-2.7.1 compat: if auto is undefined, it's an old template. Automatically escape
    if (auto === undefined) {
      auto = 'h';
    }

    // handle invalid helpers, similar to invalid filters
    if(dust.helpers[name]) {
      try {
        ret = dust.helpers[name](chunk, context, bodies, params);
        if (ret instanceof Chunk) {
          return ret;
        }
        if(typeof filters === 'string') {
          filters = filters.split('|');
        }
        if (!dust.isEmptyObject(bodies)) {
          return chunk.section(ret, context, bodies, params);
        }
        // Helpers act slightly differently from functions in context in that they will act as
        // a reference if they are self-closing (due to grammar limitations)
        // In the Chunk.await function we check to make sure bodies is null before acting as a reference
        return chunk.reference(ret, context, auto, filters);
      } catch(err) {
        dust.log('Error in helper `' + name + '`: ' + err.message, ERROR);
        return chunk.setError(err);
      }
    } else {
      dust.log('Helper `' + name + '` does not exist', WARN);
      return chunk;
    }
  };

  /**
   * Reserve a chunk to be evaluated once a thenable is resolved or rejected
   * @param thenable {Thenable} the target thenable to await
   * @param context {Context} context to use to render the deferred chunk
   * @param bodies {Object} must contain a "body", may contain an "error"
   * @param auto {String} automatically apply this filter if the Thenable is a reference
   * @param filters {Array} apply these filters if the Thenable is a reference
   * @return {Chunk}
   */
  Chunk.prototype.await = function(thenable, context, bodies, auto, filters) {
    return this.map(function(chunk) {
      thenable.then(function(data) {
        if (bodies) {
          chunk = chunk.section(data, context, bodies);
        } else {
          // Actually a reference. Self-closing sections don't render
          chunk = chunk.reference(data, context, auto, filters);
        }
        chunk.end();
      }, function(err) {
        var errorBody = bodies && bodies.error;
        if(errorBody) {
          chunk.render(errorBody, context.push(err)).end();
        } else {
          dust.log('Unhandled promise rejection in `' + context.getTemplateName() + '`', INFO);
          chunk.end();
        }
      });
    });
  };

  /**
   * Reserve a chunk to be evaluated with the contents of a streamable.
   * Currently an error event will bomb out the stream. Once an error
   * is received, we push it to an {:error} block if one exists, and log otherwise,
   * then stop listening to the stream.
   * @param streamable {Streamable} the target streamable that will emit events
   * @param context {Context} context to use to render each thunk
   * @param bodies {Object} must contain a "body", may contain an "error"
   * @return {Chunk}
   */
  Chunk.prototype.stream = function(stream, context, bodies, auto, filters) {
    var body = bodies && bodies.block,
        errorBody = bodies && bodies.error;
    return this.map(function(chunk) {
      var ended = false;
      stream
        .on('data', function data(thunk) {
          if(ended) {
            return;
          }
          if(body) {
            // Fork a new chunk out of the blockstream so that we can flush it independently
            chunk = chunk.map(function(chunk) {
              chunk.render(body, context.push(thunk)).end();
            });
          } else if(!bodies) {
            // When actually a reference, don't fork, just write into the master async chunk
            chunk = chunk.reference(thunk, context, auto, filters);
          }
        })
        .on('error', function error(err) {
          if(ended) {
            return;
          }
          if(errorBody) {
            chunk.render(errorBody, context.push(err));
          } else {
            dust.log('Unhandled stream error in `' + context.getTemplateName() + '`', INFO);
          }
          if(!ended) {
            ended = true;
            chunk.end();
          }
        })
        .on('end', function end() {
          if(!ended) {
            ended = true;
            chunk.end();
          }
        });
    });
  };

  Chunk.prototype.capture = function(body, context, callback) {
    return this.map(function(chunk) {
      var stub = new Stub(function(err, out) {
        if (err) {
          chunk.setError(err);
        } else {
          callback(out, chunk);
        }
      });
      body(stub.head, context).end();
    });
  };

  Chunk.prototype.setError = function(err) {
    this.error = err;
    this.root.flush();
    return this;
  };

  // Chunk aliases
  for(var f in Chunk.prototype) {
    if(dust._aliases[f]) {
      Chunk.prototype[dust._aliases[f]] = Chunk.prototype[f];
    }
  }

  function Tap(head, tail) {
    this.head = head;
    this.tail = tail;
  }

  Tap.prototype.push = function(tap) {
    return new Tap(tap, this);
  };

  Tap.prototype.go = function(value) {
    var tap = this;

    while(tap) {
      value = tap.head(value);
      tap = tap.tail;
    }
    return value;
  };

  var HCHARS = /[&<>"']/,
      AMP    = /&/g,
      LT     = /</g,
      GT     = />/g,
      QUOT   = /\"/g,
      SQUOT  = /\'/g;

  dust.escapeHtml = function(s) {
    if (typeof s === "string" || (s && typeof s.toString === "function")) {
      if (typeof s !== "string") {
        s = s.toString();
      }
      if (!HCHARS.test(s)) {
        return s;
      }
      return s.replace(AMP,'&amp;').replace(LT,'&lt;').replace(GT,'&gt;').replace(QUOT,'&quot;').replace(SQUOT, '&#39;');
    }
    return s;
  };

  var BS = /\\/g,
      FS = /\//g,
      CR = /\r/g,
      LS = /\u2028/g,
      PS = /\u2029/g,
      NL = /\n/g,
      LF = /\f/g,
      SQ = /'/g,
      DQ = /"/g,
      TB = /\t/g;

  dust.escapeJs = function(s) {
    if (typeof s === 'string') {
      return s
        .replace(BS, '\\\\')
        .replace(FS, '\\/')
        .replace(DQ, '\\"')
        .replace(SQ, '\\\'')
        .replace(CR, '\\r')
        .replace(LS, '\\u2028')
        .replace(PS, '\\u2029')
        .replace(NL, '\\n')
        .replace(LF, '\\f')
        .replace(TB, '\\t');
    }
    return s;
  };

  dust.escapeJSON = function(o) {
    if (!JSON) {
      dust.log('JSON is undefined; could not escape `' + o + '`', WARN);
      return o;
    } else {
      return JSON.stringify(o)
        .replace(LS, '\\u2028')
        .replace(PS, '\\u2029')
        .replace(LT, '\\u003c');
    }
  };

  return dust;

}));

(function(root, factory) {
  if (typeof define === "function" && define.amd && define.amd.dust === true) {
    define("dust.parse", ["dust.core"], function(dust) {
      return factory(dust).parse;
    });
  } else if (typeof exports === 'object') {
    // in Node, require this file if we want to use the parser as a standalone module
    module.exports = factory(require('./dust'));
    // @see server file for parser methods exposed in node
  } else {
    // in the browser, store the factory output if we want to use the parser directly
    factory(root.dust);
  }
}(this, function(dust) {
  var parser = (function() {
  "use strict";

  /*
   * Generated by PEG.js 0.9.0.
   *
   * http://pegjs.org/
   */

  function peg$subclass(child, parent) {
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
  }

  function peg$SyntaxError(message, expected, found, location) {
    this.message  = message;
    this.expected = expected;
    this.found    = found;
    this.location = location;
    this.name     = "SyntaxError";

    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, peg$SyntaxError);
    }
  }

  peg$subclass(peg$SyntaxError, Error);

  function peg$parse(input) {
    var options = arguments.length > 1 ? arguments[1] : {},
        parser  = this,

        peg$FAILED = {},

        peg$startRuleFunctions = { start: peg$parsestart },
        peg$startRuleFunction  = peg$parsestart,

        peg$c0 = function(p) {
            var body = ["body"].concat(p);
            return withPosition(body);
          },
        peg$c1 = { type: "other", description: "section" },
        peg$c2 = function(t, b, e, n) {
            if( (!n) || (t[1].text !== n.text) ) {
              error("Expected end tag for "+t[1].text+" but it was not found.");
            }
            return true;
          },
        peg$c3 = function(t, b, e, n) {
            e.push(["param", ["literal", "block"], b]);
            t.push(e, ["filters"]);
            return withPosition(t)
          },
        peg$c4 = "/",
        peg$c5 = { type: "literal", value: "/", description: "\"/\"" },
        peg$c6 = function(t) {
            t.push(["bodies"], ["filters"]);
            return withPosition(t)
          },
        peg$c7 = /^[#?\^<+@%]/,
        peg$c8 = { type: "class", value: "[#?^<+@%]", description: "[#?^<+@%]" },
        peg$c9 = function(t, n, c, p) { return [t, n, c, p] },
        peg$c10 = { type: "other", description: "end tag" },
        peg$c11 = function(n) { return n },
        peg$c12 = ":",
        peg$c13 = { type: "literal", value: ":", description: "\":\"" },
        peg$c14 = function(n) {return n},
        peg$c15 = function(n) { return n ? ["context", n] : ["context"] },
        peg$c16 = { type: "other", description: "params" },
        peg$c17 = "=",
        peg$c18 = { type: "literal", value: "=", description: "\"=\"" },
        peg$c19 = function(k, v) {return ["param", ["literal", k], v]},
        peg$c20 = function(p) { return ["params"].concat(p) },
        peg$c21 = { type: "other", description: "bodies" },
        peg$c22 = function(p) { return ["bodies"].concat(p) },
        peg$c23 = { type: "other", description: "reference" },
        peg$c24 = function(n, f) { return withPosition(["reference", n, f]) },
        peg$c25 = { type: "other", description: "partial" },
        peg$c26 = ">",
        peg$c27 = { type: "literal", value: ">", description: "\">\"" },
        peg$c28 = "+",
        peg$c29 = { type: "literal", value: "+", description: "\"+\"" },
        peg$c30 = function(s, k) {return ["literal", k]},
        peg$c31 = function(s, n, c, p) {
            var key = (s === ">") ? "partial" : s;
            return withPosition([key, n, c, p])
          },
        peg$c32 = { type: "other", description: "filters" },
        peg$c33 = "|",
        peg$c34 = { type: "literal", value: "|", description: "\"|\"" },
        peg$c35 = function(f) { return ["filters"].concat(f) },
        peg$c36 = { type: "other", description: "special" },
        peg$c37 = "~",
        peg$c38 = { type: "literal", value: "~", description: "\"~\"" },
        peg$c39 = function(k) { return withPosition(["special", k]) },
        peg$c40 = { type: "other", description: "identifier" },
        peg$c41 = function(p) {
            var arr = ["path"].concat(p);
            arr.text = p[1].join('.').replace(/,line,\d+,col,\d+/g,'');
            return arr;
          },
        peg$c42 = function(k) {
            var arr = ["key", k];
            arr.text = k;
            return arr;
          },
        peg$c43 = { type: "other", description: "number" },
        peg$c44 = function(n) { return ['literal', n]; },
        peg$c45 = { type: "other", description: "float" },
        peg$c46 = ".",
        peg$c47 = { type: "literal", value: ".", description: "\".\"" },
        peg$c48 = function(l, r) { return parseFloat(l + "." + r); },
        peg$c49 = { type: "other", description: "unsigned_integer" },
        peg$c50 = /^[0-9]/,
        peg$c51 = { type: "class", value: "[0-9]", description: "[0-9]" },
        peg$c52 = function(digits) { return makeInteger(digits); },
        peg$c53 = { type: "other", description: "signed_integer" },
        peg$c54 = "-",
        peg$c55 = { type: "literal", value: "-", description: "\"-\"" },
        peg$c56 = function(sign, n) { return n * -1; },
        peg$c57 = { type: "other", description: "integer" },
        peg$c58 = { type: "other", description: "path" },
        peg$c59 = function(k, d) {
            d = d[0];
            if (k && d) {
              d.unshift(k);
              return withPosition([false, d])
            }
            return withPosition([true, d])
          },
        peg$c60 = function(d) {
            if (d.length > 0) {
              return withPosition([true, d[0]])
            }
            return withPosition([true, []])
          },
        peg$c61 = { type: "other", description: "key" },
        peg$c62 = /^[a-zA-Z_$]/,
        peg$c63 = { type: "class", value: "[a-zA-Z_$]", description: "[a-zA-Z_$]" },
        peg$c64 = /^[0-9a-zA-Z_$\-]/,
        peg$c65 = { type: "class", value: "[0-9a-zA-Z_$-]", description: "[0-9a-zA-Z_$-]" },
        peg$c66 = function(h, t) { return h + t.join('') },
        peg$c67 = { type: "other", description: "array" },
        peg$c68 = function(n) {return n.join('')},
        peg$c69 = function(a) {return a; },
        peg$c70 = function(i, nk) { if(nk) { nk.unshift(i); } else {nk = [i] } return nk; },
        peg$c71 = { type: "other", description: "array_part" },
        peg$c72 = function(k) {return k},
        peg$c73 = function(d, a) { if (a) { return d.concat(a); } else { return d; } },
        peg$c74 = { type: "other", description: "inline" },
        peg$c75 = "\"",
        peg$c76 = { type: "literal", value: "\"", description: "\"\\\"\"" },
        peg$c77 = function() { return withPosition(["literal", ""]) },
        peg$c78 = function(l) { return withPosition(["literal", l]) },
        peg$c79 = function(p) { return withPosition(["body"].concat(p)) },
        peg$c80 = function(l) { return ["buffer", l] },
        peg$c81 = { type: "other", description: "buffer" },
        peg$c82 = function(e, w) { return withPosition(["format", e, w.join('')]) },
        peg$c83 = { type: "any", description: "any character" },
        peg$c84 = function(c) {return c},
        peg$c85 = function(b) { return withPosition(["buffer", b.join('')]) },
        peg$c86 = { type: "other", description: "literal" },
        peg$c87 = /^[^"]/,
        peg$c88 = { type: "class", value: "[^\"]", description: "[^\"]" },
        peg$c89 = function(b) { return b.join('') },
        peg$c90 = "\\\"",
        peg$c91 = { type: "literal", value: "\\\"", description: "\"\\\\\\\"\"" },
        peg$c92 = function() { return '"' },
        peg$c93 = { type: "other", description: "raw" },
        peg$c94 = "{`",
        peg$c95 = { type: "literal", value: "{`", description: "\"{`\"" },
        peg$c96 = "`}",
        peg$c97 = { type: "literal", value: "`}", description: "\"`}\"" },
        peg$c98 = function(character) {return character},
        peg$c99 = function(rawText) { return withPosition(["raw", rawText.join('')]) },
        peg$c100 = { type: "other", description: "comment" },
        peg$c101 = "{!",
        peg$c102 = { type: "literal", value: "{!", description: "\"{!\"" },
        peg$c103 = "!}",
        peg$c104 = { type: "literal", value: "!}", description: "\"!}\"" },
        peg$c105 = function(c) { return withPosition(["comment", c.join('')]) },
        peg$c106 = /^[#?\^><+%:@\/~%]/,
        peg$c107 = { type: "class", value: "[#?^><+%:@/~%]", description: "[#?^><+%:@/~%]" },
        peg$c108 = "{",
        peg$c109 = { type: "literal", value: "{", description: "\"{\"" },
        peg$c110 = "}",
        peg$c111 = { type: "literal", value: "}", description: "\"}\"" },
        peg$c112 = "[",
        peg$c113 = { type: "literal", value: "[", description: "\"[\"" },
        peg$c114 = "]",
        peg$c115 = { type: "literal", value: "]", description: "\"]\"" },
        peg$c116 = "\n",
        peg$c117 = { type: "literal", value: "\n", description: "\"\\n\"" },
        peg$c118 = "\r\n",
        peg$c119 = { type: "literal", value: "\r\n", description: "\"\\r\\n\"" },
        peg$c120 = "\r",
        peg$c121 = { type: "literal", value: "\r", description: "\"\\r\"" },
        peg$c122 = "\u2028",
        peg$c123 = { type: "literal", value: "\u2028", description: "\"\\u2028\"" },
        peg$c124 = "\u2029",
        peg$c125 = { type: "literal", value: "\u2029", description: "\"\\u2029\"" },
        peg$c126 = /^[\t\x0B\f \xA0\uFEFF]/,
        peg$c127 = { type: "class", value: "[\\t\\v\\f \\u00A0\\uFEFF]", description: "[\\t\\v\\f \\u00A0\\uFEFF]" },

        peg$currPos          = 0,
        peg$savedPos         = 0,
        peg$posDetailsCache  = [{ line: 1, column: 1, seenCR: false }],
        peg$maxFailPos       = 0,
        peg$maxFailExpected  = [],
        peg$silentFails      = 0,

        peg$result;

    if ("startRule" in options) {
      if (!(options.startRule in peg$startRuleFunctions)) {
        throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
      }

      peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
    }

    function text() {
      return input.substring(peg$savedPos, peg$currPos);
    }

    function location() {
      return peg$computeLocation(peg$savedPos, peg$currPos);
    }

    function expected(description) {
      throw peg$buildException(
        null,
        [{ type: "other", description: description }],
        input.substring(peg$savedPos, peg$currPos),
        peg$computeLocation(peg$savedPos, peg$currPos)
      );
    }

    function error(message) {
      throw peg$buildException(
        message,
        null,
        input.substring(peg$savedPos, peg$currPos),
        peg$computeLocation(peg$savedPos, peg$currPos)
      );
    }

    function peg$computePosDetails(pos) {
      var details = peg$posDetailsCache[pos],
          p, ch;

      if (details) {
        return details;
      } else {
        p = pos - 1;
        while (!peg$posDetailsCache[p]) {
          p--;
        }

        details = peg$posDetailsCache[p];
        details = {
          line:   details.line,
          column: details.column,
          seenCR: details.seenCR
        };

        while (p < pos) {
          ch = input.charAt(p);
          if (ch === "\n") {
            if (!details.seenCR) { details.line++; }
            details.column = 1;
            details.seenCR = false;
          } else if (ch === "\r" || ch === "\u2028" || ch === "\u2029") {
            details.line++;
            details.column = 1;
            details.seenCR = true;
          } else {
            details.column++;
            details.seenCR = false;
          }

          p++;
        }

        peg$posDetailsCache[pos] = details;
        return details;
      }
    }

    function peg$computeLocation(startPos, endPos) {
      var startPosDetails = peg$computePosDetails(startPos),
          endPosDetails   = peg$computePosDetails(endPos);

      return {
        start: {
          offset: startPos,
          line:   startPosDetails.line,
          column: startPosDetails.column
        },
        end: {
          offset: endPos,
          line:   endPosDetails.line,
          column: endPosDetails.column
        }
      };
    }

    function peg$fail(expected) {
      if (peg$currPos < peg$maxFailPos) { return; }

      if (peg$currPos > peg$maxFailPos) {
        peg$maxFailPos = peg$currPos;
        peg$maxFailExpected = [];
      }

      peg$maxFailExpected.push(expected);
    }

    function peg$buildException(message, expected, found, location) {
      function cleanupExpected(expected) {
        var i = 1;

        expected.sort(function(a, b) {
          if (a.description < b.description) {
            return -1;
          } else if (a.description > b.description) {
            return 1;
          } else {
            return 0;
          }
        });

        while (i < expected.length) {
          if (expected[i - 1] === expected[i]) {
            expected.splice(i, 1);
          } else {
            i++;
          }
        }
      }

      function buildMessage(expected, found) {
        function stringEscape(s) {
          function hex(ch) { return ch.charCodeAt(0).toString(16).toUpperCase(); }

          return s
            .replace(/\\/g,   '\\\\')
            .replace(/"/g,    '\\"')
            .replace(/\x08/g, '\\b')
            .replace(/\t/g,   '\\t')
            .replace(/\n/g,   '\\n')
            .replace(/\f/g,   '\\f')
            .replace(/\r/g,   '\\r')
            .replace(/[\x00-\x07\x0B\x0E\x0F]/g, function(ch) { return '\\x0' + hex(ch); })
            .replace(/[\x10-\x1F\x80-\xFF]/g,    function(ch) { return '\\x'  + hex(ch); })
            .replace(/[\u0100-\u0FFF]/g,         function(ch) { return '\\u0' + hex(ch); })
            .replace(/[\u1000-\uFFFF]/g,         function(ch) { return '\\u'  + hex(ch); });
        }

        var expectedDescs = new Array(expected.length),
            expectedDesc, foundDesc, i;

        for (i = 0; i < expected.length; i++) {
          expectedDescs[i] = expected[i].description;
        }

        expectedDesc = expected.length > 1
          ? expectedDescs.slice(0, -1).join(", ")
              + " or "
              + expectedDescs[expected.length - 1]
          : expectedDescs[0];

        foundDesc = found ? "\"" + stringEscape(found) + "\"" : "end of input";

        return "Expected " + expectedDesc + " but " + foundDesc + " found.";
      }

      if (expected !== null) {
        cleanupExpected(expected);
      }

      return new peg$SyntaxError(
        message !== null ? message : buildMessage(expected, found),
        expected,
        found,
        location
      );
    }

    function peg$parsestart() {
      var s0;

      s0 = peg$parsebody();

      return s0;
    }

    function peg$parsebody() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parsepart();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parsepart();
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c0(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsepart() {
      var s0;

      s0 = peg$parseraw();
      if (s0 === peg$FAILED) {
        s0 = peg$parsecomment();
        if (s0 === peg$FAILED) {
          s0 = peg$parsesection();
          if (s0 === peg$FAILED) {
            s0 = peg$parsepartial();
            if (s0 === peg$FAILED) {
              s0 = peg$parsespecial();
              if (s0 === peg$FAILED) {
                s0 = peg$parsereference();
                if (s0 === peg$FAILED) {
                  s0 = peg$parsebuffer();
                }
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsesection() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsesec_tag_start();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsews();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parsews();
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parserd();
          if (s3 !== peg$FAILED) {
            s4 = peg$parsebody();
            if (s4 !== peg$FAILED) {
              s5 = peg$parsebodies();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseend_tag();
                if (s6 === peg$FAILED) {
                  s6 = null;
                }
                if (s6 !== peg$FAILED) {
                  peg$savedPos = peg$currPos;
                  s7 = peg$c2(s1, s4, s5, s6);
                  if (s7) {
                    s7 = void 0;
                  } else {
                    s7 = peg$FAILED;
                  }
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c3(s1, s4, s5, s6);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parsesec_tag_start();
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parsews();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parsews();
          }
          if (s2 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 47) {
              s3 = peg$c4;
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c5); }
            }
            if (s3 !== peg$FAILED) {
              s4 = peg$parserd();
              if (s4 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c6(s1);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c1); }
      }

      return s0;
    }

    function peg$parsesec_tag_start() {
      var s0, s1, s2, s3, s4, s5, s6;

      s0 = peg$currPos;
      s1 = peg$parseld();
      if (s1 !== peg$FAILED) {
        if (peg$c7.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c8); }
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parsews();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parsews();
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parseidentifier();
            if (s4 !== peg$FAILED) {
              s5 = peg$parsecontext();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseparams();
                if (s6 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c9(s2, s4, s5, s6);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseend_tag() {
      var s0, s1, s2, s3, s4, s5, s6;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parseld();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 47) {
          s2 = peg$c4;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c5); }
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parsews();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parsews();
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parseidentifier();
            if (s4 !== peg$FAILED) {
              s5 = [];
              s6 = peg$parsews();
              while (s6 !== peg$FAILED) {
                s5.push(s6);
                s6 = peg$parsews();
              }
              if (s5 !== peg$FAILED) {
                s6 = peg$parserd();
                if (s6 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c11(s4);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c10); }
      }

      return s0;
    }

    function peg$parsecontext() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 58) {
        s2 = peg$c12;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c13); }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseidentifier();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s1;
          s2 = peg$c14(s3);
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 === peg$FAILED) {
        s1 = null;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c15(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parseparams() {
      var s0, s1, s2, s3, s4, s5, s6;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$currPos;
      s3 = [];
      s4 = peg$parsews();
      if (s4 !== peg$FAILED) {
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parsews();
        }
      } else {
        s3 = peg$FAILED;
      }
      if (s3 !== peg$FAILED) {
        s4 = peg$parsekey();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 61) {
            s5 = peg$c17;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c18); }
          }
          if (s5 !== peg$FAILED) {
            s6 = peg$parsenumber();
            if (s6 === peg$FAILED) {
              s6 = peg$parseidentifier();
              if (s6 === peg$FAILED) {
                s6 = peg$parseinline();
              }
            }
            if (s6 !== peg$FAILED) {
              peg$savedPos = s2;
              s3 = peg$c19(s4, s6);
              s2 = s3;
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$currPos;
        s3 = [];
        s4 = peg$parsews();
        if (s4 !== peg$FAILED) {
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parsews();
          }
        } else {
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsekey();
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 61) {
              s5 = peg$c17;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c18); }
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$parsenumber();
              if (s6 === peg$FAILED) {
                s6 = peg$parseidentifier();
                if (s6 === peg$FAILED) {
                  s6 = peg$parseinline();
                }
              }
              if (s6 !== peg$FAILED) {
                peg$savedPos = s2;
                s3 = peg$c19(s4, s6);
                s2 = s3;
              } else {
                peg$currPos = s2;
                s2 = peg$FAILED;
              }
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c20(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c16); }
      }

      return s0;
    }

    function peg$parsebodies() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$currPos;
      s3 = peg$parseld();
      if (s3 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 58) {
          s4 = peg$c12;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c13); }
        }
        if (s4 !== peg$FAILED) {
          s5 = peg$parsekey();
          if (s5 !== peg$FAILED) {
            s6 = peg$parserd();
            if (s6 !== peg$FAILED) {
              s7 = peg$parsebody();
              if (s7 !== peg$FAILED) {
                peg$savedPos = s2;
                s3 = peg$c19(s5, s7);
                s2 = s3;
              } else {
                peg$currPos = s2;
                s2 = peg$FAILED;
              }
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$currPos;
        s3 = peg$parseld();
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 58) {
            s4 = peg$c12;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c13); }
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parsekey();
            if (s5 !== peg$FAILED) {
              s6 = peg$parserd();
              if (s6 !== peg$FAILED) {
                s7 = peg$parsebody();
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s2;
                  s3 = peg$c19(s5, s7);
                  s2 = s3;
                } else {
                  peg$currPos = s2;
                  s2 = peg$FAILED;
                }
              } else {
                peg$currPos = s2;
                s2 = peg$FAILED;
              }
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c22(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c21); }
      }

      return s0;
    }

    function peg$parsereference() {
      var s0, s1, s2, s3, s4;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parseld();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseidentifier();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsefilters();
          if (s3 !== peg$FAILED) {
            s4 = peg$parserd();
            if (s4 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c24(s2, s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c23); }
      }

      return s0;
    }

    function peg$parsepartial() {
      var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parseld();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 62) {
          s2 = peg$c26;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c27); }
        }
        if (s2 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 43) {
            s2 = peg$c28;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c29); }
          }
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parsews();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parsews();
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$currPos;
            s5 = peg$parsekey();
            if (s5 !== peg$FAILED) {
              peg$savedPos = s4;
              s5 = peg$c30(s2, s5);
            }
            s4 = s5;
            if (s4 === peg$FAILED) {
              s4 = peg$parseinline();
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parsecontext();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseparams();
                if (s6 !== peg$FAILED) {
                  s7 = [];
                  s8 = peg$parsews();
                  while (s8 !== peg$FAILED) {
                    s7.push(s8);
                    s8 = peg$parsews();
                  }
                  if (s7 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 47) {
                      s8 = peg$c4;
                      peg$currPos++;
                    } else {
                      s8 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c5); }
                    }
                    if (s8 !== peg$FAILED) {
                      s9 = peg$parserd();
                      if (s9 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c31(s2, s4, s5, s6);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c25); }
      }

      return s0;
    }

    function peg$parsefilters() {
      var s0, s1, s2, s3, s4;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 124) {
        s3 = peg$c33;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c34); }
      }
      if (s3 !== peg$FAILED) {
        s4 = peg$parsekey();
        if (s4 !== peg$FAILED) {
          peg$savedPos = s2;
          s3 = peg$c14(s4);
          s2 = s3;
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 124) {
          s3 = peg$c33;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c34); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsekey();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s2;
            s3 = peg$c14(s4);
            s2 = s3;
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c35(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c32); }
      }

      return s0;
    }

    function peg$parsespecial() {
      var s0, s1, s2, s3, s4;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parseld();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 126) {
          s2 = peg$c37;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c38); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsekey();
          if (s3 !== peg$FAILED) {
            s4 = peg$parserd();
            if (s4 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c39(s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c36); }
      }

      return s0;
    }

    function peg$parseidentifier() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsepath();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c41(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parsekey();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c42(s1);
        }
        s0 = s1;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c40); }
      }

      return s0;
    }

    function peg$parsenumber() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsefloat();
      if (s1 === peg$FAILED) {
        s1 = peg$parseinteger();
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c44(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c43); }
      }

      return s0;
    }

    function peg$parsefloat() {
      var s0, s1, s2, s3;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parseinteger();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s2 = peg$c46;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c47); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parseunsigned_integer();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c48(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c45); }
      }

      return s0;
    }

    function peg$parseunsigned_integer() {
      var s0, s1, s2;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = [];
      if (peg$c50.test(input.charAt(peg$currPos))) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c51); }
      }
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          if (peg$c50.test(input.charAt(peg$currPos))) {
            s2 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c51); }
          }
        }
      } else {
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c52(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c49); }
      }

      return s0;
    }

    function peg$parsesigned_integer() {
      var s0, s1, s2;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 45) {
        s1 = peg$c54;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c55); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseunsigned_integer();
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c56(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c53); }
      }

      return s0;
    }

    function peg$parseinteger() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$parsesigned_integer();
      if (s0 === peg$FAILED) {
        s0 = peg$parseunsigned_integer();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c57); }
      }

      return s0;
    }

    function peg$parsepath() {
      var s0, s1, s2, s3;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsekey();
      if (s1 === peg$FAILED) {
        s1 = null;
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsearray_part();
        if (s3 === peg$FAILED) {
          s3 = peg$parsearray();
        }
        if (s3 !== peg$FAILED) {
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parsearray_part();
            if (s3 === peg$FAILED) {
              s3 = peg$parsearray();
            }
          }
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c59(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 46) {
          s1 = peg$c46;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c47); }
        }
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parsearray_part();
          if (s3 === peg$FAILED) {
            s3 = peg$parsearray();
          }
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parsearray_part();
            if (s3 === peg$FAILED) {
              s3 = peg$parsearray();
            }
          }
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c60(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c58); }
      }

      return s0;
    }

    function peg$parsekey() {
      var s0, s1, s2, s3;

      peg$silentFails++;
      s0 = peg$currPos;
      if (peg$c62.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c63); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        if (peg$c64.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c65); }
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          if (peg$c64.test(input.charAt(peg$currPos))) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c65); }
          }
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c66(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c61); }
      }

      return s0;
    }

    function peg$parsearray() {
      var s0, s1, s2, s3, s4, s5;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = peg$parselb();
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = [];
        if (peg$c50.test(input.charAt(peg$currPos))) {
          s5 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c51); }
        }
        if (s5 !== peg$FAILED) {
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            if (peg$c50.test(input.charAt(peg$currPos))) {
              s5 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c51); }
            }
          }
        } else {
          s4 = peg$FAILED;
        }
        if (s4 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c68(s4);
        }
        s3 = s4;
        if (s3 === peg$FAILED) {
          s3 = peg$parseidentifier();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parserb();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c69(s3);
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsearray_part();
        if (s2 === peg$FAILED) {
          s2 = null;
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c70(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c67); }
      }

      return s0;
    }

    function peg$parsearray_part() {
      var s0, s1, s2, s3, s4;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 46) {
        s3 = peg$c46;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c47); }
      }
      if (s3 !== peg$FAILED) {
        s4 = peg$parsekey();
        if (s4 !== peg$FAILED) {
          peg$savedPos = s2;
          s3 = peg$c72(s4);
          s2 = s3;
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 46) {
            s3 = peg$c46;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c47); }
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parsekey();
            if (s4 !== peg$FAILED) {
              peg$savedPos = s2;
              s3 = peg$c72(s4);
              s2 = s3;
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        }
      } else {
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsearray();
        if (s2 === peg$FAILED) {
          s2 = null;
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c73(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c71); }
      }

      return s0;
    }

    function peg$parseinline() {
      var s0, s1, s2, s3;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c75;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c76); }
      }
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 34) {
          s2 = peg$c75;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c76); }
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c77();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 34) {
          s1 = peg$c75;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c76); }
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseliteral();
          if (s2 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 34) {
              s3 = peg$c75;
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c76); }
            }
            if (s3 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c78(s2);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 34) {
            s1 = peg$c75;
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c76); }
          }
          if (s1 !== peg$FAILED) {
            s2 = [];
            s3 = peg$parseinline_part();
            if (s3 !== peg$FAILED) {
              while (s3 !== peg$FAILED) {
                s2.push(s3);
                s3 = peg$parseinline_part();
              }
            } else {
              s2 = peg$FAILED;
            }
            if (s2 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 34) {
                s3 = peg$c75;
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c76); }
              }
              if (s3 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c79(s2);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c74); }
      }

      return s0;
    }

    function peg$parseinline_part() {
      var s0, s1;

      s0 = peg$parsespecial();
      if (s0 === peg$FAILED) {
        s0 = peg$parsereference();
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseliteral();
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c80(s1);
          }
          s0 = s1;
        }
      }

      return s0;
    }

    function peg$parsebuffer() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parseeol();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsews();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parsews();
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c82(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$currPos;
        s3 = peg$currPos;
        peg$silentFails++;
        s4 = peg$parsetag();
        peg$silentFails--;
        if (s4 === peg$FAILED) {
          s3 = void 0;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$currPos;
          peg$silentFails++;
          s5 = peg$parseraw();
          peg$silentFails--;
          if (s5 === peg$FAILED) {
            s4 = void 0;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$currPos;
            peg$silentFails++;
            s6 = peg$parsecomment();
            peg$silentFails--;
            if (s6 === peg$FAILED) {
              s5 = void 0;
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$currPos;
              peg$silentFails++;
              s7 = peg$parseeol();
              peg$silentFails--;
              if (s7 === peg$FAILED) {
                s6 = void 0;
              } else {
                peg$currPos = s6;
                s6 = peg$FAILED;
              }
              if (s6 !== peg$FAILED) {
                if (input.length > peg$currPos) {
                  s7 = input.charAt(peg$currPos);
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c83); }
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s2;
                  s3 = peg$c84(s7);
                  s2 = s3;
                } else {
                  peg$currPos = s2;
                  s2 = peg$FAILED;
                }
              } else {
                peg$currPos = s2;
                s2 = peg$FAILED;
              }
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          while (s2 !== peg$FAILED) {
            s1.push(s2);
            s2 = peg$currPos;
            s3 = peg$currPos;
            peg$silentFails++;
            s4 = peg$parsetag();
            peg$silentFails--;
            if (s4 === peg$FAILED) {
              s3 = void 0;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
            if (s3 !== peg$FAILED) {
              s4 = peg$currPos;
              peg$silentFails++;
              s5 = peg$parseraw();
              peg$silentFails--;
              if (s5 === peg$FAILED) {
                s4 = void 0;
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
              if (s4 !== peg$FAILED) {
                s5 = peg$currPos;
                peg$silentFails++;
                s6 = peg$parsecomment();
                peg$silentFails--;
                if (s6 === peg$FAILED) {
                  s5 = void 0;
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
                if (s5 !== peg$FAILED) {
                  s6 = peg$currPos;
                  peg$silentFails++;
                  s7 = peg$parseeol();
                  peg$silentFails--;
                  if (s7 === peg$FAILED) {
                    s6 = void 0;
                  } else {
                    peg$currPos = s6;
                    s6 = peg$FAILED;
                  }
                  if (s6 !== peg$FAILED) {
                    if (input.length > peg$currPos) {
                      s7 = input.charAt(peg$currPos);
                      peg$currPos++;
                    } else {
                      s7 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c83); }
                    }
                    if (s7 !== peg$FAILED) {
                      peg$savedPos = s2;
                      s3 = peg$c84(s7);
                      s2 = s3;
                    } else {
                      peg$currPos = s2;
                      s2 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s2;
                    s2 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s2;
                  s2 = peg$FAILED;
                }
              } else {
                peg$currPos = s2;
                s2 = peg$FAILED;
              }
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          }
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c85(s1);
        }
        s0 = s1;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c81); }
      }

      return s0;
    }

    function peg$parseliteral() {
      var s0, s1, s2, s3, s4;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$currPos;
      s3 = peg$currPos;
      peg$silentFails++;
      s4 = peg$parsetag();
      peg$silentFails--;
      if (s4 === peg$FAILED) {
        s3 = void 0;
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      if (s3 !== peg$FAILED) {
        s4 = peg$parseesc();
        if (s4 === peg$FAILED) {
          if (peg$c87.test(input.charAt(peg$currPos))) {
            s4 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c88); }
          }
        }
        if (s4 !== peg$FAILED) {
          peg$savedPos = s2;
          s3 = peg$c84(s4);
          s2 = s3;
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$currPos;
          s3 = peg$currPos;
          peg$silentFails++;
          s4 = peg$parsetag();
          peg$silentFails--;
          if (s4 === peg$FAILED) {
            s3 = void 0;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parseesc();
            if (s4 === peg$FAILED) {
              if (peg$c87.test(input.charAt(peg$currPos))) {
                s4 = input.charAt(peg$currPos);
                peg$currPos++;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c88); }
              }
            }
            if (s4 !== peg$FAILED) {
              peg$savedPos = s2;
              s3 = peg$c84(s4);
              s2 = s3;
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        }
      } else {
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c89(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c86); }
      }

      return s0;
    }

    function peg$parseesc() {
      var s0, s1;

      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c90) {
        s1 = peg$c90;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c91); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c92();
      }
      s0 = s1;

      return s0;
    }

    function peg$parseraw() {
      var s0, s1, s2, s3, s4, s5;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c94) {
        s1 = peg$c94;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c95); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$currPos;
        peg$silentFails++;
        if (input.substr(peg$currPos, 2) === peg$c96) {
          s5 = peg$c96;
          peg$currPos += 2;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c97); }
        }
        peg$silentFails--;
        if (s5 === peg$FAILED) {
          s4 = void 0;
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        if (s4 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s5 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c83); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c98(s5);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$currPos;
          peg$silentFails++;
          if (input.substr(peg$currPos, 2) === peg$c96) {
            s5 = peg$c96;
            peg$currPos += 2;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c97); }
          }
          peg$silentFails--;
          if (s5 === peg$FAILED) {
            s4 = void 0;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
          if (s4 !== peg$FAILED) {
            if (input.length > peg$currPos) {
              s5 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c83); }
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s3;
              s4 = peg$c98(s5);
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        }
        if (s2 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c96) {
            s3 = peg$c96;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c97); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c99(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c93); }
      }

      return s0;
    }

    function peg$parsecomment() {
      var s0, s1, s2, s3, s4, s5;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c101) {
        s1 = peg$c101;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c102); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$currPos;
        peg$silentFails++;
        if (input.substr(peg$currPos, 2) === peg$c103) {
          s5 = peg$c103;
          peg$currPos += 2;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c104); }
        }
        peg$silentFails--;
        if (s5 === peg$FAILED) {
          s4 = void 0;
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        if (s4 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s5 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c83); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c84(s5);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$currPos;
          peg$silentFails++;
          if (input.substr(peg$currPos, 2) === peg$c103) {
            s5 = peg$c103;
            peg$currPos += 2;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c104); }
          }
          peg$silentFails--;
          if (s5 === peg$FAILED) {
            s4 = void 0;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
          if (s4 !== peg$FAILED) {
            if (input.length > peg$currPos) {
              s5 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c83); }
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s3;
              s4 = peg$c84(s5);
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        }
        if (s2 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c103) {
            s3 = peg$c103;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c104); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c105(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c100); }
      }

      return s0;
    }

    function peg$parsetag() {
      var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

      s0 = peg$currPos;
      s1 = peg$parseld();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsews();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parsews();
        }
        if (s2 !== peg$FAILED) {
          if (peg$c106.test(input.charAt(peg$currPos))) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c107); }
          }
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$parsews();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parsews();
            }
            if (s4 !== peg$FAILED) {
              s5 = [];
              s6 = peg$currPos;
              s7 = peg$currPos;
              peg$silentFails++;
              s8 = peg$parserd();
              peg$silentFails--;
              if (s8 === peg$FAILED) {
                s7 = void 0;
              } else {
                peg$currPos = s7;
                s7 = peg$FAILED;
              }
              if (s7 !== peg$FAILED) {
                s8 = peg$currPos;
                peg$silentFails++;
                s9 = peg$parseeol();
                peg$silentFails--;
                if (s9 === peg$FAILED) {
                  s8 = void 0;
                } else {
                  peg$currPos = s8;
                  s8 = peg$FAILED;
                }
                if (s8 !== peg$FAILED) {
                  if (input.length > peg$currPos) {
                    s9 = input.charAt(peg$currPos);
                    peg$currPos++;
                  } else {
                    s9 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c83); }
                  }
                  if (s9 !== peg$FAILED) {
                    s7 = [s7, s8, s9];
                    s6 = s7;
                  } else {
                    peg$currPos = s6;
                    s6 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s6;
                  s6 = peg$FAILED;
                }
              } else {
                peg$currPos = s6;
                s6 = peg$FAILED;
              }
              if (s6 !== peg$FAILED) {
                while (s6 !== peg$FAILED) {
                  s5.push(s6);
                  s6 = peg$currPos;
                  s7 = peg$currPos;
                  peg$silentFails++;
                  s8 = peg$parserd();
                  peg$silentFails--;
                  if (s8 === peg$FAILED) {
                    s7 = void 0;
                  } else {
                    peg$currPos = s7;
                    s7 = peg$FAILED;
                  }
                  if (s7 !== peg$FAILED) {
                    s8 = peg$currPos;
                    peg$silentFails++;
                    s9 = peg$parseeol();
                    peg$silentFails--;
                    if (s9 === peg$FAILED) {
                      s8 = void 0;
                    } else {
                      peg$currPos = s8;
                      s8 = peg$FAILED;
                    }
                    if (s8 !== peg$FAILED) {
                      if (input.length > peg$currPos) {
                        s9 = input.charAt(peg$currPos);
                        peg$currPos++;
                      } else {
                        s9 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c83); }
                      }
                      if (s9 !== peg$FAILED) {
                        s7 = [s7, s8, s9];
                        s6 = s7;
                      } else {
                        peg$currPos = s6;
                        s6 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s6;
                      s6 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s6;
                    s6 = peg$FAILED;
                  }
                }
              } else {
                s5 = peg$FAILED;
              }
              if (s5 !== peg$FAILED) {
                s6 = [];
                s7 = peg$parsews();
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$parsews();
                }
                if (s6 !== peg$FAILED) {
                  s7 = peg$parserd();
                  if (s7 !== peg$FAILED) {
                    s1 = [s1, s2, s3, s4, s5, s6, s7];
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$parsereference();
      }

      return s0;
    }

    function peg$parseld() {
      var s0;

      if (input.charCodeAt(peg$currPos) === 123) {
        s0 = peg$c108;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c109); }
      }

      return s0;
    }

    function peg$parserd() {
      var s0;

      if (input.charCodeAt(peg$currPos) === 125) {
        s0 = peg$c110;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c111); }
      }

      return s0;
    }

    function peg$parselb() {
      var s0;

      if (input.charCodeAt(peg$currPos) === 91) {
        s0 = peg$c112;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c113); }
      }

      return s0;
    }

    function peg$parserb() {
      var s0;

      if (input.charCodeAt(peg$currPos) === 93) {
        s0 = peg$c114;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c115); }
      }

      return s0;
    }

    function peg$parseeol() {
      var s0;

      if (input.charCodeAt(peg$currPos) === 10) {
        s0 = peg$c116;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c117); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c118) {
          s0 = peg$c118;
          peg$currPos += 2;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c119); }
        }
        if (s0 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 13) {
            s0 = peg$c120;
            peg$currPos++;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c121); }
          }
          if (s0 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 8232) {
              s0 = peg$c122;
              peg$currPos++;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c123); }
            }
            if (s0 === peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 8233) {
                s0 = peg$c124;
                peg$currPos++;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c125); }
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsews() {
      var s0;

      if (peg$c126.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c127); }
      }
      if (s0 === peg$FAILED) {
        s0 = peg$parseeol();
      }

      return s0;
    }


      function makeInteger(arr) {
        return parseInt(arr.join(''), 10);
      }
      function withPosition(arr) {
        return arr.concat([['line', location().start.line], ['col', location().start.column]]);
      }


    peg$result = peg$startRuleFunction();

    if (peg$result !== peg$FAILED && peg$currPos === input.length) {
      return peg$result;
    } else {
      if (peg$result !== peg$FAILED && peg$currPos < input.length) {
        peg$fail({ type: "end", description: "end of input" });
      }

      throw peg$buildException(
        null,
        peg$maxFailExpected,
        peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
        peg$maxFailPos < input.length
          ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
          : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
      );
    }
  }

  return {
    SyntaxError: peg$SyntaxError,
    parse:       peg$parse
  };
})();

  // expose parser methods
  dust.parse = parser.parse;

  return parser;
}));

(function(root, factory) {
  if (typeof define === "function" && define.amd && define.amd.dust === true) {
    define("dust.compile", ["dust.core", "dust.parse"], function(dust, parse) {
      return factory(parse, dust).compile;
    });
  } else if (typeof exports === 'object') {
    // in Node, require this file if we want to use the compiler as a standalone module
    module.exports = factory(require('./parser').parse, require('./dust'));
  } else {
    // in the browser, store the factory output if we want to use the compiler directly
    factory(root.dust.parse, root.dust);
  }
}(this, function(parse, dust) {
  var compiler = {},
      isArray = dust.isArray;


  compiler.compile = function(source, name) {
    // the name parameter is optional.
    // this can happen for templates that are rendered immediately (renderSource which calls compileFn) or
    // for templates that are compiled as a callable (compileFn)
    //
    // for the common case (using compile and render) a name is required so that templates will be cached by name and rendered later, by name.

    try {
      var ast = filterAST(parse(source));
      return compile(ast, name);
    } catch (err) {
      if (!err.location) {
        throw err;
      }
      throw new SyntaxError(err.message + ' [' + name + ':' + err.location.start.line + ':' + err.location.start.column + ']');
    }
  };

  function filterAST(ast) {
    var context = {};
    return compiler.filterNode(context, ast);
  }

  compiler.filterNode = function(context, node) {
    return compiler.optimizers[node[0]](context, node);
  };

  compiler.optimizers = {
    body:      compactBuffers,
    buffer:    noop,
    special:   convertSpecial,
    format:    format,
    reference: visit,
    '#':       visit,
    '?':       visit,
    '^':       visit,
    '<':       visit,
    '+':       visit,
    '@':       visit,
    '%':       visit,
    partial:   visit,
    context:   visit,
    params:    visit,
    bodies:    visit,
    param:     visit,
    filters:   noop,
    key:       noop,
    path:      noop,
    literal:   noop,
    raw:       noop,
    comment:   nullify,
    line:      nullify,
    col:       nullify
  };

  compiler.pragmas = {
    esc: function(compiler, context, bodies) {
      var old = compiler.auto,
          out;
      if (!context) {
        context = 'h';
      }
      compiler.auto = (context === 's') ? '' : context;
      out = compileParts(compiler, bodies.block);
      compiler.auto = old;
      return out;
    }
  };

  function visit(context, node) {
    var out = [node[0]],
        i, len, res;
    for (i=1, len=node.length; i<len; i++) {
      res = compiler.filterNode(context, node[i]);
      if (res) {
        out.push(res);
      }
    }
    return out;
  }

  // Compacts consecutive buffer nodes into a single node
  function compactBuffers(context, node) {
    var out = [node[0]],
        memo, i, len, res;
    for (i=1, len=node.length; i<len; i++) {
      res = compiler.filterNode(context, node[i]);
      if (res) {
        if (res[0] === 'buffer' || res[0] === 'format') {
          if (memo) {
            memo[0] = (res[0] === 'buffer') ? 'buffer' : memo[0];
            memo[1] += res.slice(1, -2).join('');
          } else {
            memo = res;
            out.push(res);
          }
        } else {
          memo = null;
          out.push(res);
        }
      }
    }
    return out;
  }

  var specialChars = {
    's': ' ',
    'n': '\n',
    'r': '\r',
    'lb': '{',
    'rb': '}'
  };

  function convertSpecial(context, node) {
    return ['buffer', specialChars[node[1]], node[2], node[3]];
  }

  function noop(context, node) {
    return node;
  }

  function nullify(){}

  function format(context, node) {
    if(dust.config.whitespace) {
      // Format nodes are in the form ['format', eol, whitespace, line, col],
      // which is unlike other nodes in that there are two pieces of content
      // Join eol and whitespace together to normalize the node format
      node.splice(1, 2, node.slice(1, -2).join(''));
      return node;
    }
    return null;
  }

  function compile(ast, name) {
    var context = {
      name: name,
      bodies: [],
      blocks: {},
      index: 0,
      auto: 'h'
    },
    escapedName = dust.escapeJs(name),
    AMDName = name? '"' + escapedName + '",' : '',
    compiled = 'function(dust){',
    entry = compiler.compileNode(context, ast),
    iife;

    if(name) {
      compiled += 'dust.register("' + escapedName + '",' + entry + ');';
    }

    compiled += compileBlocks(context) +
                compileBodies(context) +
                'return ' + entry + '}';

    iife = '(' + compiled + '(dust));';

    if(dust.config.amd) {
      return 'define(' + AMDName + '["dust.core"],' + compiled + ');';
    } else if(dust.config.cjs) {
      return 'module.exports=function(dust){' +
             'var tmpl=' + iife +
             'var f=' + loaderFor().toString() + ';' +
             'f.template=tmpl;return f}';
    } else {
      return iife;
    }
  }

  function compileBlocks(context) {
    var out = [],
        blocks = context.blocks,
        name;

    for (name in blocks) {
      out.push('"' + name + '":' + blocks[name]);
    }
    if (out.length) {
      context.blocks = 'ctx=ctx.shiftBlocks(blocks);';
      return 'var blocks={' + out.join(',') + '};';
    } else {
      context.blocks = '';
    }
    return context.blocks;
  }

  function compileBodies(context) {
    var out = [],
        bodies = context.bodies,
        blx = context.blocks,
        i, len;

    for (i=0, len=bodies.length; i<len; i++) {
      out[i] = 'function body_' + i + '(chk,ctx){' +
          blx + 'return chk' + bodies[i] + ';}body_' + i + '.__dustBody=!0;';
    }
    return out.join('');
  }

  function compileParts(context, body) {
    var parts = '',
        i, len;
    for (i=1, len=body.length; i<len; i++) {
      parts += compiler.compileNode(context, body[i]);
    }
    return parts;
  }

  compiler.compileNode = function(context, node) {
    return compiler.nodes[node[0]](context, node);
  };

  compiler.nodes = {
    body: function(context, node) {
      var id = context.index++,
          name = 'body_' + id;
      context.bodies[id] = compileParts(context, node);
      return name;
    },

    buffer: function(context, node) {
      return '.w(' + escape(node[1]) + ')';
    },

    format: function(context, node) {
      return '.w(' + escape(node[1]) + ')';
    },

    reference: function(context, node) {
      return '.f(' + compiler.compileNode(context, node[1]) +
        ',ctx,' + compiler.compileNode(context, node[2]) + ')';
    },

    '#': function(context, node) {
      return compileSection(context, node, 'section');
    },

    '?': function(context, node) {
      return compileSection(context, node, 'exists');
    },

    '^': function(context, node) {
      return compileSection(context, node, 'notexists');
    },

    '<': function(context, node) {
      var bodies = node[4];
      for (var i=1, len=bodies.length; i<len; i++) {
        var param = bodies[i],
            type = param[1][1];
        if (type === 'block') {
          context.blocks[node[1].text] = compiler.compileNode(context, param[2]);
          return '';
        }
      }
      return '';
    },

    '+': function(context, node) {
      if (typeof(node[1].text) === 'undefined'  && typeof(node[4]) === 'undefined'){
        return '.b(ctx.getBlock(' +
              compiler.compileNode(context, node[1]) +
              ',chk, ctx),' + compiler.compileNode(context, node[2]) + ', {},' +
              compiler.compileNode(context, node[3]) +
              ')';
      } else {
        return '.b(ctx.getBlock(' +
            escape(node[1].text) +
            '),' + compiler.compileNode(context, node[2]) + ',' +
            compiler.compileNode(context, node[4]) + ',' +
            compiler.compileNode(context, node[3]) +
            ')';
      }
    },

    '@': function(context, node) {
      return '.h(' +
        escape(node[1].text) +
        ',' + compiler.compileNode(context, node[2]) + ',' +
        compiler.compileNode(context, node[4]) + ',' +
        compiler.compileNode(context, node[3]) + ',' +
        compiler.compileNode(context, node[5]) +
        ')';
    },

    '%': function(context, node) {
      // TODO: Move these hacks into pragma precompiler
      var name = node[1][1],
          rawBodies,
          bodies,
          rawParams,
          params,
          ctx, b, p, i, len;
      if (!compiler.pragmas[name]) {
        return '';
      }

      rawBodies = node[4];
      bodies = {};
      for (i=1, len=rawBodies.length; i<len; i++) {
        b = rawBodies[i];
        bodies[b[1][1]] = b[2];
      }

      rawParams = node[3];
      params = {};
      for (i=1, len=rawParams.length; i<len; i++) {
        p = rawParams[i];
        params[p[1][1]] = p[2][1];
      }

      ctx = node[2][1] ? node[2][1].text : null;

      return compiler.pragmas[name](context, ctx, bodies, params);
    },

    partial: function(context, node) {
      return '.p(' +
          compiler.compileNode(context, node[1]) +
          ',ctx,' + compiler.compileNode(context, node[2]) +
          ',' + compiler.compileNode(context, node[3]) + ')';
    },

    context: function(context, node) {
      if (node[1]) {
        return 'ctx.rebase(' + compiler.compileNode(context, node[1]) + ')';
      }
      return 'ctx';
    },

    params: function(context, node) {
      var out = [];
      for (var i=1, len=node.length; i<len; i++) {
        out.push(compiler.compileNode(context, node[i]));
      }
      if (out.length) {
        return '{' + out.join(',') + '}';
      }
      return '{}';
    },

    bodies: function(context, node) {
      var out = [];
      for (var i=1, len=node.length; i<len; i++) {
        out.push(compiler.compileNode(context, node[i]));
      }
      return '{' + out.join(',') + '}';
    },

    param: function(context, node) {
      return compiler.compileNode(context, node[1]) + ':' + compiler.compileNode(context, node[2]);
    },

    filters: function(context, node) {
      var list = [];
      for (var i=1, len=node.length; i<len; i++) {
        var filter = node[i];
        list.push('"' + filter + '"');
      }
      return '"' + context.auto + '"' +
        (list.length ? ',[' + list.join(',') + ']' : '');
    },

    key: function(context, node) {
      return 'ctx.get(["' + node[1] + '"], false)';
    },

    path: function(context, node) {
      var current = node[1],
          keys = node[2],
          list = [];

      for (var i=0,len=keys.length; i<len; i++) {
        if (isArray(keys[i])) {
          list.push(compiler.compileNode(context, keys[i]));
        } else {
          list.push('"' + keys[i] + '"');
        }
      }
      return 'ctx.getPath(' + current + ', [' + list.join(',') + '])';
    },

    literal: function(context, node) {
      return escape(node[1]);
    },
    raw: function(context, node) {
      return ".w(" + escape(node[1]) + ")";
    }
  };

  function compileSection(context, node, cmd) {
    return '.' + (dust._aliases[cmd] || cmd) + '(' +
      compiler.compileNode(context, node[1]) +
      ',' + compiler.compileNode(context, node[2]) + ',' +
      compiler.compileNode(context, node[4]) + ',' +
      compiler.compileNode(context, node[3]) +
      ')';
  }

  var BS = /\\/g,
      DQ = /"/g,
      LF = /\f/g,
      NL = /\n/g,
      CR = /\r/g,
      TB = /\t/g;
  function escapeToJsSafeString(str) {
    return str.replace(BS, '\\\\')
              .replace(DQ, '\\"')
              .replace(LF, '\\f')
              .replace(NL, '\\n')
              .replace(CR, '\\r')
              .replace(TB, '\\t');
  }

  var escape = (typeof JSON === 'undefined') ?
                  function(str) { return '"' + escapeToJsSafeString(str) + '"';} :
                  JSON.stringify;

  function renderSource(source, context, callback) {
    var tmpl = dust.loadSource(dust.compile(source));
    return loaderFor(tmpl)(context, callback);
  }

  function compileFn(source, name) {
    var tmpl = dust.loadSource(dust.compile(source, name));
    return loaderFor(tmpl);
  }

  function loaderFor(tmpl) {
    return function load(ctx, cb) {
      var fn = cb ? 'render' : 'stream';
      return dust[fn](tmpl, ctx, cb);
    };
  }

  // expose compiler methods
  dust.compiler = compiler;
  dust.compile = dust.compiler.compile;
  dust.renderSource = renderSource;
  dust.compileFn = compileFn;

  // DEPRECATED legacy names. Removed in 2.8.0
  dust.filterNode = compiler.filterNode;
  dust.optimizers = compiler.optimizers;
  dust.pragmas = compiler.pragmas;
  dust.compileNode = compiler.compileNode;
  dust.nodes = compiler.nodes;

  return compiler;

}));

if (typeof define === "function" && define.amd && define.amd.dust === true) {
    define(["require", "dust.core", "dust.compile"], function(require, dust) {
        dust.onLoad = function(name, cb) {
            require([name], function(tmpl) {
                cb(null, tmpl);
            });
        };
        return dust;
    });
}

/*! dustjs-helpers - v1.7.3
* http://dustjs.com/
* Copyright (c) 2015 Aleksander Williams; Released under the MIT License */
(function(root, factory) {
  if (typeof define === 'function' && define.amd && define.amd.dust === true) {
    define(['dust.core'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('dustjs-linkedin'));
  } else {
    factory(root.dust);
  }
}(this, function(dust) {

function log(helper, msg, level) {
  level = level || "INFO";
  helper = helper ? '{@' + helper + '}: ' : '';
  dust.log(helper + msg, level);
}

var _deprecatedCache = {};
function _deprecated(target) {
  if(_deprecatedCache[target]) { return; }
  log(target, "Deprecation warning: " + target + " is deprecated and will be removed in a future version of dustjs-helpers", "WARN");
  log(null, "For help and a deprecation timeline, see https://github.com/linkedin/dustjs-helpers/wiki/Deprecated-Features#" + target.replace(/\W+/g, ""), "WARN");
  _deprecatedCache[target] = true;
}

function isSelect(context) {
  return context.stack.tail &&
         context.stack.tail.head &&
         typeof context.stack.tail.head.__select__ !== "undefined";
}

function getSelectState(context) {
  return isSelect(context) && context.get('__select__');
}

/**
 * Adds a special __select__ key behind the head of the context stack. Used to maintain the state
 * of {@select} blocks
 * @param context {Context} add state to this Context
 * @param opts {Object} add these properties to the state (`key` and `type`)
 */
function addSelectState(context, opts) {
  var head = context.stack.head,
      newContext = context.rebase(),
      key;

  if(context.stack && context.stack.tail) {
    newContext.stack = context.stack.tail;
  }

  var state = {
    isPending: false,
    isResolved: false,
    isDeferredComplete: false,
    deferreds: []
  };

  for(key in opts) {
    state[key] = opts[key];
  }

  return newContext
  .push({ "__select__": state })
  .push(head, context.stack.index, context.stack.of);
}

/**
 * After a {@select} or {@math} block is complete, they invoke this function
 */
function resolveSelectDeferreds(state) {
  var x, len;
  state.isDeferredPending = true;
  if(state.deferreds.length) {
    state.isDeferredComplete = true;
    for(x=0, len=state.deferreds.length; x<len; x++) {
      state.deferreds[x]();
    }
  }
  state.isDeferredPending = false;
}

/**
 * Used by {@contextDump}
 */
function jsonFilter(key, value) {
  if (typeof value === "function") {
    return value.toString()
      .replace(/(^\s+|\s+$)/mg, '')
      .replace(/\n/mg, '')
      .replace(/,\s*/mg, ', ')
      .replace(/\)\{/mg, ') {');
  }
  return value;
}

/**
 * Generate a truth test helper
 */
function truthTest(name, test) {
  return function(chunk, context, bodies, params) {
    return filter(chunk, context, bodies, params, name, test);
  };
}

/**
 * This function is invoked by truth test helpers
 */
function filter(chunk, context, bodies, params, helperName, test) {
  var body = bodies.block,
      skip = bodies['else'],
      selectState = getSelectState(context) || {},
      willResolve, key, value, type;

  // Once one truth test in a select passes, short-circuit the rest of the tests
  if (selectState.isResolved && !selectState.isDeferredPending) {
    return chunk;
  }

  // First check for a key on the helper itself, then look for a key on the {@select}
  if (params.hasOwnProperty('key')) {
    key = params.key;
  } else if (selectState.hasOwnProperty('key')) {
    key = selectState.key;
  } else {
    log(helperName, "No key specified", "WARN");
    return chunk;
  }

  type = params.type || selectState.type;

  key = coerce(context.resolve(key), type);
  value = coerce(context.resolve(params.value), type);

  if (test(key, value)) {
    // Once a truth test passes, put the select into "pending" state. Now we can render the body of
    // the truth test (which may contain truth tests) without altering the state of the select.
    if (!selectState.isPending) {
      willResolve = true;
      selectState.isPending = true;
    }
    if (body) {
      chunk = chunk.render(body, context);
    }
    if (willResolve) {
      selectState.isResolved = true;
    }
  } else if (skip) {
    chunk = chunk.render(skip, context);
  }
  return chunk;
}

function coerce(value, type) {
  if (type) {
    type = type.toLowerCase();
  }
  switch (type) {
    case 'number': return +value;
    case 'string': return String(value);
    case 'boolean':
      value = (value === 'false' ? false : value);
      return Boolean(value);
    case 'date': return new Date(value);
  }

  return value;
}

var helpers = {

  // Utility helping to resolve dust references in the given chunk
  // uses native Dust Context#resolve (available since Dust 2.6.2)
  "tap": function(input, chunk, context) {
    // deprecated for removal in 1.8
    _deprecated("tap");
    return context.resolve(input);
  },

  "sep": function(chunk, context, bodies) {
    var body = bodies.block;
    if (context.stack.index === context.stack.of - 1) {
      return chunk;
    }
    if (body) {
      return body(chunk, context);
    } else {
      return chunk;
    }
  },

  "first": function(chunk, context, bodies) {
    if (context.stack.index === 0) {
      return bodies.block(chunk, context);
    }
    return chunk;
  },

  "last": function(chunk, context, bodies) {
    if (context.stack.index === context.stack.of - 1) {
      return bodies.block(chunk, context);
    }
    return chunk;
  },

  /**
   * {@contextDump}
   * @param key {String} set to "full" to the full context stack, otherwise the current context is dumped
   * @param to {String} set to "console" to log to console, otherwise outputs to the chunk
   */
  "contextDump": function(chunk, context, bodies, params) {
    var to = context.resolve(params.to),
        key = context.resolve(params.key),
        target, output;
    switch(key) {
      case 'full':
        target = context.stack;
        break;
      default:
        target = context.stack.head;
    }
    output = JSON.stringify(target, jsonFilter, 2);
    switch(to) {
      case 'console':
        log('contextDump', output);
        break;
      default:
        output = output.replace(/</g, '\\u003c');
        chunk = chunk.write(output);
    }
    return chunk;
  },

  /**
   * {@math}
   * @param key first value
   * @param method {String} operation to perform
   * @param operand second value (not required for operations like `abs`)
   * @param round if truthy, round() the result
   */
  "math": function (chunk, context, bodies, params) {
    var key = params.key,
        method = params.method,
        operand = params.operand,
        round = params.round,
        output, state, x, len;

    if(!params.hasOwnProperty('key') || !params.method) {
      log("math", "`key` or `method` was not provided", "ERROR");
      return chunk;
    }

    key = parseFloat(context.resolve(key));
    operand = parseFloat(context.resolve(operand));

    switch(method) {
      case "mod":
        if(operand === 0) {
          log("math", "Division by 0", "ERROR");
        }
        output = key % operand;
        break;
      case "add":
        output = key + operand;
        break;
      case "subtract":
        output = key - operand;
        break;
      case "multiply":
        output = key * operand;
        break;
      case "divide":
        if(operand === 0) {
          log("math", "Division by 0", "ERROR");
        }
        output = key / operand;
        break;
      case "ceil":
      case "floor":
      case "round":
      case "abs":
        output = Math[method](key);
        break;
      case "toint":
        output = parseInt(key, 10);
        break;
      default:
        log("math", "Method `" + method + "` is not supported", "ERROR");
    }

    if (typeof output !== 'undefined') {
      if (round) {
        output = Math.round(output);
      }
      if (bodies && bodies.block) {
        context = addSelectState(context, { key: output });
        chunk = chunk.render(bodies.block, context);
        resolveSelectDeferreds(getSelectState(context));
      } else {
        chunk = chunk.write(output);
      }
    }

    return chunk;
  },

  /**
   * {@select}
   * Groups a set of truth tests and outputs the first one that passes.
   * Also contains {@any} and {@none} blocks.
   * @param key a value or reference to use as the left-hand side of comparisons
   * @param type coerce all truth test keys without an explicit type to this type
   */
  "select": function(chunk, context, bodies, params) {
    var body = bodies.block,
        state = {};

    if (params.hasOwnProperty('key')) {
      state.key = context.resolve(params.key);
    }
    if (params.hasOwnProperty('type')) {
      state.type = params.type;
    }

    if (body) {
      context = addSelectState(context, state);
      chunk = chunk.render(body, context);
      resolveSelectDeferreds(getSelectState(context));
    } else {
      log("select", "Missing body block", "WARN");
    }
    return chunk;
  },

  /**
   * Truth test helpers
   * @param key a value or reference to use as the left-hand side of comparisons
   * @param value a value or reference to use as the right-hand side of comparisons
   * @param type if specified, `key` and `value` will be forcibly cast to this type
   */
  "eq": truthTest('eq', function(left, right) {
    return left === right;
  }),
  "ne": truthTest('ne', function(left, right) {
    return left !== right;
  }),
  "lt": truthTest('lt', function(left, right) {
    return left < right;
  }),
  "lte": truthTest('lte', function(left, right) {
    return left <= right;
  }),
  "gt": truthTest('gt', function(left, right) {
    return left > right;
  }),
  "gte": truthTest('gte', function(left, right) {
    return left >= right;
  }),

  /**
   * {@any}
   * Outputs as long as at least one truth test inside a {@select} has passed.
   * Must be contained inside a {@select} block.
   * The passing truth test can be before or after the {@any} block.
   */
  "any": function(chunk, context, bodies, params) {
    var selectState = getSelectState(context);

    if(!selectState) {
      log("any", "Must be used inside a {@select} block", "ERROR");
    } else {
      if(selectState.isDeferredComplete) {
        log("any", "Must not be nested inside {@any} or {@none} block", "ERROR");
      } else {
        chunk = chunk.map(function(chunk) {
          selectState.deferreds.push(function() {
            if(selectState.isResolved) {
              chunk = chunk.render(bodies.block, context);
            }
            chunk.end();
          });
        });
      }
    }
    return chunk;
  },

  /**
   * {@none}
   * Outputs if no truth tests inside a {@select} pass.
   * Must be contained inside a {@select} block.
   * The position of the helper does not matter.
   */
  "none": function(chunk, context, bodies, params) {
    var selectState = getSelectState(context);

    if(!selectState) {
      log("none", "Must be used inside a {@select} block", "ERROR");
    } else {
      if(selectState.isDeferredComplete) {
        log("none", "Must not be nested inside {@any} or {@none} block", "ERROR");
      } else {
        chunk = chunk.map(function(chunk) {
          selectState.deferreds.push(function() {
            if(!selectState.isResolved) {
              chunk = chunk.render(bodies.block, context);
            }
            chunk.end();
          });
        });
      }
    }
    return chunk;
  },

  /**
  * {@size}
  * Write the size of the target to the chunk
  * Falsy values and true have size 0
  * Numbers are returned as-is
  * Arrays and Strings have size equal to their length
  * Objects have size equal to the number of keys they contain
  * Dust bodies are evaluated and the length of the string is returned
  * Functions are evaluated and the length of their return value is evaluated
  * @param key find the size of this value or reference
  */
  "size": function(chunk, context, bodies, params) {
    var key = params.key,
        value, k;

    key = context.resolve(params.key);
    if (!key || key === true) {
      value = 0;
    } else if(dust.isArray(key)) {
      value = key.length;
    } else if (!isNaN(parseFloat(key)) && isFinite(key)) {
      value = key;
    } else if (typeof key === "object") {
      value = 0;
      for(k in key){
        if(key.hasOwnProperty(k)){
          value++;
        }
      }
    } else {
      value = (key + '').length;
    }
    return chunk.write(value);
  }

};

for(var key in helpers) {
  dust.helpers[key] = helpers[key];
}

return dust;

}));


/*
 * =============================================================
 * dust helpers
 * =============================================================
 *
 */

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory(require('dustjs'), require('dustjs-helpers'),require('moment'),require('elliptical-utils'));
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['dustjs','dustjs-helpers','moment','elliptical-utils'], factory);
    } else {
        // Browser globals (root is window)
        root.returnExports = factory(root.dust,root.dust.helpers,root.moment,root.elliptical.utils);
    }
}(this, function (dust,helpers,moment,utils) {

    var string=utils.string;
    var url=utils.url;
    var random=utils.random;

    dust.helpers.formatCurrency=function(chunk, context, bodies, params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var money;
        try{
            if(utils.isNumeric(value)){
                value=parseFloat(value);
                money =value.toFixed(2);
            }else{
                money='';
            }
        }catch(ex){
            money='';
        }
        return chunk.write(money);
    };

    dust.helpers.extFormatCurrency=function(chunk, context, bodies, params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var money;
        try{
            if(utils.isNumeric(value)){
                value=parseFloat(value);
                money =value.toFixed(2);
                money = '$' + money.toString();
            }else{
                money='';
            }
        }catch(ex){
            money='';
        }
        return chunk.write(money);
    };

    dust.helpers.formatDate=function(chunk, context, bodies, params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var format=params.format || 'MM-DD-YYYY';
        if(value){
            value=moment(value).format(format);
        }else{
            value='';
        }
        return chunk.write(value);
    };

    dust.helpers.placeholder=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var defaultValue=dust.helpers.tap(params.defaultValue, chunk, context);
        return (value) ? chunk.write(value) : chunk.write(defaultValue);
    };


    dust.helpers.phraseCase = function (chunk, context, bodies, params) {
        var value = dust.helpers.tap(params.value, chunk, context);
        value = string.camelCaseToSpace(value);
        return chunk.write(value);
    };

    dust.helpers.checked=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var checked='';
        if(value){
            checked='checked';
        }
        return chunk.write(checked);
    };

    dust.helpers.radio=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var key= dust.helpers.tap(params.key, chunk, context);
        var checked='';
        try{
            if(value && value.toLowerCase()===key.toLowerCase()){
                checked='checked';
            }
        }catch(ex){

        }
        return chunk.write(checked);
    };


    dust.helpers.selected=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var key= dust.helpers.tap(params.key, chunk, context);
        var selected='';
        try{
            if(value && value.toLowerCase()===key.toLowerCase()){
                selected='selected';
            }
        }catch(ex){

        }
        return chunk.write(selected);
    };

    dust.helpers.truthy=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var true_= dust.helpers.tap(params.true, chunk, context);
        var false_= dust.helpers.tap(params.false, chunk, context);

        var out=(value) ? true_ : false_;

        return chunk.write(out);
    };

    dust.helpers.hide=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var hide='';
        if(value){
            hide='hide';
        }
        return chunk.write(hide);
    };

    dust.helpers.disable=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var disable='';
        if(value){
            disable='disabled';
        }
        return chunk.write(disable);
    };

    dust.helpers.readonly=function(chunk,context,bodies,params){
        var value = dust.helpers.tap(params.value, chunk, context);
        var readOnly='';
        if(value){
            readOnly='readonly';
        }
        return chunk.write(readOnly);
    };

    dust.helpers.position=function(chunk,context,bodies){
        var value=context.stack.index + 1;
        return chunk.write(value);
    };

    dust.helpers.index=function(chunk,context,bodies){
        var value=context.stack.index;
        return chunk.write(value);
    };

    dust.helpers.urlEncode=function(chunk, context, bodies, params){
        var value = dust.helpers.tap(params.value, chunk, context);
        if (value) {
            console.log(value);
            value=encodeURIComponent(value);
        }else{
            value='';
        }
        return chunk.write(value);
    };

    dust.helpers.toggle=function(chunk, context, bodies, params){
        var css='';
        var value = dust.helpers.tap(params.value, chunk, context);
        var on=dust.helpers.tap(params.on, chunk, context);
        var onCSS=dust.helpers.tap(params.onCSS, chunk, context);
        var offCSS=dust.helpers.tap(params.offCSS, chunk, context);
        css=(value===on) ? onCSS : offCSS;

        return chunk.write(css);
    };

    dust.helpers.compare=function(chunk, context, bodies, params){
        var output='';
        var value = dust.helpers.tap(params.value, chunk, context);
        var test=dust.helpers.tap(params.test, chunk, context);
        var echo=dust.helpers.tap(params.echo, chunk, context);

        if(value===test){
            output=echo;
        }

        return chunk.write(output);
    };

    dust.helpers.inArray=function(chunk,context,bodies,params){

        var index = dust.helpers.tap(params.index, chunk, context);
        var arrProp= dust.helpers.tap(params.array, chunk, context);
        var objProp=dust.helpers.tap(params.obj, chunk, context);
        var id=dust.helpers.tap(params.id, chunk, context);
        var context_=context.stack.tail.head;
        var cxt,arr,obj;
        cxt=context_;
        arr=cxt[arrProp];
        obj=(typeof index==='undefined') ? cxt[objProp] : cxt[objProp][index];

        var checked='';
        if(arr && arr.length){
            arr.forEach(function(o){
                if(obj[id]===o[id]){
                    checked='checked';
                }
            });
        }

        return chunk.write(checked);
    };

    dust.helpers.url=function(chunk,context,bodies,params){
        var href = dust.helpers.tap(params.href, chunk, context);
        var encodeURIIndex=dust.helpers.tap(params.encodeURIIndex, chunk, context);
        if(encodeURIIndex){
            href=url.encodeURISection(href,parseInt(encodeURIIndex));
        }

        if(typeof window !== 'undefined' && window.elliptical.$hashTag){
            if(href.charAt(1) !=='#'){
                href='/#' + href;
            }
        }
        var global_=(typeof window==='undefined') ? global : window;
        var virtualRoot=global_.elliptical.$virtualRoot;
        if(virtualRoot !== '/'){
            href=virtualRoot + href;
        }
        var link='href="' + href + '"';
        return chunk.write(link);
    };

    dust.helpers.pluralize=function(chunk,context,bodies,params){
        var count = dust.helpers.tap(params.count, chunk, context);
        var singular = dust.helpers.tap(params.singular, chunk, context);
        var plural = dust.helpers.tap(params.plural, chunk, context);

        var text=(count===1) ? singular : plural;
        return chunk.write(text);
    };

    dust.helpers.id=function(chunk, context, bodies, params){
        var id = dust.helpers.tap(params.value, chunk, context);
        if(id===undefined){
            id=random.id();
        }

        return chunk.write(id);
    };

    dust.helpers.guid=function(chunk, context, bodies, params){
        var id = dust.helpers.tap(params.value, chunk, context);
        if(id===undefined || id===''){
            id=random.guid();
        }

        return chunk.write(utils.guid());
    };

    dust.helpers.location = function (chunk, context, bodies, params) {
        var url = location.href;

        return chunk.write(url);
    };

    dust.helpers.formatSku = function (chunk, context, bodies, params) {
        var value = dust.helpers.tap(params.value, chunk, context);
        var sku = value.substring(5);
        return chunk.write(sku);
    };

    dust.helpers.inline={};

    dust.helpers.inline.formatDate=function(val,format){
        format=format || 'MM-DD-YYYY';
        return (val) ? moment(val).format(format) : '';
    };

    dust.helpers.inline.formatCurrency=function(val){
        val=parseFloat(val);
        var money;
        try{
            if(utils.isNumeric(val)){
                money =val.toFixed(2);
            }else{
                money='';
            }
        }catch(ex){
            money='';
        }

        return money;
    };
    dust.helpers.inline.extFormatCurrency=function(val){
        val=parseFloat(val);
        var money;
        if(utils.isNumeric(val)){
            money =val.toFixed(2);
            money = '$' + money.toString();
        }else{
            money='';
        }

        return money;
    };


    return dust;
}));


// Copyright 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var MutationObserverCtor;
if (typeof WebKitMutationObserver !== 'undefined')
    MutationObserverCtor = WebKitMutationObserver;
else
    MutationObserverCtor = MutationObserver;
if (MutationObserverCtor === undefined) {
    console.error('DOM Mutation Observers are required.');
    console.error('https://developer.mozilla.org/en-US/docs/DOM/MutationObserver');
    throw Error('DOM Mutation Observers are required');
}
var NodeMap = (function () {
    function NodeMap() {
        this.nodes = [];
        this.values = [];
    }
    NodeMap.prototype.isIndex = function (s) {
        return +s === s >>> 0;
    };
    NodeMap.prototype.nodeId = function (node) {
        var id = node[NodeMap.ID_PROP];
        if (!id)
            id = node[NodeMap.ID_PROP] = NodeMap.nextId_++;
        return id;
    };
    NodeMap.prototype.set = function (node, value) {
        var id = this.nodeId(node);
        this.nodes[id] = node;
        this.values[id] = value;
    };
    NodeMap.prototype.get = function (node) {
        var id = this.nodeId(node);
        return this.values[id];
    };
    NodeMap.prototype.has = function (node) {
        return this.nodeId(node) in this.nodes;
    };
    NodeMap.prototype.delete = function (node) {
        var id = this.nodeId(node);
        delete this.nodes[id];
        this.values[id] = undefined;
    };
    NodeMap.prototype.keys = function () {
        var nodes = [];
        for (var id in this.nodes) {
            if (!this.isIndex(id))
                continue;
            nodes.push(this.nodes[id]);
        }
        return nodes;
    };
    NodeMap.ID_PROP = '__mutation_summary_node_map_id__';
    NodeMap.nextId_ = 1;
    return NodeMap;
})();
/**
 *  var reachableMatchableProduct = [
 *  //  STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED
 *    [ STAYED_OUT,  STAYED_OUT,  STAYED_OUT,  STAYED_OUT ], // STAYED_OUT
 *    [ STAYED_OUT,  ENTERED,     ENTERED,     STAYED_OUT ], // ENTERED
 *    [ STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED     ], // STAYED_IN
 *    [ STAYED_OUT,  STAYED_OUT,  EXITED,      EXITED     ]  // EXITED
 *  ];
 */
var Movement;
(function (Movement) {
    Movement[Movement["STAYED_OUT"] = 0] = "STAYED_OUT";
    Movement[Movement["ENTERED"] = 1] = "ENTERED";
    Movement[Movement["STAYED_IN"] = 2] = "STAYED_IN";
    Movement[Movement["REPARENTED"] = 3] = "REPARENTED";
    Movement[Movement["REORDERED"] = 4] = "REORDERED";
    Movement[Movement["EXITED"] = 5] = "EXITED";
})(Movement || (Movement = {}));
function enteredOrExited(changeType) {
    return changeType === Movement.ENTERED || changeType === Movement.EXITED;
}
var NodeChange = (function () {
    function NodeChange(node, childList, attributes, characterData, oldParentNode, added, attributeOldValues, characterDataOldValue) {
        if (childList === void 0) { childList = false; }
        if (attributes === void 0) { attributes = false; }
        if (characterData === void 0) { characterData = false; }
        if (oldParentNode === void 0) { oldParentNode = null; }
        if (added === void 0) { added = false; }
        if (attributeOldValues === void 0) { attributeOldValues = null; }
        if (characterDataOldValue === void 0) { characterDataOldValue = null; }
        this.node = node;
        this.childList = childList;
        this.attributes = attributes;
        this.characterData = characterData;
        this.oldParentNode = oldParentNode;
        this.added = added;
        this.attributeOldValues = attributeOldValues;
        this.characterDataOldValue = characterDataOldValue;
        this.isCaseInsensitive =
            this.node.nodeType === Node.ELEMENT_NODE &&
                this.node instanceof HTMLElement &&
                this.node.ownerDocument instanceof HTMLDocument;
    }
    NodeChange.prototype.getAttributeOldValue = function (name) {
        if (!this.attributeOldValues)
            return undefined;
        if (this.isCaseInsensitive)
            name = name.toLowerCase();
        return this.attributeOldValues[name];
    };
    NodeChange.prototype.getAttributeNamesMutated = function () {
        var names = [];
        if (!this.attributeOldValues)
            return names;
        for (var name in this.attributeOldValues) {
            names.push(name);
        }
        return names;
    };
    NodeChange.prototype.attributeMutated = function (name, oldValue) {
        this.attributes = true;
        this.attributeOldValues = this.attributeOldValues || {};
        if (name in this.attributeOldValues)
            return;
        this.attributeOldValues[name] = oldValue;
    };
    NodeChange.prototype.characterDataMutated = function (oldValue) {
        if (this.characterData)
            return;
        this.characterData = true;
        this.characterDataOldValue = oldValue;
    };
    // Note: is it possible to receive a removal followed by a removal. This
    // can occur if the removed node is added to an non-observed node, that
    // node is added to the observed area, and then the node removed from
    // it.
    NodeChange.prototype.removedFromParent = function (parent) {
        this.childList = true;
        if (this.added || this.oldParentNode)
            this.added = false;
        else
            this.oldParentNode = parent;
    };
    NodeChange.prototype.insertedIntoParent = function () {
        this.childList = true;
        this.added = true;
    };
    // An node's oldParent is
    //   -its present parent, if its parentNode was not changed.
    //   -null if the first thing that happened to it was an add.
    //   -the node it was removed from if the first thing that happened to it
    //      was a remove.
    NodeChange.prototype.getOldParent = function () {
        if (this.childList) {
            if (this.oldParentNode)
                return this.oldParentNode;
            if (this.added)
                return null;
        }
        return this.node.parentNode;
    };
    return NodeChange;
})();
var ChildListChange = (function () {
    function ChildListChange() {
        this.added = new NodeMap();
        this.removed = new NodeMap();
        this.maybeMoved = new NodeMap();
        this.oldPrevious = new NodeMap();
        this.moved = undefined;
    }
    return ChildListChange;
})();
var TreeChanges = (function (_super) {
    __extends(TreeChanges, _super);
    function TreeChanges(rootNode, mutations) {
        _super.call(this);
        this.rootNode = rootNode;
        this.reachableCache = undefined;
        this.wasReachableCache = undefined;
        this.anyParentsChanged = false;
        this.anyAttributesChanged = false;
        this.anyCharacterDataChanged = false;
        for (var m = 0; m < mutations.length; m++) {
            var mutation = mutations[m];
            switch (mutation.type) {
                case 'childList':
                    this.anyParentsChanged = true;
                    for (var i = 0; i < mutation.removedNodes.length; i++) {
                        var node = mutation.removedNodes[i];
                        this.getChange(node).removedFromParent(mutation.target);
                    }
                    for (var i = 0; i < mutation.addedNodes.length; i++) {
                        var node = mutation.addedNodes[i];
                        this.getChange(node).insertedIntoParent();
                    }
                    break;
                case 'attributes':
                    this.anyAttributesChanged = true;
                    var change = this.getChange(mutation.target);
                    change.attributeMutated(mutation.attributeName, mutation.oldValue);
                    break;
                case 'characterData':
                    this.anyCharacterDataChanged = true;
                    var change = this.getChange(mutation.target);
                    change.characterDataMutated(mutation.oldValue);
                    break;
            }
        }
    }
    TreeChanges.prototype.getChange = function (node) {
        var change = this.get(node);
        if (!change) {
            change = new NodeChange(node);
            this.set(node, change);
        }
        return change;
    };
    TreeChanges.prototype.getOldParent = function (node) {
        var change = this.get(node);
        return change ? change.getOldParent() : node.parentNode;
    };
    TreeChanges.prototype.getIsReachable = function (node) {
        if (node === this.rootNode)
            return true;
        if (!node)
            return false;
        this.reachableCache = this.reachableCache || new NodeMap();
        var isReachable = this.reachableCache.get(node);
        if (isReachable === undefined) {
            isReachable = this.getIsReachable(node.parentNode);
            this.reachableCache.set(node, isReachable);
        }
        return isReachable;
    };
    // A node wasReachable if its oldParent wasReachable.
    TreeChanges.prototype.getWasReachable = function (node) {
        if (node === this.rootNode)
            return true;
        if (!node)
            return false;
        this.wasReachableCache = this.wasReachableCache || new NodeMap();
        var wasReachable = this.wasReachableCache.get(node);
        if (wasReachable === undefined) {
            wasReachable = this.getWasReachable(this.getOldParent(node));
            this.wasReachableCache.set(node, wasReachable);
        }
        return wasReachable;
    };
    TreeChanges.prototype.reachabilityChange = function (node) {
        if (this.getIsReachable(node)) {
            return this.getWasReachable(node) ?
                Movement.STAYED_IN : Movement.ENTERED;
        }
        return this.getWasReachable(node) ?
            Movement.EXITED : Movement.STAYED_OUT;
    };
    return TreeChanges;
})(NodeMap);
var MutationProjection = (function () {
    // TOOD(any)
    function MutationProjection(rootNode, mutations, selectors, calcReordered, calcOldPreviousSibling) {
        this.rootNode = rootNode;
        this.mutations = mutations;
        this.selectors = selectors;
        this.calcReordered = calcReordered;
        this.calcOldPreviousSibling = calcOldPreviousSibling;
        this.treeChanges = new TreeChanges(rootNode, mutations);
        this.entered = [];
        this.exited = [];
        this.stayedIn = new NodeMap();
        this.visited = new NodeMap();
        this.childListChangeMap = undefined;
        this.characterDataOnly = undefined;
        this.matchCache = undefined;
        this.processMutations();
    }
    MutationProjection.prototype.processMutations = function () {
        if (!this.treeChanges.anyParentsChanged &&
            !this.treeChanges.anyAttributesChanged)
            return;
        var changedNodes = this.treeChanges.keys();
        for (var i = 0; i < changedNodes.length; i++) {
            this.visitNode(changedNodes[i], undefined);
        }
    };
    MutationProjection.prototype.visitNode = function (node, parentReachable) {
        if (this.visited.has(node))
            return;
        this.visited.set(node, true);
        var change = this.treeChanges.get(node);
        var reachable = parentReachable;
        // node inherits its parent's reachability change unless
        // its parentNode was mutated.
        if ((change && change.childList) || reachable == undefined)
            reachable = this.treeChanges.reachabilityChange(node);
        if (reachable === Movement.STAYED_OUT)
            return;
        // Cache match results for sub-patterns.
        this.matchabilityChange(node);
        if (reachable === Movement.ENTERED) {
            this.entered.push(node);
        }
        else if (reachable === Movement.EXITED) {
            this.exited.push(node);
            this.ensureHasOldPreviousSiblingIfNeeded(node);
        }
        else if (reachable === Movement.STAYED_IN) {
            var movement = Movement.STAYED_IN;
            if (change && change.childList) {
                if (change.oldParentNode !== node.parentNode) {
                    movement = Movement.REPARENTED;
                    this.ensureHasOldPreviousSiblingIfNeeded(node);
                }
                else if (this.calcReordered && this.wasReordered(node)) {
                    movement = Movement.REORDERED;
                }
            }
            this.stayedIn.set(node, movement);
        }
        if (reachable === Movement.STAYED_IN)
            return;
        // reachable === ENTERED || reachable === EXITED.
        for (var child = node.firstChild; child; child = child.nextSibling) {
            this.visitNode(child, reachable);
        }
    };
    MutationProjection.prototype.ensureHasOldPreviousSiblingIfNeeded = function (node) {
        if (!this.calcOldPreviousSibling)
            return;
        this.processChildlistChanges();
        var parentNode = node.parentNode;
        var nodeChange = this.treeChanges.get(node);
        if (nodeChange && nodeChange.oldParentNode)
            parentNode = nodeChange.oldParentNode;
        var change = this.childListChangeMap.get(parentNode);
        if (!change) {
            change = new ChildListChange();
            this.childListChangeMap.set(parentNode, change);
        }
        if (!change.oldPrevious.has(node)) {
            change.oldPrevious.set(node, node.previousSibling);
        }
    };
    MutationProjection.prototype.getChanged = function (summary, selectors, characterDataOnly) {
        this.selectors = selectors;
        this.characterDataOnly = characterDataOnly;
        for (var i = 0; i < this.entered.length; i++) {
            var node = this.entered[i];
            var matchable = this.matchabilityChange(node);
            if (matchable === Movement.ENTERED || matchable === Movement.STAYED_IN)
                summary.added.push(node);
        }
        var stayedInNodes = this.stayedIn.keys();
        for (var i = 0; i < stayedInNodes.length; i++) {
            var node = stayedInNodes[i];
            var matchable = this.matchabilityChange(node);
            if (matchable === Movement.ENTERED) {
                summary.added.push(node);
            }
            else if (matchable === Movement.EXITED) {
                summary.removed.push(node);
            }
            else if (matchable === Movement.STAYED_IN && (summary.reparented || summary.reordered)) {
                var movement = this.stayedIn.get(node);
                if (summary.reparented && movement === Movement.REPARENTED)
                    summary.reparented.push(node);
                else if (summary.reordered && movement === Movement.REORDERED)
                    summary.reordered.push(node);
            }
        }
        for (var i = 0; i < this.exited.length; i++) {
            var node = this.exited[i];
            var matchable = this.matchabilityChange(node);
            if (matchable === Movement.EXITED || matchable === Movement.STAYED_IN)
                summary.removed.push(node);
        }
    };
    MutationProjection.prototype.getOldParentNode = function (node) {
        var change = this.treeChanges.get(node);
        if (change && change.childList)
            return change.oldParentNode ? change.oldParentNode : null;
        var reachabilityChange = this.treeChanges.reachabilityChange(node);
        if (reachabilityChange === Movement.STAYED_OUT || reachabilityChange === Movement.ENTERED)
            throw Error('getOldParentNode requested on invalid node.');
        return node.parentNode;
    };
    MutationProjection.prototype.getOldPreviousSibling = function (node) {
        var parentNode = node.parentNode;
        var nodeChange = this.treeChanges.get(node);
        if (nodeChange && nodeChange.oldParentNode)
            parentNode = nodeChange.oldParentNode;
        var change = this.childListChangeMap.get(parentNode);
        if (!change)
            throw Error('getOldPreviousSibling requested on invalid node.');
        return change.oldPrevious.get(node);
    };
    MutationProjection.prototype.getOldAttribute = function (element, attrName) {
        var change = this.treeChanges.get(element);
        if (!change || !change.attributes)
            throw Error('getOldAttribute requested on invalid node.');
        var value = change.getAttributeOldValue(attrName);
        if (value === undefined)
            throw Error('getOldAttribute requested for unchanged attribute name.');
        return value;
    };
    MutationProjection.prototype.attributeChangedNodes = function (includeAttributes) {
        if (!this.treeChanges.anyAttributesChanged)
            return {}; // No attributes mutations occurred.
        var attributeFilter;
        var caseInsensitiveFilter;
        if (includeAttributes) {
            attributeFilter = {};
            caseInsensitiveFilter = {};
            for (var i = 0; i < includeAttributes.length; i++) {
                var attrName = includeAttributes[i];
                attributeFilter[attrName] = true;
                caseInsensitiveFilter[attrName.toLowerCase()] = attrName;
            }
        }
        var result = {};
        var nodes = this.treeChanges.keys();
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var change = this.treeChanges.get(node);
            if (!change.attributes)
                continue;
            if (Movement.STAYED_IN !== this.treeChanges.reachabilityChange(node) ||
                Movement.STAYED_IN !== this.matchabilityChange(node)) {
                continue;
            }
            var element = node;
            var changedAttrNames = change.getAttributeNamesMutated();
            for (var j = 0; j < changedAttrNames.length; j++) {
                var attrName = changedAttrNames[j];
                if (attributeFilter &&
                    !attributeFilter[attrName] &&
                    !(change.isCaseInsensitive && caseInsensitiveFilter[attrName])) {
                    continue;
                }
                var oldValue = change.getAttributeOldValue(attrName);
                if (oldValue === element.getAttribute(attrName))
                    continue;
                if (caseInsensitiveFilter && change.isCaseInsensitive)
                    attrName = caseInsensitiveFilter[attrName];
                result[attrName] = result[attrName] || [];
                result[attrName].push(element);
            }
        }
        return result;
    };
    MutationProjection.prototype.getOldCharacterData = function (node) {
        var change = this.treeChanges.get(node);
        if (!change || !change.characterData)
            throw Error('getOldCharacterData requested on invalid node.');
        return change.characterDataOldValue;
    };
    MutationProjection.prototype.getCharacterDataChanged = function () {
        if (!this.treeChanges.anyCharacterDataChanged)
            return []; // No characterData mutations occurred.
        var nodes = this.treeChanges.keys();
        var result = [];
        for (var i = 0; i < nodes.length; i++) {
            var target = nodes[i];
            if (Movement.STAYED_IN !== this.treeChanges.reachabilityChange(target))
                continue;
            var change = this.treeChanges.get(target);
            if (!change.characterData ||
                target.textContent == change.characterDataOldValue)
                continue;
            result.push(target);
        }
        return result;
    };
    MutationProjection.prototype.computeMatchabilityChange = function (selector, el) {
        if (!this.matchCache)
            this.matchCache = [];
        if (!this.matchCache[selector.uid])
            this.matchCache[selector.uid] = new NodeMap();
        var cache = this.matchCache[selector.uid];
        var result = cache.get(el);
        if (result === undefined) {
            result = selector.matchabilityChange(el, this.treeChanges.get(el));
            cache.set(el, result);
        }
        return result;
    };
    MutationProjection.prototype.matchabilityChange = function (node) {
        var _this = this;
        // TODO(rafaelw): Include PI, CDATA?
        // Only include text nodes.
        if (this.characterDataOnly) {
            switch (node.nodeType) {
                case Node.COMMENT_NODE:
                case Node.TEXT_NODE:
                    return Movement.STAYED_IN;
                default:
                    return Movement.STAYED_OUT;
            }
        }
        // No element filter. Include all nodes.
        if (!this.selectors)
            return Movement.STAYED_IN;
        // Element filter. Exclude non-elements.
        if (node.nodeType !== Node.ELEMENT_NODE)
            return Movement.STAYED_OUT;
        var el = node;
        var matchChanges = this.selectors.map(function (selector) {
            return _this.computeMatchabilityChange(selector, el);
        });
        var accum = Movement.STAYED_OUT;
        var i = 0;
        while (accum !== Movement.STAYED_IN && i < matchChanges.length) {
            switch (matchChanges[i]) {
                case Movement.STAYED_IN:
                    accum = Movement.STAYED_IN;
                    break;
                case Movement.ENTERED:
                    if (accum === Movement.EXITED)
                        accum = Movement.STAYED_IN;
                    else
                        accum = Movement.ENTERED;
                    break;
                case Movement.EXITED:
                    if (accum === Movement.ENTERED)
                        accum = Movement.STAYED_IN;
                    else
                        accum = Movement.EXITED;
                    break;
            }
            i++;
        }
        return accum;
    };
    MutationProjection.prototype.getChildlistChange = function (el) {
        var change = this.childListChangeMap.get(el);
        if (!change) {
            change = new ChildListChange();
            this.childListChangeMap.set(el, change);
        }
        return change;
    };
    MutationProjection.prototype.processChildlistChanges = function () {
        if (this.childListChangeMap)
            return;
        this.childListChangeMap = new NodeMap();
        for (var i = 0; i < this.mutations.length; i++) {
            var mutation = this.mutations[i];
            if (mutation.type != 'childList')
                continue;
            if (this.treeChanges.reachabilityChange(mutation.target) !== Movement.STAYED_IN &&
                !this.calcOldPreviousSibling)
                continue;
            var change = this.getChildlistChange(mutation.target);
            var oldPrevious = mutation.previousSibling;
            function recordOldPrevious(node, previous) {
                if (!node ||
                    change.oldPrevious.has(node) ||
                    change.added.has(node) ||
                    change.maybeMoved.has(node))
                    return;
                if (previous &&
                    (change.added.has(previous) ||
                        change.maybeMoved.has(previous)))
                    return;
                change.oldPrevious.set(node, previous);
            }
            for (var j = 0; j < mutation.removedNodes.length; j++) {
                var node = mutation.removedNodes[j];
                recordOldPrevious(node, oldPrevious);
                if (change.added.has(node)) {
                    change.added.delete(node);
                }
                else {
                    change.removed.set(node, true);
                    change.maybeMoved.delete(node);
                }
                oldPrevious = node;
            }
            recordOldPrevious(mutation.nextSibling, oldPrevious);
            for (var j = 0; j < mutation.addedNodes.length; j++) {
                var node = mutation.addedNodes[j];
                if (change.removed.has(node)) {
                    change.removed.delete(node);
                    change.maybeMoved.set(node, true);
                }
                else {
                    change.added.set(node, true);
                }
            }
        }
    };
    MutationProjection.prototype.wasReordered = function (node) {
        if (!this.treeChanges.anyParentsChanged)
            return false;
        this.processChildlistChanges();
        var parentNode = node.parentNode;
        var nodeChange = this.treeChanges.get(node);
        if (nodeChange && nodeChange.oldParentNode)
            parentNode = nodeChange.oldParentNode;
        var change = this.childListChangeMap.get(parentNode);
        if (!change)
            return false;
        if (change.moved)
            return change.moved.get(node);
        change.moved = new NodeMap();
        var pendingMoveDecision = new NodeMap();
        function isMoved(node) {
            if (!node)
                return false;
            if (!change.maybeMoved.has(node))
                return false;
            var didMove = change.moved.get(node);
            if (didMove !== undefined)
                return didMove;
            if (pendingMoveDecision.has(node)) {
                didMove = true;
            }
            else {
                pendingMoveDecision.set(node, true);
                didMove = getPrevious(node) !== getOldPrevious(node);
            }
            if (pendingMoveDecision.has(node)) {
                pendingMoveDecision.delete(node);
                change.moved.set(node, didMove);
            }
            else {
                didMove = change.moved.get(node);
            }
            return didMove;
        }
        var oldPreviousCache = new NodeMap();
        function getOldPrevious(node) {
            var oldPrevious = oldPreviousCache.get(node);
            if (oldPrevious !== undefined)
                return oldPrevious;
            oldPrevious = change.oldPrevious.get(node);
            while (oldPrevious &&
                (change.removed.has(oldPrevious) || isMoved(oldPrevious))) {
                oldPrevious = getOldPrevious(oldPrevious);
            }
            if (oldPrevious === undefined)
                oldPrevious = node.previousSibling;
            oldPreviousCache.set(node, oldPrevious);
            return oldPrevious;
        }
        var previousCache = new NodeMap();
        function getPrevious(node) {
            if (previousCache.has(node))
                return previousCache.get(node);
            var previous = node.previousSibling;
            while (previous && (change.added.has(previous) || isMoved(previous)))
                previous = previous.previousSibling;
            previousCache.set(node, previous);
            return previous;
        }
        change.maybeMoved.keys().forEach(isMoved);
        return change.moved.get(node);
    };
    return MutationProjection;
})();
var Summary = (function () {
    function Summary(projection, query) {
        var _this = this;
        this.projection = projection;
        this.added = [];
        this.removed = [];
        this.reparented = query.all || query.element || query.characterData ? [] : undefined;
        this.reordered = query.all ? [] : undefined;
        projection.getChanged(this, query.elementFilter, query.characterData);
        if (query.all || query.attribute || query.attributeList) {
            var filter = query.attribute ? [query.attribute] : query.attributeList;
            var attributeChanged = projection.attributeChangedNodes(filter);
            if (query.attribute) {
                this.valueChanged = attributeChanged[query.attribute] || [];
            }
            else {
                this.attributeChanged = attributeChanged;
                if (query.attributeList) {
                    query.attributeList.forEach(function (attrName) {
                        if (!_this.attributeChanged.hasOwnProperty(attrName))
                            _this.attributeChanged[attrName] = [];
                    });
                }
            }
        }
        if (query.all || query.characterData) {
            var characterDataChanged = projection.getCharacterDataChanged();
            if (query.characterData)
                this.valueChanged = characterDataChanged;
            else
                this.characterDataChanged = characterDataChanged;
        }
        if (this.reordered)
            this.getOldPreviousSibling = projection.getOldPreviousSibling.bind(projection);
    }
    Summary.prototype.getOldParentNode = function (node) {
        return this.projection.getOldParentNode(node);
    };
    Summary.prototype.getOldAttribute = function (node, name) {
        return this.projection.getOldAttribute(node, name);
    };
    Summary.prototype.getOldCharacterData = function (node) {
        return this.projection.getOldCharacterData(node);
    };
    Summary.prototype.getOldPreviousSibling = function (node) {
        return this.projection.getOldPreviousSibling(node);
    };
    return Summary;
})();
// TODO(rafaelw): Allow ':' and '.' as valid name characters.
var validNameInitialChar = /[a-zA-Z_]+/;
var validNameNonInitialChar = /[a-zA-Z0-9_\-]+/;
// TODO(rafaelw): Consider allowing backslash in the attrValue.
// TODO(rafaelw): There's got a to be way to represent this state machine
// more compactly???
function escapeQuotes(value) {
    return '"' + value.replace(/"/, '\\\"') + '"';
}
var Qualifier = (function () {
    function Qualifier() {
    }
    Qualifier.prototype.matches = function (oldValue) {
        if (oldValue === null)
            return false;
        if (this.attrValue === undefined)
            return true;
        if (!this.contains)
            return this.attrValue == oldValue;
        var tokens = oldValue.split(' ');
        for (var i = 0; i < tokens.length; i++) {
            if (this.attrValue === tokens[i])
                return true;
        }
        return false;
    };
    Qualifier.prototype.toString = function () {
        if (this.attrName === 'class' && this.contains)
            return '.' + this.attrValue;
        if (this.attrName === 'id' && !this.contains)
            return '#' + this.attrValue;
        if (this.contains)
            return '[' + this.attrName + '~=' + escapeQuotes(this.attrValue) + ']';
        if ('attrValue' in this)
            return '[' + this.attrName + '=' + escapeQuotes(this.attrValue) + ']';
        return '[' + this.attrName + ']';
    };
    return Qualifier;
})();
var Selector = (function () {
    function Selector() {
        this.uid = Selector.nextUid++;
        this.qualifiers = [];
    }
    Object.defineProperty(Selector.prototype, "caseInsensitiveTagName", {
        get: function () {
            return this.tagName.toUpperCase();
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Selector.prototype, "selectorString", {
        get: function () {
            return this.tagName + this.qualifiers.join('');
        },
        enumerable: true,
        configurable: true
    });
    Selector.prototype.isMatching = function (el) {
        return el[Selector.matchesSelector](this.selectorString);
    };
    Selector.prototype.wasMatching = function (el, change, isMatching) {
        if (!change || !change.attributes)
            return isMatching;
        var tagName = change.isCaseInsensitive ? this.caseInsensitiveTagName : this.tagName;
        if (tagName !== '*' && tagName !== el.tagName)
            return false;
        var attributeOldValues = [];
        var anyChanged = false;
        for (var i = 0; i < this.qualifiers.length; i++) {
            var qualifier = this.qualifiers[i];
            var oldValue = change.getAttributeOldValue(qualifier.attrName);
            attributeOldValues.push(oldValue);
            anyChanged = anyChanged || (oldValue !== undefined);
        }
        if (!anyChanged)
            return isMatching;
        for (var i = 0; i < this.qualifiers.length; i++) {
            var qualifier = this.qualifiers[i];
            var oldValue = attributeOldValues[i];
            if (oldValue === undefined)
                oldValue = el.getAttribute(qualifier.attrName);
            if (!qualifier.matches(oldValue))
                return false;
        }
        return true;
    };
    Selector.prototype.matchabilityChange = function (el, change) {
        var isMatching = this.isMatching(el);
        if (isMatching)
            return this.wasMatching(el, change, isMatching) ? Movement.STAYED_IN : Movement.ENTERED;
        else
            return this.wasMatching(el, change, isMatching) ? Movement.EXITED : Movement.STAYED_OUT;
    };
    Selector.parseSelectors = function (input) {
        var selectors = [];
        var currentSelector;
        var currentQualifier;
        function newSelector() {
            if (currentSelector) {
                if (currentQualifier) {
                    currentSelector.qualifiers.push(currentQualifier);
                    currentQualifier = undefined;
                }
                selectors.push(currentSelector);
            }
            currentSelector = new Selector();
        }
        function newQualifier() {
            if (currentQualifier)
                currentSelector.qualifiers.push(currentQualifier);
            currentQualifier = new Qualifier();
        }
        var WHITESPACE = /\s/;
        var valueQuoteChar;
        var SYNTAX_ERROR = 'Invalid or unsupported selector syntax.';
        var SELECTOR = 1;
        var TAG_NAME = 2;
        var QUALIFIER = 3;
        var QUALIFIER_NAME_FIRST_CHAR = 4;
        var QUALIFIER_NAME = 5;
        var ATTR_NAME_FIRST_CHAR = 6;
        var ATTR_NAME = 7;
        var EQUIV_OR_ATTR_QUAL_END = 8;
        var EQUAL = 9;
        var ATTR_QUAL_END = 10;
        var VALUE_FIRST_CHAR = 11;
        var VALUE = 12;
        var QUOTED_VALUE = 13;
        var SELECTOR_SEPARATOR = 14;
        var state = SELECTOR;
        var i = 0;
        while (i < input.length) {
            var c = input[i++];
            switch (state) {
                case SELECTOR:
                    if (c.match(validNameInitialChar)) {
                        newSelector();
                        currentSelector.tagName = c;
                        state = TAG_NAME;
                        break;
                    }
                    if (c == '*') {
                        newSelector();
                        currentSelector.tagName = '*';
                        state = QUALIFIER;
                        break;
                    }
                    if (c == '.') {
                        newSelector();
                        newQualifier();
                        currentSelector.tagName = '*';
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newSelector();
                        newQualifier();
                        currentSelector.tagName = '*';
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newSelector();
                        newQualifier();
                        currentSelector.tagName = '*';
                        currentQualifier.attrName = '';
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c.match(WHITESPACE))
                        break;
                    throw Error(SYNTAX_ERROR);
                case TAG_NAME:
                    if (c.match(validNameNonInitialChar)) {
                        currentSelector.tagName += c;
                        break;
                    }
                    if (c == '.') {
                        newQualifier();
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newQualifier();
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newQualifier();
                        currentQualifier.attrName = '';
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c.match(WHITESPACE)) {
                        state = SELECTOR_SEPARATOR;
                        break;
                    }
                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }
                    throw Error(SYNTAX_ERROR);
                case QUALIFIER:
                    if (c == '.') {
                        newQualifier();
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newQualifier();
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newQualifier();
                        currentQualifier.attrName = '';
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c.match(WHITESPACE)) {
                        state = SELECTOR_SEPARATOR;
                        break;
                    }
                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }
                    throw Error(SYNTAX_ERROR);
                case QUALIFIER_NAME_FIRST_CHAR:
                    if (c.match(validNameInitialChar)) {
                        currentQualifier.attrValue = c;
                        state = QUALIFIER_NAME;
                        break;
                    }
                    throw Error(SYNTAX_ERROR);
                case QUALIFIER_NAME:
                    if (c.match(validNameNonInitialChar)) {
                        currentQualifier.attrValue += c;
                        break;
                    }
                    if (c == '.') {
                        newQualifier();
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newQualifier();
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newQualifier();
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c.match(WHITESPACE)) {
                        state = SELECTOR_SEPARATOR;
                        break;
                    }
                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }
                    throw Error(SYNTAX_ERROR);
                case ATTR_NAME_FIRST_CHAR:
                    if (c.match(validNameInitialChar)) {
                        currentQualifier.attrName = c;
                        state = ATTR_NAME;
                        break;
                    }
                    if (c.match(WHITESPACE))
                        break;
                    throw Error(SYNTAX_ERROR);
                case ATTR_NAME:
                    if (c.match(validNameNonInitialChar)) {
                        currentQualifier.attrName += c;
                        break;
                    }
                    if (c.match(WHITESPACE)) {
                        state = EQUIV_OR_ATTR_QUAL_END;
                        break;
                    }
                    if (c == '~') {
                        currentQualifier.contains = true;
                        state = EQUAL;
                        break;
                    }
                    if (c == '=') {
                        currentQualifier.attrValue = '';
                        state = VALUE_FIRST_CHAR;
                        break;
                    }
                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }
                    throw Error(SYNTAX_ERROR);
                case EQUIV_OR_ATTR_QUAL_END:
                    if (c == '~') {
                        currentQualifier.contains = true;
                        state = EQUAL;
                        break;
                    }
                    if (c == '=') {
                        currentQualifier.attrValue = '';
                        state = VALUE_FIRST_CHAR;
                        break;
                    }
                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }
                    if (c.match(WHITESPACE))
                        break;
                    throw Error(SYNTAX_ERROR);
                case EQUAL:
                    if (c == '=') {
                        currentQualifier.attrValue = '';
                        state = VALUE_FIRST_CHAR;
                        break;
                    }
                    throw Error(SYNTAX_ERROR);
                case ATTR_QUAL_END:
                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }
                    if (c.match(WHITESPACE))
                        break;
                    throw Error(SYNTAX_ERROR);
                case VALUE_FIRST_CHAR:
                    if (c.match(WHITESPACE))
                        break;
                    if (c == '"' || c == "'") {
                        valueQuoteChar = c;
                        state = QUOTED_VALUE;
                        break;
                    }
                    currentQualifier.attrValue += c;
                    state = VALUE;
                    break;
                case VALUE:
                    if (c.match(WHITESPACE)) {
                        state = ATTR_QUAL_END;
                        break;
                    }
                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }
                    if (c == "'" || c == '"')
                        throw Error(SYNTAX_ERROR);
                    currentQualifier.attrValue += c;
                    break;
                case QUOTED_VALUE:
                    if (c == valueQuoteChar) {
                        state = ATTR_QUAL_END;
                        break;
                    }
                    currentQualifier.attrValue += c;
                    break;
                case SELECTOR_SEPARATOR:
                    if (c.match(WHITESPACE))
                        break;
                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }
                    throw Error(SYNTAX_ERROR);
            }
        }
        switch (state) {
            case SELECTOR:
            case TAG_NAME:
            case QUALIFIER:
            case QUALIFIER_NAME:
            case SELECTOR_SEPARATOR:
                // Valid end states.
                newSelector();
                break;
            default:
                throw Error(SYNTAX_ERROR);
        }
        if (!selectors.length)
            throw Error(SYNTAX_ERROR);
        return selectors;
    };
    Selector.nextUid = 1;
    Selector.matchesSelector = (function () {
        var element = document.createElement('div');
        if (typeof element['webkitMatchesSelector'] === 'function')
            return 'webkitMatchesSelector';
        if (typeof element['mozMatchesSelector'] === 'function')
            return 'mozMatchesSelector';
        if (typeof element['msMatchesSelector'] === 'function')
            return 'msMatchesSelector';
        return 'matchesSelector';
    })();
    return Selector;
})();
var attributeFilterPattern = /^([a-zA-Z:_]+[a-zA-Z0-9_\-:\.]*)$/;
function validateAttribute(attribute) {
    if (typeof attribute != 'string')
        throw Error('Invalid request opion. attribute must be a non-zero length string.');
    attribute = attribute.trim();
    if (!attribute)
        throw Error('Invalid request opion. attribute must be a non-zero length string.');
    if (!attribute.match(attributeFilterPattern))
        throw Error('Invalid request option. invalid attribute name: ' + attribute);
    return attribute;
}
function validateElementAttributes(attribs) {
    if (!attribs.trim().length)
        throw Error('Invalid request option: elementAttributes must contain at least one attribute.');
    var lowerAttributes = {};
    var attributes = {};
    var tokens = attribs.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
        var name = tokens[i];
        if (!name)
            continue;
        var name = validateAttribute(name);
        var nameLower = name.toLowerCase();
        if (lowerAttributes[nameLower])
            throw Error('Invalid request option: observing multiple case variations of the same attribute is not supported.');
        attributes[name] = true;
        lowerAttributes[nameLower] = true;
    }
    return Object.keys(attributes);
}
function elementFilterAttributes(selectors) {
    var attributes = {};
    selectors.forEach(function (selector) {
        selector.qualifiers.forEach(function (qualifier) {
            attributes[qualifier.attrName] = true;
        });
    });
    return Object.keys(attributes);
}
var MutationSummary = (function () {
    function MutationSummary(opts) {
        var _this = this;
        this.connected = false;
        this.options = MutationSummary.validateOptions(opts);
        this.observerOptions = MutationSummary.createObserverOptions(this.options.queries);
        this.root = this.options.rootNode;
        this.callback = this.options.callback;
        this.elementFilter = Array.prototype.concat.apply([], this.options.queries.map(function (query) {
            return query.elementFilter ? query.elementFilter : [];
        }));
        if (!this.elementFilter.length)
            this.elementFilter = undefined;
        this.calcReordered = this.options.queries.some(function (query) {
            return query.all;
        });
        this.queryValidators = []; // TODO(rafaelw): Shouldn't always define this.
        if (MutationSummary.createQueryValidator) {
            this.queryValidators = this.options.queries.map(function (query) {
                return MutationSummary.createQueryValidator(_this.root, query);
            });
        }
        this.observer = new MutationObserverCtor(function (mutations) {
            _this.observerCallback(mutations);
        });
        this.reconnect();
    }
    MutationSummary.createObserverOptions = function (queries) {
        var observerOptions = {
            childList: true,
            subtree: true
        };
        var attributeFilter;
        function observeAttributes(attributes) {
            if (observerOptions.attributes && !attributeFilter)
                return; // already observing all.
            observerOptions.attributes = true;
            observerOptions.attributeOldValue = true;
            if (!attributes) {
                // observe all.
                attributeFilter = undefined;
                return;
            }
            // add to observed.
            attributeFilter = attributeFilter || {};
            attributes.forEach(function (attribute) {
                attributeFilter[attribute] = true;
                attributeFilter[attribute.toLowerCase()] = true;
            });
        }
        queries.forEach(function (query) {
            if (query.characterData) {
                observerOptions.characterData = true;
                observerOptions.characterDataOldValue = true;
                return;
            }
            if (query.all) {
                observeAttributes();
                observerOptions.characterData = true;
                observerOptions.characterDataOldValue = true;
                return;
            }
            if (query.attribute) {
                observeAttributes([query.attribute.trim()]);
                return;
            }
            var attributes = elementFilterAttributes(query.elementFilter).concat(query.attributeList || []);
            if (attributes.length)
                observeAttributes(attributes);
        });
        if (attributeFilter)
            observerOptions.attributeFilter = Object.keys(attributeFilter);
        return observerOptions;
    };
    MutationSummary.validateOptions = function (options) {
        for (var prop in options) {
            if (!(prop in MutationSummary.optionKeys))
                throw Error('Invalid option: ' + prop);
        }
        if (typeof options.callback !== 'function')
            throw Error('Invalid options: callback is required and must be a function');
        if (!options.queries || !options.queries.length)
            throw Error('Invalid options: queries must contain at least one query request object.');
        var opts = {
            callback: options.callback,
            rootNode: options.rootNode || document,
            observeOwnChanges: !!options.observeOwnChanges,
            oldPreviousSibling: !!options.oldPreviousSibling,
            queries: []
        };
        for (var i = 0; i < options.queries.length; i++) {
            var request = options.queries[i];
            // all
            if (request.all) {
                if (Object.keys(request).length > 1)
                    throw Error('Invalid request option. all has no options.');
                opts.queries.push({ all: true });
                continue;
            }
            // attribute
            if ('attribute' in request) {
                var query = {
                    attribute: validateAttribute(request.attribute)
                };
                query.elementFilter = Selector.parseSelectors('*[' + query.attribute + ']');
                if (Object.keys(request).length > 1)
                    throw Error('Invalid request option. attribute has no options.');
                opts.queries.push(query);
                continue;
            }
            // element
            if ('element' in request) {
                var requestOptionCount = Object.keys(request).length;
                var query = {
                    element: request.element,
                    elementFilter: Selector.parseSelectors(request.element)
                };
                if (request.hasOwnProperty('elementAttributes')) {
                    query.attributeList = validateElementAttributes(request.elementAttributes);
                    requestOptionCount--;
                }
                if (requestOptionCount > 1)
                    throw Error('Invalid request option. element only allows elementAttributes option.');
                opts.queries.push(query);
                continue;
            }
            // characterData
            if (request.characterData) {
                if (Object.keys(request).length > 1)
                    throw Error('Invalid request option. characterData has no options.');
                opts.queries.push({ characterData: true });
                continue;
            }
            throw Error('Invalid request option. Unknown query request.');
        }
        return opts;
    };
    MutationSummary.prototype.createSummaries = function (mutations) {
        if (!mutations || !mutations.length)
            return [];
        var projection = new MutationProjection(this.root, mutations, this.elementFilter, this.calcReordered, this.options.oldPreviousSibling);
        var summaries = [];
        for (var i = 0; i < this.options.queries.length; i++) {
            summaries.push(new Summary(projection, this.options.queries[i]));
        }
        return summaries;
    };
    MutationSummary.prototype.checkpointQueryValidators = function () {
        this.queryValidators.forEach(function (validator) {
            if (validator)
                validator.recordPreviousState();
        });
    };
    MutationSummary.prototype.runQueryValidators = function (summaries) {
        this.queryValidators.forEach(function (validator, index) {
            if (validator)
                validator.validate(summaries[index]);
        });
    };
    MutationSummary.prototype.changesToReport = function (summaries) {
        return summaries.some(function (summary) {
            var summaryProps = ['added', 'removed', 'reordered', 'reparented',
                'valueChanged', 'characterDataChanged'];
            if (summaryProps.some(function (prop) { return summary[prop] && summary[prop].length; }))
                return true;
            if (summary.attributeChanged) {
                var attrNames = Object.keys(summary.attributeChanged);
                var attrsChanged = attrNames.some(function (attrName) {
                    return !!summary.attributeChanged[attrName].length;
                });
                if (attrsChanged)
                    return true;
            }
            return false;
        });
    };
    MutationSummary.prototype.observerCallback = function (mutations) {
        if (!this.options.observeOwnChanges)
            this.observer.disconnect();
        var summaries = this.createSummaries(mutations);
        this.runQueryValidators(summaries);
        if (this.options.observeOwnChanges)
            this.checkpointQueryValidators();
        if (this.changesToReport(summaries))
            this.callback(summaries);
        // disconnect() may have been called during the callback.
        if (!this.options.observeOwnChanges && this.connected) {
            this.checkpointQueryValidators();
            this.observer.observe(this.root, this.observerOptions);
        }
    };
    MutationSummary.prototype.reconnect = function () {
        if (this.connected)
            throw Error('Already connected');
        this.observer.observe(this.root, this.observerOptions);
        this.connected = true;
        this.checkpointQueryValidators();
    };
    MutationSummary.prototype.takeSummaries = function () {
        if (!this.connected)
            throw Error('Not connected');
        var summaries = this.createSummaries(this.observer.takeRecords());
        return this.changesToReport(summaries) ? summaries : undefined;
    };
    MutationSummary.prototype.disconnect = function () {
        var summaries = this.takeSummaries();
        this.observer.disconnect();
        this.connected = false;
        return summaries;
    };
    MutationSummary.NodeMap = NodeMap; // exposed for use in TreeMirror.
    MutationSummary.parseElementFilter = Selector.parseSelectors; // exposed for testing.
    MutationSummary.optionKeys = {
        'callback': true,
        'queries': true,
        'rootNode': true,
        'oldPreviousSibling': true,
        'observeOwnChanges': true
    };
    return MutationSummary;
})();

//! moment.js
//! version : 2.10.6
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    global.moment = factory()
}(this, function () { 'use strict';

    var hookCallback;

    function utils_hooks__hooks () {
        return hookCallback.apply(null, arguments);
    }

    // This is done to register the method called with moment()
    // without creating circular dependencies.
    function setHookCallback (callback) {
        hookCallback = callback;
    }

    function isArray(input) {
        return Object.prototype.toString.call(input) === '[object Array]';
    }

    function isDate(input) {
        return input instanceof Date || Object.prototype.toString.call(input) === '[object Date]';
    }

    function map(arr, fn) {
        var res = [], i;
        for (i = 0; i < arr.length; ++i) {
            res.push(fn(arr[i], i));
        }
        return res;
    }

    function hasOwnProp(a, b) {
        return Object.prototype.hasOwnProperty.call(a, b);
    }

    function extend(a, b) {
        for (var i in b) {
            if (hasOwnProp(b, i)) {
                a[i] = b[i];
            }
        }

        if (hasOwnProp(b, 'toString')) {
            a.toString = b.toString;
        }

        if (hasOwnProp(b, 'valueOf')) {
            a.valueOf = b.valueOf;
        }

        return a;
    }

    function create_utc__createUTC (input, format, locale, strict) {
        return createLocalOrUTC(input, format, locale, strict, true).utc();
    }

    function defaultParsingFlags() {
        // We need to deep clone this object.
        return {
            empty           : false,
            unusedTokens    : [],
            unusedInput     : [],
            overflow        : -2,
            charsLeftOver   : 0,
            nullInput       : false,
            invalidMonth    : null,
            invalidFormat   : false,
            userInvalidated : false,
            iso             : false
        };
    }

    function getParsingFlags(m) {
        if (m._pf == null) {
            m._pf = defaultParsingFlags();
        }
        return m._pf;
    }

    function valid__isValid(m) {
        if (m._isValid == null) {
            var flags = getParsingFlags(m);
            m._isValid = !isNaN(m._d.getTime()) &&
                flags.overflow < 0 &&
                !flags.empty &&
                !flags.invalidMonth &&
                !flags.invalidWeekday &&
                !flags.nullInput &&
                !flags.invalidFormat &&
                !flags.userInvalidated;

            if (m._strict) {
                m._isValid = m._isValid &&
                    flags.charsLeftOver === 0 &&
                    flags.unusedTokens.length === 0 &&
                    flags.bigHour === undefined;
            }
        }
        return m._isValid;
    }

    function valid__createInvalid (flags) {
        var m = create_utc__createUTC(NaN);
        if (flags != null) {
            extend(getParsingFlags(m), flags);
        }
        else {
            getParsingFlags(m).userInvalidated = true;
        }

        return m;
    }

    var momentProperties = utils_hooks__hooks.momentProperties = [];

    function copyConfig(to, from) {
        var i, prop, val;

        if (typeof from._isAMomentObject !== 'undefined') {
            to._isAMomentObject = from._isAMomentObject;
        }
        if (typeof from._i !== 'undefined') {
            to._i = from._i;
        }
        if (typeof from._f !== 'undefined') {
            to._f = from._f;
        }
        if (typeof from._l !== 'undefined') {
            to._l = from._l;
        }
        if (typeof from._strict !== 'undefined') {
            to._strict = from._strict;
        }
        if (typeof from._tzm !== 'undefined') {
            to._tzm = from._tzm;
        }
        if (typeof from._isUTC !== 'undefined') {
            to._isUTC = from._isUTC;
        }
        if (typeof from._offset !== 'undefined') {
            to._offset = from._offset;
        }
        if (typeof from._pf !== 'undefined') {
            to._pf = getParsingFlags(from);
        }
        if (typeof from._locale !== 'undefined') {
            to._locale = from._locale;
        }

        if (momentProperties.length > 0) {
            for (i in momentProperties) {
                prop = momentProperties[i];
                val = from[prop];
                if (typeof val !== 'undefined') {
                    to[prop] = val;
                }
            }
        }

        return to;
    }

    var updateInProgress = false;

    // Moment prototype object
    function Moment(config) {
        copyConfig(this, config);
        this._d = new Date(config._d != null ? config._d.getTime() : NaN);
        // Prevent infinite loop in case updateOffset creates new moment
        // objects.
        if (updateInProgress === false) {
            updateInProgress = true;
            utils_hooks__hooks.updateOffset(this);
            updateInProgress = false;
        }
    }

    function isMoment (obj) {
        return obj instanceof Moment || (obj != null && obj._isAMomentObject != null);
    }

    function absFloor (number) {
        if (number < 0) {
            return Math.ceil(number);
        } else {
            return Math.floor(number);
        }
    }

    function toInt(argumentForCoercion) {
        var coercedNumber = +argumentForCoercion,
            value = 0;

        if (coercedNumber !== 0 && isFinite(coercedNumber)) {
            value = absFloor(coercedNumber);
        }

        return value;
    }

    function compareArrays(array1, array2, dontConvert) {
        var len = Math.min(array1.length, array2.length),
            lengthDiff = Math.abs(array1.length - array2.length),
            diffs = 0,
            i;
        for (i = 0; i < len; i++) {
            if ((dontConvert && array1[i] !== array2[i]) ||
                (!dontConvert && toInt(array1[i]) !== toInt(array2[i]))) {
                diffs++;
            }
        }
        return diffs + lengthDiff;
    }

    function Locale() {
    }

    var locales = {};
    var globalLocale;

    function normalizeLocale(key) {
        return key ? key.toLowerCase().replace('_', '-') : key;
    }

    // pick the locale from the array
    // try ['en-au', 'en-gb'] as 'en-au', 'en-gb', 'en', as in move through the list trying each
    // substring from most specific to least, but move to the next array item if it's a more specific variant than the current root
    function chooseLocale(names) {
        var i = 0, j, next, locale, split;

        while (i < names.length) {
            split = normalizeLocale(names[i]).split('-');
            j = split.length;
            next = normalizeLocale(names[i + 1]);
            next = next ? next.split('-') : null;
            while (j > 0) {
                locale = loadLocale(split.slice(0, j).join('-'));
                if (locale) {
                    return locale;
                }
                if (next && next.length >= j && compareArrays(split, next, true) >= j - 1) {
                    //the next array item is better than a shallower substring of this one
                    break;
                }
                j--;
            }
            i++;
        }
        return null;
    }

    function loadLocale(name) {
        var oldLocale = null;
        // TODO: Find a better way to register and load all the locales in Node
        if (!locales[name] && typeof module !== 'undefined' &&
                module && module.exports) {
            try {
                oldLocale = globalLocale._abbr;
                require('./locale/' + name);
                // because defineLocale currently also sets the global locale, we
                // want to undo that for lazy loaded locales
                locale_locales__getSetGlobalLocale(oldLocale);
            } catch (e) { }
        }
        return locales[name];
    }

    // This function will load locale and then set the global locale.  If
    // no arguments are passed in, it will simply return the current global
    // locale key.
    function locale_locales__getSetGlobalLocale (key, values) {
        var data;
        if (key) {
            if (typeof values === 'undefined') {
                data = locale_locales__getLocale(key);
            }
            else {
                data = defineLocale(key, values);
            }

            if (data) {
                // moment.duration._locale = moment._locale = data;
                globalLocale = data;
            }
        }

        return globalLocale._abbr;
    }

    function defineLocale (name, values) {
        if (values !== null) {
            values.abbr = name;
            locales[name] = locales[name] || new Locale();
            locales[name].set(values);

            // backwards compat for now: also set the locale
            locale_locales__getSetGlobalLocale(name);

            return locales[name];
        } else {
            // useful for testing
            delete locales[name];
            return null;
        }
    }

    // returns locale data
    function locale_locales__getLocale (key) {
        var locale;

        if (key && key._locale && key._locale._abbr) {
            key = key._locale._abbr;
        }

        if (!key) {
            return globalLocale;
        }

        if (!isArray(key)) {
            //short-circuit everything else
            locale = loadLocale(key);
            if (locale) {
                return locale;
            }
            key = [key];
        }

        return chooseLocale(key);
    }

    var aliases = {};

    function addUnitAlias (unit, shorthand) {
        var lowerCase = unit.toLowerCase();
        aliases[lowerCase] = aliases[lowerCase + 's'] = aliases[shorthand] = unit;
    }

    function normalizeUnits(units) {
        return typeof units === 'string' ? aliases[units] || aliases[units.toLowerCase()] : undefined;
    }

    function normalizeObjectUnits(inputObject) {
        var normalizedInput = {},
            normalizedProp,
            prop;

        for (prop in inputObject) {
            if (hasOwnProp(inputObject, prop)) {
                normalizedProp = normalizeUnits(prop);
                if (normalizedProp) {
                    normalizedInput[normalizedProp] = inputObject[prop];
                }
            }
        }

        return normalizedInput;
    }

    function makeGetSet (unit, keepTime) {
        return function (value) {
            if (value != null) {
                get_set__set(this, unit, value);
                utils_hooks__hooks.updateOffset(this, keepTime);
                return this;
            } else {
                return get_set__get(this, unit);
            }
        };
    }

    function get_set__get (mom, unit) {
        return mom._d['get' + (mom._isUTC ? 'UTC' : '') + unit]();
    }

    function get_set__set (mom, unit, value) {
        return mom._d['set' + (mom._isUTC ? 'UTC' : '') + unit](value);
    }

    // MOMENTS

    function getSet (units, value) {
        var unit;
        if (typeof units === 'object') {
            for (unit in units) {
                this.set(unit, units[unit]);
            }
        } else {
            units = normalizeUnits(units);
            if (typeof this[units] === 'function') {
                return this[units](value);
            }
        }
        return this;
    }

    function zeroFill(number, targetLength, forceSign) {
        var absNumber = '' + Math.abs(number),
            zerosToFill = targetLength - absNumber.length,
            sign = number >= 0;
        return (sign ? (forceSign ? '+' : '') : '-') +
            Math.pow(10, Math.max(0, zerosToFill)).toString().substr(1) + absNumber;
    }

    var formattingTokens = /(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Q|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g;

    var localFormattingTokens = /(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g;

    var formatFunctions = {};

    var formatTokenFunctions = {};

    // token:    'M'
    // padded:   ['MM', 2]
    // ordinal:  'Mo'
    // callback: function () { this.month() + 1 }
    function addFormatToken (token, padded, ordinal, callback) {
        var func = callback;
        if (typeof callback === 'string') {
            func = function () {
                return this[callback]();
            };
        }
        if (token) {
            formatTokenFunctions[token] = func;
        }
        if (padded) {
            formatTokenFunctions[padded[0]] = function () {
                return zeroFill(func.apply(this, arguments), padded[1], padded[2]);
            };
        }
        if (ordinal) {
            formatTokenFunctions[ordinal] = function () {
                return this.localeData().ordinal(func.apply(this, arguments), token);
            };
        }
    }

    function removeFormattingTokens(input) {
        if (input.match(/\[[\s\S]/)) {
            return input.replace(/^\[|\]$/g, '');
        }
        return input.replace(/\\/g, '');
    }

    function makeFormatFunction(format) {
        var array = format.match(formattingTokens), i, length;

        for (i = 0, length = array.length; i < length; i++) {
            if (formatTokenFunctions[array[i]]) {
                array[i] = formatTokenFunctions[array[i]];
            } else {
                array[i] = removeFormattingTokens(array[i]);
            }
        }

        return function (mom) {
            var output = '';
            for (i = 0; i < length; i++) {
                output += array[i] instanceof Function ? array[i].call(mom, format) : array[i];
            }
            return output;
        };
    }

    // format date using native date object
    function formatMoment(m, format) {
        if (!m.isValid()) {
            return m.localeData().invalidDate();
        }

        format = expandFormat(format, m.localeData());
        formatFunctions[format] = formatFunctions[format] || makeFormatFunction(format);

        return formatFunctions[format](m);
    }

    function expandFormat(format, locale) {
        var i = 5;

        function replaceLongDateFormatTokens(input) {
            return locale.longDateFormat(input) || input;
        }

        localFormattingTokens.lastIndex = 0;
        while (i >= 0 && localFormattingTokens.test(format)) {
            format = format.replace(localFormattingTokens, replaceLongDateFormatTokens);
            localFormattingTokens.lastIndex = 0;
            i -= 1;
        }

        return format;
    }

    var match1         = /\d/;            //       0 - 9
    var match2         = /\d\d/;          //      00 - 99
    var match3         = /\d{3}/;         //     000 - 999
    var match4         = /\d{4}/;         //    0000 - 9999
    var match6         = /[+-]?\d{6}/;    // -999999 - 999999
    var match1to2      = /\d\d?/;         //       0 - 99
    var match1to3      = /\d{1,3}/;       //       0 - 999
    var match1to4      = /\d{1,4}/;       //       0 - 9999
    var match1to6      = /[+-]?\d{1,6}/;  // -999999 - 999999

    var matchUnsigned  = /\d+/;           //       0 - inf
    var matchSigned    = /[+-]?\d+/;      //    -inf - inf

    var matchOffset    = /Z|[+-]\d\d:?\d\d/gi; // +00:00 -00:00 +0000 -0000 or Z

    var matchTimestamp = /[+-]?\d+(\.\d{1,3})?/; // 123456789 123456789.123

    // any word (or two) characters or numbers including two/three word month in arabic.
    var matchWord = /[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i;

    var regexes = {};

    function isFunction (sth) {
        // https://github.com/moment/moment/issues/2325
        return typeof sth === 'function' &&
            Object.prototype.toString.call(sth) === '[object Function]';
    }


    function addRegexToken (token, regex, strictRegex) {
        regexes[token] = isFunction(regex) ? regex : function (isStrict) {
            return (isStrict && strictRegex) ? strictRegex : regex;
        };
    }

    function getParseRegexForToken (token, config) {
        if (!hasOwnProp(regexes, token)) {
            return new RegExp(unescapeFormat(token));
        }

        return regexes[token](config._strict, config._locale);
    }

    // Code from http://stackoverflow.com/questions/3561493/is-there-a-regexp-escape-function-in-javascript
    function unescapeFormat(s) {
        return s.replace('\\', '').replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g, function (matched, p1, p2, p3, p4) {
            return p1 || p2 || p3 || p4;
        }).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }

    var tokens = {};

    function addParseToken (token, callback) {
        var i, func = callback;
        if (typeof token === 'string') {
            token = [token];
        }
        if (typeof callback === 'number') {
            func = function (input, array) {
                array[callback] = toInt(input);
            };
        }
        for (i = 0; i < token.length; i++) {
            tokens[token[i]] = func;
        }
    }

    function addWeekParseToken (token, callback) {
        addParseToken(token, function (input, array, config, token) {
            config._w = config._w || {};
            callback(input, config._w, config, token);
        });
    }

    function addTimeToArrayFromToken(token, input, config) {
        if (input != null && hasOwnProp(tokens, token)) {
            tokens[token](input, config._a, config, token);
        }
    }

    var YEAR = 0;
    var MONTH = 1;
    var DATE = 2;
    var HOUR = 3;
    var MINUTE = 4;
    var SECOND = 5;
    var MILLISECOND = 6;

    function daysInMonth(year, month) {
        return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    }

    // FORMATTING

    addFormatToken('M', ['MM', 2], 'Mo', function () {
        return this.month() + 1;
    });

    addFormatToken('MMM', 0, 0, function (format) {
        return this.localeData().monthsShort(this, format);
    });

    addFormatToken('MMMM', 0, 0, function (format) {
        return this.localeData().months(this, format);
    });

    // ALIASES

    addUnitAlias('month', 'M');

    // PARSING

    addRegexToken('M',    match1to2);
    addRegexToken('MM',   match1to2, match2);
    addRegexToken('MMM',  matchWord);
    addRegexToken('MMMM', matchWord);

    addParseToken(['M', 'MM'], function (input, array) {
        array[MONTH] = toInt(input) - 1;
    });

    addParseToken(['MMM', 'MMMM'], function (input, array, config, token) {
        var month = config._locale.monthsParse(input, token, config._strict);
        // if we didn't find a month name, mark the date as invalid.
        if (month != null) {
            array[MONTH] = month;
        } else {
            getParsingFlags(config).invalidMonth = input;
        }
    });

    // LOCALES

    var defaultLocaleMonths = 'January_February_March_April_May_June_July_August_September_October_November_December'.split('_');
    function localeMonths (m) {
        return this._months[m.month()];
    }

    var defaultLocaleMonthsShort = 'Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec'.split('_');
    function localeMonthsShort (m) {
        return this._monthsShort[m.month()];
    }

    function localeMonthsParse (monthName, format, strict) {
        var i, mom, regex;

        if (!this._monthsParse) {
            this._monthsParse = [];
            this._longMonthsParse = [];
            this._shortMonthsParse = [];
        }

        for (i = 0; i < 12; i++) {
            // make the regex if we don't have it already
            mom = create_utc__createUTC([2000, i]);
            if (strict && !this._longMonthsParse[i]) {
                this._longMonthsParse[i] = new RegExp('^' + this.months(mom, '').replace('.', '') + '$', 'i');
                this._shortMonthsParse[i] = new RegExp('^' + this.monthsShort(mom, '').replace('.', '') + '$', 'i');
            }
            if (!strict && !this._monthsParse[i]) {
                regex = '^' + this.months(mom, '') + '|^' + this.monthsShort(mom, '');
                this._monthsParse[i] = new RegExp(regex.replace('.', ''), 'i');
            }
            // test the regex
            if (strict && format === 'MMMM' && this._longMonthsParse[i].test(monthName)) {
                return i;
            } else if (strict && format === 'MMM' && this._shortMonthsParse[i].test(monthName)) {
                return i;
            } else if (!strict && this._monthsParse[i].test(monthName)) {
                return i;
            }
        }
    }

    // MOMENTS

    function setMonth (mom, value) {
        var dayOfMonth;

        // TODO: Move this out of here!
        if (typeof value === 'string') {
            value = mom.localeData().monthsParse(value);
            // TODO: Another silent failure?
            if (typeof value !== 'number') {
                return mom;
            }
        }

        dayOfMonth = Math.min(mom.date(), daysInMonth(mom.year(), value));
        mom._d['set' + (mom._isUTC ? 'UTC' : '') + 'Month'](value, dayOfMonth);
        return mom;
    }

    function getSetMonth (value) {
        if (value != null) {
            setMonth(this, value);
            utils_hooks__hooks.updateOffset(this, true);
            return this;
        } else {
            return get_set__get(this, 'Month');
        }
    }

    function getDaysInMonth () {
        return daysInMonth(this.year(), this.month());
    }

    function checkOverflow (m) {
        var overflow;
        var a = m._a;

        if (a && getParsingFlags(m).overflow === -2) {
            overflow =
                a[MONTH]       < 0 || a[MONTH]       > 11  ? MONTH :
                a[DATE]        < 1 || a[DATE]        > daysInMonth(a[YEAR], a[MONTH]) ? DATE :
                a[HOUR]        < 0 || a[HOUR]        > 24 || (a[HOUR] === 24 && (a[MINUTE] !== 0 || a[SECOND] !== 0 || a[MILLISECOND] !== 0)) ? HOUR :
                a[MINUTE]      < 0 || a[MINUTE]      > 59  ? MINUTE :
                a[SECOND]      < 0 || a[SECOND]      > 59  ? SECOND :
                a[MILLISECOND] < 0 || a[MILLISECOND] > 999 ? MILLISECOND :
                -1;

            if (getParsingFlags(m)._overflowDayOfYear && (overflow < YEAR || overflow > DATE)) {
                overflow = DATE;
            }

            getParsingFlags(m).overflow = overflow;
        }

        return m;
    }

    function warn(msg) {
        if (utils_hooks__hooks.suppressDeprecationWarnings === false && typeof console !== 'undefined' && console.warn) {
            console.warn('Deprecation warning: ' + msg);
        }
    }

    function deprecate(msg, fn) {
        var firstTime = true;

        return extend(function () {
            if (firstTime) {
                warn(msg + '\n' + (new Error()).stack);
                firstTime = false;
            }
            return fn.apply(this, arguments);
        }, fn);
    }

    var deprecations = {};

    function deprecateSimple(name, msg) {
        if (!deprecations[name]) {
            warn(msg);
            deprecations[name] = true;
        }
    }

    utils_hooks__hooks.suppressDeprecationWarnings = false;

    var from_string__isoRegex = /^\s*(?:[+-]\d{6}|\d{4})-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/;

    var isoDates = [
        ['YYYYYY-MM-DD', /[+-]\d{6}-\d{2}-\d{2}/],
        ['YYYY-MM-DD', /\d{4}-\d{2}-\d{2}/],
        ['GGGG-[W]WW-E', /\d{4}-W\d{2}-\d/],
        ['GGGG-[W]WW', /\d{4}-W\d{2}/],
        ['YYYY-DDD', /\d{4}-\d{3}/]
    ];

    // iso time formats and regexes
    var isoTimes = [
        ['HH:mm:ss.SSSS', /(T| )\d\d:\d\d:\d\d\.\d+/],
        ['HH:mm:ss', /(T| )\d\d:\d\d:\d\d/],
        ['HH:mm', /(T| )\d\d:\d\d/],
        ['HH', /(T| )\d\d/]
    ];

    var aspNetJsonRegex = /^\/?Date\((\-?\d+)/i;

    // date from iso format
    function configFromISO(config) {
        var i, l,
            string = config._i,
            match = from_string__isoRegex.exec(string);

        if (match) {
            getParsingFlags(config).iso = true;
            for (i = 0, l = isoDates.length; i < l; i++) {
                if (isoDates[i][1].exec(string)) {
                    config._f = isoDates[i][0];
                    break;
                }
            }
            for (i = 0, l = isoTimes.length; i < l; i++) {
                if (isoTimes[i][1].exec(string)) {
                    // match[6] should be 'T' or space
                    config._f += (match[6] || ' ') + isoTimes[i][0];
                    break;
                }
            }
            if (string.match(matchOffset)) {
                config._f += 'Z';
            }
            configFromStringAndFormat(config);
        } else {
            config._isValid = false;
        }
    }

    // date from iso format or fallback
    function configFromString(config) {
        var matched = aspNetJsonRegex.exec(config._i);

        if (matched !== null) {
            config._d = new Date(+matched[1]);
            return;
        }

        configFromISO(config);
        if (config._isValid === false) {
            delete config._isValid;
            utils_hooks__hooks.createFromInputFallback(config);
        }
    }

    utils_hooks__hooks.createFromInputFallback = deprecate(
        'moment construction falls back to js Date. This is ' +
        'discouraged and will be removed in upcoming major ' +
        'release. Please refer to ' +
        'https://github.com/moment/moment/issues/1407 for more info.',
        function (config) {
            config._d = new Date(config._i + (config._useUTC ? ' UTC' : ''));
        }
    );

    function createDate (y, m, d, h, M, s, ms) {
        //can't just apply() to create a date:
        //http://stackoverflow.com/questions/181348/instantiating-a-javascript-object-by-calling-prototype-constructor-apply
        var date = new Date(y, m, d, h, M, s, ms);

        //the date constructor doesn't accept years < 1970
        if (y < 1970) {
            date.setFullYear(y);
        }
        return date;
    }

    function createUTCDate (y) {
        var date = new Date(Date.UTC.apply(null, arguments));
        if (y < 1970) {
            date.setUTCFullYear(y);
        }
        return date;
    }

    addFormatToken(0, ['YY', 2], 0, function () {
        return this.year() % 100;
    });

    addFormatToken(0, ['YYYY',   4],       0, 'year');
    addFormatToken(0, ['YYYYY',  5],       0, 'year');
    addFormatToken(0, ['YYYYYY', 6, true], 0, 'year');

    // ALIASES

    addUnitAlias('year', 'y');

    // PARSING

    addRegexToken('Y',      matchSigned);
    addRegexToken('YY',     match1to2, match2);
    addRegexToken('YYYY',   match1to4, match4);
    addRegexToken('YYYYY',  match1to6, match6);
    addRegexToken('YYYYYY', match1to6, match6);

    addParseToken(['YYYYY', 'YYYYYY'], YEAR);
    addParseToken('YYYY', function (input, array) {
        array[YEAR] = input.length === 2 ? utils_hooks__hooks.parseTwoDigitYear(input) : toInt(input);
    });
    addParseToken('YY', function (input, array) {
        array[YEAR] = utils_hooks__hooks.parseTwoDigitYear(input);
    });

    // HELPERS

    function daysInYear(year) {
        return isLeapYear(year) ? 366 : 365;
    }

    function isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }

    // HOOKS

    utils_hooks__hooks.parseTwoDigitYear = function (input) {
        return toInt(input) + (toInt(input) > 68 ? 1900 : 2000);
    };

    // MOMENTS

    var getSetYear = makeGetSet('FullYear', false);

    function getIsLeapYear () {
        return isLeapYear(this.year());
    }

    addFormatToken('w', ['ww', 2], 'wo', 'week');
    addFormatToken('W', ['WW', 2], 'Wo', 'isoWeek');

    // ALIASES

    addUnitAlias('week', 'w');
    addUnitAlias('isoWeek', 'W');

    // PARSING

    addRegexToken('w',  match1to2);
    addRegexToken('ww', match1to2, match2);
    addRegexToken('W',  match1to2);
    addRegexToken('WW', match1to2, match2);

    addWeekParseToken(['w', 'ww', 'W', 'WW'], function (input, week, config, token) {
        week[token.substr(0, 1)] = toInt(input);
    });

    // HELPERS

    // firstDayOfWeek       0 = sun, 6 = sat
    //                      the day of the week that starts the week
    //                      (usually sunday or monday)
    // firstDayOfWeekOfYear 0 = sun, 6 = sat
    //                      the first week is the week that contains the first
    //                      of this day of the week
    //                      (eg. ISO weeks use thursday (4))
    function weekOfYear(mom, firstDayOfWeek, firstDayOfWeekOfYear) {
        var end = firstDayOfWeekOfYear - firstDayOfWeek,
            daysToDayOfWeek = firstDayOfWeekOfYear - mom.day(),
            adjustedMoment;


        if (daysToDayOfWeek > end) {
            daysToDayOfWeek -= 7;
        }

        if (daysToDayOfWeek < end - 7) {
            daysToDayOfWeek += 7;
        }

        adjustedMoment = local__createLocal(mom).add(daysToDayOfWeek, 'd');
        return {
            week: Math.ceil(adjustedMoment.dayOfYear() / 7),
            year: adjustedMoment.year()
        };
    }

    // LOCALES

    function localeWeek (mom) {
        return weekOfYear(mom, this._week.dow, this._week.doy).week;
    }

    var defaultLocaleWeek = {
        dow : 0, // Sunday is the first day of the week.
        doy : 6  // The week that contains Jan 1st is the first week of the year.
    };

    function localeFirstDayOfWeek () {
        return this._week.dow;
    }

    function localeFirstDayOfYear () {
        return this._week.doy;
    }

    // MOMENTS

    function getSetWeek (input) {
        var week = this.localeData().week(this);
        return input == null ? week : this.add((input - week) * 7, 'd');
    }

    function getSetISOWeek (input) {
        var week = weekOfYear(this, 1, 4).week;
        return input == null ? week : this.add((input - week) * 7, 'd');
    }

    addFormatToken('DDD', ['DDDD', 3], 'DDDo', 'dayOfYear');

    // ALIASES

    addUnitAlias('dayOfYear', 'DDD');

    // PARSING

    addRegexToken('DDD',  match1to3);
    addRegexToken('DDDD', match3);
    addParseToken(['DDD', 'DDDD'], function (input, array, config) {
        config._dayOfYear = toInt(input);
    });

    // HELPERS

    //http://en.wikipedia.org/wiki/ISO_week_date#Calculating_a_date_given_the_year.2C_week_number_and_weekday
    function dayOfYearFromWeeks(year, week, weekday, firstDayOfWeekOfYear, firstDayOfWeek) {
        var week1Jan = 6 + firstDayOfWeek - firstDayOfWeekOfYear, janX = createUTCDate(year, 0, 1 + week1Jan), d = janX.getUTCDay(), dayOfYear;
        if (d < firstDayOfWeek) {
            d += 7;
        }

        weekday = weekday != null ? 1 * weekday : firstDayOfWeek;

        dayOfYear = 1 + week1Jan + 7 * (week - 1) - d + weekday;

        return {
            year: dayOfYear > 0 ? year : year - 1,
            dayOfYear: dayOfYear > 0 ?  dayOfYear : daysInYear(year - 1) + dayOfYear
        };
    }

    // MOMENTS

    function getSetDayOfYear (input) {
        var dayOfYear = Math.round((this.clone().startOf('day') - this.clone().startOf('year')) / 864e5) + 1;
        return input == null ? dayOfYear : this.add((input - dayOfYear), 'd');
    }

    // Pick the first defined of two or three arguments.
    function defaults(a, b, c) {
        if (a != null) {
            return a;
        }
        if (b != null) {
            return b;
        }
        return c;
    }

    function currentDateArray(config) {
        var now = new Date();
        if (config._useUTC) {
            return [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
        }
        return [now.getFullYear(), now.getMonth(), now.getDate()];
    }

    // convert an array to a date.
    // the array should mirror the parameters below
    // note: all values past the year are optional and will default to the lowest possible value.
    // [year, month, day , hour, minute, second, millisecond]
    function configFromArray (config) {
        var i, date, input = [], currentDate, yearToUse;

        if (config._d) {
            return;
        }

        currentDate = currentDateArray(config);

        //compute day of the year from weeks and weekdays
        if (config._w && config._a[DATE] == null && config._a[MONTH] == null) {
            dayOfYearFromWeekInfo(config);
        }

        //if the day of the year is set, figure out what it is
        if (config._dayOfYear) {
            yearToUse = defaults(config._a[YEAR], currentDate[YEAR]);

            if (config._dayOfYear > daysInYear(yearToUse)) {
                getParsingFlags(config)._overflowDayOfYear = true;
            }

            date = createUTCDate(yearToUse, 0, config._dayOfYear);
            config._a[MONTH] = date.getUTCMonth();
            config._a[DATE] = date.getUTCDate();
        }

        // Default to current date.
        // * if no year, month, day of month are given, default to today
        // * if day of month is given, default month and year
        // * if month is given, default only year
        // * if year is given, don't default anything
        for (i = 0; i < 3 && config._a[i] == null; ++i) {
            config._a[i] = input[i] = currentDate[i];
        }

        // Zero out whatever was not defaulted, including time
        for (; i < 7; i++) {
            config._a[i] = input[i] = (config._a[i] == null) ? (i === 2 ? 1 : 0) : config._a[i];
        }

        // Check for 24:00:00.000
        if (config._a[HOUR] === 24 &&
                config._a[MINUTE] === 0 &&
                config._a[SECOND] === 0 &&
                config._a[MILLISECOND] === 0) {
            config._nextDay = true;
            config._a[HOUR] = 0;
        }

        config._d = (config._useUTC ? createUTCDate : createDate).apply(null, input);
        // Apply timezone offset from input. The actual utcOffset can be changed
        // with parseZone.
        if (config._tzm != null) {
            config._d.setUTCMinutes(config._d.getUTCMinutes() - config._tzm);
        }

        if (config._nextDay) {
            config._a[HOUR] = 24;
        }
    }

    function dayOfYearFromWeekInfo(config) {
        var w, weekYear, week, weekday, dow, doy, temp;

        w = config._w;
        if (w.GG != null || w.W != null || w.E != null) {
            dow = 1;
            doy = 4;

            // TODO: We need to take the current isoWeekYear, but that depends on
            // how we interpret now (local, utc, fixed offset). So create
            // a now version of current config (take local/utc/offset flags, and
            // create now).
            weekYear = defaults(w.GG, config._a[YEAR], weekOfYear(local__createLocal(), 1, 4).year);
            week = defaults(w.W, 1);
            weekday = defaults(w.E, 1);
        } else {
            dow = config._locale._week.dow;
            doy = config._locale._week.doy;

            weekYear = defaults(w.gg, config._a[YEAR], weekOfYear(local__createLocal(), dow, doy).year);
            week = defaults(w.w, 1);

            if (w.d != null) {
                // weekday -- low day numbers are considered next week
                weekday = w.d;
                if (weekday < dow) {
                    ++week;
                }
            } else if (w.e != null) {
                // local weekday -- counting starts from begining of week
                weekday = w.e + dow;
            } else {
                // default to begining of week
                weekday = dow;
            }
        }
        temp = dayOfYearFromWeeks(weekYear, week, weekday, doy, dow);

        config._a[YEAR] = temp.year;
        config._dayOfYear = temp.dayOfYear;
    }

    utils_hooks__hooks.ISO_8601 = function () {};

    // date from string and format string
    function configFromStringAndFormat(config) {
        // TODO: Move this to another part of the creation flow to prevent circular deps
        if (config._f === utils_hooks__hooks.ISO_8601) {
            configFromISO(config);
            return;
        }

        config._a = [];
        getParsingFlags(config).empty = true;

        // This array is used to make a Date, either with `new Date` or `Date.UTC`
        var string = '' + config._i,
            i, parsedInput, tokens, token, skipped,
            stringLength = string.length,
            totalParsedInputLength = 0;

        tokens = expandFormat(config._f, config._locale).match(formattingTokens) || [];

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            parsedInput = (string.match(getParseRegexForToken(token, config)) || [])[0];
            if (parsedInput) {
                skipped = string.substr(0, string.indexOf(parsedInput));
                if (skipped.length > 0) {
                    getParsingFlags(config).unusedInput.push(skipped);
                }
                string = string.slice(string.indexOf(parsedInput) + parsedInput.length);
                totalParsedInputLength += parsedInput.length;
            }
            // don't parse if it's not a known token
            if (formatTokenFunctions[token]) {
                if (parsedInput) {
                    getParsingFlags(config).empty = false;
                }
                else {
                    getParsingFlags(config).unusedTokens.push(token);
                }
                addTimeToArrayFromToken(token, parsedInput, config);
            }
            else if (config._strict && !parsedInput) {
                getParsingFlags(config).unusedTokens.push(token);
            }
        }

        // add remaining unparsed input length to the string
        getParsingFlags(config).charsLeftOver = stringLength - totalParsedInputLength;
        if (string.length > 0) {
            getParsingFlags(config).unusedInput.push(string);
        }

        // clear _12h flag if hour is <= 12
        if (getParsingFlags(config).bigHour === true &&
                config._a[HOUR] <= 12 &&
                config._a[HOUR] > 0) {
            getParsingFlags(config).bigHour = undefined;
        }
        // handle meridiem
        config._a[HOUR] = meridiemFixWrap(config._locale, config._a[HOUR], config._meridiem);

        configFromArray(config);
        checkOverflow(config);
    }


    function meridiemFixWrap (locale, hour, meridiem) {
        var isPm;

        if (meridiem == null) {
            // nothing to do
            return hour;
        }
        if (locale.meridiemHour != null) {
            return locale.meridiemHour(hour, meridiem);
        } else if (locale.isPM != null) {
            // Fallback
            isPm = locale.isPM(meridiem);
            if (isPm && hour < 12) {
                hour += 12;
            }
            if (!isPm && hour === 12) {
                hour = 0;
            }
            return hour;
        } else {
            // this is not supposed to happen
            return hour;
        }
    }

    function configFromStringAndArray(config) {
        var tempConfig,
            bestMoment,

            scoreToBeat,
            i,
            currentScore;

        if (config._f.length === 0) {
            getParsingFlags(config).invalidFormat = true;
            config._d = new Date(NaN);
            return;
        }

        for (i = 0; i < config._f.length; i++) {
            currentScore = 0;
            tempConfig = copyConfig({}, config);
            if (config._useUTC != null) {
                tempConfig._useUTC = config._useUTC;
            }
            tempConfig._f = config._f[i];
            configFromStringAndFormat(tempConfig);

            if (!valid__isValid(tempConfig)) {
                continue;
            }

            // if there is any input that was not parsed add a penalty for that format
            currentScore += getParsingFlags(tempConfig).charsLeftOver;

            //or tokens
            currentScore += getParsingFlags(tempConfig).unusedTokens.length * 10;

            getParsingFlags(tempConfig).score = currentScore;

            if (scoreToBeat == null || currentScore < scoreToBeat) {
                scoreToBeat = currentScore;
                bestMoment = tempConfig;
            }
        }

        extend(config, bestMoment || tempConfig);
    }

    function configFromObject(config) {
        if (config._d) {
            return;
        }

        var i = normalizeObjectUnits(config._i);
        config._a = [i.year, i.month, i.day || i.date, i.hour, i.minute, i.second, i.millisecond];

        configFromArray(config);
    }

    function createFromConfig (config) {
        var res = new Moment(checkOverflow(prepareConfig(config)));
        if (res._nextDay) {
            // Adding is smart enough around DST
            res.add(1, 'd');
            res._nextDay = undefined;
        }

        return res;
    }

    function prepareConfig (config) {
        var input = config._i,
            format = config._f;

        config._locale = config._locale || locale_locales__getLocale(config._l);

        if (input === null || (format === undefined && input === '')) {
            return valid__createInvalid({nullInput: true});
        }

        if (typeof input === 'string') {
            config._i = input = config._locale.preparse(input);
        }

        if (isMoment(input)) {
            return new Moment(checkOverflow(input));
        } else if (isArray(format)) {
            configFromStringAndArray(config);
        } else if (format) {
            configFromStringAndFormat(config);
        } else if (isDate(input)) {
            config._d = input;
        } else {
            configFromInput(config);
        }

        return config;
    }

    function configFromInput(config) {
        var input = config._i;
        if (input === undefined) {
            config._d = new Date();
        } else if (isDate(input)) {
            config._d = new Date(+input);
        } else if (typeof input === 'string') {
            configFromString(config);
        } else if (isArray(input)) {
            config._a = map(input.slice(0), function (obj) {
                return parseInt(obj, 10);
            });
            configFromArray(config);
        } else if (typeof(input) === 'object') {
            configFromObject(config);
        } else if (typeof(input) === 'number') {
            // from milliseconds
            config._d = new Date(input);
        } else {
            utils_hooks__hooks.createFromInputFallback(config);
        }
    }

    function createLocalOrUTC (input, format, locale, strict, isUTC) {
        var c = {};

        if (typeof(locale) === 'boolean') {
            strict = locale;
            locale = undefined;
        }
        // object construction must be done this way.
        // https://github.com/moment/moment/issues/1423
        c._isAMomentObject = true;
        c._useUTC = c._isUTC = isUTC;
        c._l = locale;
        c._i = input;
        c._f = format;
        c._strict = strict;

        return createFromConfig(c);
    }

    function local__createLocal (input, format, locale, strict) {
        return createLocalOrUTC(input, format, locale, strict, false);
    }

    var prototypeMin = deprecate(
         'moment().min is deprecated, use moment.min instead. https://github.com/moment/moment/issues/1548',
         function () {
             var other = local__createLocal.apply(null, arguments);
             return other < this ? this : other;
         }
     );

    var prototypeMax = deprecate(
        'moment().max is deprecated, use moment.max instead. https://github.com/moment/moment/issues/1548',
        function () {
            var other = local__createLocal.apply(null, arguments);
            return other > this ? this : other;
        }
    );

    // Pick a moment m from moments so that m[fn](other) is true for all
    // other. This relies on the function fn to be transitive.
    //
    // moments should either be an array of moment objects or an array, whose
    // first element is an array of moment objects.
    function pickBy(fn, moments) {
        var res, i;
        if (moments.length === 1 && isArray(moments[0])) {
            moments = moments[0];
        }
        if (!moments.length) {
            return local__createLocal();
        }
        res = moments[0];
        for (i = 1; i < moments.length; ++i) {
            if (!moments[i].isValid() || moments[i][fn](res)) {
                res = moments[i];
            }
        }
        return res;
    }

    // TODO: Use [].sort instead?
    function min () {
        var args = [].slice.call(arguments, 0);

        return pickBy('isBefore', args);
    }

    function max () {
        var args = [].slice.call(arguments, 0);

        return pickBy('isAfter', args);
    }

    function Duration (duration) {
        var normalizedInput = normalizeObjectUnits(duration),
            years = normalizedInput.year || 0,
            quarters = normalizedInput.quarter || 0,
            months = normalizedInput.month || 0,
            weeks = normalizedInput.week || 0,
            days = normalizedInput.day || 0,
            hours = normalizedInput.hour || 0,
            minutes = normalizedInput.minute || 0,
            seconds = normalizedInput.second || 0,
            milliseconds = normalizedInput.millisecond || 0;

        // representation for dateAddRemove
        this._milliseconds = +milliseconds +
            seconds * 1e3 + // 1000
            minutes * 6e4 + // 1000 * 60
            hours * 36e5; // 1000 * 60 * 60
        // Because of dateAddRemove treats 24 hours as different from a
        // day when working around DST, we need to store them separately
        this._days = +days +
            weeks * 7;
        // It is impossible translate months into days without knowing
        // which months you are are talking about, so we have to store
        // it separately.
        this._months = +months +
            quarters * 3 +
            years * 12;

        this._data = {};

        this._locale = locale_locales__getLocale();

        this._bubble();
    }

    function isDuration (obj) {
        return obj instanceof Duration;
    }

    function offset (token, separator) {
        addFormatToken(token, 0, 0, function () {
            var offset = this.utcOffset();
            var sign = '+';
            if (offset < 0) {
                offset = -offset;
                sign = '-';
            }
            return sign + zeroFill(~~(offset / 60), 2) + separator + zeroFill(~~(offset) % 60, 2);
        });
    }

    offset('Z', ':');
    offset('ZZ', '');

    // PARSING

    addRegexToken('Z',  matchOffset);
    addRegexToken('ZZ', matchOffset);
    addParseToken(['Z', 'ZZ'], function (input, array, config) {
        config._useUTC = true;
        config._tzm = offsetFromString(input);
    });

    // HELPERS

    // timezone chunker
    // '+10:00' > ['10',  '00']
    // '-1530'  > ['-15', '30']
    var chunkOffset = /([\+\-]|\d\d)/gi;

    function offsetFromString(string) {
        var matches = ((string || '').match(matchOffset) || []);
        var chunk   = matches[matches.length - 1] || [];
        var parts   = (chunk + '').match(chunkOffset) || ['-', 0, 0];
        var minutes = +(parts[1] * 60) + toInt(parts[2]);

        return parts[0] === '+' ? minutes : -minutes;
    }

    // Return a moment from input, that is local/utc/zone equivalent to model.
    function cloneWithOffset(input, model) {
        var res, diff;
        if (model._isUTC) {
            res = model.clone();
            diff = (isMoment(input) || isDate(input) ? +input : +local__createLocal(input)) - (+res);
            // Use low-level api, because this fn is low-level api.
            res._d.setTime(+res._d + diff);
            utils_hooks__hooks.updateOffset(res, false);
            return res;
        } else {
            return local__createLocal(input).local();
        }
    }

    function getDateOffset (m) {
        // On Firefox.24 Date#getTimezoneOffset returns a floating point.
        // https://github.com/moment/moment/pull/1871
        return -Math.round(m._d.getTimezoneOffset() / 15) * 15;
    }

    // HOOKS

    // This function will be called whenever a moment is mutated.
    // It is intended to keep the offset in sync with the timezone.
    utils_hooks__hooks.updateOffset = function () {};

    // MOMENTS

    // keepLocalTime = true means only change the timezone, without
    // affecting the local hour. So 5:31:26 +0300 --[utcOffset(2, true)]-->
    // 5:31:26 +0200 It is possible that 5:31:26 doesn't exist with offset
    // +0200, so we adjust the time as needed, to be valid.
    //
    // Keeping the time actually adds/subtracts (one hour)
    // from the actual represented time. That is why we call updateOffset
    // a second time. In case it wants us to change the offset again
    // _changeInProgress == true case, then we have to adjust, because
    // there is no such time in the given timezone.
    function getSetOffset (input, keepLocalTime) {
        var offset = this._offset || 0,
            localAdjust;
        if (input != null) {
            if (typeof input === 'string') {
                input = offsetFromString(input);
            }
            if (Math.abs(input) < 16) {
                input = input * 60;
            }
            if (!this._isUTC && keepLocalTime) {
                localAdjust = getDateOffset(this);
            }
            this._offset = input;
            this._isUTC = true;
            if (localAdjust != null) {
                this.add(localAdjust, 'm');
            }
            if (offset !== input) {
                if (!keepLocalTime || this._changeInProgress) {
                    add_subtract__addSubtract(this, create__createDuration(input - offset, 'm'), 1, false);
                } else if (!this._changeInProgress) {
                    this._changeInProgress = true;
                    utils_hooks__hooks.updateOffset(this, true);
                    this._changeInProgress = null;
                }
            }
            return this;
        } else {
            return this._isUTC ? offset : getDateOffset(this);
        }
    }

    function getSetZone (input, keepLocalTime) {
        if (input != null) {
            if (typeof input !== 'string') {
                input = -input;
            }

            this.utcOffset(input, keepLocalTime);

            return this;
        } else {
            return -this.utcOffset();
        }
    }

    function setOffsetToUTC (keepLocalTime) {
        return this.utcOffset(0, keepLocalTime);
    }

    function setOffsetToLocal (keepLocalTime) {
        if (this._isUTC) {
            this.utcOffset(0, keepLocalTime);
            this._isUTC = false;

            if (keepLocalTime) {
                this.subtract(getDateOffset(this), 'm');
            }
        }
        return this;
    }

    function setOffsetToParsedOffset () {
        if (this._tzm) {
            this.utcOffset(this._tzm);
        } else if (typeof this._i === 'string') {
            this.utcOffset(offsetFromString(this._i));
        }
        return this;
    }

    function hasAlignedHourOffset (input) {
        input = input ? local__createLocal(input).utcOffset() : 0;

        return (this.utcOffset() - input) % 60 === 0;
    }

    function isDaylightSavingTime () {
        return (
            this.utcOffset() > this.clone().month(0).utcOffset() ||
            this.utcOffset() > this.clone().month(5).utcOffset()
        );
    }

    function isDaylightSavingTimeShifted () {
        if (typeof this._isDSTShifted !== 'undefined') {
            return this._isDSTShifted;
        }

        var c = {};

        copyConfig(c, this);
        c = prepareConfig(c);

        if (c._a) {
            var other = c._isUTC ? create_utc__createUTC(c._a) : local__createLocal(c._a);
            this._isDSTShifted = this.isValid() &&
                compareArrays(c._a, other.toArray()) > 0;
        } else {
            this._isDSTShifted = false;
        }

        return this._isDSTShifted;
    }

    function isLocal () {
        return !this._isUTC;
    }

    function isUtcOffset () {
        return this._isUTC;
    }

    function isUtc () {
        return this._isUTC && this._offset === 0;
    }

    var aspNetRegex = /(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/;

    // from http://docs.closure-library.googlecode.com/git/closure_goog_date_date.js.source.html
    // somewhat more in line with 4.4.3.2 2004 spec, but allows decimal anywhere
    var create__isoRegex = /^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/;

    function create__createDuration (input, key) {
        var duration = input,
            // matching against regexp is expensive, do it on demand
            match = null,
            sign,
            ret,
            diffRes;

        if (isDuration(input)) {
            duration = {
                ms : input._milliseconds,
                d  : input._days,
                M  : input._months
            };
        } else if (typeof input === 'number') {
            duration = {};
            if (key) {
                duration[key] = input;
            } else {
                duration.milliseconds = input;
            }
        } else if (!!(match = aspNetRegex.exec(input))) {
            sign = (match[1] === '-') ? -1 : 1;
            duration = {
                y  : 0,
                d  : toInt(match[DATE])        * sign,
                h  : toInt(match[HOUR])        * sign,
                m  : toInt(match[MINUTE])      * sign,
                s  : toInt(match[SECOND])      * sign,
                ms : toInt(match[MILLISECOND]) * sign
            };
        } else if (!!(match = create__isoRegex.exec(input))) {
            sign = (match[1] === '-') ? -1 : 1;
            duration = {
                y : parseIso(match[2], sign),
                M : parseIso(match[3], sign),
                d : parseIso(match[4], sign),
                h : parseIso(match[5], sign),
                m : parseIso(match[6], sign),
                s : parseIso(match[7], sign),
                w : parseIso(match[8], sign)
            };
        } else if (duration == null) {// checks for null or undefined
            duration = {};
        } else if (typeof duration === 'object' && ('from' in duration || 'to' in duration)) {
            diffRes = momentsDifference(local__createLocal(duration.from), local__createLocal(duration.to));

            duration = {};
            duration.ms = diffRes.milliseconds;
            duration.M = diffRes.months;
        }

        ret = new Duration(duration);

        if (isDuration(input) && hasOwnProp(input, '_locale')) {
            ret._locale = input._locale;
        }

        return ret;
    }

    create__createDuration.fn = Duration.prototype;

    function parseIso (inp, sign) {
        // We'd normally use ~~inp for this, but unfortunately it also
        // converts floats to ints.
        // inp may be undefined, so careful calling replace on it.
        var res = inp && parseFloat(inp.replace(',', '.'));
        // apply sign while we're at it
        return (isNaN(res) ? 0 : res) * sign;
    }

    function positiveMomentsDifference(base, other) {
        var res = {milliseconds: 0, months: 0};

        res.months = other.month() - base.month() +
            (other.year() - base.year()) * 12;
        if (base.clone().add(res.months, 'M').isAfter(other)) {
            --res.months;
        }

        res.milliseconds = +other - +(base.clone().add(res.months, 'M'));

        return res;
    }

    function momentsDifference(base, other) {
        var res;
        other = cloneWithOffset(other, base);
        if (base.isBefore(other)) {
            res = positiveMomentsDifference(base, other);
        } else {
            res = positiveMomentsDifference(other, base);
            res.milliseconds = -res.milliseconds;
            res.months = -res.months;
        }

        return res;
    }

    function createAdder(direction, name) {
        return function (val, period) {
            var dur, tmp;
            //invert the arguments, but complain about it
            if (period !== null && !isNaN(+period)) {
                deprecateSimple(name, 'moment().' + name  + '(period, number) is deprecated. Please use moment().' + name + '(number, period).');
                tmp = val; val = period; period = tmp;
            }

            val = typeof val === 'string' ? +val : val;
            dur = create__createDuration(val, period);
            add_subtract__addSubtract(this, dur, direction);
            return this;
        };
    }

    function add_subtract__addSubtract (mom, duration, isAdding, updateOffset) {
        var milliseconds = duration._milliseconds,
            days = duration._days,
            months = duration._months;
        updateOffset = updateOffset == null ? true : updateOffset;

        if (milliseconds) {
            mom._d.setTime(+mom._d + milliseconds * isAdding);
        }
        if (days) {
            get_set__set(mom, 'Date', get_set__get(mom, 'Date') + days * isAdding);
        }
        if (months) {
            setMonth(mom, get_set__get(mom, 'Month') + months * isAdding);
        }
        if (updateOffset) {
            utils_hooks__hooks.updateOffset(mom, days || months);
        }
    }

    var add_subtract__add      = createAdder(1, 'add');
    var add_subtract__subtract = createAdder(-1, 'subtract');

    function moment_calendar__calendar (time, formats) {
        // We want to compare the start of today, vs this.
        // Getting start-of-today depends on whether we're local/utc/offset or not.
        var now = time || local__createLocal(),
            sod = cloneWithOffset(now, this).startOf('day'),
            diff = this.diff(sod, 'days', true),
            format = diff < -6 ? 'sameElse' :
                diff < -1 ? 'lastWeek' :
                diff < 0 ? 'lastDay' :
                diff < 1 ? 'sameDay' :
                diff < 2 ? 'nextDay' :
                diff < 7 ? 'nextWeek' : 'sameElse';
        return this.format(formats && formats[format] || this.localeData().calendar(format, this, local__createLocal(now)));
    }

    function clone () {
        return new Moment(this);
    }

    function isAfter (input, units) {
        var inputMs;
        units = normalizeUnits(typeof units !== 'undefined' ? units : 'millisecond');
        if (units === 'millisecond') {
            input = isMoment(input) ? input : local__createLocal(input);
            return +this > +input;
        } else {
            inputMs = isMoment(input) ? +input : +local__createLocal(input);
            return inputMs < +this.clone().startOf(units);
        }
    }

    function isBefore (input, units) {
        var inputMs;
        units = normalizeUnits(typeof units !== 'undefined' ? units : 'millisecond');
        if (units === 'millisecond') {
            input = isMoment(input) ? input : local__createLocal(input);
            return +this < +input;
        } else {
            inputMs = isMoment(input) ? +input : +local__createLocal(input);
            return +this.clone().endOf(units) < inputMs;
        }
    }

    function isBetween (from, to, units) {
        return this.isAfter(from, units) && this.isBefore(to, units);
    }

    function isSame (input, units) {
        var inputMs;
        units = normalizeUnits(units || 'millisecond');
        if (units === 'millisecond') {
            input = isMoment(input) ? input : local__createLocal(input);
            return +this === +input;
        } else {
            inputMs = +local__createLocal(input);
            return +(this.clone().startOf(units)) <= inputMs && inputMs <= +(this.clone().endOf(units));
        }
    }

    function diff (input, units, asFloat) {
        var that = cloneWithOffset(input, this),
            zoneDelta = (that.utcOffset() - this.utcOffset()) * 6e4,
            delta, output;

        units = normalizeUnits(units);

        if (units === 'year' || units === 'month' || units === 'quarter') {
            output = monthDiff(this, that);
            if (units === 'quarter') {
                output = output / 3;
            } else if (units === 'year') {
                output = output / 12;
            }
        } else {
            delta = this - that;
            output = units === 'second' ? delta / 1e3 : // 1000
                units === 'minute' ? delta / 6e4 : // 1000 * 60
                units === 'hour' ? delta / 36e5 : // 1000 * 60 * 60
                units === 'day' ? (delta - zoneDelta) / 864e5 : // 1000 * 60 * 60 * 24, negate dst
                units === 'week' ? (delta - zoneDelta) / 6048e5 : // 1000 * 60 * 60 * 24 * 7, negate dst
                delta;
        }
        return asFloat ? output : absFloor(output);
    }

    function monthDiff (a, b) {
        // difference in months
        var wholeMonthDiff = ((b.year() - a.year()) * 12) + (b.month() - a.month()),
            // b is in (anchor - 1 month, anchor + 1 month)
            anchor = a.clone().add(wholeMonthDiff, 'months'),
            anchor2, adjust;

        if (b - anchor < 0) {
            anchor2 = a.clone().add(wholeMonthDiff - 1, 'months');
            // linear across the month
            adjust = (b - anchor) / (anchor - anchor2);
        } else {
            anchor2 = a.clone().add(wholeMonthDiff + 1, 'months');
            // linear across the month
            adjust = (b - anchor) / (anchor2 - anchor);
        }

        return -(wholeMonthDiff + adjust);
    }

    utils_hooks__hooks.defaultFormat = 'YYYY-MM-DDTHH:mm:ssZ';

    function toString () {
        return this.clone().locale('en').format('ddd MMM DD YYYY HH:mm:ss [GMT]ZZ');
    }

    function moment_format__toISOString () {
        var m = this.clone().utc();
        if (0 < m.year() && m.year() <= 9999) {
            if ('function' === typeof Date.prototype.toISOString) {
                // native implementation is ~50x faster, use it when we can
                return this.toDate().toISOString();
            } else {
                return formatMoment(m, 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
            }
        } else {
            return formatMoment(m, 'YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
        }
    }

    function format (inputString) {
        var output = formatMoment(this, inputString || utils_hooks__hooks.defaultFormat);
        return this.localeData().postformat(output);
    }

    function from (time, withoutSuffix) {
        if (!this.isValid()) {
            return this.localeData().invalidDate();
        }
        return create__createDuration({to: this, from: time}).locale(this.locale()).humanize(!withoutSuffix);
    }

    function fromNow (withoutSuffix) {
        return this.from(local__createLocal(), withoutSuffix);
    }

    function to (time, withoutSuffix) {
        if (!this.isValid()) {
            return this.localeData().invalidDate();
        }
        return create__createDuration({from: this, to: time}).locale(this.locale()).humanize(!withoutSuffix);
    }

    function toNow (withoutSuffix) {
        return this.to(local__createLocal(), withoutSuffix);
    }

    function locale (key) {
        var newLocaleData;

        if (key === undefined) {
            return this._locale._abbr;
        } else {
            newLocaleData = locale_locales__getLocale(key);
            if (newLocaleData != null) {
                this._locale = newLocaleData;
            }
            return this;
        }
    }

    var lang = deprecate(
        'moment().lang() is deprecated. Instead, use moment().localeData() to get the language configuration. Use moment().locale() to change languages.',
        function (key) {
            if (key === undefined) {
                return this.localeData();
            } else {
                return this.locale(key);
            }
        }
    );

    function localeData () {
        return this._locale;
    }

    function startOf (units) {
        units = normalizeUnits(units);
        // the following switch intentionally omits break keywords
        // to utilize falling through the cases.
        switch (units) {
        case 'year':
            this.month(0);
            /* falls through */
        case 'quarter':
        case 'month':
            this.date(1);
            /* falls through */
        case 'week':
        case 'isoWeek':
        case 'day':
            this.hours(0);
            /* falls through */
        case 'hour':
            this.minutes(0);
            /* falls through */
        case 'minute':
            this.seconds(0);
            /* falls through */
        case 'second':
            this.milliseconds(0);
        }

        // weeks are a special case
        if (units === 'week') {
            this.weekday(0);
        }
        if (units === 'isoWeek') {
            this.isoWeekday(1);
        }

        // quarters are also special
        if (units === 'quarter') {
            this.month(Math.floor(this.month() / 3) * 3);
        }

        return this;
    }

    function endOf (units) {
        units = normalizeUnits(units);
        if (units === undefined || units === 'millisecond') {
            return this;
        }
        return this.startOf(units).add(1, (units === 'isoWeek' ? 'week' : units)).subtract(1, 'ms');
    }

    function to_type__valueOf () {
        return +this._d - ((this._offset || 0) * 60000);
    }

    function unix () {
        return Math.floor(+this / 1000);
    }

    function toDate () {
        return this._offset ? new Date(+this) : this._d;
    }

    function toArray () {
        var m = this;
        return [m.year(), m.month(), m.date(), m.hour(), m.minute(), m.second(), m.millisecond()];
    }

    function toObject () {
        var m = this;
        return {
            years: m.year(),
            months: m.month(),
            date: m.date(),
            hours: m.hours(),
            minutes: m.minutes(),
            seconds: m.seconds(),
            milliseconds: m.milliseconds()
        };
    }

    function moment_valid__isValid () {
        return valid__isValid(this);
    }

    function parsingFlags () {
        return extend({}, getParsingFlags(this));
    }

    function invalidAt () {
        return getParsingFlags(this).overflow;
    }

    addFormatToken(0, ['gg', 2], 0, function () {
        return this.weekYear() % 100;
    });

    addFormatToken(0, ['GG', 2], 0, function () {
        return this.isoWeekYear() % 100;
    });

    function addWeekYearFormatToken (token, getter) {
        addFormatToken(0, [token, token.length], 0, getter);
    }

    addWeekYearFormatToken('gggg',     'weekYear');
    addWeekYearFormatToken('ggggg',    'weekYear');
    addWeekYearFormatToken('GGGG',  'isoWeekYear');
    addWeekYearFormatToken('GGGGG', 'isoWeekYear');

    // ALIASES

    addUnitAlias('weekYear', 'gg');
    addUnitAlias('isoWeekYear', 'GG');

    // PARSING

    addRegexToken('G',      matchSigned);
    addRegexToken('g',      matchSigned);
    addRegexToken('GG',     match1to2, match2);
    addRegexToken('gg',     match1to2, match2);
    addRegexToken('GGGG',   match1to4, match4);
    addRegexToken('gggg',   match1to4, match4);
    addRegexToken('GGGGG',  match1to6, match6);
    addRegexToken('ggggg',  match1to6, match6);

    addWeekParseToken(['gggg', 'ggggg', 'GGGG', 'GGGGG'], function (input, week, config, token) {
        week[token.substr(0, 2)] = toInt(input);
    });

    addWeekParseToken(['gg', 'GG'], function (input, week, config, token) {
        week[token] = utils_hooks__hooks.parseTwoDigitYear(input);
    });

    // HELPERS

    function weeksInYear(year, dow, doy) {
        return weekOfYear(local__createLocal([year, 11, 31 + dow - doy]), dow, doy).week;
    }

    // MOMENTS

    function getSetWeekYear (input) {
        var year = weekOfYear(this, this.localeData()._week.dow, this.localeData()._week.doy).year;
        return input == null ? year : this.add((input - year), 'y');
    }

    function getSetISOWeekYear (input) {
        var year = weekOfYear(this, 1, 4).year;
        return input == null ? year : this.add((input - year), 'y');
    }

    function getISOWeeksInYear () {
        return weeksInYear(this.year(), 1, 4);
    }

    function getWeeksInYear () {
        var weekInfo = this.localeData()._week;
        return weeksInYear(this.year(), weekInfo.dow, weekInfo.doy);
    }

    addFormatToken('Q', 0, 0, 'quarter');

    // ALIASES

    addUnitAlias('quarter', 'Q');

    // PARSING

    addRegexToken('Q', match1);
    addParseToken('Q', function (input, array) {
        array[MONTH] = (toInt(input) - 1) * 3;
    });

    // MOMENTS

    function getSetQuarter (input) {
        return input == null ? Math.ceil((this.month() + 1) / 3) : this.month((input - 1) * 3 + this.month() % 3);
    }

    addFormatToken('D', ['DD', 2], 'Do', 'date');

    // ALIASES

    addUnitAlias('date', 'D');

    // PARSING

    addRegexToken('D',  match1to2);
    addRegexToken('DD', match1to2, match2);
    addRegexToken('Do', function (isStrict, locale) {
        return isStrict ? locale._ordinalParse : locale._ordinalParseLenient;
    });

    addParseToken(['D', 'DD'], DATE);
    addParseToken('Do', function (input, array) {
        array[DATE] = toInt(input.match(match1to2)[0], 10);
    });

    // MOMENTS

    var getSetDayOfMonth = makeGetSet('Date', true);

    addFormatToken('d', 0, 'do', 'day');

    addFormatToken('dd', 0, 0, function (format) {
        return this.localeData().weekdaysMin(this, format);
    });

    addFormatToken('ddd', 0, 0, function (format) {
        return this.localeData().weekdaysShort(this, format);
    });

    addFormatToken('dddd', 0, 0, function (format) {
        return this.localeData().weekdays(this, format);
    });

    addFormatToken('e', 0, 0, 'weekday');
    addFormatToken('E', 0, 0, 'isoWeekday');

    // ALIASES

    addUnitAlias('day', 'd');
    addUnitAlias('weekday', 'e');
    addUnitAlias('isoWeekday', 'E');

    // PARSING

    addRegexToken('d',    match1to2);
    addRegexToken('e',    match1to2);
    addRegexToken('E',    match1to2);
    addRegexToken('dd',   matchWord);
    addRegexToken('ddd',  matchWord);
    addRegexToken('dddd', matchWord);

    addWeekParseToken(['dd', 'ddd', 'dddd'], function (input, week, config) {
        var weekday = config._locale.weekdaysParse(input);
        // if we didn't get a weekday name, mark the date as invalid
        if (weekday != null) {
            week.d = weekday;
        } else {
            getParsingFlags(config).invalidWeekday = input;
        }
    });

    addWeekParseToken(['d', 'e', 'E'], function (input, week, config, token) {
        week[token] = toInt(input);
    });

    // HELPERS

    function parseWeekday(input, locale) {
        if (typeof input !== 'string') {
            return input;
        }

        if (!isNaN(input)) {
            return parseInt(input, 10);
        }

        input = locale.weekdaysParse(input);
        if (typeof input === 'number') {
            return input;
        }

        return null;
    }

    // LOCALES

    var defaultLocaleWeekdays = 'Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday'.split('_');
    function localeWeekdays (m) {
        return this._weekdays[m.day()];
    }

    var defaultLocaleWeekdaysShort = 'Sun_Mon_Tue_Wed_Thu_Fri_Sat'.split('_');
    function localeWeekdaysShort (m) {
        return this._weekdaysShort[m.day()];
    }

    var defaultLocaleWeekdaysMin = 'Su_Mo_Tu_We_Th_Fr_Sa'.split('_');
    function localeWeekdaysMin (m) {
        return this._weekdaysMin[m.day()];
    }

    function localeWeekdaysParse (weekdayName) {
        var i, mom, regex;

        this._weekdaysParse = this._weekdaysParse || [];

        for (i = 0; i < 7; i++) {
            // make the regex if we don't have it already
            if (!this._weekdaysParse[i]) {
                mom = local__createLocal([2000, 1]).day(i);
                regex = '^' + this.weekdays(mom, '') + '|^' + this.weekdaysShort(mom, '') + '|^' + this.weekdaysMin(mom, '');
                this._weekdaysParse[i] = new RegExp(regex.replace('.', ''), 'i');
            }
            // test the regex
            if (this._weekdaysParse[i].test(weekdayName)) {
                return i;
            }
        }
    }

    // MOMENTS

    function getSetDayOfWeek (input) {
        var day = this._isUTC ? this._d.getUTCDay() : this._d.getDay();
        if (input != null) {
            input = parseWeekday(input, this.localeData());
            return this.add(input - day, 'd');
        } else {
            return day;
        }
    }

    function getSetLocaleDayOfWeek (input) {
        var weekday = (this.day() + 7 - this.localeData()._week.dow) % 7;
        return input == null ? weekday : this.add(input - weekday, 'd');
    }

    function getSetISODayOfWeek (input) {
        // behaves the same as moment#day except
        // as a getter, returns 7 instead of 0 (1-7 range instead of 0-6)
        // as a setter, sunday should belong to the previous week.
        return input == null ? this.day() || 7 : this.day(this.day() % 7 ? input : input - 7);
    }

    addFormatToken('H', ['HH', 2], 0, 'hour');
    addFormatToken('h', ['hh', 2], 0, function () {
        return this.hours() % 12 || 12;
    });

    function meridiem (token, lowercase) {
        addFormatToken(token, 0, 0, function () {
            return this.localeData().meridiem(this.hours(), this.minutes(), lowercase);
        });
    }

    meridiem('a', true);
    meridiem('A', false);

    // ALIASES

    addUnitAlias('hour', 'h');

    // PARSING

    function matchMeridiem (isStrict, locale) {
        return locale._meridiemParse;
    }

    addRegexToken('a',  matchMeridiem);
    addRegexToken('A',  matchMeridiem);
    addRegexToken('H',  match1to2);
    addRegexToken('h',  match1to2);
    addRegexToken('HH', match1to2, match2);
    addRegexToken('hh', match1to2, match2);

    addParseToken(['H', 'HH'], HOUR);
    addParseToken(['a', 'A'], function (input, array, config) {
        config._isPm = config._locale.isPM(input);
        config._meridiem = input;
    });
    addParseToken(['h', 'hh'], function (input, array, config) {
        array[HOUR] = toInt(input);
        getParsingFlags(config).bigHour = true;
    });

    // LOCALES

    function localeIsPM (input) {
        // IE8 Quirks Mode & IE7 Standards Mode do not allow accessing strings like arrays
        // Using charAt should be more compatible.
        return ((input + '').toLowerCase().charAt(0) === 'p');
    }

    var defaultLocaleMeridiemParse = /[ap]\.?m?\.?/i;
    function localeMeridiem (hours, minutes, isLower) {
        if (hours > 11) {
            return isLower ? 'pm' : 'PM';
        } else {
            return isLower ? 'am' : 'AM';
        }
    }


    // MOMENTS

    // Setting the hour should keep the time, because the user explicitly
    // specified which hour he wants. So trying to maintain the same hour (in
    // a new timezone) makes sense. Adding/subtracting hours does not follow
    // this rule.
    var getSetHour = makeGetSet('Hours', true);

    addFormatToken('m', ['mm', 2], 0, 'minute');

    // ALIASES

    addUnitAlias('minute', 'm');

    // PARSING

    addRegexToken('m',  match1to2);
    addRegexToken('mm', match1to2, match2);
    addParseToken(['m', 'mm'], MINUTE);

    // MOMENTS

    var getSetMinute = makeGetSet('Minutes', false);

    addFormatToken('s', ['ss', 2], 0, 'second');

    // ALIASES

    addUnitAlias('second', 's');

    // PARSING

    addRegexToken('s',  match1to2);
    addRegexToken('ss', match1to2, match2);
    addParseToken(['s', 'ss'], SECOND);

    // MOMENTS

    var getSetSecond = makeGetSet('Seconds', false);

    addFormatToken('S', 0, 0, function () {
        return ~~(this.millisecond() / 100);
    });

    addFormatToken(0, ['SS', 2], 0, function () {
        return ~~(this.millisecond() / 10);
    });

    addFormatToken(0, ['SSS', 3], 0, 'millisecond');
    addFormatToken(0, ['SSSS', 4], 0, function () {
        return this.millisecond() * 10;
    });
    addFormatToken(0, ['SSSSS', 5], 0, function () {
        return this.millisecond() * 100;
    });
    addFormatToken(0, ['SSSSSS', 6], 0, function () {
        return this.millisecond() * 1000;
    });
    addFormatToken(0, ['SSSSSSS', 7], 0, function () {
        return this.millisecond() * 10000;
    });
    addFormatToken(0, ['SSSSSSSS', 8], 0, function () {
        return this.millisecond() * 100000;
    });
    addFormatToken(0, ['SSSSSSSSS', 9], 0, function () {
        return this.millisecond() * 1000000;
    });


    // ALIASES

    addUnitAlias('millisecond', 'ms');

    // PARSING

    addRegexToken('S',    match1to3, match1);
    addRegexToken('SS',   match1to3, match2);
    addRegexToken('SSS',  match1to3, match3);

    var token;
    for (token = 'SSSS'; token.length <= 9; token += 'S') {
        addRegexToken(token, matchUnsigned);
    }

    function parseMs(input, array) {
        array[MILLISECOND] = toInt(('0.' + input) * 1000);
    }

    for (token = 'S'; token.length <= 9; token += 'S') {
        addParseToken(token, parseMs);
    }
    // MOMENTS

    var getSetMillisecond = makeGetSet('Milliseconds', false);

    addFormatToken('z',  0, 0, 'zoneAbbr');
    addFormatToken('zz', 0, 0, 'zoneName');

    // MOMENTS

    function getZoneAbbr () {
        return this._isUTC ? 'UTC' : '';
    }

    function getZoneName () {
        return this._isUTC ? 'Coordinated Universal Time' : '';
    }

    var momentPrototype__proto = Moment.prototype;

    momentPrototype__proto.add          = add_subtract__add;
    momentPrototype__proto.calendar     = moment_calendar__calendar;
    momentPrototype__proto.clone        = clone;
    momentPrototype__proto.diff         = diff;
    momentPrototype__proto.endOf        = endOf;
    momentPrototype__proto.format       = format;
    momentPrototype__proto.from         = from;
    momentPrototype__proto.fromNow      = fromNow;
    momentPrototype__proto.to           = to;
    momentPrototype__proto.toNow        = toNow;
    momentPrototype__proto.get          = getSet;
    momentPrototype__proto.invalidAt    = invalidAt;
    momentPrototype__proto.isAfter      = isAfter;
    momentPrototype__proto.isBefore     = isBefore;
    momentPrototype__proto.isBetween    = isBetween;
    momentPrototype__proto.isSame       = isSame;
    momentPrototype__proto.isValid      = moment_valid__isValid;
    momentPrototype__proto.lang         = lang;
    momentPrototype__proto.locale       = locale;
    momentPrototype__proto.localeData   = localeData;
    momentPrototype__proto.max          = prototypeMax;
    momentPrototype__proto.min          = prototypeMin;
    momentPrototype__proto.parsingFlags = parsingFlags;
    momentPrototype__proto.set          = getSet;
    momentPrototype__proto.startOf      = startOf;
    momentPrototype__proto.subtract     = add_subtract__subtract;
    momentPrototype__proto.toArray      = toArray;
    momentPrototype__proto.toObject     = toObject;
    momentPrototype__proto.toDate       = toDate;
    momentPrototype__proto.toISOString  = moment_format__toISOString;
    momentPrototype__proto.toJSON       = moment_format__toISOString;
    momentPrototype__proto.toString     = toString;
    momentPrototype__proto.unix         = unix;
    momentPrototype__proto.valueOf      = to_type__valueOf;

    // Year
    momentPrototype__proto.year       = getSetYear;
    momentPrototype__proto.isLeapYear = getIsLeapYear;

    // Week Year
    momentPrototype__proto.weekYear    = getSetWeekYear;
    momentPrototype__proto.isoWeekYear = getSetISOWeekYear;

    // Quarter
    momentPrototype__proto.quarter = momentPrototype__proto.quarters = getSetQuarter;

    // Month
    momentPrototype__proto.month       = getSetMonth;
    momentPrototype__proto.daysInMonth = getDaysInMonth;

    // Week
    momentPrototype__proto.week           = momentPrototype__proto.weeks        = getSetWeek;
    momentPrototype__proto.isoWeek        = momentPrototype__proto.isoWeeks     = getSetISOWeek;
    momentPrototype__proto.weeksInYear    = getWeeksInYear;
    momentPrototype__proto.isoWeeksInYear = getISOWeeksInYear;

    // Day
    momentPrototype__proto.date       = getSetDayOfMonth;
    momentPrototype__proto.day        = momentPrototype__proto.days             = getSetDayOfWeek;
    momentPrototype__proto.weekday    = getSetLocaleDayOfWeek;
    momentPrototype__proto.isoWeekday = getSetISODayOfWeek;
    momentPrototype__proto.dayOfYear  = getSetDayOfYear;

    // Hour
    momentPrototype__proto.hour = momentPrototype__proto.hours = getSetHour;

    // Minute
    momentPrototype__proto.minute = momentPrototype__proto.minutes = getSetMinute;

    // Second
    momentPrototype__proto.second = momentPrototype__proto.seconds = getSetSecond;

    // Millisecond
    momentPrototype__proto.millisecond = momentPrototype__proto.milliseconds = getSetMillisecond;

    // Offset
    momentPrototype__proto.utcOffset            = getSetOffset;
    momentPrototype__proto.utc                  = setOffsetToUTC;
    momentPrototype__proto.local                = setOffsetToLocal;
    momentPrototype__proto.parseZone            = setOffsetToParsedOffset;
    momentPrototype__proto.hasAlignedHourOffset = hasAlignedHourOffset;
    momentPrototype__proto.isDST                = isDaylightSavingTime;
    momentPrototype__proto.isDSTShifted         = isDaylightSavingTimeShifted;
    momentPrototype__proto.isLocal              = isLocal;
    momentPrototype__proto.isUtcOffset          = isUtcOffset;
    momentPrototype__proto.isUtc                = isUtc;
    momentPrototype__proto.isUTC                = isUtc;

    // Timezone
    momentPrototype__proto.zoneAbbr = getZoneAbbr;
    momentPrototype__proto.zoneName = getZoneName;

    // Deprecations
    momentPrototype__proto.dates  = deprecate('dates accessor is deprecated. Use date instead.', getSetDayOfMonth);
    momentPrototype__proto.months = deprecate('months accessor is deprecated. Use month instead', getSetMonth);
    momentPrototype__proto.years  = deprecate('years accessor is deprecated. Use year instead', getSetYear);
    momentPrototype__proto.zone   = deprecate('moment().zone is deprecated, use moment().utcOffset instead. https://github.com/moment/moment/issues/1779', getSetZone);

    var momentPrototype = momentPrototype__proto;

    function moment__createUnix (input) {
        return local__createLocal(input * 1000);
    }

    function moment__createInZone () {
        return local__createLocal.apply(null, arguments).parseZone();
    }

    var defaultCalendar = {
        sameDay : '[Today at] LT',
        nextDay : '[Tomorrow at] LT',
        nextWeek : 'dddd [at] LT',
        lastDay : '[Yesterday at] LT',
        lastWeek : '[Last] dddd [at] LT',
        sameElse : 'L'
    };

    function locale_calendar__calendar (key, mom, now) {
        var output = this._calendar[key];
        return typeof output === 'function' ? output.call(mom, now) : output;
    }

    var defaultLongDateFormat = {
        LTS  : 'h:mm:ss A',
        LT   : 'h:mm A',
        L    : 'MM/DD/YYYY',
        LL   : 'MMMM D, YYYY',
        LLL  : 'MMMM D, YYYY h:mm A',
        LLLL : 'dddd, MMMM D, YYYY h:mm A'
    };

    function longDateFormat (key) {
        var format = this._longDateFormat[key],
            formatUpper = this._longDateFormat[key.toUpperCase()];

        if (format || !formatUpper) {
            return format;
        }

        this._longDateFormat[key] = formatUpper.replace(/MMMM|MM|DD|dddd/g, function (val) {
            return val.slice(1);
        });

        return this._longDateFormat[key];
    }

    var defaultInvalidDate = 'Invalid date';

    function invalidDate () {
        return this._invalidDate;
    }

    var defaultOrdinal = '%d';
    var defaultOrdinalParse = /\d{1,2}/;

    function ordinal (number) {
        return this._ordinal.replace('%d', number);
    }

    function preParsePostFormat (string) {
        return string;
    }

    var defaultRelativeTime = {
        future : 'in %s',
        past   : '%s ago',
        s  : 'a few seconds',
        m  : 'a minute',
        mm : '%d minutes',
        h  : 'an hour',
        hh : '%d hours',
        d  : 'a day',
        dd : '%d days',
        M  : 'a month',
        MM : '%d months',
        y  : 'a year',
        yy : '%d years'
    };

    function relative__relativeTime (number, withoutSuffix, string, isFuture) {
        var output = this._relativeTime[string];
        return (typeof output === 'function') ?
            output(number, withoutSuffix, string, isFuture) :
            output.replace(/%d/i, number);
    }

    function pastFuture (diff, output) {
        var format = this._relativeTime[diff > 0 ? 'future' : 'past'];
        return typeof format === 'function' ? format(output) : format.replace(/%s/i, output);
    }

    function locale_set__set (config) {
        var prop, i;
        for (i in config) {
            prop = config[i];
            if (typeof prop === 'function') {
                this[i] = prop;
            } else {
                this['_' + i] = prop;
            }
        }
        // Lenient ordinal parsing accepts just a number in addition to
        // number + (possibly) stuff coming from _ordinalParseLenient.
        this._ordinalParseLenient = new RegExp(this._ordinalParse.source + '|' + (/\d{1,2}/).source);
    }

    var prototype__proto = Locale.prototype;

    prototype__proto._calendar       = defaultCalendar;
    prototype__proto.calendar        = locale_calendar__calendar;
    prototype__proto._longDateFormat = defaultLongDateFormat;
    prototype__proto.longDateFormat  = longDateFormat;
    prototype__proto._invalidDate    = defaultInvalidDate;
    prototype__proto.invalidDate     = invalidDate;
    prototype__proto._ordinal        = defaultOrdinal;
    prototype__proto.ordinal         = ordinal;
    prototype__proto._ordinalParse   = defaultOrdinalParse;
    prototype__proto.preparse        = preParsePostFormat;
    prototype__proto.postformat      = preParsePostFormat;
    prototype__proto._relativeTime   = defaultRelativeTime;
    prototype__proto.relativeTime    = relative__relativeTime;
    prototype__proto.pastFuture      = pastFuture;
    prototype__proto.set             = locale_set__set;

    // Month
    prototype__proto.months       =        localeMonths;
    prototype__proto._months      = defaultLocaleMonths;
    prototype__proto.monthsShort  =        localeMonthsShort;
    prototype__proto._monthsShort = defaultLocaleMonthsShort;
    prototype__proto.monthsParse  =        localeMonthsParse;

    // Week
    prototype__proto.week = localeWeek;
    prototype__proto._week = defaultLocaleWeek;
    prototype__proto.firstDayOfYear = localeFirstDayOfYear;
    prototype__proto.firstDayOfWeek = localeFirstDayOfWeek;

    // Day of Week
    prototype__proto.weekdays       =        localeWeekdays;
    prototype__proto._weekdays      = defaultLocaleWeekdays;
    prototype__proto.weekdaysMin    =        localeWeekdaysMin;
    prototype__proto._weekdaysMin   = defaultLocaleWeekdaysMin;
    prototype__proto.weekdaysShort  =        localeWeekdaysShort;
    prototype__proto._weekdaysShort = defaultLocaleWeekdaysShort;
    prototype__proto.weekdaysParse  =        localeWeekdaysParse;

    // Hours
    prototype__proto.isPM = localeIsPM;
    prototype__proto._meridiemParse = defaultLocaleMeridiemParse;
    prototype__proto.meridiem = localeMeridiem;

    function lists__get (format, index, field, setter) {
        var locale = locale_locales__getLocale();
        var utc = create_utc__createUTC().set(setter, index);
        return locale[field](utc, format);
    }

    function list (format, index, field, count, setter) {
        if (typeof format === 'number') {
            index = format;
            format = undefined;
        }

        format = format || '';

        if (index != null) {
            return lists__get(format, index, field, setter);
        }

        var i;
        var out = [];
        for (i = 0; i < count; i++) {
            out[i] = lists__get(format, i, field, setter);
        }
        return out;
    }

    function lists__listMonths (format, index) {
        return list(format, index, 'months', 12, 'month');
    }

    function lists__listMonthsShort (format, index) {
        return list(format, index, 'monthsShort', 12, 'month');
    }

    function lists__listWeekdays (format, index) {
        return list(format, index, 'weekdays', 7, 'day');
    }

    function lists__listWeekdaysShort (format, index) {
        return list(format, index, 'weekdaysShort', 7, 'day');
    }

    function lists__listWeekdaysMin (format, index) {
        return list(format, index, 'weekdaysMin', 7, 'day');
    }

    locale_locales__getSetGlobalLocale('en', {
        ordinalParse: /\d{1,2}(th|st|nd|rd)/,
        ordinal : function (number) {
            var b = number % 10,
                output = (toInt(number % 100 / 10) === 1) ? 'th' :
                (b === 1) ? 'st' :
                (b === 2) ? 'nd' :
                (b === 3) ? 'rd' : 'th';
            return number + output;
        }
    });

    // Side effect imports
    utils_hooks__hooks.lang = deprecate('moment.lang is deprecated. Use moment.locale instead.', locale_locales__getSetGlobalLocale);
    utils_hooks__hooks.langData = deprecate('moment.langData is deprecated. Use moment.localeData instead.', locale_locales__getLocale);

    var mathAbs = Math.abs;

    function duration_abs__abs () {
        var data           = this._data;

        this._milliseconds = mathAbs(this._milliseconds);
        this._days         = mathAbs(this._days);
        this._months       = mathAbs(this._months);

        data.milliseconds  = mathAbs(data.milliseconds);
        data.seconds       = mathAbs(data.seconds);
        data.minutes       = mathAbs(data.minutes);
        data.hours         = mathAbs(data.hours);
        data.months        = mathAbs(data.months);
        data.years         = mathAbs(data.years);

        return this;
    }

    function duration_add_subtract__addSubtract (duration, input, value, direction) {
        var other = create__createDuration(input, value);

        duration._milliseconds += direction * other._milliseconds;
        duration._days         += direction * other._days;
        duration._months       += direction * other._months;

        return duration._bubble();
    }

    // supports only 2.0-style add(1, 's') or add(duration)
    function duration_add_subtract__add (input, value) {
        return duration_add_subtract__addSubtract(this, input, value, 1);
    }

    // supports only 2.0-style subtract(1, 's') or subtract(duration)
    function duration_add_subtract__subtract (input, value) {
        return duration_add_subtract__addSubtract(this, input, value, -1);
    }

    function absCeil (number) {
        if (number < 0) {
            return Math.floor(number);
        } else {
            return Math.ceil(number);
        }
    }

    function bubble () {
        var milliseconds = this._milliseconds;
        var days         = this._days;
        var months       = this._months;
        var data         = this._data;
        var seconds, minutes, hours, years, monthsFromDays;

        // if we have a mix of positive and negative values, bubble down first
        // check: https://github.com/moment/moment/issues/2166
        if (!((milliseconds >= 0 && days >= 0 && months >= 0) ||
                (milliseconds <= 0 && days <= 0 && months <= 0))) {
            milliseconds += absCeil(monthsToDays(months) + days) * 864e5;
            days = 0;
            months = 0;
        }

        // The following code bubbles up values, see the tests for
        // examples of what that means.
        data.milliseconds = milliseconds % 1000;

        seconds           = absFloor(milliseconds / 1000);
        data.seconds      = seconds % 60;

        minutes           = absFloor(seconds / 60);
        data.minutes      = minutes % 60;

        hours             = absFloor(minutes / 60);
        data.hours        = hours % 24;

        days += absFloor(hours / 24);

        // convert days to months
        monthsFromDays = absFloor(daysToMonths(days));
        months += monthsFromDays;
        days -= absCeil(monthsToDays(monthsFromDays));

        // 12 months -> 1 year
        years = absFloor(months / 12);
        months %= 12;

        data.days   = days;
        data.months = months;
        data.years  = years;

        return this;
    }

    function daysToMonths (days) {
        // 400 years have 146097 days (taking into account leap year rules)
        // 400 years have 12 months === 4800
        return days * 4800 / 146097;
    }

    function monthsToDays (months) {
        // the reverse of daysToMonths
        return months * 146097 / 4800;
    }

    function as (units) {
        var days;
        var months;
        var milliseconds = this._milliseconds;

        units = normalizeUnits(units);

        if (units === 'month' || units === 'year') {
            days   = this._days   + milliseconds / 864e5;
            months = this._months + daysToMonths(days);
            return units === 'month' ? months : months / 12;
        } else {
            // handle milliseconds separately because of floating point math errors (issue #1867)
            days = this._days + Math.round(monthsToDays(this._months));
            switch (units) {
                case 'week'   : return days / 7     + milliseconds / 6048e5;
                case 'day'    : return days         + milliseconds / 864e5;
                case 'hour'   : return days * 24    + milliseconds / 36e5;
                case 'minute' : return days * 1440  + milliseconds / 6e4;
                case 'second' : return days * 86400 + milliseconds / 1000;
                // Math.floor prevents floating point math errors here
                case 'millisecond': return Math.floor(days * 864e5) + milliseconds;
                default: throw new Error('Unknown unit ' + units);
            }
        }
    }

    // TODO: Use this.as('ms')?
    function duration_as__valueOf () {
        return (
            this._milliseconds +
            this._days * 864e5 +
            (this._months % 12) * 2592e6 +
            toInt(this._months / 12) * 31536e6
        );
    }

    function makeAs (alias) {
        return function () {
            return this.as(alias);
        };
    }

    var asMilliseconds = makeAs('ms');
    var asSeconds      = makeAs('s');
    var asMinutes      = makeAs('m');
    var asHours        = makeAs('h');
    var asDays         = makeAs('d');
    var asWeeks        = makeAs('w');
    var asMonths       = makeAs('M');
    var asYears        = makeAs('y');

    function duration_get__get (units) {
        units = normalizeUnits(units);
        return this[units + 's']();
    }

    function makeGetter(name) {
        return function () {
            return this._data[name];
        };
    }

    var milliseconds = makeGetter('milliseconds');
    var seconds      = makeGetter('seconds');
    var minutes      = makeGetter('minutes');
    var hours        = makeGetter('hours');
    var days         = makeGetter('days');
    var months       = makeGetter('months');
    var years        = makeGetter('years');

    function weeks () {
        return absFloor(this.days() / 7);
    }

    var round = Math.round;
    var thresholds = {
        s: 45,  // seconds to minute
        m: 45,  // minutes to hour
        h: 22,  // hours to day
        d: 26,  // days to month
        M: 11   // months to year
    };

    // helper function for moment.fn.from, moment.fn.fromNow, and moment.duration.fn.humanize
    function substituteTimeAgo(string, number, withoutSuffix, isFuture, locale) {
        return locale.relativeTime(number || 1, !!withoutSuffix, string, isFuture);
    }

    function duration_humanize__relativeTime (posNegDuration, withoutSuffix, locale) {
        var duration = create__createDuration(posNegDuration).abs();
        var seconds  = round(duration.as('s'));
        var minutes  = round(duration.as('m'));
        var hours    = round(duration.as('h'));
        var days     = round(duration.as('d'));
        var months   = round(duration.as('M'));
        var years    = round(duration.as('y'));

        var a = seconds < thresholds.s && ['s', seconds]  ||
                minutes === 1          && ['m']           ||
                minutes < thresholds.m && ['mm', minutes] ||
                hours   === 1          && ['h']           ||
                hours   < thresholds.h && ['hh', hours]   ||
                days    === 1          && ['d']           ||
                days    < thresholds.d && ['dd', days]    ||
                months  === 1          && ['M']           ||
                months  < thresholds.M && ['MM', months]  ||
                years   === 1          && ['y']           || ['yy', years];

        a[2] = withoutSuffix;
        a[3] = +posNegDuration > 0;
        a[4] = locale;
        return substituteTimeAgo.apply(null, a);
    }

    // This function allows you to set a threshold for relative time strings
    function duration_humanize__getSetRelativeTimeThreshold (threshold, limit) {
        if (thresholds[threshold] === undefined) {
            return false;
        }
        if (limit === undefined) {
            return thresholds[threshold];
        }
        thresholds[threshold] = limit;
        return true;
    }

    function humanize (withSuffix) {
        var locale = this.localeData();
        var output = duration_humanize__relativeTime(this, !withSuffix, locale);

        if (withSuffix) {
            output = locale.pastFuture(+this, output);
        }

        return locale.postformat(output);
    }

    var iso_string__abs = Math.abs;

    function iso_string__toISOString() {
        // for ISO strings we do not use the normal bubbling rules:
        //  * milliseconds bubble up until they become hours
        //  * days do not bubble at all
        //  * months bubble up until they become years
        // This is because there is no context-free conversion between hours and days
        // (think of clock changes)
        // and also not between days and months (28-31 days per month)
        var seconds = iso_string__abs(this._milliseconds) / 1000;
        var days         = iso_string__abs(this._days);
        var months       = iso_string__abs(this._months);
        var minutes, hours, years;

        // 3600 seconds -> 60 minutes -> 1 hour
        minutes           = absFloor(seconds / 60);
        hours             = absFloor(minutes / 60);
        seconds %= 60;
        minutes %= 60;

        // 12 months -> 1 year
        years  = absFloor(months / 12);
        months %= 12;


        // inspired by https://github.com/dordille/moment-isoduration/blob/master/moment.isoduration.js
        var Y = years;
        var M = months;
        var D = days;
        var h = hours;
        var m = minutes;
        var s = seconds;
        var total = this.asSeconds();

        if (!total) {
            // this is the same as C#'s (Noda) and python (isodate)...
            // but not other JS (goog.date)
            return 'P0D';
        }

        return (total < 0 ? '-' : '') +
            'P' +
            (Y ? Y + 'Y' : '') +
            (M ? M + 'M' : '') +
            (D ? D + 'D' : '') +
            ((h || m || s) ? 'T' : '') +
            (h ? h + 'H' : '') +
            (m ? m + 'M' : '') +
            (s ? s + 'S' : '');
    }

    var duration_prototype__proto = Duration.prototype;

    duration_prototype__proto.abs            = duration_abs__abs;
    duration_prototype__proto.add            = duration_add_subtract__add;
    duration_prototype__proto.subtract       = duration_add_subtract__subtract;
    duration_prototype__proto.as             = as;
    duration_prototype__proto.asMilliseconds = asMilliseconds;
    duration_prototype__proto.asSeconds      = asSeconds;
    duration_prototype__proto.asMinutes      = asMinutes;
    duration_prototype__proto.asHours        = asHours;
    duration_prototype__proto.asDays         = asDays;
    duration_prototype__proto.asWeeks        = asWeeks;
    duration_prototype__proto.asMonths       = asMonths;
    duration_prototype__proto.asYears        = asYears;
    duration_prototype__proto.valueOf        = duration_as__valueOf;
    duration_prototype__proto._bubble        = bubble;
    duration_prototype__proto.get            = duration_get__get;
    duration_prototype__proto.milliseconds   = milliseconds;
    duration_prototype__proto.seconds        = seconds;
    duration_prototype__proto.minutes        = minutes;
    duration_prototype__proto.hours          = hours;
    duration_prototype__proto.days           = days;
    duration_prototype__proto.weeks          = weeks;
    duration_prototype__proto.months         = months;
    duration_prototype__proto.years          = years;
    duration_prototype__proto.humanize       = humanize;
    duration_prototype__proto.toISOString    = iso_string__toISOString;
    duration_prototype__proto.toString       = iso_string__toISOString;
    duration_prototype__proto.toJSON         = iso_string__toISOString;
    duration_prototype__proto.locale         = locale;
    duration_prototype__proto.localeData     = localeData;

    // Deprecations
    duration_prototype__proto.toIsoString = deprecate('toIsoString() is deprecated. Please use toISOString() instead (notice the capitals)', iso_string__toISOString);
    duration_prototype__proto.lang = lang;

    // Side effect imports

    addFormatToken('X', 0, 0, 'unix');
    addFormatToken('x', 0, 0, 'valueOf');

    // PARSING

    addRegexToken('x', matchSigned);
    addRegexToken('X', matchTimestamp);
    addParseToken('X', function (input, array, config) {
        config._d = new Date(parseFloat(input, 10) * 1000);
    });
    addParseToken('x', function (input, array, config) {
        config._d = new Date(toInt(input));
    });

    // Side effect imports


    utils_hooks__hooks.version = '2.10.6';

    setHookCallback(local__createLocal);

    utils_hooks__hooks.fn                    = momentPrototype;
    utils_hooks__hooks.min                   = min;
    utils_hooks__hooks.max                   = max;
    utils_hooks__hooks.utc                   = create_utc__createUTC;
    utils_hooks__hooks.unix                  = moment__createUnix;
    utils_hooks__hooks.months                = lists__listMonths;
    utils_hooks__hooks.isDate                = isDate;
    utils_hooks__hooks.locale                = locale_locales__getSetGlobalLocale;
    utils_hooks__hooks.invalid               = valid__createInvalid;
    utils_hooks__hooks.duration              = create__createDuration;
    utils_hooks__hooks.isMoment              = isMoment;
    utils_hooks__hooks.weekdays              = lists__listWeekdays;
    utils_hooks__hooks.parseZone             = moment__createInZone;
    utils_hooks__hooks.localeData            = locale_locales__getLocale;
    utils_hooks__hooks.isDuration            = isDuration;
    utils_hooks__hooks.monthsShort           = lists__listMonthsShort;
    utils_hooks__hooks.weekdaysMin           = lists__listWeekdaysMin;
    utils_hooks__hooks.defineLocale          = defineLocale;
    utils_hooks__hooks.weekdaysShort         = lists__listWeekdaysShort;
    utils_hooks__hooks.normalizeUnits        = normalizeUnits;
    utils_hooks__hooks.relativeTimeThreshold = duration_humanize__getSetRelativeTimeThreshold;

    var _moment = utils_hooks__hooks;

    return _moment;

}));
/*!
 * @license jquery-mutation-summary
 * Copyright © 2012, 2013, 2014, Joel Purra <http://joelpurra.com/>
 * Released under MIT, BSD and GPL license. Comply with at least one.
 *
 * A jQuery wrapper/plugin for mutation-summary, the DOM mutation-observers wrapper.
 * http://joelpurra.github.com/jquery-mutation-summary
 * 
 * "Mutation Summary is a JavaScript library that makes observing changes to the DOM fast, easy and safe."
 * http://code.google.com/p/mutation-summary/
 */

/*jslint white: true, browser: true*/
/*global jQuery, MutationSummary*/

(function($, global) {
    "use strict"; // jshint ;_;
    var tag = "JqueryMutationSummary",
        eventNamespace = "." + tag,
        JqueryMutationSummary = function(element, options) {
            this.$element = $(element);
            this.options = $.extend(true, {}, this.internalDefaults, $.fn.mutationSummary.defaults, options);
        },
        JqueryMutationSummaryInner = function($element, configuration) {
            this.$element = $element;
            this.configuration = configuration;
        },
        privateFunctions = {};

    $.extend(true, privateFunctions, {
        getConfiguration: function(callback, observeOwnChanges, queries) {
            var configuration;

            if ($.isFunction(callback)) {
                if ($.isArray(observeOwnChanges)) {
                    queries = observeOwnChanges;
                    observeOwnChanges = false;
                }

                configuration = {
                    callback: callback,
                    observeOwnChanges: observeOwnChanges === true,
                    queries: queries || []
                };
            } else {
                configuration = callback;
            }

            return configuration;
        }
    });

    JqueryMutationSummary.prototype = {

        constructor: JqueryMutationSummary

        ,
        internalDefaults: {
            mutationSummaries: []
        }

        ,
        connect: function(callback, observeOwnChanges, queries) {
            var configuration = privateFunctions.getConfiguration(callback, observeOwnChanges, queries);

            var inner = new JqueryMutationSummaryInner(this.$element, configuration);

            this.options.mutationSummaries.push(inner);

            inner.start();
        }

        ,
        disconnect: function(callback, observeOwnChanges, queries) {
            // Pass as reference to inner function
            var summaries = this.options.mutationSummaries;

            // If any parameters were passed, only disconnect any matching summaries
            $.each(summaries, function(index) {
                // Take care of deleted summaries
                if (this === undefined) {
                    return;
                }

                if (this.configurationMatches(callback, observeOwnChanges, queries)) {
                    this.stop();

                    delete summaries[index];
                }
            });
        }
    };

    JqueryMutationSummaryInner.prototype = {
        constructor: JqueryMutationSummaryInner

        ,
        getCallbackWrapper: function() {
            function callbackWrapper(summaries) {
                // Pass extra info in the callback, since it's so wrapped
                summaries.observer = this.observer;
                summaries.configuration = $.extend(true, {}, this.configuration);

                this.originalCallback(summaries);
            };

            return $.proxy(callbackWrapper, this);
        }

        ,
        configurationMatches: function(callback, observeOwnChanges, queries) {
            var matchWith = privateFunctions.getConfiguration(callback, observeOwnChanges, queries),
                isMatch = true;

            isMatch = isMatch && (callback === undefined || this.configuration.callback === matchWith.callback);
            isMatch = isMatch && (observeOwnChanges === undefined || this.configuration.observeOwnChanges === matchWith.observeOwnChanges);
            isMatch = isMatch && (queries === undefined || this.configuration.queries === matchWith.queries);

            return isMatch;
        }

        ,
        start: function() {
            var rawElement = this.$element.get(0);

            this.originalCallback = this.configuration.callback;
            this.wrappedCallback = this.getCallbackWrapper();
            this.wrappedConfiguration = $.extend(true, {}, this.configuration);

            if (this.$element.length === 1) {
                // mutation-summary fails if passing global
                if (rawElement !== global) {
                    this.wrappedConfiguration.rootNode = rawElement;
                }
            }

            this.wrappedConfiguration.callback = this.wrappedCallback;

            this.observer = new MutationSummary(this.wrappedConfiguration);
        }

        ,
        stop: function() {
            // Any changes from the last callback will be passed here
            // http://code.google.com/p/mutation-summary/wiki/APIReference#Methods
            var finalSummary = this.observer.disconnect();

            if (finalSummary !== undefined) {
                this.wrappedCallback(finalSummary);
            }

            delete this.observer;
        }
    };

    // Add jQuery method
    // $("#element").mutationSummary();
    // $("#element").mutationSummary("method", arguments);
    $.fn.extend({
        mutationSummary: function(option) {
            var callArguments = arguments;

            return this.each(function() {
                var $this = $(this),
                    data = $this.data(tag),
                    options = typeof option === "object" && option;

                // Store javascript object as element data
                if (!data) {
                    $this.data(tag, (data = new JqueryMutationSummary(this, options)));
                }

                // Pass arguments to methods
                if (typeof option === "string") {
                    data[option].apply(data, Array.prototype.slice.call(callArguments, 1));
                }
            });
        }
    });

    $.fn.mutationSummary.defaults = {};

    $.fn.mutationSummary.Constructor = JqueryMutationSummary;
}(jQuery, this));

/*
 * =============================================================
 * jQuery.utils
 * =============================================================
 *
 *
 *
 * Dependencies:
 * jQuery 2.0+
 *
 *
 */

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
    }
}(this, function () {
    var utils={};
    utils.datetime={

        isDate: function(obj){
            return (/Date/).test(Object.prototype.toString.call(obj)) && !isNaN(obj.getTime());
        },

        isLeapYear: function(year){
            return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
        },

        getDaysInMonth: function(year, month){
            return [31, this.isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
        },

        setToStartOfDay: function(date){
            if (this.isDate(date)) date.setHours(0,0,0,0);
        },

        compareDates: function(a,b){
            // weak date comparison (use setToStartOfDay(date) to ensure correct result)
            return a.getTime() === b.getTime();
        },

        /**
         *
         * @returns {string}
         */
        currentDate: function () {
            var currentDate = new Date();
            var day = currentDate.getDate();
            var month = currentDate.getMonth() + 1;
            var year = currentDate.getFullYear();
            return (month + '/' + day + '/' + year);
        }
    };

    utils.array={
        isArray: function(obj){
            return (/Array/).test(Object.prototype.toString.call(obj));
        },

        toStringFromArray:function(arr,index){
            var length=arr.length;
            var s='';
            for (var i=0;i<length;i++){
                if(index !==undefined){
                    if(i!==index){
                        s+=arr[i];

                    }
                }else{
                    s+=arr[i];
                }
            }
            return s;
        },

        toNamespaceFromArray:function(arr){
            var length=arr.length;
            var maxIndex=length-1;
            var s='';
            for (var i=0;i<length;i++){
                s+=arr[i].toString();
                if(i!==maxIndex){
                    s+='.';
                }
            }

            return s.toLowerCase();
        }
    };

    utils.string={
        dashToCamelCase:function(s){
            return s.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
        },

        random:function(){
            return Math.floor((Math.random()*100000)+1).toString();
        },

        camelCaseToArray: function(s){
            return s.match(/[A-Z]?[a-z]+/g);
        },

        tagNameToNamespace:function(s){
            s= s.replace(/-/g,'.');
            return s.toLowerCase();
        }
    };

    utils.color={
        rgb2hex: function(rgb){
            if (  rgb.search("rgb") == -1 ) {
                return rgb;
            }
            else if ( rgb == 'rgba(0, 0, 0, 0)' ) {
                return 'transparent';
            }
            else {
                rgb = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+))?\)$/);
                function hex(x) {
                    return ("0" + parseInt(x).toString(16)).slice(-2);
                }
                return "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
            }
        }
    };

    utils.url={
        /**
         *
         * @param ji {String}
         * @returns {String}
         */
        queryString: function (ji) {
            var hu = window.location.search.substring(1);
            var gy = hu.split("&");
            for (i = 0; i < gy.length; i++) {
                var ft = gy[i].split("=");
                if (ft[0] == ji) {
                    return ft[1];
                }
            }
            return null;
        },

        /**
         *
         * @returns {Array}
         */
        queryStringObjectArray: function () {
            var arr = [];
            var hu = window.location.search.substring(1);
            var gy = hu.split("&");
            for (i = 0; i < gy.length; i++) {
                var ft = gy[i].split("=");
                if (ft[0] == ji) {
                    return ft[1];
                }
                var obj = {};
                obj.prop = ft[0];
                obj.val = ft[1];
                arr.push(obj);
            }

            return arr;
        },

        /**
         *
         * @returns {Array}
         */
        queryStringFilterArray: function () {
            var arr = [];
            var hu = window.location.search.substring(1);
            var gy = hu.split("&");
            for (i = 0; i < gy.length; i++) {
                var ft = gy[i].split("=");
                var obj = {};
                obj.filter = ft[0];
                obj.val = ft[1];
                if (obj.filter != '') {
                    arr.push(obj);
                }

            }

            return arr;
        }
    };

    utils.image={
        /**
         *
         * @param img {Object}
         * @param data {Object}
         * @returns {Object}
         */
        aspectRatio: function (img, data) {
            var width = img.width();
            var height = img.height();
            var aRatio = height / width;
            data.aspectRatio = aRatio;
            if (typeof data.height != 'undefined') {
                data.width = parseInt((1 / aRatio) * data.height);
            } else if (typeof data.width != 'undefined') {
                data.height = parseInt(aRatio * data.width);
            }

            return data;
        }
    };


    $.utils = $.utils || {};
    $.extend($.utils, utils);

    /* String/Number prototypes  */
    String.prototype.toCamelCase=function(){
        return this.replace(/[-_]([a-z])/g, function (g) { return g[1].toUpperCase(); });
    };
    String.prototype.toTitleCase=function(){
        return this.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
    };
    String.prototype.toPixel = function(){
        var val=parseInt(this,10);
        val = val.toString() + 'px';
        return val;
    };
    String.prototype.toArrayFromCamelCase = function(){
        return this.match(/[A-Z]?[a-z]+/g);
    };
    String.prototype.toFloatPixel = function(){
        return this.toString() + 'px';
    };
    String.prototype.toInteger=function(){
        return parseInt(this.replace('px',''),10);
    };
    String.prototype.toMillisecond = function(){
        var val=parseInt(this,10);
        val = val.toString() + 'ms';
        return val;
    };
    String.prototype.toNode=function(){
        var parsed=$.parseHTML(this);
        if(parsed[0]){
            return parsed[0]
        }else{
            return null;
        }
    };
    Number.prototype.toPixel = function(){
        var val=parseInt(this,10);
        val = val.toString() + 'px';
        return val;
    };
    Number.prototype.toFloatPixel = function(){
        return this.toString() + 'px';
    };
    Number.prototype.toMillisecond = function(){
        var val=parseInt(this,10);
        val = val.toString() + 'ms';
        return val;
    };




    /**
     * replaces an element's class based on a wildcard pattern
     * @param removals {String}
     * @param additions {String}
     * @returns {Object}
     * @public
     *
     * ex: average rating
     *     $span.alterClass('icon-star-*', 'icon-star-3');
     *     $span.icon-star-2 => $span.icon-star-3
     */
    $.fn.alterClass = function ( removals, additions ) {

        var self = this;

        if ( removals.indexOf( '*' ) === -1 ) {
            // Use native jQuery methods if there is no wildcard matching
            self.removeClass( removals );
            return !additions ? self : self.addClass( additions );
        }

        var patt = new RegExp( '\\s' +
            removals.
                replace( /\*/g, '[A-Za-z0-9-_]+' ).
                split( ' ' ).
                join( '\\s|\\s' ) +
            '\\s', 'g' );

        self.each( function ( i, it ) {
            var cn = ' ' + it.className + ' ';
            while ( patt.test( cn ) ) {
                cn = cn.replace( patt, ' ' );
            }
            it.className = $.trim( cn );
        });

        return !additions ? self : self.addClass( additions );
    };

    /**
     * extends jQuery 'find' to additionally filter the jQuery object against the selector
     * example uses: querying mutation records
     * @param selector {String}
     * @returns {Object}
     * @public
     */
    $.fn.selfFind = function(selector) {
        return this.find(selector).add(this.filter(selector))
    };

    /**
     * clear select list
     * @param opts
     * @returns {$.fn}
     */
    $.fn.clearSelect=function(opts){
        (typeof opts.defaultOption ==='undefined') ? this.children.remove() : this.children('option:not(:first)').remove();
        return this;

    };

    $.fn.findTextNodes=function(){
        return this.contents().filter(function(){return this.nodeType===3});
    };

    $.fn.findTextNodeDescendants=function(){
        return this.find('*').contents().filter(function(){return this.nodeType===3});
    };

    //no chaining
    $.fn.isVisible=function(){
        var _isVisible=this.is(':visible');
        var visibility=this.css( 'visibility');
        return(_isVisible && visibility==='visible');
    };

    //no chaining
    $.fn.query=function(selector,callback) {
        var self = this;
        var count = 0;
        var result = this.find(selector);
        if (result[0]) {
            callback(result);
        }
        var timeOutId = setInterval(function () {
            result = self.find(selector);
            if (result[0] || (count > 4)) {
                clearInterval(timeOutId);
                callback(result);
            } else count++;
        }, 500);
    };

    $.fn.detachClass=function(klass){
        return this.each(function(){
            if($(this).length===1){
                $(this).removeClass(klass);
            }else if($(this).length>1){
                $.each($(this),function(index,node){
                    $(node).removeClass(klass);
                });
            }
        });

    };

    //no chaining
    $.fn.removeAnimation=function(interval,f){
        var element=this;
        var g=function(){ element.removeClass('hide-important')};
        setTimeout(function(){
            element.addClass('hide-important');
            f();
            setTimeout(g,100);
        },interval);
    };

    //no chaining
    $.fn.timeout=function(interval,f){
        setTimeout(function(){
            f();
        },interval);
    };

    /**
     *  returns first matched children in an iterative children query as "children"
     * @param selector
     * @returns {*|jQuery|HTMLElement}
     */
    $.fn.closestChildren=function(selector){
        if (!selector || selector === '') {
            return $();
        }
        var result=$();
        this.each(function() {
            var $this = $(this);
            var queue = [];
            queue.push($this);
            while (queue.length > 0) {
                var node = queue.shift();
                var children = node.children();
                for (var i = 0; i < children.length; ++i) {
                    var $child = $(children[i]);
                    if ($child.is(selector)) {
                        result=children;
                        return false;
                    } else {
                        queue.push($child);
                    }
                }
            }
        });
        var elements = [];
        $.each(result, function (index, element) {
            if ($(element).is(selector)) {
                elements.push(element);
            }
        });
        return $(elements);
    };

    //no chaining
    $.fn.hasAttr=function(attr){
        return this[0].hasAttribute(attr);
    };


    return $;


}));

/*
 * =============================================================
 * $.browser
 * =============================================================
 *
 * replaces the deprecated jQuery.browser that has now been removed from jQuery 1.9+
 *
 *
 * Dependencies:
 * jQuery 2.0 +
 *
 *
 */

(function (root, factory) {
	if (typeof module !== 'undefined' && module.exports) {
		//commonjs
		module.exports = factory();
	} else if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define([], factory);
	} else {
		// Browser globals (root is window)
		root.returnExports = factory();
	}
}(this, function () {
	var browser = {};
	browser.mozilla = false;
	browser.webkit = false;
	browser.opera = false;
	browser.msie = false;

	var nAgt = navigator.userAgent;
	browser.name = navigator.appName;
	browser.fullVersion = '' + parseFloat(navigator.appVersion);
	browser.majorVersion = parseInt(navigator.appVersion, 10);
	var nameOffset, verOffset, ix;

	// Opera
	if ((verOffset = nAgt.indexOf("Opera")) != -1) {
		browser.opera = true;
		browser.name = "Opera";
		browser.fullVersion = nAgt.substring(verOffset + 6);
		if ((verOffset = nAgt.indexOf("Version")) != -1)
			browser.fullVersion = nAgt.substring(verOffset + 8);
	}
		// MSIE
	else if ((verOffset = nAgt.indexOf("MSIE")) != -1) {
		browser.msie = true;
		browser.name = "Microsoft Internet Explorer";
		browser.fullVersion = nAgt.substring(verOffset + 5);
	}
		// Chrome
	else if ((verOffset = nAgt.indexOf("Chrome")) != -1) {
		browser.webkit = true;
		browser.name = "Chrome";
		browser.fullVersion = nAgt.substring(verOffset + 7);
	}
		// Safari
	else if ((verOffset = nAgt.indexOf("Safari")) != -1) {
		browser.webkit = true;
		browser.name = "Safari";
		browser.fullVersion = nAgt.substring(verOffset + 7);
		if ((verOffset = nAgt.indexOf("Version")) != -1)
			browser.fullVersion = nAgt.substring(verOffset + 8);
	}
		// Firefox
	else if ((verOffset = nAgt.indexOf("Firefox")) != -1) {
		browser.mozilla = true;
		browser.name = "Firefox";
		browser.fullVersion = nAgt.substring(verOffset + 8);
	}
		// Other
	else if ((nameOffset = nAgt.lastIndexOf(' ') + 1) <
        (verOffset = nAgt.lastIndexOf('/'))) {
		browser.name = nAgt.substring(nameOffset, verOffset);
		browser.fullVersion = nAgt.substring(verOffset + 1);
		if (browser.name.toLowerCase() === browser.name.toUpperCase()) {
			browser.name = navigator.appName;
		}
	} else if (nAgt.indexOf('Mozilla') !== -1 && nAgt.indexOf('Firefox') === -1) {
		browser.msie = true;
		browser.name = "Internet Explorer";
		browser.fullVersion = '11';
	}
	// trim the fullVersion string at semicolon/space if present
	if ((ix = browser.fullVersion.indexOf(";")) != -1)
		browser.fullVersion = browser.fullVersion.substring(0, ix);
	if ((ix = browser.fullVersion.indexOf(" ")) != -1)
		browser.fullVersion = browser.fullVersion.substring(0, ix);

	browser.majorVersion = parseInt('' + browser.fullVersion, 10);
	if (isNaN(browser.majorVersion)) {
		browser.fullVersion = '' + parseFloat(navigator.appVersion);
		browser.majorVersion = parseInt(navigator.appVersion, 10);
	}
	browser.version = browser.majorVersion;

	$.browser = $.browser || {};
	$.extend($.browser, browser);
	return $;


}));

/*
 * =============================================================
 * $.device
 * =============================================================
 *
 * Dependencies:
 * jQuery 2.0+
 *
 */

//umd pattern

(function (root, factory) {
	if (typeof module !== 'undefined' && module.exports) {
		//commonjs
		module.exports = factory();
	} else if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define([], factory);
	} else {
		// Browser globals (root is window)
		root.returnExports = factory();
	}
}(this, function () {
	var TABLET_MIN_WIDTH = 661;
	var device = {};
	device.touch = $.support.touch || 'ontouchend' in document;
	device.android = false;
	device.iphone = false;
	device.ipad = false;
	device.ipod = false;
	device.ios = false;
	device.webos = false;
	device.blackberry = false;
	device.smartphone = false;
	device.tablet = false;
	device.retina = false;


	if (/Android/.test(navigator.userAgent)) {
		device.android = device.touch;

	} else if (/iPhone/.test(navigator.userAgent)) {
		device.iphone = device.touch;

	} else if (/iPad/.test(navigator.userAgent)) {
		device.ipad = device.touch;

	} else if (/iPod/.test(navigator.userAgent)) {
		device.ipod = device.touch;

	} else if (/webOS/.test(navigator.userAgent)) {
		device.webos = device.touch;

	} else if (/BlackBerry/.test(navigator.userAgent)) {
		device.blackberry = device.touch;

	}
	if ((device.iphone) || (device.ipad) || (device.ipod)) {
		device.ios = true;
	}


	Object.defineProperties(device, {
		'viewport': {
			/**
             * getter
             *
             * @returns {{width: *, height: *}}
             */
			get: function () {
				var width = _getScreenWidth();
				var height = _getScreenHeight();
				return {
					width: width,
					height: height
				};
			},
			configurable: false

		},

		'orientation': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var width = _getScreenWidth();
				var height = _getScreenHeight();
				return (height > width) ? 'portrait' : 'landscape';
			},
			configurable: false

		},

		/**
         * getter
         * @returns {string}
         */
		'orientationEvent': {
			get: function () {
				var supportsOrientationChange = "onorientationchange" in window,
                    orientationEvent = supportsOrientationChange ? 'orientationchange' : 'resize';

				return orientationEvent;
			}
		}
	});


	if (window.devicePixelRatio > 1) {
		device.retina = true;
	}
	if ((_getScreenHeight() > TABLET_MIN_WIDTH) || (_getScreenWidth() > TABLET_MIN_WIDTH)) {
		device.tablet = true;
		device.smartphone = false;
	} else {
		device.tablet = false;
		device.smartphone = true;
	}
	if (!device.touch) {
		device.tablet = false;
		device.smartphone = false;
	}

	

	//private

	/**
     *
     * @returns {Number|*|jQuery}
     * @private
     */
	function _getScreenHeight() {
		return window.innerHeight || $(window).height();
	}

	/**
     *
     * @returns {Number|*|jQuery}
     * @private
     */
	function _getScreenWidth() {
		return window.innerWidth || $(window).width();
	}
	$.device = $.device || {};
	$.extend($.device, device);
	return $;


}));


/*
 * =============================================================
 * $.device.mq
 * =============================================================
 *
 * Dependencies:
 * jQuery 2.0+
 *
 */

//umd pattern

(function (root, factory) {
	if (typeof module !== 'undefined' && module.exports) {
		//commonjs
		module.exports = factory();
	} else if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define([], factory);
	} else {
		// Browser globals (root is window)
		root.returnExports = factory();
	}
}(this, function () {
	var mq = {};
	var MQ_TOUCH_MAX_WIDTH = 1024;
	var MQ_TOUCH_MIN_WIDTH = 320;
	var MQ_SMARTPHONE_MAX_WIDTH = 640;
	var MQ_TABLET_MIN_WIDTH = 641;

	Object.defineProperties(mq, {
		'touch': {
			/**
             * getter
             *
             * @returns {boolean}
             */
			get: function () {
				return ($.device.viewport.width <= MQ_TOUCH_MAX_WIDTH);
			},
			configurable: false

		},

		'smartphone': {
			/**
             * getter
             *
             * @returns {boolean}
             */
			get: function () {
				return ($.touch.device.viewport.width <= MQ_SMARTPHONE_MAX_WIDTH);
			},
			configurable: false

		},

		'touchQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_TOUCH_MAX_WIDTH + 'px) and (min-width:' + MQ_TOUCH_MIN_WIDTH + 'px)';
				return mediaQuery;
			},
			configurable: false

		},

		'touchLandscapeQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_TOUCH_MAX_WIDTH + 'px) and (min-width:' + MQ_TOUCH_MIN_WIDTH + 'px) and (orientation:landscape)';
				return mediaQuery;
			},
			configurable: false

		},

		'touchPortraitQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_TOUCH_MAX_WIDTH + 'px) and (min-width:' + MQ_TOUCH_MIN_WIDTH + 'px) and (orientation:portrait)';
				return mediaQuery;
			},
			configurable: false

		},

		'tabletQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + (MQ_TOUCH_MAX_WIDTH - 1) + 'px) and (min-width:' + MQ_TABLET_MIN_WIDTH + 'px)';
				return mediaQuery;
			},
			configurable: false

		},

		'tabletLandscapeQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_TOUCH_MAX_WIDTH + 'px) and (min-width:' + MQ_TABLET_MIN_WIDTH + 'px) and (orientation:landscape)';
				return mediaQuery;
			},
			configurable: false

		},

		'tabletPortraitQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_TOUCH_MAX_WIDTH + 'px) and (min-width:' + MQ_TABLET_MIN_WIDTH + 'px) and (orientation:portrait)';
				return mediaQuery;
			},
			configurable: false

		},

		'smartPhoneQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_SMARTPHONE_MAX_WIDTH + 'px)';
				return mediaQuery;
			},
			configurable: false

		},

		'smartPhoneLandscapeQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_SMARTPHONE_MAX_WIDTH + 'px) and (orientation:landscape)';
				return mediaQuery;
			},
			configurable: false

		},

		'smartPhonePortraitQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(max-width:' + MQ_SMARTPHONE_MAX_WIDTH + 'px) and (orientation:portrait)';
				return mediaQuery;
			},
			configurable: false

		},

		'landscapeQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(orientation:landscape)';
				return mediaQuery;
			},
			configurable: false

		},

		'portraitQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var mediaQuery = '(orientation:portrait)';
				return mediaQuery;
			},
			configurable: false

		},

		'desktopQuery': {
			/**
             * getter
             *
             * @returns {string}
             */
			get: function () {
				var desktopMinWidth = MQ_TOUCH_MAX_WIDTH + 1;
				var mediaQuery = '(min-width:' + desktopMinWidth + 'px)';
				return mediaQuery;
			},
			configurable: false

		}


	});

	$.device = $.device || {};
	$.device.mq = mq;

	return $;

}));

/*
 * =============================================================
 * jQuery.support
 * =============================================================
 *
 * almost all tests adopted from Modernizr
 *
 *
 *
 * Dependencies:
 * jQuery 2.0+
 *
 *
 */
(function (root, factory) {
	if (typeof module !== 'undefined' && module.exports) {
		//commonjs
		module.exports = factory();
	} else if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define([], factory);
	} else {
		// Browser globals (root is window)
		root.returnExports = factory();
	}
}(this, function () {
	var support = {},


        docElement = document.documentElement,

        mod = 'elliptical',

        modElem = document.createElement(mod),

        mStyle = modElem.style,

        toString = {}.toString,

        prefixes = ' -webkit- -moz- -o- -ms- '.split(' '),

        omPrefixes = 'Webkit Moz O ms',

        cssomPrefixes = omPrefixes.split(' '),

        domPrefixes = omPrefixes.toLowerCase().split(' '),

        ns = { 'svg': 'http://www.w3.org/2000/svg' },

        classes = [],

        slice = classes.slice,

        featureName,
        injectElementWithStyles = function (rule, callback, nodes, testnames) {

        	var style, ret, node, docOverflow,
                div = document.createElement('div'),
                body = document.body,
                fakeBody = body || document.createElement('body');

        	if (parseInt(nodes, 10)) {
        		while (nodes--) {
        			node = document.createElement('div');
        			node.id = testnames ? testnames[nodes] : mod + (nodes + 1);
        			div.appendChild(node);
        		}
        	}

        	style = ['&#173;', '<style id="s', mod, '">', rule, '</style>'].join('');
        	div.id = mod;
        	(body ? div : fakeBody).innerHTML += style;
        	fakeBody.appendChild(div);
        	if (!body) {
        		fakeBody.style.background = '';
        		fakeBody.style.overflow = 'hidden';
        		docOverflow = docElement.style.overflow;
        		docElement.style.overflow = 'hidden';
        		docElement.appendChild(fakeBody);
        	}

        	ret = callback(div, rule);
        	if (!body) {
        		fakeBody.parentNode.removeChild(fakeBody);
        		docElement.style.overflow = docOverflow;
        	} else {
        		div.parentNode.removeChild(div);
        	}

        	return !!ret;

        },

        testMediaQuery = function (mq) {

        	var matchMedia = window.matchMedia || window.msMatchMedia;
        	if (matchMedia) {
        		return matchMedia(mq).matches;
        	}

        	var bool;

        	injectElementWithStyles('@media ' + mq + ' { #' + mod + ' { position: absolute; } }', function (node) {
        		bool = (window.getComputedStyle ?
                    getComputedStyle(node, null) :
                    node.currentStyle)['position'] == 'absolute';
        	});

        	return bool;

        },



        _hasOwnProperty = ({}).hasOwnProperty, hasOwnProp;

	function setCss(str) {
		mStyle.cssText = str;
	}

	function setCssAll(str1, str2) {
		return setCss(prefixes.join(str1 + ';') + (str2 || ''));
	}

	function is(obj, type) {
		return typeof obj === type;
	}

	function contains(str, substr) {
		return !!~('' + str).indexOf(substr);
	}

	function testProps(props, prefixed) {
		for (var i in props) {
			var prop = props[i];
			if (!contains(prop, "-") && mStyle[prop] !== undefined) {
				return prefixed == 'pfx' ? prop : true;
			}
		}
		return false;
	}

	function testDOMProps(props, obj, elem) {
		for (var i in props) {
			var item = obj[props[i]];
			if (item !== undefined) {

				if (elem === false) {
					return props[i];
				}

				if (is(item, 'function')) {
					return item.bind(elem || obj);
				}

				return item;
			}
		}
		return false;
	}

	function prefixed(prop, obj, elem) {
		if (!obj) {
			return testPropsAll(prop, 'pfx');
		} else {
			return testPropsAll(prop, obj, elem);
		}
	}

	function testPropsAll(prop, prefixed, elem) {

		var ucProp = prop.charAt(0).toUpperCase() + prop.slice(1),
            props = (prop + ' ' + cssomPrefixes.join(ucProp + ' ') + ucProp).split(' ');

		if (is(prefixed, "string") || is(prefixed, "undefined")) {
			return testProps(props, prefixed);

		} else {
			props = (prop + ' ' + (domPrefixes).join(ucProp + ' ') + ucProp).split(' ');
			return testDOMProps(props, prefixed, elem);
		}
	}

	support.orientation = testOrientation();
	function testOrientation() {
	    return ("orientation" in window && "onorientationchange" in window);
	}
	

	//touch
	support.touch = testTouch();
	function testTouch() {
		var bool;

		if (('ontouchstart' in window) || window.DocumentTouch && document instanceof DocumentTouch) {
			bool = true;
		} else {
			injectElementWithStyles(['@media (', prefixes.join('touch-enabled),('), mod, ')', '{#elliptical{top:9px;position:absolute}}'].join(''), function (node) {
				bool = node.offsetTop === 9;
			});
		}

		return bool;
	}

	//canvas
	support.canvas = testCanvas();
	function testCanvas() {
		var elem = document.createElement('canvas');
		return !!(elem.getContext && elem.getContext('2d'));

	}

	//geolocation
	support.geolocation = testGeolocation();
	function testGeolocation() {
		return 'geolocation' in navigator;
	}

	//history
	support.history = testHistory();
	function testHistory() {
		return !!(window.history && history.pushState);
	}

	//dragdrop
	support.dragdrop = testDragDrop();
	function testDragDrop() {
		var div = document.createElement('div');
		return ('draggable' in div) || ('ondragstart' in div && 'ondrop' in div);
	}

	//websockets
	support.websockets = testWebSockets();
	function testWebSockets() {
		return 'WebSocket' in window || 'MozWebSocket' in window;
	}

	//css3dtransforms
	support.css3dtransforms = testCSSTransform3d();
	function testCSSTransform3d() {
		var ret = !!testPropsAll('perspective');

		if (ret && 'webkitPerspective' in docElement.style) {

			injectElementWithStyles('@media (transform-3d),(-webkit-transform-3d){#elliptical{left:9px;position:absolute;height:3px;}}', function (node, rule) {
				ret = node.offsetLeft === 9 && node.offsetHeight === 3;
			});
		}
		return ret;

	}

	//video
	support.video = testVideo();
	function testVideo() {
		var elem = document.createElement('video'),
            bool = false;

		try {
			if (bool = !!elem.canPlayType) {
				bool = new Boolean(bool);
				bool.ogg = elem.canPlayType('video/ogg; codecs="theora"').replace(/^no$/, '');

				bool.h264 = elem.canPlayType('video/mp4; codecs="avc1.42E01E"').replace(/^no$/, '');

				bool.webm = elem.canPlayType('video/webm; codecs="vp8, vorbis"').replace(/^no$/, '');
			}

		} catch (e) {
		}

		return bool;
	}

	//audio
	support.audio = testAudio();
	function testAudio() {
		var elem = document.createElement('audio'),
            bool = false;

		try {
			if (bool = !!elem.canPlayType) {
				bool = new Boolean(bool);
				bool.ogg = elem.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, '');
				bool.mp3 = elem.canPlayType('audio/mpeg;').replace(/^no$/, '');

				bool.wav = elem.canPlayType('audio/wav; codecs="1"').replace(/^no$/, '');
				bool.m4a = (elem.canPlayType('audio/x-m4a;') ||
                    elem.canPlayType('audio/aac;')).replace(/^no$/, '');
			}
		} catch (e) {
		}

		return bool;
	}

	//localstorage
	support.localstorage = testLocalStorage();
	function testLocalStorage() {
		try {
			localStorage.setItem(mod, mod);
			localStorage.removeItem(mod);
			return true;
		} catch (e) {
			return false;
		}
	}

	//sessionstorage
	support.sessionstorage = testSessionStorage();
	function testSessionStorage() {
		try {
			sessionStorage.setItem(mod, mod);
			sessionStorage.removeItem(mod);
			return true;
		} catch (e) {
			return false;
		}
	}

	//web workers
	support.webworkers = testWebWorkers();
	function testWebWorkers() {
		return !!window.Worker;
	}

	//application cache
	support.applicationcache = testApplicationCache();
	function testApplicationCache() {
		return !!window.applicationCache;
	}

	//svg
	support.svg = testSVG();
	function testSVG() {
		return !!document.createElementNS && !!document.createElementNS(ns.svg, 'svg').createSVGRect;
	}

	//inline svg
	support.inlinesvg = testInlineSVG();
	function testInlineSVG() {
		var div = document.createElement('div');
		div.innerHTML = '<svg/>';
		return (div.firstChild && div.firstChild.namespaceURI) == ns.svg;
	}

	//svg clip paths
	support.svgclippaths = testSVGClipPaths();
	function testSVGClipPaths() {
		return !!document.createElementNS && /SVGClipPath/.test(toString.call(document.createElementNS(ns.svg, 'clipPath')));
	}

	//webkit background clip
	support.backgroundclip = testBackgroundClip();
	function testBackgroundClip() {

		if (/Android/.test(navigator.userAgent)) {
			return false;
		}
		var ele = document.createElement("elliptical");
		var ret = ((typeof ele.style.webkitBackgroundClip !== 'undefined') && (ele.style.webkitBackgroundClip = 'text'));
		var textSupport = ele.style.webkitBackgroundClip == 'text';
		return textSupport;

	}

	//content editable
	support.contenteditbale = testContentEditable();
	function testContentEditable() {
		return 'contentEditable' in document.documentElement;
	}

	//overflow scrolling
	support.overflowscrolling = testOverflowScrolling();
	function testOverflowScrolling() {
		return testPropsAll('overflowScrolling');
	}

	//css resize
	support.cssresize = testResize();
	function testResize() {
		return testPropsAll('resize');
	}

	//css flexwrap
	support.flexwrap = testFlexWrap();
	function testFlexWrap() {
		return testPropsAll('flexWrap');
	}

	//postmessage
	support.postmessage = testPostMessage();
	function testPostMessage() {
		return !!window.postMessage;
	}

	//dataview
	support.dataview = testDataView();
	function testDataView() {
		return (typeof DataView !== 'undefined' && 'getFloat64' in DataView.prototype);
	}

	//dataset
	support.dataset = testDataSet();
	function testDataSet() {
		var n = document.createElement("div");
		n.setAttribute("data-a-b", "c");
		return !!(n.dataset && n.dataset.aB === "c");
	}

	//progressbar
	support.progressbar = testProgressBar();
	function testProgressBar() {
		return document.createElement('progress').max !== undefined;
	}

	//meter
	support.meter = testMeter();
	function testMeter() {
		return document.createElement('meter').max !== undefined;
	}

	//filesystem
	support.filesystem = testFilesystem();
	function testFilesystem() {
		return !!prefixed('requestFileSystem', window);
	}

	//filereader
	support.filereader = testFileReader();
	function testFileReader() {
		return !!(window.File && window.FileList && window.FileReader);
	}

	//fullscreen
	support.fullscreen = testFullScreen();
	function testFullScreen() {
		for (var i = 0; i < domPrefixes.length; i++) {
			if (document[domPrefixes[i].toLowerCase() + 'CancelFullScreen']) {
				return true;
			}

		}
		return !!document['cancelFullScreen'] || false;
	}

	//cors
	support.cors = testCors();
	function testCors() {
		return !!(window.XMLHttpRequest && 'withCredentials' in new XMLHttpRequest());
	}

	//battery
	support.battery = testBattery();
	function testBattery() {
		return !!prefixed('battery', navigator);
	}

	//low battery
	support.lowbattery = testLowBattery();
	function testLowBattery() {
		var minLevel = 0.20,
            battery = prefixed('battery', navigator);
		return !!(battery && !battery.charging && battery.level <= minLevel);
	}

	//flexbox
	support.flexbox = testFlexbox();
	function testFlexbox() {
		return testPropsAll('flexWrap');
	}

	//indexedDB
	support.indexeddb = testIndexedDB();
	function testIndexedDB() {
		return !!testPropsAll("indexedDB", window);
	}

	//hsla
	support.hsla = hsla();
	function hsla() {
		setCss('background-color:hsla(120,40%,100%,.5)');
		return contains(mStyle.backgroundColor, 'rgba') || contains(mStyle.backgroundColor, 'hsla');
	}

	//multiple backgrounds
	support.multiplebgs = multiplebgs();
	function multiplebgs() {
		setCss('background:url(https://),url(https://),red url(https://)');
		return (/(url\s*\(.*?){3}/).test(mStyle.background);
	}

	//css columns
	support.csscolumns = cssColumns();
	function cssColumns() {
		return testPropsAll('columnCount');
	}

	//css reflections
	support.cssreflections = cssReflections();
	function cssReflections() {
		return testPropsAll('boxReflect');
	}

    //devicemotion
	support.devicemotion = testDeviceMotion();
	function testDeviceMotion() {
	    return 'DeviceMotionEvent' in window;
	}

    //deviceorientation
	support.deviceorientation = testDeviceOrientation();
	function testDeviceOrientation() {
	    return 'DeviceOrientationEvent' in window;
	}

    //connectiontype (note buggy) bugs.webkit.org/show_bug.cgi?id=73528
	support.connectiontype = testConnectionType();
	function testConnectionType() {
	    var connection = navigator.connection || { type: 0 };
	    return connection.type;
	}

    //lowbandwidth (note buggy) bugs.webkit.org/show_bug.cgi?id=73528
	support.lowbandwidth = testLowBandwidth();
	function testLowBandwidth() {
	    var connection = navigator.connection || { type: 0 };

	    return connection.type == 3 || // connection.CELL_2G
            connection.type == 4 || // connection.CELL_3G
            /^[23]g$/.test(connection.type);
	}


	//form validation
	support.formvalidation = testFormValidation();
	function testFormValidation() {
		var form = document.createElement('form');
		if (!('checkValidity' in form)) {
			return false;
		}
		var body = document.body,

            html = document.documentElement,

            bodyFaked = false,

            invaildFired = false,

            input,

            formvalidationapi = true;

		// Prevent form from being submitted
		form.onsubmit = function (e) {
			//Opera does not validate form, if submit is prevented
			if (!window.opera) {
				e.preventDefault();
			}
			e.stopPropagation();
		};

		// Calling form.submit() doesn't trigger interactive validation,
		// use a submit button instead
		//older opera browsers need a name attribute
		form.innerHTML = '<input name="modTest" required><button></button>';

		// FF4 doesn't trigger "invalid" event if form is not in the DOM tree
		// Chrome throws error if invalid input is not visible when submitting
		form.style.position = 'absolute';
		form.style.top = '-99999em';

		// We might in <head> in which case we need to create body manually
		if (!body) {
			bodyFaked = true;
			body = document.createElement('body');
			//avoid crashing IE8, if background image is used
			body.style.background = "";
			html.appendChild(body);
		}

		body.appendChild(form);

		input = form.getElementsByTagName('input')[0];

		// Record whether "invalid" event is fired
		input.oninvalid = function (e) {
			invaildFired = true;
			e.preventDefault();
			e.stopPropagation();
		};

		//presto Opera does not fully support the validationMessage property
		var formvalidationmessage = !!input.validationMessage;

		// Submit form by clicking submit button
		form.getElementsByTagName('button')[0].click();

		// Don't forget to clean up
		body.removeChild(form);
		bodyFaked && html.removeChild(body);

		return invaildFired;
	}
	support.init = function () {
		var html = $('html');
		html.removeClass('no-js');
		html.addClass('js');
		var tests = ['touch', 'canvas', 'svg', 'history', 'formvalidation', 'localstorage', 'sessionstorage', 'meter', 'backgroundclip', 'inlinesvg',
            'svgclippaths', 'css3dtransforms', 'video', 'audio', 'progressbar', 'cssresize', 'postmessage', 'overflowscrolling', 'flexbox',
            'indexeddb', 'hsla', 'multiplebgs', 'csscolumns', 'cssreflections', 'flexwrap'];

		tests.forEach(function (t) {
			support[t] ? html.addClass(t) : html.addClass('no-' + t);
		});

		

	};

	support.stickyFooter = function () {
		if ($.browser.msie) {
			var stickyFooter = $('.ui-sticky-footer');
			if (stickyFooter[0]) {
				stickyFooter.addClass('ns');
			}
		}


	};


	support.init();
	support.stickyFooter();
	$.support = $.support || {};
	$.extend($.support, support);

	return $;

}));

/*
 * =============================================================
 * jQuery.transition
 * =============================================================
 *
 * culled in large part from https://github.com/rstacruz/jquery.transit/
 *
 */

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
    }
}(this, function () {

    $.transit = {

        // Map of $.css() keys to values for 'transitionProperty'.
        // See https://developer.mozilla.org/en/CSS/CSS_transitions#Properties_that_can_be_animated
        propertyMap: {
            marginLeft: 'margin',
            marginRight: 'margin',
            marginBottom: 'margin',
            marginTop: 'margin',
            paddingLeft: 'padding',
            paddingRight: 'padding',
            paddingBottom: 'padding',
            paddingTop: 'padding'
        },

        // Will simply transition "instantly" if false
        enabled: true,

        // Set this to false if you don't want to use the transition end property.
        useTransitionEnd: false
    };

    var div = document.createElement('div');
    var support = {};

    // Helper function to get the proper vendor property name.
    // (`transition` => `WebkitTransition`)
    function getVendorPropertyName(prop) {
        var prefixes = ['Moz', 'Webkit', 'O', 'ms'];
        var prop_ = prop.charAt(0).toUpperCase() + prop.substr(1);

        if (prop in div.style) { return prop; }

        for (var i = 0; i < prefixes.length; ++i) {
            var vendorProp = prefixes[i] + prop_;
            if (vendorProp in div.style) { return vendorProp; }
        }
    }

    // Helper function to check if transform3D is supported.
    // Should return true for Webkits and Firefox 10+.
    function checkTransform3dSupport() {
        div.style[support.transform] = '';
        div.style[support.transform] = 'rotateY(90deg)';
        return div.style[support.transform] !== '';
    }

    var isChrome = navigator.userAgent.toLowerCase().indexOf('chrome') > -1;

    // Check for the browser's transitions support.
    // You can access this in jQuery's `$.support.transition`.
    // As per [jQuery's cssHooks documentation](http://api.jquery.com/jQuery.cssHooks/),
    // we set $.support.transition to a string of the actual property name used.
    support.transition = getVendorPropertyName('transition');
    support.transitionDelay = getVendorPropertyName('transitionDelay');
    support.transform = getVendorPropertyName('transform');
    support.transformOrigin = getVendorPropertyName('transformOrigin');
    support.transform3d = checkTransform3dSupport();

    $.extend($.support, support);

    var eventNames = {
        'MozTransition': 'transitionend',
        'OTransition': 'oTransitionEnd',
        'WebkitTransition': 'webkitTransitionEnd',
        'msTransition': 'MSTransitionEnd'
    };

    // Detect the 'transitionend' event needed.
    var transitionEnd = support.transitionEnd = eventNames[support.transition] || null;

    // Avoid memory leak in IE.
    div = null;

    // ## $.cssEase
    // List of easing aliases that you can use with `$.fn.transition`.
    $.cssEase = {
        '_default': 'ease',
        'in': 'ease-in',
        'out': 'ease-out',
        'in-out': 'ease-in-out',
        'snap': 'cubic-bezier(0,1,.5,1)'
    };

    // ## 'transform' CSS hook
    // Allows you to use the `transform` property in CSS.
    //
    //     $("#hello").css({ transform: "rotate(90deg)" });
    //
    //     $("#hello").css('transform');
    //     //=> { rotate: '90deg' }
    //
    $.cssHooks.transform = {
        // The getter returns a `Transform` object.
        get: function (elem) {
            return $(elem).data('transform');
        },

        // The setter accepts a `Transform` object or a string.
        set: function (elem, v) {
            var value = v;

            if (!(value instanceof Transform)) {
                value = new Transform(value);
            }

            // We've seen the 3D version of Scale() not work in Chrome when the
            // element being scaled extends outside of the viewport.  Thus, we're
            // forcing Chrome to not use the 3d transforms as well.  Not sure if
            // translate is affectede, but not risking it.  Detection code from
            // http://davidwalsh.name/detecting-google-chrome-javascript
            if (support.transform === 'WebkitTransform' && !isChrome) {
                elem.style[support.transform] = value.toString(true);
            } else {
                elem.style[support.transform] = value.toString();
            }

            $(elem).data('transform', value);
        }
    };

    // ## 'transformOrigin' CSS hook
    // Allows the use for `transformOrigin` to define where scaling and rotation
    // is pivoted.
    //
    //     $("#hello").css({ transformOrigin: '0 0' });
    //
    $.cssHooks.transformOrigin = {
        get: function (elem) {
            return elem.style[support.transformOrigin];
        },
        set: function (elem, value) {
            elem.style[support.transformOrigin] = value;
        }
    };

    // ## 'transition' CSS hook
    // Allows you to use the `transition` property in CSS.
    //
    //     $("#hello").css({ transition: 'all 0 ease 0' });
    //
    $.cssHooks.transition = {
        get: function (elem) {
            return elem.style[support.transition];
        },
        set: function (elem, value) {
            elem.style[support.transition] = value;
        }
    };

    // ## Other CSS hooks
    // Allows you to rotate, scale and translate.
    registerCssHook('scale');
    registerCssHook('translate');
    registerCssHook('rotate');
    registerCssHook('rotateX');
    registerCssHook('rotateY');
    registerCssHook('rotate3d');
    registerCssHook('perspective');
    registerCssHook('skewX');
    registerCssHook('skewY');
    registerCssHook('x', true);
    registerCssHook('y', true);

    // ## Transform class
    // This is the main class of a transformation property that powers
    // `$.fn.css({ transform: '...' })`.
    //
    // This is, in essence, a dictionary object with key/values as `-transform`
    // properties.
    //
    //     var t = new Transform("rotate(90) scale(4)");
    //
    //     t.rotate             //=> "90deg"
    //     t.scale              //=> "4,4"
    //
    // Setters are accounted for.
    //
    //     t.set('rotate', 4)
    //     t.rotate             //=> "4deg"
    //
    // Convert it to a CSS string using the `toString()` and `toString(true)` (for WebKit)
    // functions.
    //
    //     t.toString()         //=> "rotate(90deg) scale(4,4)"
    //     t.toString(true)     //=> "rotate(90deg) scale3d(4,4,0)" (WebKit version)
    //
    function Transform(str) {
        if (typeof str === 'string') { this.parse(str); }
        return this;
    }

    Transform.prototype = {
        // ### setFromString()
        // Sets a property from a string.
        //
        //     t.setFromString('scale', '2,4');
        //     // Same as set('scale', '2', '4');
        //
        setFromString: function (prop, val) {
            var args =
                (typeof val === 'string') ? val.split(',') :
                    (val.constructor === Array) ? val :
                        [val];

            args.unshift(prop);

            Transform.prototype.set.apply(this, args);
        },

        // ### set()
        // Sets a property.
        //
        //     t.set('scale', 2, 4);
        //
        set: function (prop) {
            var args = Array.prototype.slice.apply(arguments, [1]);
            if (this.setter[prop]) {
                this.setter[prop].apply(this, args);
            } else {
                this[prop] = args.join(',');
            }
        },

        get: function (prop) {
            if (this.getter[prop]) {
                return this.getter[prop].apply(this);
            } else {
                return this[prop] || 0;
            }
        },

        setter: {
            // ### rotate
            //
            //     .css({ rotate: 30 })
            //     .css({ rotate: "30" })
            //     .css({ rotate: "30deg" })
            //     .css({ rotate: "30deg" })
            //
            rotate: function (theta) {
                this.rotate = unit(theta, 'deg');
            },

            rotateX: function (theta) {
                this.rotateX = unit(theta, 'deg');
            },

            rotateY: function (theta) {
                this.rotateY = unit(theta, 'deg');
            },

            // ### scale
            //
            //     .css({ scale: 9 })      //=> "scale(9,9)"
            //     .css({ scale: '3,2' })  //=> "scale(3,2)"
            //
            scale: function (x, y) {
                if (y === undefined) { y = x; }
                this.scale = x + "," + y;
            },

            // ### skewX + skewY
            skewX: function (x) {
                this.skewX = unit(x, 'deg');
            },

            skewY: function (y) {
                this.skewY = unit(y, 'deg');
            },

            // ### perspectvie
            perspective: function (dist) {
                this.perspective = unit(dist, 'px');
            },

            // ### x / y
            // Translations. Notice how this keeps the other value.
            //
            //     .css({ x: 4 })       //=> "translate(4px, 0)"
            //     .css({ y: 10 })      //=> "translate(4px, 10px)"
            //
            x: function (x) {
                this.set('translate', x, null);
            },

            y: function (y) {
                this.set('translate', null, y);
            },

            // ### translate
            // Notice how this keeps the other value.
            //
            //     .css({ translate: '2, 5' })    //=> "translate(2px, 5px)"
            //
            translate: function (x, y) {
                if (this._translateX === undefined) { this._translateX = 0; }
                if (this._translateY === undefined) { this._translateY = 0; }

                if (x !== null) { this._translateX = unit(x, 'px'); }
                if (y !== null) { this._translateY = unit(y, 'px'); }

                this.translate = this._translateX + "," + this._translateY;
            }
        },

        getter: {
            x: function () {
                return this._translateX || 0;
            },

            y: function () {
                return this._translateY || 0;
            },

            scale: function () {
                var s = (this.scale || "1,1").split(',');
                if (s[0]) { s[0] = parseFloat(s[0]); }
                if (s[1]) { s[1] = parseFloat(s[1]); }

                // "2.5,2.5" => 2.5
                // "2.5,1" => [2.5,1]
                return (s[0] === s[1]) ? s[0] : s;
            },

            rotate3d: function () {
                var s = (this.rotate3d || "0,0,0,0deg").split(',');
                for (var i = 0; i <= 3; ++i) {
                    if (s[i]) { s[i] = parseFloat(s[i]); }
                }
                if (s[3]) { s[3] = unit(s[3], 'deg'); }

                return s;
            }
        },

        // ### parse()
        // Parses from a string. Called on constructor.
        parse: function (str) {
            var self = this;
            str.replace(/([a-zA-Z0-9]+)\((.*?)\)/g, function (x, prop, val) {
                self.setFromString(prop, val);
            });
        },

        // ### toString()
        // Converts to a `transition` CSS property string. If `use3d` is given,
        // it converts to a `-webkit-transition` CSS property string instead.
        toString: function (use3d) {
            var re = [];

            for (var i in this) {
                if (this.hasOwnProperty(i)) {
                    // Don't use 3D transformations if the browser can't support it.
                    if ((!support.transform3d) && (
                        (i === 'rotateX') ||
                        (i === 'rotateY') ||
                        (i === 'perspective') ||
                        (i === 'transformOrigin'))) { continue; }

                    if (i[0] !== '_') {
                        if (use3d && (i === 'scale')) {
                            re.push(i + "3d(" + this[i] + ",1)");
                        } else if (use3d && (i === 'translate')) {
                            re.push(i + "3d(" + this[i] + ",0)");
                        } else {
                            re.push(i + "(" + this[i] + ")");
                        }
                    }
                }
            }

            return re.join(" ");
        }
    };

    function callOrQueue(self, queue, fn) {
        if (queue === true) {
            self.queue(fn);
        } else if (queue) {
            self.queue(queue, fn);
        } else {
            fn();
        }
    }

    // ### getProperties(dict)
    // Returns properties (for `transition-property`) for dictionary `props`. The
    // value of `props` is what you would expect in `$.css(...)`.
    function getProperties(props) {
        var re = [];

        $.each(props, function (key) {
            key = $.camelCase(key); // Convert "text-align" => "textAlign"
            key = $.transit.propertyMap[key] || key;
            key = uncamel(key); // Convert back to dasherized

            if ($.inArray(key, re) === -1) { re.push(key); }
        });

        return re;
    }

    // ### getTransition()
    // Returns the transition string to be used for the `transition` CSS property.
    //
    // Example:
    //
    //     getTransition({ opacity: 1, rotate: 30 }, 500, 'ease');
    //     //=> 'opacity 500ms ease, -webkit-transform 500ms ease'
    //
    function getTransition(properties, duration, easing, delay) {
        // Get the CSS properties needed.
        var props = getProperties(properties);

        // Account for aliases (`in` => `ease-in`).
        if ($.cssEase[easing]) { easing = $.cssEase[easing]; }

        // Build the duration/easing/delay attributes for it.
        var attribs = '' + toMS(duration) + ' ' + easing;
        if (parseInt(delay, 10) > 0) { attribs += ' ' + toMS(delay); }

        // For more properties, add them this way:
        // "margin 200ms ease, padding 200ms ease, ..."
        var transitions = [];
        $.each(props, function (i, name) {
            transitions.push(name + ' ' + attribs);
        });

        return transitions.join(', ');
    }

    // ## $.fn.transition
    // Works like $.fn.animate(), but uses CSS transitions.
    //
    //     $("...").transition({ opacity: 0.1, scale: 0.3 });
    //
    //     // Specific duration
    //     $("...").transition({ opacity: 0.1, scale: 0.3 }, 500);
    //
    //     // With duration and easing
    //     $("...").transition({ opacity: 0.1, scale: 0.3 }, 500, 'in');
    //
    //     // With callback
    //     $("...").transition({ opacity: 0.1, scale: 0.3 }, function() { ... });
    //
    //     // With everything
    //     $("...").transition({ opacity: 0.1, scale: 0.3 }, 500, 'in', function() { ... });
    //
    //     // Alternate syntax
    //     $("...").transition({
    //       opacity: 0.1,
    //       duration: 200,
    //       delay: 40,
    //       easing: 'in',
    //       complete: function() { /* ... */ }
    //      });
    //
    $.fn.transition = $.fn.transit = function (properties, callback) {
        var self = this;
        var delay = 0;
        var queue = true;
        var easing;
        var duration;
        var count;
        var preset;

        /*// Account for `.transition(properties, callback)`.
         if (typeof duration === 'function') {
         callback = duration;
         duration = undefined;
         }

         // Account for `.transition(properties, duration, callback)`.
         if (typeof easing === 'function') {
         callback = easing;
         easing = undefined;
         }*/

        // Alternate syntax.
        if (typeof properties.easing !== 'undefined') {
            easing = properties.easing;
            delete properties.easing;
        }

        if (typeof properties.duration !== 'undefined') {
            duration = properties.duration;
            delete properties.duration;
        }

        if (typeof properties.complete !== 'undefined') {
            callback = properties.complete;
            delete properties.complete;
        }

        if (typeof properties.queue !== 'undefined') {
            queue = properties.queue;
            delete properties.queue;
        }

        if (typeof properties.delay !== 'undefined') {
            delay = properties.delay;
            delete properties.delay;
        }


        preset=properties.preset;
        count=properties.count;
        if(preset!==undefined){
            if ((duration === undefined)||(duration===0)) {
                duration = '';
            } else {
                duration = toSeconds(duration).toString();
            }
            if ((delay === undefined)||(delay===0)) {
                delay = '';
            } else {
                delay = toSeconds(delay).toString();
            }
            if ((count === undefined)||(count===0)) {
                count = '';
            } else {
                count = count.toString();
            }
            var options={};
            options.duration=duration;
            options.delay=delay;
            options.count=count;
            return CSS3.animate(self, options, callback, preset,properties.remove);

        }

        // Set defaults. (`400` duration, `ease` easing)
        if (typeof duration === 'undefined') { duration = $.fx.speeds._default; }
        if (typeof easing === 'undefined') { easing = $.cssEase._default; }

        duration = toMS(duration);

        // Build the `transition` property.
        var transitionValue = getTransition(properties, duration, easing, delay);

        // Compute delay until callback.
        // If this becomes 0, don't bother setting the transition property.
        var work = $.transit.enabled && support.transition;
        var i = work ? (parseInt(duration, 10) + parseInt(delay, 10)) : 0;

        // If there's nothing to do...
        if (i === 0) {
            var fn = function (next) {
                self.css(properties);
                if (callback) { callback.apply(self); }
                if (next) { next(); }
            };

            callOrQueue(self, queue, fn);
            return self;
        }

        // Save the old transitions of each element so we can restore it later.
        var oldTransitions = {};

        var run = function (nextCall) {
            var bound = false;

            // Prepare the callback.
            var cb = function () {
                if (bound) { self.unbind(transitionEnd, cb); }

                if (i > 0) {
                    self.each(function () {
                        this.style[support.transition] = (oldTransitions[this] || null);
                    });
                }

                if (typeof callback === 'function') { callback.apply(self); }
                if (typeof nextCall === 'function') { nextCall(); }
            };

            if ((i > 0) && (transitionEnd) && ($.transit.useTransitionEnd)) {
                // Use the 'transitionend' event if it's available.
                bound = true;
                self.bind(transitionEnd, cb);
            } else {
                // Fallback to timers if the 'transitionend' event isn't supported.
                window.setTimeout(cb, i);
            }

            // Apply transitions.
            self.each(function () {
                if (i > 0) {
                    this.style[support.transition] = transitionValue;
                }
                $(this).css(properties);
            });
        };

        // Defer running. This allows the browser to paint any pending CSS it hasn't
        // painted yet before doing the transitions.
        var deferredRun = function (next) {
            var i = 0;

            // Durations that are too slow will get transitions mixed up.
            // (Tested on Mac/FF 7.0.1)
            if ((support.transition === 'MozTransition') && (i < 25)) { i = 25; }

            window.setTimeout(function () { run(next); }, i);
        };

        // Use jQuery's fx queue.
        callOrQueue(self, queue, deferredRun);

        // Chainability.
        return this;
    };

    function registerCssHook(prop, isPixels) {
        // For certain properties, the 'px' should not be implied.
        if (!isPixels) { $.cssNumber[prop] = true; }

        $.transit.propertyMap[prop] = support.transform;

        $.cssHooks[prop] = {
            get: function (elem) {
                var t = $(elem).css('transform') || new Transform();
                return t.get(prop);
            },

            set: function (elem, value) {
                var t = $(elem).css('transform') || new Transform();
                t.setFromString(prop, value);

                $(elem).css({ transform: t });
            }
        };
    }

    // ### uncamel(str)
    // Converts a camelcase string to a dasherized string.
    // (`marginLeft` => `margin-left`)
    function uncamel(str) {
        return str.replace(/([A-Z])/g, function (letter) { return '-' + letter.toLowerCase(); });
    }

    // ### unit(number, unit)
    // Ensures that number `number` has a unit. If no unit is found, assume the
    // default is `unit`.
    //
    //     unit(2, 'px')          //=> "2px"
    //     unit("30deg", 'rad')   //=> "30deg"
    //
    function unit(i, units) {
        if ((typeof i === "string") && (!i.match(/^[\-0-9\.]+$/))) {
            return i;
        } else {
            return "" + i + units;
        }
    }

    // ### toMS(duration)
    // Converts given `duration` to a millisecond string.
    //
    //     toMS('fast')   //=> '400ms'
    //     toMS(10)       //=> '10ms'
    //
    function toMS(duration) {
        var i = duration;

        // Allow for string durations like 'fast'.
        if ($.fx.speeds[i]) { i = $.fx.speeds[i]; }

        return unit(i, 'ms');
    }

    // Export some functions for testable-ness.
    $.transit.getTransitionValue = getTransition;


    /*
     =========================================
     Preset keyframe animations extension
     =========================================
     */

    //CSS3 uses seconds as the unit measurement
    function toSeconds(ms){
        var sec=parseFloat(ms/1000);
        return sec;
    }

    var CSS3 = {};
    CSS3.pfx = ["webkit", "moz", "MS", "o"];
    if ($.browser.webkit) {
        CSS3.animationend = CSS3.pfx[0] + 'AnimationEnd';
    } else{
        CSS3.animationend = 'animationend'; /* mozilla doesn't use the vendor prefix */
    }
    CSS3.isAnimated = function (ele) {  /* method query to determine if the element is currently being animated; we don't want to attach multiple animationend handlers; undesirable behavior will result */

        //var data = ele.data("events")[CSS3.animationend];
        /*var data = $.data(ele,'events');
         console.log(data);
         if (data === undefined || data.length === 0) {
         return false;  // no animationend event handler attached, return false
         } else {
         return true;  // there is animationend event handler attached, return true
         }*/

        if(!ele[0]){
            return;
        }
        var classList = ele[0].className.split(/\s+/);
        for (var i = 0; i < classList.length; i++) {
            if (classList[i] === 'animated') {
                return true;
            }
        }
        return false;
    };

    function _unbindAnimation(ele,event,animation,animationType,callback){
        ele.removeCSSStyles()
            .removeClass(animation);
        //hide element if animationOut
        if((animationType.indexOf('Out')>-1)||(animationType.indexOf('out')>-1)){
            ele.hide();
        }
        ele.off(event);
        if (callback && callback !== undefined) {
            callback.call(ele);
        }

    }
    CSS3.animate = function (ele, options, callback, animationType, removeClass) {  /* transition animation handler */

        if (CSS3.isAnimated(ele)) {
            return ele; /* block animation request */
        }
        if (options === undefined) {
            options = {};
        }
        ele.show();
        ele.css({visibility:'visible'});
        var animation = 'animated ' + animationType;
        //bind animationEnd
        ele.on(CSS3.animationend, function (e) {
            if(removeClass !==undefined){
                ele.removeClass(removeClass);
                _unbindAnimation(ele,e,animation,animationType,callback);

            }else{
                _unbindAnimation(ele,e,animation,animationType,callback);
            }

        });

        ele.addCSSStyles(options).addClass(animation);
        return ele;
    };

    CSS3.animationEndEvent=function(){
        return CSS3.animationend;
    };

    CSS3.transitionEndEvent=function(){
        var transitionEnd;
        var pfx = ["webkit", "moz", "MS", "o"];
        if ($.browser.webkit) {
            transitionEnd = pfx[0] + 'TransitionEnd';
        } else if ($.browser.mozilla) {
            transitionEnd = 'transitionend';
            /* mozilla doesn't use the vendor prefix */
        } else if ($.browser.msie) {
            transitionEnd = pfx[2] + 'TransitionEnd';
        } else if ($.browser.opera) {
            transitionEnd = pfx[3] + 'TransitionEnd';
        } else {
            transitionEnd = 'transitionend';
        }
        return transitionEnd;
    };

    /* css style setter methods */
    $.fn.removeCSSStyles = function () {
        this.css({
            'animation-duration': '',
            'animation-delay': '',
            'animation-iteration-count': '',
            '-webkit-animation-duration': '',
            '-webkit-animation-delay': '',
            '-webkit-animation-iteration-count': '',
            '-moz-animation-duration': '',
            '-moz-animation-delay': '',
            '-moz-animation-iteration-count': '',
            'visibility':''
        });
        return this;
    };
    $.fn.addCSSStyles = function (options) {
        var duration = options.duration;
        var delay = options.delay;
        var count = options.count;
        if (duration === undefined) {
            duration = '';
        } else {
            duration = options.duration.toString() + 's';
        }
        if (delay === undefined) {
            delay = '';
        } else {
            delay = options.delay.toString() + 's';
        }
        if (count === undefined) {
            count = '';
        } else {
            count = options.count.toString();
        }

        this.css({
            'animation-duration': duration,
            'animation-delay': delay,
            'animation-iteration-count': count,
            '-webkit-animation-duration': duration,
            '-webkit-animation-delay': delay,
            '-webkit-animation-iteration-count': count,
            '-moz-animation-duration': duration,
            '-moz-animation-delay': delay,
            '-moz-animation-iteration-count': count
        });

        return this;
    };

    //expose CSS3 object
    $.transit.CSS3=CSS3;

    return $;
}));


(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
    }
}(this, function () {

    (function (doc, win) {
        'use strict';
        if (typeof doc.createEvent !== 'function') return false; // no tap events here
        // helpers
        var useJquery = typeof jQuery !== 'undefined',
        // some helpers borrowed from https://github.com/WebReflection/ie-touch
            msPointerEnabled = !!navigator.pointerEnabled || navigator.msPointerEnabled,
            isTouch = (!!('ontouchstart' in window) && navigator.userAgent.indexOf('PhantomJS') < 0) || msPointerEnabled,
            msEventType = function (type) {
                var lo = type.toLowerCase(),
                    ms = 'MS' + type;
                return navigator.msPointerEnabled ? ms : lo;
            },
            touchevents = {
                touchstart: msEventType('PointerDown') + ' touchstart',
                touchend: msEventType('PointerUp') + ' touchend',
                touchmove: msEventType('PointerMove') + ' touchmove'
            },
            setListener = function (elm, events, callback) {
                var eventsArray = events.split(' '),
                    i = eventsArray.length;

                while (i--) {
                    elm.addEventListener(eventsArray[i], callback, false);
                }
            },
            getPointerEvent = function (event) {
                return event.targetTouches ? event.targetTouches[0] : event;
            },
            sendEvent = function (elm, eventName, originalEvent, data) {
                var customEvent = doc.createEvent('Event');
                data = data || {};
                data.x = currX;
                data.y = currY;
                data.distance = data.distance;
                if (useJquery)
                    jQuery(elm).trigger(eventName, data);
                else {
                    customEvent.originalEvent = originalEvent;
                    for (var key in data) {
                        customEvent[key] = data[key];
                    }
                    customEvent.initEvent(eventName, true, true);
                    elm.dispatchEvent(customEvent);
                }
            },
            onTouchStart = function (e) {

                var pointer = getPointerEvent(e);
                // caching the current x
                cachedX = currX = pointer.pageX;
                // caching the current y
                cachedY = currY = pointer.pageY;
                // a touch event is detected
                touchStarted = true;
                tapNum++;
                // detecting if after 200ms the finger is still in the same position
                clearTimeout(tapTimer);
                tapTimer = setTimeout(function () {
                    if (
                        cachedX >= currX - precision &&
                        cachedX <= currX + precision &&
                        cachedY >= currY - precision &&
                        cachedY <= currY + precision &&
                        !touchStarted
                    ) {
                        // Here you get the Tap event
                        sendEvent(e.target, (tapNum === 2) ? 'dbltap' : 'tap', e);
                    }
                    tapNum = 0;
                }, taptreshold);

            },
            onTouchEnd = function (e) {
                var eventsArr = [],
                    deltaY = cachedY - currY,
                    deltaX = cachedX - currX;
                touchStarted = false;

                if (deltaX <= -swipeTreshold)
                    eventsArr.push('swiperight');

                if (deltaX >= swipeTreshold)
                    eventsArr.push('swipeleft');

                if (deltaY <= -swipeTreshold)
                    eventsArr.push('swipedown');

                if (deltaY >= swipeTreshold)
                    eventsArr.push('swipeup');
                if (eventsArr.length) {
                    for (var i = 0; i < eventsArr.length; i++) {
                        var eventName = eventsArr[i];
                        sendEvent(e.target, eventName, e, {
                            distance: {
                                x: Math.abs(deltaX),
                                y: Math.abs(deltaY)
                            }
                        });
                    }
                }
            },
            onTouchMove = function (e) {
                var pointer = getPointerEvent(e);
                currX = pointer.pageX;
                currY = pointer.pageY;
            },
            touchStarted = false, // detect if a touch event is sarted
            swipeTreshold = win.SWIPE_TRESHOLD || 80,
            taptreshold = win.TAP_TRESHOLD || 200,
            precision = win.TAP_PRECISION / 2 || 60 / 2, // touch events boundaries ( 60px by default )
            justTouchEvents = win.JUST_ON_TOUCH_DEVICES || isTouch,
            tapNum = 0,
            currX, currY, cachedX, cachedY, tapTimer;

        //setting the events listeners
        setListener(doc, touchevents.touchstart + (justTouchEvents ? '' : ' mousedown'), onTouchStart);
        setListener(doc, touchevents.touchend + (justTouchEvents ? '' : ' mouseup'), onTouchEnd);
        setListener(doc, touchevents.touchmove + (justTouchEvents ? '' : ' mousemove'), onTouchMove);
    }(document, window));


}));

/*
 * =============================================================
 * jQuery special events
 * =============================================================
 *
 */

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
    }
}(this, function () {

    /* throttled resize special event */
    /* ported from jQuery.mobile */
    (function () {
        $.event.special.throttledresize = {
            setup: function () {
                $(this).bind("resize", handler);
            },
            teardown: function () {
                $(this).unbind("resize", handler);
            }
        };

        var throttle = 250,
            handler = function () {
                curr = (new Date()).getTime();
                diff = curr - lastCall;

                if (diff >= throttle) {

                    lastCall = curr;
                    $(this).trigger("throttledresize");

                } else {

                    if (heldCall) {
                        clearTimeout(heldCall);
                    }

                    // Promise a held call will still execute
                    heldCall = setTimeout(handler, throttle - diff);
                }
            },
            lastCall = 0,
            heldCall,
            curr,
            diff;
    })();

    /* orientationchange special event--------------------------------------------------------------------------------*/
    /* ported from jQuery.mobile */
    (function () {
        var win = $(window),
            event_name = "orientationchange",
            special_event,
            get_orientation,
            last_orientation,
            initial_orientation_is_landscape,
            initial_orientation_is_default,
            portrait_map = { "0": true, "180": true };

        // It seems that some device/browser vendors use window.orientation values 0 and 180 to
        // denote the "default" orientation. For iOS devices, and most other smart-phones tested,
        // the default orientation is always "portrait", but in some Android and RIM based tablets,
        // the default orientation is "landscape". The following code attempts to use the window
        // dimensions to figure out what the current orientation is, and then makes adjustments
        // to the to the portrait_map if necessary, so that we can properly decode the
        // window.orientation value whenever get_orientation() is called.
        //


        if ($.device.orientation) {

            // Check the window width and height to figure out what the current orientation
            // of the device is at this moment. Note that we've initialized the portrait map
            // values to 0 and 180, *AND* we purposely check for landscape so that if we guess
            // wrong, , we default to the assumption that portrait is the default orientation.
            // We use a threshold check below because on some platforms like iOS, the iPhone
            // form-factor can report a larger width than height if the user turns on the
            // developer console. The actual threshold value is somewhat arbitrary, we just
            // need to make sure it is large enough to exclude the developer console case.

            var ww = window.innerWidth || $(window).width(),
                wh = window.innerHeight || $(window).height(),
                landscape_threshold = 50;

            initial_orientation_is_landscape = ww > wh && (ww - wh) > landscape_threshold;


            // Now check to see if the current window.orientation is 0 or 180.
            initial_orientation_is_default = portrait_map[window.orientation];

            // If the initial orientation is landscape, but window.orientation reports 0 or 180, *OR*
            // if the initial orientation is portrait, but window.orientation reports 90 or -90, we
            // need to flip our portrait_map values because landscape is the default orientation for
            // this device/browser.
            if ((initial_orientation_is_landscape && initial_orientation_is_default) || (!initial_orientation_is_landscape && !initial_orientation_is_default)) {
                portrait_map = { "-90": true, "90": true };
            }
        }

        $.event.special.orientationchange = $.extend({}, $.event.special.orientationchange, {
            setup: function () {
                // If the event is supported natively, return false so that jQuery
                // will bind to the event using DOM methods.
                if ($.device.orientation && !$.event.special.orientationchange.disabled && !$.device.android) {
                    return false;
                }

                // Get the current orientation to avoid initial double-triggering.
                last_orientation = get_orientation();

                // Because the orientationchange event doesn't exist, simulate the
                // event by testing window dimensions on resize.
                win.bind("throttledresize", handler);
            },
            teardown: function () {
                // If the event is not supported natively, return false so that
                // jQuery will unbind the event using DOM methods.
                if ($.device.orientation && !$.event.special.orientationchange.disabled && !$.device.android) {
                    return false;
                }

                // Because the orientationchange event doesn't exist, unbind the
                // resize event handler.
                win.unbind("throttledresize", handler);
            },
            add: function (handleObj) {
                // Save a reference to the bound event handler.
                var old_handler = handleObj.handler;


                handleObj.handler = function (event) {
                    // Modify event object, adding the .orientation property.
                    event.orientation = get_orientation();

                    // Call the originally-bound event handler and return its result.
                    return old_handler.apply(this, arguments);
                };
            }
        });

        // If the event is not supported natively, this handler will be bound to
        // the window resize event to simulate the orientationchange event.
        function handler() {
            // Get the current orientation.
            var orientation = get_orientation();

            if (orientation !== last_orientation) {
                // The orientation has changed, so trigger the orientationchange event.
                last_orientation = orientation;
                win.trigger(event_name);
            }
        }

        // Get the current page orientation. This method is exposed publicly, should it
        // be needed, as jQuery.event.special.orientationchange.orientation()
        $.event.special.orientationchange.orientation = get_orientation = function () {
            var isPortrait = true, elem = document.documentElement;

            // prefer window orientation to the calculation based on screensize as
            // the actual screen resize takes place before or after the orientation change event
            // has been fired depending on implementation (eg android 2.3 is before, iphone after).
            // More testing is required to determine if a more reliable method of determining the new screensize
            // is possible when orientationchange is fired. (eg, use media queries + element + opacity)
            if ($.support.orientation) {
                // if the window orientation registers as 0 or 180 degrees report
                // portrait, otherwise landscape
                isPortrait = portrait_map[window.orientation];
            } else {
                isPortrait = elem && elem.clientWidth / elem.clientHeight < 1.1;
            }

            return isPortrait ? "portrait" : "landscape";
        };

        $.fn[event_name] = function (fn) {
            return fn ? this.bind(event_name, fn) : this.trigger(event_name);
        };

        // jQuery < 1.8
        if ($.attrFn) {
            $.attrFn[event_name] = true;
        }

    }());



    /* zoom ----------------------------------------------------------------------------------------------------------*/
    /* ported from jQuery.mobile */
    (function () {
        var meta = $("meta[name=viewport]"),
            initialContent = meta.attr("content"),
            disabledZoom = initialContent + ",maximum-scale=1, user-scalable=no",
            enabledZoom = initialContent + ",maximum-scale=10, user-scalable=yes",
            disabledInitially = /(user-scalable[\s]*=[\s]*no)|(maximum-scale[\s]*=[\s]*1)[$,\s]/.test(initialContent);

        $.device.zoom = $.extend({}, {
            enabled: !disabledInitially,
            locked: false,
            disable: function (lock) {
                if (!disabledInitially && !$.device.zoom.locked) {
                    meta.attr("content", disabledZoom);
                    $.device.zoom.enabled = false;
                    $.device.zoom.locked = lock || false;
                }
            },
            enable: function (unlock) {
                if (!disabledInitially && (!$.device.zoom.locked || unlock === true)) {
                    meta.attr("content", enabledZoom);
                    $.device.zoom.enabled = true;
                    $.device.zoom.locked = false;
                }
            },
            restore: function () {
                if (!disabledInitially) {
                    meta.attr("content", initialContent);
                    $.device.zoom.enabled = true;
                }
            }
        });

    }());

    /* end zoom ------------------------------------------------------------------------------------------------------*/

    /* orientationfix ------------------------------------------------------------------------------------------------*/

    (function () {
        /* ported from jQuery.mobile */
        // This fix addresses an iOS bug, so return early if the UA claims it's something else.
        if (!(/iPhone|iPad|iPod/.test(navigator.platform) && navigator.userAgent.indexOf("AppleWebKit") > -1)) {
            return;
        }

        var zoom = $.device.zoom,
            evt, x, y, z, aig;

        function checkTilt(e) {
            evt = e.originalEvent;
            aig = evt.accelerationIncludingGravity;

            x = Math.abs(aig.x);
            y = Math.abs(aig.y);
            z = Math.abs(aig.z);

            // If portrait orientation and in one of the danger zones
            if (!window.orientation && (x > 7 || ((z > 6 && y < 8 || z < 8 && y > 6) && x > 5))) {
                if (zoom.enabled) {
                    zoom.disable();
                }
            } else if (!zoom.enabled) {
                zoom.enable();
            }
        }

        $(window)
            .bind("orientationchange.iosorientationfix", zoom.enable)
            .bind("devicemotion.iosorientationfix", checkTilt);

    }());






    (function () {
        var scrollEvent = 'touchmove scroll';
        $.event.special.scrollstart = {

            enabled: true,
            setup: function () {

                var thisObject = this,
                    $this = $(thisObject),
                    scrolling,
                    timer;

                function trigger(event, state) {
                    scrolling = state;
                    triggerCustomEvent(thisObject, scrolling ? "scrollstart" : "scrollstop", event);
                }

                // iPhone triggers scroll after a small delay; use touchmove instead
                $this.bind(scrollEvent, function (event) {

                    if (!$.event.special.scrollstart.enabled) {
                        return;
                    }

                    if (!scrolling) {
                        trigger(event, true);
                    }

                    clearTimeout(timer);
                    timer = setTimeout(function () {
                        trigger(event, false);
                    }, 50);
                });
            },
            teardown: function () {
                $(this).unbind(scrollEvent);
            }
        };

        function triggerCustomEvent(obj, eventType, event, bubble) {
            var originalType = event.type;
            event.type = eventType;
            if (bubble) {
                $.event.trigger(event, undefined, obj);
            } else {
                $.event.dispatch.call(obj, event);
            }
            event.type = originalType;
        }

    }());

    /* touchclick special event --------------------------------------------------------------------------------------*/
    //create a special event to act as standard 'click' for desktop and 'touch' for touch devices
    (function () {

        var isTouch = false;

        $.event.special.touchclick = {

            setup: function () {
                isTouch = $.device.touch;
            },

            add: function (handleObj) {
                if (!isTouch) {
                    bindClick($(this), handleObj);
                } else {
                    bindTouch($(this), handleObj);
                }
            },

            remove: function (handleObj) {
                if (!isTouch) {
                    unbindClick($(this), handleObj);
                } else {
                    unbindTouch($(this), handleObj);
                }
            }

        };

        function bindClick(element, handleObj) {
            var old_handler = handleObj.handler;
            var selector = handleObj.selector;
            element.on('click', selector, function (event) {
                event.preventDefault();
                event.namespace = 'elliptical.click';
                return old_handler.apply(this, arguments);
            });
        }

        function bindTouch(element, handleObj) {
            var old_handler = handleObj.handler;
            var selector = handleObj.selector;
            element.on('touchstart', selector, function (event) {
                event.preventDefault();
                event.namespace = 'elliptical.touch';
                return old_handler.apply(this, arguments);
            });
        }

        function unbindClick(element, handleObj) {
            var selector = handleObj.selector;
            element.off('click', selector);
        }

        function unbindTouch(element, handleObj) {
            var selector = handleObj.selector;
            element.off('touchstart', selector);
        }

    }());

    /* touchhover special event --------------------------------------------------------------------------------------*/
    //create a special event to handle mouseenter/mouseleave for desktop and  touch devices
    (function () {

        var isTouch = false;

        $.event.special.touchhover = {

            setup: function () {
                isTouch = $.device.touch;
            },

            add: function (handleObj) {
                if (!isTouch) {
                    bindHover($(this), handleObj);
                } else {
                    bindTouch($(this), handleObj);
                }
            },

            remove: function (handleObj) {
                if (!isTouch) {
                    unbindHover($(this), handleObj);
                } else {
                    unbindTouch($(this), handleObj);
                }
            }

        };

        function bindHover(element, handleObj) {
            var old_handler = handleObj.handler;
            var selector = handleObj.selector;
            element.on('mouseenter', selector, function (event) {
                event.preventDefault();
                event.type='hoverover';
                event.namespace = 'elliptical.hoverover';
                return old_handler.apply(this, arguments);
            });
            element.on('mouseleave', selector, function (event) {
                event.preventDefault();
                event.type='hoverout';
                event.namespace = 'elliptical.hoverout';
                return old_handler.apply(this, arguments);
            });
        }

        function bindTouch(element, handleObj) {
            var old_handler = handleObj.handler;
            var selector = handleObj.selector;
            element.on('touchend', selector, function (event) {
                event.preventDefault();
                if(element.hasClass('over')){
                    event.type='hoverout';
                    event.namespace = 'elliptical.hoverout';
                    element.removeClass('over');
                }else{
                    event.type='hoverover';
                    event.namespace = 'elliptical.hoverover';
                    element.addClass('over');
                }

                return old_handler.apply(this, arguments);
            });
        }

        function unbindHover(element, handleObj) {
            var selector = handleObj.selector;
            element.off('mouseenter', selector);
            element.off('mouseleave', selector);
        }

        function unbindTouch(element, handleObj) {
            var selector = handleObj.selector;
            element.off('touchend', selector);
        }

    }());

    /* fixed navs and inputs focus -----------------------------------------------------------------------------------*/
    //on ios devices, keyboard on input focus will shift fixed navs...workaround: hide navs on focus
    (function () {
        if ($.device.ios) {
            var inputs = $('input, textarea');
            var navs = $('ui-navbar, ui-topbar');
            if(navs[0]){
                inputs.on('focusin', function (event) {
                    onFocus(navs);
                });
                inputs.on('focusout', function (event) {
                    onBlur(navs);
                });
            }
        }

        function onFocus(navs){
            navs.addClass('hide');
        }

        function onBlur(navs){
            navs.removeClass('hide');
        }

    }());

}));




/*
 * =============================================================
 * transforms
 * =============================================================
 *
 * Dependencies:
 *
 */

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
    }
}(this, function () {

    var transforms={

    };

    /**
     * sets hardware accelerated class and returns toggle flag
     * @param element {Object}
     * @param hardwareAcceleratedClass {String}
     * @returns {Boolean}
     */
    transforms.setHardwareAcceleration = function (element,hardwareAcceleratedClass) {
        var toggleAcceleration;
        if (!element.hasClass(hardwareAcceleratedClass)) {
            toggleAcceleration = true;
            element.addClass(hardwareAcceleratedClass);

        } else {
            toggleAcceleration = false;
        }
        return toggleAcceleration;
    };

    /**
     * removes hardware acceleration class if toggleAcceleration bit set
     * @param element {Object}
     * @param toggleAcceleration {Boolean}
     * @param hardwareAcceleratedClass {String}
     */
    transforms.resetHardwareAcceleration = function (element,toggleAcceleration,hardwareAcceleratedClass) {
        if (toggleAcceleration) {
            element.removeClass(hardwareAcceleratedClass);
        }
    };

    /**
     *
     * @param element {Object}
     * @param overflowContainerClass {String}
     * @returns {Boolean}
     */
    transforms.setContainerOverflow = function (element,overflowContainerClass) {
        var toggleOverflow;
        if (!element.hasClass(overflowContainerClass)) {
            toggleOverflow = true;
            element.addClass(overflowContainerClass);

        } else {
            toggleOverflow = false;
        }

        return toggleOverflow;
    };

    /**
     *
     * @param element {Object}
     * @param toggleOverflow {Boolean}
     * @param overflowContainerClass {String}
     */
    transforms.resetContainerOverflow = function (element,toggleOverflow,overflowContainerClass) {
        if (toggleOverflow) {
            element.removeClass(overflowContainerClass);
        }
    };

    /**
     *
     * @param container {Object}
     * @param leftBoxShadowClass {String}
     * @param fixedToggleContainerClass {String}
     */
    transforms.resetContainer = function (container,leftBoxShadowClass,fixedToggleContainerClass) {
        if(!container){
            return;
        }
        container.css({
            transition: '',
            '-webkit-transition': '',
            '-webkit-transform': '',
            '-moz-transition': '',
            '-moz-transform': '',
            'transform':'',
            'height': ''
        })
            .removeClass(leftBoxShadowClass)
            .removeClass(fixedToggleContainerClass);
    };

    transforms.resetTransition = function (element) {
        element.css({
            transition: '',
            '-webkit-transition': '',
            '-moz-transition': ''
        });

    };

    /**
     *
     * @param element {Object}
     */
    transforms.resetTransform = function (element) {
        element.css({
            transition: '',
            '-webkit-transition': '',
            '-webkit-transform': '',
            '-moz-transition': '',
            '-moz-transform': '',
            'transform':''
        });

    };

    /**
     *
     * @param element {Object}
     * @param coordinates {Object}
     */
    transforms.transform = function (element, coordinates) {
        var obj = {
            '-webkit-transform': 'translate3d(' + coordinates.x + ',' + coordinates.y + ',' + coordinates.z + ')',
            '-moz-transform': 'translate3d(' + coordinates.x + ',' + coordinates.y + ',' + coordinates.z + ')',
            transform: 'translate3d(' + coordinates.x + ',' + coordinates.y + ',' + coordinates.z + ')'
        };

        element.css(obj);

    };

    /**
     *
     * @param element {Object}
     * @param opts  {Object}
     * @param callback  {Function}
     *
     */
    transforms.transition3d = function (element, opts, callback) {
        //get prefixed transitionEnd event
        var CSS3= $.transit.CSS3;
        var transitionEnd = CSS3.transitionEndEvent();

        var coordinates = opts.coordinates;

        /* coordinates properties to pixel */
        coordinates.x=coordinates.x.toPixel();
        coordinates.y=coordinates.y.toPixel();
        coordinates.z=coordinates.z.toPixel();

        var easing = opts.easing || 'ease-in-out';
        opts.duration = opts.duration.toMillisecond() || '300ms';
        opts.delay = opts.delay.toMillisecond() || 0;
        opts.transitionEnd = opts.transitionEnd || false;
        var obj = {
            transition: 'transform ' + opts.duration + ' ' + opts.delay + ' ' + easing,
            '-webkit-transition': '-webkit-transform ' + opts.duration + ' ' + opts.delay + ' ' + easing,
            '-moz-transition': '-moz-transform ' + opts.duration + ' ' + opts.delay + ' ' + easing,
            '-webkit-transform': 'translate3d(' + coordinates.x + ',' + coordinates.y + ',' + coordinates.z + ')',
            '-moz-transform': 'translate3d(' + coordinates.x + ',' + coordinates.y + ',' + coordinates.z + ')',
            transform: 'translate3d(' + coordinates.x + ',' + coordinates.y + ',' + coordinates.z + ')'
        };

        element
            .on(transitionEnd, function () {
                if (opts.transitionEnd) {
                    $(this).off(transitionEnd);
                }
                if (callback) {
                    callback();
                }
            })
            .css(obj);
    };

    $.transforms = $.transforms || {};
    $.extend($.transforms, transforms);
    return $;

}));

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical=root.elliptical || {};
        root.elliptical.extensions=root.elliptical.extensions || {};
        root.elliptical.extensions.element = factory();
        root.returnExports = root.elliptical.extensions.element;
    }
}(this, function () {

    return {
        created:function(){
            this.element=$(this);
        }

    };
}));

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical = root.elliptical || {};
        root.elliptical.extensions = root.elliptical.extensions || {};
        root.elliptical.extensions.utils = factory();
        root.returnExports = root.elliptical.extensions.utils;
    }
}(this, function () {

    return {

        _utils: $.utils,

        _DOMParser: function (htmlString) {
            return new DOMParser().parseFromString(htmlString, 'text/html');
        },

        _preloadImages: function (element, callback) {
            var imgArray = [];
            var err = {};
            var data = {};
            var images = element.find('img').not('[data-src]');
            var length = images.length;
            var counter = 0;
            if (length === 0) {
                if (callback) {
                    err.message = 'No images found in element';
                    callback(err, null);
                }
                return false;
            }
            $.each(images, function (i, img) {
                var image = new Image();
                $(image).bind('load', function (event) {
                    counter++;
                    imgArray.push(image);
                    if (counter === length) {
                        if (!callback) {
                        } else {
                            data.images = imgArray;
                            data.length = counter;
                            callback(null, data);
                        }
                    }
                });
                image.src = img.src;
            });
            return true;
        },

        _scrollTop: function (ypos, evt) {
            if (typeof ypos !== "number") {
                ypos = 0;
            } else if (typeof evt === 'undefined') {
                evt = 'scrollTop';
            }

            setTimeout(function () {
                window.scrollTo(0, ypos);
                $(document).trigger(evt, {x: 0, y: ypos});
            }, 20);
        },

        _setModal: function (element, opts, callback) {
            //support 0-3 params
            var length = arguments.length;
            if (length === 0) {
                element = $('body');
                opts = {};
                callback = null;
            } else if (length === 1) {
                if (typeof element === 'function') {
                    callback = element;
                    element = $('body');
                    opts = {};
                } else if (element.context) {
                    opts = {};
                    callback = null;
                } else {
                    opts = element;
                    element = $('body');
                }
            } else if (length === 2) {
                if (typeof opts === 'function') {
                    callback = opts;
                    if (element.context === undefined) {
                        opts = element;
                        element = $('body');
                    } else {
                        opts = {};
                    }
                } else {
                    callback = null;
                }
            }

            var div = $('<div class="ui-modal"></div>');
            if (opts.cssClass) {
                div.addClass(opts.cssClass);
            }

            if (opts.zIndex) {
                div.css({
                    'z-index': opts.zIndex
                });
            }
            if (this._data) {
                this._data.set('modal', div);
            } else {
                this._modal = div;
            }

            var opacity = (opts.opacity) ? opts.opacity : .3;
            div.css({
                opacity: 0
            });
            element.append(div);

            this._transition(div, {
                opacity: opacity,
                duration: 250
            }, function () {
                if (callback) {
                    callback();
                }
            });
        },

        _removeModal: function (callback) {
            var self = this;
            var modal = null;
            if (this._data) {
                modal = this._data.get('modal');
            } else {
                modal = this._modal;
            }

            if (!modal || modal === undefined) {
                return;
            }
            this._transition(modal, {
                opacity: 0,
                duration: 250
            }, function () {
                modal.remove();
                (self._data) ? self._data.set('modal', null) : self._modal = null;
                if (callback) {
                    callback();
                }
            });
        },


        _resetSemanticState:function(){
            this.element.removeClass('error')
                .removeClass('warning')
                .removeClass('success')
                .removeClass('info')
        },

        _setChildrenAttributes:function(){
            var element=this.element;
            if(element[0].hasAttribute && element[0].hasAttribute('disabled')){
                element.query('input,textarea,select',function(result){
                    if(result[0]){
                        result.attr('disabled',true);
                    }
                });
            }
            if(element[0].hasAttribute && element[0].hasAttribute('readonly')){
                element.query('input,textarea,select',function(result){
                    if(result[0]){
                        result.attr('readonly',true);
                    }
                });
            }
        },

        _enableChildrenAttributes:function(){
            var element=this.element;
            element.query('input,textarea,select',function(result){
                if(result[0]){
                    result.attr('disabled',false);
                }
            });
            element.query('input,textarea,select',function(result){
                if(result[0]){
                    result.attr('readonly',false);
                }
            });
        },

        _find:function(selector){
            return this.element.find(selector);
        },

        _jsonParseMessage: function (obj) {
            try {
                var msgObj = JSON.parse(obj);
                if (msgObj.message) {
                    return msgObj.message;
                } else {
                    return obj;
                }
            } catch (ex) {
                return obj;
            }
        }


    };
}));

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical=root.elliptical || {};
        root.elliptical.extensions=root.elliptical.extensions || {};
        root.elliptical.extensions.dataStore = factory();
        root.returnExports = root.elliptical.extensions.dataStore;
    }
}(this, function () {

    return {
        _data:{
            _store:{},
            get:function(prop){
                if(this._store){
                    return this._store[prop];
                }

            },
            set:function(prop,val){
                if(this._store){
                    this._store[prop]=val;
                }
            },
            click:'touchclick',
            hover:'touchhover'
        }
    };
}));
//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical = root.elliptical || {};
        root.elliptical.extensions = root.elliptical.extensions || {};
        root.elliptical.extensions.device = factory();
        root.returnExports = elliptical.extensions.device;
    }
}(this, function () {

    return {

        _device: $.device,
        _mq: $.mq,

        _press: function () {
            return ('ontouchend' in document) ? 'touchstart' : 'click';
        },

        _mode: function () {
            return (this._device.viewport.width > 768) ? "desktop" : "touch";
        }

    };
}));


//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical=root.elliptical || {};
        root.elliptical.extensions=root.elliptical.extensions || {};
        root.elliptical.extensions.drawer = factory();
        root.returnExports=elliptical.extensions.drawer;
    }
}(this, function () {

    return {
        /**
         * create a drawer container
         * @param element {Object}
         * @param dataClass {String}
         * @private
         */
        _createDrawer: function (element, dataClass) {
            //prevent multiple drawers
            if(this._data.get('locked')){
                return;
            }
            this._data.set('locked',true);
            //get reference to the container
            var container=$('ui-container');
            this._data.set('container',container);

            //get ref to the toggle container
            var transformContainer = container.parent();
            this._data.set('transformContainer',transformContainer);

            //create the drawer elements
            var drawer=$('<touch-ui-drawer></touch-ui-drawer>');
            if (dataClass) {
                drawer.addClass(dataClass);
            }
            var height = this._device.viewport.height;

            drawer.css({
                'min-height': height + 'px'
            });
            if(!this._device.touch){
                drawer.css({
                    'position': 'relative'
                });
            }
            var drawerHeader = $('<header></header>');

            //append header to drawer
            drawer.append(drawerHeader);

            var drawerSection = $('<section></section>');
            drawer.append(drawerSection);

            //insert drawer into the DOM
            container.before(drawer);

            //save references
            this._data.set('drawer',drawer);
            this._data.set('drawerHeader',drawerHeader);
            this._data.set('drawerSection',drawerSection);
        },

        /**
         * open the drawer
         * @param callback {function}
         * @param fnClose {function}
         * @private
         */
        _openDrawer: function (callback, fnClose) {

            //show drawer
            this._showDrawer();


            //get viewport height
            var height = this._device.viewport.height;
            if(this.options) this.options.height=height;
            else{
                this.height = height;
            }

            var self = this;

            //get ref to containers
            var container = this._data.get('container');
            var transformContainer = this._data.get('transformContainer');

            //hardware accelerate the transition
            this._setHardwareAcceleration(transformContainer);

            //container overflow
            //this._setContainerOverflow(transformContainer);

            //set container to viewport height and add component classes
            container
                .addClass('ui-fixed-toggle-container')
                .css({
                    height: height + 'px'
                })
                .addClass('ui-drawer-box-shadow');


            //append overlay to container
            var overlay = $('<ui-overlay></ui-overlay>');
            overlay.addClass('show');
            container.append(overlay);

            //save ref to overlay
            this._data.set('overlay',overlay);

            var overlayBackground=(this.options) ? this.options.overlayBackground : this.overlayBackground;
            var overlayOpacity=(this.options) ? this.options.overlayOpacity : this.overlayOpacity;
            var overlayOpenDuration=(this.options) ? this.options.overlayOpenDuration : this.overlayOpenDuration;
            var transformDuration=(this.options) ? this.options.transformDuration : this.transformDuration;
            var transformDelay=(this.options) ? this.options.transformDelay : this.transformDelay;
            var translateX=(this.options) ? this.options.translateX : this.translateX;

            overlay.transition({
                background: overlayBackground,
                opacity: overlayOpacity,
                duration: overlayOpenDuration

            });

            //transition container
            var opts = {};
            opts.duration = transformDuration;
            opts.delay = transformDelay;
            opts.easing = 'ease-in-out';
            var coordinates = {};
            coordinates.x = translateX;
            coordinates.y = 0;
            coordinates.z = 0;
            opts.coordinates = coordinates;
            opts.transitionEnd = true;

            /* click special event name */
            var click=this._data.click;
            var closeEvent=this._closeDrawer.bind(this);
            this.element.trigger('drawer.open',{open:true,closeEvent:closeEvent});
            this._3dTransition(container, opts, function () {
                self._resetHardwareAcceleration(transformContainer);
                self._resetTransition($(this));

                if (callback) {
                    callback();
                }
            });

            overlay.on(click, function () {
                if (fnClose) {
                    fnClose();
                }
            });


        },

        /**
         * close the drawer
         * @param callback
         * @private
         */
        _closeDrawer: function (callback) {
            var height=(this.options) ? this.options.height : this.height;
            //get container ref
            var container = this._data.get('container');
            var scrollTop=window.scrollY;
            /* if drawer has been vertically scrolled, we need to add scrollY to
             the fixed toggle container height(=viewport height when opened) on close
             to avoid revealing underneath content at scrollY.
             */
            if(scrollTop > 0){
                height+=scrollTop;
                container.css({
                    height:height + 'px'
                });

                /* additionally, to avoid navbar/topbar and drawer header dsiappearing from viewport on drawer close, we
                 need to assign top=scrollTop on those elements during the duration of the close animation
                 */
                this.element.css({
                    top:scrollTop + 'px'
                });

                var drawerHeader=this._data.get('drawerHeader');
                drawerHeader.css({
                    top:scrollTop + 'px'
                })
            }

            var transformContainer = this._data.get('transformContainer');
            var overlayBackground=(this.options) ? this.options.overlayBackground : this.overlayBackground;
            var overlayCloseDuration=(this.options) ? this.options.overlayCloseDuration : this.overlayCloseDuration;
            var transformDuration=(this.options) ? this.options.transformDuration : this.transformDuration;
            var transformDelay=(this.options) ? this.options.transformDelay : this.transformDelay;

            //get overlay ref
            var overlay = this._data.get('overlay');

            var self = this;
            //hardware accelerate the transition
            this._setHardwareAcceleration(transformContainer);

            var opts = {};
            opts.duration = transformDuration;
            opts.delay = transformDelay;
            opts.easing = 'ease-in-out';
            var coordinates = {};
            coordinates.x = 0;
            coordinates.y = 0;
            coordinates.z = 0;
            opts.coordinates = coordinates;
            opts.transitionEnd = true;
            this.element.trigger('drawer.close',{open:false});
            this._3dTransition(container, opts, function () {
                self._resetHardwareAcceleration(transformContainer);
                self._resetContainer(container);
                self._hideDrawer();

                if (callback) {
                    callback();
                }
            });

            /* click special event name */
            var click=this._data.click;

            overlay.off(click);

            overlay.transition({
                background: overlayBackground,
                opacity: 0,
                duration: overlayCloseDuration
            }, function () {
                overlay.remove();

            });

        },

        /**
         * show the drawer
         * @private
         */
        _showDrawer: function () {
            var height = this._device.viewport.height;
            var drawer=this._data.get('drawer');
            drawer.css({
                'min-height': height + 'px',
                'display':'block'
            });


        },

        /**
         * hide the drawer
         * @private
         */
        _hideDrawer: function () {
            var drawerHeader=this._data.get('drawerHeader');
            drawerHeader.css({
                top:''
            });
            var drawer=this._data.get('drawer');
            drawer.hide();
        },

        /**
         * remove the drawer
         * @private
         */
        _removeDrawer: function () {
            var drawer=this._data.get('drawer');
            if(drawer){
                drawer.remove();
                this._data.set('drawer',null);
            }
            this._data.set('locked',false);
            var container = this._data.get('container');
            this._resetContainer(container);
            var overlay = this._data.get('overlay');
            if (overlay) {
                overlay.remove();
            }
            var transformContainer = this._data.get('transformContainer');
            this._resetHardwareAcceleration(transformContainer);

        },


        /*==========================================
         PUBLIC METHODS
         *===========================================*/

        /**
         *  @public
         */
        showDrawer: function () {
            this._showDrawer();
        },

        /**
         *
         * @public
         */
        hideDrawer: function () {
            this._hideDrawer();
        }


    };
}));

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical=root.elliptical || {};
        root.elliptical.extensions=root.elliptical.extensions || {};
        root.elliptical.extensions.transition = factory();
        root.returnExports = root.elliptical.extensions.transition;
    }
}(this, function () {

    return {

        _transition: function (element, options, callback) {
            $.transition=$.transition || $.transit;
            if (!(element instanceof jQuery)) element=$(element);
            options = options || {};
            if (options === {}) {
                options.duration = 300;
                options.preset = 'fadeIn';
            }
            if(options.preset==='none'){
                element.hide();
                return;
            }
            element.transition(options, function () {
                if (callback) {
                    callback.call(element[ 0 ]);
                }
            });
        }
    };
}));
//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical=root.elliptical || {};
        root.elliptical.extensions=root.elliptical.extensions || {};
        root.elliptical.extensions.transform = factory();
        root.returnExports = root.elliptical.extensions.transform;
    }
}(this, function () {
    var provider = $.transforms;
    var HARDWARE_ACCELERATED_CLASS='ui-hardware-accelerated';
    var OVERFLOW_CONTAINER_CLASS='ui-overflow-container';
    var FIXED_TOGGLE_CONTAINER_CLASS='ui-fixed-toggle-container';
    var BOX_SHADOW_CLASS='ui-drawer-box-shadow';

    return {

        _setHardwareAcceleration: function (element) {
            this._data.set('toggleAcceleration', provider.setHardwareAcceleration(element, HARDWARE_ACCELERATED_CLASS));
        },

        _resetHardwareAcceleration: function (element) {
            provider.resetHardwareAcceleration(element, this._data.get('toggleAcceleration'), HARDWARE_ACCELERATED_CLASS);
        },

        _setContainerOverflow: function (element) {
            this._data.set('toggleOverflow', provider.setContainerOverflow(element, OVERFLOW_CONTAINER_CLASS));
        },

        _resetContainerOverflow: function (element) {
            provider.resetContainerOverflow(element, OVERFLOW_CONTAINER_CLASS);
        },

        _resetContainer: function (container) {
            provider.resetContainer(container, BOX_SHADOW_CLASS, FIXED_TOGGLE_CONTAINER_CLASS);
        },

        _resetTransition: function (element) {
            provider.resetTransition(element);
        },

        _resetTransform: function (element) {
            provider.resetTransform(element);
        },

        _transform: function (element, coordinates) {
            provider.transform(element, coordinates);
        },

        _3dTransition: function (element, opts, callback) {
            provider.transition3d(element, opts, callback);
        }

    };
}));
//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical=root.elliptical || {};
        root.elliptical.extensions=root.elliptical.extensions || {};
        root.elliptical.extensions.template = factory(root.elliptical.utils,root.dust);
        root.returnExports = root.elliptical.extensions.template;
    }
}(this, function (utils,dust) {
    var random=utils.random;

    return {

        __precompile:function(template,id){
            template = template.replace(/&quot;/g,'"');
            var compiled=dust.compile(template,id);
            dust.loadSource(compiled);
        },

        _precompileTemplate:function(node,templateId){
            var html=node.innerHTML;
            this.__precompile(html,templateId);
        },

        _render:function(node,templateId,context,callback){
            dust.render(templateId, context, function (err, out) {
                if(out){
                    node.innerHTML=out;
                }
                if (callback) {
                    callback(err, out);
                }
            });
        },

        _renderTemplate:function(templateId,context,callback){
            dust.render(templateId, context, callback);
        },

        _renderTemplateString:function(str,context,callback){
            var id='template-' + random.str(6);
            this.__precompile(str,id);
            this._renderTemplate(id,context,callback);
        }
    };
}));

//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical = root.elliptical || {};
        root.elliptical.extensions = root.elliptical.extensions || {};
        root.elliptical.extensions.event = factory();
        root.returnExports = root.elliptical.extensions.event;
    }
}(this, function () {

    return {

        _onEventTrigger: function (evt, data) {
            this._triggerEvent(evt, data);
        },

        _triggerEvent: function (evt, data) {
            var event = $.Event(evt);
            this._trigger(evt, event, data);
        },

        _trigger: function (type, event, data) {
            if(this.options){
                this._jqTrigger(type,event,data);
            }else{
                this.__triggerEvent(type,data);
            }
        },

        __triggerEvent:function(evt,data){
            var nameSpacedTagName = this._utils.string.tagNameToNamespace(tagName);
            evt=nameSpacedTagName + '.' + evt;
            this.element.trigger(evt,data);
        },

        _jqTrigger:function(type,event,data){
            try {
                var prop, orig,
                    callback = this.options[type];

                data = data || {};
                var prefix = this.widgetEventPrefix;
                var tagName = this.bindings[0].tagName.toLowerCase();
                var tagArray = tagName.split('-');
                var tagLength = tagArray.length;
                var nameSpacedTagName = this._utils.string.tagNameToNamespace(tagName);
                var arr = prefix.toArrayFromCamelCase();
                var nameSpacedPrefix = this._utils.array.toNamespaceFromArray(arr);
                if (nameSpacedPrefix === nameSpacedTagName) {
                    prefix = nameSpacedPrefix;
                } else if (tagLength > 1) {
                    prefix = nameSpacedTagName + '.' + prefix;
                } else {
                    prefix = this.namespace + '.' + prefix;
                }

                event = $.Event(event);
                event.type = ( type === prefix ?
                    type :
                prefix + '.' + type ).toLowerCase();
                // the original event may come from any element
                // so we need to reset the target on the new event
                event.target = this.element[0];

                // copy original event properties over to the new event
                orig = event.originalEvent;
                if (orig) {
                    for (prop in orig) {
                        if (!( prop in event )) {
                            event[prop] = orig[prop];
                        }
                    }
                }

                this.element.trigger(event, data);
                return !( $.isFunction(callback) &&
                callback.apply(this.element[0], [event].concat(data)) === false ||
                event.isDefaultPrevented() );
            } catch (ex) {

            }
        }

    };
}));
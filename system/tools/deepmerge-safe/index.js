'use strict';

/**
 * Drop-in replacement for the "deepmerge" package (same API: deepmerge(x, y, options), deepmerge.all(list, options);
 * options arrayMerge, isMergeableObject, customMerge, clone) that never copies the keys __proto__, constructor
 * or prototype and never writes through an inherited property, so merged objects cannot be prototype-poisoned
 * (GHSA-gcqx-w48m-w2h4, no fixed upstream release). Used through "overrides" in the workspace package.json.
 */

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REACT_ELEMENT = typeof Symbol === 'function' && Symbol.for ? Symbol.for('react.element') : 0xeac7;

function isNonNullObject(value) {
  return !!value && typeof value === 'object';
}

function isSpecial(value) {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object RegExp]' || tag === '[object Date]' || value.$$typeof === REACT_ELEMENT;
}

function defaultIsMergeableObject(value) {
  return isNonNullObject(value) && !isSpecial(value);
}

function emptyTarget(value) {
  return Array.isArray(value) ? [] : {};
}

function cloneUnlessOtherwiseSpecified(value, options) {
  return options.clone !== false && options.isMergeableObject(value) ? deepmerge(emptyTarget(value), value, options) : value;
}

function defaultArrayMerge(target, source, options) {
  return target.concat(source).map((element) => cloneUnlessOtherwiseSpecified(element, options));
}

function getMergeFunction(key, options) {
  if (!options.customMerge) return deepmerge;
  const custom = options.customMerge(key);
  return typeof custom === 'function' ? custom : deepmerge;
}

function ownEnumerableSymbols(target) {
  return Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(target).filter((s) => Object.prototype.propertyIsEnumerable.call(target, s)) : [];
}

function keysOf(target) {
  return Object.keys(target).concat(ownEnumerableSymbols(target));
}

function propertyIsOnObject(object, property) {
  try {
    return property in object;
  } catch {
    return false;
  }
}

/** keys that must never be written: the prototype keys, and inherited or non-writable properties of the target */
function propertyIsUnsafe(target, key) {
  if (typeof key === 'string' && UNSAFE_KEYS.has(key)) return true;
  return propertyIsOnObject(target, key) && !(Object.prototype.hasOwnProperty.call(target, key) && Object.prototype.propertyIsEnumerable.call(target, key));
}

function mergeObject(target, source, options) {
  const destination = {};
  if (options.isMergeableObject(target)) {
    for (const key of keysOf(target)) {
      if (typeof key === 'string' && UNSAFE_KEYS.has(key)) continue;
      destination[key] = cloneUnlessOtherwiseSpecified(target[key], options);
    }
  }
  for (const key of keysOf(source)) {
    if (propertyIsUnsafe(target, key)) continue;
    if (propertyIsOnObject(target, key) && options.isMergeableObject(source[key])) {
      destination[key] = getMergeFunction(key, options)(target[key], source[key], options);
    } else {
      destination[key] = cloneUnlessOtherwiseSpecified(source[key], options);
    }
  }
  return destination;
}

function deepmerge(target, source, options) {
  options = options || {};
  options.arrayMerge = options.arrayMerge || defaultArrayMerge;
  options.isMergeableObject = options.isMergeableObject || defaultIsMergeableObject;
  // passed to custom array mergers so they can clone their elements
  options.cloneUnlessOtherwiseSpecified = cloneUnlessOtherwiseSpecified;

  const sourceIsArray = Array.isArray(source);
  const targetIsArray = Array.isArray(target);
  if (sourceIsArray !== targetIsArray) return cloneUnlessOtherwiseSpecified(source, options);
  if (sourceIsArray) return options.arrayMerge(target, source, options);
  return mergeObject(target, source, options);
}

deepmerge.all = function deepmergeAll(array, options) {
  if (!Array.isArray(array)) throw new Error('first argument should be an array');
  return array.reduce((prev, next) => deepmerge(prev, next, options), {});
};

module.exports = deepmerge;
module.exports.default = deepmerge;

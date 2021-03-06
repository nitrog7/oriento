'use strict';

var Promise = require('bluebird'),
  Class = require('./index');

/**
 * The field values.
 *
 * @type {Object|null}
 */
exports.fields = null;

/**
 * The value of the custom fields.
 *
 * @return {Object} The custom fields.
 */
exports.valueOf = function() {
  return this.custom.fields;
};

/**
 * Get the value of the given custom field.
 *
 * @param  {String} key The name of the field to get.
 * @return {Mixed}      The field value, or undefined if it doesn't exist.
 */
exports.get = function(key) {
  return this.custom.fields ? this.custom.fields[key] : undefined;
};

/**
 * Set a custom field.
 *
 * @param   {String|Object} key   The key to set, or map of keys to values.
 * @param   {String}        value The value to set, if `key` is not an object.
 * @promise {Object|null}         The new set of custom fields, or null if none are present.
 */
exports.set = function(key, value) {
  var self = this;

  var statements = [],
    obj, keys, total, i;
  if(typeof key !== 'object') {
    obj = {};
    obj[key] = value;
  }
  else {
    obj = key;
  }
  keys = Object.keys(obj);
  total = keys.length;
  for(i = 0; i<total; i++) {
    key = keys[i];
    if(self instanceof Class) {
      statements.push(self.db.query('ALTER CLASS ' + self.name + ' CUSTOM ' + key + '=' + obj[key]));
    } else {
      statements.push(self.class.db.query('ALTER PROPERTY ' + self.class.name + '.' + self.name + ' CUSTOM ' + key +
        '=' + obj[key]));
    }
  }
  return Promise.all(statements)
    .then(function() {
      return self.reload();
    })
    .then(function() {
      return self.custom.fields;
    });
};

/**
 * Unset the custom field with the given name,
 *
 * @param   {String}      key The name of the custom field to remove.
 * @promise {Object|null}     The new set of custom fields, or null if none are present.
 */
exports.unset = function(key) {
  return this.custom.set(key, null);
};

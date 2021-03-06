'use strict';

var Promise = require('bluebird'),
  RID = require('../recordid'),
  errors = require('../errors');

/**
 * Insert the given record into the database.
 *
 * @param  {Object} record  The record to insert.
 * @param  {Object} options The command options.
 * @promise {Object}        The inserted record.
 */
exports.create = function(record, options) {
  var self = this,
    className = record['@class'] || '',
    rid, promise;

  options = options || {};
  if(record['@rid']) {
    promise = Promise.resolve(record['@rid']);
  }
  else if(className && className.defaultClusterId) {
    promise = Promise.resolve(new RID({
      cluster: className.defaultClusterId
    }));
  }
  else if(className !== '') {
    promise = self.cluster.getByName(className);
  }

  return promise
    .then(function(cluster) {
      if(!cluster) {
        return Promise.reject(new errors.Operation('Cannot create record -  cluster ID and/or class is invalid.'));
      }
      else if(cluster instanceof RID) {
        rid = cluster;
      }
      else {
        rid = new RID({
          cluster: cluster.id || cluster,
          position: -1
        });
      }
      return self.send('record-create', {
        segment: options.segment != null ? +options.segment : -1,
        cluster: rid.cluster,
        record: record
      });
    })
    .then(function(results) {
      rid.position = results.position;
      record['@rid'] = rid;
      record['@version'] = results.version;
      return record;
    });
};

/**
 * Read the given record.
 *
 * @param  {Object} record  The record to load.
 * @param  {Object} options The query options.
 * @promise {Object}        The loaded record.
 */
exports.get = function(record, options) {
  var self = this;

  if(Array.isArray(record)) {
    return Promise.all(record.map(self.record.read, self));
  }

  var extracted = extractRecordId(record),
    rid = extracted[0];

  record = extracted[1];
  options = options || {};

  if(!rid) {
    return Promise.reject(new errors.Operation('Cannot read - no record id specified'));
  }

  return self.send('record-load', {
    cluster: rid.cluster,
    position: rid.position,
    fetchPlan: options.fetchPlan || '',
    tombstones: options.tombstones || false
  })
    .then(function(response) {
      if(response.records.length === 0) {
        return Promise.reject(new errors.Request('No such record'));
      }
      else if(response.records.length === 1) {
        return response.records[0];
      } else {
        return self.record.resolveReferences(response.records[0], response.records.slice(1));
      }
    });
};

/**
 * Resolve references to child records for the given record.
 *
 * @param  {Object}   record   The primary record.
 * @param  {Object[]} children The child records.
 * @return {Object}            The primary record with references replaced.
 */
exports.resolveReferences = function(record, children) {
  var total = children.length,
    indexed = {},
    replaceRecordIds = recordIdResolver(),
    child, g;

  for(g = 0; g<total; g++) {
    child = children[g];
    indexed[child['@rid']] = child;
  }

  for(g = 0; g<total; g++) {
    child = children[g];
    replaceRecordIds(indexed, child);
  }

  return replaceRecordIds(indexed, record);
};

function recordIdResolver() {
  var seen = {};

  /**
   * Replace references to records with their instances, where possible.
   *
   * @param  {Object} records The map of record ids to record instances.
   * @param  {Object} obj     The object to replace references within
   * @return {Object}         The object with references replaced.
   */
  var replaceRecordIds = function(records, obj) {
    if(!obj || typeof obj !== 'object') {
      return obj;
    }
    else if(Array.isArray(obj)) {
      return obj.map(replaceRecordIds.bind(this, records));
    }
    else if(obj instanceof RID && records[obj]) {
      return records[obj];
    }
    if(obj['@rid']) {
      if(seen[obj['@rid']]) {
        return seen[obj['@rid']];
      } else {
        seen[obj['@rid']] = obj;
      }
    }

    var keys = Object.keys(obj);

    for(var g = 0; g<keys.length; g++) {
      var key = keys[g];
      var value = obj[key];

      if(!value || typeof value !== 'object' || key[0] === '@') {
        continue;
      }

      if(value instanceof RID) {
        if(records[value]) {
          obj[key] = records[value];
        }
      }
      else if(Array.isArray(value)) {
        obj[key] = value.map(replaceRecordIds.bind(this, records));
      } else {
        obj[key] = replaceRecordIds(records, value);
      }
    }

    return obj;
  };

  return replaceRecordIds;
}
/**
 * Read the metadata for the given record.
 *
 * @param  {Object} record  The record to load.
 * @promise {Object}        The record object with loaded meta data.
 */
exports.meta = function(record) {
  var self = this;

  if(Array.isArray(record)) {
    return Promise.all(record.map(self.record.read, self));
  }

  var extracted = extractRecordId(record),
    rid = extracted[0];

  record = extracted[1];

  if(!rid) {
    return Promise.reject(new errors.Operation('Cannot read - no record id specified'));
  }

  return self.send('record-metadata', {
    cluster: rid.cluster,
    position: rid.position
  })
    .then(function(response) {
      record['@rid'] = rid;
      record['@version'] = response.version;
      return record;
    });
};

/**
 * Update the given record.
 *
 * @param  {Object} record  The record to update.
 * @param  {Object} options The query options.
 * @promise {Object}        The updated record.
 */
exports.update = function(record, options) {
  var self = this;

  var extracted = extractRecordId(record),
    rid = extracted[0],
    promise, data;

  record = extracted[1];
  options = options || {};

  if(!rid) {
    return Promise.reject(new errors.Operation('Cannot update record -  record ID is not specified or invalid.'));
  }

  record['@type'] = 'd';

  data = {
    cluster: rid.cluster,
    position: rid.position,
    mode: options.mode || 0
  };

  if(options.preserve && rid) {
    promise = self.record.get(rid)
      .then(function(found) {
        var keys = Object.keys(record);

        for(var g = 0; g<keys.length; g++) {
          var key = keys[g];
          found[key] = record[key];
        }
        return found;
      });
  } else {
    promise = Promise.resolve(record);
  }

  return promise
    .then(function(record) {
      data.record = record;
      return self.send('record-update', data)
        .then(function(results) {
          record['@version'] = (results ? results.version : 0) || 0;
          return record;
        });
    });
};

/**
 * Delete the given record.
 *
 * @param   {String|RID|Object} record  The record or record id to delete.
 * @param   {Object}            options The query options.
 * @promise {Object}                    The deleted record object.
 */
exports.delete = function(record, options) {
  if(!record) {
    return Promise.reject(new errors.Operation('Cannot delete - no record specified'));
  }
  var extracted = extractRecordId(record),
    rid = extracted[0];

  record = extracted[1];
  options = options || {};

  if(!rid) {
    return Promise.reject(new errors.Operation('Cannot delete - no record id specified'));
  }

  return this.send('record-delete', {
    cluster: rid.cluster,
    position: rid.position,
    version: record['@version'] != null ? +record['@version'] : -1,
    mode: options.mode || 0
  })
    .then(function() {
      return record;
    });
};

/**
 * Extract the record id and record from the given argument.
 *
 * @param  {String|RID|Object} record The record.
 * @return {[RID, Object]}            The record id and object.
 */
function extractRecordId(record) {
  var rid = false;
  if(typeof record === 'string') {
    rid = RID.parse(record);
    record = {
      '@rid': rid
    };
  }
  else if(record instanceof RID) {
    rid = record;
    record = {
      '@rid': rid
    };
  }
  else if(record['@rid']) {
    record['@rid'] = rid = RID.parse(record['@rid']);
  }
  return [rid, record];
}
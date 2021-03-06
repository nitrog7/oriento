'use strict';

var Operation = require('../operation'),
  constants = require('../constants'),
  serializer = require('../serializer'),
  writer = require('../writer');

module.exports = Operation.extend({
  id: 'REQUEST_COMMAND',
  opCode: 41,
  writer: function() {
    if(this.data.mode === 'a') {
      this.data.class = 'com.orientechnologies.orient.core.sql.query.OSQLAsynchQuery';
    }
    this
      .writeByte(this.opCode)
      .writeInt(this.data.sessionId || -1)
      .writeChar(this.data.mode || 's')
      .writeBytes(this.serializeQuery());

  },
  serializeQuery: function() {
    var buffers = [
      writer.writeString(this.data.class),
      writer.writeString(this.data.query)
    ];

    if(this.data.class === 'com.orientechnologies.orient.core.sql.query.OSQLSynchQuery' ||
      this.data.class === 'com.orientechnologies.orient.core.sql.query.OSQLAsynchQuery') {
      buffers.push(
        writer.writeInt(this.data.limit),
        writer.writeString(this.data.fetchPlan || '')
      );

      if(this.data.params) {
        buffers.push(writer.writeString(serializeParams(this.data.params)));
      } else {
        buffers.push(writer.writeInt(0));
      }
    } else {
      if(this.data.params) {
        buffers.push(
          writer.writeBoolean(true),
          writer.writeString(serializeParams(this.data.params))
        );
      } else {
        buffers.push(writer.writeBoolean(false));
      }
      buffers.push(writer.writeBoolean(false));
    }
    return Buffer.concat(buffers);
  },
  reader: function() {
    this
      .readStatus('status')
      .readCommandResult('results');
  },
  readCommandResult: function(fieldName, reader) {
    var self = this;

    self.payloads = [];
    self.readOps.push(function(data) {
      data[fieldName] = self.payloads;
      self.stack.push(data[fieldName]);
      self.readPayload('payloadStatus', function() {
        self.stack.pop();
      });
    });
    return self;
  },
  readPayload: function(payloadFieldName, reader) {
    return this.readByte(payloadFieldName, function(data, fieldName) {
      var record = {};
      switch(data[fieldName]) {
        case 0:
          if(reader) {
            reader.call(this);
          }
          break;
        case 110: // null
          record.type = 'r';
          record.content = null;
          this.payloads.push(record);
          this.readPayload(payloadFieldName, reader);
          break;
        case 1:
        case 114:
          // a record
          record.type = 'r';
          this.payloads.push(record);
          this.stack.push(record);
          this.readRecord('content', function() {
            this.stack.pop();
            this.readPayload(payloadFieldName, reader);
          });
          break;
        case 2:
          // prefeteched record
          record.type = 'p';
          this.payloads.push(record);
          this.stack.push(record);
          this.readRecord('content', function() {
            this.stack.pop();
            this.readPayload(payloadFieldName, reader);
          });
          break;
        case 97:
          // serialized result
          record.type = 'f';
          this.payloads.push(record);
          this.stack.push(record);
          this.readString('content', function() {
            this.stack.pop();
            this.readPayload(payloadFieldName, reader);
          });
          break;
        case 108:
          // collection of records
          record.type = 'l';
          this.payloads.push(record);
          this.stack.push(record);
          this.readCollection('content', function() {
            this.stack.pop();
            this.readPayload(payloadFieldName, reader);
          });
          break;
        default:
          reader.call(this);
      }
    });
  }
});

/**
 * Serialize the parameters for a query.
 *
 * > Note: There is a bug in OrientDB where special kinds of string values
 * > need to be twice quoted *in parameters*. Hence the need for this specialist function.
 *
 * @param  {Object} data The data to serialize.
 * @return {String}      The serialized data.
 */
function serializeParams(data) {
  var keys = Object.keys(data.params);

  for(var g = 0; g<keys.length; g++) {
    var key = keys[g];
    var value = data.params[key];

    if(typeof value === 'string') {
      var c = value.charAt(0);

      if(c === '#' || c === '<' || c === '[' || c === '(' || c === '{' || c === '0' || +c) {
        data.params[key] = '"' + value + '"';
      }
    }
  }

  return serializer.serializeDocument(data);
}
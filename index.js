var noble = require('noble')
var bleno = require('bleno')
var util = require('util')
var crypto = require('crypto')
var through = require('through2')
var duplexify = require('duplexify')
var events = require('events')
var debug = require('debug')('ble-swarm')

var noop = function () {}

var Service = function (id, nounce, opts) {
  bleno.PrimaryService.call(this, {
    uuid: id,
    characteristics: [
      new StreamDataCharacteristic(nounce, opts)
    ]
  })
}

util.inherits(Service, bleno.PrimaryService)

var StreamDataCharacteristic = function (nounce, opts) {
  this.options = opts
  bleno.Characteristic.call(this, {
    uuid: nounce,
    properties: ['read', 'write'],
    descriptors: [
      new bleno.Descriptor({
        uuid: opts.descriptorUuid || '2901',
        value: opts.descriptorValue || 'Send or receive data.'
      })
    ]
  })
}

util.inherits(StreamDataCharacteristic, bleno.Characteristic)

StreamDataCharacteristic.prototype.onWriteRequest = function(data, offset, withoutResponse, cb) {
  if (offset) return cb(this.RESULT_ATTR_NOT_LONG)
  var self = this
  this.options.write(data, function (err) {
    cb(self.RESULT_SUCCESS)
  })
}

StreamDataCharacteristic.prototype.onReadRequest = function(offset, cb) {
  if (offset) return cb(this.RESULT_ATTR_NOT_LONG, null)
  var self = this
  this.options.read(function (err, data) {
    if (err) return cb(self.RESULT_ATTR_NOT_LONG, null)
    cb(self.RESULT_SUCCESS, data)
  })
}

module.exports = function (opts, onpeer) {
  if (opts === 'function') return module.exports(null, opts)
  if (!opts) opts = {}

  var uuid = opts.uuid || '13333333333333333333333333333337'
  var nounce = crypto.randomBytes(16).toString('hex')
  var that = new events.EventEmitter()

  if (onpeer) that.on('peer', onpeer)

  that.peers = []

  var forwardData = function (stream, id, port) {
    var write = function (data, cb) {
      var loop = function () {
        if (!chars[id]) return setTimeout(loop, 1000)
        var chunk = new Buffer(Math.min(data.length + 2, 512))
        chunk.writeUInt16BE(port, 0)
        data.copy(chunk, 2)
        data = data.slice(510)
        chars[id].write(chunk, true, function (err) {
          if (err) return cb(err)
          if (!data.length) return cb()
          loop()
        })
      }

      loop()
    }

    stream.on('end', function () {
      write(new Buffer(0), noop)
    })

    var onreadable = function () {
      var data = stream.read()
      if (!data) return stream.once('readable', onreadable)
      write(data, onreadable)
    }

    onreadable()
  }

  var onstream = function (stream, id) {
    that.peers.push(stream)

    stream.on('end', function () {
      var i = that.peers.indexOf(stream)
      if (i > -1) that.peers.splice(i, 1)
    })

    that.emit('peer', stream, id)
  }

  var ports = []
  var chars = {}

  var service = new Service(uuid, nounce, {
    write: function (data, cb) {
      var remotePort = data.readUInt16BE(0)
      if (!ports[remotePort]) return
      ports[remotePort](data.slice(2), cb)
    },
    read: function (cb) {
      var readable = through()
      var writable = through()

      readable.on('end', function () {
        ports[localPort] = null
      })

      var incoming = function (data, cb) {
        if (remoteId) {
          if (!data.length) readable.end(cb)
          else readable.write(data, cb)
          return
        }

        remoteId = data.slice(2).toString('hex')
        remotePort = data.readUInt16BE(0)
        forwardData(writable, remoteId, remotePort)
        onstream(duplexify(writable, readable), remoteId)

        cb()
      }

      var localPort = alloc()
      var remotePort = -1
      var remoteId = null

      ports[localPort] = incoming

      var buf = new Buffer(2)
      buf.writeUInt16BE(localPort, 0)
      cb(null, buf)
    }
  })

  noble.on('stateChange', function (state) {
    debug('stateChange', state)
    if (state === 'poweredOn') {
      noble.startScanning([uuid], false)
    } else {
      noble.stopScanning()
    }
  })

  var alloc = function () {
    var i = ports.indexOf(null)
    if (i > -1) return i
    ports.push(null)
    return ports.length - 1
  }

  var ondiscover = function (ch) {
    var uuid = ch.uuid
    chars[uuid] = ch
    if (uuid >= nounce) return

    ch.read(function (err, buf) {
      if (err) return

      var readable = through()
      var writable = through()

      var incoming = function (data, cb) {
        if (!data.length) readable.end(cb)
        else readable.write(data, cb)
      }

      var remotePort = buf.readUInt16BE(0)
      var localPort = alloc()

      ports[localPort] = incoming

      var buf = new Buffer(20)

      readable.on('end', function () {
        ports[localPort] = null
      })

      buf.writeUInt16BE(remotePort, 0)
      buf.writeUInt16BE(localPort, 2)
      new Buffer(nounce, 'hex').copy(buf, 4)

      ch.write(buf, true, function () {
        forwardData(writable, uuid, remotePort)
        onstream(duplexify(writable, readable), uuid)
      })
    })
  }

  noble.on('discover', function (peripheral) {
    debug('discovered peripheral', peripheral)
    peripheral.connect(function (err) {
      if (err) throw err
      peripheral.discoverServices([uuid], function (err, services) {
        if (err) throw err
        debug('discovered services for ' + uuid, services)
        services[0].discoverCharacteristics([], function (err, characteristics) {
          if (err) throw err
          debug('discovered characteristics for services[0]', characteristics)
          ondiscover(characteristics[0])
        })
      })
    })
  })

  bleno.on('stateChange', function (state) {
    if (state === 'poweredOn') {
      bleno.startAdvertising('BLEStream', [uuid], function (err) {
        if (err) throw err
      })
    } else {
      bleno.stopAdvertising()
    }
  })

  bleno.on('advertisingStart', function(err) {
    if (!err) {
      bleno.setServices([service])
    }
  })

  return that
}

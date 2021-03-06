var sodium = require('libsodium-wrappers')
var assert = require('nanoassert')
var clone = require('clone')
var symmetricState = require('./symmetric-state')
var cipherState = require('./cipher-state')
var dh = require('./dh')

var PKLEN = dh.PKLEN
var SKLEN = dh.SKLEN

module.exports = Object.freeze({
  initialize,
  writeMessage,
  readMessage,
  destroy,
  keygen,
  seedKeygen,
  SKLEN,
  PKLEN
})

function HandshakeState () {
  this.symmetricState = sodium.sodium_malloc(symmetricState.STATELEN)

  this.initiator = null

  this.spk = null
  this.ssk = null

  this.epk = null
  this.esk = null

  this.rs = null
  this.re = null

  this.messagePatterns = null
}

const INITIATOR = Symbol('initiator')
const RESPONDER = Symbol('responder')

const TOK_S = Symbol('s')
const TOK_E = Symbol('e')
const TOK_ES = Symbol('es')
const TOK_SE = Symbol('se')
const TOK_EE = Symbol('ee')
const TOK_SS = Symbol('es')

// initiator, ->
// responder, <-
var PATTERNS = Object.freeze({
  N: {
    premessages: [
      [RESPONDER, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_ES]
    ]
  },
  K: {
    premessages: [
      [INITIATOR, TOK_S],
      [RESPONDER, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_ES, TOK_SS]
    ]
  },
  X: {
    premessages: [
      [RESPONDER, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_ES, TOK_S, TOK_SS]
    ]
  },
  NN: {
    premessages: [],
    messagePatterns: [
      [INITIATOR, TOK_E],
      [RESPONDER, TOK_E, TOK_EE]
    ]
  },
  KN: {
    premessages: [
      [INITIATOR, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E],
      [RESPONDER, TOK_E, TOK_EE, TOK_SE]
    ]
  },
  NK: {
    premessages: [
      [RESPONDER, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_ES],
      [RESPONDER, TOK_E, TOK_EE]
    ]
  },
  KK: {
    premessages: [
      [INITIATOR, TOK_S],
      [RESPONDER, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_ES, TOK_SS],
      [RESPONDER, TOK_E, TOK_EE, TOK_SE]
    ]
  },
  NX: {
    premessages: [],
    messagePatterns: [
      [INITIATOR, TOK_E],
      [RESPONDER, TOK_E, TOK_EE, TOK_S, TOK_ES]
    ]
  },
  KX: {
    premessages: [
      [INITIATOR, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E],
      [RESPONDER, TOK_E, TOK_EE, TOK_SE, TOK_S, TOK_ES]
    ]
  },
  XN: {
    premessages: [],
    messagePatterns: [
      [INITIATOR, TOK_E],
      [RESPONDER, TOK_E, TOK_EE],
      [INITIATOR, TOK_S, TOK_SE]
    ]
  },
  IN: {
    premessages: [],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_S],
      [RESPONDER, TOK_E, TOK_EE, TOK_SE]
    ]
  },
  XK: {
    premessages: [
      [RESPONDER, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_ES],
      [RESPONDER, TOK_E, TOK_EE],
      [INITIATOR, TOK_S, TOK_SE]
    ]
  },
  IK: {
    premessages: [
      [RESPONDER, TOK_S]
    ],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_ES, TOK_S, TOK_SS],
      [RESPONDER, TOK_E, TOK_EE, TOK_SE]
    ]
  },
  XX: {
    premessages: [],
    messagePatterns: [
      [INITIATOR, TOK_E],
      [RESPONDER, TOK_E, TOK_EE, TOK_S, TOK_ES],
      [INITIATOR, TOK_S, TOK_SE]
    ]
  },
  IX: {
    premessages: [],
    messagePatterns: [
      [INITIATOR, TOK_E, TOK_S],
      [RESPONDER, TOK_E, TOK_EE, TOK_SE, TOK_S, TOK_ES]
    ]
  }
})

function sodiumBufferCopy (src) {
  var buf = sodium.sodium_malloc(src.byteLength)
  buf.set(src)
  return buf
}

function initialize (handshakePattern, initiator, prologue, s, e, rs, re) {
  assert(Object.keys(PATTERNS).includes(handshakePattern))
  assert(typeof initiator === 'boolean')
  assert(prologue.byteLength != null)

  assert(s == null ? true : s.publicKey.byteLength === dh.PKLEN)
  assert(s == null ? true : s.secretKey.byteLength === dh.SKLEN)

  assert(e == null ? true : e.publicKey.byteLength === dh.PKLEN)
  assert(e == null ? true : e.secretKey.byteLength === dh.SKLEN)

  assert(rs == null ? true : rs.byteLength === dh.PKLEN)
  assert(re == null ? true : re.byteLength === dh.PKLEN)

  var state = new HandshakeState()

  var protocolName = Buffer.from(`Noise_${handshakePattern}_25519_XChaChaPoly_BLAKE2b`)

  symmetricState.initializeSymmetric(state.symmetricState, protocolName)
  symmetricState.mixHash(state.symmetricState, prologue)

  state.role = initiator === true ? INITIATOR : RESPONDER

  if (s != null) {
    assert(s.publicKey.byteLength === dh.PKLEN)
    assert(s.secretKey.byteLength === dh.SKLEN)

    state.spk = sodiumBufferCopy(s.publicKey)
    state.ssk = sodiumBufferCopy(s.secretKey)
  }

  if (e != null) {
    assert(e.publicKey.byteLength === dh.PKLEN)
    assert(e.secretKey.byteLength === dh.SKLEN)

    state.epk = sodiumBufferCopy(e.publicKey)
    state.esk = sodiumBufferCopy(e.secretKey)
  }

  if (rs != null) {
    assert(rs.byteLength === dh.PKLEN)
    state.rs = sodiumBufferCopy(rs)
  }
  if (re != null) {
    assert(re.byteLength === dh.PKLEN)
    state.re = sodiumBufferCopy(re)
  }

  // hashing
  var pat = PATTERNS[handshakePattern]

  for (var pattern of clone(pat.premessages)) {
    var patternRole = pattern.shift()

    for (var token of pattern) {
      switch (token) {
        case TOK_E:
          assert(state.role === patternRole ? state.epk.byteLength != null : state.re.byteLength != null)
          symmetricState.mixHash(state.symmetricState, state.role === patternRole ? state.epk : state.re)
          break
        case TOK_S:
          assert(state.role === patternRole ? state.spk.byteLength != null : state.rs.byteLength != null)
          symmetricState.mixHash(state.symmetricState, state.role === patternRole ? state.spk : state.rs)
          break
        default:
          throw new Error('Invalid premessage pattern')
      }
    }
  }

  state.messagePatterns = clone(pat.messagePatterns)

  assert(state.messagePatterns.filter(p => p[0] === INITIATOR).some(p => p.includes(TOK_S))
    ? (state.spk !== null && state.ssk !== null)
    : true, // Default if none is found
  'This handshake pattern requires a static keypair')

  return state
}

var DhResult = sodium.sodium_malloc(dh.DHLEN)
function writeMessage (state, payload, messageBuffer) {
  assert(state instanceof HandshakeState)
  assert(payload.byteLength != null)
  assert(messageBuffer.byteLength != null)

  var mpat = state.messagePatterns.shift()
  var moffset = 0

  assert(mpat != null)

  assert(state.role === mpat.shift())

  for (var token of mpat) {
    switch (token) {
      case TOK_E:
        assert(state.epk == null)
        assert(state.esk == null)

        state.epk = sodium.sodium_malloc(dh.PKLEN)
        state.esk = sodium.sodium_malloc(dh.SKLEN)

        dh.generateKeypair(state.epk, state.esk)

        messageBuffer.set(state.epk, moffset)
        moffset += state.epk.byteLength

        symmetricState.mixHash(state.symmetricState, state.epk)

        break

      case TOK_S:
        assert(state.spk.byteLength === dh.PKLEN)

        symmetricState.encryptAndHash(state.symmetricState, messageBuffer.subarray(moffset), state.spk)
        moffset += symmetricState.encryptAndHash.bytesWritten

        break

      case TOK_EE:
        dh[state.role === INITIATOR ? 'initiator' : 'responder'](DhResult, state.epk, state.esk, state.re)
        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break
      case TOK_ES:
        if (state.role === INITIATOR) dh.initiator(DhResult, state.epk, state.esk, state.rs)
        else dh.responder(DhResult, state.spk, state.ssk, state.re)

        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break
      case TOK_SE:
        if (state.role === INITIATOR) dh.initiator(DhResult, state.spk, state.ssk, state.re)
        else dh.responder(DhResult, state.epk, state.esk, state.rs)

        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break
      case TOK_SS:
        dh[state.role === INITIATOR ? 'initiator' : 'responder'](DhResult, state.spk, state.ssk, state.rs)

        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break

      default:
        throw new Error('Invalid message pattern')
    }
  }

  symmetricState.encryptAndHash(state.symmetricState, messageBuffer.subarray(moffset), payload)
  moffset += symmetricState.encryptAndHash.bytesWritten

  writeMessage.bytes = moffset

  if (state.messagePatterns.length === 0) {
    var tx = sodium.sodium_malloc(cipherState.STATELEN)
    var rx = sodium.sodium_malloc(cipherState.STATELEN)
    symmetricState.split(state.symmetricState, tx, rx)

    return {tx, rx}
  }
}
writeMessage.bytes = 0

function readMessage (state, message, payloadBuffer) {
  assert(state instanceof HandshakeState)
  assert(message.byteLength != null)
  assert(payloadBuffer.byteLength != null)

  var mpat = state.messagePatterns.shift()
  var moffset = 0

  assert(mpat != null)
  assert(mpat.shift() !== state.role)

  for (var token of mpat) {
    switch (token) {
      case TOK_E:
        assert(state.re == null)
        assert(message.byteLength - moffset >= dh.PKLEN)

        // PKLEN instead of DHLEN since they are different in out case
        state.re = sodium.sodium_malloc(dh.PKLEN)
        state.re.set(message.subarray(moffset, moffset + dh.PKLEN))
        moffset += dh.PKLEN

        symmetricState.mixHash(state.symmetricState, state.re)

        break

      case TOK_S:
        assert(state.rs == null)
        state.rs = sodium.sodium_malloc(dh.PKLEN)

        var bytes = 0
        if (symmetricState._hasKey(state.symmetricState)) {
          bytes = dh.PKLEN + 16
        } else {
          bytes = dh.PKLEN
        }

        assert(message.byteLength - moffset >= bytes)

        symmetricState.decryptAndHash(
          state.symmetricState,
          state.rs,
          message.subarray(moffset, moffset + bytes) // <- called temp in noise spec
        )

        moffset += symmetricState.decryptAndHash.bytesRead

        break
      case TOK_EE:
        dh[state.role === INITIATOR ? 'initiator' : 'responder'](DhResult, state.epk, state.esk, state.re)
        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break
      case TOK_ES:
        if (state.role === INITIATOR) dh.initiator(DhResult, state.epk, state.esk, state.rs)
        else dh.responder(DhResult, state.spk, state.ssk, state.re)

        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break
      case TOK_SE:
        if (state.role === INITIATOR) dh.initiator(DhResult, state.spk, state.ssk, state.re)
        else dh.responder(DhResult, state.epk, state.esk, state.rs)

        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break
      case TOK_SS:
        dh[state.role === INITIATOR ? 'initiator' : 'responder'](DhResult, state.spk, state.ssk, state.rs)

        symmetricState.mixKey(state.symmetricState, DhResult)
        sodium.sodium_memzero(DhResult)
        break

      default:
        throw new Error('Invalid message pattern')
    }
  }

  symmetricState.decryptAndHash(state.symmetricState, payloadBuffer, message.subarray(moffset))

  // How many bytes were written to payload (minus the TAG/MAC)
  readMessage.bytes = symmetricState.decryptAndHash.bytesWritten

  if (state.messagePatterns.length === 0) {
    var tx = sodium.sodium_malloc(cipherState.STATELEN)
    var rx = sodium.sodium_malloc(cipherState.STATELEN)
    symmetricState.split(state.symmetricState, rx, tx)

    return {tx, rx}
  }
}
readMessage.bytes = 0

function destroy (state) {
  if (state.symmetricState != null) {
    sodium.sodium_memzero(state.symmetricState)
    state.symmetricState = null
  }

  state.role = null

  if (state.spk != null) {
    sodium.sodium_memzero(state.spk)
    state.spk = null
  }

  if (state.ssk != null) {
    sodium.sodium_memzero(state.ssk)
    state.ssk = null
  }

  if (state.epk != null) {
    sodium.sodium_memzero(state.epk)
    state.epk = null
  }

  if (state.esk != null) {
    sodium.sodium_memzero(state.esk)
    state.esk = null
  }

  if (state.rs != null) {
    sodium.sodium_memzero(state.rs)
    state.rs = null
  }

  if (state.re != null) {
    sodium.sodium_memzero(state.re)
    state.re = null
  }

  state.messagePatterns = null
}

function keygen (obj, sk) {
  if (!obj) {
    obj = {publicKey: sodium.sodium_malloc(PKLEN), secretKey: sodium.sodium_malloc(SKLEN)}
    return keygen(obj)
  }

  if (obj.publicKey) {
    dh.generateKeypair(obj.publicKey, obj.secretKey)
    return obj
  }

  if (obj.byteLength != null) dh.generateKeypair(null, obj)
}

function seedKeygen (seed) {
  var obj = {publicKey: sodium.sodium_malloc(PKLEN), secretKey: sodium.sodium_malloc(SKLEN)}
  dh.generateSeedKeypair(obj.publicKey, obj.secretKey, seed)
  return obj
}

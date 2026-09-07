// test/helpers/auth-stub.js
// Factory functions for stubbing @sap/xsenv and @sap/xssec via proxyquire.
// Vitest's vi.mock() cannot intercept require() in CJS source — proxyquire
// is the canonical mocking tool throughout this test suite.
//
// Usage:
//   const proxyquire = require('proxyquire').noPreserveCache()
//   const { xsenvFactory, xssecFactory } = require('../helpers/auth-stub')
//   const { createApp } = proxyquire('../../src/core/server', {
//       '@sap/xsenv':  xsenvFactory(),
//       '@sap/xssec':  xssecFactory(),
//   })
//
// '@global': true propagates the stub transitively through every file in the
// require graph that pulls in @sap/xsenv or @sap/xssec.

const FAKE_USER = {
  id: 'tester@example.com',
  name: { givenName: 'Test', familyName: 'User' },
};

const FAKE_XSUAA = {
  url: 'https://xsuaa.fake.local',
  clientid: 'fake-client',
  clientsecret: 'fake-secret',
  xsappname: 'fake-app',
  uaadomain: 'xsuaa.fake.local',
  verificationkey: '-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----',
};

function xsenvFactory() {
  return {
    loadEnv: () => {},
    getServices: () => ({ xsuaa: FAKE_XSUAA }),
    '@global': true,
  };
}

function xssecFactory(user = FAKE_USER) {
  class XssecPassportStrategy {
    constructor() {
      this.name = 'JWT';
    }
    authenticate(req) {
      req.user = user;
      req.authInfo = { token: user };
      this.success(user, { token: user });
    }
  }
  class XsuaaService {
    constructor(cfg) {
      this.cfg = cfg;
    }
  }
  return { XssecPassportStrategy, XsuaaService, '@global': true };
}

// Alternate factory for 401-enforcement tests. Fails when no Bearer token is
// present; passport.authenticate(..., { failWithError: true }) turns this.fail()
// into a 401 response.
function xssecFailFactory() {
  class XssecPassportStrategy {
    constructor() {
      this.name = 'JWT';
    }
    authenticate(req) {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return this.fail({ message: 'No token' }, 401);
      }
      req.user = FAKE_USER;
      req.authInfo = { token: FAKE_USER };
      this.success(FAKE_USER, { token: FAKE_USER });
    }
  }
  class XsuaaService {
    constructor(cfg) {
      this.cfg = cfg;
    }
  }
  return { XssecPassportStrategy, XsuaaService, '@global': true };
}

module.exports = { FAKE_USER, FAKE_XSUAA, xsenvFactory, xssecFactory, xssecFailFactory };

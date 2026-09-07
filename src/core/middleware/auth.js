const passport = require('passport');
const { XssecPassportStrategy, XsuaaService } = require('@sap/xssec');
const xsenv = require('@sap/xsenv');

const PUBLIC_PATHS = ['/.well-known/agent.json'];

function setupAuth(app) {
  const xsuaa = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } }).xsuaa;
  const authService = new XsuaaService(xsuaa);
  passport.use(new XssecPassportStrategy(authService));

  app.use(passport.initialize());

  app.use((req, res, next) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    if (PUBLIC_PATHS.includes(path)) {
      return next();
    }
    passport.authenticate('JWT', { session: false, failWithError: true })(req, res, next);
  });
}

function xsuaaUserBuilder(req) {
  if (!req.user) {
    const { UnauthenticatedUser } = require('@a2a-js/sdk/server');
    return Promise.resolve(new UnauthenticatedUser());
  }
  return Promise.resolve({
    get isAuthenticated() {
      return true;
    },
    get userName() {
      return req.user.id || '';
    },
    get jwt() {
      return req.tokenInfo?.jwt || req.headers.authorization?.split(' ')[1] || '';
    },
  });
}

module.exports = { setupAuth, xsuaaUserBuilder };

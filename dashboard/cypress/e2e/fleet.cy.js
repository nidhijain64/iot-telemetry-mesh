const API = 'http://127.0.0.1:13005';
const password = 'CypressTestPassword123';
const suffix = Date.now().toString(36);
const alice = `cyalice_${suffix}`;
const bob = `cybob_${suffix}`;
const deviceId = `cy-device-${suffix}`;
let aliceToken;
let bobToken;
function request(method, path, body, token) {
  return cy.request({method, url: API + path, body, failOnStatusCode: false,
    headers: token ? {Authorization: `Bearer ${token}`} : {}});
}
function signIn() {
  cy.visit('/login');
  cy.get('input[placeholder="Username"]').type(alice);
  cy.get('input[placeholder="Password"]').type(password, {log: false});
  cy.contains('button', /^Log in$/).click();
  cy.contains('h1', 'Fleet Tracker').should('be.visible');
}

describe('Fleet APIs and browser workflows with real services', () => {
  before(() => {
    for (const username of [alice, bob]) {
      request('POST', '/api/auth/register', {username, password, role:'admin'})
        .then(({status, body}) => { expect(status).to.eq(201); expect(body.role).to.eq('operator'); });
      request('POST', '/api/auth/login', {username, password}).then(({status, body}) => {
        expect(status).to.eq(200);
        if (username === alice) aliceToken = body.token;
        else bobToken = body.token;
      });
    }
    cy.then(() => request('POST', '/api/devices', {deviceId, label:'Cypress owner device',type:'simulator'}, aliceToken)).its('status').should('eq',201);
  });
  it('rejects invalid credentials', () => {
    request('POST', '/api/auth/login', {username: alice, password:'wrong-password'})
      .its('status').should('eq', 401);
  });
  it('rejects malformed registration and unauthenticated API access', () => {
    request('POST', '/api/auth/register', {username:'x', password}).its('status').should('eq',400);
    request('GET', '/api/devices').its('status').should('eq',401);
  });
  it('registers a device and returns only the owner’s fleet', () => {
    request('POST', '/api/devices', {deviceId: `${deviceId}-extra`, label:'Additional test device',type:'simulator'}, aliceToken)
      .its('status').should('eq',201);
    request('GET', '/api/devices', undefined, aliceToken).then(({body}) => {
      expect(body.map(d => d.deviceId)).to.include(deviceId);
    });
    request('GET', '/api/devices', undefined, bobToken).then(({body}) => {
      expect(body.map(d => d.deviceId)).not.to.include(deviceId);
    });
  });
  it('prevents cross-user device, credential and history access', () => {
    request('GET', `/api/devices/${deviceId}`, undefined, bobToken).its('status').should('eq',404);
    request('POST', `/api/devices/${deviceId}/credentials`, {}, bobToken).its('status').should('eq',404);
    request('GET', `/api/telemetry/${deviceId}/history`, undefined, bobToken).its('status').should('eq',404);
  });
  it('rejects duplicates and operator-only attempts to change admin-controlled status', () => {
    request('POST', '/api/devices', {deviceId,label:'Duplicate',type:'simulator'}, aliceToken).its('status').should('eq',409);
    request('PATCH', `/api/devices/${deviceId}/status`, {status:'active'}, aliceToken).its('status').should('eq',403);
  });
  it('redirects unauthenticated visitors to login', () => {
    cy.visit('/');cy.location('pathname').should('eq','/login');
  });
  it('shows an error for a wrong password in the browser', () => {
    cy.visit('/login');cy.get('input[placeholder="Username"]').type(alice);
    cy.get('input[placeholder="Password"]').type('wrong-password');
    cy.contains('button', /^Log in$/).click();cy.contains('invalid credentials').should('be.visible');
  });
  it('logs in, displays the owner’s fleet, loads history and logs out', () => {
    cy.intercept('GET', `${API}/api/telemetry/*/history*`).as('history');
    signIn();cy.contains('Cypress owner device').click();
    cy.wait('@history').its('response.statusCode').should('eq',200);
    cy.contains('History').should('be.visible');
    cy.contains('button','Log out').click();cy.location('pathname').should('eq','/login');
    cy.window().then(win => expect(win.sessionStorage.getItem('iot_dashboard_token')).to.eq(null));
  });
  it('does not show another operator’s device in the browser', () => {
    cy.visit('/login');
    cy.get('input[placeholder="Username"]').type(bob);
    cy.get('input[placeholder="Password"]').type(password, {log:false});
    cy.contains('button', /^Log in$/).click();
    cy.contains('No devices registered yet.').should('be.visible');
    cy.contains('Cypress owner device').should('not.exist');
  });
  it('sets up a phone with a normalized operator username', () => {
    cy.visit('/mobile-node');cy.contains('button','Already have an account? Log in').click();
    cy.get('input[placeholder="Username"]').type(` ${alice.toUpperCase()} `);
    cy.get('input[placeholder="Password"]').type(password, {log:false});
    cy.contains('button', /^Log in$/).click();
    cy.contains('button','Set up device').click();
    cy.contains('button','Start Monitoring').should('be.visible');
    request('GET', '/api/devices', undefined, aliceToken).then(({body}) => {
      expect(body.some(d => d.type === 'mobile-browser')).to.eq(true);
    });
    cy.contains('button','Log out').click();cy.contains('Log in to send data from this phone').should('be.visible');
  });
});

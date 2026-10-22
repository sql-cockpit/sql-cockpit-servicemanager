const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const mainPath = path.join(__dirname, '../windows/SqlCockpit.ServiceControl.Electron/main.js');
function fixture(t, argv = []) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-lanes-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = fs.readFileSync(mainPath, 'utf8');
    const context = vm.createContext({ require: name => name === 'electron' ? { app: {} } : name === 'electron-updater' ? {} : require(name), process: { platform: 'win32', env: { ProgramData: root }, argv: ['electron', '.', ...argv] }, __dirname: path.dirname(mainPath) });
    vm.runInContext(source.slice(0, source.indexOf('function parseListenPrefixPort')) + '\nthis.fixtureApi = { getLaneSettings, readServiceSettings, ensureWebApiSettingsContract };', context);
    return { root, api: context.fixtureApi };
}
function write(root, lane, settings) {
    const target = path.join(root, 'SqlCockpit', 'Environments', lane, 'sql-cockpit-service.settings.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(settings));
    return target;
}
test('missing explicit lane cannot silently load production settings', t => {
    const { root, api } = fixture(t, ['--environmentId', 'test']);
    const legacy = path.join(root, 'SqlCockpit', 'sql-cockpit-service.settings.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ environmentId: 'prod' }));
    assert.throws(() => api.readServiceSettings(), /Settings file not found/);
});
test('missing explicit settings path does not select another existing file', t => {
    const { api } = fixture(t);
    assert.throws(() => api.readServiceSettings('missing-fixture-settings.json'), /Settings file not found/);
});
test('canonical lane selection retains custom identity and rejects cross-lane files', t => {
    const { root, api } = fixture(t);
    const target = write(root, 'test', { environmentId: 'test', serviceName: 'Fixture.Host.Test' });
    assert.equal(api.getLaneSettings('test').serviceName, 'Fixture.Host.Test');
    fs.writeFileSync(target, JSON.stringify({ environmentId: 'prod' }));
    assert.throws(() => api.getLaneSettings('test'), /does not match/);
});
test('unknown explicit lane fails closed', t => {
    const { api } = fixture(t, ['--environmentId', 'typo']);
    assert.throws(() => api.readServiceSettings(), /Unsupported environment/);
});
test('uninstalled lanes are reported without selecting another lane', t => {
    const { api } = fixture(t);
    assert.equal(api.getLaneSettings('dev').installed, false);
    assert.equal(api.getLaneSettings('dev').environmentId, 'dev');
});
test('legacy production settings remain available when no canonical file exists', t => {
    const { root, api } = fixture(t);
    const legacy = path.join(root, 'SqlCockpit', 'sql-cockpit-service.settings.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ serviceName: 'Fixture.Legacy' }));
    assert.equal(api.getLaneSettings('prod').serviceName, 'Fixture.Legacy');
});
test('lane status text cannot inject HTML into the renderer', () => {
    const renderer = fs.readFileSync(path.join(path.dirname(mainPath), 'renderer/renderer.js'), 'utf8');
    const start = renderer.indexOf('function escapeLaneText');
    const end = renderer.indexOf('function renderEnvironmentServices', start);
    const escape = vm.runInNewContext(renderer.slice(start, end) + '\nescapeLaneText');
    assert.equal(escape('<img onerror="x">&'), '&lt;img onerror=&quot;x&quot;&gt;&amp;');
});

test('opening lane UI never rewrites its port profile or disabled flags', t => {
    const { root, api } = fixture(t);
    const target = write(root, 'test', { environmentId: 'test', components: [{ id: 'web-api', disabled: true, autoStart: false, args: ['server.js', '--listenPrefix', 'http://127.0.0.1:8200/'] }] });
    const before = fs.readFileSync(target, 'utf8');
    assert.equal(api.ensureWebApiSettingsContract(target).changed, false);
    assert.equal(fs.readFileSync(target, 'utf8'), before);
});

test('SCM numeric status is presented as a readable state', () => {
    const source = fs.readFileSync(path.join(path.dirname(mainPath), 'renderer/renderer.js'), 'utf8');
    const start = source.indexOf('function normalizeServiceStatus');
    const end = source.indexOf('function renderService', start);
    const normalize = vm.runInNewContext(source.slice(start, end) + '\nnormalizeServiceStatus');
    assert.equal(normalize(4), 'Running');
    assert.equal(normalize('1'), 'Stopped');
});

test('installed Host OpenAPI matches the checked-in contract', () => {
    const embedded = fs.readFileSync(path.join(__dirname, '../windows/SqlCockpit.ServiceHost.Windows/ServiceHostOpenApi.cs'), 'utf8').split('"""')[1];
    const document = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/service-host-openapi.json'), 'utf8'));
    assert.deepEqual(JSON.parse(embedded), document);
    for (const route of ['/health', '/api/runtime/environment', '/api/runtime/doctor']) assert.ok(document.paths[route].get.responses['401']);
});

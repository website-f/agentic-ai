"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = exports.releaseRoot = exports.MODULE_SPECS = void 0;
exports.releaseArtifact = releaseArtifact;
exports.selectedModuleSql = selectedModuleSql;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.MODULE_SPECS = [
    { id: 'procurement', path: 'db/modules/it-procurement-v1.sql', requires: [] },
    { id: 'rental_corrections', path: 'db/modules/rental-correction-v1.sql', requires: [] },
    { id: 'cleanup', path: 'db/modules/it-cleanup-v1.sql', requires: ['procurement', 'rental_corrections'] },
    { id: 'metrics', path: 'db/modules/it-workflow-metrics-v1.sql', requires: [] },
    { id: 'job_email', path: 'apps/api/src/connections-mail/job-email-v2.sql', requires: [] },
];
const releaseRoot = () => (0, node_path_1.resolve)(__dirname, '../../../..');
exports.releaseRoot = releaseRoot;
const sha256 = (b) => (0, node_crypto_1.createHash)('sha256').update(b).digest('hex');
exports.sha256 = sha256;
const HASH = /^[a-f0-9]{64}$/;
/** Fixed packaged paths only. This verifies bytes, not database installation or provider access. */
function releaseArtifact(root = (0, exports.releaseRoot)()) {
    const file = (0, node_path_1.resolve)(root, 'db/release-manifest.json');
    if (!(0, node_fs_1.lstatSync)(file).isFile() || (0, node_fs_1.lstatSync)(file).isSymbolicLink())
        throw Error('Release artifact unavailable.');
    const bytes = (0, node_fs_1.readFileSync)(file), m = JSON.parse(bytes.toString());
    if (m.version !== 1 || Object.keys(m).sort().join(',') !== 'base,modules,version' || m.base?.path !== 'db/migrations/001_init.sql' || Object.keys(m.base).sort().join(',') !== 'path,sha256' || !HASH.test(m.base.sha256) || !Array.isArray(m.modules) || m.modules.length !== exports.MODULE_SPECS.length)
        throw Error('Release manifest is invalid.');
    for (let n = 0; n < exports.MODULE_SPECS.length; n++) {
        const s = exports.MODULE_SPECS[n], v = m.modules[n];
        if (!v || Object.keys(v).sort().join(',') !== 'id,path,requires,sha256' || v.id !== s.id || v.path !== s.path || JSON.stringify(v.requires) !== JSON.stringify(s.requires) || !HASH.test(v.sha256))
            throw Error('Release module manifest is invalid.');
    }
    for (const v of [m.base, ...m.modules]) {
        const p = (0, node_path_1.resolve)(root, v.path);
        if (!(0, node_fs_1.lstatSync)(p).isFile() || (0, node_fs_1.lstatSync)(p).isSymbolicLink() || (0, exports.sha256)((0, node_fs_1.readFileSync)(p)) !== v.sha256)
            throw Error('Packaged release SQL does not match manifest.');
    }
    return { manifest: m, sha256: (0, exports.sha256)(bytes) };
}
function selectedModuleSql(id, root = (0, exports.releaseRoot)()) { const a = releaseArtifact(root), m = a.manifest.modules.find(x => x.id === id); if (!m)
    throw Error('Unknown release module.'); return { artifact: a, module: m, sql: (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, m.path), 'utf8') }; }

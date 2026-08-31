/* ========================================
   MANIFEST SYNC
   The client half of the v2 protocol.

   Push:  hash each changed store, upload its bytes as an immutable blob, then
          commit a DELTA naming only those shards, under the etag of the
          manifest we last read. A 409 means someone else moved it; we rebase
          onto the manifest the worker hands back and re-apply only our own
          changes. Nothing we did not name is ever touched.

   Pull:  read the manifest, fetch only the blobs whose hashes differ from what
          this machine already applied, and write them through the storage
          module so they land wherever that store actually lives.

   The property that makes this safe across machines: we never send a whole
   state, so we can never overwrite a store we did not edit.
   ======================================== */

(function () {
    'use strict';

    const STORAGE_PREFIX = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';
    const LOCAL_STATE_KEY = STORAGE_PREFIX + 'v2SyncState';
    const DEVICE_ID_KEY = STORAGE_PREFIX + 'v2DeviceId';
    const MAX_REBASE_ATTEMPTS = 5;

    // ============================================
    // DEVICE IDENTITY
    // ============================================
    // There is no device identity today, so "which machine wrote this" has
    // never been answerable. One id per browser profile, generated once.
    function getDeviceId() {
        try {
            let id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                const random = (crypto?.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 8);
                id = `dev-${random}`;
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch (error) {
            return 'dev-unknown';
        }
    }

    // ============================================
    // LOCAL VIEW OF THE MANIFEST
    // ============================================
    // What this machine has already applied: shard name -> hash. Pull uses it to
    // fetch only what changed, so a routine poll costs one small read.
    function loadSyncState() {
        try {
            const raw = localStorage.getItem(LOCAL_STATE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return (parsed && typeof parsed === 'object') ? parsed : { version: 0, etag: null, applied: {} };
        } catch (error) {
            return { version: 0, etag: null, applied: {} };
        }
    }

    function saveSyncState(state) {
        try {
            localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('[v2] could not record sync state:', error?.name || error);
        }
    }

    // ============================================
    // HASHING
    // ============================================
    async function sha256Hex(text) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // ============================================
    // TRANSPORT
    // ============================================
    async function callWorker(body) {
        const repoSync = window.DevCoachModules?.repoSync;
        const config = repoSync?.loadCallListeningSyncConfig?.();
        const endpoint = config?.endpoint;
        if (!endpoint) throw new Error('No sync endpoint is configured.');

        const headers = { 'Content-Type': 'application/json' };
        if (config?.sharedSecret) headers['x-sync-secret'] = config.sharedSecret;

        const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await response.json().catch(() => null);
        return { status: response.status, data };
    }

    // ============================================
    // READING A STORE
    // ============================================
    function readStoreValue(name) {
        const storage = window.DevCoachModules?.storage;
        if (typeof storage?.readStore === 'function') {
            const value = storage.readStore(name);
            if (value !== undefined) return value;
        }
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + name);
            return raw ? JSON.parse(raw) : undefined;
        } catch (error) {
            return undefined;
        }
    }

    function writeStoreValue(name, value) {
        const storage = window.DevCoachModules?.storage;
        if (typeof storage?.saveWithSizeCheck === 'function') {
            return storage.saveWithSizeCheck(name, value);
        }
        try {
            localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
            return true;
        } catch (error) {
            return false;
        }
    }

    // ============================================
    // PUSH
    // ============================================

    /**
     * Uploads the given stores and commits them as a delta.
     * Returns a report; never throws for an ordinary conflict.
     */
    async function push(storeNames, reason = 'updated') {
        const registry = window.DevCoachModules?.storeRegistry;
        const names = (storeNames || []).filter((n) => (registry ? registry.isSynced(n) : true));
        if (!names.length) return { ok: true, skipped: true, reason: 'nothing to push' };

        // Blobs first, and awaited. A manifest naming bytes that are not in the
        // bucket is unresolvable on every machine forever, so the reference must
        // never land before the thing it references.
        const changed = {};
        for (const name of names) {
            const value = readStoreValue(name);
            if (value === undefined) continue;
            const bytes = JSON.stringify(value);
            const hash = await sha256Hex(bytes);
            const put = await callWorker({ mode: 'v2.putBlob', hash, bytes });
            if (put.status !== 200) {
                return { ok: false, error: put.data?.error || `Could not store ${name} (HTTP ${put.status}).` };
            }
            changed[name] = hash;
        }
        if (!Object.keys(changed).length) return { ok: true, skipped: true, reason: 'nothing readable to push' };

        return commitWithRebase(changed, reason);
    }

    async function commitWithRebase(changed, reason) {
        const device = getDeviceId();

        for (let attempt = 1; attempt <= MAX_REBASE_ATTEMPTS; attempt += 1) {
            const state = loadSyncState();
            let baseEtag = state.etag;

            if (!baseEtag) {
                const read = await callWorker({ mode: 'v2.manifest' });
                if (read.status !== 200) return { ok: false, error: read.data?.error || 'Could not read the manifest.' };
                if (!read.data.exists) {
                    // Creating the first manifest is deliberate, never inferred
                    // from a missing one. Seeding on a transient miss would let
                    // one machine write its whole view over everything.
                    return { ok: false, code: 'NO_MANIFEST', error: 'No manifest exists yet. Run the one-time setup first.' };
                }
                baseEtag = read.data.etag;
            }

            const commit = await callWorker({
                mode: 'v2.commit',
                baseEtag,
                changed,
                device,
                reason,
                appVersion: window.APP_VERSION || null
            });

            if (commit.status === 200) {
                const manifest = commit.data.manifest;
                saveSyncState({
                    version: manifest.version,
                    etag: commit.data.etag,
                    // Our own writes are now applied here by definition.
                    applied: { ...loadSyncState().applied, ...changed }
                });
                return { ok: true, version: manifest.version, changed: Object.keys(changed), attempts: attempt };
            }

            if (commit.status === 409 && commit.data?.code === 'CAS_CONFLICT') {
                // Someone else moved the manifest. Take theirs as the new base
                // and re-apply ONLY our own changed set on top. Their shards
                // survive because we never name them.
                saveSyncState({
                    version: commit.data.manifest?.version || 0,
                    etag: commit.data.etag,
                    applied: loadSyncState().applied
                });
                continue;
            }

            return { ok: false, error: commit.data?.error || `Commit failed (HTTP ${commit.status}).`, code: commit.data?.code };
        }

        return { ok: false, code: 'CAS_LIVELOCK', error: 'The manifest kept moving while committing. Try again in a moment.' };
    }

    /** The deliberate one-time creation of the first manifest. */
    async function createFirstManifest(storeNames, reason = 'initial backfill') {
        const read = await callWorker({ mode: 'v2.manifest' });
        if (read.status !== 200) return { ok: false, error: read.data?.error || 'Could not read the manifest.' };
        if (read.data.exists) {
            return { ok: false, code: 'ALREADY_EXISTS', error: 'A manifest already exists. Pull it rather than creating one.' };
        }

        const registry = window.DevCoachModules?.storeRegistry;
        // Filtered even when the caller named the stores explicitly. An
        // unfiltered create would put callListeningSyncConfig, and with it the
        // shared secret, inside the backup that secret authenticates against.
        const names = (storeNames || registry?.syncedNames?.() || [])
            .filter((n) => (registry ? registry.isSynced(n) : true));
        const changed = {};
        for (const name of names) {
            const value = readStoreValue(name);
            if (value === undefined) continue;
            const bytes = JSON.stringify(value);
            const hash = await sha256Hex(bytes);
            const put = await callWorker({ mode: 'v2.putBlob', hash, bytes });
            if (put.status !== 200) return { ok: false, error: put.data?.error || `Could not store ${name}.` };
            changed[name] = hash;
        }

        const commit = await callWorker({
            mode: 'v2.commit', intent: 'create', changed,
            device: getDeviceId(), reason, appVersion: window.APP_VERSION || null
        });
        if (commit.status !== 200) {
            return { ok: false, error: commit.data?.error || `Create failed (HTTP ${commit.status}).`, code: commit.data?.code };
        }

        saveSyncState({ version: commit.data.manifest.version, etag: commit.data.etag, applied: changed });
        return { ok: true, created: true, shards: Object.keys(changed).length };
    }

    // ============================================
    // PULL
    // ============================================

    /**
     * Applies anything another machine has committed. Fetches only the shards
     * whose hashes differ from what this machine already has.
     */
    async function pull() {
        const read = await callWorker({ mode: 'v2.manifest' });
        if (read.status !== 200) return { ok: false, error: read.data?.error || 'Could not read the manifest.' };
        if (!read.data.exists) return { ok: true, skipped: true, reason: 'no manifest yet' };

        const manifest = read.data.manifest;
        const state = loadSyncState();
        const applied = state.applied || {};
        const shards = manifest.shards || {};

        const toFetch = Object.keys(shards).filter((name) => applied[name] !== shards[name]);
        // A shard that vanished from the manifest was deleted elsewhere. Handled
        // separately from a changed one so a wipe is never mistaken for a stall.
        const removed = Object.keys(applied).filter((name) => !(name in shards));

        const updated = [];
        const failed = [];

        for (const name of toFetch) {
            const got = await callWorker({ mode: 'v2.getBlob', hash: shards[name] });
            if (got.status !== 200) {
                failed.push(`${name}: ${got.data?.error || 'HTTP ' + got.status}`);
                continue;
            }
            if (writeStoreValue(name, got.data)) {
                applied[name] = shards[name];
                updated.push(name);
            } else {
                failed.push(`${name}: the store refused the write`);
            }
        }

        removed.forEach((name) => { delete applied[name]; });

        saveSyncState({ version: manifest.version, etag: read.data.etag, applied });

        return {
            ok: failed.length === 0,
            version: manifest.version,
            updated,
            removed,
            failed,
            deletedAll: manifest.deletedAll === true
        };
    }

    function getLocalSyncVersion() {
        return loadSyncState().version || 0;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.manifestSync = {
        push,
        pull,
        createFirstManifest,
        getDeviceId,
        getLocalSyncVersion,
        loadSyncState,
        saveSyncState,
        sha256Hex
    };
})();

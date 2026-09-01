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
        let names = (storeNames || []).filter((n) => (registry ? registry.isSynced(n) : true));
        if (!names.length) return { ok: true, skipped: true, reason: 'nothing to push' };

        // The first push has to be a complete baseline, not just whatever
        // happened to be edited in the seconds before it.
        //
        // Dirty tracking starts empty on every boot, so a normal push carries
        // only what changed this session. That is right once the cloud holds a
        // full copy and wrong when it holds nothing: the seed would create a
        // manifest naming one store, and the other machine would pull that one
        // store and consider itself in step.
        const existing = await callWorker({ mode: 'v2.manifest' });
        if (existing.status === 200 && existing.data && !existing.data.exists) {
            const everything = registry?.syncedNames?.() || names;
            names = everything.filter((n) => readStoreValue(n) !== undefined);
            console.log(`[v2] No cloud copy yet; sending all ${names.length} stores as the baseline.`);
        }

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

    // ============================================
    // MERGING A SHARD BOTH MACHINES CHANGED
    // ============================================

    /**
     * A stable fingerprint for one entry, so the same entry written on two
     * machines is recognised as one thing. Key order is normalized because
     * JSON.stringify preserves insertion order and two machines can build the
     * same record with its fields in a different order.
     */
    function canonicalize(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
        if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
        return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
    }

    /**
     * Union two versions of an append-only store, keeping every entry either
     * side has. Arrays are merged and deduped by entry fingerprint; objects are
     * merged key by key and recursed into.
     *
     * Deliberately biased toward keeping too much. A duplicate is visible and
     * fixable; a coaching note that silently vanished because the other machine
     * did not have it is neither.
     */
    function unionValues(mine, theirs) {
        if (Array.isArray(mine) && Array.isArray(theirs)) {
            const seen = new Set();
            const out = [];
            theirs.concat(mine).forEach((entry) => {
                const fingerprint = canonicalize(entry);
                if (seen.has(fingerprint)) return;
                seen.add(fingerprint);
                out.push(entry);
            });
            return out;
        }
        if (mine && theirs && typeof mine === 'object' && typeof theirs === 'object'
            && !Array.isArray(mine) && !Array.isArray(theirs)) {
            const out = { ...theirs };
            Object.keys(mine).forEach((key) => {
                out[key] = (key in theirs) ? unionValues(mine[key], theirs[key]) : mine[key];
            });
            return out;
        }
        // Not mergeable at this level (a scalar, or shapes that disagree).
        // Ours is the more recent intent.
        return mine;
    }

    /**
     * Reconciles the shards that moved remotely while we were preparing to
     * write them. Returns a new changed map.
     *
     * For an append-only store both sides are kept. For last-writer-wins ours
     * becomes live, but theirs is retained under a conflicts/ shard so the
     * bytes are still referenced by the manifest and nothing is destroyed. The
     * user can be shown them later; they can never be silently gone.
     */
    async function reconcile(changed, freshManifest) {
        const registry = window.DevCoachModules?.storeRegistry;
        const applied = loadSyncState().applied || {};
        const freshShards = freshManifest?.shards || {};
        const next = { ...changed };

        for (const name of Object.keys(changed)) {
            const theirHash = freshShards[name];
            const baseHash = applied[name];
            // Untouched by them, or they landed on exactly our bytes.
            if (!theirHash || theirHash === baseHash || theirHash === changed[name]) continue;

            const strategy = registry?.mergeStrategyOf?.(name) || 'lastWriterWins';

            const got = await callWorker({ mode: 'v2.getBlob', hash: theirHash });
            if (got.status !== 200) {
                console.warn(`[v2] could not read the other version of ${name}; keeping ours.`);
                continue;
            }

            if (strategy === 'unionByEntryHash') {
                const merged = unionValues(readStoreValue(name), got.data);
                const bytes = JSON.stringify(merged);
                const hash = await sha256Hex(bytes);
                const put = await callWorker({ mode: 'v2.putBlob', hash, bytes });
                if (put.status === 200) {
                    writeStoreValue(name, merged);
                    next[name] = hash;
                    console.log(`[v2] merged both machines' ${name}.`);
                }
                continue;
            }

            // Ours wins, but theirs is kept rather than dropped. A blob that
            // stays referenced is a blob that still exists.
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            next[`conflicts/${name}/${stamp}`] = theirHash;
            console.warn(`[v2] ${name} changed on both machines. Ours is live; theirs is kept as conflicts/${name}/${stamp}.`);
        }

        return next;
    }

    async function commitWithRebase(changedInput, reason) {
        const device = getDeviceId();
        let changed = changedInput;

        for (let attempt = 1; attempt <= MAX_REBASE_ATTEMPTS; attempt += 1) {
            const state = loadSyncState();
            let baseEtag = state.etag;

            if (!baseEtag) {
                const read = await callWorker({ mode: 'v2.manifest' });
                if (read.status !== 200) return { ok: false, error: read.data?.error || 'Could not read the manifest.' };

                if (!read.data.exists) {
                    // Seed on the first push rather than making the user perform
                    // a setup ritual they can skip without being told.
                    //
                    // This is safe for the reason the explicit-create rule was
                    // written to protect: exists:false comes only from a
                    // SUCCESSFUL read where head() returned null. Any failure to
                    // reach the service is a non-200 and returns above, so a
                    // transient miss can never be mistaken for an empty server.
                    // And with no manifest there is by definition nothing to
                    // overwrite. The worker still refuses a create that races
                    // another machine, so the loser rebases instead of winning.
                    const created = await callWorker({
                        mode: 'v2.commit', intent: 'create', changed,
                        device, reason: `${reason} (first push)`, appVersion: window.APP_VERSION || null
                    });
                    if (created.status === 200) {
                        saveSyncState({
                            version: created.data.manifest.version,
                            etag: created.data.etag,
                            applied: { ...loadSyncState().applied, ...changed }
                        });
                        console.log('[v2] No cloud copy existed; this machine seeded it.');
                        return { ok: true, created: true, version: created.data.manifest.version, changed: Object.keys(changed), attempts: attempt };
                    }
                    if (created.status === 409) continue; // another machine got there first
                    return { ok: false, error: created.data?.error || `Could not create the cloud copy (HTTP ${created.status}).` };
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
                //
                // Except where we both changed the SAME shard: re-applying ours
                // blindly there would overwrite their version, which is the very
                // loss this design exists to prevent. reconcile merges the
                // append-only stores and preserves the other side for the rest.
                changed = await reconcile(changed, commit.data.manifest);

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

// 通用检索设置：来源身份、范围、层级、关系、持久化与云同步契约。
(function (root) {
    'use strict';

    const STORAGE_KEY = 'retrieval_settings_v1';
    const VERSION = 1;
    const RELATION_TYPES = new Set(['higher', 'same', 'none']);
    const ROLE_TYPES = new Set(['unspecified', 'base', 'amendment', 'supplement', 'reference', 'independent']);
    const NEW_SOURCE_POLICIES = new Set(['enabled', 'review', 'disabled']);
    const CONFLICT_POLICIES = new Set(['evidence-first', 'compare-only', 'strict-hierarchy']);
    const PROFILES = new Set(['precise', 'balanced', 'comprehensive']);
    const PROFILE_LIMITS = {
        precise: { candidates: 16, roots: 6, topics: 2, characters: 40000, perSource: 1 },
        balanced: { candidates: 24, roots: 8, topics: 3, characters: 60000, perSource: 1 },
        comprehensive: { candidates: 36, roots: 12, topics: 5, characters: 90000, perSource: 2 }
    };

    const defaults = () => ({
        version: VERSION,
        modifiedAt: 0,
        newSourcePolicy: 'enabled',
        conflictPolicy: 'evidence-first',
        profile: 'balanced',
        sources: {},
        relations: []
    });

    let current = null;
    let draft = null;
    let draftBaseline = '';

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function hash(value) {
        const text = String(value || '');
        let a = 2166136261, b = 5381;
        for (let i = 0; i < text.length; i++) {
            a = Math.imul(a ^ text.charCodeAt(i), 16777619);
            b = Math.imul(b, 33) ^ text.charCodeAt(i);
        }
        return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
    }

    function sourceFingerprint(contract) {
        const parts = [];
        for (const clauseId of Object.keys(contract?.data || {}).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
            const clause = contract.data[clauseId] || {};
            parts.push(`${clauseId}\u001f${clause.title || ''}\u001f${clause.originalContent ?? clause.content ?? ''}`);
        }
        return hash(parts.join('\u001e'));
    }

    function createSourceId(contract, key, used = new Set()) {
        // 初次迁移以标签键生成 ID，保证同一份旧数据在不同设备上即使正文已有
        // 本地修改，仍能得到同一来源身份；生成后 ID 会随合同快照持久化并跨重命名保留。
        const base = `src_${hash(key || sourceFingerprint(contract))}`;
        if (!used.has(base)) return base;
        let candidate = `${base}_${hash(key).slice(0, 6)}`;
        let suffix = 2;
        while (used.has(candidate)) candidate = `${base}_${hash(key).slice(0, 6)}_${suffix++}`;
        return candidate;
    }

    function ensureSourceIds(data) {
        const used = new Set();
        let changed = false;
        for (const contract of Object.values(data || {})) {
            if (contract?.sourceId && !used.has(contract.sourceId)) used.add(contract.sourceId);
        }
        for (const key of Object.keys(data || {}).sort((a, b) => a.localeCompare(b))) {
            const contract = data[key];
            if (!contract || !contract.data) continue;
            if (!contract.sourceId || used.has(contract.sourceId) && [...Object.values(data)].some(other => other !== contract && other?.sourceId === contract.sourceId)) {
                contract.sourceId = createSourceId(contract, key, used);
                changed = true;
            }
            used.add(contract.sourceId);
        }
        return changed;
    }

    function enabledForPolicy(policy) {
        return policy === 'enabled';
    }

    function needsReviewForPolicy(policy) {
        return policy !== 'disabled';
    }

    function normalizeSource(raw, policy, label) {
        const level = raw?.authorityLevel === null || raw?.authorityLevel === undefined || raw?.authorityLevel === ''
            ? null : Number(raw.authorityLevel);
        const aliases = Array.isArray(raw?.aliases)
            ? raw.aliases.map(value => String(value || '').trim()).filter(Boolean)
            : [];
        if (raw?.lastLabel && raw.lastLabel !== label && !aliases.includes(raw.lastLabel)) aliases.push(raw.lastLabel);
        return {
            enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : enabledForPolicy(policy),
            role: ROLE_TYPES.has(raw?.role) ? raw.role : 'unspecified',
            authorityLevel: Number.isInteger(level) && level >= 1 && level <= 9 ? level : null,
            aliases: [...new Set(aliases)].slice(0, 12),
            lastLabel: label,
            needsReview: typeof raw?.needsReview === 'boolean' ? raw.needsReview : needsReviewForPolicy(policy),
            modifiedAt: Number(raw?.modifiedAt) || 0
        };
    }

    function normalizeRelation(raw) {
        if (!raw || !RELATION_TYPES.has(raw.type)) return null;
        const fromSourceId = String(raw.fromSourceId || '');
        const toSourceId = String(raw.toSourceId || '');
        if (!fromSourceId || !toSourceId || fromSourceId === toSourceId) return null;
        if (raw.type === 'higher') return { fromSourceId, toSourceId, type: 'higher' };
        const pair = [fromSourceId, toSourceId].sort();
        return { fromSourceId: pair[0], toSourceId: pair[1], type: raw.type };
    }

    function sourceEntries(data) {
        ensureSourceIds(data);
        return Object.entries(data || {}).filter(([, contract]) => contract?.data).map(([key, contract]) => ({
            key,
            label: key,
            title: contract.title || key,
            sourceId: contract.sourceId,
            clauseCount: Object.keys(contract.data || {}).length,
            contract
        }));
    }

    function normalize(raw, data) {
        const base = defaults();
        const input = raw && typeof raw === 'object' ? raw : {};
        base.modifiedAt = Number(input.modifiedAt) || 0;
        base.newSourcePolicy = NEW_SOURCE_POLICIES.has(input.newSourcePolicy) ? input.newSourcePolicy : base.newSourcePolicy;
        base.conflictPolicy = CONFLICT_POLICIES.has(input.conflictPolicy) ? input.conflictPolicy : base.conflictPolicy;
        base.profile = PROFILES.has(input.profile) ? input.profile : base.profile;

        const entries = sourceEntries(data || {});
        for (const entry of entries) {
            base.sources[entry.sourceId] = normalizeSource(input.sources?.[entry.sourceId], base.newSourcePolicy, entry.label);
        }
        const available = new Set(entries.map(entry => entry.sourceId));
        const seenPairs = new Set();
        base.relations = (Array.isArray(input.relations) ? input.relations : []).map(normalizeRelation).filter(relation => {
            if (!relation || !available.has(relation.fromSourceId) || !available.has(relation.toSourceId)) return false;
            const pairKey = [relation.fromSourceId, relation.toSourceId].sort().join('|');
            if (seenPairs.has(pairKey)) return false;
            seenPairs.add(pairKey);
            return true;
        });
        return base;
    }

    function readStored(data) {
        let parsed = null;
        try {
            const raw = root.localStorage?.getItem(STORAGE_KEY);
            if (raw) parsed = JSON.parse(raw);
        } catch (error) {
            console.warn('[检索设置] 本地配置损坏，已使用安全默认值', error);
        }
        // 保留完整快照；调用方有时会传入已筛选的来源子集，读取动作不能据此
        // 永久裁掉其他来源设置，否则下一次完整检索会把它们按默认值重新启用。
        current = parsed && typeof parsed === 'object' ? clone(parsed) : defaults();
        return normalize(current, data || root.contracts || {});
    }

    function get(data) {
        if (!current) readStored(data);
        return normalize(current, data || root.contracts || {});
    }

    function persist(settings, data, touch = true) {
        const next = normalize(settings, data || root.contracts || {});
        if (touch) next.modifiedAt = Date.now();
        root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
        current = next;
        return clone(current);
    }

    function getForCloud(data) {
        return clone(get(data));
    }

    function hasConfiguredValue(settings) {
        if (!settings) return false;
        if (Number(settings.modifiedAt)) return true;
        return Object.values(settings.sources || {}).some(source => source.authorityLevel !== null || source.role !== 'unspecified' || source.enabled === false) ||
            (settings.relations || []).length > 0;
    }

    function merge(localSettings, cloudSettings, data) {
        if (!cloudSettings) return normalize(localSettings, data || root.contracts || {});
        if (!localSettings) return normalize(cloudSettings, data || root.contracts || {});
        const localTime = Number(localSettings.modifiedAt) || 0;
        const cloudTime = Number(cloudSettings.modifiedAt) || 0;
        if (!hasConfiguredValue(localSettings) && !localTime) return normalize(cloudSettings, data || root.contracts || {});
        if (!hasConfiguredValue(cloudSettings) && !cloudTime) return normalize(localSettings, data || root.contracts || {});
        return normalize(cloudTime > localTime ? cloudSettings : localSettings, data || root.contracts || {});
    }

    function applyCloud(settings, data) {
        if (!settings) return get(data);
        return persist(settings, data || root.contracts || {}, false);
    }

    function beginDraft(data) {
        draft = clone(get(data));
        draftBaseline = JSON.stringify(draft);
        return draft;
    }

    function getDraft(data) {
        return draft || beginDraft(data);
    }

    function setDraft(next, data) {
        draft = normalize(next, data || root.contracts || {});
        return draft;
    }

    function isDraftDirty() {
        return !!draft && JSON.stringify(draft) !== draftBaseline;
    }

    function discardDraft() {
        draft = null;
        draftBaseline = '';
    }

    function resetDraft(data) {
        const reset = defaults();
        draft = normalize(reset, data || root.contracts || {});
        return draft;
    }

    function validate(settings, data) {
        const normalized = normalize(settings, data || root.contracts || {});
        const entries = sourceEntries(data || root.contracts || {});
        const errors = [];
        const enabledIds = new Set(entries.filter(entry => normalized.sources[entry.sourceId]?.enabled).map(entry => entry.sourceId));
        if (entries.length && !enabledIds.size) errors.push('至少启用一个检索来源');

        const graph = new Map(entries.map(entry => [entry.sourceId, []]));
        for (const relation of normalized.relations) {
            const left = normalized.sources[relation.fromSourceId];
            const right = normalized.sources[relation.toSourceId];
            if (!left || !right) {
                errors.push('来源关系包含已删除的来源');
                continue;
            }
            if (relation.type === 'higher') {
                graph.get(relation.fromSourceId)?.push(relation.toSourceId);
                if (left.authorityLevel !== null && right.authorityLevel !== null && left.authorityLevel >= right.authorityLevel) {
                    errors.push('“高于”关系与来源等级顺序冲突');
                }
            } else if (relation.type === 'same' && left.authorityLevel !== null && right.authorityLevel !== null && left.authorityLevel !== right.authorityLevel) {
                errors.push('“同级”关系中的两个来源被设置为不同等级');
            }
        }

        const visiting = new Set(), visited = new Set();
        function visit(id) {
            if (visiting.has(id)) return true;
            if (visited.has(id)) return false;
            visiting.add(id);
            for (const next of graph.get(id) || []) if (visit(next)) return true;
            visiting.delete(id);
            visited.add(id);
            return false;
        }
        if ([...graph.keys()].some(visit)) errors.push('“高于”关系存在循环，请调整来源顺序');
        return { valid: errors.length === 0, errors: [...new Set(errors)], settings: normalized };
    }

    function saveDraft(data) {
        const result = validate(getDraft(data), data || root.contracts || {});
        if (!result.valid) return result;
        const settings = persist(result.settings, data || root.contracts || {}, true);
        draft = clone(settings);
        draftBaseline = JSON.stringify(draft);
        return { valid: true, errors: [], settings };
    }

    function getEnabledContracts(data, settings) {
        const source = data || root.contracts || {};
        const active = normalize(settings || get(source), source);
        const filtered = {};
        for (const entry of sourceEntries(source)) {
            if (active.sources[entry.sourceId]?.enabled) filtered[entry.key] = entry.contract;
        }
        return filtered;
    }

    function getSourceMeta(key, data, settings) {
        const source = data || root.contracts || {};
        const contract = source[key];
        if (!contract) return null;
        ensureSourceIds(source);
        const active = normalize(settings || get(source), source);
        return { key, sourceId: contract.sourceId, title: contract.title || key, ...(active.sources[contract.sourceId] || {}) };
    }

    function relationBetween(firstSourceId, secondSourceId, settings, data) {
        const active = normalize(settings || get(data), data || root.contracts || {});
        const explicit = active.relations.find(relation => {
            const pair = new Set([relation.fromSourceId, relation.toSourceId]);
            return pair.has(firstSourceId) && pair.has(secondSourceId);
        });
        if (explicit) {
            if (explicit.type === 'higher') return {
                type: explicit.fromSourceId === firstSourceId ? 'higher' : 'lower',
                origin: 'explicit'
            };
            return { type: explicit.type, origin: 'explicit' };
        }
        const first = active.sources[firstSourceId], second = active.sources[secondSourceId];
        if (first?.authorityLevel !== null && second?.authorityLevel !== null) {
            if (first.authorityLevel === second.authorityLevel) return { type: 'same', origin: 'level' };
            return { type: first.authorityLevel < second.authorityLevel ? 'higher' : 'lower', origin: 'level' };
        }
        return { type: 'unknown', origin: 'unconfigured' };
    }

    function getLimits(settings, data) {
        const active = normalize(settings || get(data), data || root.contracts || {});
        return { ...PROFILE_LIMITS[active.profile] };
    }

    function summary(data, settings) {
        const source = data || root.contracts || {};
        const active = normalize(settings || get(source), source);
        const entries = sourceEntries(source);
        const enabled = entries.filter(entry => active.sources[entry.sourceId]?.enabled);
        const configured = enabled.filter(entry => active.sources[entry.sourceId]?.authorityLevel !== null);
        return {
            total: entries.length,
            enabled: enabled.length,
            unconfigured: enabled.length - configured.length,
            relations: active.relations.length,
            labels: enabled.map(entry => entry.label)
        };
    }

    root.RetrievalSettings = {
        STORAGE_KEY,
        VERSION,
        RELATION_TYPES: [...RELATION_TYPES],
        ROLE_TYPES: [...ROLE_TYPES],
        defaults,
        clone,
        createSourceId,
        ensureSourceIds,
        sourceEntries,
        normalize,
        get,
        persist,
        getForCloud,
        merge,
        applyCloud,
        beginDraft,
        getDraft,
        setDraft,
        isDraftDirty,
        discardDraft,
        resetDraft,
        validate,
        saveDraft,
        getEnabledContracts,
        getSourceMeta,
        relationBetween,
        getLimits,
        summary
    };
})(typeof window !== 'undefined' ? window : globalThis);

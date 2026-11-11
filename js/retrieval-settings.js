// 通用检索设置：来源身份、范围、层级、关系、持久化与云同步契约。
(function (root) {
    'use strict';

    const STORAGE_KEY = 'retrieval_settings_v1';
    const VERSION = 2;
    const RELATION_TYPES = new Set(['higher', 'lower', 'same', 'none']);
    const RELATION_LABELS = { higher: '高于', lower: '低于', same: '同级', none: '无推定关系' };
    const ROLE_TYPES = new Set(['unspecified', 'base', 'amendment', 'supplement', 'reference', 'independent']);
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
        conflictPolicy: 'evidence-first',
        profile: 'balanced',
        sources: {},
        relations: []
    });

    let current = null;
    let draft = null;
    let draftBaseline = null;

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

    function defaultSourceEnabled(settings) {
        // 旧快照没有逐来源状态时，沿用它原先的默认范围。
        return (Number(settings.version) || 0) < 2 && !['review', 'disabled'].includes(settings.newSourcePolicy);
    }

    function normalizeSource(raw, defaultEnabled, label) {
        const level = raw?.authorityLevel === null || raw?.authorityLevel === undefined || raw?.authorityLevel === ''
            ? null : Number(raw.authorityLevel);
        const aliases = Array.isArray(raw?.aliases)
            ? raw.aliases.map(value => String(value || '').trim()).filter(Boolean)
            : [];
        if (raw?.lastLabel && raw.lastLabel !== label && !aliases.includes(raw.lastLabel)) aliases.push(raw.lastLabel);
        return {
            enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : defaultEnabled,
            role: ROLE_TYPES.has(raw?.role) ? raw.role : 'unspecified',
            authorityLevel: Number.isInteger(level) && level >= 1 && level <= 9 ? level : null,
            aliases: [...new Set(aliases)].slice(0, 12),
            lastLabel: label,
            modifiedAt: Number(raw?.modifiedAt) || 0
        };
    }

    function normalizeRelation(raw) {
        if (!raw || !RELATION_TYPES.has(raw.type)) return null;
        const fromSourceId = String(raw.fromSourceId || '');
        const toSourceId = String(raw.toSourceId || '');
        if (!fromSourceId || !toSourceId || fromSourceId === toSourceId) return null;
        if (raw.type === 'higher') return { fromSourceId, toSourceId, type: 'higher' };
        if (raw.type === 'lower') return { fromSourceId: toSourceId, toSourceId: fromSourceId, type: 'higher' };
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

    function getVisibleContracts(data) {
        return Object.fromEntries(Object.entries(data || {}).filter(([, contract]) => contract?.data && contract.visibility?.hidden !== true));
    }

    function normalize(raw, data) {
        const base = defaults();
        const input = raw && typeof raw === 'object' ? raw : {};
        base.modifiedAt = Number(input.modifiedAt) || 0;
        base.conflictPolicy = CONFLICT_POLICIES.has(input.conflictPolicy) ? input.conflictPolicy : base.conflictPolicy;
        base.profile = PROFILES.has(input.profile) ? input.profile : base.profile;

        const entries = sourceEntries(data || {});
        const defaultEnabled = defaultSourceEnabled(input);
        for (const entry of entries) {
            base.sources[entry.sourceId] = normalizeSource(input.sources?.[entry.sourceId], defaultEnabled, entry.label);
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
        current = parsed && typeof parsed === 'object' ? parsed : {};
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
        const defaultEnabled = defaultSourceEnabled(settings);
        return Object.values(settings.sources || {}).some(source => source.authorityLevel !== null || source.role !== 'unspecified' || source.enabled !== defaultEnabled) ||
            (settings.relations || []).length > 0;
    }

    function merge(localSettings, cloudSettings, data) {
        if (!cloudSettings) return normalize(localSettings, data || root.contracts || {});
        if (!localSettings) return normalize(cloudSettings, data || root.contracts || {});
        const localTime = Number(localSettings.modifiedAt) || 0;
        const cloudTime = Number(cloudSettings.modifiedAt) || 0;
        const cloudWins = !hasConfiguredValue(localSettings) || (hasConfiguredValue(cloudSettings) && cloudTime > localTime);
        const primary = cloudWins ? cloudSettings : localSettings;
        const secondary = cloudWins ? localSettings : cloudSettings;
        // 较新的设置快照可能尚未包含另一端新增的合同。
        return normalize({ ...primary, sources: { ...secondary.sources, ...primary.sources } }, data || root.contracts || {});
    }

    function applyCloud(settings, data) {
        if (!settings) return get(data);
        return persist(settings, data || root.contracts || {}, false);
    }

    function beginDraft(data) {
        draft = get(data);
        draftBaseline = clone(draft);
        return draft;
    }

    function getDraft(data) {
        if (!draft) return beginDraft(data);
        data = data || root.contracts || {};
        const savedSources = get(data).sources;
        draft = normalize({ ...draft, sources: { ...savedSources, ...draft.sources } }, data);
        draftBaseline = normalize({ ...draftBaseline, sources: { ...savedSources, ...draftBaseline.sources } }, data);
        return draft;
    }

    function setDraft(next, data) {
        draft = normalize(next, data || root.contracts || {});
        return draft;
    }

    function isDraftDirty(data) {
        return !!draft && JSON.stringify(getDraft(data)) !== JSON.stringify(draftBaseline);
    }

    function discardDraft() {
        draft = null;
        draftBaseline = null;
    }

    function resetDraft(data) {
        const previous = getDraft(data);
        const reset = defaults();
        const visibleIds = new Set(sourceEntries(getVisibleContracts(data || root.contracts || {})).map(entry => entry.sourceId));
        for (const [sourceId, source] of Object.entries(previous.sources)) {
            reset.sources[sourceId] = visibleIds.has(sourceId) ? { enabled: source.enabled, aliases: source.aliases } : source;
        }
        reset.relations = previous.relations.filter(({ fromSourceId, toSourceId }) => !visibleIds.has(fromSourceId) || !visibleIds.has(toSourceId));
        draft = normalize(reset, data || root.contracts || {});
        return draft;
    }

    function compareLevels(first, second) {
        const left = first?.authorityLevel, right = second?.authorityLevel;
        if (left == null || right == null) return 'unknown';
        if (left === right) return 'same';
        return left < right ? 'higher' : 'lower';
    }

    function levelConflict(relation, sources) {
        const order = compareLevels(sources[relation.fromSourceId], sources[relation.toSourceId]);
        return order !== 'unknown' && order !== relation.type ? order : null;
    }

    function describeRelation(relation, sources) {
        const describe = id => {
            const { lastLabel, authorityLevel } = sources[id];
            return `“${lastLabel}”（${authorityLevel === null ? '未设置等级' : '第 ' + authorityLevel + ' 级'}）`;
        };
        return `${describe(relation.fromSourceId)} ${RELATION_LABELS[relation.type]} ${describe(relation.toSourceId)}`;
    }

    function findOrderPath(graph, start, end) {
        const incoming = new Map([[start, null]]);
        const queue = [start];
        for (let i = 0; i < queue.length && !incoming.has(end); i++) {
            for (const edge of graph.get(queue[i])) {
                if (incoming.has(edge.toSourceId)) continue;
                incoming.set(edge.toSourceId, edge);
                queue.push(edge.toSourceId);
            }
        }
        if (!incoming.has(end)) return null;
        const path = [];
        for (let edge = incoming.get(end); edge; edge = incoming.get(edge.fromSourceId)) path.push(edge);
        return path.reverse();
    }

    function findAuthorityCycle(sources, relations) {
        const graph = new Map(Object.keys(sources).map(id => [id, []]));
        const strictEdges = [];
        function add(fromSourceId, toSourceId, type, relation) {
            const edge = { fromSourceId, toSourceId, type, relation };
            graph.get(fromSourceId).push(edge);
            if (type === 'same') {
                graph.get(toSourceId).push({ ...edge, fromSourceId: toSourceId, toSourceId: fromSourceId });
            } else {
                strictEdges.push(edge);
            }
        }

        // 同等级用双向边连接，相邻等级之间用高到低的单向边连接。
        const levelRepresentatives = new Map();
        for (const [id, { authorityLevel }] of Object.entries(sources)) {
            if (authorityLevel === null) continue;
            const representative = levelRepresentatives.get(authorityLevel);
            if (representative) add(representative, id, 'same');
            else levelRepresentatives.set(authorityLevel, id);
        }
        const ordered = [...levelRepresentatives.keys()].sort((a, b) => a - b);
        for (let i = 1; i < ordered.length; i++) {
            add(levelRepresentatives.get(ordered[i - 1]), levelRepresentatives.get(ordered[i]), 'higher');
        }
        for (const relation of relations) {
            if (relation.type !== 'none') add(relation.fromSourceId, relation.toSourceId, relation.type, relation);
        }
        for (const edge of strictEdges) {
            const reversePath = findOrderPath(graph, edge.toSourceId, edge.fromSourceId);
            if (reversePath) return [edge, ...reversePath];
        }
        return null;
    }

    function validate(settings, data) {
        const allContracts = data || root.contracts || {};
        const normalized = normalize(settings, allContracts);
        const { sources, relations } = normalize(normalized, getVisibleContracts(allContracts));
        const errors = [];
        for (const relation of relations) {
            const expected = levelConflict(relation, sources);
            if (!expected) continue;
            errors.push(`来源关系与等级冲突：${describeRelation(relation, sources)}，但按已设等级应为 ${describeRelation({ ...relation, type: expected }, sources)}`);
        }
        if (!errors.length) {
            const cycle = findAuthorityCycle(sources, relations);
            if (cycle) errors.push(`来源等级或关系存在循环矛盾：${cycle.map(edge => describeRelation(edge, sources)).join('，')}`);
        }
        return { valid: errors.length === 0, errors, settings: normalized };
    }

    function getEffectiveRelations(settings) {
        if (!settings) return [];
        const { sources } = settings;
        let relations = settings.relations.filter(relation => !levelConflict(relation, sources));
        // 旧版或同步数据可能含有冲突。保留原设置供修正，检索只使用相容关系。
        for (let cycle = findAuthorityCycle(sources, relations); cycle; cycle = findAuthorityCycle(sources, relations)) {
            const conflicting = new Set(cycle.map(edge => edge.relation));
            relations = relations.filter(relation => !conflicting.has(relation));
        }
        return relations;
    }

    function saveDraft(data) {
        const result = validate(getDraft(data), data || root.contracts || {});
        if (!result.valid) return result;
        const settings = persist(result.settings, data || root.contracts || {}, true);
        draft = clone(settings);
        draftBaseline = clone(draft);
        return { valid: true, errors: [], settings };
    }

    function getEnabledContracts(data, settings) {
        const source = data || root.contracts || {};
        const active = normalize(settings || get(source), source);
        const filtered = {};
        for (const entry of sourceEntries(source)) {
            if (entry.contract.visibility?.hidden !== true && active.sources[entry.sourceId]?.enabled) filtered[entry.key] = entry.contract;
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
        const order = compareLevels(active.sources[firstSourceId], active.sources[secondSourceId]);
        if (order !== 'unknown') return { type: order, origin: 'level' };
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
        return { type: 'unknown', origin: 'unconfigured' };
    }

    function getLimits(settings, data) {
        const active = normalize(settings || get(data), data || root.contracts || {});
        return { ...PROFILE_LIMITS[active.profile] };
    }

    function summary(data, settings) {
        const source = getVisibleContracts(data || root.contracts || {});
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
        getVisibleContracts,
        getEnabledContracts,
        getSourceMeta,
        relationBetween,
        getEffectiveRelations,
        getLimits,
        summary
    };
})(typeof window !== 'undefined' ? window : globalThis);

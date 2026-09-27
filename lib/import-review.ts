import type { AnchorType, Annotation, AnnotationKind, AnnotationStatus, TextDocument } from './types';
import { clone } from './editor';

export type ImportReviewCategory = 'new' | 'update' | 'conflict' | 'unchanged' | 'invalid';
export type ImportDecision = 'pending' | 'import' | 'skip' | 'keep-local' | 'use-incoming' | 'merge';

export interface ImportReviewItem {
  key: string;
  category: ImportReviewCategory;
  decision: ImportDecision;
  incoming: Annotation;
  local?: Annotation;
  locals?: Annotation[];
  plannedId: string;
  mergeTargetId?: string;
  changedFields: string[];
  anchorWarning: string;
  referenceWarnings: string[];
  mergeDraft: {
    title: string;
    body: string;
    source: string;
  };
  invalidReason?: string;
}

export interface ImportReviewResult {
  items: ImportReviewItem[];
  error?: string;
  packageAnnotationCount: number;
}

const kinds: AnnotationKind[] = ['footnote', 'variant', 'background', 'crossref'];
const anchorTypes: AnchorType[] = ['chapter', 'sentence', 'word'];

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function nowString() {
  return new Date().toISOString();
}

function normalizeTarget(value: string) {
  return value.replaceAll(/\s+/g, '').replaceAll('“', '').replaceAll('”', '');
}

function uniqueAnnotationId(document: TextDocument, preferred: string, used: Set<string>) {
  const base = preferred || `annotation-import-${Date.now().toString(36)}`;
  let candidate = base;
  let index = 2;
  const exists = (id: string) => document.annotations.some((item) => item.id === id) || used.has(id);
  while (exists(candidate)) {
    candidate = `${base}-import-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function resolveAnchor(
  document: TextDocument,
  anchorId: string,
  anchorType: AnchorType,
  anchorText: string
): { anchorId: string; anchorType: AnchorType; warning: string } | null {
  if (anchorType === 'chapter') {
    return null;
  }

  if (anchorType === 'sentence') {
    const byId = document.chapters.flatMap((chapter) => chapter.sentences).find((item) => item.id === anchorId);
    if (byId) return { anchorId: byId.id, anchorType, warning: '' };

    const wanted = normalizeTarget(anchorText || anchorId);
    const byText = document.chapters
      .flatMap((chapter) => chapter.sentences)
      .find((item) => normalizeTarget(item.text) === wanted);
    return byText ? { anchorId: byText.id, anchorType, warning: '来稿使用句子文本定位，已匹配到现有句子。' } : null;
  }

  const tokenOwner = document.chapters
    .flatMap((chapter) => chapter.sentences.map((sentence) => ({ chapter, sentence })))
    .find(({ sentence }) => sentence.tokens.some((token) => token.id === anchorId));
  if (tokenOwner) {
    const token = tokenOwner.sentence.tokens.find((item) => item.id === anchorId);
    return token ? { anchorId: token.id, anchorType: 'word', warning: '' } : null;
  }

  const wanted = normalizeTarget(anchorText || anchorId);
  const matches = document.chapters.flatMap((chapter) =>
    chapter.sentences.flatMap((sentence) =>
      sentence.tokens
        .filter((token) => token.text.trim() && normalizeTarget(token.text) === wanted)
        .map((token) => ({ chapter, sentence, token }))
    )
  );
  if (matches.length) {
    return {
      anchorId: matches[0].token.id,
      anchorType: 'word',
      warning: matches.length > 1 ? '来稿词语在文中多次出现，已接到第一处。' : '来稿词语已按文本匹配到现有词语。'
    };
  }

  const fallbackSentence = document.chapters
    .flatMap((chapter) => chapter.sentences)
    .find((sentence) => sentence.id === anchorId || (wanted && normalizeTarget(sentence.text).includes(wanted)));
  if (fallbackSentence) {
    return {
      anchorId: fallbackSentence.id,
      anchorType: 'sentence',
      warning: '未找到原词级目标，引用已安全接到所属整句。'
    };
  }

  return null;
}

function sanitizeIncoming(value: unknown, index: number): Annotation | { error: string } {
  if (typeof value !== 'object' || value === null) return { error: `第 ${index + 1} 条不是注释对象。` };
  const item = value as Record<string, unknown>;

  const kind = kinds.includes(item.kind as AnnotationKind) ? (item.kind as AnnotationKind) : 'footnote';
  const anchorType = anchorTypes.includes(item.anchorType as AnchorType) ? (item.anchorType as AnchorType) : 'sentence';
  const anchorId = text(item.anchorId);
  const title = text(item.title);
  const body = text(item.body);
  const source = text(item.source) || '未署名来源';

  if (!anchorId) return { error: `第 ${index + 1} 条缺少 anchorId，无法确定引用目标。` };
  if (!title || !body) return { error: `第 ${index + 1} 条缺少标题或正文。` };

  const status: AnnotationStatus = item.status === 'resolved' ? 'resolved' : 'open';
  const id = text(item.id);

  return {
    id,
    anchorId,
    anchorType,
    kind,
    title,
    body,
    source,
    references: optionalArray(item.references),
    status,
    tags: optionalArray(item.tags),
    conflictState: 'open',
    updatedAt: text(item.updatedAt) || nowString()
  };
}

function readAnnotationArray(input: unknown): Annotation[] | { error: string } {
  if (Array.isArray(input)) return input as Annotation[];
  if (typeof input !== 'object' || input === null) return { error: '请粘贴注释数组，或包含 annotations 字段的 JSON 校注包。' };
  const root = input as Record<string, unknown>;
  if (Array.isArray(root.annotations)) return root.annotations as Annotation[];
  if (typeof root.document === 'object' && root.document !== null) {
    const documentRecord = root.document as Record<string, unknown>;
    if (Array.isArray(documentRecord.annotations)) return documentRecord.annotations as Annotation[];
  }
  return { error: 'JSON 中没有找到 annotations 数组。' };
}

function isSameContent(local: Annotation, incoming: Annotation, resolvedAnchorId: string, resolvedAnchorType: AnchorType) {
  return (
    local.title === incoming.title &&
    local.body === incoming.body &&
    local.source === incoming.source &&
    local.kind === incoming.kind &&
    local.anchorId === resolvedAnchorId &&
    local.anchorType === resolvedAnchorType &&
    local.tags.join('｜') === incoming.tags.join('｜')
  );
}

function changedFieldLabels(local: Annotation, incoming: Annotation, resolvedAnchorId: string, resolvedAnchorType: AnchorType) {
  const labels: string[] = [];
  if (local.title !== incoming.title) labels.push('标题');
  if (local.body !== incoming.body) labels.push('正文');
  if (local.source !== incoming.source) labels.push('来源');
  if (local.kind !== incoming.kind) labels.push('类型');
  if (local.anchorId !== resolvedAnchorId || local.anchorType !== resolvedAnchorType) labels.push('引用目标');
  if (local.tags.join('｜') !== incoming.tags.join('｜')) labels.push('标签');
  if (local.references.join('｜') !== incoming.references.join('｜')) labels.push('注释互引');
  return labels;
}

function mergeLists(...lists: string[][]) {
  return Array.from(new Set(lists.flat().map((item) => item.trim()).filter(Boolean)));
}

function makeMergeDraft(local: Annotation, incoming: Annotation, extraLocals: Annotation[] = []) {
  const sources = Array.from(new Set([...extraLocals.map((item) => item.source), local.source, incoming.source]));
  const bodies = [...extraLocals.map((item) => `【${item.source}】${item.body}`), `【${local.source}】${local.body}`, `【${incoming.source}】${incoming.body}`];
  return {
    title: local.title,
    body: bodies.join('\n\n'),
    source: sources.join('；')
  };
}

export function createImportReview(document: TextDocument, rawJson: string): ImportReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { items: [], error: 'JSON 格式无法解析，请检查括号、引号和逗号。', packageAnnotationCount: 0 };
  }

  const array = readAnnotationArray(parsed);
  if ('error' in array) return { items: [], error: array.error, packageAnnotationCount: 0 };

  const usedIds = new Set<string>();
  const sanitized = array.map((item, index) => sanitizeIncoming(item, index));
  const prepared = sanitized.map((entry, index) => {
    const key = `import-item-${index}`;
    if ('error' in entry) {
      return {
        key,
        index,
        entry: null as Annotation | null,
        plannedId: '',
        resolved: null as { anchorId: string; anchorType: AnchorType; warning: string } | null,
        invalidReason: entry.error
      };
    }

    const anchorText = text((array[index] as unknown as Record<string, unknown>).anchorText);
    const resolved = resolveAnchor(document, entry.anchorId, entry.anchorType, anchorText);
    if (!resolved) {
      return {
        key,
        index,
        entry,
        plannedId: '',
        resolved: null,
        invalidReason:
          entry.anchorType === 'chapter'
            ? '来稿引用目标为章节；导入仅允许接到现有句子或词语，请改标具体句子后重试。'
            : '在现有句子或词语中找不到引用目标；为避免悬空引用，不能导入。'
      };
    }

    const localWithId = document.annotations.some((item) => item.id === entry.id);
    return {
      key,
      entry,
      plannedId: localWithId ? entry.id : uniqueAnnotationId(document, entry.id, usedIds),
      resolved,
      invalidReason: ''
    };
  });

  const incomingIdMap = new Map<string, string>();
  prepared.forEach((record) => {
    if (record.entry?.id && !incomingIdMap.has(record.entry.id) && record.plannedId) {
      incomingIdMap.set(record.entry.id, record.plannedId);
    }
  });

  const items: ImportReviewItem[] = [];
  const seenIncomingIds = new Set<string>();

  prepared.forEach(({ key, entry, plannedId, resolved, invalidReason }) => {
    if (!entry || !resolved) {
      items.push({
        key,
        category: 'invalid',
        decision: 'skip',
        incoming: entry ?? {
          id: '',
          anchorId: '',
          anchorType: 'sentence',
          kind: 'footnote',
          title: '无法读取的来稿',
          body: '',
          source: '',
          references: [],
          status: 'open',
          tags: [],
          conflictState: 'open',
          updatedAt: nowString()
        },
        plannedId: '',
        changedFields: [],
        anchorWarning: '',
        referenceWarnings: [],
        mergeDraft: { title: '', body: '', source: '' },
        invalidReason
      });
      return;
    }

    const incoming: Annotation = {
      ...entry,
      id: plannedId,
      anchorId: resolved.anchorId,
      anchorType: resolved.anchorType
    };
    const originalId = entry.id;
    const localById = originalId ? document.annotations.find((item) => item.id === originalId) : undefined;
    if (localById) {
      incoming.anchorId = localById.anchorId;
      incoming.anchorType = localById.anchorType;
    }
    const referenceWarnings: string[] = [];
    const mappedReferences = entry.references.map((reference) => {
      if (document.annotations.some((item) => item.id === reference)) return reference;
      const incomingTarget = incomingIdMap.get(reference);
      if (incomingTarget) return incomingTarget;
      referenceWarnings.push(`互引 ${reference} 在本地和来稿中均不存在，导入时将移除。`);
      return '';
    }).filter(Boolean);
    incoming.references = Array.from(new Set(mappedReferences));

    const duplicateIncoming = originalId && seenIncomingIds.has(originalId);
    if (duplicateIncoming) referenceWarnings.push('来稿内部存在重复 ID，已按独立注释分配新 ID。');
    if (originalId) seenIncomingIds.add(originalId);

    if (localById) {
      const changedFields = changedFieldLabels(localById, incoming, localById.anchorId, localById.anchorType);
      if (!changedFields.length) {
        items.push({
          key,
          category: 'unchanged',
          decision: 'skip',
          incoming,
          local: localById,
          plannedId: localById.id,
          changedFields: [],
          anchorWarning: '',
          referenceWarnings,
          mergeDraft: { title: '', body: '', source: '' }
        });
        return;
      }

      items.push({
        key,
        category: 'update',
        decision: 'pending',
        incoming,
        local: localById,
        plannedId: localById.id,
        changedFields,
        anchorWarning: '',
        referenceWarnings,
        mergeDraft: makeMergeDraft(localById, incoming)
      });
      return;
    }

    const locals = document.annotations.filter(
      (item) => item.anchorId === resolved.anchorId && item.anchorType === resolved.anchorType && item.kind === incoming.kind
    );

    if (locals.length) {
      items.push({
        key,
        category: 'conflict',
        decision: 'pending',
        incoming,
        locals,
        plannedId,
        mergeTargetId: locals[0].id,
        changedFields: [],
        anchorWarning: resolved.warning,
        referenceWarnings,
        mergeDraft: makeMergeDraft(locals[0], incoming, locals.slice(1))
      });
      return;
    }

    items.push({
      key,
      category: 'new',
      decision: 'import',
      incoming,
      plannedId,
      changedFields: [],
      anchorWarning: resolved.warning,
      referenceWarnings,
      mergeDraft: { title: '', body: '', source: '' }
    });
  });

  return { items, packageAnnotationCount: array.length };
}

export function pendingReviewCount(items: ImportReviewItem[]) {
  return items.filter((item) => item.decision === 'pending').length;
}

export function selectedReviewCount(items: ImportReviewItem[]) {
  return items.filter((item) => {
    if (item.category === 'new') return item.decision === 'import';
    if (item.category === 'update') return item.decision === 'use-incoming' || item.decision === 'merge';
    if (item.category === 'conflict') return item.decision === 'use-incoming' || item.decision === 'merge';
    return false;
  }).length;
}

export function applyImportReview(document: TextDocument, reviewItems: ImportReviewItem[]): number {
  const items = reviewItems.filter((item) => item.category !== 'invalid' && item.category !== 'unchanged');
  const selectedItems = items.filter((item) => item.decision === 'import' || item.decision === 'use-incoming' || item.decision === 'merge');

  const finalIds = new Set<string>();
  const incomingToFinal = new Map<string, string>();
  for (const item of selectedItems) {
    if (item.category === 'update' && item.local) {
      finalIds.add(item.local.id);
      incomingToFinal.set(item.plannedId, item.local.id);
    } else if (item.category === 'conflict' && item.decision === 'merge' && item.mergeTargetId) {
      finalIds.add(item.mergeTargetId);
      incomingToFinal.set(item.plannedId, item.mergeTargetId);
    } else {
      finalIds.add(item.plannedId);
      incomingToFinal.set(item.plannedId, item.plannedId);
    }
  }
  for (const annotation of document.annotations) finalIds.add(annotation.id);

  let applied = 0;
  for (const item of selectedItems) {
    const references = Array.from(
      new Set(
        item.incoming.references
          .map((reference) => incomingToFinal.get(reference) ?? reference)
          .filter((reference) => finalIds.has(reference))
      )
    );
    const timestamp = nowString();

    if (item.category === 'new' && item.decision === 'import') {
      document.annotations.push({
        ...clone(item.incoming),
        id: item.plannedId,
        references,
        status: item.incoming.status,
        conflictState: 'open',
        updatedAt: timestamp
      });
      applied += 1;
      continue;
    }

    if (item.category === 'update' && item.local) {
      const local = document.annotations.find((annotation) => annotation.id === item.local!.id);
      if (!local) continue;
      if (item.decision === 'use-incoming') {
        const localId = local.id;
        Object.assign(local, clone(item.incoming), { id: localId, references, updatedAt: timestamp });
        applied += 1;
      } else if (item.decision === 'merge') {
        local.title = item.mergeDraft.title.trim() || local.title;
        local.body = item.mergeDraft.body.trim() || local.body;
        local.source = item.mergeDraft.source.trim() || local.source;
        local.anchorId = item.incoming.anchorId;
        local.anchorType = item.incoming.anchorType;
        local.tags = mergeLists(local.tags, item.incoming.tags);
        local.references = Array.from(new Set([...local.references, ...references]));
        local.updatedAt = timestamp;
        applied += 1;
      }
      continue;
    }

    if (item.category !== 'conflict') continue;
    const group = document.annotations.filter(
      (annotation) =>
        annotation.anchorId === item.incoming.anchorId &&
        annotation.anchorType === item.incoming.anchorType &&
        annotation.kind === item.incoming.kind
    );

    if (item.decision === 'use-incoming') {
      for (const annotation of group) {
        annotation.conflictState = 'resolved';
        annotation.conflictResolution = `${timestamp} · 导入预审保留本地来源记录`;
      }
      document.annotations.push({
        ...clone(item.incoming),
        id: item.plannedId,
        references,
        status: item.incoming.status,
        conflictState: 'resolved',
        conflictResolution: `${timestamp} · 导入预审采用来稿：${item.incoming.source}`,
        updatedAt: timestamp
      });
      finalIds.add(item.plannedId);
      applied += 1;
    } else if (item.decision === 'merge') {
      const target = document.annotations.find((annotation) => annotation.id === item.mergeTargetId) ?? group[0];
      if (!target) continue;
      target.title = item.mergeDraft.title.trim() || target.title;
      target.body = item.mergeDraft.body.trim() || target.body;
      target.source = item.mergeDraft.source.trim() || target.source;
      target.tags = mergeLists(target.tags, ...group.map((annotation) => annotation.tags), item.incoming.tags);
      target.references = Array.from(new Set([...target.references, ...references]));
      target.conflictState = 'resolved';
      target.conflictResolution = `${timestamp} · 导入预审合并来稿：${item.incoming.source}`;
      target.updatedAt = timestamp;
      for (const annotation of group) {
        if (annotation.id !== target.id) annotation.conflictState = 'resolved';
      }
      applied += 1;
    }
  }

  return applied;
}

export const importCategoryLabels: Record<ImportReviewCategory, string> = {
  new: '新增注释',
  update: '同条注释更新',
  conflict: '来源冲突',
  unchanged: '完全相同',
  invalid: '无法导入'
};

export const sampleImportPackage = JSON.stringify(
  {
    package: 'scholar-annotations',
    annotations: [
      {
        id: 'annotation-1',
        anchorId: 'sentence-1-1',
        anchorType: 'sentence',
        kind: 'footnote',
        title: '北冥',
        body: '冥通溟，指北方广漠幽深之海；近出帛书异文亦可参。',
        source: '会校本修订',
        references: [],
        tags: ['地理', '通假', '新校'],
        status: 'open'
      },
      {
        id: 'incoming-note-north-sea',
        anchorId: 'sentence-1-2',
        anchorType: 'sentence',
        kind: 'background',
        title: '夸饰尺度',
        body: '“几千里”以不可尽度量的数字展开鲲鹏叙事的空间尺度。',
        source: '学者来稿',
        references: ['incoming-crossref-peng'],
        tags: ['义理']
      },
      {
        id: 'incoming-crossref-peng',
        anchorId: 'sentence-1-1',
        anchorType: 'sentence',
        kind: 'footnote',
        title: '北冥别解',
        body: '或谓北冥仅为寓言地名，不应以后世地理志强实其处。',
        source: '外篇参证',
        references: ['incoming-note-north-sea'],
        tags: ['地理', '寓言']
      }
    ]
  },
  null,
  2
);

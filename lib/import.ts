import type {
  AnchorType,
  Annotation,
  AnnotationKind,
  Chapter,
  TextDocument
} from './types';

export type ImportCategory = 'new' | 'update' | 'conflict' | 'duplicate' | 'invalid';
export type ImportDecision =
  | 'skip' // 新增：跳过；更新/冲突：保留本地
  | 'import' // 新增/冲突：导入
  | 'incoming' // 更新：采用来稿
  | 'merge'; // 更新/冲突：合并

export interface ResolvedAnchor {
  anchorId: string;
  anchorType: AnchorType;
  anchorLabel: string;
  /** 词级目标在正文中已找不到，按规则回退挂接到所属句 */
  fellBackToSentence: boolean;
}

export interface IncomingAnnotation {
  id: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  title: string;
  body: string;
  source: string;
  references: string[];
  tags: string[];
  updatedAt?: string;
  /** 锚点 ID 失效时的定位线索：所在句 ID / 句子文本 / 章节标题 */
  sentenceId?: string;
  sentenceText?: string;
  chapterTitle?: string;
  anchorText?: string;
}

export interface ChangedField {
  field: 'title' | 'body' | 'source' | 'tags' | 'references' | 'anchor';
  label: string;
  local: string;
  incoming: string;
}

export interface ImportItem {
  /** 来稿内序号，用作 React key 与去重依据 */
  key: number;
  raw: IncomingAnnotation;
  category: ImportCategory;
  decision: ImportDecision;
  selected: boolean;
  issues: string[];
  anchor: ResolvedAnchor | null;
  /** 更新/冲突时对应的本地注释（冲突取同组首条） */
  local: Annotation | null;
  /** 冲突时本地同一引用目标、同一类型的全部既有注释 */
  localPeers: Annotation[];
  changedFields: ChangedField[];
  /** 合并后可编辑草稿 */
  merged: {
    title: string;
    body: string;
    source: string;
    references: string[];
    tags: string[];
  };
  /** 批内重复时指向先来稿序号（1 起） */
  duplicateOf: number | null;
}

export interface InvalidEntry {
  index: number;
  reason: string;
  raw: unknown;
}

export interface ImportPreview {
  items: ImportItem[];
  invalid: InvalidEntry[];
  counts: Record<ImportCategory, number>;
  selectedCount: number;
}

const KIND_VALUES: AnnotationKind[] = ['footnote', 'variant', 'background', 'crossref'];
const ANCHOR_VALUES: AnchorType[] = ['chapter', 'sentence', 'word'];

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/**
 * 解析来稿 JSON。支持三种形态：
 * 1. 注释数组 [{...}]
 * 2. 文档对象 { annotations: [...] }（导出的完整 JSON）
 * 3. 校注包 { package: { annotations: [...] } }
 */
export function parseIncoming(jsonText: string): { entries: IncomingAnnotation[]; invalid: InvalidEntry[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`JSON 格式有误，无法解析：${error instanceof Error ? error.message : String(error)}`);
  }

  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { annotations?: unknown[] })?.annotations)
      ? (parsed as { annotations: unknown[] }).annotations
      : Array.isArray((parsed as { package?: { annotations?: unknown[] } })?.package?.annotations)
        ? (parsed as { package: { annotations: unknown[] } }).package.annotations
        : [];

  if (!rawList.length) {
    throw new Error('来稿中未找到注释数据：需要注释数组，或带 annotations 字段的对象。');
  }

  const entries: IncomingAnnotation[] = [];
  const invalid: InvalidEntry[] = [];
  rawList.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      invalid.push({ index: index + 1, reason: '不是有效的注释对象', raw });
      return;
    }
    const record = raw as Record<string, unknown>;
    const anchorType = asString(record.anchorType);
    const kind = asString(record.kind);
    const anchorId = asString(record.anchorId);
    const title = asString(record.title);
    const body = asString(record.body);
    if (!ANCHOR_VALUES.includes(anchorType as AnchorType)) {
      invalid.push({ index: index + 1, reason: `anchorType 无效（${anchorType || '缺失'}）`, raw });
      return;
    }
    if (!KIND_VALUES.includes(kind as AnnotationKind)) {
      invalid.push({ index: index + 1, reason: `kind 无效（${kind || '缺失'}）`, raw });
      return;
    }
    if (!anchorId) {
      invalid.push({ index: index + 1, reason: '缺少 anchorId', raw });
      return;
    }
    if (!title || !body) {
      invalid.push({ index: index + 1, reason: !title ? '缺少标题' : '缺少正文', raw });
      return;
    }
    entries.push({
      id: asString(record.id) || `来稿-${index + 1}`,
      anchorId,
      anchorType: anchorType as AnchorType,
      kind: kind as AnnotationKind,
      title,
      body,
      source: asString(record.source) || '未署名',
      references: asStringArray(record.references),
      tags: asStringArray(record.tags),
      updatedAt: asString(record.updatedAt) || undefined,
      sentenceId: asString(record.sentenceId) || undefined,
      sentenceText: asString(record.sentenceText) || undefined,
      chapterTitle: asString(record.chapterTitle) || undefined,
      anchorText: asString(record.anchorText) || undefined
    });
  });

  return { entries, invalid };
}

function findSentence(document: TextDocument, sentenceId: string) {
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (sentence) return { chapter, sentence };
  }
  return null;
}

/**
 * 将来稿锚点解析到本地正文。词级锚点失效时自动迁移到所属句，
 * 保证引用始终接到现有的句子或词语上，绝不产生悬空引用。
 */
export function resolveAnchor(document: TextDocument, raw: IncomingAnnotation): ResolvedAnchor | null {
  // 章节
  if (raw.anchorType === 'chapter') {
    const byId = document.chapters.find((chapter) => chapter.id === raw.anchorId);
    if (byId) return { anchorId: byId.id, anchorType: 'chapter', anchorLabel: byId.title, fellBackToSentence: false };
    const byTitle = document.chapters.find(
      (chapter) => chapter.title === raw.anchorId || chapter.title === raw.chapterTitle
    );
    if (byTitle) return { anchorId: byTitle.id, anchorType: 'chapter', anchorLabel: byTitle.title, fellBackToSentence: false };
    return null;
  }

  // 句子：ID 直查
  let hit = findSentence(document, raw.anchorId);
  if (!hit && raw.sentenceId) hit = findSentence(document, raw.sentenceId);
  if (!hit && raw.sentenceText) {
    for (const chapter of document.chapters) {
      const sentence = chapter.sentences.find((item) => item.text === raw.sentenceText);
      if (sentence) {
        hit = { chapter, sentence };
        break;
      }
    }
  }
  if (!hit && raw.anchorType === 'sentence' && raw.chapterTitle) {
    const chapter = document.chapters.find((item) => item.title === raw.chapterTitle);
    const sentence = chapter?.sentences.find((item) => item.text === raw.anchorId);
    if (chapter && sentence) hit = { chapter, sentence };
  }

  // 词级：先按 token ID
  if (raw.anchorType === 'word') {
    for (const chapter of document.chapters) {
      for (const sentence of chapter.sentences) {
        const token = sentence.tokens.find((item) => item.id === raw.anchorId);
        if (token) {
          return {
            anchorId: token.id,
            anchorType: 'word',
            anchorLabel: `${chapter.title} · “${token.text.trim()}”`,
            fellBackToSentence: false
          };
        }
      }
    }
    // 线索：指定句内按词语文本匹配（分词可能把单字并入相邻 token）
    const scope = hit ? [hit] : document.chapters.flatMap((chapter) => chapter.sentences.map((sentence) => ({ chapter, sentence })));
    const needle = raw.anchorText || (raw.anchorId.length <= 8 ? raw.anchorId : '');
    if (needle) {
      for (const { chapter, sentence } of scope) {
        const token =
          sentence.tokens.find((item) => item.text.trim() === needle) ??
          sentence.tokens.find((item) => item.text.includes(needle));
        if (token) {
          return {
            anchorId: token.id,
            anchorType: 'word',
            anchorLabel: `${chapter.title} · “${token.text.trim()}”`,
            fellBackToSentence: false
          };
        }
      }
    }
    // 回退：挂到线索指定的所属句
    if (hit) {
      return {
        anchorId: hit.sentence.id,
        anchorType: 'sentence',
        anchorLabel: `${hit.chapter.title} · 第 ${hit.sentence.order} 句`,
        fellBackToSentence: true
      };
    }
    // 再退一步：词语只在某一句正文中唯一出现，则挂到该句
    if (needle) {
      const containing = document.chapters
        .flatMap((chapter) => chapter.sentences.map((sentence) => ({ chapter, sentence })))
        .filter(({ sentence }) => sentence.text.includes(needle));
      if (containing.length === 1) {
        return {
          anchorId: containing[0].sentence.id,
          anchorType: 'sentence',
          anchorLabel: `${containing[0].chapter.title} · 第 ${containing[0].sentence.order} 句`,
          fellBackToSentence: true
        };
      }
    }
    return null;
  }

  if (hit) {
    return {
      anchorId: hit.sentence.id,
      anchorType: 'sentence',
      anchorLabel: `${hit.chapter.title} · 第 ${hit.sentence.order} 句`,
      fellBackToSentence: false
    };
  }
  return null;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function displayList(values: string[]): string {
  return values.length ? values.join('、') : '（空）';
}

function diffAnnotations(local: Annotation, incoming: IncomingAnnotation, anchorChanged: boolean): ChangedField[] {
  const fields: ChangedField[] = [];
  if (anchorChanged) {
    fields.push({ field: 'anchor', label: '引用目标', local: local.anchorId, incoming: `${incoming.anchorId}` });
  }
  if (local.title !== incoming.title) {
    fields.push({ field: 'title', label: '标题', local: local.title, incoming: incoming.title });
  }
  if (local.body.trim() !== incoming.body.trim()) {
    fields.push({ field: 'body', label: '正文', local: local.body, incoming: incoming.body });
  }
  if (local.source !== incoming.source) {
    fields.push({ field: 'source', label: '来源', local: local.source, incoming: incoming.source });
  }
  if (dedupe(local.tags).join('|') !== dedupe(incoming.tags).join('|')) {
    fields.push({ field: 'tags', label: '标签', local: displayList(local.tags), incoming: displayList(incoming.tags) });
  }
  if (dedupe(local.references).join('|') !== dedupe(incoming.references).join('|')) {
    fields.push({
      field: 'references',
      label: '引用',
      local: displayList(local.references),
      incoming: displayList(incoming.references)
    });
  }
  return fields;
}

function mergedDraft(locals: Annotation | Annotation[], incoming: IncomingAnnotation) {
  const list = Array.isArray(locals) ? locals : [locals];
  return {
    title: list[0]?.title ?? incoming.title,
    body: dedupe([...list.map((item) => item.body.trim()), incoming.body.trim()]).join('\n\n'),
    source: dedupe([...list.map((item) => item.source), incoming.source]).join(' + '),
    references: dedupe(list.flatMap((item) => item.references).concat(incoming.references)),
    tags: dedupe(list.flatMap((item) => item.tags).concat(incoming.tags))
  };
}

/** 预审：把来稿逐条分为新增、更新、来源冲突、重复、无法定位。 */
export function buildImportPreview(document: TextDocument, entries: IncomingAnnotation[], invalid: InvalidEntry[]): ImportPreview {
  const localById = new Map(document.annotations.map((annotation) => [annotation.id, annotation]));
  const seenIncomingId = new Map<string, number>();
  const seenIncomingContent = new Map<string, number>();
  const items: ImportItem[] = [];

  entries.forEach((raw, index) => {
    const key = index + 1;
    const issues: string[] = [];
    const anchor = resolveAnchor(document, raw);
    if (!anchor) {
      items.push({
        key,
        raw,
        category: 'invalid',
        decision: 'skip',
        selected: false,
        issues: [`本地正文中找不到引用目标（${raw.anchorType} · ${raw.anchorId}），且没有可用的定位线索`],
        anchor: null,
        local: null,
        localPeers: [],
        changedFields: [],
        merged: { title: '', body: '', source: '', references: [], tags: [] },
        duplicateOf: null
      });
      return;
    }
    if (anchor.fellBackToSentence) {
      issues.push(`词级目标“${raw.anchorText || raw.anchorId}”无法直接对应本地词语，引用将挂到所属句：${anchor.anchorLabel}`);
    }

    const idDuplicate = seenIncomingId.get(raw.id);
    const contentSignature = `${anchor.anchorId}:${raw.kind}:${raw.body.trim()}`;
    const contentDuplicate = seenIncomingContent.get(contentSignature);

    const local = localById.get(raw.id) ?? null;
    const sameTargetLocal = document.annotations.filter(
      (annotation) =>
        annotation.anchorId === anchor.anchorId &&
        annotation.anchorType === anchor.anchorType &&
        annotation.kind === raw.kind
    );

    let category: ImportCategory;
    let decision: ImportDecision;
    let changedFields: ChangedField[] = [];
    let merged = { title: '', body: '', source: '', references: [] as string[], tags: [] as string[] };
    let duplicateOf: number | null = null;
    let localPeers: Annotation[] = [];

    if (local) {
      const anchorChanged = local.anchorId !== anchor.anchorId || local.anchorType !== anchor.anchorType;
      changedFields = diffAnnotations(local, raw, anchorChanged);
      category = 'update';
      // 默认逐条送审：有差异则默认合并且勾中；无差异则保留本地、不勾选
      decision = changedFields.length ? 'merge' : 'skip';
      merged = mergedDraft(local, raw);
      if (anchorChanged) issues.push('来稿的引用目标与本地不同，采用/合并时将以解析到的本地目标为准');
      if (!changedFields.length) issues.push('与本地内容一致，无需更新；勾选后也可强制采用或合并。');
    } else {
      const identicalLocal = sameTargetLocal.find((annotation) => annotation.body.trim() === raw.body.trim());

      if (identicalLocal || idDuplicate || contentDuplicate) {
        category = 'duplicate';
        decision = 'skip';
        if (identicalLocal) issues.push(`与本地注释 ${identicalLocal.id} 的目标、类型与正文完全一致`);
        duplicateOf = idDuplicate ?? contentDuplicate ?? null;
        if (duplicateOf) issues.push(`与来稿第 ${duplicateOf} 条重复`);
      } else if (sameTargetLocal.length) {
        category = 'conflict';
        decision = 'import';
        localPeers = sameTargetLocal;
        merged = mergedDraft(sameTargetLocal[0], raw);
        issues.push(`同一引用目标下已有 ${sameTargetLocal.length} 条${sameTargetLocal.length > 1 ? '不同' : ''}来源，导入后进入冲突列表`);
      } else {
        category = 'new';
        decision = 'import';
      }
    }

    seenIncomingId.set(raw.id, key);
    seenIncomingContent.set(contentSignature, key);

    items.push({
      key,
      raw,
      category,
      decision,
      selected: decision !== 'skip',
      issues,
      anchor,
      local,
      localPeers,
      changedFields,
      merged,
      duplicateOf
    });
  });

  const counts: Record<ImportCategory, number> = { new: 0, update: 0, conflict: 0, duplicate: 0, invalid: 0 };
  for (const item of items) counts[item.category] += 1;

  return { items, invalid, counts, selectedCount: items.filter((item) => item.selected).length };
}

let importSequence = 0;

function nextAnnotationId() {
  importSequence += 1;
  return `annotation-import-${Date.now().toString(36)}-${importSequence}`;
}

export interface AppliedImport {
  added: number;
  updated: number;
  conflicted: number;
  merged: number;
  droppedReferences: { itemKey: number; refs: string[] }[];
  newIds: Map<number, string>;
}

/**
 * 按预审结果落库：只处理勾选项；不动章节正文、快照与未勾选项。
 * 引用统一重映射：本地已有 ID 保留，指向导入新注释的 ID 改写，悬空 ID 丢弃。
 */
export function applyImport(document: TextDocument, preview: ImportPreview): AppliedImport {
  const chosen = preview.items.filter((item) => item.selected);
  const localIds = new Set(document.annotations.map((annotation) => annotation.id));

  // 为将以“新注释”身份进入的勾选项（新增、冲突采用、冲突合并）分配本地 ID
  const newIds = new Map<number, string>();
  for (const item of chosen) {
    if (
      (item.category === 'new' || item.category === 'conflict') &&
      item.selected &&
      item.decision !== 'skip'
    ) {
      let id = nextAnnotationId();
      while (localIds.has(id)) id = nextAnnotationId();
      newIds.set(item.key, id);
      localIds.add(id);
    }
  }

  const resolveReferences = (refs: string[], itemKey: number, dropped: string[]) =>
    dedupe(refs).flatMap((ref) => {
      if (localIds.has(ref)) return [ref];
      const remapped = newIds.get(preview.items.find((item) => item.raw.id === ref)?.key ?? -1);
      if (remapped) return [remapped];
      dropped.push(ref);
      return [];
    });

  const droppedReferences: { itemKey: number; refs: string[] }[] = [];
  let added = 0;
  let updated = 0;
  let conflicted = 0;
  let merged = 0;
  const now = new Date().toISOString();

  for (const item of chosen) {
    const dropped: string[] = [];
    if (item.category === 'new') {
      const id = newIds.get(item.key)!;
      document.annotations.push({
        id,
        anchorId: item.anchor!.anchorId,
        anchorType: item.anchor!.anchorType,
        kind: item.raw.kind,
        title: item.raw.title,
        body: item.raw.body,
        source: item.raw.source,
        references: resolveReferences(item.raw.references, item.key, dropped),
        status: 'open',
        tags: item.raw.tags,
        conflictState: 'open',
        updatedAt: now
      });
      added += 1;
    } else if (item.category === 'conflict') {
      const id = newIds.get(item.key)!;
      if (item.decision === 'merge') {
        document.annotations.push({
          id,
          anchorId: item.anchor!.anchorId,
          anchorType: item.anchor!.anchorType,
          kind: item.raw.kind,
          title: item.merged.title || item.raw.title,
          body: item.merged.body || item.raw.body,
          source: item.merged.source || item.raw.source,
          references: resolveReferences(item.merged.references, item.key, dropped),
          status: 'open',
          tags: item.merged.tags,
          conflictState: 'open',
          updatedAt: now
        });
        merged += 1;
      } else {
        document.annotations.push({
          id,
          anchorId: item.anchor!.anchorId,
          anchorType: item.anchor!.anchorType,
          kind: item.raw.kind,
          title: item.raw.title,
          body: item.raw.body,
          source: item.raw.source,
          references: resolveReferences(item.raw.references, item.key, dropped),
          status: 'open',
          tags: item.raw.tags,
          conflictState: 'open',
          updatedAt: now
        });
        conflicted += 1;
      }
    } else if (item.category === 'update' && item.local) {
      const target = document.annotations.find((annotation) => annotation.id === item.local!.id);
      if (!target) continue;
      if (item.decision === 'incoming') {
        target.anchorId = item.anchor!.anchorId;
        target.anchorType = item.anchor!.anchorType;
        target.kind = item.raw.kind;
        target.title = item.raw.title;
        target.body = item.raw.body;
        target.source = item.raw.source;
        target.tags = dedupe(item.raw.tags);
        target.references = resolveReferences(item.raw.references, item.key, dropped);
        target.updatedAt = now;
        updated += 1;
      } else if (item.decision === 'merge') {
        target.anchorId = item.anchor!.anchorId;
        target.anchorType = item.anchor!.anchorType;
        target.title = item.merged.title || target.title;
        target.body = item.merged.body || target.body;
        target.source = item.merged.source || target.source;
        target.tags = dedupe([...target.tags, ...item.merged.tags]);
        target.references = resolveReferences(item.merged.references, item.key, dropped);
        target.updatedAt = now;
        merged += 1;
      }
    }
    if (dropped.length) droppedReferences.push({ itemKey: item.key, refs: dropped });
  }

  return { added, updated, conflicted, merged, droppedReferences, newIds };
}

/** 示例来稿：覆盖新增、更新、来源冲突、重复与无法定位五种情形。 */
export const SAMPLE_INCOMING_JSON = JSON.stringify(
  {
    package: {
      name: '会校组第二批校注',
      sentBy: '某学者',
      annotations: [
        {
          id: 'annotation-1',
          anchorId: 'sentence-1-1',
          anchorType: 'sentence',
          kind: 'footnote',
          title: '北冥（修订）',
          body: '冥，一作溟。北方幽冥之海，据《逍遥游》篇内“南冥”对文，当以水域为释。',
          source: '郭庆藩本（会校修订）',
          references: ['annotation-2'],
          tags: ['地理', '通假', '会校']
        },
        {
          id: 'wai-peng-beijing',
          anchorId: 'sentence-1-3',
          anchorType: 'sentence',
          kind: 'background',
          title: '化鸟的规模',
          body: '鲲化而为鹏，是形体与视野的双重转化，后文“垂天之云”正写其大。',
          source: '会校组',
          references: [],
          tags: ['义理']
        },
        {
          id: 'wai-beiming-xinshuo',
          anchorId: 'sentence-1-1',
          anchorType: 'sentence',
          kind: 'footnote',
          title: '北冥（章门新说）',
          body: '北冥不必实指海名，乃喻修养所至的玄远之境，与“南冥”同为寓言设色。',
          source: '章太炎《庄子解故》',
          references: ['annotation-1'],
          tags: ['义理']
        },
        {
          id: 'wai-hebo-mingwu',
          anchorId: '__lost_token__',
          anchorType: 'word',
          kind: 'background',
          title: '河伯',
          body: '河伯为黄河水神，战国以来民间祀之，此处借为小知之喻。',
          source: '民俗笺证',
          sentenceId: 'sentence-3-3',
          anchorText: '河伯',
          references: [],
          tags: ['名物']
        },
        {
          id: 'wai-peng-yiwen-bieben',
          anchorId: '__lost_token__',
          anchorType: 'word',
          kind: 'variant',
          title: '鹏字异文（别本）',
          body: '别本或作“朋”，乃声借；《庄子》故书当作“鹏”，与鲲化之义相贯。',
          source: '敦煌残卷校录',
          sentenceId: 'sentence-1-3',
          anchorText: '鹏',
          references: ['annotation-3'],
          tags: ['异文', '字形']
        },
        {
          id: 'wai-haishen-huisuo',
          anchorId: '__lost_token__',
          anchorType: 'word',
          kind: 'background',
          title: '海神（北海若）',
          body: '北海若为北海之神，设名“若”，与河伯问答以推进大小之辨。',
          source: '名物丛考',
          sentenceId: 'sentence-3-3',
          anchorText: '海神',
          references: [],
          tags: ['名物']
        },
        {
          id: 'wai-kouyin-dup',
          anchorId: 'sentence-2-4',
          anchorType: 'sentence',
          kind: 'variant',
          title: '鷇音（同文转录）',
          body: '鷇音指雏鸟待哺之声。旧注或释为鸟鸣，义可并存。',
          source: '成玄英疏（转录）',
          references: [],
          tags: ['异文', '训诂']
        },
        {
          id: 'wai-missing-target',
          anchorId: 'sentence-99-9',
          anchorType: 'sentence',
          kind: 'footnote',
          title: '无法定位的来稿',
          body: '该条引用的句子在本地正文中不存在，应被预审拦下。',
          source: '外稿',
          references: [],
          tags: []
        }
      ]
    }
  },
  null,
  2
);

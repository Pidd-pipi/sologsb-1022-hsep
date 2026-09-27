'use client';

import {
  AlertTriangle,
  Check,
  CircleSlash,
  ClipboardList,
  Combine,
  Eraser,
  FileUp,
  Link2,
  PencilLine,
  Sparkles
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, CardBody, Chip, Input, ScrollShadow, Textarea } from '@heroui/react';
import { annotationKindLabels, anchorTypeLabels } from '@/lib/data';
import { getTargetLabel } from '@/lib/editor';
import {
  applyImportReview,
  createImportReview,
  importCategoryLabels,
  pendingReviewCount,
  sampleImportPackage,
  selectedReviewCount,
  type ImportDecision,
  type ImportReviewItem
} from '@/lib/import-review';
import type { TextDocument } from '@/lib/types';

interface ImportReviewPanelProps {
  document: TextDocument;
  onApplied: (count: number, items: ImportReviewItem[]) => void;
}

const categoryColors = {
  new: 'success',
  update: 'primary',
  conflict: 'danger',
  unchanged: 'default',
  invalid: 'warning'
} as const;

function decisionClass(active: boolean, tone: 'primary' | 'danger' | 'neutral') {
  if (!active) return 'border-stone-200 bg-white text-stone-600';
  if (tone === 'primary') return 'border-amber-500 bg-amber-50 text-amber-900';
  if (tone === 'danger') return 'border-red-500 bg-red-50 text-red-900';
  return 'border-stone-500 bg-stone-100 text-stone-900';
}

function AnnotationSnapshot({ title, body, source, references, tags }: {
  title: string;
  body: string;
  source: string;
  references: string[];
  tags: string[];
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <b className="text-sm leading-5 text-stone-900">{title}</b>
        <Chip size="sm" variant="flat" className="shrink-0">{source}</Chip>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-stone-700">{body}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {tags.map((tag) => <Chip key={tag} size="sm" variant="bordered">{tag}</Chip>)}
        {references.length ? (
          <Chip size="sm" variant="flat" startContent={<Link2 className="h-3 w-3" />}>互引 {references.length}</Chip>
        ) : null}
      </div>
    </div>
  );
}

export function ImportReviewPanel({ document, onApplied }: ImportReviewPanelProps) {
  const [rawPackage, setRawPackage] = useState('');
  const [review, setReview] = useState<ImportReviewItem[] | null>(null);
  const [parseError, setParseError] = useState('');
  const [notice, setNotice] = useState('粘贴 JSON 后先预审，不会立即覆盖本地注释或历史快照。');

  const counts = useMemo(() => {
    const items = review ?? [];
    return {
      new: items.filter((item) => item.category === 'new').length,
      update: items.filter((item) => item.category === 'update').length,
      conflict: items.filter((item) => item.category === 'conflict').length,
      unchanged: items.filter((item) => item.category === 'unchanged').length,
      invalid: items.filter((item) => item.category === 'invalid').length
    };
  }, [review]);

  const pending = review ? pendingReviewCount(review) : 0;
  const selected = review ? selectedReviewCount(review) : 0;

  function runPreview() {
    const result = createImportReview(document, rawPackage);
    setParseError(result.error ?? '');
    setReview(result.error ? null : result.items);
    setNotice(
      result.error
        ? '预审未开始，请修正 JSON 后重试。'
        : `预审完成：${result.packageAnnotationCount} 条来稿；请逐项处理更新与来源冲突。`
    );
  }

  function setDecision(key: string, decision: ImportDecision) {
    setReview((items) => items?.map((item) => (item.key === key ? { ...item, decision } : item)) ?? null);
  }

  function updateMergeDraft(key: string, patch: Partial<ImportReviewItem['mergeDraft']>) {
    setReview((items) => items?.map((item) => (
      item.key === key ? { ...item, mergeDraft: { ...item.mergeDraft, ...patch } } : item
    )) ?? null);
  }

  function resolveAll(decision: Extract<ImportDecision, 'keep-local' | 'use-incoming' | 'merge'>) {
    setReview((items) => items?.map((item) => (
      item.decision === 'pending' ? { ...item, decision } : item
    )) ?? null);
  }

  function clearReview() {
    setRawPackage('');
    setReview(null);
    setParseError('');
    setNotice('已清空来稿；本地注释和历史快照未发生变化。');
  }

  function confirmImport() {
    if (!review || pending) return;
    const nextDocument = structuredClone(document);
    const count = applyImportReview(nextDocument, review);
    onApplied(count, review);
    setReview(null);
    setRawPackage('');
    setNotice(`已确认导入 ${count} 条勾选处理结果；无关注释、正文与历史快照保持原样。`);
  }

  return (
    <div className="space-y-4 pr-1">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
        导入预审只比较注释，不会直接覆盖。引用目标会匹配到现有章节、句子或词语；无法定位的条目将排除，避免产生悬空引用。
      </div>

      <Textarea
        aria-label="粘贴 JSON 校注包"
        label="来稿 JSON"
        value={rawPackage}
        onValueChange={setRawPackage}
        minRows={7}
        placeholder='粘贴整个文档，或 { "annotations": [...] }'
        className="font-mono text-xs"
      />

      {parseError ? (
        <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{parseError}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" color="primary" variant="flat" startContent={<ClipboardList className="h-4 w-4" />} onPress={runPreview}>
          开始预审
        </Button>
        <Button size="sm" variant="flat" startContent={<Sparkles className="h-4 w-4" />} onPress={() => setRawPackage(sampleImportPackage)}>
          填入示例
        </Button>
        <Button size="sm" variant="light" startContent={<Eraser className="h-4 w-4" />} onPress={clearReview}>
          清空
        </Button>
        <Button
          size="sm"
          color="success"
          isDisabled={!review || pending > 0}
          startContent={<FileUp className="h-4 w-4" />}
          onPress={confirmImport}
        >
          {pending ? `待处理 ${pending} 项` : `确认导入 ${selected} 项`}
        </Button>
      </div>
      <p className="text-[11px] leading-5 text-stone-500">{notice}</p>

      {review ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-green-50 p-2 text-green-800">新增<br /><b>{counts.new}</b></div>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-800">更新<br /><b>{counts.update}</b></div>
            <div className="rounded-lg bg-red-50 p-2 text-red-800">冲突<br /><b>{counts.conflict}</b></div>
          </div>

          {pending ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">还有 {pending} 项需要明确处理</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="flat" onPress={() => resolveAll('keep-local')}>全部保留本地</Button>
                <Button size="sm" variant="flat" onPress={() => resolveAll('use-incoming')}>全部采用来稿</Button>
                <Button size="sm" variant="flat" startContent={<Combine className="h-3.5 w-3.5" />} onPress={() => resolveAll('merge')}>
                  全部合并
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800">
              <Check className="h-4 w-4" />
              每项均已选择处理方式；确认时只落选中的新增、更新或合并内容。
            </div>
          )}

          <ScrollShadow className="max-h-[calc(100vh-470px)]">
            <div className="space-y-3">
              {review.map((item) => (
                <Card key={item.key} shadow="none" className={`border ${item.category === 'invalid' ? 'border-amber-200 bg-amber-50/40' : 'border-stone-200'}`}>
                  <CardBody className="gap-3 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip size="sm" color={categoryColors[item.category]} variant="flat">
                        {importCategoryLabels[item.category]}
                      </Chip>
                      <Chip size="sm" variant="bordered">
                        {anchorTypeLabels[item.incoming.anchorType]} · {annotationKindLabels[item.incoming.kind]}
                      </Chip>
                      {item.local || item.locals?.length ? (
                        <span className="text-[11px] text-stone-500">{getTargetLabel(document, item.local ?? item.locals![0])}</span>
                      ) : item.incoming.anchorId ? (
                        <span className="text-[11px] text-stone-500">{getTargetLabel(document, item.incoming)}</span>
                      ) : null}
                    </div>

                    {item.invalidReason ? (
                      <div className="flex gap-2 rounded-lg bg-amber-100 p-3 text-xs leading-5 text-amber-900">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{item.invalidReason}</span>
                      </div>
                    ) : (
                      <>
                        {item.category === 'update' && item.local ? (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-blue-700">本地版本</p>
                            <AnnotationSnapshot
                              title={item.local.title}
                              body={item.local.body}
                              source={item.local.source}
                              references={item.local.references}
                              tags={item.local.tags}
                            />
                            <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-amber-700">来稿版本</p>
                            <AnnotationSnapshot
                              title={item.incoming.title}
                              body={item.incoming.body}
                              source={item.incoming.source}
                              references={item.incoming.references}
                              tags={item.incoming.tags}
                            />
                            <div className="mt-2 flex flex-wrap gap-1">
                              {item.changedFields.map((field) => <Chip key={field} size="sm" color="primary" variant="flat">{field}</Chip>)}
                            </div>
                          </div>
                        ) : null}

                        {item.category === 'conflict' ? (
                          <div className="space-y-2">
                            <div>
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                                本地 {item.locals?.length ?? 0} 个来源
                              </p>
                              <div className="space-y-2">
                                {item.locals?.map((local) => (
                                  <AnnotationSnapshot
                                    key={local.id}
                                    title={local.title}
                                    body={local.body}
                                    source={local.source}
                                    references={local.references}
                                    tags={local.tags}
                                  />
                                ))}
                              </div>
                            </div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-red-700">来稿来源</p>
                            <AnnotationSnapshot
                              title={item.incoming.title}
                              body={item.incoming.body}
                              source={item.incoming.source}
                              references={item.incoming.references}
                              tags={item.incoming.tags}
                            />
                          </div>
                        ) : null}

                        {item.category === 'new' ? (
                          <AnnotationSnapshot
                            title={item.incoming.title}
                            body={item.incoming.body}
                            source={item.incoming.source}
                            references={item.incoming.references}
                            tags={item.incoming.tags}
                          />
                        ) : null}

                        {item.category === 'unchanged' ? (
                          <div className="flex items-center gap-2 rounded-lg bg-stone-100 p-3 text-xs text-stone-600">
                            <CircleSlash className="h-4 w-4" />
                            内容与本地完全一致，将自动忽略，不重复写入。
                          </div>
                        ) : null}

                        {item.anchorWarning ? (
                          <p className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-4 text-blue-800">{item.anchorWarning}</p>
                        ) : null}
                        {item.referenceWarnings.map((warning) => (
                          <p key={warning} className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">{warning}</p>
                        ))}

                        {item.category === 'new' ? (
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              variant="bordered"
                              className={decisionClass(item.decision === 'import', 'primary')}
                              onPress={() => setDecision(item.key, 'import')}
                            >
                              导入新增
                            </Button>
                            <Button
                              size="sm"
                              variant="bordered"
                              className={decisionClass(item.decision === 'skip', 'neutral')}
                              onPress={() => setDecision(item.key, 'skip')}
                            >
                              忽略
                            </Button>
                          </div>
                        ) : null}

                        {item.category === 'update' || item.category === 'conflict' ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                              <Button
                                size="sm"
                                variant="bordered"
                                className={decisionClass(item.decision === 'keep-local', 'neutral')}
                                onPress={() => setDecision(item.key, 'keep-local')}
                              >
                                保留本地
                              </Button>
                              <Button
                                size="sm"
                                variant="bordered"
                                className={decisionClass(item.decision === 'use-incoming', 'primary')}
                                onPress={() => setDecision(item.key, 'use-incoming')}
                              >
                                采用来稿
                              </Button>
                              <Button
                                size="sm"
                                variant="bordered"
                                className={decisionClass(item.decision === 'merge', 'danger')}
                                startContent={<Combine className="h-3.5 w-3.5" />}
                                onPress={() => setDecision(item.key, 'merge')}
                              >
                                合并
                              </Button>
                            </div>

                            {item.decision === 'merge' ? (
                              <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-2">
                                <div className="flex items-center gap-1 text-[11px] font-semibold text-red-800">
                                  <PencilLine className="h-3.5 w-3.5" />合并稿可在确认前调整
                                </div>
                                <Input
                                  size="sm"
                                  label="标题"
                                  value={item.mergeDraft.title}
                                  onValueChange={(title) => updateMergeDraft(item.key, { title })}
                                />
                                <Textarea
                                  size="sm"
                                  label="正文"
                                  minRows={4}
                                  value={item.mergeDraft.body}
                                  onValueChange={(body) => updateMergeDraft(item.key, { body })}
                                />
                                <Input
                                  size="sm"
                                  label="合并来源"
                                  value={item.mergeDraft.source}
                                  onValueChange={(source) => updateMergeDraft(item.key, { source })}
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          </ScrollShadow>
        </>
      ) : null}
    </div>
  );
}

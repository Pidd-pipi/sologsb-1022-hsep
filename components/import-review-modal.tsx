'use client';

import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
  Textarea
} from '@heroui/react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  GitMerge,
  Layers,
  PencilLine,
  PlusCircle,
  Sparkles,
  XCircle
} from 'lucide-react';
import { useState } from 'react';
import { anchorTypeLabels } from '@/lib/data';
import {
  SAMPLE_INCOMING_JSON,
  buildImportPreview,
  parseIncoming
} from '@/lib/import';
import type { AppliedImport, ImportCategory, ImportDecision, ImportItem, ImportPreview } from '@/lib/import';
import type { TextDocument } from '@/lib/types';
import { kindLabel } from '@/lib/editor';

interface ImportReviewModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  document: TextDocument;
  onConfirmImport: (preview: ImportPreview) => AppliedImport;
}

const CATEGORY_COPY: {
  key: ImportCategory;
  title: string;
  hint: string;
  chipColor: 'success' | 'primary' | 'danger' | 'default' | 'warning' | 'secondary';
  icon: React.ReactNode;
}[] = [
  { key: 'new', title: '新增注释', hint: '本地尚无同目标、同类型的注释，作为新条目导入。', chipColor: 'success', icon: <PlusCircle className="h-4 w-4" /> },
  { key: 'update', title: '同一条注释的更新', hint: 'ID 与本地一致，可保留本地、采用来稿，或合并后导入。', chipColor: 'primary', icon: <PencilLine className="h-4 w-4" /> },
  { key: 'conflict', title: '来源冲突', hint: '引用目标与注释类型相同但来源不同，导入后进入冲突列表。', chipColor: 'danger', icon: <AlertTriangle className="h-4 w-4" /> },
  { key: 'duplicate', title: '内容重复', hint: '与本地或来稿内已有条目完全相同，默认跳过。', chipColor: 'secondary', icon: <Layers className="h-4 w-4" /> },
  { key: 'invalid', title: '无法定位', hint: '在本地正文中找不到引用目标，不能导入。', chipColor: 'warning', icon: <XCircle className="h-4 w-4" /> }
];

const DECISION_LABEL: Record<ImportDecision, string> = {
  skip: '跳过',
  import: '导入来稿',
  incoming: '采用来稿',
  merge: '合并'
};

function SourceBlock({ label, tone, title, body, source, tags, references }: {
  label: string;
  tone: 'local' | 'incoming' | 'merged';
  title: string;
  body: string;
  source: string;
  tags: string[];
  references: string[];
}) {
  const palette =
    tone === 'local'
      ? 'border-stone-200 bg-stone-50'
      : tone === 'incoming'
        ? 'border-amber-200 bg-amber-50/70'
        : 'border-emerald-200 bg-emerald-50/70';
  return (
    <div className={`rounded-lg border ${palette} p-2.5`}>
      <div className="mb-1 flex items-center gap-2">
        <Chip size="sm" variant="flat" className="h-5 min-h-5">
          {label}
        </Chip>
        <b className="truncate text-xs text-stone-800">{source}</b>
      </div>
      <div className="text-xs font-semibold text-stone-800">{title}</div>
      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-stone-600">{body}</p>
      {(tags.length > 0 || references.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-stone-500">
          {tags.map((tag) => <Chip key={tag} size="sm" variant="bordered" className="h-5 min-h-5">{tag}</Chip>)}
          {references.length > 0 ? <span className="self-center">→ 引用：{references.join('、')}</span> : null}
        </div>
      )}
    </div>
  );
}

function DecisionButtons({ item, onChange }: { item: ImportItem; onChange: (decision: ImportDecision) => void }) {
  if (item.category === 'new') {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          color={item.decision === 'import' ? 'success' : 'default'}
          variant={item.decision === 'import' ? 'solid' : 'flat'}
          onPress={() => onChange('import')}
        >
          导入
        </Button>
        <Button
          size="sm"
          variant={item.decision === 'skip' ? 'ghost' : 'flat'}
          color={item.decision === 'skip' ? 'danger' : 'default'}
          onPress={() => onChange('skip')}
        >
          跳过
        </Button>
      </div>
    );
  }
  if (item.category === 'update') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={item.decision === 'skip' ? 'solid' : 'flat'} color={item.decision === 'skip' ? 'default' : 'default'} onPress={() => onChange('skip')}>
          保留本地
        </Button>
        <Button size="sm" color={item.decision === 'incoming' ? 'warning' : 'default'} variant={item.decision === 'incoming' ? 'solid' : 'flat'} onPress={() => onChange('incoming')}>
          采用来稿
        </Button>
        <Button size="sm" color={item.decision === 'merge' ? 'success' : 'default'} variant={item.decision === 'merge' ? 'solid' : 'flat'} startContent={<GitMerge className="h-3.5 w-3.5" />} onPress={() => onChange('merge')}>
          合并
        </Button>
      </div>
    );
  }
  if (item.category === 'conflict') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="flat" color={item.decision === 'skip' ? 'danger' : 'default'} onPress={() => onChange('skip')}>
          保留本地
        </Button>
        <Button size="sm" color={item.decision === 'import' ? 'danger' : 'default'} variant={item.decision === 'import' ? 'solid' : 'flat'} onPress={() => onChange('import')}>
          采用来稿（并存）
        </Button>
        <Button size="sm" color={item.decision === 'merge' ? 'success' : 'default'} variant={item.decision === 'merge' ? 'solid' : 'flat'} startContent={<GitMerge className="h-3.5 w-3.5" />} onPress={() => onChange('merge')}>
          合并
        </Button>
      </div>
    );
  }
  return null;
}

export function ImportReviewModal({ isOpen, onOpenChange, document, onConfirmImport }: ImportReviewModalProps) {
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [resultMessage, setResultMessage] = useState<AppliedImport | null>(null);

  function reset() {
    setJsonText('');
    setParseError('');
    setPreview(null);
    setResultMessage(null);
  }

  function runPreview(text = jsonText) {
    setParseError('');
    setResultMessage(null);
    try {
      const { entries, invalid } = parseIncoming(text);
      setPreview(buildImportPreview(document, entries, invalid));
    } catch (error) {
      setPreview(null);
      setParseError(error instanceof Error ? error.message : String(error));
    }
  }

  function updateItem(key: number, patch: Partial<ImportItem>) {
    setPreview((current) => {
      if (!current) return current;
      const items = current.items.map((item) => (item.key === key ? { ...item, ...patch } : item));
      return { ...current, items, selectedCount: items.filter((item) => item.selected).length };
    });
  }

  function changeDecision(item: ImportItem, decision: ImportDecision) {
    const selected =
      item.category === 'new'
        ? decision === 'import'
        : decision !== 'skip';
    updateItem(item.key, { decision, selected });
  }

  function setSelected(keys: string[], checked: boolean) {
    setPreview((current) => {
      if (!current) return current;
      const keySet = new Set(keys);
      const items = current.items.map((item) => {
        if (!keySet.has(String(item.key)) || item.category === 'duplicate' || item.category === 'invalid') {
          return item;
        }
        if (checked) {
          // 勾中时沿用当前决策；若当前是跳过则恢复合理默认
          const decision: ImportDecision =
            item.decision !== 'skip'
              ? item.decision
              : item.category === 'new'
                ? 'import'
                : item.category === 'update'
                  ? 'merge'
                  : 'import';
          return { ...item, selected: true, decision };
        }
        return { ...item, selected: false, decision: 'skip' as ImportDecision };
      });
      return { ...current, items, selectedCount: items.filter((item) => item.selected).length };
    });
  }

  function toggleAll() {
    const selectable = preview?.items.filter((item) => item.category !== 'duplicate' && item.category !== 'invalid') ?? [];
    const allChecked = selectable.length > 0 && selectable.every((item) => item.selected);
    setSelected(selectable.map((item) => String(item.key)), !allChecked);
  }

  function confirmImport() {
    if (!preview || !preview.selectedCount) return;
    const result = onConfirmImport(preview);
    setResultMessage(result);
    setPreview(null);
    setJsonText('');
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) setTimeout(reset, 200);
      }}
      size="4xl"
      scrollBehavior="inside"
      aria-label="导入校注包预审"
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex items-center gap-2">
              <FileUp className="h-5 w-5 text-amber-700" />
              导入预审 · 校注包
              {preview ? (
                <Chip size="sm" variant="flat" color="warning" className="ml-2">
                  {preview.selectedCount} 项待导入
                </Chip>
              ) : null}
            </ModalHeader>
            <ModalBody className="gap-4">
              {resultMessage ? (
                <div className="space-y-3">
                  <Card shadow="none" className="border border-green-200 bg-green-50">
                    <CardBody className="gap-2 p-4 text-sm text-green-900">
                      <div className="flex items-center gap-2 font-semibold">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        导入完成，仅落入选中的内容
                      </div>
                      <ul className="ml-6 list-disc text-xs leading-6 text-green-800">
                        <li>新增注释 {resultMessage.added} 条</li>
                        <li>更新既有注释 {resultMessage.updated} 条</li>
                        <li>来源并存（进入冲突列表）{resultMessage.conflicted} 条</li>
                        <li>合并正文 {resultMessage.merged} 条</li>
                        {resultMessage.droppedReferences.length > 0 && (
                          <li className="text-amber-800">
                            {resultMessage.droppedReferences.reduce((sum, item) => sum + item.refs.length, 0)} 个悬空引用 ID 已自动剔除（不会破坏现有引用关系）
                          </li>
                        )}
                      </ul>
                      <p className="text-xs text-green-700">章节正文、历史快照与未勾选的注释均保持原样。</p>
                    </CardBody>
                  </Card>
                  <Button color="primary" variant="flat" onPress={onClose}>完成</Button>
                </div>
              ) : !preview ? (
                <div className="space-y-3">
                  <p className="text-xs leading-5 text-stone-500">
                    粘贴另一位学者整理的 JSON 校注包后先做预审：系统会区分<b>新增注释</b>、<b>同一条注释的更新</b>与<b>引用目标相同且类型相同的来源冲突</b>，
                    并标出重复内容与无法定位的条目。确认时只落勾选项，引用会接到现有的句子或词语上。
                  </p>
                  <Textarea
                    aria-label="粘贴来稿 JSON"
                    label="来稿 JSON"
                    placeholder='可粘贴注释数组，或导出的完整文档 / { "package": { "annotations": [...] } }'
                    minRows={12}
                    value={jsonText}
                    onValueChange={(value) => {
                      setJsonText(value);
                      setParseError('');
                    }}
                    classNames={{ input: 'font-mono text-xs leading-5' }}
                  />
                  {parseError ? (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{parseError}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between">
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<Sparkles className="h-3.5 w-3.5" />}
                      onPress={() => {
                        setJsonText(SAMPLE_INCOMING_JSON);
                        setParseError('');
                      }}
                    >
                      填入示例来稿
                    </Button>
                    <Button color="primary" isDisabled={!jsonText.trim()} onPress={() => runPreview()}>
                      开始预审
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
                    {CATEGORY_COPY.map(({ key, title, chipColor }) => (
                      <Chip key={key} size="sm" color={chipColor} variant="flat">
                        {title} {preview.counts[key]}
                      </Chip>
                    ))}
                    {preview.invalid.length > 0 && (
                      <Chip size="sm" color="warning" variant="bordered">
                        格式无法识别 {preview.invalid.length} 条
                      </Chip>
                    )}
                    <Button size="sm" variant="light" className="ml-auto" onPress={toggleAll}>
                      全选 / 全不选可选条目
                    </Button>
                  </div>

                  <ScrollShadow className="max-h-[52vh]">
                    <div className="space-y-4 pr-1">
                      {CATEGORY_COPY.map(({ key, title, hint, chipColor, icon }) => {
                        const group = preview.items.filter((item) => item.category === key);
                        if (!group.length && !(key === 'invalid' && preview.invalid.length)) return null;
                        return (
                          <section key={key} className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Chip size="sm" color={chipColor} variant="flat" startContent={icon}>
                                {title} · {group.length}
                              </Chip>
                              <span className="text-[11px] text-stone-500">{hint}</span>
                            </div>
                            {group.map((item) => (
                              <ImportItemCard
                                key={item.key}
                                item={item}
                                checked={item.selected}
                                onToggle={(checked) => setSelected([String(item.key)], checked)}
                                onDecision={(decision) => changeDecision(item, decision)}
                                onMergeChange={(field, value) =>
                                  updateItem(item.key, {
                                    merged: {
                                      ...item.merged,
                                      [field]: value
                                    }
                                  })
                                }
                              />
                            ))}
                            {key === 'invalid' &&
                              preview.invalid.map((entry) => (
                                <Card key={`bad-${entry.index}`} shadow="none" className="border border-amber-200 bg-amber-50/60">
                                  <CardBody className="p-3 text-xs text-amber-900">
                                    第 {entry.index} 条：{entry.reason}，无法进入预审。
                                  </CardBody>
                                </Card>
                              ))}
                          </section>
                        );
                      })}
                    </div>
                  </ScrollShadow>
                </>
              )}
            </ModalBody>
            {preview ? (
              <ModalFooter className="flex-col gap-2 sm:flex-row">
                <p className="mr-auto self-center text-[11px] leading-5 text-stone-500">
                  确认后只落勾选的 {preview.selectedCount} 项；历史快照、正文与无关注释保持原样。
                </p>
                <Button variant="light" onPress={() => setPreview(null)}>
                  返回修改来稿
                </Button>
                <Button
                  color="primary"
                  isDisabled={!preview.selectedCount}
                  startContent={<CheckCircle2 className="h-4 w-4" />}
                  onPress={confirmImport}
                >
                  确认导入{preview.selectedCount ? `（${preview.selectedCount} 项）` : ''}
                </Button>
              </ModalFooter>
            ) : null}
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function ImportItemCard({
  item,
  checked,
  onToggle,
  onDecision,
  onMergeChange
}: {
  item: ImportItem;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onDecision: (decision: ImportDecision) => void;
  onMergeChange: (field: 'title' | 'body' | 'source', value: string) => void;
}) {
  const selectable = item.category !== 'duplicate' && item.category !== 'invalid';
  const cardBorder =
    item.category === 'conflict'
      ? 'border-red-200'
      : item.category === 'invalid'
        ? 'border-amber-200 opacity-80'
        : item.category === 'duplicate'
          ? 'border-stone-200 opacity-70'
          : 'border-stone-200';

  return (
    <Card shadow="none" className={`border ${cardBorder}`}>
      <CardBody className="gap-3 p-3">
        <div className="flex items-start gap-2">
          {selectable ? (
            <Checkbox
              aria-label={`选择第 ${item.key} 条`}
              isSelected={checked}
              onValueChange={onToggle}
              className="mt-0.5"
            />
          ) : (
            <span className="mt-1 w-6 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" color="primary" variant="flat">{kindLabel(item.raw.kind)}</Chip>
              <Chip size="sm" variant="bordered">{anchorTypeLabels[item.anchor?.anchorType ?? item.raw.anchorType]}</Chip>
              <span className="text-[11px] text-stone-500">第 {item.key} 条 · 来稿 ID {item.raw.id}</span>
              {selectable ? (
                <Chip size="sm" variant="flat" color={item.selected ? 'success' : 'default'} className="ml-auto">
                  {DECISION_LABEL[item.decision]}
                </Chip>
              ) : (
                <Chip size="sm" variant="flat" color="default" className="ml-auto">不导入</Chip>
              )}
            </div>
            {item.anchor ? (
              <p className="mt-1.5 text-xs text-stone-600">
                引用接到：<b className="text-stone-800">{item.anchor.anchorLabel}</b>
                {item.anchor.fellBackToSentence ? <span className="ml-1 text-amber-700">（词级引用已回退挂接到句子）</span> : null}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-amber-800">引用目标无法定位到本地章节、句子或词语。</p>
            )}
            {item.issues.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {item.issues.map((issue, index) => (
                  <li key={index} className="flex items-start gap-1 text-[11px] leading-4 text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {issue}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {item.category === 'update' && item.local ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <SourceBlock
              label="本地"
              tone="local"
              title={item.local.title}
              body={item.local.body}
              source={item.local.source}
              tags={item.local.tags}
              references={item.local.references}
            />
            <SourceBlock
              label="来稿"
              tone="incoming"
              title={item.raw.title}
              body={item.raw.body}
              source={item.raw.source}
              tags={item.raw.tags}
              references={item.raw.references}
            />
          </div>
        ) : item.category === 'conflict' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              {item.localPeers.length ? (
                item.localPeers.map((peer) => (
                  <SourceBlock
                    key={peer.id}
                    label={`本地来源 · ${peer.id}`}
                    tone="local"
                    title={peer.title}
                    body={peer.body}
                    source={peer.source}
                    tags={peer.tags}
                    references={peer.references}
                  />
                ))
              ) : (
                <p className="text-[11px] text-stone-500">本地已有同目标同类型注释。</p>
              )}
            </div>
            <SourceBlock
              label="来稿新来源"
              tone="incoming"
              title={item.raw.title}
              body={item.raw.body}
              source={item.raw.source}
              tags={item.raw.tags}
              references={item.raw.references}
            />
          </div>
        ) : (
          <div className="pl-8">
            <SourceBlock
              label={item.category === 'new' ? '来稿' : item.category === 'duplicate' ? '重复内容' : '无法导入'}
              tone={item.category === 'new' ? 'incoming' : 'local'}
              title={item.raw.title}
              body={item.raw.body}
              source={item.raw.source}
              tags={item.raw.tags}
              references={item.raw.references}
            />
          </div>
        )}

        {item.category === 'update' && item.changedFields.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-8">
            {item.changedFields.map((field) => (
              <Chip key={field.field} size="sm" variant="bordered" className="h-5 min-h-5 text-[10px]">
                {field.label}不同
              </Chip>
            ))}
          </div>
        )}

        {item.selected && (item.decision === 'merge') && (item.category === 'update' || item.category === 'conflict') ? (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 pl-8">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
              <GitMerge className="h-3.5 w-3.5" />
              合并草稿（可编辑，确认时以此为准）
            </div>
            <Input
              size="sm"
              aria-label="合并标题"
              label="标题"
              value={item.merged.title}
              onValueChange={(value) => onMergeChange('title', value)}
            />
            <Textarea
              size="sm"
              aria-label="合并正文"
              label="正文"
              minRows={3}
              value={item.merged.body}
              onValueChange={(value) => onMergeChange('body', value)}
            />
            <Input
              size="sm"
              aria-label="合并来源"
              label="来源"
              value={item.merged.source}
              onValueChange={(value) => onMergeChange('source', value)}
            />
            <div className="text-[10px] text-emerald-700">
              标签与引用自动取并集：{item.merged.tags.join('、') || '（无标签）'}；
              引用 {item.merged.references.join('、') || '（无）'}
            </div>
          </div>
        ) : null}

        {selectable ? (
          <div className="pl-8">
            <DecisionButtons item={item} onChange={onDecision} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

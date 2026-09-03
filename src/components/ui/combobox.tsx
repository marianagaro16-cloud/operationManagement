'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { filterByQuery } from '@/lib/search';

/**
 * Searchable single-select.
 *
 * Filters a list the caller already holds — the order form receives the
 * active customers and products as props, so there is nothing to fetch and
 * no second copy of master data. At a few hundred records, filtering in
 * memory is both simpler and faster than a round trip per keystroke.
 *
 * Follows the ARIA combobox pattern: the input owns the listbox, options are
 * addressed with aria-activedescendant rather than moving focus, and the
 * whole thing is operable from the keyboard.
 */

export interface ComboboxProps<T> {
  items: T[];
  /** Currently selected key, or null. */
  value: string | null;
  onChange: (key: string | null) => void;
  getKey: (item: T) => string;
  /** Single-line label shown in the closed field. */
  getLabel: (item: T) => string;
  /** Everything the search should match against, joined by the caller. */
  getSearchText: (item: T) => string;
  /** Optional richer rendering inside the list. Falls back to getLabel. */
  renderOption?: (item: T, active: boolean) => ReactNode;
  placeholder?: string;
  emptyMessage?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Allow clearing back to "nothing selected". */
  clearable?: boolean;
}

export function Combobox<T>({
  items,
  value,
  onChange,
  getKey,
  getLabel,
  getSearchText,
  renderOption,
  placeholder,
  emptyMessage,
  id,
  disabled,
  className,
  clearable = true,
}: ComboboxProps<T>) {
  const { t } = useI18n();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => items.find((i) => getKey(i) === value) ?? null,
    [items, value, getKey],
  );

  // Empty query shows everything, so the field is browsable without typing.
  // The matching itself lives in lib/search, where it is unit-tested against
  // the real customer and product strings.
  const filtered = useMemo(
    () => filterByQuery(items, query, getSearchText),
    [items, query, getSearchText],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // Keep the highlighted option in view during keyboard navigation.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // Close on an outside click, which is what a tap elsewhere means on mobile.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function commit(item: T) {
    onChange(getKey(item));
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (filtered.length === 0) return;
      setActiveIndex((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        // Wrap, so the list is a loop rather than a dead end.
        return (next + filtered.length) % filtered.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        e.preventDefault();
        commit(filtered[activeIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // do not also close the surrounding dialog
        setOpen(false);
        setQuery('');
      }
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  }

  // Closed: show the selection. Open: show what is being typed.
  const displayValue = open ? query : (selected ? getLabel(selected) : '');

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filtered[activeIndex] ? `${inputId}-opt-${activeIndex}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          placeholder={selected ? undefined : (placeholder ?? t('common.search'))}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            'w-full rounded-lg border border-border bg-surface py-2 pl-3 pr-14 text-sm text-fg',
            'placeholder:text-subtle transition-colors focus:border-accent disabled:opacity-50',
            'touch-target',
          )}
        />

        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {clearable && selected && !open && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('common.cancel')}
              onClick={() => { onChange(null); setQuery(''); inputRef.current?.focus(); }}
              className="rounded p-1 text-subtle transition-colors hover:text-fg"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('common.search')}
            onClick={() => { setOpen((v) => !v); inputRef.current?.focus(); }}
            className="rounded p-1 text-subtle transition-colors hover:text-fg"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
              aria-hidden
            />
          </button>
        </div>
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className={
            'absolute z-50 mt-1 max-h-64 w-full overflow-y-auto overscroll-contain rounded-lg ' +
            'border border-border bg-surface py-1 shadow-pop animate-fade-in'
          }
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted" role="presentation">
              {emptyMessage ?? t('common.none')}
            </li>
          ) : (
            filtered.map((item, index) => {
              const key = getKey(item);
              const isSelected = key === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={key}
                  id={`${inputId}-opt-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  // pointerdown fires before the input's blur, so the click
                  // is not lost to the field closing first.
                  onPointerDown={(e) => { e.preventDefault(); commit(item); }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] touch-target',
                    isActive && 'bg-surface-2',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    {renderOption ? renderOption(item, isActive) : getLabel(item)}
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

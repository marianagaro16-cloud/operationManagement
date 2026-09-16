'use client';

import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
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
  /**
   * Fired after a selection is committed from the list, so the caller can
   * move focus onward.
   *
   * This is what makes keyboard-first order entry possible: choose a product,
   * land in the quantity, type, Enter, next line. Distinct from `onChange`,
   * which also fires when the value is cleared or set programmatically and
   * would jump focus at the wrong moment.
   */
  onCommitted?: (key: string) => void;
  /** Imperative focus, for a caller driving the flow between fields. */
  handleRef?: Ref<ComboboxHandle>;
}

export interface ComboboxHandle {
  focus: () => void;
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
  onCommitted,
  handleRef,
}: ComboboxProps<T>) {
  const { t } = useI18n();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Whether the person has moved through the list with the arrow keys since
  // it opened or the query last changed. Without a query or that, the
  // highlighted option is only the list's first item, not a choice. Hover
  // does not count: a list can open under a resting pointer, and pointer
  // users choose by clicking.
  const [navigated, setNavigated] = useState(false);
  /**
   * Opened on a selection and not edited yet: the field holds the selected
   * label, cursor at the end, rather than going blank for searching. The
   * label is not a search — the list stays unfiltered and Enter keeps the
   * selection — until the person changes the text.
   */
  const [showingSelection, setShowingSelection] = useState(false);
  // The clear button refocuses the field after clearing, when `selected` in
  // this render is still the value being cleared.
  const skipSelectionOnFocus = useRef(false);

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
  const searchQuery = showingSelection ? '' : query;
  const filtered = useMemo(
    () => filterByQuery(items, searchQuery, getSearchText),
    [items, searchQuery, getSearchText],
  );

  useEffect(() => {
    setActiveIndex(0);
    setNavigated(false);
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
        setShowingSelection(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useImperativeHandle(handleRef, () => ({ focus: () => inputRef.current?.focus() }), []);

  function commit(item: T) {
    const key = getKey(item);
    onChange(key);
    setOpen(false);
    setQuery('');
    setShowingSelection(false);
    // Blur only when nobody is taking the focus onward. Blurring first and
    // letting the caller refocus makes the mobile keyboard close and reopen.
    if (onCommitted) onCommitted(key);
    else inputRef.current?.blur();
  }

  function onFocus() {
    setOpen(true);
    if (!selected || skipSelectionOnFocus.current) return;
    // Keep the selection in the field, cursor after it, so arriving here —
    // by Enter from the previous line or a tap — never looks like it was lost.
    const label = getLabel(selected);
    setQuery(label);
    setShowingSelection(true);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el && document.activeElement === el) el.setSelectionRange(label.length, label.length);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (filtered.length === 0) return;
      setNavigated(true);
      setActiveIndex((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        // Wrap, so the list is a loop rather than a dead end.
        return (next + filtered.length) % filtered.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      // Nothing typed and nothing picked from the list: Enter is not a
      // choice. The list is unfiltered then, so the highlighted option is
      // just the first item — committing it replaced a line's product when
      // Enter was pressed twice in quick succession. With a selection, Enter
      // keeps it (and moves on); without one, it does nothing.
      if (open && !navigated && (showingSelection || !query.trim())) {
        e.preventDefault();
        if (selected) commit(selected);
        return;
      }
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
        setShowingSelection(false);
      }
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      setQuery('');
      setShowingSelection(false);
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
          // Open with nothing typed, the selection stays readable as the
          // placeholder rather than the field looking emptied.
          placeholder={selected ? getLabel(selected) : (placeholder ?? t('common.search'))}
          onChange={(e) => { setQuery(e.target.value); setShowingSelection(false); setOpen(true); }}
          onFocus={onFocus}
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
              onClick={() => {
                onChange(null);
                setQuery('');
                skipSelectionOnFocus.current = true;
                inputRef.current?.focus();
                skipSelectionOnFocus.current = false;
              }}
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

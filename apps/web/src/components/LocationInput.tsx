import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MIN_QUERY_LENGTH, useGeocode } from '../hooks/useGeocode';
import type { Place } from '../types';
import { CloseIcon, PinIcon } from './icons';
import { t } from '../lib/i18n';

interface Props {
  label: string;
  placeholder: string;
  value: Place | null;
  onSelect: (place: Place | null) => void;
  onFocus?: () => void;
  /** Leading marker (origin dot / destination pin). */
  marker: ReactNode;
  /** Extra action inside the field, e.g. "use current location". */
  action?: ReactNode;
}

/** Accessible place-search combobox (WAI-ARIA combobox pattern with list autocomplete). */
export function LocationInput({
  label,
  placeholder,
  value,
  onSelect,
  onFocus,
  marker,
  action,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value?.name ?? '');
  const [focused, setFocused] = useState(false);
  const [activeRaw, setActive] = useState(-1);

  // Reflect external changes (swap, GPS, URL, map pin) in the field.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value?.name ?? '');
  }

  const searching = focused && text.trim() !== (value?.name ?? '');
  const geo = useGeocode(text, searching);
  const options = searching ? geo.results : [];
  const open = searching && text.trim().length >= MIN_QUERY_LENGTH;
  // New results can be shorter than the highlighted index.
  const active = activeRaw < options.length ? activeRaw : -1;

  const choose = (place: Place) => {
    onSelect(place);
    setText(place.name);
    setActive(-1);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      const pick = options[active] ?? options[0];
      if (pick) {
        e.preventDefault();
        choose(pick);
      }
    } else if (e.key === 'Escape') {
      setText(value?.name ?? '');
      inputRef.current?.blur();
    }
  };

  const onBlur = () => {
    setFocused(false);
    if (!text.trim()) onSelect(null);
    else setText(value?.name ?? '');
  };

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl bg-slate-100 pr-1 pl-3 ring-teal-700 focus-within:bg-white focus-within:ring-2">
        <span className="shrink-0">{marker}</span>
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(-1);
          }}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
            onFocus?.();
          }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-[16px] text-slate-900 placeholder:text-slate-500 focus:outline-none"
        />
        {text && focused ? (
          <button
            type="button"
            aria-label={t('Clear {label}', { label: label.toLowerCase() })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText('');
              inputRef.current?.focus();
            }}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-200"
          >
            <CloseIcon size={18} />
          </button>
        ) : (
          action
        )}
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label={t('{label} suggestions', { label })}
        hidden={!open}
        className="mt-1 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200"
      >
        {options.map((place, i) => (
          // WAI-ARIA combobox pattern: focus stays in the input; options are reached with
          // arrow keys via aria-activedescendant (handled in onKeyDown above), so they are
          // intentionally not focusable and have no key handlers of their own.
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
          <div
            key={`${place.name}-${place.lat}-${place.lng}`}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            // Keep focus in the input so blur doesn't close the list before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(place)}
            className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${i === active ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
          >
            <PinIcon size={18} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-slate-900">
                {place.name}
              </span>
              {place.detail && (
                <span className="block truncate text-sm text-slate-500">{place.detail}</span>
              )}
            </span>
          </div>
        ))}
        {open && options.length === 0 && (
          <p className="px-3 py-3 text-sm text-slate-500" aria-live="polite">
            {geo.status === 'loading'
              ? t('Searching…')
              : geo.status === 'error'
                ? t('Search is unavailable right now. Check your connection.')
                : t('No places found. Try a landmark or market name.')}
          </p>
        )}
      </div>
    </div>
  );
}

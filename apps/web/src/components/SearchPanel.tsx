import type { Place } from '../types';
import { LocateIcon, SwapIcon } from './icons';
import { LocationInput } from './LocationInput';

interface Props {
  from: Place | null;
  to: Place | null;
  onFromChange: (p: Place | null) => void;
  onToChange: (p: Place | null) => void;
  onSwap: () => void;
  onUseMyLocation: () => void;
  locating: boolean;
  locationError: string | null;
  onInputFocus: () => void;
}

export function SearchPanel({
  from,
  to,
  onFromChange,
  onToChange,
  onSwap,
  onUseMyLocation,
  locating,
  locationError,
  onInputFocus,
}: Props) {
  return (
    <div>
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <LocationInput
            label="From"
            placeholder={locating ? 'Finding your location…' : 'Where from?'}
            value={from}
            onSelect={onFromChange}
            onFocus={onInputFocus}
            marker={
              <span className="block size-3 rounded-full border-[3px] border-teal-700 bg-white" />
            }
            action={
              <button
                type="button"
                onClick={onUseMyLocation}
                disabled={locating}
                aria-label="Start from my current location"
                title="Use my location"
                className="grid size-10 shrink-0 place-items-center rounded-lg text-teal-700 hover:bg-teal-50 disabled:opacity-60"
              >
                <LocateIcon size={20} className={locating ? 'animate-pulse' : undefined} />
              </button>
            }
          />
          <LocationInput
            label="To"
            placeholder="Where to?"
            value={to}
            onSelect={onToChange}
            onFocus={onInputFocus}
            marker={<span className="block size-3 rounded-[3px] bg-amber-500" />}
          />
        </div>
        <button
          type="button"
          onClick={onSwap}
          disabled={!from && !to}
          aria-label="Swap start and destination"
          // Pinned between the two inputs (48 px fields + 8 px gap), even when suggestions open.
          className="mt-[30px] grid w-10 shrink-0 place-items-center self-start rounded-lg py-3 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <SwapIcon size={20} />
        </button>
      </div>
      {locationError && (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {locationError}
        </p>
      )}
    </div>
  );
}

import { CloseIcon, DownloadIcon, OfflineIcon, ShareIcon } from './icons';
import { t } from '../lib/i18n';

export function OfflineBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white"
    >
      <OfflineIcon size={16} className="shrink-0" />
      {t('You’re offline. Recent trips still work.')}
    </div>
  );
}

export function InstallBanner({
  ios,
  onInstall,
  onDismiss,
}: {
  ios: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label={t('Install the app')}
      className="flex items-center gap-3 rounded-2xl bg-teal-50 p-3 ring-1 ring-teal-700/15"
    >
      <img src="/pwa-64x64.png" alt="" width={36} height={36} className="shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-teal-950">{t('Add to home screen')}</p>
        <p className="text-teal-900/80">
          {ios ? (
            <>
              Tap <ShareIcon size={14} className="inline align-[-2px]" /> Share, then &ldquo;Add to
              Home Screen&rdquo;.
            </>
          ) : (
            t('Opens instantly, keeps recent trips offline.')
          )}
        </p>
      </div>
      {!ios && (
        <button
          type="button"
          onClick={onInstall}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          <DownloadIcon size={16} />
          {t('Install')}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('Dismiss install suggestion')}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-teal-900/60 hover:bg-teal-100"
      >
        <CloseIcon size={18} />
      </button>
    </section>
  );
}

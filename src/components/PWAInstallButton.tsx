import React, { useState } from 'react';
import { Download, Smartphone, WifiOff } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        Install App
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Smartphone className="w-3.5 h-3.5" />
        Add to Phone
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Add ArrowOut to Your Phone</h2>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
                <p className="font-semibold text-slate-800">On iPhone / iPad (Safari):</p>
                <p>1. Open this app URL in Safari.</p>
                <p>2. Tap the <strong>Share</strong> icon in the bottom toolbar.</p>
                <p>3. Scroll down and tap <strong>Add to Home Screen</strong>.</p>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                <div className="space-y-1">
                  <p className="font-semibold text-slate-800">On Android (Chrome):</p>
                  <p>1. Open this app URL directly in Chrome (outside embedded previews).</p>
                  <p>2. Tap the <strong>⋮ Menu</strong> in the top-right corner.</p>
                  <p>3. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
                </div>
                <div className="space-y-1 pt-2 border-t border-slate-100">
                  <p className="font-semibold text-slate-800">On iPhone (Safari):</p>
                  <p>Tap <strong>Share</strong> and choose <strong>Add to Home Screen</strong>.</p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm">
      <WifiOff className="w-3.5 h-3.5" />
      Offline Mode · Solo Play works offline
    </div>
  );
};

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

const TEST_SITE_KEY = '1x00000000000000000000AA';
let scriptPromise;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-teamflow-turnstile]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.teamflowTurnstile = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

const TurnstileCaptcha = forwardRef(function TurnstileCaptcha({ onToken }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [status, setStatus] = useState('Loading security check…');
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? TEST_SITE_KEY : '');

  useImperativeHandle(ref, () => ({
    reset() {
      onToken('');
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
      setStatus('Complete the security check.');
    },
  }), [onToken]);

  useEffect(() => {
    let mounted = true;
    onToken('');
    if (!siteKey) {
      setStatus('Security verification is not configured.');
      return () => { mounted = false; };
    }

    loadTurnstile().then(() => {
      if (!mounted || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: 'password_reset',
        callback(token) { if (mounted) { onToken(token); setStatus('Security check complete.'); } },
        'expired-callback'() { if (mounted) { onToken(''); setStatus('Security check expired. Please verify again.'); } },
        'error-callback'() { if (mounted) { onToken(''); setStatus('Security check could not load. Please try again.'); } },
      });
      setStatus('Complete the security check.');
    }).catch(() => { if (mounted) setStatus('Security check could not load. Check your connection and try again.'); });

    return () => {
      mounted = false;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [onToken, siteKey]);

  return <div className="captcha-field"><div ref={containerRef} aria-label="CAPTCHA verification" /><p className="field-help" role="status">{status}</p></div>;
});

export default TurnstileCaptcha;

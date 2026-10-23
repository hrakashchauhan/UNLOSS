import { useEffect, useRef, useState } from 'react';

type GoogleIdentity = {
  initialize(options: { client_id: string; callback: (result: { credential: string }) => void }): void;
  renderButton(element: HTMLElement, options: { theme: string; size: string }): void;
};
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }

export function GoogleSignIn({ onCredential }: { onCredential: (credential: string) => Promise<void> }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [error, setError] = useState('');
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const render = () => {
      if (!active || !container.current || !window.google) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: result => { void callback.current(result.credential); } });
      window.google.accounts.id.renderButton(container.current, { theme: 'outline', size: 'large' });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.dataset.googleIdentity = 'true';
      document.head.appendChild(script);
    }
    const failed = () => setError('Google sign-in could not load. Please try again.');
    script.addEventListener('load', render);
    script.addEventListener('error', failed);
    render();
    return () => { active = false; script.removeEventListener('load', render); script.removeEventListener('error', failed); };
  }, [clientId]);
  if (!clientId) return <p className="muted">Google sign-in is not configured yet.</p>;
  return <><div ref={container} />{error && <p role="alert">{error}</p>}</>;
}

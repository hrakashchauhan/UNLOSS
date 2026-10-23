import { useEffect, useState } from 'react';
import { Radio, RefreshCw, Zap } from 'lucide-react';
import { subscribeToLiveEvents } from '../api';

export function LiveIndicator({ onLiveEvent }: { onLiveEvent?: (event: any) => void }) {
  const [status, setStatus] = useState<'connected' | 'reconnecting' | 'offline'>('connected');
  const [lastTime, setLastTime] = useState<string>(new Date().toLocaleTimeString());
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToLiveEvents({
      onEvent: (event) => {
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
        if (onLiveEvent) {
          onLiveEvent(event);
        }
      },
      onStatusChange: (newStatus, time) => {
        setStatus(newStatus);
        if (time) setLastTime(time);
      },
    });

    return () => unsubscribe();
  }, [onLiveEvent]);

  return (
    <div
      className={`live-indicator-pill ${status} ${pulse ? 'pulsing' : ''}`}
      title={`Real-Time Connection: ${status === 'connected' ? 'Server-Sent Events Active' : status === 'reconnecting' ? 'Reconnecting to Event Stream…' : 'Polling Fallback Active'} · Last update: ${lastTime}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px',
        borderRadius: '20px',
        fontSize: '.76rem',
        fontWeight: 600,
        background: status === 'connected' ? 'rgba(0, 88, 86, 0.08)' : status === 'reconnecting' ? '#fff8e6' : '#f0f2f5',
        color: status === 'connected' ? 'var(--primary)' : status === 'reconnecting' ? '#8a6500' : 'var(--muted)',
        border: `1px solid ${status === 'connected' ? 'var(--primary-border)' : status === 'reconnecting' ? '#ebd494' : 'var(--line)'}`,
        transition: 'all 0.2s ease',
      }}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: status === 'connected' ? '#00877a' : status === 'reconnecting' ? '#f0ad4e' : '#888',
          boxShadow: status === 'connected' ? '0 0 0 2px rgba(0, 135, 122, 0.25)' : 'none',
          display: 'inline-block',
          animation: status === 'reconnecting' ? 'spin 1.5s linear infinite' : pulse ? 'ping 0.8s ease' : 'none',
        }}
      />
      <span>
        {status === 'connected' ? 'Live SSE' : status === 'reconnecting' ? 'Reconnecting…' : 'Polling'}
      </span>
      <span style={{ fontSize: '.7rem', opacity: 0.75, borderLeft: '1px solid currentColor', paddingLeft: '5px' }}>
        {lastTime}
      </span>
    </div>
  );
}

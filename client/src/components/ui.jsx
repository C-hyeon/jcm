import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon';

export function Loading({ lines = 3, label = '불러오는 중' }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 1000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="loading" aria-busy="true" aria-live="polite">
      {show && (
        <>
          <span className="sr-only">{label}…</span>
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="skeleton" style={{ width: `${92 - i * 12}%` }} />
          ))}
        </>
      )}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  const location = useLocation();
  if (!error) return null;
  const needLogin = error.status === 401;
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" />
      <div>
        <p>{error.message}</p>
        <div className="alert-actions">
          {needLogin && (
            <Link className="btn btn-sm" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
              다시 로그인
            </Link>
          )}
          {onRetry && !needLogin && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
              다시 시도
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children, icon = 'alert' }) {
  return (
    <div className={`alert alert-${tone}`} role="status">
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
          <Icon name="close" />
        </button>
      </div>
      {open && children}
    </dialog>
  );
}

export function ProgressBar({ value, label }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="bar-fill" style={{ width: `${v}%` }} />
    </div>
  );
}

export function PageHeader({ title, desc, actions }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p className="muted">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

// 외부 자료 링크
export function ExternalLink({ href, children, className = '' }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <Icon name="external" size={14} className="ext-icon" />
      <span className="sr-only">(새 탭에서 열림)</span>
    </a>
  );
}

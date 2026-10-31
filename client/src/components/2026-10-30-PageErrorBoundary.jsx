import { Component, createRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon';

class PageBoundary extends Component {
  state = { failed: false };
  heading = createRef();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.heading.current?.focus();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="empty" role="alert">
        <h1 className="empty-title" tabIndex={-1} ref={this.heading}>페이지를 불러오지 못했어요</h1>
        <p className="muted">연결 상태를 확인한 뒤 페이지를 새로고침해 주세요.</p>
        <div className="row-center">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            새로고침
          </button>
          <Link to="/" className="btn btn-outline">
            <Icon name="home" /> 홈으로
          </Link>
        </div>
      </section>
    );
  }
}

export default function PageErrorBoundary({ children }) {
  const { pathname } = useLocation();
  // A rejected lazy import stays cached until reload; route changes reset only the page boundary.
  return <PageBoundary key={pathname}>{children}</PageBoundary>;
}

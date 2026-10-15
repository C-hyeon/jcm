import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link } from 'react-router-dom';
import Dashboard from '../client/src/pages/Dashboard.jsx';
import '../client/src/styles.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <div className="app">
      <header className="topbar"><span className="brand">정처기메이트</span><span>프론트 QA</span></header>
      <nav className="sidenav" aria-label="주요 메뉴"><Link className="nav-item active" to="/dashboard">대시보드</Link></nav>
      <main id="main"><Dashboard /></main>
    </div>
  </BrowserRouter>,
);

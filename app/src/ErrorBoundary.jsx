import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[AT UI boundary]', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-fallback" role="alert">
          <strong>AT UI 渲染失败</strong>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

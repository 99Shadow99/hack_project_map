import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          background: '#fee2e2',
          border: '1px solid #ef4444',
          borderRadius: '8px',
          margin: '20px'
        }}>
          <h2 style={{ color: '#991b1b', marginBottom: '10px' }}>
            🚨 Something went wrong
          </h2>
          <p style={{ color: '#7f1d1d', marginBottom: '15px' }}>
            The routing system encountered an error. Please try refreshing the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#dc2626',
              color: 'white',
              padding: '10px 20px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            🔄 Refresh Page
          </button>
          {process.env.NODE_ENV === 'development' && (
            <details style={{ marginTop: '15px', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: '#991b1b' }}>
                Error Details (Development)
              </summary>
              <pre style={{
                background: '#f3f4f6',
                padding: '10px',
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto'
              }}>
                {this.state.error?.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary; 
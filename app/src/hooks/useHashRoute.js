import { useCallback, useEffect, useMemo, useState } from 'react';

const knownViews = new Set(['platform', 'project', 'chat', 'work', 'team', 'sessions', 'api', 'settings']);

function parseHashRoute(hash = window.location.hash) {
  const normalized = hash.replace(/^#\/?/, '') || 'chat';
  const [view = 'chat', id = null] = normalized.split('/');
  return {
    view: knownViews.has(view) ? view : 'chat',
    params: { id },
    path: normalized
  };
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHashRoute());

  useEffect(() => {
    const syncViewFromLocation = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', syncViewFromLocation);
    window.addEventListener('popstate', syncViewFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncViewFromLocation);
      window.removeEventListener('popstate', syncViewFromLocation);
    };
  }, []);

  const navigate = useCallback((view, id = null) => {
    const next = id ? `${view}/${id}` : view;
    setRoute(parseHashRoute(`#${next}`));
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
  }, []);

  return useMemo(() => ({ ...route, navigate }), [route, navigate]);
}

import { useEffect } from 'react';

export function usePageStyles(...hrefs) {
  useEffect(() => {
    const links = hrefs.filter(Boolean).map((href) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.reactPageStyle = href;
      document.head.appendChild(link);
      return link;
    });

    return () => links.forEach((link) => link.remove());
  }, [hrefs.join('|')]);
}

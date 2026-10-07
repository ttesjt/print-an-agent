import { useEffect, useState } from 'react';

/** Application layout policy, matching the app-owned stylesheet breakpoint. */
export function useNarrowWorkspace() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 68rem)').matches
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 68rem)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

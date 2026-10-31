import { useEffect, useRef } from 'react';

/** Follow an explicitly opened detail, including its loading/error state. */
export function useDetailFocus(selection: string | null) {
  const target = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selection === null || !target.current) return;
    target.current.focus({ preventScroll: true });
    target.current.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }, [selection]);
  return (element: HTMLElement | null) => { target.current = element; };
}

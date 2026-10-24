import type { HTMLAttributes, ReactNode } from 'react';

export function VisuallyHidden({ children, as: Tag = 'span', ...rest }: { children: ReactNode; as?: 'span' | 'div' | 'p' } & HTMLAttributes<HTMLElement>) {
  const Comp = Tag as 'span';
  return (
    <Comp className="sr-only" {...rest}>
      {children}
    </Comp>
  );
}

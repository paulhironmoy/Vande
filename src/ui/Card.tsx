import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import s from './Card.module.css';

type Pad = 0 | 2 | 3 | 4 | 5 | 6;

interface CardBase {
  variant?: 'default' | 'raised' | 'sunken' | 'glass';
  padding?: Pad;
  /** Left accent bar colour (CSS colour or token). */
  accent?: string;
  className?: string;
  children?: ReactNode;
}

export interface CardProps extends CardBase, Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> {
  as?: 'div' | 'section' | 'article' | 'li';
}

function classes(variant: CardBase['variant'], padding: Pad | undefined, accent: string | undefined, extra?: string) {
  return [
    s.card,
    variant && variant !== 'default' ? s[variant] : '',
    padding !== undefined && padding !== 4 ? s[`pad${padding}` as keyof typeof s] : '',
    accent ? s.accent : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ variant, padding, accent, className, children, as = 'div', style, ...rest }, ref) {
  const Tag = as as 'div';
  const st = accent ? ({ ...style, '--card-accent': accent } as CSSProperties) : style;
  return (
    <Tag ref={ref} className={classes(variant, padding, accent, className)} style={st} {...rest}>
      {children}
    </Tag>
  );
});

export interface CardButtonProps extends CardBase, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {}

/** A whole-card button (interactive surface). */
export const CardButton = forwardRef<HTMLButtonElement, CardButtonProps>(function CardButton(
  { variant, padding, accent, className, children, style, type = 'button', ...rest },
  ref,
) {
  const st = accent ? ({ ...style, '--card-accent': accent } as CSSProperties) : style;
  return (
    <button ref={ref} type={type} className={`${classes(variant, padding, accent, className)} ${s.interactive}`} style={st} {...rest}>
      {children}
    </button>
  );
});

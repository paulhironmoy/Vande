import type { HTMLAttributes, ReactNode } from 'react';
import s from './Field.module.css';

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  description?: ReactNode;
  /** id of the control, for `label[for]`. */
  htmlFor?: string;
  /** Put the control on the same row (switches). */
  inline?: boolean;
  children: ReactNode;
}

export function Field({ label, description, htmlFor, inline, className, children, ...rest }: FieldProps) {
  const LabelTag = htmlFor ? 'label' : 'div';
  return (
    <div className={[s.field, inline ? s.inline : '', className ?? ''].join(' ')} {...rest}>
      <div className={s.text}>
        <LabelTag className={s.label} htmlFor={htmlFor}>
          {label}
        </LabelTag>
        {description && <div className={s.desc}>{description}</div>}
      </div>
      <div className={s.control}>{children}</div>
    </div>
  );
}

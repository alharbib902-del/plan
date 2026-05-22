'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Reusable password input with a show/hide toggle.
 *
 * Drop-in replacement for `<input type="password">`. Forwards all
 * native input props (id, name, autoComplete, required, dir, etc.)
 * so existing forms only swap the JSX tag.
 *
 * Layout: the toggle button is positioned at the logical end-0 of
 * the wrapper, which in the codebase's RTL pages renders on the
 * visual LEFT side of the input — the conventional Arabic-form
 * placement away from the LTR password text flow. The input itself
 * gets `ps-12` so user-typed characters never slide under the icon.
 *
 * Accessibility:
 *   - Arabic aria-label updates with state.
 *   - aria-pressed reflects the visible / hidden state for AT users.
 *   - tabIndex={-1} keeps Tab order on the password field itself;
 *     the toggle is reachable via the mouse + screen-reader cursor.
 */
type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
>;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = '', ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          {...rest}
          className={`${className} ps-12`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={
            visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
          }
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 flex items-center justify-center rounded-md px-3 text-ink-muted transition-colors hover:text-gold focus:text-gold focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/40"
        >
          {visible ? (
            <EyeOff className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Eye className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);
